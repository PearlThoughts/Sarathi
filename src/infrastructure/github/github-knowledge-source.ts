import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  DeliveryObjectDraft,
  DeliveryObjectRef,
  DeliveryObservationKind,
  DeliveryProjection,
} from "../../modules/delivery-intelligence/index.ts";
import {
  createTypedPassage,
  type KnowledgeAclRule,
  type KnowledgePassageDraft,
  type KnowledgeSourceDocument,
  type KnowledgeSourceReader,
} from "../../modules/knowledge-layer/index.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GitHubKnowledgeRepository = {
  readonly repository: string;
  readonly branch?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
  readonly excludePathPrefixes?: readonly string[] | undefined;
};

export type GitHubKnowledgeSourceConfiguration = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly token: string;
  readonly repositories: readonly GitHubKnowledgeRepository[];
  readonly historySince?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly fetcher?: Fetcher | undefined;
};

type GitHubRepository = { readonly default_branch?: string };
type GitHubCommit = {
  readonly sha: string;
  readonly html_url?: string;
  readonly commit?: {
    readonly message?: string;
    readonly author?: { readonly date?: string; readonly name?: string };
    readonly committer?: { readonly date?: string; readonly name?: string };
  };
  readonly author?: { readonly login?: string; readonly html_url?: string } | null;
};
type GitHubTree = {
  readonly truncated?: boolean;
  readonly tree?: readonly {
    readonly path?: string;
    readonly type?: string;
    readonly sha?: string;
  }[];
};
type GitHubBlob = {
  readonly type?: string;
  readonly encoding?: string;
  readonly content?: string;
  readonly sha?: string;
  readonly size?: number;
};
type GitHubPull = {
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly state: string;
  readonly updated_at: string;
  readonly created_at: string;
  readonly merged_at?: string | null;
  readonly merge_commit_sha?: string | null;
  readonly user?: { readonly login?: string } | null;
  readonly head?: { readonly sha?: string };
};
type GitHubReview = {
  readonly id: number;
  readonly body?: string | null;
  readonly html_url?: string;
  readonly state?: string;
  readonly submitted_at?: string;
  readonly user?: { readonly login?: string } | null;
  readonly commit_id?: string;
};
type GitHubRelease = {
  readonly id: number;
  readonly name?: string | null;
  readonly tag_name: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly created_at: string;
  readonly published_at?: string | null;
  readonly author?: { readonly login?: string } | null;
};
type GitHubDeployment = {
  readonly id: number;
  readonly sha: string;
  readonly ref: string;
  readonly environment?: string;
  readonly description?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly creator?: { readonly login?: string } | null;
};
type GitHubCheckRun = {
  readonly id: number;
  readonly name: string;
  readonly html_url?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly app?: { readonly name?: string } | null;
};
type GitHubCheckRuns = { readonly check_runs?: readonly GitHubCheckRun[] };
type GitHubPullFile = { readonly filename?: string; readonly status?: string };

type RepositoryCursor = {
  readonly branch: string;
  readonly commitSha: string;
  readonly blobs: Readonly<Record<string, string>>;
  readonly activityUpdatedAt: string;
};
type GitHubCursor = {
  readonly version: 1;
  readonly scopeHash: string;
  readonly repositories: Readonly<Record<string, RepositoryCursor>>;
};

type Activity = {
  readonly kind: DeliveryObservationKind;
  readonly sourceType: string;
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
  readonly occurredAt: string;
  readonly actor?: string | undefined;
  readonly state?: string | undefined;
  readonly changedFiles?: readonly string[] | undefined;
  readonly workItemKeys?: readonly string[] | undefined;
};

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const codeExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "mdx",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "sql",
  "svelte",
  "swift",
  "tsx",
  "ts",
  "vue",
]);
const defaultExcludedSegments = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);
const sensitiveFilePattern =
  /(?:^|\/)(?:\.env(?:\.|$)|id_rsa|id_ed25519|.*\.(?:key|p12|pfx|pem)|secrets?\.(?:json|ya?ml|toml))$/i;

