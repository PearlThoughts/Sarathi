import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type {
  TeamsChannelConversation,
  TeamsMembershipEvidence,
  TeamsMembershipRequest,
  TeamsMembershipResolver,
} from "../../modules/teams-mention/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

type GraphFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TeamsGraphMembershipResolverConfiguration = {
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly fetcher?: GraphFetcher | undefined;
  readonly now?: (() => number) | undefined;
  readonly cacheTtlMs?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly maximumPages?: number | undefined;
};

type GraphMember = {
  readonly userId?: unknown;
};

type GraphMemberPage = {
  readonly value?: unknown;
  readonly "@odata.nextLink"?: unknown;
};

type CachedRoster = {
  readonly memberIds: ReadonlySet<string>;
  readonly resolvedAt: number;
  readonly expiresAt: number;
};

const maximumMembershipCacheTtlMs = 120_000;

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RepositoryError({
      message: `Teams membership ${name} must be a positive integer.`,
      operation: "teams-membership-configuration",
    });
  }
  return value;
};

const standardTeamConversation = (request: TeamsMembershipRequest): TeamsChannelConversation => {
  if (request.conversation.kind !== "standard_team_channel") {
    throw new RepositoryError({
      message: "Teams membership lookup does not support this conversation kind.",
      operation: "teams-membership-unsupported-scope",
    });
  }
  if (
    request.conversation.tenantId.trim() === "" ||
    request.conversation.graphTeamId.trim() === "" ||
    request.entraObjectId.trim() === ""
  ) {
    throw new RepositoryError({
      message: "Teams membership lookup requires authenticated resource identities.",
      operation: "teams-membership-invalid-identity",
    });
  }
  return request.conversation;
};

const rosterKey = (conversation: TeamsChannelConversation): string =>
  `${conversation.tenantId}:${conversation.graphTeamId}`;

const membersUrl = (conversation: TeamsChannelConversation): URL => {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(conversation.graphTeamId)}/members`,
  );
  url.searchParams.set("$select", "userId");
  return url;
};

const validatedNextLink = (value: unknown): URL | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RepositoryError({
      message: "Teams membership pagination returned an invalid continuation.",
      operation: "teams-membership-read",
    });
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new RepositoryError({
      message: "Teams membership pagination left the Microsoft Graph boundary.",
      operation: "teams-membership-read",
    });
  }
  return url;
};

const memberIdsFromPage = (page: GraphMemberPage): readonly string[] => {
  if (!Array.isArray(page.value)) {
    throw new RepositoryError({
      message: "Teams membership returned an invalid roster.",
      operation: "teams-membership-read",
    });
  }
  return page.value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const userId = (candidate as GraphMember).userId;
    return typeof userId === "string" && userId.trim() !== "" ? [userId.toLowerCase()] : [];
  });
};

export const createTeamsGraphMembershipResolver = (
  configuration: TeamsGraphMembershipResolverConfiguration,
): TeamsMembershipResolver => {
  const fetcher = configuration.fetcher ?? fetch;
  const now = configuration.now ?? Date.now;
  const cacheTtlMs = positiveInteger(
    "cache TTL",
    configuration.cacheTtlMs ?? maximumMembershipCacheTtlMs,
  );
  if (cacheTtlMs > maximumMembershipCacheTtlMs) {
    throw new RepositoryError({
      message: "Teams membership cache TTL cannot exceed two minutes.",
      operation: "teams-membership-configuration",
    });
  }
  const requestTimeoutMs = positiveInteger(
    "request timeout",
    configuration.requestTimeoutMs ?? 5_000,
  );
  const maximumPages = positiveInteger("maximum pages", configuration.maximumPages ?? 10);
  const rosters = new Map<string, CachedRoster>();
  const inFlight = new Map<string, Promise<CachedRoster>>();

  const readRoster = async (conversation: TeamsChannelConversation): Promise<CachedRoster> => {
    const key = rosterKey(conversation);
    const cached = rosters.get(key);
    if (cached !== undefined && cached.expiresAt > now()) return cached;
    const active = inFlight.get(key);
    if (active !== undefined) return active;

    const load = (async () => {
      const accessToken = await configuration.tokenProvider.getAccessToken();
      const memberIds = new Set<string>();
      let next: URL | undefined = membersUrl(conversation);
      let pages = 0;
      while (next !== undefined) {
        pages += 1;
        if (pages > maximumPages) {
          throw new RepositoryError({
            message: "Teams membership pagination exceeded its safety bound.",
            operation: "teams-membership-read",
          });
        }
        const response = await fetcher(next, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        if (!response.ok) {
          throw new RepositoryError({
            message: `Teams membership read failed with HTTP ${response.status}.`,
            operation: "teams-membership-read",
          });
        }
        const page = (await response.json()) as GraphMemberPage;
        for (const memberId of memberIdsFromPage(page)) memberIds.add(memberId);
        next = validatedNextLink(page["@odata.nextLink"]);
      }
      const resolvedAt = now();
      const roster = { memberIds, resolvedAt, expiresAt: resolvedAt + cacheTtlMs };
      rosters.set(key, roster);
      return roster;
    })();
    inFlight.set(key, load);
    try {
      return await load;
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    resolveMembership: (request): Effect.Effect<TeamsMembershipEvidence, RepositoryError> =>
      Effect.tryPromise({
        try: async () => {
          const conversation = standardTeamConversation(request);
          const roster = await readRoster(conversation);
          return {
            member: roster.memberIds.has(request.entraObjectId.toLowerCase()),
            source: "microsoft_graph_roster" as const,
            resolvedAt: new Date(roster.resolvedAt).toISOString(),
            expiresAt: new Date(roster.expiresAt).toISOString(),
          };
        },
        catch: (cause) =>
          cause instanceof RepositoryError
            ? cause
            : new RepositoryError({
                message: "Teams membership could not be resolved.",
                operation: "teams-membership-read",
              }),
      }),
  };
};
