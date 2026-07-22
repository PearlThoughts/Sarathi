import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryObjectDraft,
  type DeliveryObjectKind,
  type DeliveryObjectRef,
  type DeliveryProjection,
  type DeliveryRelationDraft,
  isFinanceAttributeKey,
} from "../../modules/delivery-intelligence/index.ts";
import {
  createTypedPassage,
  type KnowledgeAclRule,
  type KnowledgePassageDraft,
  type KnowledgeSourceDocument,
  type KnowledgeSourceReader,
} from "../../modules/knowledge-layer/index.ts";

type JiraIssue = {
  readonly id: string;
  readonly key: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

type JiraChangelogItem = {
  readonly field?: string;
  readonly fromString?: string | null;
  readonly toString?: string | null;
};

type JiraChangelogHistory = {
  readonly id?: string;
  readonly created?: string;
  readonly author?: {
    readonly accountId?: string;
    readonly displayName?: string;
  };
  readonly items?: readonly JiraChangelogItem[];
};

type JiraChangelogPage = {
  readonly values?: readonly JiraChangelogHistory[];
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
  readonly isLast?: boolean;
};

type JiraIncrementalCursor = {
  readonly version: 1;
  readonly updatedAt: string;
  readonly issueKey: string;
};

type JiraSearchPage = {
  readonly issues?: readonly JiraIssue[] | undefined;
  readonly nextPageToken?: string | undefined;
  readonly isLast?: boolean | undefined;
};

type JiraComment = {
  readonly id: string;
  readonly body?: unknown;
  readonly created?: string;
  readonly updated?: string;
  readonly author?: {
    readonly accountId?: string;
    readonly displayName?: string;
  };
};

type JiraCommentPage = {
  readonly comments?: readonly JiraComment[] | undefined;
  readonly startAt?: number | undefined;
  readonly maxResults?: number | undefined;
  readonly total?: number | undefined;
};

type JiraProject = {
  readonly id?: string;
  readonly key?: string;
  readonly name?: string;
  readonly description?: unknown;
  readonly projectTypeKey?: string;
};

type JiraField = {
  readonly id?: string;
  readonly name?: string;
  readonly custom?: boolean;
  readonly schema?: Readonly<Record<string, unknown>>;
};

type JiraBoard = { readonly id?: number; readonly name?: string; readonly type?: string };
type JiraBoardPage = { readonly values?: readonly JiraBoard[] };
type JiraBoardConfiguration = {
  readonly id?: number;
  readonly name?: string;
  readonly columnConfig?: {
    readonly columns?: readonly {
      readonly name?: string;
      readonly statuses?: readonly { readonly id?: string }[];
    }[];
  };
};
type JiraSprint = {
  readonly id?: number;
  readonly name?: string;
  readonly state?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly completeDate?: string;
};
type JiraSprintPage = {
  readonly values?: readonly JiraSprint[];
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
  readonly isLast?: boolean;
};

export type JiraKnowledgeSourceConfiguration = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly projectKey: string;
  readonly jql: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly acl: readonly KnowledgeAclRule[];
  readonly sensitivity: SensitivityTier;
  readonly authority?: number | undefined;
  readonly boardId?: number | undefined;
  readonly cursorOverlapSeconds?: number | undefined;
  readonly fetcher?: typeof fetch | undefined;
};