const encodeCursor = (cursor: GitHubCursor): string =>
  `github-v1:${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;

const parseCursor = (value: string): GitHubCursor | undefined => {
  if (!value.startsWith("github-v1:")) return undefined;
  const parsed = JSON.parse(
    Buffer.from(value.slice("github-v1:".length), "base64url").toString("utf8"),
  ) as GitHubCursor | undefined;
  return parsed?.version === 1 && typeof parsed.scopeHash === "string" ? parsed : undefined;
};

const repositoryPath = (repository: string): string =>
  repository.split("/").map(encodeURIComponent).join("/");

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const request = async (
  configuration: GitHubKnowledgeSourceConfiguration,
  path: string,
): Promise<Response> => {
  const response = await (configuration.fetcher ?? fetch)(`https://api.github.com${path}`, {
    headers: headers(configuration.token),
  });
  if (!response.ok) throw new Error(`GitHub knowledge read failed with HTTP ${response.status}.`);
  return response;
};

const requestJson = async <Value>(
  configuration: GitHubKnowledgeSourceConfiguration,
  path: string,
): Promise<Value> => (await request(configuration, path)).json() as Promise<Value>;

const paginated = async <Value>(
  configuration: GitHubKnowledgeSourceConfiguration,
  path: string,
  maximumPages = 20,
): Promise<readonly Value[]> => {
  const values: Value[] = [];
  let next: string | undefined = path;
  let pages = 0;
  while (next !== undefined) {
    if (pages >= maximumPages)
      throw new Error("GitHub activity pagination exceeded its safety bound.");
    const response = await request(configuration, next);
    values.push(...((await response.json()) as readonly Value[]));
    const link = response.headers.get("link");
    const nextUrl = link
      ?.split(",")
      .map((part) => part.trim())
      .find((part) => part.endsWith('rel="next"'))
      ?.match(/^<([^>]+)>/)?.[1];
    next = nextUrl === undefined ? undefined : new URL(nextUrl).pathname + new URL(nextUrl).search;
    pages += 1;
  }
  return values;
};

const mapBounded = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> => {
  const results: Output[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency)
    results.push(...(await Promise.all(values.slice(offset, offset + concurrency).map(transform))));
  return results;
};

const pathExcluded = (path: string, configured: readonly string[]): boolean => {
  const segments = path.split("/");
  return (
    sensitiveFilePattern.test(path) ||
    segments.some((segment) => defaultExcludedSegments.has(segment)) ||
    configured.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
};

const isCodePath = (path: string): boolean => {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && codeExtensions.has(extension);
};

const languageFromPath = (path: string): string => path.split(".").at(-1)?.toLowerCase() ?? "text";

const decodeBlob = (blob: GitHubBlob): string => {
  if (blob.encoding !== "base64" || blob.content === undefined || blob.type === "tree")
    throw new Error("GitHub code blob was not a decodable file.");
  return Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
};

type SymbolSection = { readonly name: string; readonly start: number; readonly end: number };

const symbolSections = (body: string): readonly SymbolSection[] => {
  const lines = body.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => {
    const match = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|enum|type|function|def|func|struct|trait|impl)\s+([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=|:)/,
    );
    const name = match?.[1] ?? match?.[2];
    return name === undefined ? [] : [{ name, start: index + 1 }];
  });
  if (starts.length === 0) return [{ name: "file", start: 1, end: Math.max(lines.length, 1) }];
  return starts.map((section, index) => ({
    ...section,
    end: (starts[index + 1]?.start ?? lines.length + 1) - 1,
  }));
};

const codePassages = (body: string, path: string): readonly KnowledgePassageDraft[] => {
  const lines = body.split(/\r?\n/);
  const symbols = symbolSections(body);
  const sections = [
    ...(symbols[0]?.start !== undefined && symbols[0].start > 1
      ? [{ name: "file-preamble", start: 1, end: symbols[0].start - 1 }]
      : []),
    ...symbols,
  ];
  let ordinal = 0;
  return sections.flatMap(({ name, start, end }) => {
    const passages: KnowledgePassageDraft[] = [];
    let chunkStart = start;
    while (chunkStart <= end) {
      let chunkEnd = chunkStart;
      let characters = 0;
      while (chunkEnd <= end) {
        const length = (lines[chunkEnd - 1]?.length ?? 0) + 1;
        if (characters > 0 && characters + length > 6_000) break;
        characters += length;
        chunkEnd += 1;
      }
      const inclusiveEnd = Math.max(chunkStart, chunkEnd - 1);
      const passage = createTypedPassage(
        "symbol",
        `#L${chunkStart}-L${inclusiveEnd}:${encodeURIComponent(name)}`,
        ordinal,
        `${path} — ${name}`,
        lines.slice(chunkStart - 1, inclusiveEnd).join("\n"),
      );
      if (passage !== undefined) {
        passages.push(passage);
        ordinal += 1;
      }
      chunkStart = inclusiveEnd + 1;
    }
    return passages;
  });
};

