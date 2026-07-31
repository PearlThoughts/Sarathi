import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryLifecycleState,
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQuerySource,
  type DeliveryQuerySubject,
  type DeliveryResultItem,
  type DeliverySprintClassification,
  type DeliverySprintReference,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";

type JiraSupportedIntent =
  | "activity"
  | "dependencies"
  | "blockers"
  | "commitments"
  | "delivered"
  | "current_work"
  | "ownership"
  | "next_actions"
  | "risks"
  | "recurring"
  | "status";

type JiraDeliveryQuery = DeliveryQueryContext & {
  readonly operation: DeliveryQueryOperation & { readonly purpose: JiraSupportedIntent };
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly limit: number;
  readonly subject?: DeliveryQuerySubject | undefined;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type JiraUser = { readonly accountId?: string; readonly displayName?: string };
type JiraStatus = {
  readonly name?: string;
  readonly statusCategory?: { readonly key?: string; readonly name?: string };
};
type JiraLinkedIssue = {
  readonly key?: string;
  readonly fields?: {
    readonly summary?: string;
    readonly status?: JiraStatus;
    readonly assignee?: JiraUser | null;
  };
};
type JiraIssueLink = {
  readonly type?: { readonly inward?: string; readonly outward?: string };
  readonly inwardIssue?: JiraLinkedIssue;
  readonly outwardIssue?: JiraLinkedIssue;
};
type JiraSprint = {
  readonly id?: number;
  readonly name?: string;
  readonly state?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly completeDate?: string;
};
type JiraIssue = {
  readonly id?: string;
  readonly key?: string;
  readonly fields?: Readonly<
    Record<string, unknown> & {
      readonly summary?: string;
      readonly created?: string;
      readonly updated?: string;
      readonly resolutiondate?: string | null;
      readonly status?: JiraStatus;
      readonly assignee?: JiraUser | null;
      readonly priority?: { readonly name?: string } | null;
      readonly issuetype?: { readonly name?: string };
      readonly labels?: readonly string[];
      readonly components?: readonly { readonly name?: string }[];
      readonly issuelinks?: readonly JiraIssueLink[];
    }
  >;
};
type JiraSearchResponse = {
  readonly issues?: readonly JiraIssue[];
  readonly nextPageToken?: string;
};
type JiraSearchResult = {
  readonly issues: readonly JiraIssue[];
  readonly exhausted: boolean;
};
type JiraField = {
  readonly id?: string;
  readonly name?: string;
  readonly schema?: { readonly custom?: string; readonly type?: string };
};
type JiraFieldSearchResponse = { readonly values?: readonly JiraField[] };
type JiraHistory = {
  readonly id?: string;
  readonly created?: string;
  readonly items?: readonly {
    readonly field?: string;
    readonly fromString?: string | null;
    readonly toString?: string | null;
  }[];
};
type JiraChangelogResponse = { readonly values?: readonly JiraHistory[] };

export type JiraDeliveryQueryConfiguration = {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly projectKeys: readonly string[];
  readonly sensitivity?: SensitivityTier | undefined;
  readonly authority?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetcher?: Fetcher | undefined;
};

const supportedIntents = new Set<JiraSupportedIntent>([
  "activity",
  "dependencies",
  "blockers",
  "commitments",
  "delivered",
  "current_work",
  "ownership",
  "next_actions",
  "risks",
  "recurring",
  "status",
]);
const supportedSelectors = new Set<DeliveryQueryOperation["select"]>([
  "objects",
  "relations",
  "observations",
]);

const operationAllowsJira = (operation: DeliveryQueryOperation): boolean => {
  const predicate = operation.predicates?.find(({ field }) => field === "source");
  if (predicate === undefined || predicate.operator === "exists") return true;
  const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
  if (predicate.operator === "contains")
    return "jira".includes(String(values[0] ?? "").toLowerCase());
  return values.map(String).includes("jira");
};

const asJiraQuery = (
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  subject: DeliveryQuerySubject | undefined,
): JiraDeliveryQuery | undefined => {
  if (!supportedIntents.has(operation.purpose as JiraSupportedIntent)) return undefined;
  const dayEnd = new Date(context.requestedAt);
  const defaultEnd = new Date(dayEnd.getTime() + 86_400_000).toISOString();
  const window =
    operation.time === undefined ||
    operation.time.kind === "jira_sprint" ||
    operation.time.kind === "release"
      ? {
          fromInclusive: new Date(dayEnd.getTime() - 366 * 86_400_000).toISOString(),
          toExclusive: defaultEnd,
        }
      : resolveDeliveryTimeConstraint(operation.time, context.requestedAt, context.timeZone);
  return {
    ...context,
    operation: operation as JiraDeliveryQuery["operation"],
    fromInclusive: window.fromInclusive,
    toExclusive: window.toExclusive,
    limit: operation.limit,
    subject,
  };
};

const inWindow = (value: string | null | undefined, query: JiraDeliveryQuery): boolean => {
  if (value == null) return false;
  const timestamp = Date.parse(value);
  return timestamp >= Date.parse(query.fromInclusive) && timestamp < Date.parse(query.toExclusive);
};
const jiraDate = (value: string): string => value.replace("T", " ").slice(0, 16);
const headers = (configuration: JiraDeliveryQueryConfiguration) => ({
  Authorization: `Basic ${btoa(`${configuration.email}:${configuration.apiToken}`)}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});
const requestJson = async <Value>(
  configuration: JiraDeliveryQueryConfiguration,
  path: string,
  init?: RequestInit,
): Promise<Value> => {
  const response = await (configuration.fetcher ?? fetch)(new URL(path, configuration.baseUrl), {
    ...init,
    headers: { ...headers(configuration), ...init?.headers },
    signal: AbortSignal.timeout(configuration.timeoutMs ?? 4_000),
  });
  if (!response.ok) throw new Error(`Jira delivery read failed with HTTP ${response.status}.`);
  return (await response.json()) as Value;
};

const issueUrl = (configuration: JiraDeliveryQueryConfiguration, key: string): string =>
  new URL(`/browse/${encodeURIComponent(key)}`, configuration.baseUrl).toString();
const issueSearchUrl = (
  configuration: JiraDeliveryQueryConfiguration,
  jql: string,
  purpose: JiraSupportedIntent,
): string => {
  const url = new URL("/issues/", configuration.baseUrl);
  url.searchParams.set("jql", jql);
  url.hash = purpose;
  return url.toString();
};
const issueTitle = (issue: JiraIssue): string =>
  issue.fields?.summary?.replace(/\s+/g, " ").trim() || issue.key || "Jira issue";
const issueOwner = (issue: JiraIssue | JiraLinkedIssue): string =>
  issue.fields?.assignee?.displayName?.trim() || "unassigned";
const issueOwnerReference = (issue: JiraIssue): DeliveryResultItem["owner"] | undefined => {
  const displayName = issue.fields?.assignee?.displayName?.trim();
  if (displayName === undefined || displayName === "") return undefined;
  const externalId = issue.fields?.assignee?.accountId?.trim();
  return {
    source: "jira",
    displayName,
    ...(externalId === undefined || externalId === "" ? {} : { externalId }),
  };
};
const issueAliases = (issue: JiraIssue): readonly string[] =>
  issue.fields?.components?.flatMap(({ name }) =>
    name === undefined || name.trim() === "" ? [] : [name.trim()],
  ) ?? [];
const issueStatus = (issue: JiraIssue | JiraLinkedIssue): string =>
  issue.fields?.status?.name?.trim() || "status unavailable";
const issueLifecycleState = (issue: JiraIssue | JiraLinkedIssue): DeliveryLifecycleState => {
  const status = issueStatus(issue).toLowerCase();
  const category = issue.fields?.status?.statusCategory?.key?.toLowerCase() ?? "";
  if (/cancel|won't do|wont do|declin|abandon/.test(status)) return "canceled";
  if (/block|imped|stuck/.test(status)) return "blocked";
  if (category === "done" || /done|closed|resolved|complete|delivered/.test(status)) return "done";
  if (category === "indeterminate" || /progress|review|testing|active/.test(status))
    return "active";
  if (category === "new" || /open|ready|planned|backlog|todo|to do/.test(status)) return "planned";
  return "unknown";
};
const issueProject = (issue: JiraIssue): string => issue.key?.split("-")[0] ?? "jira";

const baseItem = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issue: JiraIssue,
  kind: string,
  idSuffix: string,
  summary: string,
  occurredAt = issue.fields?.updated ?? query.fromInclusive,
  sprintPlanning?: Partial<NonNullable<DeliveryResultItem["planning"]>>,
): DeliveryResultItem | undefined => {
  if (issue.key === undefined) return undefined;
  const sprint = sprintValues(issue)
    .toSorted(
      (left, right) =>
        Date.parse(right.endDate ?? right.completeDate ?? "") -
        Date.parse(left.endDate ?? left.completeDate ?? ""),
    )[0]
    ?.name?.trim();
  const labels = issue.fields?.labels?.map((label) => label.toLowerCase()) ?? [];
  return {
    id: `jira:${issue.key}:${idSuffix}`,
    source: "jira",
    workspaceId: query.workspaceId,
    selector: query.operation.select,
    intent: query.operation.purpose,
    title: issueTitle(issue),
    summary,
    citationUrl: issueUrl(configuration, issue.key),
    observedAt: occurredAt,
    lifecycleState: issueLifecycleState(issue),
    subjectAliases: issueAliases(issue),
    owner: issueOwnerReference(issue),
    planning: {
      externalKey: issue.key,
      status: issueStatus(issue),
      ...(sprint === undefined || sprint === "" ? {} : { sprint }),
      hasDependency: (issue.fields?.issuelinks ?? []).some((link) =>
        /block|depend|require|wait/i.test(`${link.type?.inward ?? ""} ${link.type?.outward ?? ""}`),
      ),
      hasAcceptanceInformation: labels.some((label) =>
        /stakeholder-accept|client-accept|owner-accept|approved|signed-off/.test(label),
      ),
      ...sprintPlanning,
    },
    sensitivity: configuration.sensitivity ?? "internal",
    authority: configuration.authority ?? 0.95,
    dedupeKey: `jira:${issue.key}:${kind}:${idSuffix}`,
  };
};

const transitionSummary = (history: JiraHistory | undefined): string | undefined => {
  const tracked = new Set(["status", "assignee", "resolution", "priority", "sprint"]);
  const changes = (history?.items ?? []).flatMap((item) => {
    const field = item.field?.toLowerCase();
    if (field === undefined || !tracked.has(field)) return [];
    return [`${field} ${item.fromString?.trim() || "unset"} → ${item.toString?.trim() || "unset"}`];
  });
  return changes.length === 0 ? undefined : changes.slice(0, 2).join(", ");
};
const readIssueHistory = async (
  configuration: JiraDeliveryQueryConfiguration,
  issueKey: string,
): Promise<readonly JiraHistory[]> => {
  const histories: JiraHistory[] = [];
  let startAt = 0;
  const pageSize = 100;
  while (histories.length < 2_000) {
    const page = await requestJson<JiraChangelogResponse>(
      configuration,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=${pageSize}`,
    );
    const values = page.values ?? [];
    histories.push(...values);
    if (values.length < pageSize) break;
    startAt += values.length;
  }
  return histories;
};