const plainText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join("; ");
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.displayName === "string") return record.displayName;
  if (typeof record.name === "string") return record.name;
  if (typeof record.value === "string") return record.value;
  return Object.entries(record)
    .filter(([key]) => !["self", "avatarUrls", "iconUrl", "type", "version", "attrs"].includes(key))
    .map(([, entry]) => plainText(entry))
    .filter(Boolean)
    .join(" ");
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const encodeCursor = (cursor: JiraIncrementalCursor): string =>
  `jira-v1:${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;

const parseCursor = (value: string): JiraIncrementalCursor => {
  if (value.startsWith("jira-v1:")) {
    const parsed = JSON.parse(
      Buffer.from(value.slice("jira-v1:".length), "base64url").toString("utf8"),
    ) as JiraIncrementalCursor | undefined;
    if (
      parsed?.version === 1 &&
      Number.isFinite(Date.parse(parsed.updatedAt)) &&
      typeof parsed.issueKey === "string"
    )
      return parsed;
  }
  if (Number.isFinite(Date.parse(value))) return { version: 1, updatedAt: value, issueKey: "" };
  throw new Error("Jira incremental cursor is invalid.");
};

const jiraTimestamp = (value: string): string =>
  new Date(value).toISOString().replace("T", " ").slice(0, 16);

const boundedJql = (
  configuration: JiraKnowledgeSourceConfiguration,
  previousCursor?: string,
): string => {
  if (!/^[A-Z][A-Z0-9]+$/.test(configuration.projectKey))
    throw new Error("Jira knowledge project key is invalid.");
  const configuredJql = configuration.jql.trim();
  if (configuredJql === "") throw new Error("Jira knowledge JQL is required.");
  const incremental =
    previousCursor === undefined
      ? ""
      : ` AND updated >= "${jiraTimestamp(
          new Date(
            Date.parse(parseCursor(previousCursor).updatedAt) -
              (configuration.cursorOverlapSeconds ?? 300) * 1_000,
          ).toISOString(),
        )}"`;
  return `project = "${configuration.projectKey}" AND (${configuredJql})${incremental} ORDER BY updated ASC, key ASC`;
};

const headers = (configuration: JiraKnowledgeSourceConfiguration): HeadersInit => ({
  Authorization: `Basic ${Buffer.from(`${configuration.email}:${configuration.apiToken}`).toString("base64")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

const requestJson = async <Value>(
  configuration: JiraKnowledgeSourceConfiguration,
  path: string,
  init?: RequestInit,
): Promise<Value> => {
  const response = await (configuration.fetcher ?? fetch)(new URL(path, configuration.baseUrl), {
    ...init,
    headers: { ...headers(configuration), ...init?.headers },
  });
  if (!response.ok) throw new Error(`Jira knowledge read failed with HTTP ${response.status}.`);
  return (await response.json()) as Value;
};

const readIssues = async (
  configuration: JiraKnowledgeSourceConfiguration,
  previousCursor?: string,
): Promise<readonly JiraIssue[]> => {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page: JiraSearchPage = await requestJson(configuration, "/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: boundedJql(configuration, previousCursor),
        fields: Object.keys(configuration.fields),
        maxResults: 100,
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
      }),
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast === true ? undefined : page.nextPageToken;
    if (page.isLast !== true && nextPageToken === undefined)
      throw new Error("Jira knowledge pagination ended without an explicit last page.");
  } while (nextPageToken !== undefined);
  return issues;
};

const readChangelog = async (
  configuration: JiraKnowledgeSourceConfiguration,
  issueKey: string,
): Promise<readonly JiraChangelogHistory[]> => {
  const histories: JiraChangelogHistory[] = [];
  let startAt = 0;
  let hasMore = true;
  while (hasMore) {
    const page: JiraChangelogPage = await requestJson(
      configuration,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=100`,
    );
    histories.push(...(page.values ?? []));
    startAt += page.maxResults ?? 100;
    hasMore = page.isLast === false || startAt < (page.total ?? histories.length);
  }
  return histories;
};

const readSprints = async (
  configuration: JiraKnowledgeSourceConfiguration,
  boardId: number,
): Promise<readonly JiraSprint[]> => {
  const sprints: JiraSprint[] = [];
  let startAt = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await requestJson<JiraSprintPage>(
      configuration,
      `/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=100&state=active,future,closed`,
    );
    sprints.push(...(page.values ?? []));
    startAt += page.maxResults ?? 100;
    hasMore = page.isLast === false || startAt < (page.total ?? sprints.length);
  }
  return sprints;
};