const workItemKeys = (value: string): readonly string[] => [
  ...new Set(value.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []),
];

const activityProjection = (
  repository: GitHubKnowledgeRepository,
  activity: Activity,
): DeliveryProjection => {
  const repoRef: DeliveryObjectRef = {
    kind: "module",
    externalKey: `github:${repository.repository}`,
  };
  const actorRef: DeliveryObjectRef | undefined =
    activity.actor === undefined
      ? undefined
      : { kind: "person", externalKey: `github:${activity.actor}` };
  const objects: DeliveryObjectDraft[] = [
    {
      ...repoRef,
      title: repository.repository,
      lifecycleState: "active",
      attributes: { repository: repository.repository },
      sensitivity: repository.sensitivity,
    },
    ...(actorRef === undefined
      ? []
      : [
          {
            ...actorRef,
            title: activity.actor ?? "GitHub actor",
            lifecycleState: "active",
            attributes: { provider: "github" },
            sensitivity: repository.sensitivity,
          } satisfies DeliveryObjectDraft,
        ]),
  ];
  const relations: DeliveryProjection["relations"][number][] = [];
  for (const key of activity.workItemKeys ?? []) {
    const workItem: DeliveryObjectRef = { kind: "work_item", externalKey: key };
    objects.push({
      ...workItem,
      title: key,
      attributes: { referencedBy: activity.url },
      sensitivity: repository.sensitivity,
    });
    relations.push({
      kind:
        activity.kind === "commit" || activity.kind === "pull_request"
          ? "implements"
          : "relates_to",
      from: repoRef,
      to: workItem,
      attributes: { activityId: activity.id },
      sensitivity: repository.sensitivity,
    });
  }
  if (actorRef !== undefined)
    relations.push({
      kind: "participates_in",
      from: actorRef,
      to: repoRef,
      attributes: { activityId: activity.id },
      sensitivity: repository.sensitivity,
    });
  return {
    objects,
    relations,
    observations: [
      {
        kind: activity.kind,
        externalId: activity.id,
        subject: repoRef,
        actorExternalKey: activity.actor === undefined ? undefined : `github:${activity.actor}`,
        summary: activity.title,
        dedupeKey: `github:${repository.repository}:${activity.kind}:${activity.id}`,
        occurredAt: activity.occurredAt,
        citationUrl: activity.url,
        sensitivity: repository.sensitivity,
        authority: repository.authority ?? 0.92,
      },
    ],
    metrics: [],
    claims: [],
  };
};

const activityDocument = (
  configuration: GitHubKnowledgeSourceConfiguration,
  repository: GitHubKnowledgeRepository,
  activity: Activity,
): KnowledgeSourceDocument | undefined => {
  const body = [activity.title, activity.body, activity.state].filter(Boolean).join("\n\n");
  const passage = createTypedPassage("activity", "#activity", 0, activity.title, body);
  if (passage === undefined) return undefined;
  return {
    source: "github",
    sourceId: configuration.sourceId,
    workspaceId: configuration.workspaceId,
    externalId: `${repository.repository}:activity:${activity.sourceType}:${activity.id}`,
    sourceType: activity.sourceType,
    sourceVersion: activity.version,
    canonicalUrl: activity.url,
    title: activity.title,
    sourceCreatedAt: activity.createdAt,
    sourceUpdatedAt: activity.occurredAt,
    sensitivity: repository.sensitivity,
    authority: repository.authority ?? 0.92,
    provenance: {
      repository: repository.repository,
      activityKind: activity.kind,
      activityType: activity.sourceType,
      activityId: activity.id,
      ...(activity.changedFiles === undefined
        ? {}
        : { changedFiles: activity.changedFiles.join(",") }),
    },
    acl: repository.acl,
    passages: [passage],
    deliveryProjection: activityProjection(repository, activity),
  };
};

