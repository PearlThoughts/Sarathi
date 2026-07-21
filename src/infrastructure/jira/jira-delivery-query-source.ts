import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";

type JiraSupportedIntent =
  | "activity"
  | "dependencies"
  | "blockers"
  | "delivered"
  | "current_work"
  | "risks"
  | "recurring"
  | "status";

type JiraDeliveryQuery = DeliveryQueryContext & {
  readonly operation: DeliveryQueryOperation & { readonly purpose: JiraSupportedIntent };
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly limit: number;
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
type JiraSearchResponse = { readonly issues?: readonly JiraIssue[] };
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
  "delivered",
  "current_work",
  "risks",
  "recurring",
  "status",
]);
const supportedSelectors = new Set<DeliveryQueryOperation["select"]>([
  "objects",
  "relations",
  "observations",
]);

const asJiraQuery = (
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
): JiraDeliveryQuery | undefined => {
  if (!supportedIntents.has(operation.purpose as JiraSupportedIntent)) return undefined;
  const dayEnd = new Date(context.requestedAt);
  const defaultEnd = new Date(dayEnd.getTime() + 86_400_000).toISOString();
  const window =
    operation.time === undefined || operation.time.kind === "jira_sprint"
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
const issueTitle = (issue: JiraIssue): string =>
  issue.fields?.summary?.replace(/\s+/g, " ").trim() || issue.key || "Jira issue";
const issueOwner = (issue: JiraIssue | JiraLinkedIssue): string =>
  issue.fields?.assignee?.displayName?.trim() || "unassigned";
const issueStatus = (issue: JiraIssue | JiraLinkedIssue): string =>
  issue.fields?.status?.name?.trim() || "status unavailable";
const issueProject = (issue: JiraIssue): string => issue.key?.split("-")[0] ?? "jira";

const baseItem = (
  configuration: JiraDeliveryQueryConfiguration,
  query: JiraDeliveryQuery,
  issue: JiraIssue,
  kind: string,
  idSuffix: string,
  summary: string,
  occurredAt = issue.fields?.updated ?? query.fromInclusive,
): DeliveryResultItem | undefined =>
  issue.key === undefined
    ? undefined
    : {
        id: `jira:${issue.key}:${idSuffix}`,
        source: "jira",
        workspaceId: query.workspaceId,
        selector: query.operation.select,
        intent: query.operation.purpose,
        title: issueTitle(issue),
        summary,
        citationUrl: issueUrl(configuration, issue.key),
        observedAt: occurredAt,
        sensitivity: configuration.sensitivity ?? "internal",
        authority: configuration.authority ?? 0.95,
        dedupeKey: `jira:${issue.key}:${kind}:${idSuffix}`,
      };

const transitionSummary = (history: JiraHistory | undefined): string | undefined => {
  const tracked = new Set(["status", "assignee", "resolution", "priority"]);
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
): Promise<readonly JiraHistory[]> =>
  (
    await requestJson<JiraChangelogResponse>(
      configuration,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=0&maxResults=20`,
    )
  ).values ?? [];

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
    case "current_work":
      return `${scope} AND sprint in openSprints() AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case "delivered":
      return query.operation.time?.kind === "jira_sprint" &&
        query.operation.time.sprint === "previous"
        ? `${scope} AND sprint in closedSprints() AND statusCategory = Done ORDER BY resolutiondate DESC`
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
): Promise<readonly JiraIssue[]> =>
  (
    await requestJson<JiraSearchResponse>(configuration, "/rest/api/3/search/jql", {
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
          "sprint",
        ],
        maxResults: limit,
      }),
    })
  ).issues ?? [];

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
          if (!supportedSelectors.has(operation.select)) return [];
          const query = asJiraQuery(context, operation);
          return query === undefined ? [] : [query];
        });
        const searches = await Promise.all(
          queries.map(async (query) => ({
            query,
            issues: await searchIssues(
              configuration,
              jqlForView(query.operation.purpose, projects, query),
              Math.min(
                query.operation.purpose === "recurring" ? query.limit * 10 : query.limit * 3,
                50,
              ),
            ),
          })),
        );
        const items = await Promise.all(
          searches.map(async ({ query, issues }) => {
            const connectedIssues = issues.filter(
              (issue) =>
                issue.key !== undefined && configuration.projectKeys.includes(issueProject(issue)),
            );
            switch (query.operation.purpose) {
              case "activity":
                return activityItems(configuration, query, connectedIssues);
              case "dependencies":
                return dependencyItems(configuration, query, connectedIssues);
              case "blockers":
                return blockedItems(configuration, query, connectedIssues);
              case "delivered":
                return deliveredItems(configuration, query, connectedIssues);
              case "current_work":
                return currentWorkItems(configuration, query, connectedIssues);
              case "risks":
                return riskItems(configuration, query, connectedIssues);
              case "recurring":
                return recurringItems(configuration, query, connectedIssues);
              case "status":
                return currentWorkItems(configuration, query, connectedIssues);
            }
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