const discoverSprintFieldId = async (
  configuration: JiraDeliveryQueryConfiguration,
): Promise<string> => {
  const page = await requestJson<JiraFieldSearchResponse>(
    configuration,
    "/rest/api/3/field/search?type=custom&query=Sprint&maxResults=50",
  );
  const fields = page.values ?? [];
  const sprintField =
    fields.find(({ schema }) => schema?.custom?.endsWith(":gh-sprint") === true) ??
    fields.find(({ name }) => name?.trim().toLowerCase() === "sprint");
  if (sprintField?.id === undefined || !/^customfield_\d+$/.test(sprintField.id))
    throw new Error("Jira Sprint field is unavailable.");
  return sprintField.id;
};

const sprintValues = (issue: JiraIssue): readonly JiraSprint[] =>
  Object.values(issue.fields ?? {}).flatMap((value) => {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (candidate): candidate is JiraSprint =>
        typeof candidate === "object" &&
        candidate !== null &&
        ("state" in candidate || "startDate" in candidate || "endDate" in candidate) &&
        ("id" in candidate || "name" in candidate),
    );
  });

const sprintReference = (sprint: JiraSprint | undefined): DeliverySprintReference | undefined => {
  const name = sprint?.name?.trim();
  if (name === undefined || name === "") return undefined;
  const state = sprint?.state?.toLowerCase();
  return {
    ...(sprint?.id === undefined ? {} : { id: String(sprint.id) }),
    name,
    state: state === "active" || state === "closed" || state === "future" ? state : "unknown",
    ...(sprint?.startDate === undefined ? {} : { startAt: sprint.startDate }),
    ...(sprint?.endDate === undefined ? {} : { endAt: sprint.endDate }),
    ...(sprint?.completeDate === undefined ? {} : { completeAt: sprint.completeDate }),
  };
};