const readActivities = async (
  configuration: GitHubKnowledgeSourceConfiguration,
  repository: GitHubKnowledgeRepository,
  branch: string,
  historySince: string,
  previousUpdatedAt?: string,
): Promise<readonly Activity[]> => {
  const repoPath = repositoryPath(repository.repository);
  const [pulls, commits, releases, deployments, checks] = await Promise.all([
    paginated<GitHubPull>(
      configuration,
      `/repos/${repoPath}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
    ),
    paginated<GitHubCommit>(
      configuration,
      `/repos/${repoPath}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(historySince)}&per_page=100`,
    ),
    paginated<GitHubRelease>(configuration, `/repos/${repoPath}/releases?per_page=100`),
    paginated<GitHubDeployment>(configuration, `/repos/${repoPath}/deployments?per_page=100`),
    requestJson<GitHubCheckRuns>(
      configuration,
      `/repos/${repoPath}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`,
    ),
  ]);
  const threshold = Date.parse(previousUpdatedAt ?? historySince);
  const selectedPulls = pulls.filter(
    (pull) =>
      Date.parse(pull.updated_at) >= Date.parse(historySince) &&
      Date.parse(pull.updated_at) >= threshold,
  );
  const pullDetails = await mapBounded(selectedPulls, 4, async (pull) => {
    const [reviews, files] = await Promise.all([
      paginated<GitHubReview>(
        configuration,
        `/repos/${repoPath}/pulls/${pull.number}/reviews?per_page=100`,
      ),
      pull.merged_at == null
        ? Promise.resolve([] as readonly GitHubPullFile[])
        : paginated<GitHubPullFile>(
            configuration,
            `/repos/${repoPath}/pulls/${pull.number}/files?per_page=100`,
          ),
    ]);
    return { pull, reviews, files };
  });
  return [
    ...pullDetails.flatMap(({ pull, reviews, files }): readonly Activity[] => [
      {
        kind: "pull_request",
        sourceType: "pull_request",
        id: String(pull.number),
        version: `${pull.updated_at}:${pull.head?.sha ?? pull.merge_commit_sha ?? "unknown"}`,
        title: `PR #${pull.number}: ${pull.title}`,
        body: pull.body ?? "",
        url: pull.html_url,
        createdAt: pull.created_at,
        occurredAt: pull.updated_at,
        actor: pull.user?.login,
        state: pull.merged_at == null ? pull.state : "merged",
        changedFiles: files.flatMap(({ filename }) => (filename === undefined ? [] : [filename])),
        workItemKeys: workItemKeys(`${pull.title}\n${pull.body ?? ""}`),
      },
      ...reviews.flatMap((review): readonly Activity[] => {
        if (review.submitted_at === undefined || Date.parse(review.submitted_at) < threshold)
          return [];
        return [
          {
            kind: "review",
            sourceType: "review",
            id: String(review.id),
            version: `${review.submitted_at}:${review.commit_id ?? "unknown"}:${review.state ?? ""}`,
            title: `Review on PR #${pull.number}: ${review.state ?? "submitted"}`,
            body: review.body ?? "",
            url: review.html_url ?? pull.html_url,
            createdAt: review.submitted_at,
            occurredAt: review.submitted_at,
            actor: review.user?.login,
            state: review.state,
            workItemKeys: workItemKeys(`${pull.title}\n${pull.body ?? ""}`),
          },
        ];
      }),
    ]),
    ...commits.flatMap((commit): readonly Activity[] => {
      const occurredAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
      if (occurredAt === undefined || Date.parse(occurredAt) < threshold) return [];
      const message = commit.commit?.message ?? commit.sha;
      return [
        {
          kind: "commit",
          sourceType: "commit",
          id: commit.sha,
          version: commit.sha,
          title: message.split(/\r?\n/, 1)[0] ?? commit.sha,
          body: message,
          url:
            commit.html_url ?? `https://github.com/${repository.repository}/commit/${commit.sha}`,
          createdAt: occurredAt,
          occurredAt,
          actor: commit.author?.login ?? commit.commit?.author?.name,
          workItemKeys: workItemKeys(message),
        },
      ];
    }),
    ...releases.flatMap((release): readonly Activity[] => {
      const occurredAt = release.published_at ?? release.created_at;
      if (Date.parse(occurredAt) < threshold) return [];
      return [
        {
          kind: "deployment",
          sourceType: "release",
          id: `release:${release.id}`,
          version: `${release.id}:${occurredAt}`,
          title: `Release ${release.name ?? release.tag_name}`,
          body: release.body ?? release.tag_name,
          url: release.html_url,
          createdAt: release.created_at,
          occurredAt,
          actor: release.author?.login,
          state: "released",
          workItemKeys: workItemKeys(`${release.name ?? ""}\n${release.body ?? ""}`),
        },
      ];
    }),
    ...deployments.flatMap((deployment): readonly Activity[] => {
      if (Date.parse(deployment.updated_at) < threshold) return [];
      return [
        {
          kind: "deployment",
          sourceType: "deployment",
          id: `deployment:${deployment.id}`,
          version: `${deployment.id}:${deployment.updated_at}:${deployment.sha}`,
          title: `Deployment to ${deployment.environment ?? deployment.ref}`,
          body: deployment.description ?? deployment.sha,
          url: `https://github.com/${repository.repository}/deployments/${deployment.environment ?? deployment.id}`,
          createdAt: deployment.created_at,
          occurredAt: deployment.updated_at,
          actor: deployment.creator?.login,
          state: deployment.environment,
        },
      ];
    }),
    ...(checks.check_runs ?? []).flatMap((check): readonly Activity[] => {
      const occurredAt = check.completed_at ?? check.started_at;
      if (occurredAt == null || Date.parse(occurredAt) < threshold) return [];
      return [
        {
          kind: "check",
          sourceType: "check",
          id: String(check.id),
          version: `${check.id}:${occurredAt}:${check.conclusion ?? check.status ?? "unknown"}`,
          title: `Check ${check.name}: ${check.conclusion ?? check.status ?? "unknown"}`,
          body: check.app?.name ?? check.name,
          url: check.html_url ?? `https://github.com/${repository.repository}/actions`,
          createdAt: check.started_at ?? occurredAt,
          occurredAt,
          actor: check.app?.name,
          state: check.conclusion ?? check.status,
        },
      ];
    }),
  ].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  );
};

