import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { createGitHubKnowledgeSearch } from "../../infrastructure/github/index.ts";
import { createJiraKnowledgeSource } from "../../infrastructure/jira/index.ts";
import {
  createAiSdkKnowledgeEmbedding,
  createGroundedAnswerGeneratorFromEnvironment,
  knowledgeEmbeddingConfigurationFromEnvironment,
} from "../../infrastructure/model/index.ts";
import {
  applyKnowledgePostgresMigrations,
  createPostgresKnowledgeRepository,
  knowledgeMigrationPlan,
  openKnowledgePostgresDatabase,
  readKnowledgePostgresStatus,
} from "../../infrastructure/postgres/index.ts";
import { createVaultKnowledgeSource } from "../../infrastructure/vault/index.ts";
import {
  ingestKnowledgeSource,
  type KnowledgeAclRule,
  queryKnowledgeAcrossSources,
} from "../../modules/knowledge-layer/index.ts";
import { runRepositoryEffect } from "./effect-repository-promise.ts";

export type KnowledgeCliResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type KnowledgeRuntimeEnvironment = Record<string, string | undefined>;
type IngestSource = "jira" | "vault" | "all";

type JiraSourceProjection = {
  readonly sourceId: string;
  readonly projectKey: string;
  readonly jql: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly acl: readonly KnowledgeAclRule[];
  readonly sensitivity: "public" | "internal" | "confidential" | "restricted";
  readonly authority?: number | undefined;
};

type VaultRootProjection = {
  readonly repository: string;
  readonly pathPrefix: string;
  readonly ref?: string | undefined;
  readonly sensitivity: "public" | "internal" | "confidential" | "restricted";
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

const parseJson = <Value>(name: string, value: string | undefined): Value => {
  try {
    return JSON.parse(required(name, value)) as Value;
  } catch {
    throw new Error(`${name} must contain valid connected-source JSON configuration.`);
  }
};

const databaseUrl = (environment: KnowledgeRuntimeEnvironment): string =>
  required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL);

const workspaceId = (environment: KnowledgeRuntimeEnvironment): string =>
  required("SARATHI_KNOWLEDGE_WORKSPACE_ID", environment.SARATHI_KNOWLEDGE_WORKSPACE_ID);

const sources = (environment: KnowledgeRuntimeEnvironment) => {
  const workspace = workspaceId(environment);
  const token = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
  const jira = parseJson<JiraSourceProjection>(
    "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON",
    environment.SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON,
  );
  const vaultRoots = parseJson<readonly VaultRootProjection[]>(
    "SARATHI_KNOWLEDGE_VAULT_ROOTS_JSON",
    environment.SARATHI_KNOWLEDGE_VAULT_ROOTS_JSON,
  );
  return {
    jira: createJiraKnowledgeSource({
      ...jira,
      workspaceId: workspace,
      baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
      email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
      apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
    }),
    vault: createVaultKnowledgeSource({
      sourceId: required(
        "SARATHI_KNOWLEDGE_VAULT_SOURCE_ID",
        environment.SARATHI_KNOWLEDGE_VAULT_SOURCE_ID,
      ),
      workspaceId: workspace,
      token,
      roots: vaultRoots,
    }),
  };
};

const boundedTopK = (value: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > 50)
    throw new Error("top-k must be between 1 and 50.");
  return value;
};

const withKnowledgeDatabase = async <Value>(
  environment: KnowledgeRuntimeEnvironment,
  use: (repository: ReturnType<typeof createPostgresKnowledgeRepository>) => Promise<Value>,
): Promise<Value> => {
  const opened = openKnowledgePostgresDatabase(databaseUrl(environment));
  try {
    return await use(createPostgresKnowledgeRepository(opened.database));
  } finally {
    await opened.pool.end();
  }
};

const ingest = async (
  source: IngestSource,
  environment: KnowledgeRuntimeEnvironment,
): Promise<KnowledgeCliResult> => {
  const configuredSources = sources(environment);
  const selected =
    source === "all"
      ? [configuredSources.jira, configuredSources.vault]
      : [configuredSources[source]];
  const embeddings = createAiSdkKnowledgeEmbedding(
    knowledgeEmbeddingConfigurationFromEnvironment(environment),
  );
  const summaries = await withKnowledgeDatabase(environment, (repository) =>
    runRepositoryEffect(
      Effect.all(
        selected.map((reader) =>
          ingestKnowledgeSource(reader, repository, embeddings, workspaceId(environment)),
        ),
        { concurrency: 1 },
      ),
    ),
  );
  return { exitCode: 0, output: { ok: true, operation: "ingest", summaries } };
};

