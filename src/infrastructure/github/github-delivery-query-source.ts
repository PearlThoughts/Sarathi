import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQueryResult,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import { createGitHubKnowledgeSearch } from "./github-knowledge-search.ts";
import {
  type GitHubRepositoryScope,
  githubRepositoryAllowed,
  githubScopeQualifier,
  repositoryFromGitHubApiUrl,
  repositoryFromGitHubHtmlUrl,
  validGitHubRepository,
  validGitHubRepositoryScope,
} from "./github-repository-scope.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type GitHubPull = {
  readonly number?: number;
  readonly title?: string;
  readonly html_url?: string;
  readonly updated_at?: string;
  readonly merged_at?: string | null;
  readonly merge_commit_sha?: string | null;
  readonly state?: string;
};
type GitHubCommit = {
  readonly sha?: string;
  readonly html_url?: string;
  readonly commit?: {
    readonly message?: string;
    readonly author?: { readonly date?: string };
    readonly committer?: { readonly date?: string };
  };
};
type GitHubSearchPull = GitHubPull & {
  readonly repository_url?: string;
  readonly pull_request?: { readonly merged_at?: string | null };
};
type GitHubSearchCommit = GitHubCommit & { readonly repository?: { readonly full_name?: string } };
type GitHubSearchResponse<Value> = {
  readonly incomplete_results?: boolean;
  readonly items?: readonly Value[];
};

export type GitHubDeliveryQueryConfiguration = {
  readonly token: string;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly allowedRepositories?: readonly string[] | undefined;
  readonly repositoryScopes?: readonly GitHubRepositoryScope[] | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
  readonly authority?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetcher?: Fetcher | undefined;
};

const emptyResult = (): DeliveryQueryResult => ({
  items: [],
  conflicts: [],
  unavailableSources: [],
  complete: true,
});

const firstLine = (value: string | undefined): string =>
  (value ?? "Commit").split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim().slice(0, 160) || "Commit";

const repositoryPath = (repository: string): string =>
  repository
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

const operationWindow = (
  operation: DeliveryQueryOperation,
  context: DeliveryQueryContext,
): { readonly fromInclusive: string; readonly toExclusive: string } | undefined => {
  if (operation.time === undefined || operation.time.kind === "jira_sprint") return undefined;
  return resolveDeliveryTimeConstraint(operation.time, context.requestedAt, context.timeZone);
};