const catalogDocument = async (
  configuration: JiraKnowledgeSourceConfiguration,
): Promise<KnowledgeSourceDocument> => {
  const [project, allFields, boards] = await Promise.all([
    requestJson<JiraProject>(
      configuration,
      `/rest/api/3/project/${encodeURIComponent(configuration.projectKey)}`,
    ),
    requestJson<readonly JiraField[]>(configuration, "/rest/api/3/field"),
    configuration.boardId === undefined
      ? requestJson<JiraBoardPage>(
          configuration,
          `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(configuration.projectKey)}&maxResults=50`,
        )
      : Promise.resolve({
          values: [{ id: configuration.boardId }] as readonly JiraBoard[],
        }),
  ]);
  const board = boards.values?.find(({ id }) => id === configuration.boardId) ?? boards.values?.[0];
  const boardId = board?.id;
  const [boardConfiguration, sprints] =
    boardId === undefined
      ? [undefined, [] as readonly JiraSprint[]]
      : await Promise.all([
          requestJson<JiraBoardConfiguration>(
            configuration,
            `/rest/agile/1.0/board/${boardId}/configuration`,
          ),
          readSprints(configuration, boardId),
        ]);
  const configuredFieldIds = new Set(Object.keys(configuration.fields));
  const fields = allFields
    .filter(
      ({ id, name }) =>
        id !== undefined && configuredFieldIds.has(id) && !isFinanceAttributeKey(name ?? ""),
    )
    .map(({ id, name, custom, schema }) => ({ id, name, custom, schema: structuredValue(schema) }));
  const columns = (boardConfiguration?.columnConfig?.columns ?? []).map(({ name, statuses }) => ({
    name,
    statusIds: (statuses ?? []).flatMap(({ id }) => (id === undefined ? [] : [id])),
  }));
  const normalizedSprints = sprints.map(
    ({ id, name, state, startDate, endDate, completeDate }) => ({
      id,
      name,
      state,
      startDate,
      endDate,
      completeDate,
    }),
  );
  const catalog = {
    project: {
      id: project.id,
      key: project.key ?? configuration.projectKey,
      name: project.name ?? configuration.projectKey,
      description: plainText(project.description),
      projectTypeKey: project.projectTypeKey,
    },
    fields,
    board: { id: boardId, name: boardConfiguration?.name ?? board?.name, columns },
    sprints: normalizedSprints,
  };
  const passages = [
    createTypedPassage("project", "#project", 0, "Project metadata", canonicalize(catalog.project)),
    createTypedPassage("fields", "#fields", 1, "Configured Jira fields", canonicalize(fields)),
    createTypedPassage("board", "#board", 2, "Board columns", canonicalize(catalog.board)),
    createTypedPassage("sprints", "#sprints", 3, "Sprints", canonicalize(normalizedSprints)),
  ].filter((passage) => passage !== undefined);
  const projectRef = { kind: "project" as const, externalKey: configuration.projectKey };
  const sprintObjects: DeliveryObjectDraft[] = normalizedSprints.flatMap((sprint) =>
    sprint.id === undefined
      ? []
      : [
          {
            kind: "sprint" as const,
            externalKey: String(sprint.id),
            title: sprint.name ?? String(sprint.id),
            lifecycleState: sprint.state,
            attributes: sprint,
            sensitivity: configuration.sensitivity,
            ...(sprint.startDate === undefined ? {} : { effectiveFrom: sprint.startDate }),
            ...(sprint.endDate === undefined ? {} : { effectiveTo: sprint.endDate }),
          },
        ],
  );
  const sourceUpdatedAt =
    normalizedSprints
      .flatMap(({ completeDate, startDate }) => [completeDate, startDate])
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1) ?? new Date(0).toISOString();
  const canonicalUrl = new URL(
    `/browse/${encodeURIComponent(configuration.projectKey)}`,
    configuration.baseUrl,
  ).toString();
  return {
    source: "jira",
    sourceId: configuration.sourceId,
    workspaceId: configuration.workspaceId,
    externalId: `${configuration.projectKey}:catalog`,
    sourceType: "project-catalog",
    sourceVersion: stableSha256(canonicalize(catalog)),
    canonicalUrl,
    title: project.name ?? configuration.projectKey,
    sourceUpdatedAt,
    sensitivity: configuration.sensitivity,
    authority: configuration.authority ?? 1,
    provenance: {
      projectKey: configuration.projectKey,
      ...(boardId === undefined ? {} : { boardId: String(boardId) }),
    },
    acl: configuration.acl,
    passages,
    deliveryProjection: {
      objects: [
        {
          ...projectRef,
          title: project.name ?? configuration.projectKey,
          lifecycleState: "active",
          attributes: catalog,
          sensitivity: configuration.sensitivity,
        },
        ...sprintObjects,
      ],
      relations: sprintObjects.map((sprint) => ({
        kind: "contains" as const,
        from: projectRef,
        to: { kind: sprint.kind, externalKey: sprint.externalKey },
        attributes: {},
        sensitivity: configuration.sensitivity,
      })),
      observations: [],
      metrics: [],
      claims: [],
    },
  };
};