const query = async (
  question: string,
  topK: number,
  environment: KnowledgeRuntimeEnvironment,
): Promise<KnowledgeCliResult> => {
  const workspace = workspaceId(environment);
  const audienceIds = parseJson<readonly string[]>(
    "SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON",
    environment.SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON,
  );
  const repositories =
    environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON === undefined
      ? []
      : parseJson<readonly string[]>(
          "SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON",
          environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON,
        );
  const repositoryScopes =
    environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON === undefined
      ? []
      : parseJson<
          readonly {
            readonly owner: string;
            readonly ownerType: "org" | "user";
            readonly repositoryNamePrefix?: string | undefined;
          }[]
        >(
          "SARATHI_GITHUB_REPOSITORY_SCOPES_JSON",
          environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON,
        );
  const token = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
  const results = await withKnowledgeDatabase(environment, (repository) =>
    runRepositoryEffect(
      queryKnowledgeAcrossSources(
        repository,
        createAiSdkKnowledgeEmbedding(knowledgeEmbeddingConfigurationFromEnvironment(environment)),
        [
          createGitHubKnowledgeSearch({
            token,
            workspaceId: workspace,
            allowedAudienceIds: new Set(audienceIds),
            allowedRepositories: repositories,
            repositoryScopes,
          }),
        ],
        {
          question,
          audience: {
            workspaceId: workspace,
            audienceIds,
            maximumSensitivity: "internal",
          },
          topK: boundedTopK(topK),
        },
      ),
    ),
  );
  const answer = await runRepositoryEffect(
    createGroundedAnswerGeneratorFromEnvironment(environment).generate({
      workspaceId: workspace,
      question,
      evidence: results.map((result) => ({
        source: result.source,
        sourceId: result.sourceId,
        sourceUrl: result.citationUrl,
        title: result.title,
        excerpt: result.excerpt,
        occurredAt: result.sourceUpdatedAt,
        updatedAt: result.sourceUpdatedAt,
        sensitivity: result.sensitivity,
        freshness: result.freshness >= 0.5 ? "current" : "stale",
      })),
    }),
  );
  return {
    exitCode: 0,
    output: {
      ok: true,
      operation: "query",
      answer,
      evidence: results.map(({ source, sourceId, title, citationUrl, componentRanks, score }) => ({
        source,
        sourceId,
        title,
        citationUrl,
        componentRanks,
        score,
      })),
    },
  };
};

export const runKnowledgeCommand = async (
  args: readonly string[],
  environment: KnowledgeRuntimeEnvironment = process.env,
): Promise<KnowledgeCliResult> => {
  try {
    if (args[0] === "status") {
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "status",
          status: await runRepositoryEffect(readKnowledgePostgresStatus(databaseUrl(environment))),
        },
      };
    }
    if (args[0] === "migrate" && args[1] === "plan")
      return {
        exitCode: 0,
        output: { ok: true, operation: "migrate-plan", knowledgeMigrationPlan },
      };
    if (args[0] === "migrate" && args[1] === "apply")
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "migrate-apply",
          verification: await runRepositoryEffect(
            applyKnowledgePostgresMigrations(databaseUrl(environment)),
          ),
        },
      };
    if (args[0] === "ingest" || args[0] === "reconcile") {
      const source = args[1];
      if (source !== "jira" && source !== "vault" && source !== "all")
        throw new Error("knowledge ingest/reconcile requires jira, vault, or all.");
      return ingest(source, environment);
    }
    if (args[0] === "query") {
      const questionIndex = args.indexOf("--question");
      const topKIndex = args.indexOf("--top-k");
      const question = questionIndex >= 0 ? args[questionIndex + 1] : undefined;
      return query(
        required("--question", question),
        topKIndex >= 0 ? Number(args[topKIndex + 1]) : 10,
        environment,
      );
    }
    return {
      exitCode: 2,
      output: {
        ok: false,
        message:
          "Use knowledge status, migrate plan|apply, ingest|reconcile jira|vault|all, or query --question <text>.",
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        message: "Knowledge operation failed; inspect privacy-safe service diagnostics.",
        ...(error instanceof RepositoryError && error.operation !== undefined
          ? { failureOperation: error.operation }
          : {}),
      },
    };
  }
};

const render = (result: KnowledgeCliResult) =>
  Console.log(JSON.stringify(result.output, null, 2)).pipe(
    Effect.tap(() => Effect.sync(() => (process.exitCode = result.exitCode))),
  );

const sourceArgument = Args.text({ name: "source" });
const questionOption = Options.text("question");
const topKOption = Options.integer("top-k").pipe(Options.withDefault(10));
const environment = process.env;

const statusCommand = Command.make("status", {}, () =>
  Effect.promise(() => runKnowledgeCommand(["status"], environment)).pipe(Effect.flatMap(render)),
);
const ingestCommand = Command.make("ingest", { source: sourceArgument }, ({ source }) =>
  Effect.promise(() => runKnowledgeCommand(["ingest", source], environment)).pipe(
    Effect.flatMap(render),
  ),
);
const reconcileCommand = Command.make("reconcile", { source: sourceArgument }, ({ source }) =>
  Effect.promise(() => runKnowledgeCommand(["reconcile", source], environment)).pipe(
    Effect.flatMap(render),
  ),
);
const queryCommand = Command.make(
  "query",
  { question: questionOption, topK: topKOption },
  ({ question, topK }) =>
    Effect.promise(() =>
      runKnowledgeCommand(["query", "--question", question, "--top-k", String(topK)], environment),
    ).pipe(Effect.flatMap(render)),
);
const migratePlanCommand = Command.make("plan", {}, () =>
  Effect.promise(() => runKnowledgeCommand(["migrate", "plan"], environment)).pipe(
    Effect.flatMap(render),
  ),
);
const migrateApplyCommand = Command.make("apply", {}, () =>
  Effect.promise(() => runKnowledgeCommand(["migrate", "apply"], environment)).pipe(
    Effect.flatMap(render),
  ),
);
const migrateCommand = Command.make("migrate", {}).pipe(
  Command.withSubcommands([migratePlanCommand, migrateApplyCommand]),
);
export const knowledgeCommand = Command.make("knowledge", {}).pipe(
  Command.withSubcommands([
    statusCommand,
    migrateCommand,
    ingestCommand,
    reconcileCommand,
    queryCommand,
  ]),
);

if (import.meta.main) {
  Command.run(knowledgeCommand, { name: "Sarathi Knowledge CLI", version: "0.1.0" })(Bun.argv).pipe(
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain,
  );
}
