import { Effect } from "effect";
import { parse as parseYaml } from "yaml";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  DeliveryObjectDraft,
  DeliveryObjectKind,
  DeliveryProjection,
} from "../../modules/delivery-intelligence/index.ts";
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
  if (
    (content.type !== undefined && content.type !== "file") ||
    content.encoding !== "base64" ||
    content.content === undefined
  )
    throw new Error("Configured Vault path did not resolve to a Markdown file.");
  return Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8");
};

const title = (markdown: string, path: string): string =>
  markdown.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ??
  path.split("/").at(-1)?.replace(/\.md$/i, "") ??
  "Vault document";

type VaultSectionTopic =
  | "status"
  | "goal"
  | "commitment"
  | "assumption"
  | "policy"
  | "capacity"
  | "scope"
  | "requirement"
  | "risk"
  | "decision"
  | "dependency"
  | "ownership"
  | "next_action"
  | "milestone"
  | "interpretation"
  | "context";

const sectionTopic = (heading: string): VaultSectionTopic => {
  const normalized = heading.toLowerCase();
  if (/\b(?:status|progress|current state)\b/.test(normalized)) return "status";
  if (/\b(?:goals?|objectives?|outcomes?)\b/.test(normalized)) return "goal";
  if (/\b(?:commitments?|promises?)\b/.test(normalized)) return "commitment";
  if (/\b(?:assumptions?|constraints?)\b/.test(normalized)) return "assumption";
  if (/\b(?:polic(?:y|ies)|working agreement|operating rule)\b/.test(normalized)) return "policy";
  if (/\b(?:capacity|bandwidth|allocation|availability)\b/.test(normalized)) return "capacity";
  if (/\b(?:scope|boundar(?:y|ies)|in scope|out of scope)\b/.test(normalized)) return "scope";
  if (/\b(?:requirements?|acceptance criteria|definition of done)\b/.test(normalized))
    return "requirement";
  if (/\b(?:risks?|raid|concerns?|threats?)\b/.test(normalized)) return "risk";
  if (/\b(?:decisions?|decided|agreements?)\b/.test(normalized)) return "decision";
  if (/\b(?:dependency|dependencies|blocked by|waiting)\b/.test(normalized)) return "dependency";
  if (/\b(?:owner|ownership|responsib|team)\b/.test(normalized)) return "ownership";
  if (/\b(?:next actions?|next steps?|action items?)\b/.test(normalized)) return "next_action";
  if (/\b(?:milestones?|releases?|phases?)\b/.test(normalized)) return "milestone";
  if (/\b(?:interpretations?|social context|human observations?|team dynamics?)\b/.test(normalized))
    return "interpretation";
  return "context";
};

const objectKindForTopic = (topic: VaultSectionTopic): DeliveryObjectKind => {
  switch (topic) {
    case "risk":
      return "risk";
    case "goal":
      return "goal";
    case "commitment":
      return "commitment";
    case "assumption":
      return "assumption";
    case "policy":
      return "policy";
    case "decision":
      return "decision";
    case "requirement":
      return "requirement";
    case "milestone":
      return "milestone";
    case "scope":
      return "module";
    case "next_action":
      return "action";
    case "ownership":
      return "team";
    case "interpretation":
      return "assumption";
    default:
      return "extension";
  }
};

const firstSummary = (body: string, fallback: string): string =>
  body
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/, 1)[0]
    ?.slice(0, 180) || fallback;

const lifecycleState = (value: string): string | undefined => {
  const normalized = value.toLowerCase();
  if (/\b(?:blocked|stuck|impeded)\b/.test(normalized)) return "blocked";
  if (/\b(?:done|complete|delivered|released)\b/.test(normalized)) return "done";
  if (/\b(?:in progress|active|underway|ongoing)\b/.test(normalized)) return "in_progress";
  if (/\b(?:planned|not started|todo)\b/.test(normalized)) return "planned";
  return undefined;
};

type DeliveryNoteMetadata = {
  readonly subject: {
    readonly kind: DeliveryObjectKind;
    readonly key: string;
    readonly title: string;
  };
  readonly assertedBy: string;
  readonly assertedAt: string;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
  readonly authority: number;
};

