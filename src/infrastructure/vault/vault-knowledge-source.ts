import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  chunkVaultMarkdown,
  type KnowledgeAclRule,
  type KnowledgeSourceDocument,
  type KnowledgeSourceReader,
} from "../../modules/knowledge-layer/index.ts";

export type VaultKnowledgeRoot = {
  readonly repository: string;
  readonly pathPrefix: string;
  readonly ref?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
  readonly excludePathPrefixes?: readonly string[] | undefined;
};

export type VaultKnowledgeSourceConfiguration = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly token: string;
  readonly roots: readonly VaultKnowledgeRoot[];
  readonly fetcher?: typeof fetch | undefined;
};

type GitTree = {
  readonly sha: string;
  readonly truncated?: boolean;
  readonly tree?: readonly {
    readonly path?: string;
    readonly type?: string;
    readonly sha?: string;
  }[];
};

type GitContent = {
  readonly type?: string;
  readonly encoding?: string;
  readonly content?: string;
  readonly sha?: string;
};

type GitCommit = {
  readonly sha: string;
  readonly commit?: {
    readonly committer?: { readonly date?: string };
    readonly author?: { readonly date?: string };
  };
};

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const validPrefix = (value: string): boolean =>
  value !== "" &&
  !value.startsWith("/") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const isExcluded = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const requestJson = async <Value>(
  configuration: VaultKnowledgeSourceConfiguration,
  path: string,
): Promise<Value> => {
  const response = await (configuration.fetcher ?? fetch)(`https://api.github.com${path}`, {
    headers: headers(configuration.token),
  });
  if (!response.ok) throw new Error(`Vault knowledge read failed with HTTP ${response.status}.`);
  return (await response.json()) as Value;
};

const decodeMarkdown = (content: GitContent): string => {
  if (content.type !== "file" || content.encoding !== "base64" || content.content === undefined)
    throw new Error("Approved Vault path did not resolve to a Markdown file.");
  return Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8");
};

const title = (markdown: string, path: string): string =>
  markdown.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ??
  path.split("/").at(-1)?.replace(/\.md$/i, "") ??
  "Vault document";

const rootDocuments = async (
  configuration: VaultKnowledgeSourceConfiguration,
  root: VaultKnowledgeRoot,
): Promise<readonly KnowledgeSourceDocument[]> => {
  if (!repositoryPattern.test(root.repository) || !validPrefix(root.pathPrefix))
    throw new Error("Vault knowledge root must use an approved repository and relative prefix.");
  if (root.acl.length === 0)
    throw new Error("Vault knowledge root requires explicit ACL bindings.");
  const excluded = root.excludePathPrefixes ?? [];
  if (excluded.some((prefix) => !validPrefix(prefix) || !prefix.startsWith(root.pathPrefix)))
    throw new Error("Vault knowledge exclusions must remain within the approved root.");
  const ref = root.ref ?? "HEAD";
  const [tree, commit] = await Promise.all([
    requestJson<GitTree>(
      configuration,
      `/repos/${root.repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    ),
    requestJson<GitCommit>(
      configuration,
      `/repos/${root.repository}/commits/${encodeURIComponent(ref)}`,
    ),
  ]);
  if (tree.truncated === true)
    throw new Error("Approved Vault tree was truncated; narrow the configured root.");
  const updatedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
  if (updatedAt === undefined) throw new Error("Approved Vault revision has no timestamp.");
  const paths = (tree.tree ?? [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path !== undefined &&
        (entry.path === root.pathPrefix || entry.path.startsWith(`${root.pathPrefix}/`)) &&
        !isExcluded(entry.path, excluded) &&
        entry.path.toLowerCase().endsWith(".md"),
    )
    .map((entry) => ({ path: entry.path as string, sha: entry.sha ?? "" }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return Promise.all(
    paths.map(async ({ path, sha }) => {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const content = await requestJson<GitContent>(
        configuration,
        `/repos/${root.repository}/contents/${encodedPath}?ref=${encodeURIComponent(commit.sha)}`,
      );
      const markdown = decodeMarkdown(content);
      const passages = chunkVaultMarkdown(markdown);
      if (passages.length === 0)
        throw new Error(`Approved Vault path ${path} produced no passages.`);
      return {
        source: "vault",
        sourceId: configuration.sourceId,
        workspaceId: configuration.workspaceId,
        externalId: `${root.repository}:${path}`,
        sourceType: "note",
        sourceVersion: content.sha ?? sha,
        canonicalUrl: `https://github.com/${root.repository}/blob/${commit.sha}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        title: title(markdown, path),
        sourceUpdatedAt: updatedAt,
        sensitivity: root.sensitivity,
        authority: root.authority ?? 0.9,
        provenance: { repository: root.repository, path, revision: commit.sha },
        acl: root.acl,
        passages,
      } satisfies KnowledgeSourceDocument;
    }),
  );
};

export const createVaultKnowledgeSource = (
  configuration: VaultKnowledgeSourceConfiguration,
): KnowledgeSourceReader => ({
  readSnapshot: (workspaceId) =>
    Effect.tryPromise({
      try: async () => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("Vault knowledge source was requested for another workspace.");
        if (configuration.roots.length === 0)
          throw new Error("At least one approved Vault knowledge root is required.");
        const documents = (
          await Promise.all(configuration.roots.map((root) => rootDocuments(configuration, root)))
        ).flat();
        const ordered = [...documents].sort((left, right) =>
          left.externalId.localeCompare(right.externalId),
        );
        return {
          sourceId: configuration.sourceId,
          workspaceId,
          cursor:
            ordered
              .map(({ sourceUpdatedAt }) => sourceUpdatedAt)
              .sort()
              .at(-1) ?? new Date(0).toISOString(),
          scopeHash: stableSha256(
            JSON.stringify(
              configuration.roots.map(
                ({ repository, pathPrefix, ref, sensitivity, acl, excludePathPrefixes }) => ({
                  repository,
                  pathPrefix,
                  ref,
                  sensitivity,
                  acl,
                  excludePathPrefixes,
                }),
              ),
            ),
          ),
          documents: ordered,
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Approved Vault knowledge synchronization failed.",
          operation: "vault-knowledge-sync",
        }),
    }),
});
