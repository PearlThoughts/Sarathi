import { Effect } from "effect";
import {
  createGitHubKnowledgeSource,
  type GitHubKnowledgeRepository,
} from "../../infrastructure/github/index.ts";
import {
  createEntraClientCredentialsTokenProvider,
  createTeamsKnowledgeSource,
  type TeamsKnowledgeChannel,
} from "../../infrastructure/graph/index.ts";
import { createJiraKnowledgeSource } from "../../infrastructure/jira/index.ts";
import {
  createAiSdkKnowledgeEmbedding,
  knowledgeEmbeddingConfigurationFromEnvironment,
} from "../../infrastructure/model/index.ts";
import {
  createPostgresKnowledgeRepository,
  createPostgresSynchronizationControlRepository,
  openKnowledgePostgresDatabase,
} from "../../infrastructure/postgres/index.ts";
import { createVaultKnowledgeSource } from "../../infrastructure/vault/index.ts";
import { parseDeliveryEntityCatalog } from "../../modules/delivery-intelligence/index.ts";
import {
  type KnowledgeAclRule,
  type KnowledgeSourceKind,
  readSynchronizationSourceStatus,
  type SynchronizationSource,
  synchronizationEventDeliveryId,
  synchronizeKnowledgeSource,
} from "../../modules/knowledge-layer/index.ts";
import { runRepositoryEffect } from "./effect-repository-promise.ts";

type DeliverySyncCliResult = { readonly exitCode: number; readonly output: unknown };
type Environment = Record<string, string | undefined>;
type ContinuousSourceKind = Exclude<KnowledgeSourceKind, "email">;
type SourceSelection = ContinuousSourceKind | "all";