const objectKinds = new Set<DeliveryObjectKind>([
  "project",
  "goal",
  "commitment",
  "action",
  "assumption",
  "policy",
  "person",
  "team",
  "module",
  "requirement",
  "milestone",
  "sprint",
  "work_item",
  "deliverable",
  "risk",
  "decision",
  "extension",
]);

const timestampValue = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
};

const deliveryNoteMetadata = (
  markdown: string,
  rootAuthority: number,
): DeliveryNoteMetadata | undefined => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (frontmatter === undefined) return undefined;
  const parsed = parseYaml(frontmatter) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("sarathi_delivery" in parsed))
    return undefined;
  const record = (parsed as { readonly sarathi_delivery?: unknown }).sarathi_delivery;
  if (typeof record !== "object" || record === null)
    throw new Error("Structured Vault delivery metadata is invalid.");
  const values = record as Readonly<Record<string, unknown>>;
  const subject = values.subject;
  if (typeof subject !== "object" || subject === null)
    throw new Error("Structured Vault delivery metadata requires a subject.");
  const subjectValues = subject as Readonly<Record<string, unknown>>;
  const kind = subjectValues.kind;
  const key = subjectValues.key;
  const subjectTitle = subjectValues.title;
  const assertedBy = values.asserted_by;
  const assertedAt = timestampValue(values.asserted_at);
  const authority = typeof values.authority === "number" ? values.authority : 0.8;
  if (
    typeof kind !== "string" ||
    !objectKinds.has(kind as DeliveryObjectKind) ||
    typeof key !== "string" ||
    !/^[a-z0-9][a-z0-9._:-]{1,119}$/i.test(key) ||
    typeof subjectTitle !== "string" ||
    subjectTitle.trim() === "" ||
    subjectTitle.trim().length > 160 ||
    typeof assertedBy !== "string" ||
    assertedBy.trim() === "" ||
    assertedBy.trim().length > 120 ||
    assertedAt === undefined ||
    !Number.isFinite(authority) ||
    authority < 0 ||
    authority > 1
  )
    throw new Error("Structured Vault delivery metadata is invalid.");
  const effectiveFrom = timestampValue(values.effective_from);
  const effectiveTo = timestampValue(values.effective_to);
  if (
    (values.effective_from !== undefined && effectiveFrom === undefined) ||
    (values.effective_to !== undefined && effectiveTo === undefined) ||
    (effectiveFrom !== undefined &&
      effectiveTo !== undefined &&
      Date.parse(effectiveFrom) >= Date.parse(effectiveTo))
  )
    throw new Error("Structured Vault delivery metadata has invalid effective dates.");
  return {
    subject: {
      kind: kind as DeliveryObjectKind,
      key,
      title: subjectTitle.trim(),
    },
    assertedBy: assertedBy.trim(),
    assertedAt,
    ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
    authority: Math.min(authority, rootAuthority),
  };
};