const latestSprint = (issue: JiraIssue, state: "active" | "closed"): JiraSprint | undefined =>
  sprintValues(issue)
    .filter((sprint) => sprint.state?.toLowerCase() === state)
    .toSorted(
      (left, right) =>
        Date.parse(right.completeDate ?? right.endDate ?? right.startDate ?? "") -
        Date.parse(left.completeDate ?? left.endDate ?? left.startDate ?? ""),
    )[0];

const inSprintWindow = (value: string | null | undefined, sprint: JiraSprint): boolean => {
  if (value == null || sprint.startDate === undefined || sprint.endDate === undefined) return false;
  const timestamp = Date.parse(value);
  return timestamp >= Date.parse(sprint.startDate) && timestamp < Date.parse(sprint.endDate);
};

const planningForSprint = (
  issue: JiraIssue,
  histories: readonly JiraHistory[],
  perspective: "previous" | "current",
): Partial<NonNullable<DeliveryResultItem["planning"]>> => {
  const previous = latestSprint(issue, "closed");
  const current = latestSprint(issue, "active");
  const completedDuringPrevious =
    previous !== undefined &&
    (inSprintWindow(issue.fields?.resolutiondate, previous) ||
      histories.some(
        (history) =>
          inSprintWindow(history.created, previous) &&
          (history.items ?? []).some(
            (change) =>
              change.field?.toLowerCase() === "status" &&
              /done|closed|resolved|complete|delivered/i.test(change.toString ?? ""),
          ),
      ));
  const addedDuringPrevious =
    previous !== undefined &&
    (inSprintWindow(issue.fields?.created, previous) ||
      histories.some(
        (history) =>
          inSprintWindow(history.created, previous) &&
          (history.items ?? []).some(
            (change) =>
              change.field?.toLowerCase() === "sprint" &&
              (change.toString ?? "").includes(previous.name ?? "") &&
              !(change.fromString ?? "").includes(previous.name ?? ""),
          ),
      ));
  const plannedAtPreviousStart =
    previous !== undefined &&
    previous.startDate !== undefined &&
    !addedDuringPrevious &&
    ((issue.fields?.created !== undefined &&
      Date.parse(issue.fields.created) <= Date.parse(previous.startDate)) ||
      histories.some(
        (history) =>
          history.created !== undefined &&
          Date.parse(history.created) <= Date.parse(previous.startDate ?? "") &&
          (history.items ?? []).some(
            (change) =>
              change.field?.toLowerCase() === "sprint" &&
              (change.toString ?? "").includes(previous.name ?? "") &&
              !(change.fromString ?? "").includes(previous.name ?? ""),
          ),
      ));
  const rolledIntoCurrent =
    previous !== undefined &&
    current !== undefined &&
    !completedDuringPrevious &&
    issueLifecycleState(issue) !== "canceled";
  const classifications: DeliverySprintClassification[] = [];
  if (perspective === "previous" && previous !== undefined) {
    if (addedDuringPrevious) classifications.push("added_during_sprint");
    else if (plannedAtPreviousStart) classifications.push("planned_at_start");
    if (completedDuringPrevious) classifications.push("completed_during_sprint");
    else if (rolledIntoCurrent) classifications.push("rolled_into_current");
    else classifications.push("dropped");
  }
  if (perspective === "current" && current !== undefined) {
    classifications.push("current_sprint");
    if (rolledIntoCurrent) classifications.push("rolled_into_current");
  }
  return {
    ...(previous === undefined ? {} : { previousSprint: sprintReference(previous) }),
    ...(current === undefined ? {} : { currentSprint: sprintReference(current) }),
    sprintClassifications: classifications,
  };
};