const requestJson = async <Value>(
  configuration: GitHubDeliveryQueryConfiguration,
  url: URL,
): Promise<Value> => {
  const response = await (configuration.fetcher ?? fetch)(url, {
    headers: {
      Authorization: `Bearer ${configuration.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(configuration.timeoutMs ?? 4_000),
  });
  if (!response.ok) throw new Error(`GitHub delivery query failed with HTTP ${response.status}.`);
  return (await response.json()) as Value;
};

const readRepositoryActivity = async (
  configuration: GitHubDeliveryQueryConfiguration,
  repository: string,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
): Promise<readonly DeliveryResultItem[]> => {
  const path = repositoryPath(repository);
  const pullUrl = new URL(`https://api.github.com/repos/${path}/pulls`);
  pullUrl.searchParams.set("state", "all");
  pullUrl.searchParams.set("sort", "updated");
  pullUrl.searchParams.set("direction", "desc");
  pullUrl.searchParams.set("per_page", String(operation.limit));
  const commitUrl = new URL(`https://api.github.com/repos/${path}/commits`);
  const window = operationWindow(operation, context);
  if (window !== undefined) {
    commitUrl.searchParams.set("since", window.fromInclusive);
    commitUrl.searchParams.set("until", window.toExclusive);
  }
  commitUrl.searchParams.set("per_page", String(operation.limit));
  const [pulls, commits] = await Promise.all([
    requestJson<readonly GitHubPull[]>(configuration, pullUrl),
    requestJson<readonly GitHubCommit[]>(configuration, commitUrl),
  ]);
  const sensitivity = configuration.sensitivity ?? "internal";
  const authority = configuration.authority ?? 0.9;
  const inWindow = (value: string | null | undefined): value is string => {
    if (value == null) return false;
    if (window === undefined) return true;
    const timestamp = Date.parse(value);
    return (
      timestamp >= Date.parse(window.fromInclusive) && timestamp < Date.parse(window.toExclusive)
    );
  };
  const mergeCommits = new Set(
    pulls.flatMap((pull) => (pull.merge_commit_sha == null ? [] : [pull.merge_commit_sha])),
  );
  const pullItems = pulls.flatMap((pull): readonly DeliveryResultItem[] => {
    const observedAt = pull.merged_at ?? pull.updated_at;
    if (
      pull.number === undefined ||
      pull.title === undefined ||
      pull.html_url === undefined ||
      !pull.html_url.startsWith(`https://github.com/${repository}/`) ||
      !inWindow(observedAt) ||
      (operation.purpose === "delivered" && pull.merged_at == null) ||
      (operation.purpose === "current_work" && pull.state !== "open")
    )
      return [];
    const action = pull.merged_at == null ? "updated" : "merged";
    return [
      {
        id: `github:${repository}:pull:${pull.number}`,
        workspaceId: context.workspaceId,
        source: "github",
        selector: "observations",
        intent: operation.purpose,
        title: pull.title,
        summary: `PR #${pull.number} ${action}: ${pull.title}`,
        citationUrl: pull.html_url,
        sensitivity,
        authority: authority + 0.05,
        observedAt,
        dedupeKey: `github:${repository}:pull:${pull.number}:${action}`,
      },
    ];
  });
  const commitItems = commits.flatMap((commit): readonly DeliveryResultItem[] => {
    const observedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
    if (
      commit.sha === undefined ||
      commit.html_url === undefined ||
      mergeCommits.has(commit.sha) ||
      !commit.html_url.startsWith(`https://github.com/${repository}/commit/`) ||
      !inWindow(observedAt) ||
      operation.purpose === "current_work"
    )
      return [];
    const summary = firstLine(commit.commit?.message);
    return [
      {
        id: `github:${repository}:commit:${commit.sha}`,
        workspaceId: context.workspaceId,
        source: "github",
        selector: "observations",
        intent: operation.purpose,
        title: summary,
        summary: `${commit.sha.slice(0, 7)} ${summary}`,
        citationUrl: commit.html_url,
        sensitivity,
        authority,
        observedAt,
        dedupeKey: `github:${repository}:commit:${commit.sha}`,
      },
    ];
  });
  return [...pullItems, ...commitItems]
    .sort((left, right) => Date.parse(right.observedAt ?? "") - Date.parse(left.observedAt ?? ""))
    .slice(0, operation.limit);
};

const dateRangeQualifier = (
  field: "updated" | "committer-date",
  window: { readonly fromInclusive: string; readonly toExclusive: string } | undefined,
): string => {
  if (window === undefined) return "";
  const from = window.fromInclusive.slice(0, 10);
  const inclusiveEnd = new Date(Date.parse(window.toExclusive) - 1).toISOString().slice(0, 10);
  return ` ${field}:${from}..${inclusiveEnd}`;
};

const readScopedActivity = async (
  configuration: GitHubDeliveryQueryConfiguration,
  scope: GitHubRepositoryScope,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
): Promise<readonly DeliveryResultItem[]> => {
  const allowedRepositories = configuration.allowedRepositories ?? [];
  const repositoryScopes = configuration.repositoryScopes ?? [];
  const window = operationWindow(operation, context);
  const qualifier = githubScopeQualifier(scope);
  const stateQualifier =
    operation.purpose === "delivered"
      ? " is:merged"
      : operation.purpose === "current_work"
        ? " is:open"
        : "";
  const pullsUrl = new URL("https://api.github.com/search/issues");
  pullsUrl.searchParams.set(
    "q",
    `${qualifier} is:pr${stateQualifier}${dateRangeQualifier("updated", window)}`,
  );
  pullsUrl.searchParams.set("sort", "updated");
  pullsUrl.searchParams.set("order", "desc");
  pullsUrl.searchParams.set("per_page", String(operation.limit));

  const commitsUrl = new URL("https://api.github.com/search/commits");
  commitsUrl.searchParams.set("q", `${qualifier}${dateRangeQualifier("committer-date", window)}`);
  commitsUrl.searchParams.set("sort", "committer-date");
  commitsUrl.searchParams.set("order", "desc");
  commitsUrl.searchParams.set("per_page", String(operation.limit));

  const [pullResponse, commitResponse] = await Promise.all([
    requestJson<GitHubSearchResponse<GitHubSearchPull>>(configuration, pullsUrl),
    operation.purpose === "current_work"
      ? Promise.resolve({ items: [] } as GitHubSearchResponse<GitHubSearchCommit>)
      : requestJson<GitHubSearchResponse<GitHubSearchCommit>>(configuration, commitsUrl),
  ]);
  const sensitivity = configuration.sensitivity ?? "internal";
  const authority = configuration.authority ?? 0.9;
  const pullItems = (pullResponse.items ?? []).flatMap((pull): readonly DeliveryResultItem[] => {
    const repository =
      repositoryFromGitHubApiUrl(pull.repository_url) ??
      (pull.html_url === undefined ? undefined : repositoryFromGitHubHtmlUrl(pull.html_url));
    const mergedAt = pull.pull_request?.merged_at ?? pull.merged_at;
    const observedAt = mergedAt ?? pull.updated_at;
    if (
      repository === undefined ||
      !githubRepositoryAllowed(repository, allowedRepositories, repositoryScopes) ||
      pull.number === undefined ||
      pull.title === undefined ||
      pull.html_url === undefined ||
      observedAt === undefined
    )
      return [];
    const action = mergedAt == null ? "updated" : "merged";
    return [
      {
        id: `github:${repository}:pull:${pull.number}`,
        workspaceId: context.workspaceId,
        source: "github",
        selector: "observations",
        intent: operation.purpose,
        title: pull.title,
        summary: `PR #${pull.number} ${action}: ${pull.title}`,
        citationUrl: pull.html_url,
        sensitivity,
        authority: authority + 0.05,
        observedAt,
        dedupeKey: `github:${repository}:pull:${pull.number}:${action}`,
      },
    ];
  });
  const commitItems = (commitResponse.items ?? []).flatMap(
    (commit): readonly DeliveryResultItem[] => {
      const repository =
        commit.repository?.full_name ??
        (commit.html_url === undefined ? undefined : repositoryFromGitHubHtmlUrl(commit.html_url));
      const observedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
      const summary = firstLine(commit.commit?.message);
      if (
        repository === undefined ||
        !githubRepositoryAllowed(repository, allowedRepositories, repositoryScopes) ||
        commit.sha === undefined ||
        commit.html_url === undefined ||
        observedAt === undefined ||
        /^Merge pull request\b/i.test(summary)
      )
        return [];
      return [
        {
          id: `github:${repository}:commit:${commit.sha}`,
          workspaceId: context.workspaceId,
          source: "github",
          selector: "observations",
          intent: operation.purpose,
          title: summary,
          summary: `${commit.sha.slice(0, 7)} ${summary}`,
          citationUrl: commit.html_url,
          sensitivity,
          authority,
          observedAt,
          dedupeKey: `github:${repository}:commit:${commit.sha}`,
        },
      ];
    },
  );
  return [...pullItems, ...commitItems]
    .sort((left, right) => Date.parse(right.observedAt ?? "") - Date.parse(left.observedAt ?? ""))
    .slice(0, operation.limit);
};

export const createGitHubDeliveryQuerySource = (
  configuration: GitHubDeliveryQueryConfiguration,
): DeliveryQuerySource => {
  const allowedRepositories = configuration.allowedRepositories ?? [];
  const repositoryScopes = configuration.repositoryScopes ?? [];
  const liveSearch = createGitHubKnowledgeSearch({
    token: configuration.token,
    workspaceId: configuration.workspaceId,
    allowedAudienceIds: configuration.allowedActorIds,
    allowedRepositories,
    repositoryScopes,
    fetcher: configuration.fetcher,
    timeoutMs: configuration.timeoutMs,
  });
  return {
    source: "github",
    selectors: ["observations", "github_live"],
    execute: (context, plan) =>
      Effect.tryPromise({
        try: async () => {
          const sourceSensitivity = configuration.sensitivity ?? "internal";
          if (
            context.workspaceId !== configuration.workspaceId ||
            !configuration.allowedActorIds.has(context.actorId) ||
            !isSensitivityAtOrBelow(sourceSensitivity, context.maximumSensitivity) ||
            (allowedRepositories.length === 0 && repositoryScopes.length === 0) ||
            allowedRepositories.length > 50 ||
            repositoryScopes.length > 10 ||
            allowedRepositories.some((repository) => !validGitHubRepository(repository)) ||
            repositoryScopes.some((scope) => !validGitHubRepositoryScope(scope))
          )
            return emptyResult();
          const selected = plan.operations.filter(
            (operation) =>
              operation.select === "observations" || operation.select === "github_live",
          );
          const responses = await Promise.all(
            selected.map(async (operation) => {
              if (operation.select === "github_live") {
                const matches = await Effect.runPromise(
                  liveSearch.search({
                    question: context.question,
                    audience: {
                      workspaceId: context.workspaceId,
                      audienceIds: [context.actorId],
                      maximumSensitivity: context.maximumSensitivity,
                    },
                    topK: operation.limit,
                  }),
                );
                return matches.map(
                  (match): DeliveryResultItem => ({
                    id: match.id,
                    workspaceId: context.workspaceId,
                    source: "github",
                    selector: "github_live",
                    intent: operation.purpose,
                    title: match.title,
                    summary: `${match.title}: ${match.excerpt}`,
                    citationUrl: match.citationUrl,
                    sensitivity: match.sensitivity,
                    authority: match.authority,
                    observedAt: match.sourceUpdatedAt,
                    dedupeKey: match.citationUrl,
                  }),
                );
              }
              return (
                await Promise.all([
                  ...allowedRepositories.map((repository) =>
                    readRepositoryActivity(configuration, repository, context, operation),
                  ),
                  ...repositoryScopes.map((scope) =>
                    readScopedActivity(configuration, scope, context, operation),
                  ),
                ])
              ).flat();
            }),
          );
          return { items: responses.flat(), conflicts: [], unavailableSources: [], complete: true };
        },
        catch: () =>
          new RepositoryError({
            message: "Connected GitHub delivery information is unavailable.",
            operation: "delivery-query-github",
          }),
      }),
  };
};