const readRepository = async (
  configuration: GitHubKnowledgeSourceConfiguration,
  repository: GitHubKnowledgeRepository,
  historySince: string,
  previous?: RepositoryCursor,
): Promise<{
  readonly documents: readonly KnowledgeSourceDocument[];
  readonly retiredExternalIds: readonly string[];
  readonly cursor: RepositoryCursor;
}> => {
  if (!repositoryPattern.test(repository.repository) || repository.acl.length === 0)
    throw new Error("GitHub knowledge repositories require a valid identity and explicit ACL.");
  const repoPath = repositoryPath(repository.repository);
  const metadata = await requestJson<GitHubRepository>(configuration, `/repos/${repoPath}`);
  const branch = repository.branch ?? metadata.default_branch;
  if (branch === undefined || branch.trim() === "")
    throw new Error("GitHub repository default branch could not be resolved.");
  const commit = await requestJson<GitHubCommit>(
    configuration,
    `/repos/${repoPath}/commits/${encodeURIComponent(branch)}`,
  );
  const tree = await requestJson<GitHubTree>(
    configuration,
    `/repos/${repoPath}/git/trees/${encodeURIComponent(commit.sha)}?recursive=1`,
  );
  if (tree.truncated === true)
    throw new Error(
      "GitHub repository tree was truncated; repository indexing cannot safely reconcile.",
    );
  const updatedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
  if (updatedAt === undefined) throw new Error("GitHub default branch revision has no timestamp.");
  const paths = (tree.tree ?? [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path !== undefined &&
        entry.sha !== undefined &&
        isCodePath(entry.path) &&
        !pathExcluded(entry.path, repository.excludePathPrefixes ?? []),
    )
    .map((entry) => ({ path: entry.path as string, sha: entry.sha as string }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const blobs = Object.fromEntries(
    paths.map(({ path, sha }) => [`${repository.repository}:${path}`, sha]),
  );
  const retiredExternalIds =
    previous === undefined
      ? []
      : Object.keys(previous.blobs).filter((externalId) => blobs[externalId] === undefined);
  const changedPaths = paths.filter(
    ({ path, sha }) => previous?.blobs[`${repository.repository}:${path}`] !== sha,
  );
  const codeDocuments = await mapBounded(changedPaths, 6, async ({ path, sha }) => {
    const blob = await requestJson<GitHubBlob>(
      configuration,
      `/repos/${repoPath}/git/blobs/${sha}`,
    );
    if ((blob.size ?? 0) > 1_000_000) {
      retiredExternalIds.push(`${repository.repository}:${path}`);
      return undefined;
    }
    const body = decodeBlob(blob);
    if (body.includes("\u0000")) {
      retiredExternalIds.push(`${repository.repository}:${path}`);
      return undefined;
    }
    const passages = codePassages(body, path);
    if (passages.length === 0) {
      retiredExternalIds.push(`${repository.repository}:${path}`);
      return undefined;
    }
    return {
      source: "github",
      sourceId: configuration.sourceId,
      workspaceId: configuration.workspaceId,
      externalId: `${repository.repository}:${path}`,
      sourceType: "code",
      sourceVersion: blob.sha ?? sha,
      canonicalUrl: `https://github.com/${repository.repository}/blob/${commit.sha}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      title: path,
      sourceUpdatedAt: updatedAt,
      sensitivity: repository.sensitivity,
      authority: repository.authority ?? 0.86,
      provenance: {
        repository: repository.repository,
        branch,
        revision: commit.sha,
        blob: blob.sha ?? sha,
        path,
        language: languageFromPath(path),
      },
      acl: repository.acl,
      passages,
    } satisfies KnowledgeSourceDocument;
  });
  const activities = await readActivities(
    configuration,
    repository,
    branch,
    historySince,
    previous?.activityUpdatedAt,
  );
  const activityDocuments = activities.flatMap((activity) => {
    const document = activityDocument(configuration, repository, activity);
    return document === undefined ? [] : [document];
  });
  const activityUpdatedAt = activities.reduce(
    (latest, activity) => (activity.occurredAt > latest ? activity.occurredAt : latest),
    previous?.activityUpdatedAt ?? historySince,
  );
  return {
    documents: [
      ...codeDocuments.filter((document) => document !== undefined),
      ...activityDocuments,
    ],
    retiredExternalIds: [...new Set(retiredExternalIds)].sort(),
    cursor: { branch, commitSha: commit.sha, blobs, activityUpdatedAt },
  };
};

export const createGitHubKnowledgeSource = (
  configuration: GitHubKnowledgeSourceConfiguration,
): KnowledgeSourceReader => ({
  readSnapshot: (workspaceId, previousCursor) =>
    Effect.tryPromise({
      try: async () => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("GitHub knowledge source was requested for another workspace.");
        if (configuration.repositories.length === 0)
          throw new Error("At least one GitHub knowledge repository is required.");
        const scopeHash = stableSha256(
          JSON.stringify(
            configuration.repositories.map(
              ({ repository, branch, sensitivity, acl, authority, excludePathPrefixes }) => ({
                repository,
                branch,
                sensitivity,
                acl,
                authority,
                excludePathPrefixes,
              }),
            ),
          ),
        );
        const decoded = previousCursor === undefined ? undefined : parseCursor(previousCursor);
        const previous = decoded?.scopeHash === scopeHash ? decoded : undefined;
        const now = configuration.now?.() ?? new Date();
        const historySince =
          configuration.historySince ??
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()),
          ).toISOString();
        if (!Number.isFinite(Date.parse(historySince)) || Date.parse(historySince) > now.getTime())
          throw new Error("GitHub activity history start is invalid.");
        const reads = await mapBounded(configuration.repositories, 3, (repository) =>
          readRepository(
            configuration,
            repository,
            historySince,
            previous?.repositories[repository.repository],
          ),
        );
        const repositories = Object.fromEntries(
          configuration.repositories.map((repository, index) => [
            repository.repository,
            reads[index]?.cursor,
          ]),
        ) as Readonly<Record<string, RepositoryCursor>>;
        return {
          sourceId: configuration.sourceId,
          source: "github",
          workspaceId,
          cursor: encodeCursor({ version: 1, scopeHash, repositories }),
          scopeHash,
          mode: previous === undefined ? "full" : "delta",
          retiredExternalIds: reads.flatMap((read) => read.retiredExternalIds),
          documents: reads
            .flatMap((read) => read.documents)
            .sort((left, right) => left.externalId.localeCompare(right.externalId)),
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Configured GitHub knowledge synchronization failed.",
          operation: "github-knowledge-sync",
        }),
    }),
});