const escapedJqlText = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const statusTargetClause = (query: JiraDeliveryQuery): string => {
  const exactKey = query.operation.predicates?.find(
    ({ field, operator, value }) =>
      field === "externalKey" && operator === "equals" && typeof value === "string",
  )?.value;
  if (typeof exactKey === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(exactKey))
    return ` AND key = "${exactKey}"`;
  const titleTarget = query.operation.predicates?.find(
    ({ field, operator, value }) =>
      field === "title" && operator === "contains" && typeof value === "string",
  )?.value;
  return typeof titleTarget === "string" && titleTarget.trim() !== ""
    ? ` AND summary ~ "\\"${escapedJqlText(titleTarget.trim())}\\""`
    : "";
};

const ownershipTargetClause = (query: JiraDeliveryQuery): string => {
  const externalKey = query.subject?.externalKey?.trim();
  if (externalKey !== undefined && /^[A-Z][A-Z0-9]+-\d+$/.test(externalKey))
    return ` AND key = "${externalKey}"`;
  const phrase = query.subject?.phrase?.trim();
  return phrase === undefined || phrase === ""
    ? ""
    : ` AND (component = "${escapedJqlText(phrase)}" OR summary ~ "\\"${escapedJqlText(phrase)}\\"")`;
};

const jqlForView = (
  view: JiraSupportedIntent,
  projects: string,
  query: JiraDeliveryQuery,
): string => {
  const scope = `project in (${projects})`;
  switch (view) {
    case "activity":
      return `${scope} AND updated >= "${jiraDate(query.fromInclusive)}" AND updated < "${jiraDate(query.toExclusive)}" ORDER BY updated DESC`;
    case "dependencies":
    case "blockers":
      return `${scope} AND sprint in openSprints() AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case "current_work":
      return query.operation.time?.kind === "jira_sprint"
        ? `${scope} AND sprint in openSprints() ORDER BY priority DESC, updated DESC`
        : `${scope} AND sprint in openSprints() AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case "commitments":
      return `${scope} AND sprint in closedSprints() ORDER BY updated DESC`;
    case "ownership":
      return `${scope}${ownershipTargetClause(query)} AND statusCategory != Done ORDER BY updated DESC`;
    case "next_actions":
      return `${scope} AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case "delivered":
      return query.operation.time?.kind === "jira_sprint" &&
        query.operation.time.sprint === "previous"
        ? `${scope} AND sprint in closedSprints() ORDER BY updated DESC`
        : `${scope} AND statusCategory = Done AND resolutiondate >= "${jiraDate(query.fromInclusive)}" AND resolutiondate < "${jiraDate(query.toExclusive)}" ORDER BY resolutiondate DESC`;
    case "risks":
      return `${scope} AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case "recurring":
      return `${scope} AND created >= "${jiraDate(query.fromInclusive)}" ORDER BY created DESC`;
    case "status":
      return `${scope}${statusTargetClause(query)} ORDER BY updated DESC`;
  }
};