const readComments = async (
  configuration: JiraKnowledgeSourceConfiguration,
  issueKey: string,
): Promise<readonly JiraComment[]> => {
  const comments: JiraComment[] = [];
  let startAt = 0;
  let hasMore = true;
  while (hasMore) {
    const page: JiraCommentPage = await requestJson(
      configuration,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=100&orderBy=created`,
    );
    comments.push(...(page.comments ?? []));
    startAt += page.maxResults ?? 100;
    hasMore = startAt < (page.total ?? comments.length);
  }
  return comments;
};

const mapBounded = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> => {
  const results: Output[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    results.push(...(await Promise.all(values.slice(offset, offset + concurrency).map(transform))));
  }
  return results;
};

const issuePassages = (
  issue: JiraIssue,
  comments: readonly JiraComment[],
  changelog: readonly JiraChangelogHistory[],
  fields: Readonly<Record<string, string>>,
): readonly KnowledgePassageDraft[] => {
  const passages: KnowledgePassageDraft[] = [];
  for (const [fieldId, label] of Object.entries(fields)) {
    if (isFinanceAttributeKey(label)) continue;
    const passage = createTypedPassage(
      fieldId === "description" ? "description" : "field",
      `#field-${fieldId.toLowerCase()}`,
      passages.length,
      label,
      plainText(issue.fields[fieldId]),
    );
    if (passage !== undefined) passages.push(passage);
  }
  for (const comment of comments) {
    const passage = createTypedPassage(
      "comment",
      `#comment-${comment.id}`,
      passages.length,
      `Comment by ${comment.author?.displayName ?? "Jira user"}`,
      plainText(comment.body),
    );
    if (passage !== undefined) passages.push(passage);
  }
  for (const history of changelog) {
    for (const [itemIndex, item] of (history.items ?? []).entries()) {
      const field = item.field?.trim() ?? "";
      if (field === "" || isFinanceAttributeKey(field)) continue;
      const passage = createTypedPassage(
        "change",
        `#change-${history.id ?? history.created ?? passages.length}-${itemIndex}`,
        passages.length,
        `Change by ${history.author?.displayName ?? "Jira user"}`,
        `${field}: ${item.fromString ?? "unset"} -> ${item.toString ?? "unset"}`,
      );
      if (passage !== undefined) passages.push(passage);
    }
  }
  return passages;
};

const normalizedLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

type JiraStatusChange = {
  readonly id: string;
  readonly at: string;
  readonly from: string;
  readonly to: string;
  readonly actor?: string | undefined;
};

const statusChangesFrom = (
  changelog: readonly JiraChangelogHistory[],
): readonly JiraStatusChange[] =>
  changelog
    .flatMap((history) =>
      (history.items ?? []).flatMap((item, itemIndex) =>
        item.field?.toLowerCase() === "status" && history.created !== undefined
          ? [
              {
                id: `${history.id ?? history.created}:${itemIndex}`,
                at: history.created,
                from: item.fromString ?? "unset",
                to: item.toString ?? "unset",
                actor: history.author?.accountId ?? history.author?.displayName,
              },
            ]
          : [],
      ),
    )
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));

const structuredValue = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) return value.map(structuredValue);
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "id",
    "key",
    "name",
    "value",
    "displayName",
    "accountId",
    "state",
    "startDate",
    "endDate",
    "completeDate",
    "releaseDate",
    "released",
    "originalEstimateSeconds",
    "remainingEstimateSeconds",
    "timeSpentSeconds",
  ]);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => allowed.has(key))
      .map(([key, entry]) => [key, structuredValue(entry)])
      .filter(([, entry]) => entry !== undefined),
  );
};

const fieldWithLabel = (
  issue: JiraIssue,
  fields: Readonly<Record<string, string>>,
  pattern: RegExp,
): unknown => {
  const fieldId = Object.entries(fields).find(([, label]) => pattern.test(label))?.[0];
  return fieldId === undefined ? undefined : issue.fields[fieldId];
};

const recordValue = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const recordValues = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = recordValue(entry);
        return record === undefined ? [] : [record];
      })
    : [];

const objectReference = (kind: DeliveryObjectKind, externalKey: string): DeliveryObjectRef => ({
  kind,
  externalKey,
});