const deliveryProjection = (
  root: VaultKnowledgeRoot,
  path: string,
  documentTitle: string,
  passages: KnowledgeSourceDocument["passages"],
  updatedAt: string,
  canonicalUrl: string,
  metadata?: DeliveryNoteMetadata | undefined,
): DeliveryProjection => {
  const projectRef = {
    kind: "project" as const,
    externalKey: `vault:${root.repository}:${root.pathPrefix}`,
  };
  const documentRef = {
    kind: "extension" as const,
    externalKey: `vault:${root.repository}:${path}`,
  };
  const sections = passages.filter(
    (passage, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.locator.split(":part-", 1)[0] === passage.locator.split(":part-", 1)[0],
      ) === index,
  );
  const status = sections.find((passage) => sectionTopic(passage.title) === "status");
  const statusSummary = status === undefined ? undefined : firstSummary(status.body, status.title);
  const metadataSubjectRef =
    metadata === undefined
      ? undefined
      : { kind: metadata.subject.kind, externalKey: metadata.subject.key };
  const objects: DeliveryObjectDraft[] = [
    {
      ...projectRef,
      title: root.pathPrefix.split("/").at(-1) ?? root.repository,
      lifecycleState: status === undefined ? "active" : (lifecycleState(status.body) ?? "active"),
      attributes: { repository: root.repository, pathPrefix: root.pathPrefix },
      sensitivity: root.sensitivity,
    },
    {
      ...documentRef,
      title: documentTitle,
      lifecycleState: status === undefined ? undefined : lifecycleState(status.body),
      attributes: { repository: root.repository, path },
      sensitivity: root.sensitivity,
    },
  ];
  if (metadataSubjectRef !== undefined && metadata !== undefined)
    objects.push({
      ...metadataSubjectRef,
      title: metadata.subject.title,
      lifecycleState: status === undefined ? undefined : lifecycleState(status.body),
      attributes: {
        repository: root.repository,
        path,
        assertionSource: "human",
        assertedBy: metadata.assertedBy,
        ...(statusSummary === undefined ? {} : { summary: statusSummary }),
      },
      sensitivity: root.sensitivity,
      effectiveFrom: metadata.effectiveFrom,
      effectiveTo: metadata.effectiveTo,
    });
  const relations: DeliveryProjection["relations"][number][] = [
    {
      kind: "contains",
      from: projectRef,
      to: documentRef,
      attributes: {},
      sensitivity: root.sensitivity,
    },
  ];
  if (metadataSubjectRef !== undefined)
    relations.push(
      {
        kind: "contains",
        from: projectRef,
        to: metadataSubjectRef,
        attributes: {},
        sensitivity: root.sensitivity,
      },
      {
        kind: "contains",
        from: metadataSubjectRef,
        to: documentRef,
        attributes: {},
        sensitivity: root.sensitivity,
      },
    );
  const claims: DeliveryProjection["claims"][number][] = [];
  const observations: DeliveryProjection["observations"][number][] = [];
  const seenJiraKeys = new Set<string>();
  for (const passage of sections) {
    const topic = sectionTopic(passage.title);
    const locator = passage.locator.split(":part-", 1)[0] ?? passage.locator;
    const sectionRef = {
      kind: objectKindForTopic(topic),
      externalKey: `vault:${root.repository}:${path}${locator}`,
    };
    const summary = firstSummary(passage.body, passage.title);
    objects.push({
      ...sectionRef,
      title: topic === "context" || topic === "status" ? passage.title : summary,
      lifecycleState:
        topic === "risk"
          ? "active"
          : topic === "decision"
            ? "recorded"
            : topic === "next_action"
              ? (lifecycleState(passage.body) ?? "planned")
              : lifecycleState(passage.body),
      attributes: {
        repository: root.repository,
        path,
        locator,
        topic,
        summary,
        ...(topic === "capacity" ? { label: "capacity" } : {}),
      },
      sensitivity: root.sensitivity,
    });
    relations.push({
      kind: "contains",
      from: metadataSubjectRef ?? documentRef,
      to: sectionRef,
      attributes: {},
      sensitivity: root.sensitivity,
    });
    if (topic === "ownership")
      relations.push({
        kind: "owns",
        from: sectionRef,
        to: metadataSubjectRef ?? documentRef,
        attributes: { locator },
        sensitivity: root.sensitivity,
      });
    if (topic === "next_action")
      relations.push({
        kind: "contributes_to",
        from: sectionRef,
        to: metadataSubjectRef ?? projectRef,
        attributes: { locator },
        sensitivity: root.sensitivity,
      });
    claims.push({
      subject: metadataSubjectRef ?? sectionRef,
      subjectKey: metadataSubjectRef?.externalKey ?? sectionRef.externalKey,
      predicate: metadata === undefined ? `vault.${topic}` : `delivery.${topic}`,
      value: summary,
      assertedBy: metadata?.assertedBy,
      assertedAt: metadata?.assertedAt ?? updatedAt,
      effectiveFrom: metadata?.effectiveFrom,
      effectiveTo: metadata?.effectiveTo,
      citationUrl: `${canonicalUrl}${locator}`,
      sensitivity: root.sensitivity,
      authority: metadata?.authority ?? root.authority ?? 0.9,
    });
    observations.push({
      kind: topic === "decision" ? "decision" : "change",
      externalId: `${path}:${locator}:${updatedAt}`,
      subject: sectionRef,
      summary: `Vault ${topic.replaceAll("_", " ")} updated: ${passage.title}`,
      dedupeKey: `vault:${root.repository}:${path}:${locator}`,
      occurredAt: updatedAt,
      citationUrl: `${canonicalUrl}${locator}`,
      sensitivity: root.sensitivity,
      authority: root.authority ?? 0.9,
    });
    for (const jiraKey of new Set(passage.body.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])) {
      const jiraRef = { kind: "work_item" as const, externalKey: jiraKey };
      if (!seenJiraKeys.has(jiraKey)) {
        seenJiraKeys.add(jiraKey);
        objects.push({
          ...jiraRef,
          title: jiraKey,
          attributes: { referencedBy: path },
          sensitivity: root.sensitivity,
        });
      }
      relations.push({
        kind: topic === "dependency" ? "depends_on" : "relates_to",
        from: sectionRef,
        to: jiraRef,
        attributes: { locator },
        sensitivity: root.sensitivity,
      });
    }
  }
  return { objects, relations, observations, metrics: [], claims };
};