const searchIssues = async (
  configuration: JiraDeliveryQueryConfiguration,
  jql: string,
  limit: number,
  sprintFieldId?: string,
): Promise<JiraSearchResult> => {
  const issues: JiraIssue[] = [];
  const seenPageTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let exhausted = false;
  while (issues.length < limit) {
    const page = await requestJson<JiraSearchResponse>(configuration, "/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql,
        fields: [
          "summary",
          "created",
          "updated",
          "resolutiondate",
          "status",
          "assignee",
          "priority",
          "issuetype",
          "labels",
          "components",
          "issuelinks",
          ...(sprintFieldId === undefined ? [] : [sprintFieldId]),
        ],
        maxResults: Math.min(100, limit - issues.length),
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
      }),
    });
    issues.push(...(page.issues ?? []));
    if (
      page.nextPageToken === undefined ||
      page.nextPageToken === "" ||
      (page.issues ?? []).length === 0
    ) {
      exhausted = true;
      break;
    }
    if (seenPageTokens.has(page.nextPageToken)) break;
    seenPageTokens.add(page.nextPageToken);
    nextPageToken = page.nextPageToken;
  }
  return { issues: issues.slice(0, limit), exhausted };
};

const negativeRelationshipCoverageItem = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  jql: string,
  inspectedCount: number,
): DeliveryResultItem => {
  const purpose = query.operation.purpose;
  const summary =
    purpose === "dependencies"
      ? `No explicit dependency or waiting relationship was recorded across ${inspectedCount} active-sprint Jira issues.`
      : `No blocked status, blocker label, or blocking issue link was recorded across ${inspectedCount} active-sprint Jira issues.`;
  return {
    id: `jira:coverage:${purpose}`,
    source: "jira",
    workspaceId: query.workspaceId,
    selector: query.operation.select,
    intent: purpose,
    title: purpose === "dependencies" ? "Jira dependency coverage" : "Jira blocker coverage",
    summary,
    citationUrl: issueSearchUrl(configuration, jql, purpose),
    observedAt: query.requestedAt,
    lifecycleState: "unknown",
    sensitivity: configuration.sensitivity ?? "internal",
    authority: configuration.authority ?? 0.95,
    dedupeKey: `jira:coverage:${purpose}`,
  };
};

const activityItems = async (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): Promise<readonly DeliveryResultItem[]> => {
  const histories = await Promise.allSettled(
    issues.map((issue) => readIssueHistory(configuration, issue.key ?? "")),
  );
  return issues.flatMap((issue, index) => {
    if (issue.fields?.updated === undefined || !inWindow(issue.fields.updated, query)) return [];
    const historyResult = histories[index];
    const history = (historyResult?.status === "fulfilled" ? historyResult.value : [])
      .filter((candidate) => inWindow(candidate.created, query))
      .sort((left, right) => Date.parse(right.created ?? "") - Date.parse(left.created ?? ""))[0];
    const transition = transitionSummary(history);
    const item = baseItem(
      configuration,
      query,
      issue,
      transition === undefined ? "issue_update" : "issue_transition",
      history?.id ?? issue.fields.updated,
      transition === undefined
        ? `${issue.key} updated (${issueStatus(issue)}): ${issueTitle(issue)}`
        : `${issue.key} ${transition}: ${issueTitle(issue)}`,
      history?.created ?? issue.fields.updated,
    );
    return item === undefined ? [] : [item];
  });
};

const dependencyItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  issues.flatMap((issue) =>
    (issue.fields?.issuelinks ?? []).flatMap((link, index) => {
      const inwardLabel = link.type?.inward?.toLowerCase() ?? "";
      const outwardLabel = link.type?.outward?.toLowerCase() ?? "";
      let waiting = issue;
      let dependency: JiraLinkedIssue | undefined;
      if (link.inwardIssue !== undefined && /block|depend|require|wait/.test(inwardLabel)) {
        dependency = link.inwardIssue;
      } else if (
        link.outwardIssue !== undefined &&
        /block|depend|require|wait/.test(outwardLabel)
      ) {
        waiting = link.outwardIssue;
        dependency = issue;
      }
      if (waiting.key === undefined || dependency?.key === undefined) return [];
      const item = baseItem(
        configuration,
        query,
        waiting,
        "dependency_wait",
        `dependency-${index}-${dependency.key}`,
        `${waiting.key} (${issueOwner(waiting)}) waits on ${dependency.key} (${issueOwner(dependency)}): ${issueTitle(waiting)}`,
      );
      return item === undefined ? [] : [item];
    }),
  );

const blockedItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  issues.flatMap((issue) => {
    const labels = issue.fields?.labels?.map((label) => label.toLowerCase()) ?? [];
    const blockedByLink = (issue.fields?.issuelinks ?? []).some(
      (link) =>
        link.inwardIssue !== undefined && /block/.test(link.type?.inward?.toLowerCase() ?? ""),
    );
    if (
      !/blocked|impediment|stuck/i.test(issueStatus(issue)) &&
      !labels.some((label) => /blocked|impediment|stuck/.test(label)) &&
      !blockedByLink
    )
      return [];
    const item = baseItem(
      configuration,
      query,
      issue,
      "blocked_work",
      "blocked",
      `${issue.key} is blocked — owner ${issueOwner(issue)}: ${issueTitle(issue)}`,
    );
    return item === undefined ? [] : [item];
  });

const deliveredItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] => {
  let selected = issues;
  if (query.operation.time?.kind === "jira_sprint" && query.operation.time.sprint === "previous") {
    const latestSprint = issues
      .flatMap(sprintValues)
      .filter((sprint) => sprint.state?.toLowerCase() === "closed")
      .sort(
        (left, right) =>
          Date.parse(right.completeDate ?? right.endDate ?? "") -
          Date.parse(left.completeDate ?? left.endDate ?? ""),
      )[0];
    if (latestSprint?.id !== undefined)
      selected = issues.filter((issue) =>
        sprintValues(issue).some((sprint) => sprint.id === latestSprint.id),
      );
  }
  return selected.flatMap((issue) => {
    const item = baseItem(
      configuration,
      query,
      issue,
      "delivered_item",
      "delivered",
      `${issue.key} delivered by ${issueOwner(issue)}: ${issueTitle(issue)}`,
      issue.fields?.resolutiondate ?? issue.fields?.updated,
    );
    return item === undefined ? [] : [item];
  });
};

const sprintItems = async (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
  perspective: "previous" | "current",
  historyFor: (issueKey: string) => Promise<readonly JiraHistory[]>,
): Promise<readonly DeliveryResultItem[]> => {
  const targetState = perspective === "previous" ? "closed" : "active";
  const targetSprint = issues
    .flatMap((issue) => sprintValues(issue))
    .filter((sprint) => sprint.state?.toLowerCase() === targetState)
    .toSorted(
      (left, right) =>
        Date.parse(right.completeDate ?? right.endDate ?? right.startDate ?? "") -
        Date.parse(left.completeDate ?? left.endDate ?? left.startDate ?? ""),
    )[0];
  const selected =
    targetSprint?.id === undefined
      ? issues
      : issues.filter((issue) =>
          sprintValues(issue).some((sprint) => sprint.id === targetSprint.id),
        );
  const histories = await Promise.all(selected.map((issue) => historyFor(issue.key ?? "")));
  return selected.flatMap((issue, index) => {
    const planning = planningForSprint(issue, histories[index] ?? [], perspective);
    if (
      query.operation.purpose === "delivered" &&
      !planning.sprintClassifications?.includes("completed_during_sprint")
    )
      return [];
    const summaryPrefix =
      query.operation.purpose === "commitments"
        ? "planned"
        : query.operation.purpose === "current_work"
          ? issueStatus(issue)
          : "completed";
    const item = baseItem(
      configuration,
      query,
      issue,
      `sprint_${query.operation.purpose}`,
      perspective,
      `${issue.key} ${summaryPrefix} — ${issueOwner(issue)}: ${issueTitle(issue)}`,
      issue.fields?.resolutiondate ?? issue.fields?.updated,
      planning,
    );
    return item === undefined ? [] : [item];
  });
};

const currentWorkItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  issues.flatMap((issue) => {
    const item = baseItem(
      configuration,
      query,
      issue,
      "current_work",
      "current",
      `${issueOwner(issue)} — ${issue.key} ${issueStatus(issue)}: ${issueTitle(issue)}`,
    );
    return item === undefined ? [] : [item];
  });

const ownershipItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  issues.flatMap((issue) => {
    const owner = issue.fields?.assignee?.displayName?.trim();
    if (owner === undefined || owner === "") return [];
    const item = baseItem(
      configuration,
      query,
      issue,
      "practical_ownership",
      "practical-owner",
      `Practical ownership signal — ${owner} is assigned to ${issue.key}: ${issueTitle(issue)}`,
    );
    return item === undefined ? [] : [item];
  });

const nextActionItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  issues.flatMap((issue) => {
    const item = baseItem(
      configuration,
      query,
      issue,
      "next_action",
      "next",
      `${issueOwner(issue)} — ${issue.key} ${issueStatus(issue)}: ${issueTitle(issue)}`,
    );
    return item === undefined ? [] : [item];
  });

const riskScore = (issue: JiraIssue): number => {
  const priority = issue.fields?.priority?.name?.toLowerCase() ?? "";
  const labels = issue.fields?.labels?.map((label) => label.toLowerCase()) ?? [];
  const status = issueStatus(issue).toLowerCase();
  return (
    (priority === "highest" ? 5 : priority === "high" ? 4 : priority === "medium" ? 2 : 0) +
    (labels.some((label) => /risk|blocker|critical/.test(label)) ? 4 : 0) +
    (/blocked|impediment/.test(status) ? 4 : 0)
  );
};
const riskItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] =>
  [...issues]
    .filter((issue) => riskScore(issue) > 0)
    .sort((left, right) => riskScore(right) - riskScore(left))
    .flatMap((issue) => {
      const item = baseItem(
        configuration,
        query,
        issue,
        "risk",
        `risk-${riskScore(issue)}`,
        `${issue.key} risk (${issue.fields?.priority?.name ?? issueStatus(issue)}) — ${issueOwner(issue)}: ${issueTitle(issue)}`,
      );
      return item === undefined ? [] : [item];
    });

const recurringSignature = (issue: JiraIssue): string => {
  const ignored = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "in",
    "on",
    "with",
    "issue",
    "bug",
    "fix",
  ]);
  const words = issueTitle(issue)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g)
    ?.filter((word) => !ignored.has(word))
    .slice(0, 4);
  const component = issue.fields?.components?.[0]?.name?.toLowerCase();
  return [component, ...(words ?? [])].filter(Boolean).join("|");
};
const recurringItems = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issues: readonly JiraIssue[],
): readonly DeliveryResultItem[] => {
  const groups = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    const signature = recurringSignature(issue);
    if (signature === "") continue;
    groups.set(signature, [...(groups.get(signature) ?? []), issue]);
  }
  return [...groups.entries()]
    .filter(([, matches]) => matches.length >= 2)
    .sort((left, right) => right[1].length - left[1].length)
    .flatMap(([signature, matches]) => {
      const latest = [...matches].sort(
        (left, right) =>
          Date.parse(right.fields?.updated ?? "") - Date.parse(left.fields?.updated ?? ""),
      )[0];
      if (latest === undefined) return [];
      const keys = matches
        .flatMap((issue) => (issue.key === undefined ? [] : [issue.key]))
        .slice(0, 4);
      const item = baseItem(
        configuration,
        query,
        latest,
        "recurring_pattern",
        `recurring-${signature}`,
        `Recurring pattern across ${matches.length} issues: ${keys.join(", ")} — ${issueTitle(latest)}`,
      );
      return item === undefined ? [] : [item];
    });
};