const jiraLifecycleState = (status: string): string | undefined => {
  const normalized = status.toLowerCase();
  if (/\b(?:blocked|impeded|stuck)\b/.test(normalized)) return "blocked";
  if (/\b(?:done|closed|resolved|released|complete)\b/.test(normalized)) return "done";
  if (/\b(?:in progress|implementing|review|testing|qa)\b/.test(normalized)) return "in_progress";
  if (/\b(?:open|todo|to do|backlog|new|selected|ready)\b/.test(normalized)) return "planned";
  return status === "" ? undefined : normalizedLabel(status);
};

const canonicalFieldValue = (
  issue: JiraIssue,
  fields: Readonly<Record<string, string>>,
  pattern: RegExp,
): string | undefined => {
  const value = plainText(fieldWithLabel(issue, fields, pattern)).trim();
  return value === "" ? undefined : value;
};

const numericMetricValue = (value: unknown): string | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized !== "" && Number.isFinite(Number(normalized)) ? normalized : undefined;
};

const deliveryProjection = (
  configuration: JiraKnowledgeSourceConfiguration,
  issue: JiraIssue,
  comments: readonly JiraComment[],
  changelog: readonly JiraChangelogHistory[],
): DeliveryProjection => {
  const sensitivity = configuration.sensitivity;
  const workItem = objectReference("work_item", issue.key);
  const project = objectReference("project", configuration.projectKey);
  const status = plainText(fieldWithLabel(issue, configuration.fields, /^status$/i));
  const normalizedStatus = jiraLifecycleState(status);
  const issueType = plainText(fieldWithLabel(issue, configuration.fields, /issue type|type/i));
  const statusChanges = statusChangesFrom(changelog);
  const latestStatusChange = statusChanges.at(-1);
  const attributes = {
    ...Object.fromEntries(
      Object.entries(configuration.fields).flatMap(([fieldId, label]) => {
        if (/description|comment/i.test(label) || isFinanceAttributeKey(label)) return [];
        const value = structuredValue(issue.fields[fieldId]);
        return value === undefined || value === null || value === ""
          ? []
          : [[normalizedLabel(label), value] as const];
      }),
    ),
    ...(canonicalFieldValue(issue, configuration.fields, /^priority$/i) === undefined
      ? {}
      : {
          priority: canonicalFieldValue(issue, configuration.fields, /^priority$/i),
        }),
    ...(canonicalFieldValue(issue, configuration.fields, /due date|duedate/i) === undefined
      ? {}
      : {
          dueAt: canonicalFieldValue(issue, configuration.fields, /due date|duedate/i),
        }),
    ...(canonicalFieldValue(issue, configuration.fields, /start date/i) === undefined
      ? {}
      : {
          startAt: canonicalFieldValue(issue, configuration.fields, /start date/i),
        }),
    ...(latestStatusChange === undefined
      ? {}
      : {
          statusEnteredAt: latestStatusChange.at,
          previousStatus: latestStatusChange.from,
        }),
  };
  const objects: DeliveryObjectDraft[] = [
    {
      ...project,
      title: configuration.projectKey,
      lifecycleState: "active",
      attributes: {},
      sensitivity,
    },
    {
      ...workItem,
      title: plainText(issue.fields.summary) || issue.key,
      ...(normalizedStatus === undefined ? {} : { lifecycleState: normalizedStatus }),
      attributes,
      sensitivity,
    },
  ];
  const relations: DeliveryRelationDraft[] = [
    {
      kind: "contains",
      from: project,
      to: workItem,
      attributes: {},
      sensitivity,
    },
  ];
  const addObject = (object: DeliveryObjectDraft): void => {
    if (
      !objects.some(
        (candidate) =>
          candidate.kind === object.kind && candidate.externalKey === object.externalKey,
      )
    )
      objects.push(object);
  };
  const addRelation = (relation: DeliveryRelationDraft): void => {
    if (
      relations.some(
        (candidate) =>
          candidate.kind === relation.kind &&
          candidate.from.kind === relation.from.kind &&
          candidate.from.externalKey === relation.from.externalKey &&
          candidate.to.kind === relation.to.kind &&
          candidate.to.externalKey === relation.to.externalKey,
      )
    )
      return;
    relations.push(relation);
  };

  const assignee = recordValue(fieldWithLabel(issue, configuration.fields, /assignee/i));
  const assigneeKey = plainText(assignee?.accountId) || plainText(assignee?.displayName);
  if (assigneeKey !== "") {
    const person = objectReference("person", assigneeKey);
    addObject({
      ...person,
      title: plainText(assignee?.displayName) || assigneeKey,
      lifecycleState: "active",
      attributes: {},
      sensitivity,
    });
    addRelation({
      kind: "assigned_to",
      from: workItem,
      to: person,
      attributes: {},
      sensitivity,
    });
  }

  for (const sprintValue of recordValues(fieldWithLabel(issue, configuration.fields, /sprint/i))) {
    const sprintKey = plainText(sprintValue.id) || plainText(sprintValue.name);
    if (sprintKey === "") continue;
    const sprint = objectReference("sprint", sprintKey);
    addObject({
      ...sprint,
      title: plainText(sprintValue.name) || sprintKey,
      lifecycleState: plainText(sprintValue.state) || undefined,
      attributes: structuredValue(sprintValue) as Readonly<Record<string, unknown>>,
      sensitivity,
      ...(typeof sprintValue.startDate === "string"
        ? { effectiveFrom: sprintValue.startDate }
        : {}),
      ...(typeof sprintValue.endDate === "string" ? { effectiveTo: sprintValue.endDate } : {}),
    });
    addRelation({
      kind: "contains",
      from: sprint,
      to: workItem,
      attributes: {},
      sensitivity,
    });
  }

  for (const componentValue of recordValues(
    fieldWithLabel(issue, configuration.fields, /component|module/i),
  )) {
    const componentKey = plainText(componentValue.id) || plainText(componentValue.name);
    if (componentKey === "") continue;
    const module = objectReference("module", componentKey);
    addObject({
      ...module,
      title: plainText(componentValue.name) || componentKey,
      lifecycleState: "active",
      attributes: {},
      sensitivity,
    });
    addRelation({
      kind: "contains",
      from: module,
      to: workItem,
      attributes: {},
      sensitivity,
    });
  }

  for (const versionValue of recordValues(
    fieldWithLabel(issue, configuration.fields, /fix version|release|milestone/i),
  )) {
    const versionKey = plainText(versionValue.id) || plainText(versionValue.name);
    if (versionKey === "") continue;
    const milestone = objectReference("milestone", versionKey);
    addObject({
      ...milestone,
      title: plainText(versionValue.name) || versionKey,
      lifecycleState: "active",
      attributes: structuredValue(versionValue) as Readonly<Record<string, unknown>>,
      sensitivity,
    });
    addRelation({
      kind: "contains",
      from: milestone,
      to: workItem,
      attributes: {},
      sensitivity,
    });
  }

  const normalizedType = issueType.toLowerCase();
  if (/epic|story|requirement/.test(normalizedType)) {
    const requirement = objectReference("requirement", issue.key);
    addObject({
      ...requirement,
      title: plainText(issue.fields.summary) || issue.key,
      ...(normalizedStatus === undefined ? {} : { lifecycleState: normalizedStatus }),
      attributes: { issueType },
      sensitivity,
    });
    addRelation({
      kind: "implements",
      from: workItem,
      to: requirement,
      attributes: {},
      sensitivity,
    });
  }
  const labels = plainText(fieldWithLabel(issue, configuration.fields, /labels?/i));
  if (/risk/i.test(normalizedType) || /(?:^|[;,\s])risk(?:[;,\s]|$)/i.test(labels)) {
    const risk = objectReference("risk", issue.key);
    addObject({
      ...risk,
      title: plainText(issue.fields.summary) || issue.key,
      ...(normalizedStatus === undefined ? {} : { lifecycleState: normalizedStatus }),
      attributes: {
        issueType,
        labels,
        ...(attributes.priority === undefined ? {} : { severity: attributes.priority }),
      },
      sensitivity,
    });
    addRelation({
      kind: "affects",
      from: risk,
      to: project,
      attributes: {},
      sensitivity,
    });
  }

  const links = fieldWithLabel(issue, configuration.fields, /issue links?|dependencies/i);
  for (const [index, link] of recordValues(links).entries()) {
    const type = recordValue(link.type);
    const inward = recordValue(link.inwardIssue);
    const outward = recordValue(link.outwardIssue);
    const target = inward ?? outward;
    const targetKey = plainText(target?.key);
    if (targetKey === "" || !targetKey.startsWith(`${configuration.projectKey}-`)) continue;
    const targetRef = objectReference("work_item", targetKey);
    addObject({
      ...targetRef,
      title: plainText(recordValue(target?.fields)?.summary) || targetKey,
      attributes: { placeholder: true },
      sensitivity,
    });
    const label = plainText(inward === undefined ? type?.outward : type?.inward).toLowerCase();
    const relationKind = /block/.test(label)
      ? inward === undefined
        ? "blocks"
        : "depends_on"
      : /depend|require|wait/.test(label)
        ? "depends_on"
        : "relates_to";
    addRelation({
      kind: relationKind,
      from: workItem,
      to: targetRef,
      attributes: { label, ordinal: index },
      sensitivity,
    });
  }

  const waitMetrics = statusChanges.flatMap((change, index) => {
    const exitedAt = statusChanges[index + 1]?.at;
    if (exitedAt === undefined) return [];
    const seconds = Math.max(0, Math.floor((Date.parse(exitedAt) - Date.parse(change.at)) / 1_000));
    return Number.isFinite(seconds)
      ? [
          {
            subject: workItem,
            category: "delivery" as const,
            kind: `status_wait_seconds:${normalizedLabel(change.to)}`,
            value: String(seconds),
            unit: "seconds",
            effectiveFrom: change.at,
            effectiveTo: exitedAt,
            sensitivity,
          },
        ]
      : [];
  });
  const metrics = [
    ...Object.entries(configuration.fields).flatMap(([fieldId, label]) => {
      const value = numericMetricValue(issue.fields[fieldId]);
      const metricKind = /story point/i.test(label)
        ? "estimate_story_points"
        : /original estimate/i.test(label)
          ? "estimate_original_seconds"
          : /remaining estimate/i.test(label)
            ? "estimate_remaining_seconds"
            : undefined;
      if (metricKind === undefined || value === undefined) return [];
      return [
        {
          subject: workItem,
          category: /remaining estimate/i.test(label)
            ? ("capacity" as const)
            : ("delivery" as const),
          kind: metricKind,
          value,
          unit: metricKind === "estimate_story_points" ? "points" : "seconds",
          sensitivity,
        },
      ];
    }),
    ...waitMetrics,
  ];
  const assertedAt =
    typeof issue.fields.updated === "string" ? issue.fields.updated : new Date(0).toISOString();
  const claims = Object.entries(attributes).flatMap(([key, value]) =>
    value === undefined
      ? []
      : [
          {
            subject: workItem,
            subjectKey: issue.key,
            predicate: `jira.${key}`,
            value,
            assertedAt,
            citationUrl: new URL(
              `/browse/${encodeURIComponent(issue.key)}`,
              configuration.baseUrl,
            ).toString(),
            sensitivity,
            authority: configuration.authority ?? 1,
          },
        ],
  );
  const issueUrl = new URL(
    `/browse/${encodeURIComponent(issue.key)}`,
    configuration.baseUrl,
  ).toString();
  const observations = [
    {
      kind: "state" as const,
      externalId: `issue:${issue.id}:${assertedAt}`,
      subject: workItem,
      summary: `${issue.key} ${status === "" ? "was observed" : `is ${status}`}`,
      dedupeKey: `jira:${issue.key}:state:${normalizedLabel(status || "observed")}`,
      occurredAt: assertedAt,
      citationUrl: issueUrl,
      sensitivity,
      authority: configuration.authority ?? 1,
    },
    ...comments.map((comment) => ({
      kind: "comment" as const,
      externalId: `comment:${comment.id}`,
      subject: workItem,
      actorExternalKey: comment.author?.accountId ?? comment.author?.displayName,
      summary: plainText(comment.body),
      dedupeKey: `jira:${issue.key}:comment:${comment.id}`,
      occurredAt: comment.updated ?? comment.created ?? assertedAt,
      citationUrl: `${issueUrl}#comment-${comment.id}`,
      sensitivity,
      authority: configuration.authority ?? 1,
    })),
    ...statusChanges.map((change) => ({
      kind: "state" as const,
      externalId: `status-change:${issue.id}:${change.id}`,
      subject: workItem,
      actorExternalKey: change.actor,
      summary: `${issue.key} changed from ${change.from} to ${change.to}`,
      dedupeKey: `jira:${issue.key}:status-change:${change.id}`,
      occurredAt: change.at,
      citationUrl: issueUrl,
      sensitivity,
      authority: configuration.authority ?? 1,
    })),
  ];
  return { objects, relations, observations, metrics, claims };
};

