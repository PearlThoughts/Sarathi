import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type {
  KnowledgeLiveSearch,
  KnowledgeQuery,
  KnowledgeSearchResult,
} from "../../modules/knowledge-layer/index.ts";

type GitHubSearchItem = {
  readonly html_url: string;
  readonly name?: string;
  readonly path?: string;
  readonly repository_url?: string;
  readonly number?: number;
  readonly title?: string;
  readonly body?: string | null;
  readonly updated_at?: string;
  readonly text_matches?: readonly { readonly fragment?: string }[];
};

type GitHubSearchResponse = {
  readonly incomplete_results: boolean;
  readonly items: readonly GitHubSearchItem[];
};

export type GitHubKnowledgeSearchConfiguration = {
  readonly token: string;
  readonly workspaceId: string;
  readonly allowedAudienceIds: ReadonlySet<string>;
  readonly allowedRepositories: readonly string[];
  readonly fetcher?: Fetcher | undefined;
  readonly now?: (() => Date) | undefined;
  readonly perRepositoryLimit?: number | undefined;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const safeQuestion = (question: string): string =>
  [...question]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

const repositoryFromApiUrl = (value: string | undefined): string | undefined =>
  value?.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/)?.[1];

const excerpt = (item: GitHubSearchItem): string =>
  (
    item.text_matches?.map(({ fragment }) => fragment).find(Boolean) ??
    item.body ??
    item.title ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

const searchUrl = (
  kind: "issues" | "code",
  question: string,
  repository: string,
  limit: number,
): string => {
  const url = new URL(`https://api.github.com/search/${kind}`);
  url.searchParams.set("q", `${question} repo:${repository}`);
  url.searchParams.set("per_page", String(limit));
  return url.toString();
};

const freshness = (updatedAt: string, now: Date): number => {
  const ageDays = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  return Math.max(0, 1 - ageDays / 90);
};

const readSearch = async (
  configuration: GitHubKnowledgeSearchConfiguration,
  kind: "issues" | "code",
  repository: string,
  question: string,
  limit: number,
): Promise<GitHubSearchResponse> => {
  const response = await (configuration.fetcher ?? fetch)(
    searchUrl(kind, question, repository, limit),
    {
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        Accept: "application/vnd.github.text-match+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error("GitHub search failed.");
  return (await response.json()) as GitHubSearchResponse;
};

const resultFromItem = (
  item: GitHubSearchItem,
  repository: string,
  now: Date,
  rank: number,
): KnowledgeSearchResult | undefined => {
  if (!item.html_url.startsWith(`https://github.com/${repository}/`)) return undefined;
  const isCode = item.path !== undefined;
  const sourceUpdatedAt = item.updated_at ?? now.toISOString();
  const body = excerpt(item);
  if (body === "") return undefined;
  return {
    id: isCode ? `github:${repository}:${item.path}` : `github:${repository}#${item.number ?? 0}`,
    source: "github",
    sourceId: isCode ? `${repository}:${item.path}` : `${repository}#${item.number ?? 0}`,
    title: isCode ? (item.path ?? item.name ?? repository) : (item.title ?? repository),
    excerpt: body,
    citationUrl: item.html_url,
    sourceUpdatedAt,
    sensitivity: "internal",
    authority: isCode ? 0.82 : 0.78,
    freshness: freshness(sourceUpdatedAt, now),
    componentRanks: { github: rank },
    score: 0,
  };
};

export const createGitHubKnowledgeSearch = (
  configuration: GitHubKnowledgeSearchConfiguration,
): KnowledgeLiveSearch => ({
  source: "github",
  search: (query: KnowledgeQuery) =>
    Effect.tryPromise({
      try: async () => {
        if (
          query.audience.workspaceId !== configuration.workspaceId ||
          !query.audience.audienceIds.some((id) => configuration.allowedAudienceIds.has(id)) ||
          configuration.allowedRepositories.length === 0 ||
          configuration.allowedRepositories.length > 10
        )
          return [];
        const question = safeQuestion(query.question);
        if (question === "") return [];
        const perRepositoryLimit = Math.max(
          1,
          Math.min(configuration.perRepositoryLimit ?? query.topK, 20),
        );
        const searches = configuration.allowedRepositories.flatMap((repository) =>
          (["issues", "code"] as const).map(async (kind) => ({
            repository,
            response: await readSearch(
              configuration,
              kind,
              repository,
              question,
              perRepositoryLimit,
            ),
          })),
        );
        const now = configuration.now?.() ?? new Date();
        const responses = await Promise.all(searches);
        const seen = new Set<string>();
        return responses
          .flatMap(({ repository, response }) =>
            response.items.flatMap((item, index) => {
              const resolvedRepository = repositoryFromApiUrl(item.repository_url) ?? repository;
              if (resolvedRepository !== repository) return [];
              const result = resultFromItem(item, repository, now, index + 1);
              if (result === undefined || seen.has(result.citationUrl)) return [];
              seen.add(result.citationUrl);
              return [result];
            }),
          )
          .slice(0, Math.max(1, Math.min(query.topK, 50)));
      },
      catch: () =>
        new RepositoryError({
          message: "Approved GitHub live search is unavailable.",
          operation: "knowledge-github-search",
        }),
    }),
});
