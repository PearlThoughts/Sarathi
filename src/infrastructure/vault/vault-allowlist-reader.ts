import type { SensitivityTier } from "../../domain/policy.ts";
import type { EvidenceSourceReader } from "../../modules/evidence-import/index.ts";

type VaultAllowlistDocument = {
  readonly workspaceId: string;
  readonly sourceKey: string;
  readonly repository: string;
  readonly path: string;
  readonly ref?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly consentScope?: string | undefined;
};

type VaultAllowlist = {
  readonly documents: readonly VaultAllowlistDocument[];
};

type GitHubVaultAllowlistReaderConfiguration = {
  readonly token: string;
  readonly allowlist: VaultAllowlist;
  readonly fetcher?: typeof fetch | undefined;
};

type GitHubContent = {
  readonly content?: string | undefined;
  readonly encoding?: string | undefined;
  readonly html_url?: string | undefined;
  readonly sha?: string | undefined;
  readonly type?: string | undefined;
};

type GitHubCommit = {
  readonly commit?:
    | {
        readonly committer?: { readonly date?: string | undefined } | undefined;
        readonly author?: { readonly date?: string | undefined } | undefined;
      }
    | undefined;
};

const sensitivities = new Set<SensitivityTier>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const allowedDocumentKeys = new Set([
  "workspaceId",
  "sourceKey",
  "repository",
  "path",
  "ref",
  "sensitivity",
  "consentScope",
]);
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const required = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Vault allowlist ${label} is required.`);
  return value;
};

const validPath = (value: string): boolean =>
  !value.startsWith("/") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const asDocument = (candidate: unknown): VaultAllowlistDocument => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
    throw new Error("Vault allowlist document must be an object.");
  const document = candidate as Record<string, unknown>;
  if (Object.keys(document).some((key) => !allowedDocumentKeys.has(key)))
    throw new Error("Vault allowlist documents may not contain raw evidence fields.");
  const repository = required(document.repository, "repository");
  const path = required(document.path, "path");
  if (!repositoryPattern.test(repository))
    throw new Error("Vault allowlist repository must be an owner/repository reference.");
  if (!validPath(path)) throw new Error("Vault allowlist path must be a relative repository path.");
  if (!sensitivities.has(document.sensitivity as SensitivityTier))
    throw new Error("Vault allowlist sensitivity is invalid.");
  const ref = document.ref === undefined ? undefined : required(document.ref, "ref");
  const consentScope =
    document.consentScope === undefined
      ? undefined
      : required(document.consentScope, "consentScope");
  return {
    workspaceId: required(document.workspaceId, "workspaceId"),
    sourceKey: required(document.sourceKey, "sourceKey"),
    repository,
    path,
    ...(ref === undefined ? {} : { ref }),
    sensitivity: document.sensitivity as SensitivityTier,
    ...(consentScope === undefined ? {} : { consentScope }),
  };
};

/**
 * Deployment configuration contains only references to workspace-scoped Vault notes.
 * The note body is read at request time and never embedded in the overlay or
 * Railway variables.
 */
export const vaultAllowlistFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): VaultAllowlist => {
  const raw = environment.SARATHI_VAULT_ALLOWLIST_JSON;
  if (raw === undefined || raw.trim() === "")
    throw new Error("SARATHI_VAULT_ALLOWLIST_JSON is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Vault allowlist must be valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some((key) => key !== "documents") ||
    !Array.isArray((parsed as { documents?: unknown }).documents)
  ) {
    throw new Error("Vault allowlist must contain only a documents array.");
  }
  const documents = (parsed as { documents: readonly unknown[] }).documents.map(asDocument);
  if (documents.length === 0)
    throw new Error("Vault allowlist must contain at least one document.");
  return { documents };
};

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
});

const contentUrl = (document: VaultAllowlistDocument): string => {
  const path = document.path.split("/").map(encodeURIComponent).join("/");
  const query = document.ref === undefined ? "" : `?ref=${encodeURIComponent(document.ref)}`;
  return `https://api.github.com/repos/${document.repository}/contents/${path}${query}`;
};

const latestCommitUrl = (document: VaultAllowlistDocument): string => {
  const query = new URLSearchParams({ path: document.path, per_page: "1" });
  if (document.ref !== undefined) query.set("sha", document.ref);
  return `https://api.github.com/repos/${document.repository}/commits?${query.toString()}`;
};

const titleFromMarkdown = (markdown: string, path: string): string => {
  const heading = markdown.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return (
    heading === undefined || heading === "" ? (path.split("/").at(-1) ?? "Vault note") : heading
  ).slice(0, 240);
};

const excerptFromMarkdown = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

const decodeMarkdown = (content: GitHubContent): string => {
  if (content.type !== "file" || content.encoding !== "base64" || content.content === undefined)
    throw new Error("Approved Vault reference did not resolve to a readable GitHub file.");
  return Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8");
};

const occurredAt = (commits: readonly GitHubCommit[]): string => {
  const date = commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date;
  if (date === undefined || date.trim() === "")
    throw new Error("Approved Vault reference has no readable GitHub commit timestamp.");
  return date;
};

export const createGitHubVaultAllowlistReader = (
  configuration: GitHubVaultAllowlistReaderConfiguration,
): EvidenceSourceReader => ({
  readEvidence: async ({ workspaceId, sourceKey }) => {
    const documents = configuration.allowlist.documents.filter(
      (document) => document.workspaceId === workspaceId && document.sourceKey === sourceKey,
    );
    const fetcher = configuration.fetcher ?? fetch;
    const records = await Promise.all(
      documents.map(async (document) => {
        const [contentResponse, commitResponse] = await Promise.all([
          fetcher(contentUrl(document), { headers: headers(configuration.token) }),
          fetcher(latestCommitUrl(document), { headers: headers(configuration.token) }),
        ]);
        if (!contentResponse.ok)
          throw new Error(
            `Approved Vault GitHub content read failed with HTTP ${contentResponse.status}.`,
          );
        if (!commitResponse.ok)
          throw new Error(
            `Approved Vault GitHub commit read failed with HTTP ${commitResponse.status}.`,
          );
        const [content, commits] = (await Promise.all([
          contentResponse.json() as Promise<GitHubContent>,
          commitResponse.json() as Promise<readonly GitHubCommit[]>,
        ])) as [GitHubContent, readonly GitHubCommit[]];
        const markdown = decodeMarkdown(content);
        const recordedAt = occurredAt(commits);
        if (
          content.sha === undefined ||
          content.sha.trim() === "" ||
          content.html_url === undefined
        )
          throw new Error("Approved Vault reference returned incomplete GitHub metadata.");
        return {
          sourceSystem: "vault" as const,
          sourceType: "note" as const,
          externalId: `${document.repository}:${document.path}@${content.sha}`,
          externalUrl: content.html_url,
          occurredAt: recordedAt,
          title: titleFromMarkdown(markdown, document.path),
          bodyExcerpt: excerptFromMarkdown(markdown),
          sensitivity: document.sensitivity,
          consent: {
            status: "granted" as const,
            scope: document.consentScope ?? "vault-allowlist",
            recordedAt,
          },
        };
      }),
    );
    return { records };
  },
});
