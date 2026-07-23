import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import {
  createGitHubKnowledgeSource,
  type GitHubKnowledgeRepository,
} from "../../infrastructure/github/index.ts";
import {
  createEntraClientCredentialsTokenProvider,
  createTeamsKnowledgeSource,
  ensureTeamsChangeNotificationSubscription,
  type TeamsKnowledgeChannel,
  teamsSubscriptionResourceHash,
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
  type KnowledgeIngestionSummary,
  type KnowledgeSourceKind,
  readSynchronizationSourceStatus,
  type SynchronizationSource,
  type SynchronizationStatus,
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

const privacySafeControlStatus = (status: {
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly freshness: unknown;
  readonly control: SynchronizationStatus;
}) => ({
  sourceId: status.sourceId,
  source: status.source,
  freshness: status.freshness,
  control: {
    ...(status.control.checkpoint === undefined
      ? {}
      : {
          checkpoint: {
            workspaceId: status.control.checkpoint.workspaceId,
            sourceId: status.control.checkpoint.sourceId,
            scopeHash: status.control.checkpoint.scopeHash,
            lastEventAt: status.control.checkpoint.lastEventAt,
            lastReconciledAt: status.control.checkpoint.lastReconciledAt,
            newestSourceUpdatedAt: status.control.checkpoint.newestSourceUpdatedAt,
            lastSucceededAt: status.control.checkpoint.lastSucceededAt,
            retryCount: status.control.checkpoint.retryCount,
            nextReconcileAt: status.control.checkpoint.nextReconcileAt,
            failureClass: status.control.checkpoint.failureClass,
          },
        }),
    ...(status.control.subscription === undefined
      ? {}
      : { subscription: status.control.subscription }),
    ...(status.control.activeLease === undefined
      ? {}
      : { activeLease: status.control.activeLease }),
    ...(status.control.latestRun === undefined
      ? {}
      : {
          latestRun: {
            id: status.control.latestRun.id,
            workspaceId: status.control.latestRun.workspaceId,
            sourceId: status.control.latestRun.sourceId,
            trigger: status.control.latestRun.trigger,
            status: status.control.latestRun.status,
            scopeHash: status.control.latestRun.scopeHash,
            startedAt: status.control.latestRun.startedAt,
            completedAt: status.control.latestRun.completedAt,
            attemptCount: status.control.latestRun.attemptCount,
            newestSourceUpdatedAt: status.control.latestRun.newestSourceUpdatedAt,
            lagSeconds: status.control.latestRun.lagSeconds,
            failureClass: status.control.latestRun.failureClass,
          },
        }),
  },
});

const privacySafeSummary = (summary: KnowledgeIngestionSummary) => ({
  sourceId: summary.sourceId,
  workspaceId: summary.workspaceId,
  scopeHash: summary.scopeHash,
  documentsObserved: summary.documentsObserved,
  versionsCreated: summary.versionsCreated,
  passagesActive: summary.passagesActive,
  itemsDeleted: summary.itemsDeleted,
  checksum: summary.checksum,
});

export const deliverySyncFailureOutput = (error: unknown) => ({
  ok: false,
  message: "Delivery synchronization failed; inspect privacy-safe control diagnostics.",
  ...(error instanceof RepositoryError && error.operation !== undefined
    ? { failureOperation: error.operation }
    : {}),
});

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
      operation !== "subscriptions" &&
      operation !== "status"
    )
      return {
        exitCode: 2,
        output: {
          ok: false,
          message:
            "Use delivery sync backfill|reconcile|status <source|all>, subscriptions teams, or events <source> --event-id <id> --payload-hash <sha256>.",
        },
      };
    const selection = sourceSelection(args[1] ?? "all");
    if (operation === "events" && selection === "all")
      throw new Error("Event synchronization requires one source.");
    if (operation === "subscriptions" && selection !== "teams")
      throw new Error("Subscription synchronization currently supports only Teams.");
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
      if (operation === "subscriptions") {
        const teams = parseJson<TeamsProjection>(
          "SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON",
          environment.SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON,
        );
        const existing = await runRepositoryEffect(
          control.readSubscriptions(workspaceId, teams.sourceId),
        );
        const tokenProvider = createEntraClientCredentialsTokenProvider({
          tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
          clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
          clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
        });
        const subscriptions = [];
        for (const channel of teams.channels) {
          const resourceHash = teamsSubscriptionResourceHash(channel);
          const current = existing.find(
            (subscription) =>
              subscription.provider === "microsoft-graph" &&
              subscription.resourceHash === resourceHash &&
              subscription.expiresAt !== undefined,
          );
          const providerSubscription =
            current?.expiresAt === undefined
              ? undefined
              : { id: current.id, expiresAt: current.expiresAt };
          subscriptions.push(
            await runRepositoryEffect(
              ensureTeamsChangeNotificationSubscription(
                {
                  workspaceId,
                  sourceId: teams.sourceId,
                  tokenProvider,
                  controlRepository: control,
                  notificationUrl: required(
                    "SARATHI_TEAMS_NOTIFICATION_URL",
                    environment.SARATHI_TEAMS_NOTIFICATION_URL,
                  ),
                  lifecycleNotificationUrl: required(
                    "SARATHI_TEAMS_LIFECYCLE_NOTIFICATION_URL",
                    environment.SARATHI_TEAMS_LIFECYCLE_NOTIFICATION_URL,
                  ),
                  clientState: required(
                    "SARATHI_TEAMS_NOTIFICATION_CLIENT_STATE",
                    environment.SARATHI_TEAMS_NOTIFICATION_CLIENT_STATE,
                  ),
                },
                channel,
                providerSubscription,
              ),
            ),
          );
        }
        return {
          exitCode: 0,
          output: {
            ok: true,
            operation: "delivery-sync-subscriptions",
            sourceId: teams.sourceId,
            subscriptions: subscriptions.map(
              ({ id, provider, resourceHash, status, expiresAt, nextRenewalAt }) => ({
                id,
                provider,
                resourceHash,
                status,
                expiresAt,
                nextRenewalAt,
              }),
            ),
          },
        };
      }
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
            statuses: statuses.map(privacySafeControlStatus),
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
        output: {
          ok: accepted,
          operation: `delivery-sync-${operation}`,
          outcomes: outcomes.map((outcome) => ({
            ...outcome,
            ...(outcome.summary === undefined
              ? {}
              : { summary: privacySafeSummary(outcome.summary) }),
          })),
        },
      };
    } finally {
      await opened.pool.end();
    }
  } catch (error) {
    return {
      exitCode: 1,
      output: deliverySyncFailureOutput(error),
    };
  }
};