const asDocument = (
  configuration: JiraKnowledgeSourceConfiguration,
  issue: JiraIssue,
  comments: readonly JiraComment[],
  changelog: readonly JiraChangelogHistory[],
): KnowledgeSourceDocument => {
  const updated =
    typeof issue.fields.updated === "string"
      ? issue.fields.updated
      : comments
          .map((comment) => comment.updated ?? comment.created ?? "")
          .sort()
          .at(-1);
  if (updated === undefined || updated === "")
    throw new Error(`Jira issue ${issue.key} has no update time.`);
  const passages = issuePassages(issue, comments, changelog, configuration.fields);
  if (passages.length === 0)
    throw new Error(`Jira issue ${issue.key} produced no connected passages.`);
  const sourceVersion = stableSha256(
    canonicalize({ issue: issue.fields, comments, changelog, acl: configuration.acl }),
  );
  return {
    source: "jira",
    sourceId: configuration.sourceId,
    workspaceId: configuration.workspaceId,
    externalId: issue.key,
    sourceType: "issue",
    sourceVersion,
    canonicalUrl: new URL(
      `/browse/${encodeURIComponent(issue.key)}`,
      configuration.baseUrl,
    ).toString(),
    title: plainText(issue.fields.summary) || issue.key,
    sourceUpdatedAt: updated,
    sensitivity: configuration.sensitivity,
    authority: configuration.authority ?? 1,
    provenance: { projectKey: configuration.projectKey, issueId: issue.id },
    acl: configuration.acl,
    passages,
    deliveryProjection: deliveryProjection(configuration, issue, comments, changelog),
  };
};