export const createJiraDeliveryQuerySource = (
  configuration: JiraDeliveryQueryConfiguration,
): DeliveryQuerySource => ({
  source: "jira",
  selectors: ["objects", "relations", "observations"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        const sensitivity = configuration.sensitivity ?? "internal";
        if (
          context.workspaceId !== configuration.workspaceId ||
          !configuration.allowedActorIds.has(context.actorId) ||
          !isSensitivityAtOrBelow(sensitivity, context.maximumSensitivity) ||
          configuration.projectKeys.length === 0 ||
          configuration.projectKeys.length > 10 ||
          configuration.projectKeys.some((key) => !/^[A-Z][A-Z0-9]+$/.test(key))
        )
          return { items: [], conflicts: [], unavailableSources: [], complete: true };
        const projects = configuration.projectKeys.map((key) => `"${key}"`).join(", ");
        const queries = plan.operations.flatMap((operation) => {
          if (!supportedSelectors.has(operation.select) || !operationAllowsJira(operation))
            return [];
          const query = asJiraQuery(context, operation, plan.subject);
          return query === undefined ? [] : [query];
        });
        const needsSprintProjection = queries.some(
          ({ operation }) => operation.time?.kind === "jira_sprint",
        );
        const sprintFieldId = needsSprintProjection
          ? await discoverSprintFieldId(configuration)
          : undefined;
        const searches = await Promise.all(
          queries.map(async (query) => {
            const jql = jqlForView(query.operation.purpose, projects, query);
            const result = await searchIssues(
              configuration,
              jql,
              query.operation.purpose === "recurring" ||
                query.operation.purpose === "dependencies" ||
                query.operation.purpose === "blockers"
                ? Math.min(query.limit * 40, 500)
                : Math.min(query.limit * 3, 50),
              query.operation.time?.kind === "jira_sprint" ? sprintFieldId : undefined,
            );
            return { query, jql, ...result };
          }),
        );
        const historyCache = new Map<string, Promise<readonly JiraHistory[]>>();
        const historyFor = (issueKey: string): Promise<readonly JiraHistory[]> => {
          const existing = historyCache.get(issueKey);
          if (existing !== undefined) return existing;
          const pending = readIssueHistory(configuration, issueKey);
          historyCache.set(issueKey, pending);
          return pending;
        };
        const items = await Promise.all(
          searches.map(async ({ query, jql, issues, exhausted }) => {
            const connectedIssues = issues.filter(
              (issue) =>
                issue.key !== undefined && configuration.projectKeys.includes(issueProject(issue)),
            );
            const selected = await (async () => {
              switch (query.operation.purpose) {
                case "activity":
                  return activityItems(configuration, query, connectedIssues);
                case "dependencies":
                  return dependencyItems(configuration, query, connectedIssues);
                case "blockers":
                  return blockedItems(configuration, query, connectedIssues);
                case "commitments":
                  return sprintItems(configuration, query, connectedIssues, "previous", historyFor);
                case "delivered":
                  return query.operation.time?.kind === "jira_sprint"
                    ? sprintItems(configuration, query, connectedIssues, "previous", historyFor)
                    : deliveredItems(configuration, query, connectedIssues);
                case "current_work":
                  return query.operation.time?.kind === "jira_sprint"
                    ? sprintItems(configuration, query, connectedIssues, "current", historyFor)
                    : currentWorkItems(configuration, query, connectedIssues);
                case "ownership":
                  return ownershipItems(configuration, query, connectedIssues);
                case "next_actions":
                  return nextActionItems(configuration, query, connectedIssues);
                case "risks":
                  return riskItems(configuration, query, connectedIssues);
                case "recurring":
                  return recurringItems(configuration, query, connectedIssues);
                case "status":
                  return currentWorkItems(
                    configuration,
                    query,
                    [...connectedIssues].sort((left, right) => {
                      const priority: Readonly<Record<DeliveryLifecycleState, number>> = {
                        blocked: 0,
                        active: 1,
                        planned: 2,
                        unknown: 3,
                        done: 4,
                        canceled: 5,
                      };
                      return (
                        (priority[issueLifecycleState(left)] ?? 6) -
                          (priority[issueLifecycleState(right)] ?? 6) ||
                        Date.parse(right.fields?.updated ?? "") -
                          Date.parse(left.fields?.updated ?? "")
                      );
                    }),
                  );
              }
            })();
            return selected.length === 0 &&
              exhausted &&
              (query.operation.purpose === "dependencies" || query.operation.purpose === "blockers")
              ? [
                  negativeRelationshipCoverageItem(
                    configuration,
                    query,
                    jql,
                    connectedIssues.length,
                  ),
                ]
              : selected;
          }),
        );
        const seen = new Set<string>();
        const counts = new Map<string, number>();
        const limits = new Map<string, number>(
          queries.map((query) => [query.operation.purpose, query.operation.limit]),
        );
        const selected = items.flat().filter((item) => {
          const key = `${item.intent}:${item.id}`;
          if (seen.has(key)) return false;
          const count = counts.get(item.intent) ?? 0;
          if (count >= (limits.get(item.intent) ?? 0)) return false;
          seen.add(key);
          counts.set(item.intent, count + 1);
          return true;
        });
        return { items: selected, conflicts: [], unavailableSources: [], complete: true };
      },
      catch: () =>
        new RepositoryError({
          message: "Connected Jira delivery information is unavailable.",
          operation: "delivery-query-jira",
        }),
    }),
});