const rootDocuments = async (
  configuration: VaultKnowledgeSourceConfiguration,
  root: VaultKnowledgeRoot,
): Promise<readonly KnowledgeSourceDocument[]> => {
  if (!repositoryPattern.test(root.repository) || !validPrefix(root.pathPrefix))
    throw new Error("Vault knowledge root must use a configured repository and relative prefix.");
  if (root.acl.length === 0)
    throw new Error("Vault knowledge root requires explicit ACL bindings.");
  const excluded = root.excludePathPrefixes ?? [];
  if (excluded.some((prefix) => !validPrefix(prefix) || !prefix.startsWith(root.pathPrefix)))
    throw new Error("Vault knowledge exclusions must remain within the configured root.");
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
    throw new Error("Configured Vault tree was truncated; narrow the configured root.");
  const updatedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
  if (updatedAt === undefined) throw new Error("Configured Vault revision has no timestamp.");
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

  const documents = await mapBounded(paths, 6, async ({ path, sha }) => {
    if (sha === "") throw new Error("Configured Vault Markdown blob has no revision identifier.");
    const content = await requestJson<GitContent>(
      configuration,
      `/repos/${root.repository}/git/blobs/${encodeURIComponent(sha)}`,
    );
    const markdown = decodeMarkdown(content);
    const metadata = deliveryNoteMetadata(markdown, root.authority ?? 0.9);
    const passages = chunkVaultMarkdown(markdown);
    if (passages.length === 0) return undefined;
    const documentTitle = title(markdown, path);
    const canonicalUrl = `https://github.com/${root.repository}/blob/${commit.sha}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    return {
      source: "vault",
      sourceId: configuration.sourceId,
      workspaceId: configuration.workspaceId,
      externalId: `${root.repository}:${path}`,
      sourceType: "note",
      sourceVersion: content.sha ?? sha,
      canonicalUrl,
      title: documentTitle,
      sourceUpdatedAt: updatedAt,
      sensitivity: root.sensitivity,
      authority: root.authority ?? 0.9,
      provenance: { repository: root.repository, path, revision: content.sha ?? sha },
      acl: root.acl,
      passages,
      deliveryProjection: deliveryProjection(
        root,
        path,
        documentTitle,
        passages,
        updatedAt,
        canonicalUrl,
        metadata,
      ),
    } satisfies KnowledgeSourceDocument;
  });
  return documents.filter((document) => document !== undefined);
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
          throw new Error("At least one configured Vault knowledge root is required.");
        const documents = (
          await Promise.all(configuration.roots.map((root) => rootDocuments(configuration, root)))
        ).flat();
        const ordered = [...documents].sort((left, right) =>
          left.externalId.localeCompare(right.externalId),
        );
        return {
          sourceId: configuration.sourceId,
          source: "vault",
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
          message: "Configured Vault knowledge synchronization failed.",
          operation: "vault-knowledge-sync",
        }),
    }),
});