export const createJiraKnowledgeSource = (
  configuration: JiraKnowledgeSourceConfiguration,
): KnowledgeSourceReader => ({
  readSnapshot: (workspaceId, previousCursor) =>
    Effect.tryPromise({
      try: async () => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("Jira knowledge source was requested for another workspace.");
        if (
          configuration.cursorOverlapSeconds !== undefined &&
          (!Number.isInteger(configuration.cursorOverlapSeconds) ||
            configuration.cursorOverlapSeconds < 0 ||
            configuration.cursorOverlapSeconds > 3_600)
        )
          throw new Error("Jira cursor overlap must be between zero and one hour.");
        const issues = await readIssues(configuration, previousCursor);
        const issueDocuments = await mapBounded(issues, 4, async (issue) => {
          const [comments, changelog] = await Promise.all([
            readComments(configuration, issue.key),
            readChangelog(configuration, issue.key),
          ]);
          return asDocument(configuration, issue, comments, changelog);
        });
        const documents =
          previousCursor === undefined
            ? [...issueDocuments, await catalogDocument(configuration)]
            : issueDocuments;
        const previous =
          previousCursor === undefined
            ? { version: 1 as const, updatedAt: new Date(0).toISOString(), issueKey: "" }
            : parseCursor(previousCursor);
        const latest = issueDocuments
          .map((document) => ({
            version: 1 as const,
            updatedAt: document.sourceUpdatedAt,
            issueKey: document.externalId,
          }))
          .reduce<JiraIncrementalCursor>(
            (current, candidate) =>
              candidate.updatedAt > current.updatedAt ||
              (candidate.updatedAt === current.updatedAt && candidate.issueKey > current.issueKey)
                ? candidate
                : current,
            previous,
          );
        return {
          sourceId: configuration.sourceId,
          source: "jira",
          workspaceId,
          cursor: encodeCursor(latest),
          scopeHash: stableSha256(
            canonicalize({
              projectKey: configuration.projectKey,
              jql: configuration.jql,
              fields: configuration.fields,
              acl: configuration.acl,
            }),
          ),
          mode: previousCursor === undefined ? "full" : "delta",
          retiredExternalIds: [],
          documents,
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Connected Jira knowledge synchronization failed.",
          operation: "jira-knowledge-sync",
        }),
    }),
});