type JiraProjection = {
  readonly sourceId: string;
  readonly projectKey: string;
  readonly jql: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly acl: readonly KnowledgeAclRule[];
  readonly sensitivity: "public" | "internal" | "confidential" | "restricted";
  readonly authority?: number | undefined;
  readonly boardId?: number | undefined;
  readonly cursorOverlapSeconds?: number | undefined;
};
type VaultProjection = {
  readonly repository: string;
  readonly pathPrefix: string;
  readonly ref?: string | undefined;
  readonly sensitivity: "public" | "internal" | "confidential" | "restricted";
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
};
type GitHubProjection = {
  readonly sourceId: string;
  readonly repositories: readonly GitHubKnowledgeRepository[];
  readonly historySince?: string | undefined;
};
type TeamsProjection = {
  readonly sourceId: string;
  readonly channels: readonly TeamsKnowledgeChannel[];
  readonly historySince?: string | undefined;
  readonly assistantName?: string | undefined;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

const parseJson = <Value>(name: string, value: string | undefined): Value => {
  try {
    return JSON.parse(required(name, value)) as Value;
  } catch {
    throw new Error(`${name} must contain valid synchronization configuration JSON.`);
  }
};

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const positiveInteger = (name: string, value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive.`);
  return parsed;
};

const sourceSelection = (value: string | undefined): SourceSelection => {
  if (
    value === "jira" ||
    value === "vault" ||
    value === "github" ||
    value === "teams" ||
    value === "all"
  )
    return value;
  throw new Error("sync source must be jira, vault, github, teams, or all.");
};

const continuousKinds = ["jira", "vault", "github", "teams"] as const;

const selectedKinds = (selection: SourceSelection): readonly ContinuousSourceKind[] =>
  selection === "all" ? continuousKinds : [selection];

const sourceIdentity = (
  source: ContinuousSourceKind,
  environment: Environment,
): Pick<SynchronizationSource, "source" | "sourceId"> => {
  if (source === "vault")
    return {
      source,
      sourceId: required(
        "SARATHI_KNOWLEDGE_VAULT_SOURCE_ID",
        environment.SARATHI_KNOWLEDGE_VAULT_SOURCE_ID,
      ),
    };
  const configuration =
    source === "jira"
      ? parseJson<JiraProjection>(
          "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON",
          environment.SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON,
        )
      : source === "github"
        ? parseJson<GitHubProjection>(
            "SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON",
            environment.SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON,
          )
        : parseJson<TeamsProjection>(
            "SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON",
            environment.SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON,
          );
  return { source, sourceId: configuration.sourceId };
};

const configuredSource = (
  source: ContinuousSourceKind,
  environment: Environment,
): SynchronizationSource => {
  const workspaceId = required(
    "SARATHI_KNOWLEDGE_WORKSPACE_ID",
    environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
  );
  if (source === "jira") {
    const jira = parseJson<JiraProjection>(
      "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON",
      environment.SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON,
    );
    return {
      source,
      sourceId: jira.sourceId,
      reader: createJiraKnowledgeSource({
        ...jira,
        workspaceId,
        baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
        email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
        apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
      }),
    };
  }
  if (source === "vault") {
    const sourceId = sourceIdentity(source, environment).sourceId;
    return {
      source,
      sourceId,
      reader: createVaultKnowledgeSource({
        sourceId,
        workspaceId,
        token: required("GITHUB_TOKEN", environment.GITHUB_TOKEN),
        roots: parseJson<readonly VaultProjection[]>(
          "SARATHI_KNOWLEDGE_VAULT_ROOTS_JSON",
          environment.SARATHI_KNOWLEDGE_VAULT_ROOTS_JSON,
        ),
      }),
    };
  }
  if (source === "github") {
    const github = parseJson<GitHubProjection>(
      "SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON",
      environment.SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON,
    );
    return {
      source,
      sourceId: github.sourceId,
      reader: createGitHubKnowledgeSource({
        ...github,
        workspaceId,
        token: required("GITHUB_TOKEN", environment.GITHUB_TOKEN),
      }),
    };
  }
  const teams = parseJson<TeamsProjection>(
    "SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON",
    environment.SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON,
  );
  return {
    source,
    sourceId: teams.sourceId,
    reader: createTeamsKnowledgeSource({
      ...teams,
      workspaceId,
      tokenProvider: createEntraClientCredentialsTokenProvider({
        tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
        clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
        clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
      }),
      botApplicationId: environment.MICROSOFT_APP_ID,
    }),
  };
};

export const runDeliverySyncCommand = async (
  args: readonly string[],
  environment: Environment = process.env,
): Promise<DeliverySyncCliResult> => {
  try {
    const operation = args[0];
    if (
      operation !== "backfill" &&
      operation !== "events" &&
      operation !== "reconcile" &&
      operation !== "status"
    )
      return {
        exitCode: 2,
        output: {
          ok: false,
          message:
            "Use delivery sync backfill|reconcile|status <source|all> or events <source> --event-id <id> --payload-hash <sha256>.",
        },
      };
    const selection = sourceSelection(args[1] ?? "all");
    if (operation === "events" && selection === "all")
      throw new Error("Event synchronization requires one source.");
    const workspaceId = required(
      "SARATHI_KNOWLEDGE_WORKSPACE_ID",
      environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
    );
    const kinds = selectedKinds(selection);
    const opened = openKnowledgePostgresDatabase(
      required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
    );
    try {
      const control = createPostgresSynchronizationControlRepository(opened.database);
      if (operation === "status") {
        const now = new Date().toISOString();
        const staleAfterSeconds = positiveInteger(
          "SARATHI_SYNC_STALE_AFTER_SECONDS",
          environment.SARATHI_SYNC_STALE_AFTER_SECONDS,
          7_200,
        );
        const statuses = await runRepositoryEffect(
          Effect.all(
            kinds.map((kind) =>
              readSynchronizationSourceStatus(
                workspaceId,
                sourceIdentity(kind, environment),
                staleAfterSeconds,
                now,
                control,
              ),
            ),
            { concurrency: 1 },
          ),
        );
        return {
          exitCode: statuses.every(({ freshness }) => freshness.status === "current") ? 0 : 1,
          output: {
            ok: statuses.every(({ freshness }) => freshness.status === "current"),
            operation: "delivery-sync-status",
            staleAfterSeconds,
            statuses,
          },
        };
      }
      const repository = createPostgresKnowledgeRepository(opened.database, {
        entityCatalog: parseDeliveryEntityCatalog(environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON),
      });
      const embeddings = createAiSdkKnowledgeEmbedding(
        knowledgeEmbeddingConfigurationFromEnvironment(environment),
      );
      const ownerId = required("SARATHI_SYNC_OWNER_ID", environment.SARATHI_SYNC_OWNER_ID);
      const leaseSeconds = positiveInteger(
        "SARATHI_SYNC_LEASE_SECONDS",
        environment.SARATHI_SYNC_LEASE_SECONDS,
        900,
      );
      const eventId =
        operation === "events" ? required("--event-id", option(args, "--event-id")) : undefined;
      const payloadHash =
        operation === "events"
          ? required("--payload-hash", option(args, "--payload-hash"))
          : undefined;
      if (payloadHash !== undefined && !/^sha256-[a-f0-9]{64}$/i.test(payloadHash))
        throw new Error("--payload-hash must be a SHA-256 identity, never an event body.");
      const outcomes = [];
      for (const kind of kinds) {
        const source = configuredSource(kind, environment);
        const receivedAt = new Date().toISOString();
        const identity =
          eventId === undefined
            ? undefined
            : {
                workspaceId,
                sourceId: source.sourceId,
                source: source.source,
                providerEventId: eventId,
              };
        outcomes.push(
          await runRepositoryEffect(
            synchronizeKnowledgeSource(
              {
                workspaceId,
                source,
                trigger:
                  operation === "backfill"
                    ? "historical-backfill"
                    : operation === "events"
                      ? "source-event"
                      : "hourly-reconciliation",
                ownerId,
                leaseSeconds,
                now: () => new Date().toISOString(),
                ...(identity === undefined || payloadHash === undefined
                  ? {}
                  : {
                      event: {
                        ...identity,
                        id: synchronizationEventDeliveryId(identity),
                        payloadHash,
                        sourceVersion: option(args, "--source-version"),
                        sourceOccurredAt: option(args, "--source-occurred-at"),
                        receivedAt,
                        status: "received",
                        attemptCount: 0,
                      },
                    }),
              },
              repository,
              embeddings,
              control,
            ),
          ),
        );
      }
      const accepted = outcomes.every(({ disposition }) => disposition !== "lease-unavailable");
      return {
        exitCode: accepted ? 0 : 1,
        output: { ok: accepted, operation: `delivery-sync-${operation}`, outcomes },
      };
    } finally {
      await opened.pool.end();
    }
  } catch {
    return {
      exitCode: 1,
      output: {
        ok: false,
        message: "Delivery synchronization failed; inspect privacy-safe control diagnostics.",
      },
    };
  }
};
