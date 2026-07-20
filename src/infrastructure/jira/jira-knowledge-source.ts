import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  DeliveryObjectDraft,
  DeliveryObjectKind,
  DeliveryObjectRef,
  DeliveryProjection,
  DeliveryRelationDraft,
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

const boundedJql = (configuration: JiraKnowledgeSourceConfiguration): string => {
  if (!/^[A-Z][A-Z0-9]+$/.test(configuration.projectKey))
    throw new Error("Jira knowledge project key is invalid.");
  const configuredJql = configuration.jql.trim();
  if (configuredJql === "") throw new Error("Jira knowledge JQL is required.");
  return `project = "${configuration.projectKey}" AND (${configuredJql}) ORDER BY updated ASC, key ASC`;
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
): Promise<readonly JiraIssue[]> => {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page: JiraSearchPage = await requestJson(configuration, "/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: boundedJql(configuration),
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
  fields: Readonly<Record<string, string>>,
): readonly KnowledgePassageDraft[] => {
  const passages: KnowledgePassageDraft[] = [];
  for (const [fieldId, label] of Object.entries(fields)) {
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
  return passages;
};

const normalizedLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

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

const deliveryProjection = (
  configuration: JiraKnowledgeSourceConfiguration,
  issue: JiraIssue,
  comments: readonly JiraComment[],
): DeliveryProjection => {
  const sensitivity = configuration.sensitivity;
  const workItem = objectReference("work_item", issue.key);
  const project = objectReference("project", configuration.projectKey);
  const status = plainText(fieldWithLabel(issue, configuration.fields, /^status$/i));
  const normalizedStatus = jiraLifecycleState(status);
  const issueType = plainText(fieldWithLabel(issue, configuration.fields, /issue type|type/i));
  const attributes = {
    ...Object.fromEntries(
      Object.entries(configuration.fields).flatMap(([fieldId, label]) => {
        if (/description|comment/i.test(label)) return [];
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

  const metrics = Object.entries(configuration.fields).flatMap(([fieldId, label]) => {
    const value = issue.fields[fieldId];
    const metricKind = /story point/i.test(label)
      ? "estimate_story_points"
      : /original estimate/i.test(label)
        ? "estimate_original_seconds"
        : /remaining estimate/i.test(label)
          ? "estimate_remaining_seconds"
          : undefined;
    if (metricKind === undefined || !Number.isFinite(Number(value))) return [];
    return [
      {
        subject: workItem,
        category: /remaining estimate/i.test(label) ? ("capacity" as const) : ("delivery" as const),
        kind: metricKind,
        value: String(value),
        unit: metricKind === "estimate_story_points" ? "points" : "seconds",
        sensitivity,
      },
    ];
  });
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
  ];
  return { objects, relations, observations, metrics, claims };
};

const asDocument = (
  configuration: JiraKnowledgeSourceConfiguration,
  issue: JiraIssue,
  comments: readonly JiraComment[],
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
  const passages = issuePassages(issue, comments, configuration.fields);
  if (passages.length === 0)
    throw new Error(`Jira issue ${issue.key} produced no connected passages.`);
  const sourceVersion = stableSha256(
    canonicalize({ issue: issue.fields, comments, acl: configuration.acl }),
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
    deliveryProjection: deliveryProjection(configuration, issue, comments),
  };
};

export const createJiraKnowledgeSource = (
  configuration: JiraKnowledgeSourceConfiguration,
): KnowledgeSourceReader => ({
  readSnapshot: (workspaceId) =>
    Effect.tryPromise({
      try: async () => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("Jira knowledge source was requested for another workspace.");
        const issues = await readIssues(configuration);
        const documents = await mapBounded(issues, 4, async (issue) =>
          asDocument(configuration, issue, await readComments(configuration, issue.key)),
        );
        const cursor =
          documents
            .map(({ sourceUpdatedAt }) => sourceUpdatedAt)
            .sort()
            .at(-1) ?? new Date(0).toISOString();
        return {
          sourceId: configuration.sourceId,
          source: "jira",
          workspaceId,
          cursor,
          scopeHash: stableSha256(
            canonicalize({
              projectKey: configuration.projectKey,
              jql: configuration.jql,
              fields: configuration.fields,
              acl: configuration.acl,
            }),
          ),
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
