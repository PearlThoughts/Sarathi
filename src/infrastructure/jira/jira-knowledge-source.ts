import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
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
  readonly author?: { readonly accountId?: string; readonly displayName?: string };
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
  readonly approvedJql: string;
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
  const approved = configuration.approvedJql.trim();
  if (approved === "") throw new Error("Jira knowledge JQL is required.");
  return `project = "${configuration.projectKey}" AND (${approved}) ORDER BY updated ASC, key ASC`;
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
    throw new Error(`Jira issue ${issue.key} produced no approved passages.`);
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
              approvedJql: configuration.approvedJql,
              fields: configuration.fields,
              acl: configuration.acl,
            }),
          ),
          documents,
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Approved Jira knowledge synchronization failed.",
          operation: "jira-knowledge-sync",
        }),
    }),
});
