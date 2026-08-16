import { and, cosineDistance, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  childDeliveryExecution,
  type DeliveryExecutionContext,
  endDeliveryExecution,
} from "../../modules/delivery-execution-observability/index.ts";
import {
  assertNonFinancialAttributes,
  type DeliveryEntityCatalog,
  type DeliveryObjectRef,
  deliveryClaimValueHash,
  normalizeDeliveryEntityAlias,
  resolveDeliveryEntity,
  validateDeliveryEntityCatalog,
} from "../../modules/delivery-intelligence/index.ts";
import {
  type KnowledgeAclRule,
  type KnowledgeEmbeddingPort,
  type KnowledgeQuery,
  type KnowledgeRepository,
  type KnowledgeSearchResult,
  type KnowledgeSourceDocument,
  type KnowledgeSourceKind,
  type KnowledgeSourceSnapshot,
  type RankedKnowledgeCandidate,
  reciprocalRankFusion,
  type SynchronizationTrigger,
} from "../../modules/knowledge-layer/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  deliveryAclBindingTable,
  deliveryClaimTable,
  deliveryEntityAliasTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
  knowledgeAclBindingTable,
  knowledgeEmbeddingCacheTable,
  knowledgeItemTable,
  knowledgePassageTable,
  knowledgeProjectionTable,
  knowledgeSourceTable,
  knowledgeSyncCheckpointTable,
  knowledgeVersionTable,
} from "./knowledge-schema.ts";

type SearchRow = {
  readonly id: string;
  readonly source: KnowledgeSourceKind;
  readonly source_id: string;
  readonly external_id: string;
  readonly title: string;
  readonly body: string;
  readonly canonical_url: string;
  readonly source_updated_at: string | Date;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
  readonly kind: string;
  readonly parent_locator: string | null;
  readonly hierarchy: readonly string[] | null;
  readonly line_start: number | null;
  readonly line_end: number | null;
  readonly attributes: Readonly<Record<string, string | readonly string[]>> | null;
  readonly parent_body: string | null;
};

const postgresBindBatchSize = 1_000;
const embeddingCacheWriteBatchSize = 256;
const searchDialect = new PgDialect();

const postgresPool = (database: KnowledgePostgresDatabase): Pool =>
  (database as KnowledgePostgresDatabase & { readonly $client: Pool }).$client;

type PostgresKnowledgeSearchOperation =
  | "knowledge.exact"
  | "knowledge.full_text"
  | "knowledge.vector";

export const executePostgresKnowledgeSearch = async <Row extends QueryResultRow>(
  database: KnowledgePostgresDatabase,
  statement: SQL,
  operation: PostgresKnowledgeSearchOperation,
  execution?: DeliveryExecutionContext | undefined,
  signal?: AbortSignal | undefined,
): Promise<{ readonly rows: readonly Row[] }> => {
  const compiled = searchDialect.sqlToQuery(statement);
  const pool = postgresPool(database);
  if (execution === undefined && signal === undefined) {
    const result = await pool.query<Row>(compiled.sql, compiled.params);
    return { rows: result.rows };
  }
  const waitStartedAt = Date.now();
  const waitExecution =
    execution === undefined
      ? undefined
      : childDeliveryExecution(execution, "database.wait", {
          operation,
          "database.waiting": pool.waitingCount,
        });
  const client = await pool.connect().then(
    (connected) => {
      if (waitExecution !== undefined)
        endDeliveryExecution(waitExecution, "success", {
          operation,
          "database.pool_wait.ms": Math.max(0, Date.now() - waitStartedAt),
          "database.waiting": pool.waitingCount,
        });
      execution?.observer.recordMetric({
        name: "delivery.database.pool_wait",
        value: Math.max(0, Date.now() - waitStartedAt),
        unit: "ms",
        labels: { stage: "database.wait", outcome: "success", operation: "read" },
      });
      return connected;
    },
    (failure: unknown) => {
      if (waitExecution !== undefined)
        endDeliveryExecution(
          waitExecution,
          "failed",
          { operation, "database.pool_wait.ms": Math.max(0, Date.now() - waitStartedAt) },
          "database_pool_starvation",
        );
      execution?.observer.recordMetric({
        name: "delivery.database.pool_wait",
        value: Math.max(0, Date.now() - waitStartedAt),
        unit: "ms",
        labels: { stage: "database.wait", outcome: "failed", operation: "read" },
      });
      throw failure;
    },
  );
  const queryStartedAt = Date.now();
  const queryExecution =
    execution === undefined
      ? undefined
      : childDeliveryExecution(execution, "database.query", { operation });
  const cancellationSignal = signal ?? execution?.signal;
  let cancellationRequested = false;
  const cancel = (): void => {
    cancellationRequested = true;
    const processId = (client as PoolClient & { readonly processID: number }).processID;
    void pool.query("select pg_cancel_backend($1)", [processId]).catch(() => undefined);
  };
  if (cancellationSignal?.aborted === true) cancel();
  else cancellationSignal?.addEventListener("abort", cancel, { once: true });
  try {
    if (cancellationSignal?.aborted === true)
      throw new Error("Knowledge query cancelled before execution.");
    const result = await client.query<Row>(compiled.sql, compiled.params);
    if (queryExecution !== undefined)
      endDeliveryExecution(queryExecution, "success", {
        operation,
        "database.query.ms": Math.max(0, Date.now() - queryStartedAt),
        "database.rows": result.rowCount ?? result.rows.length,
        "cancellation.state": cancellationRequested ? "acknowledged" : "not_requested",
      });
    execution?.observer.recordMetric({
      name: "delivery.database.query_duration",
      value: Math.max(0, Date.now() - queryStartedAt),
      unit: "ms",
      labels: { stage: "database.query", outcome: "success", operation: "read" },
    });
    return { rows: result.rows };
  } catch (failure) {
    if (queryExecution !== undefined)
      endDeliveryExecution(
        queryExecution,
        cancellationRequested ? "cancelled" : "failed",
        {
          operation,
          "database.query.ms": Math.max(0, Date.now() - queryStartedAt),
          "cancellation.state": cancellationRequested ? "acknowledged" : "not_requested",
        },
        cancellationRequested ? "other" : "slow_query",
      );
    execution?.observer.recordMetric({
      name: "delivery.database.query_duration",
      value: Math.max(0, Date.now() - queryStartedAt),
      unit: "ms",
      labels: {
        stage: "database.query",
        outcome: cancellationRequested ? "cancelled" : "failed",
        operation: "read",
      },
    });
    throw failure;
  } finally {
    cancellationSignal?.removeEventListener("abort", cancel);
    client.release();
  }
};

export const boundedPostgresBindBatches = <Value>(
  values: readonly Value[],
): readonly (readonly Value[])[] => {
  const batches: Value[][] = [];
  for (let offset = 0; offset < values.length; offset += postgresBindBatchSize)
    batches.push(values.slice(offset, offset + postgresBindBatchSize));
  return batches;
};

export const queryPostgresBindBatches = async <Value, Result>(
  values: readonly Value[],
  query: (batch: readonly Value[]) => Promise<readonly Result[]>,
): Promise<readonly Result[]> => {
  const results: Result[] = [];
  for (const batch of boundedPostgresBindBatches(values)) results.push(...(await query(batch)));
  return results;
};

type ReusableVectorRow = {
  readonly contentHash: string;
  readonly embedding: readonly number[];
};

export const collectReusableVectorsCacheFirst = async (
  contentHashes: readonly string[],
  dimensions: number,
  queryCache: (batch: readonly string[]) => Promise<readonly ReusableVectorRow[]>,
  queryProjections: (batch: readonly string[]) => Promise<readonly ReusableVectorRow[]>,
): Promise<ReadonlyMap<string, readonly number[]>> => {
  const uniqueContentHashes = [...new Set(contentHashes)];
  const vectors = new Map<string, readonly number[]>();
  const collect = async (
    hashes: readonly string[],
    query: (batch: readonly string[]) => Promise<readonly ReusableVectorRow[]>,
  ): Promise<void> => {
    for (const batch of boundedPostgresBindBatches(hashes)) {
      const rows = await query(batch);
      for (const row of rows)
        if (!vectors.has(row.contentHash) && row.embedding.length === dimensions)
          vectors.set(row.contentHash, row.embedding);
    }
  };

  await collect(uniqueContentHashes, queryCache);
  const missingContentHashes = uniqueContentHashes.filter(
    (contentHash) => !vectors.has(contentHash),
  );
  if (missingContentHashes.length > 0) await collect(missingContentHashes, queryProjections);
  return vectors;
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const itemId = (document: KnowledgeSourceDocument): string =>
  `knowledge-item:${stableSha256(`${document.workspaceId}:${document.sourceId}:${document.externalId}`)}`;

const effectiveVersion = (document: KnowledgeSourceDocument): string =>
  stableSha256(
    canonicalize({
      sourceVersion: document.sourceVersion,
      title: document.title,
      sensitivity: document.sensitivity,
      authority: document.authority,
      acl: document.acl,
      passages: document.passages,
      provenance: document.provenance,
    }),
  );

const versionId = (document: KnowledgeSourceDocument): string =>
  `knowledge-version:${stableSha256(`${itemId(document)}:${effectiveVersion(document)}`)}`;

const reusableProjectionVersions = async (
  database: KnowledgePostgresDatabase,
  snapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
): Promise<ReadonlySet<string>> => {
  const expectedPassages = new Map(
    snapshot.documents.map((document) => [versionId(document), document.passages.length] as const),
  );
  const versionIds = [...expectedPassages.keys()];
  if (versionIds.length === 0) return new Set();
  const [versions, projections] = await Promise.all([
    queryPostgresBindBatches(versionIds, (batch) =>
      database
        .select({ id: knowledgeVersionTable.id })
        .from(knowledgeVersionTable)
        .where(inArray(knowledgeVersionTable.id, batch)),
    ),
    queryPostgresBindBatches(versionIds, (batch) =>
      database
        .select({ versionId: knowledgePassageTable.versionId })
        .from(knowledgePassageTable)
        .innerJoin(
          knowledgeProjectionTable,
          eq(knowledgeProjectionTable.passageId, knowledgePassageTable.id),
        )
        .where(
          and(
            inArray(knowledgePassageTable.versionId, batch),
            eq(knowledgeProjectionTable.embeddingModel, embeddings.model),
            eq(knowledgeProjectionTable.embeddingDimensions, embeddings.dimensions),
          ),
        ),
    ),
  ]);
  const existingVersions = new Set(versions.map(({ id }) => id));
  const projectionCounts = new Map<string, number>();
  for (const projection of projections)
    projectionCounts.set(
      projection.versionId,
      (projectionCounts.get(projection.versionId) ?? 0) + 1,
    );
  return new Set(
    versionIds.filter(
      (id) =>
        existingVersions.has(id) &&
        (projectionCounts.get(id) ?? 0) === (expectedPassages.get(id) ?? 0),
    ),
  );
};

const reusableProjectionVectors = async (
  database: KnowledgePostgresDatabase,
  snapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
): Promise<ReadonlyMap<string, readonly number[]>> => {
  const contentHashes = [
    ...new Set(
      snapshot.documents.flatMap((document) =>
        document.passages.map(({ contentHash }) => contentHash),
      ),
    ),
  ];
  if (contentHashes.length === 0) return new Map();
  return collectReusableVectorsCacheFirst(
    contentHashes,
    embeddings.dimensions,
    (batch) =>
      database
        .select({
          contentHash: knowledgeEmbeddingCacheTable.contentHash,
          embedding: knowledgeEmbeddingCacheTable.embedding,
        })
        .from(knowledgeEmbeddingCacheTable)
        .where(
          and(
            inArray(knowledgeEmbeddingCacheTable.contentHash, batch),
            eq(knowledgeEmbeddingCacheTable.workspaceId, snapshot.workspaceId),
            eq(knowledgeEmbeddingCacheTable.sourceId, snapshot.sourceId),
            eq(knowledgeEmbeddingCacheTable.embeddingModel, embeddings.model),
            eq(knowledgeEmbeddingCacheTable.embeddingDimensions, embeddings.dimensions),
          ),
        ),
    (batch) =>
      database
        .select({
          contentHash: knowledgeProjectionTable.contentHash,
          embedding: knowledgeProjectionTable.embedding,
        })
        .from(knowledgeProjectionTable)
        .where(
          and(
            inArray(knowledgeProjectionTable.contentHash, batch),
            eq(knowledgeProjectionTable.workspaceId, snapshot.workspaceId),
            eq(knowledgeProjectionTable.embeddingModel, embeddings.model),
            eq(knowledgeProjectionTable.embeddingDimensions, embeddings.dimensions),
          ),
        ),
  );
};

const embedAndCacheProjectionVectors = async (
  database: KnowledgePostgresDatabase,
  snapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
  missingPassages: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, readonly number[]>> => {
  const vectors = new Map<string, readonly number[]>();
  const entries = [...missingPassages.entries()];
  for (let offset = 0; offset < entries.length; offset += embeddingCacheWriteBatchSize) {
    const batch = entries.slice(offset, offset + embeddingCacheWriteBatchSize);
    const embedded = await Effect.runPromise(embeddings.embed(batch.map(([, body]) => body)));
    if (
      embedded.length !== batch.length ||
      embedded.some((vector) => vector.length !== embeddings.dimensions)
    )
      throw new RepositoryError({
        message: "Embedding result count did not match changed passages.",
        operation: "knowledge-reconcile.embedding-cache",
      });
    const createdAt = new Date().toISOString();
    const rows = batch.map(([contentHash], index) => ({
      workspaceId: snapshot.workspaceId,
      sourceId: snapshot.sourceId,
      contentHash,
      embeddingModel: embeddings.model,
      embeddingDimensions: embeddings.dimensions,
      embedding: embedded[index] as number[],
      createdAt,
    }));
    await database.insert(knowledgeEmbeddingCacheTable).values(rows).onConflictDoNothing();
    for (const [index, [contentHash]] of batch.entries()) {
      const vector = embedded[index];
      if (vector !== undefined) vectors.set(contentHash, vector);
    }
  }
  return vectors;
};

const citationUrl = (document: KnowledgeSourceDocument, locator: string): string => {
  const url = new URL(document.canonicalUrl);
  url.hash = locator.replace(/^#/, "");
  return url.toString();
};

const deliveryObjectId = (
  workspaceId: string,
  sourceId: string,
  reference: DeliveryObjectRef,
): string =>
  `delivery-object:${stableSha256(`${workspaceId}:${sourceId}:${reference.kind}:${reference.externalKey}`)}`;

const deliveryTargetAclRows = (
  targetType: "object" | "relation" | "observation" | "metric" | "finance_metric" | "claim",
  targetId: string,
  workspaceId: string,
  rules: readonly KnowledgeAclRule[],
  now: string,
) =>
  rules.map((rule) => ({
    id: `delivery-acl:${stableSha256(`${targetType}:${targetId}:${rule.subjectType}:${rule.subjectId}:${rule.effect}`)}`,
    workspaceId,
    targetType,
    targetId,
    subjectType: rule.subjectType,
    subjectId: rule.subjectId,
    effect: rule.effect,
    createdAt: now,
  }));

const freshness = (sourceUpdatedAt: string | Date): number => {
  const time = new Date(sourceUpdatedAt).getTime();
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  return Math.max(0, 1 - ageDays / 90);
};

const rankCandidate = (row: SearchRow): RankedKnowledgeCandidate => ({
  id: row.id,
  source: row.source,
  authority: Number(row.authority),
  freshness: freshness(row.source_updated_at),
});

const valuesFromResult = (result: unknown): readonly SearchRow[] => {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  return (result as { readonly rows: readonly SearchRow[] }).rows;
};

const permittedKnowledgeSourceCondition = (
  sources: KnowledgeQuery["sources"],
  sourceColumn: ReturnType<typeof sql> = sql`${knowledgeSourceTable.kind}`,
): ReturnType<typeof sql> =>
  sources === undefined
    ? sql`true`
    : sources.length === 0
      ? sql`false`
      : sql`${sourceColumn} in (${sql.join(
          sources.map((source) => sql`${source}`),
          sql`, `,
        )})`;

const authorizedPassages = (
  workspaceId: string,
  maximumSensitivity: SensitivityTier,
  audienceIds: readonly string[],
  actorId: string | undefined,
  sources: KnowledgeQuery["sources"],
  candidateIds?: ReturnType<typeof sql>,
) => {
  const maximumSensitivityRank = {
    public: 0,
    internal: 1,
    confidential: 2,
    restricted: 3,
  }[maximumSensitivity];
  const audiencePredicate =
    audienceIds.length === 0
      ? sql`false`
      : sql`allow_acl.subject_id in (${sql.join(
          audienceIds.map((audienceId) => sql`${audienceId}`),
          sql`, `,
        )})`;
  const deniedAudiencePredicate =
    audienceIds.length === 0
      ? sql`false`
      : sql`deny_acl.subject_id in (${sql.join(
          audienceIds.map((audienceId) => sql`${audienceId}`),
          sql`, `,
        )})`;
  return sql`
    select
      p.id,
      s.kind as source,
      s.id as source_id,
      p.title,
      p.kind,
      p.parent_locator,
      p.hierarchy,
      p.line_start,
      p.line_end,
      p.attributes,
      (
        select parent.body
        from ${knowledgePassageTable} parent
        where parent.version_id = p.version_id
          and p.parent_locator is not null
          and (parent.locator = p.parent_locator or parent.locator like p.parent_locator || ':part-%')
          and parent.active = true
        order by parent.ordinal
        limit 1
      ) as parent_body,
      p.canonical_url,
      p.source_updated_at,
      p.sensitivity,
      i.authority,
      i.external_id,
      p.locator
    from ${knowledgePassageTable} p
    join ${knowledgeItemTable} i on i.id = p.item_id
    join ${knowledgeVersionTable} v on v.id = p.version_id
    join ${knowledgeSourceTable} s on s.id = i.source_id
    where p.workspace_id = ${workspaceId}
      and i.workspace_id = ${workspaceId}
      and v.workspace_id = ${workspaceId}
      and s.workspace_id = ${workspaceId}
      and p.active = true
      and v.active = true
      and v.tombstone = false
      and i.deleted_at is null
      and s.active = true
      and ${permittedKnowledgeSourceCondition(sources, sql`s.kind`)}
      and ${candidateIds === undefined ? sql`true` : sql`p.id in (${candidateIds})`}
      and case p.sensitivity
        when 'public' then 0
        when 'internal' then 1
        when 'confidential' then 2
        when 'restricted' then 3
        else 99
      end <= ${maximumSensitivityRank}
      and exists (
        select 1 from ${knowledgeAclBindingTable} allow_acl
        where allow_acl.passage_id = p.id
          and allow_acl.workspace_id = ${workspaceId}
          and allow_acl.effect = 'allow'
          and (
            (allow_acl.subject_type = 'workspace' and allow_acl.subject_id = ${workspaceId})
            or (allow_acl.subject_type = 'audience' and ${audiencePredicate})
            or (allow_acl.subject_type = 'actor' and allow_acl.subject_id = ${actorId ?? ""})
          )
      )
      and not exists (
        select 1 from ${knowledgeAclBindingTable} deny_acl
        where deny_acl.passage_id = p.id
          and deny_acl.workspace_id = ${workspaceId}
          and deny_acl.effect = 'deny'
          and (
            (deny_acl.subject_type = 'workspace' and deny_acl.subject_id = ${workspaceId})
            or (deny_acl.subject_type = 'audience' and ${deniedAudiencePredicate})
            or (deny_acl.subject_type = 'actor' and deny_acl.subject_id = ${actorId ?? ""})
          )
      )`;
};

const readLexicalSearchLists = async (
  database: KnowledgePostgresDatabase,
  query: KnowledgeQuery,
  limit: number,
  execution?: DeliveryExecutionContext | undefined,
  signal?: AbortSignal | undefined,
): Promise<Readonly<Record<"exact" | "keyword", readonly SearchRow[]>>> => {
  const externalId = /\b[a-z][a-z0-9]+-\d+\b/i.exec(query.question)?.[0];
  const candidateLimit = Math.min(1_000, limit * 20);
  const authorizedCandidates = () =>
    authorizedPassages(
      query.audience.workspaceId,
      query.audience.maximumSensitivity,
      query.audience.audienceIds,
      query.audience.actorId,
      query.sources,
      sql`select id from candidates`,
    );
  const [exactResult, keywordResult] = await Promise.all([
    externalId === undefined
      ? Promise.resolve({ rows: [] })
      : executePostgresKnowledgeSearch<SearchRow>(
          database,
          sql`
          with candidates as materialized (
            select passage.id
            from ${knowledgeItemTable} item
            join ${knowledgePassageTable} passage on passage.item_id = item.id
            join ${knowledgeSourceTable} on ${knowledgeSourceTable.id} = item.source_id
            where item.workspace_id = ${query.audience.workspaceId}
              and passage.workspace_id = ${query.audience.workspaceId}
              and ${permittedKnowledgeSourceCondition(query.sources)}
              and passage.active = true
              and upper(item.external_id) = upper(${externalId})
            order by passage.ordinal
            limit ${candidateLimit}
          ), authorized as materialized (${authorizedCandidates()})
          select authorized.*, content.body from authorized
          join ${knowledgePassageTable} content on content.id = authorized.id
          order by content.ordinal
          limit ${limit}`,
          "knowledge.exact",
          execution,
          signal,
        ),
    executePostgresKnowledgeSearch<SearchRow>(
      database,
      sql`
      with query as (
        select websearch_to_tsquery('english', ${query.question}) as value
      ), candidates as materialized (
        select passage.id,
               ts_rank_cd(to_tsvector('english', passage.title || ' ' || passage.body), query.value) as rank
        from ${knowledgePassageTable} passage
        join ${knowledgeItemTable} on ${knowledgeItemTable.id} = passage.item_id
        join ${knowledgeSourceTable} on ${knowledgeSourceTable.id} = ${knowledgeItemTable.sourceId}
        cross join query
        where passage.workspace_id = ${query.audience.workspaceId}
          and ${permittedKnowledgeSourceCondition(query.sources)}
          and passage.active = true
          and to_tsvector('english', passage.title || ' ' || passage.body) @@ query.value
        order by rank desc, passage.source_updated_at desc
        limit ${candidateLimit}
      ), authorized as materialized (${authorizedCandidates()})
      select authorized.*, content.body from authorized
      join ${knowledgePassageTable} content on content.id = authorized.id
      join candidates on candidates.id = authorized.id
      order by candidates.rank desc, authorized.source_updated_at desc
      limit ${limit}`,
      "knowledge.full_text",
      execution,
      signal,
    ),
  ]);
  return {
    exact: valuesFromResult(exactResult),
    keyword: valuesFromResult(keywordResult),
  };
};

const fuseSearchRows = (
  lists: Readonly<Record<string, readonly SearchRow[]>>,
  limit: number,
  expandParents = false,
): readonly KnowledgeSearchResult[] => {
  const rowsById = new Map<string, SearchRow>();
  for (const rows of Object.values(lists)) for (const row of rows) rowsById.set(row.id, row);
  return reciprocalRankFusion(
    Object.fromEntries(
      Object.entries(lists).map(([component, rows]) => [component, rows.map(rankCandidate)]),
    ),
  )
    .slice(0, limit)
    .flatMap((candidate): readonly KnowledgeSearchResult[] => {
      const row = rowsById.get(candidate.id);
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              source: row.source,
              sourceId: row.external_id,
              title: row.title,
              excerpt: [
                row.body.replace(/\s+/g, " ").trim(),
                ...(!expandParents || row.parent_body === null || row.parent_body === row.body
                  ? []
                  : [`Parent context: ${row.parent_body.replace(/\s+/g, " ").trim()}`]),
              ]
                .join("\n")
                .slice(0, 2400),
              citationUrl: row.canonical_url,
              sourceUpdatedAt: new Date(row.source_updated_at).toISOString(),
              sensitivity: row.sensitivity,
              authority: Number(row.authority),
              freshness: freshness(row.source_updated_at),
              componentRanks: candidate.componentRanks,
              score: candidate.fusedScore,
              passageKind: row.kind,
              ...(row.parent_locator === null ? {} : { parentLocator: row.parent_locator }),
              ...(row.hierarchy === null ? {} : { hierarchy: row.hierarchy }),
              ...(row.attributes === null ? {} : { attributes: row.attributes }),
              ...(row.line_start === null ? {} : { lineStart: Number(row.line_start) }),
              ...(row.line_end === null ? {} : { lineEnd: Number(row.line_end) }),
            },
          ];
    });
};

const syncAcl = async (
  database: KnowledgePostgresDatabase,
  passageIds: readonly string[],
  workspaceId: string,
  rules: readonly KnowledgeAclRule[],
  now: string,
): Promise<void> => {
  if (passageIds.length === 0) return;
  await database
    .delete(knowledgeAclBindingTable)
    .where(inArray(knowledgeAclBindingTable.passageId, passageIds));
  const rows = passageIds.flatMap((passageId) =>
    rules.map((rule) => ({
      id: `knowledge-acl:${stableSha256(`${passageId}:${rule.subjectType}:${rule.subjectId}:${rule.effect}`)}`,
      workspaceId,
      passageId,
      subjectType: rule.subjectType,
      subjectId: rule.subjectId,
      effect: rule.effect,
      createdAt: now,
    })),
  );
  if (rows.length > 0) await database.insert(knowledgeAclBindingTable).values(rows);
};

const postgresConstraintFailureOperations = new Map<string, string>([
  ["knowledge_source_workspace_id", "knowledge-reconcile.source-duplicate"],
  ["knowledge_item_source_external", "knowledge-reconcile.item-duplicate"],
  ["knowledge_version_item_source_version", "knowledge-reconcile.version-duplicate"],
  ["knowledge_passage_version_locator", "knowledge-reconcile.passage-duplicate"],
  ["knowledge_acl_passage_subject", "knowledge-reconcile.passage-acl-duplicate"],
  ["delivery_object_workspace_source_kind_key", "knowledge-reconcile.object-duplicate"],
  ["delivery_relation_workspace_edge", "knowledge-reconcile.relation-duplicate"],
  ["delivery_observation_workspace_source_external", "knowledge-reconcile.observation-duplicate"],
  ["delivery_metric_workspace_subject_kind_effective", "knowledge-reconcile.metric-duplicate"],
  [
    "delivery_finance_metric_workspace_subject_kind_effective",
    "knowledge-reconcile.finance-metric-duplicate",
  ],
  ["delivery_claim_source_value", "knowledge-reconcile.claim-duplicate"],
  ["delivery_acl_target_subject", "knowledge-reconcile.delivery-acl-duplicate"],
  ["delivery_metric_excludes_finance", "knowledge-reconcile.metric-finance-boundary"],
  ["delivery_finance_metric_confidential", "knowledge-reconcile.finance-sensitivity-boundary"],
]);

const postgresCodeFailureOperations = new Map<string, string>([
  ["08006", "knowledge-reconcile.connection-failure"],
  ["08P01", "knowledge-reconcile.protocol-limit"],
  ["23503", "knowledge-reconcile.foreign-key"],
  ["23505", "knowledge-reconcile.unique"],
  ["23514", "knowledge-reconcile.check"],
  ["22003", "knowledge-reconcile.numeric-range"],
  ["22007", "knowledge-reconcile.datetime"],
  ["22P02", "knowledge-reconcile.invalid-value"],
  ["53300", "knowledge-reconcile.connection-capacity"],
  ["54000", "knowledge-reconcile.program-limit"],
  ["57014", "knowledge-reconcile.query-cancelled"],
]);

const reconcileStageFailureOperations = {
  source: "knowledge-reconcile.source-stage",
  inventory: "knowledge-reconcile.inventory-stage",
  documents: "knowledge-reconcile.document-stage",
  delivery: "knowledge-reconcile.delivery-stage",
  deliveryInventory: "knowledge-reconcile.delivery-inventory-stage",
  deliveryDeactivate: "knowledge-reconcile.delivery-deactivate-stage",
  deliveryDeactivateObjects: "knowledge-reconcile.delivery-deactivate-objects-stage",
  deliveryDeactivateAliases: "knowledge-reconcile.delivery-deactivate-aliases-stage",
  deliveryDeactivateRelations: "knowledge-reconcile.delivery-deactivate-relations-stage",
  deliveryDeactivateObservations: "knowledge-reconcile.delivery-deactivate-observations-stage",
  deliveryDeactivateMetrics: "knowledge-reconcile.delivery-deactivate-metrics-stage",
  deliveryDeactivateFinanceMetrics: "knowledge-reconcile.delivery-deactivate-finance-metrics-stage",
  deliveryDeactivateClaims: "knowledge-reconcile.delivery-deactivate-claims-stage",
  deliveryDeactivateAcl: "knowledge-reconcile.delivery-deactivate-acl-stage",
  deliveryObjects: "knowledge-reconcile.delivery-objects-stage",
  deliveryAliases: "knowledge-reconcile.delivery-aliases-stage",
  deliveryRelations: "knowledge-reconcile.delivery-relations-stage",
  deliveryObservations: "knowledge-reconcile.delivery-observations-stage",
  deliveryMetrics: "knowledge-reconcile.delivery-metrics-stage",
  deliveryClaims: "knowledge-reconcile.delivery-claims-stage",
  checkpoint: "knowledge-reconcile.checkpoint-stage",
} as const;

type ReconcileStage = keyof typeof reconcileStageFailureOperations;

export const checkpointActivityForTrigger = (
  trigger: SynchronizationTrigger,
  now: string,
  previous: {
    readonly lastEventAt?: string | null | undefined;
    readonly lastReconciledAt?: string | null | undefined;
  },
) => ({
  lastEventAt: trigger === "source-event" ? now : (previous.lastEventAt ?? null),
  lastReconciledAt: trigger === "source-event" ? (previous.lastReconciledAt ?? null) : now,
});

class KnowledgeReconcileStageError extends Error {
  readonly cause: unknown;
  readonly reconcileStage: ReconcileStage;

  constructor(reconcileStage: ReconcileStage, cause: unknown) {
    super("Knowledge reconciliation failed within an identified stage.");
    this.name = "KnowledgeReconcileStageError";
    this.reconcileStage = reconcileStage;
    this.cause = cause;
  }
}

type ErrorMetadata = {
  readonly cause?: unknown;
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly constraint_name?: unknown;
  readonly reconcileStage?: unknown;
};

export const classifyKnowledgeReconcileFailure = (failure: unknown): string => {
  let current: unknown = failure;
  let stageOperation: string | undefined;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const metadata = current as ErrorMetadata;
    if (
      typeof metadata.reconcileStage === "string" &&
      metadata.reconcileStage in reconcileStageFailureOperations
    )
      stageOperation = reconcileStageFailureOperations[metadata.reconcileStage as ReconcileStage];
    const constraint =
      typeof metadata.constraint_name === "string"
        ? metadata.constraint_name
        : typeof metadata.constraint === "string"
          ? metadata.constraint
          : undefined;
    const constraintOperation =
      constraint === undefined ? undefined : postgresConstraintFailureOperations.get(constraint);
    if (constraintOperation !== undefined) return constraintOperation;
    if (typeof metadata.code === "string") {
      const codeOperation = postgresCodeFailureOperations.get(metadata.code);
      if (codeOperation !== undefined) return codeOperation;
    }
    current = metadata.cause;
  }
  return stageOperation ?? "knowledge-reconcile";
};

type ProjectedDocument = {
  readonly document: KnowledgeSourceDocument;
  readonly documentItemId: string;
  readonly versionId: string;
};

const syncDeliveryProjection = async (
  database: KnowledgePostgresDatabase,
  projectedDocuments: readonly ProjectedDocument[],
  now: string,
  onStage: (stage: ReconcileStage) => void,
  entityCatalog?: DeliveryEntityCatalog | undefined,
): Promise<void> => {
  onStage("deliveryInventory");
  const activeDocuments = projectedDocuments.filter(
    ({ document }) => document.deliveryProjection !== undefined,
  );
  if (activeDocuments.length === 0) return;
  const workspaceId = activeDocuments[0]?.document.workspaceId;
  if (
    workspaceId === undefined ||
    activeDocuments.some(({ document }) => document.workspaceId !== workspaceId)
  )
    throw new Error("Delivery projection reconciliation requires one workspace.");
  const itemIds = activeDocuments.map(({ documentItemId }) => documentItemId);
  const versionRows = await database
    .select({ id: knowledgeVersionTable.id })
    .from(knowledgeVersionTable)
    .where(inArray(knowledgeVersionTable.itemId, itemIds));
  const versionIds = versionRows.map(({ id }) => id);
  const previousObjects = await database
    .select({ id: deliveryObjectTable.id })
    .from(deliveryObjectTable)
    .where(inArray(deliveryObjectTable.sourceItemId, itemIds));
  const previousRelations =
    versionIds.length === 0
      ? []
      : await database
          .select({ id: deliveryRelationTable.id })
          .from(deliveryRelationTable)
          .where(inArray(deliveryRelationTable.sourceVersionId, versionIds));
  const previousObservations =
    versionIds.length === 0
      ? []
      : await database
          .select({ id: deliveryObservationTable.id })
          .from(deliveryObservationTable)
          .where(inArray(deliveryObservationTable.sourceVersionId, versionIds));
  const previousMetrics =
    versionIds.length === 0
      ? []
      : await database
          .select({ id: deliveryMetricTable.id })
          .from(deliveryMetricTable)
          .where(inArray(deliveryMetricTable.sourceVersionId, versionIds));
  const previousFinanceMetrics =
    versionIds.length === 0
      ? []
      : await database
          .select({ id: deliveryFinanceMetricTable.id })
          .from(deliveryFinanceMetricTable)
          .where(inArray(deliveryFinanceMetricTable.sourceVersionId, versionIds));
  const previousClaims =
    versionIds.length === 0
      ? []
      : await database
          .select({ id: deliveryClaimTable.id })
          .from(deliveryClaimTable)
          .where(inArray(deliveryClaimTable.sourceVersionId, versionIds));
  onStage("deliveryDeactivate");
  if (previousObjects.length > 0) {
    onStage("deliveryDeactivateObjects");
    for (const ids of boundedPostgresBindBatches(previousObjects.map(({ id }) => id)))
      await database
        .update(deliveryObjectTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryObjectTable.id, ids));
    onStage("deliveryDeactivateAliases");
    for (const ids of boundedPostgresBindBatches(previousObjects.map(({ id }) => id)))
      await database
        .update(deliveryEntityAliasTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryEntityAliasTable.sourceObjectId, ids));
  }
  if (previousRelations.length > 0) {
    onStage("deliveryDeactivateRelations");
    for (const ids of boundedPostgresBindBatches(previousRelations.map(({ id }) => id)))
      await database
        .update(deliveryRelationTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryRelationTable.id, ids));
  }
  if (previousObservations.length > 0) {
    onStage("deliveryDeactivateObservations");
    for (const ids of boundedPostgresBindBatches(previousObservations.map(({ id }) => id)))
      await database
        .update(deliveryObservationTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryObservationTable.id, ids));
  }
  if (previousMetrics.length > 0) {
    onStage("deliveryDeactivateMetrics");
    for (const ids of boundedPostgresBindBatches(previousMetrics.map(({ id }) => id)))
      await database
        .update(deliveryMetricTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryMetricTable.id, ids));
  }
  if (previousFinanceMetrics.length > 0) {
    onStage("deliveryDeactivateFinanceMetrics");
    for (const ids of boundedPostgresBindBatches(previousFinanceMetrics.map(({ id }) => id)))
      await database
        .update(deliveryFinanceMetricTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryFinanceMetricTable.id, ids));
  }
  if (previousClaims.length > 0) {
    onStage("deliveryDeactivateClaims");
    for (const ids of boundedPostgresBindBatches(previousClaims.map(({ id }) => id)))
      await database
        .update(deliveryClaimTable)
        .set({ active: false, deletedAt: now })
        .where(inArray(deliveryClaimTable.id, ids));
  }
  const previousTargetIds = [
    ...previousObjects.map(({ id }) => id),
    ...previousRelations.map(({ id }) => id),
    ...previousObservations.map(({ id }) => id),
    ...previousMetrics.map(({ id }) => id),
    ...previousFinanceMetrics.map(({ id }) => id),
    ...previousClaims.map(({ id }) => id),
  ];
  if (previousTargetIds.length > 0) {
    onStage("deliveryDeactivateAcl");
    for (const ids of boundedPostgresBindBatches(previousTargetIds))
      await database
        .delete(deliveryAclBindingTable)
        .where(inArray(deliveryAclBindingTable.targetId, ids));
  }

  onStage("deliveryObjects");
  const objectRows = new Map<
    string,
    typeof deliveryObjectTable.$inferInsert & {
      readonly rules: readonly KnowledgeAclRule[];
      readonly aliases: readonly string[];
    }
  >();
  for (const projected of activeDocuments) {
    for (const object of projected.document.deliveryProjection?.objects ?? []) {
      assertNonFinancialAttributes(object.attributes);
      const id = deliveryObjectId(
        projected.document.workspaceId,
        projected.document.sourceId,
        object,
      );
      const current = objectRows.get(id);
      if (
        current !== undefined &&
        current.attributes.placeholder !== true &&
        object.attributes.placeholder === true
      )
        continue;
      const resolved = resolveDeliveryEntity(entityCatalog, projected.document.source, object);
      objectRows.set(id, {
        id,
        workspaceId: projected.document.workspaceId,
        objectKind: object.kind,
        externalKey: object.externalKey,
        canonicalKey: resolved.canonicalKey,
        title: resolved.canonicalTitle,
        lifecycleState: object.lifecycleState ?? null,
        attributes: object.attributes,
        sensitivity: object.sensitivity,
        sourceKind: projected.document.source,
        sourceId: projected.document.sourceId,
        sourceItemId: projected.documentItemId,
        sourceVersionId: projected.versionId,
        effectiveFrom: object.effectiveFrom ?? null,
        effectiveTo: object.effectiveTo ?? null,
        sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
        sourceUpdatedAt: projected.document.sourceUpdatedAt,
        observedAt: object.observedAt ?? projected.document.sourceUpdatedAt,
        indexedAt: now,
        active: true,
        deletedAt: null,
        rules: projected.document.acl,
        aliases: resolved.aliases,
      });
    }
  }
  for (const { rules, aliases, ...row } of objectRows.values()) {
    await database
      .insert(deliveryObjectTable)
      .values(row)
      .onConflictDoUpdate({
        target: deliveryObjectTable.id,
        set: {
          title: row.title,
          canonicalKey: row.canonicalKey,
          lifecycleState: row.lifecycleState,
          attributes: row.attributes,
          sensitivity: row.sensitivity,
          sourceItemId: row.sourceItemId,
          sourceVersionId: row.sourceVersionId,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          sourceCreatedAt: row.sourceCreatedAt,
          sourceUpdatedAt: row.sourceUpdatedAt,
          observedAt: row.observedAt,
          indexedAt: now,
          active: true,
          deletedAt: null,
        },
      });
    await database
      .insert(deliveryAclBindingTable)
      .values(deliveryTargetAclRows("object", row.id, row.workspaceId, rules, now))
      .onConflictDoNothing();
    onStage("deliveryAliases");
    for (const alias of aliases) {
      const normalizedAlias = normalizeDeliveryEntityAlias(alias);
      if (normalizedAlias === "") continue;
      const aliasRow = {
        id: `delivery-alias:${stableSha256(`${row.id}:${normalizedAlias}`)}`,
        workspaceId: row.workspaceId,
        objectKind: row.objectKind,
        canonicalKey: row.canonicalKey,
        alias,
        normalizedAlias,
        sourceObjectId: row.id,
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
        sensitivity: row.sensitivity,
        sourceUpdatedAt: row.sourceUpdatedAt,
        indexedAt: now,
        active: true,
        deletedAt: null,
      };
      await database
        .insert(deliveryEntityAliasTable)
        .values(aliasRow)
        .onConflictDoUpdate({
          target: deliveryEntityAliasTable.id,
          set: {
            canonicalKey: aliasRow.canonicalKey,
            alias: aliasRow.alias,
            sensitivity: aliasRow.sensitivity,
            sourceUpdatedAt: aliasRow.sourceUpdatedAt,
            indexedAt: now,
            active: true,
            deletedAt: null,
          },
        });
    }
  }

  for (const projected of activeDocuments) {
    const projection = projected.document.deliveryProjection;
    if (projection === undefined) continue;
    onStage("deliveryRelations");
    for (const [index, relation] of projection.relations.entries()) {
      const fromObjectId = deliveryObjectId(
        projected.document.workspaceId,
        projected.document.sourceId,
        relation.from,
      );
      const toObjectId = deliveryObjectId(
        projected.document.workspaceId,
        projected.document.sourceId,
        relation.to,
      );
      const id = `delivery-relation:${stableSha256(`${projected.versionId}:${relation.kind}:${fromObjectId}:${toObjectId}:${index}`)}`;
      await database
        .insert(deliveryRelationTable)
        .values({
          id,
          workspaceId: projected.document.workspaceId,
          relationKind: relation.kind,
          fromObjectId,
          toObjectId,
          attributes: relation.attributes,
          sensitivity: relation.sensitivity,
          sourceKind: projected.document.source,
          sourceId: projected.document.sourceId,
          sourceItemId: projected.documentItemId,
          sourceVersionId: projected.versionId,
          effectiveFrom: relation.effectiveFrom ?? null,
          effectiveTo: relation.effectiveTo ?? null,
          sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
          sourceUpdatedAt: projected.document.sourceUpdatedAt,
          observedAt: projected.document.sourceUpdatedAt,
          indexedAt: now,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: deliveryRelationTable.id,
          set: {
            attributes: relation.attributes,
            effectiveFrom: relation.effectiveFrom ?? null,
            effectiveTo: relation.effectiveTo ?? null,
            sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
            sourceUpdatedAt: projected.document.sourceUpdatedAt,
            observedAt: projected.document.sourceUpdatedAt,
            indexedAt: now,
            active: true,
            deletedAt: null,
          },
        });
      await database
        .insert(deliveryAclBindingTable)
        .values(
          deliveryTargetAclRows(
            "relation",
            id,
            projected.document.workspaceId,
            projected.document.acl,
            now,
          ),
        )
        .onConflictDoNothing();
    }
    onStage("deliveryObservations");
    for (const observation of projection.observations) {
      const subjectObjectId =
        observation.subject === undefined
          ? null
          : deliveryObjectId(
              projected.document.workspaceId,
              projected.document.sourceId,
              observation.subject,
            );
      const id = `delivery-observation:${stableSha256(`${projected.document.sourceId}:${observation.externalId}`)}`;
      await database
        .insert(deliveryObservationTable)
        .values({
          id,
          workspaceId: projected.document.workspaceId,
          observationKind: observation.kind,
          externalId: observation.externalId,
          subjectObjectId,
          actorExternalKey: observation.actorExternalKey ?? null,
          summary: observation.summary,
          dedupeKey: observation.dedupeKey,
          occurredAt: observation.occurredAt,
          sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
          sourceUpdatedAt: projected.document.sourceUpdatedAt,
          observedAt: observation.occurredAt,
          indexedAt: now,
          sensitivity: observation.sensitivity,
          authority: observation.authority,
          sourceKind: projected.document.source,
          sourceId: projected.document.sourceId,
          sourceItemId: projected.documentItemId,
          sourceVersionId: projected.versionId,
          citationUrl: observation.citationUrl ?? projected.document.canonicalUrl,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: deliveryObservationTable.id,
          set: {
            summary: observation.summary,
            dedupeKey: observation.dedupeKey,
            occurredAt: observation.occurredAt,
            sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
            sourceUpdatedAt: projected.document.sourceUpdatedAt,
            observedAt: observation.occurredAt,
            indexedAt: now,
            sourceVersionId: projected.versionId,
            active: true,
            deletedAt: null,
          },
        });
      await database
        .insert(deliveryAclBindingTable)
        .values(
          deliveryTargetAclRows(
            "observation",
            id,
            projected.document.workspaceId,
            projected.document.acl,
            now,
          ),
        )
        .onConflictDoNothing();
    }
    onStage("deliveryMetrics");
    for (const [index, metric] of projection.metrics.entries()) {
      if (
        metric.category === "finance" &&
        metric.sensitivity !== "confidential" &&
        metric.sensitivity !== "restricted"
      )
        throw new Error("Financial delivery metrics must be confidential or restricted.");
      if (!Number.isFinite(Number(metric.value)))
        throw new Error("Delivery metric value is invalid.");
      const subjectObjectId = deliveryObjectId(
        projected.document.workspaceId,
        projected.document.sourceId,
        metric.subject,
      );
      const targetTable =
        metric.category === "finance" ? deliveryFinanceMetricTable : deliveryMetricTable;
      const targetType = metric.category === "finance" ? "finance_metric" : "metric";
      const id = `delivery-${targetType}:${stableSha256(`${projected.versionId}:${metric.kind}:${subjectObjectId}:${metric.effectiveFrom ?? ""}:${index}`)}`;
      await database
        .insert(targetTable)
        .values({
          id,
          workspaceId: projected.document.workspaceId,
          subjectObjectId,
          ...(metric.category === "finance" ? {} : { metricCategory: metric.category }),
          metricKind: metric.kind,
          value: metric.value,
          unit: metric.unit,
          effectiveFrom: metric.effectiveFrom ?? null,
          effectiveTo: metric.effectiveTo ?? null,
          sensitivity: metric.sensitivity,
          sourceKind: projected.document.source,
          sourceId: projected.document.sourceId,
          sourceItemId: projected.documentItemId,
          sourceVersionId: projected.versionId,
          sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
          sourceUpdatedAt: projected.document.sourceUpdatedAt,
          observedAt: metric.effectiveFrom ?? projected.document.sourceUpdatedAt,
          indexedAt: now,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: targetTable.id,
          set: {
            value: metric.value,
            sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
            sourceUpdatedAt: projected.document.sourceUpdatedAt,
            observedAt: metric.effectiveFrom ?? projected.document.sourceUpdatedAt,
            indexedAt: now,
            active: true,
            deletedAt: null,
          },
        });
      await database
        .insert(deliveryAclBindingTable)
        .values(
          deliveryTargetAclRows(
            targetType,
            id,
            projected.document.workspaceId,
            projected.document.acl,
            now,
          ),
        )
        .onConflictDoNothing();
    }
    onStage("deliveryClaims");
    for (const [index, claim] of projection.claims.entries()) {
      const subjectObjectId =
        claim.subject === undefined
          ? null
          : deliveryObjectId(
              projected.document.workspaceId,
              projected.document.sourceId,
              claim.subject,
            );
      const canonicalSubjectKey =
        subjectObjectId === null
          ? claim.subjectKey
          : (objectRows.get(subjectObjectId)?.canonicalKey ?? claim.subjectKey);
      const valueHash = deliveryClaimValueHash(claim.value);
      const id = `delivery-claim:${stableSha256(`${projected.versionId}:${canonicalSubjectKey}:${claim.predicate}:${valueHash}:${index}`)}`;
      await database
        .insert(deliveryClaimTable)
        .values({
          id,
          workspaceId: projected.document.workspaceId,
          subjectObjectId,
          subjectKey: canonicalSubjectKey,
          predicate: claim.predicate,
          value: claim.value,
          valueHash,
          assertedBy: claim.assertedBy ?? null,
          externalAssertionId: claim.externalAssertionId ?? null,
          supersedesAssertionIds: claim.supersedesAssertionIds ?? [],
          confidence: claim.confidence ?? null,
          assertionSchemaVersion: claim.assertionSchemaVersion ?? null,
          sourceKind: projected.document.source,
          sourceId: projected.document.sourceId,
          sourceItemId: projected.documentItemId,
          sourceVersionId: projected.versionId,
          citationUrl: claim.citationUrl ?? projected.document.canonicalUrl,
          assertedAt: claim.assertedAt,
          sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
          sourceUpdatedAt: projected.document.sourceUpdatedAt,
          observedAt: claim.assertedAt,
          indexedAt: now,
          effectiveFrom: claim.effectiveFrom ?? null,
          effectiveTo: claim.effectiveTo ?? null,
          sensitivity: claim.sensitivity,
          authority: claim.authority,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: deliveryClaimTable.id,
          set: {
            assertedBy: claim.assertedBy ?? null,
            externalAssertionId: claim.externalAssertionId ?? null,
            supersedesAssertionIds: claim.supersedesAssertionIds ?? [],
            confidence: claim.confidence ?? null,
            assertionSchemaVersion: claim.assertionSchemaVersion ?? null,
            sourceCreatedAt: projected.document.sourceCreatedAt ?? null,
            sourceUpdatedAt: projected.document.sourceUpdatedAt,
            observedAt: claim.assertedAt,
            indexedAt: now,
            active: true,
            deletedAt: null,
          },
        });
      await database
        .insert(deliveryAclBindingTable)
        .values(
          deliveryTargetAclRows(
            "claim",
            id,
            projected.document.workspaceId,
            projected.document.acl,
            now,
          ),
        )
        .onConflictDoNothing();
    }
  }
};

const reconcileSnapshot = async (
  database: KnowledgePostgresDatabase,
  snapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
  vectorsByVersion: ReadonlyMap<string, readonly (readonly number[])[]>,
  trigger: SynchronizationTrigger,
  entityCatalog?: DeliveryEntityCatalog | undefined,
) => {
  let stage: ReconcileStage = "source";
  try {
    return await database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const firstDocument = snapshot.documents[0];
      await transaction
        .insert(knowledgeSourceTable)
        .values({
          id: snapshot.sourceId,
          workspaceId: snapshot.workspaceId,
          kind: snapshot.source,
          authority: firstDocument?.authority ?? 0,
          scopeHash: snapshot.scopeHash,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: knowledgeSourceTable.id,
          set: {
            scopeHash: snapshot.scopeHash,
            ...(firstDocument === undefined ? {} : { authority: firstDocument.authority }),
            active: true,
            updatedAt: now,
          },
        });

      stage = "inventory";
      const existingItems = await transaction
        .select({ id: knowledgeItemTable.id, externalId: knowledgeItemTable.externalId })
        .from(knowledgeItemTable)
        .where(
          and(
            eq(knowledgeItemTable.sourceId, snapshot.sourceId),
            eq(knowledgeItemTable.workspaceId, snapshot.workspaceId),
            isNull(knowledgeItemTable.deletedAt),
          ),
        );
      const observedExternalIds = snapshot.documents.map(({ externalId }) => externalId);
      const retiredExternalIds = new Set(snapshot.retiredExternalIds ?? []);
      const deletedItems = existingItems.filter(({ externalId }) =>
        snapshot.mode === "delta"
          ? retiredExternalIds.has(externalId)
          : !observedExternalIds.includes(externalId),
      );
      if (deletedItems.length > 0) {
        const deletedIds = deletedItems.map(({ id }) => id);
        const deletedVersions = await transaction
          .select({ id: knowledgeVersionTable.id })
          .from(knowledgeVersionTable)
          .where(inArray(knowledgeVersionTable.itemId, deletedIds));
        const deletedVersionIds = deletedVersions.map(({ id }) => id);
        const deletedObjects = await transaction
          .select({ id: deliveryObjectTable.id })
          .from(deliveryObjectTable)
          .where(inArray(deliveryObjectTable.sourceItemId, deletedIds));
        await transaction
          .update(knowledgeItemTable)
          .set({ deletedAt: now, observedAt: now })
          .where(inArray(knowledgeItemTable.id, deletedIds));
        await transaction
          .update(knowledgeVersionTable)
          .set({ active: false, tombstone: true, observedAt: now })
          .where(inArray(knowledgeVersionTable.itemId, deletedIds));
        await transaction
          .update(knowledgePassageTable)
          .set({ active: false })
          .where(inArray(knowledgePassageTable.itemId, deletedIds));
        await transaction
          .update(deliveryObjectTable)
          .set({ active: false, deletedAt: now })
          .where(inArray(deliveryObjectTable.sourceItemId, deletedIds));
        if (deletedObjects.length > 0)
          await transaction
            .update(deliveryEntityAliasTable)
            .set({ active: false, deletedAt: now })
            .where(
              inArray(
                deliveryEntityAliasTable.sourceObjectId,
                deletedObjects.map(({ id }) => id),
              ),
            );
        if (deletedVersionIds.length > 0) {
          await transaction
            .update(deliveryRelationTable)
            .set({ active: false, deletedAt: now })
            .where(inArray(deliveryRelationTable.sourceVersionId, deletedVersionIds));
          await transaction
            .update(deliveryObservationTable)
            .set({ active: false, deletedAt: now })
            .where(inArray(deliveryObservationTable.sourceVersionId, deletedVersionIds));
          await transaction
            .update(deliveryMetricTable)
            .set({ active: false, deletedAt: now })
            .where(inArray(deliveryMetricTable.sourceVersionId, deletedVersionIds));
          await transaction
            .update(deliveryFinanceMetricTable)
            .set({ active: false, deletedAt: now })
            .where(inArray(deliveryFinanceMetricTable.sourceVersionId, deletedVersionIds));
          await transaction
            .update(deliveryClaimTable)
            .set({ active: false, deletedAt: now })
            .where(inArray(deliveryClaimTable.sourceVersionId, deletedVersionIds));
        }
      }

      stage = "documents";
      let versionsCreated = 0;
      let passagesActive = 0;
      const projectedDocuments: ProjectedDocument[] = [];
      for (const document of snapshot.documents) {
        const documentItemId = itemId(document);
        const versionHash = effectiveVersion(document);
        const currentVersionId = versionId(document);
        const passageVectors = vectorsByVersion.get(currentVersionId);
        await transaction
          .insert(knowledgeItemTable)
          .values({
            id: documentItemId,
            sourceId: document.sourceId,
            workspaceId: document.workspaceId,
            externalId: document.externalId,
            sourceType: document.sourceType,
            canonicalUrl: document.canonicalUrl,
            title: document.title,
            sensitivity: document.sensitivity,
            authority: document.authority,
            sourceCreatedAt: document.sourceCreatedAt ?? null,
            sourceUpdatedAt: document.sourceUpdatedAt,
            observedAt: now,
          })
          .onConflictDoUpdate({
            target: knowledgeItemTable.id,
            set: {
              canonicalUrl: document.canonicalUrl,
              title: document.title,
              sensitivity: document.sensitivity,
              authority: document.authority,
              sourceCreatedAt: document.sourceCreatedAt ?? null,
              sourceUpdatedAt: document.sourceUpdatedAt,
              observedAt: now,
              deletedAt: null,
            },
          });

        const existingVersion = await transaction
          .select({ id: knowledgeVersionTable.id })
          .from(knowledgeVersionTable)
          .where(eq(knowledgeVersionTable.id, currentVersionId))
          .limit(1);
        if (existingVersion.length === 0) {
          versionsCreated += 1;
          await transaction
            .update(knowledgeVersionTable)
            .set({ active: false })
            .where(eq(knowledgeVersionTable.itemId, documentItemId));
          await transaction
            .update(knowledgePassageTable)
            .set({ active: false })
            .where(eq(knowledgePassageTable.itemId, documentItemId));
          await transaction.insert(knowledgeVersionTable).values({
            id: currentVersionId,
            itemId: documentItemId,
            workspaceId: document.workspaceId,
            sourceVersion: versionHash,
            contentHash: versionHash,
            sourceCreatedAt: document.sourceCreatedAt ?? null,
            sourceUpdatedAt: document.sourceUpdatedAt,
            observedAt: now,
            active: true,
            tombstone: false,
            provenance: { ...document.provenance, sourceVersion: document.sourceVersion },
          });
          for (const [passageIndex, passage] of document.passages.entries()) {
            const vector = passageVectors?.[passageIndex];
            if (vector === undefined || vector.length !== embeddings.dimensions)
              throw new Error("Embedding result count or dimensions did not match passages.");
            const passageId = `knowledge-passage:${stableSha256(`${currentVersionId}:${passage.locator}`)}`;
            await transaction.insert(knowledgePassageTable).values({
              id: passageId,
              itemId: documentItemId,
              versionId: currentVersionId,
              workspaceId: document.workspaceId,
              kind: passage.kind,
              locator: passage.locator,
              parentLocator: passage.parentLocator ?? null,
              hierarchy: passage.hierarchy ?? null,
              lineStart: passage.lineStart ?? null,
              lineEnd: passage.lineEnd ?? null,
              attributes: passage.attributes ?? null,
              ordinal: passage.ordinal,
              title: passage.title,
              body: passage.body,
              contentHash: passage.contentHash,
              canonicalUrl: citationUrl(document, passage.locator),
              sensitivity: document.sensitivity,
              sourceUpdatedAt: document.sourceUpdatedAt,
              active: true,
            });
            await transaction.insert(knowledgeProjectionTable).values({
              passageId,
              workspaceId: document.workspaceId,
              embeddingModel: embeddings.model,
              embeddingDimensions: embeddings.dimensions,
              embedding: [...vector],
              contentHash: passage.contentHash,
              createdAt: now,
            });
          }
        } else {
          await transaction
            .update(knowledgeVersionTable)
            .set({ active: false })
            .where(
              and(
                eq(knowledgeVersionTable.itemId, documentItemId),
                ne(knowledgeVersionTable.id, currentVersionId),
              ),
            );
          await transaction
            .update(knowledgePassageTable)
            .set({ active: false })
            .where(eq(knowledgePassageTable.itemId, documentItemId));
          await transaction
            .update(knowledgeVersionTable)
            .set({ active: true, tombstone: false, observedAt: now })
            .where(eq(knowledgeVersionTable.id, currentVersionId));
          await transaction
            .update(knowledgePassageTable)
            .set({ active: true })
            .where(eq(knowledgePassageTable.versionId, currentVersionId));
          if (passageVectors !== undefined) {
            const restoredPassages = await transaction
              .select({
                id: knowledgePassageTable.id,
                ordinal: knowledgePassageTable.ordinal,
                contentHash: knowledgePassageTable.contentHash,
              })
              .from(knowledgePassageTable)
              .where(eq(knowledgePassageTable.versionId, currentVersionId));
            for (const passage of restoredPassages) {
              const vector = passageVectors[passage.ordinal];
              if (vector === undefined || vector.length !== embeddings.dimensions)
                throw new Error("Embedding result count or dimensions did not match passages.");
              await transaction
                .insert(knowledgeProjectionTable)
                .values({
                  passageId: passage.id,
                  workspaceId: document.workspaceId,
                  embeddingModel: embeddings.model,
                  embeddingDimensions: embeddings.dimensions,
                  embedding: [...vector],
                  contentHash: passage.contentHash,
                  createdAt: now,
                })
                .onConflictDoUpdate({
                  target: knowledgeProjectionTable.passageId,
                  set: {
                    embeddingModel: embeddings.model,
                    embeddingDimensions: embeddings.dimensions,
                    embedding: [...vector],
                    contentHash: passage.contentHash,
                    createdAt: now,
                  },
                });
            }
          }
        }
        const activePassages = await transaction
          .select({ id: knowledgePassageTable.id })
          .from(knowledgePassageTable)
          .where(
            and(
              eq(knowledgePassageTable.versionId, currentVersionId),
              eq(knowledgePassageTable.active, true),
            ),
          );
        passagesActive += activePassages.length;
        await syncAcl(
          transaction,
          activePassages.map(({ id }) => id),
          document.workspaceId,
          document.acl,
          now,
        );
        projectedDocuments.push({ document, documentItemId, versionId: currentVersionId });
      }

      stage = "delivery";
      await syncDeliveryProjection(
        transaction,
        projectedDocuments,
        now,
        (nextStage) => {
          stage = nextStage;
        },
        entityCatalog,
      );

      stage = "checkpoint";
      const checksum = stableSha256(
        canonicalize({
          sourceId: snapshot.sourceId,
          cursor: snapshot.cursor,
          scopeHash: snapshot.scopeHash,
          mode: snapshot.mode ?? "full",
          retiredExternalIds: [...retiredExternalIds].sort(),
          documents: snapshot.documents.map(
            ({ externalId, sourceVersion, passages, acl, deliveryProjection }) => ({
              externalId,
              sourceVersion,
              passages: passages.map(({ locator, contentHash }) => ({ locator, contentHash })),
              acl,
              deliveryProjection,
            }),
          ),
        }),
      );
      const summary = {
        sourceId: snapshot.sourceId,
        workspaceId: snapshot.workspaceId,
        cursor: snapshot.cursor,
        scopeHash: snapshot.scopeHash,
        documentsObserved: snapshot.documents.length,
        versionsCreated,
        passagesActive,
        itemsDeleted: deletedItems.length,
        checksum,
      } as const;
      const newestObservedAt = snapshot.documents.reduce<string | null>(
        (latest, document) =>
          latest === null || Date.parse(document.sourceUpdatedAt) > Date.parse(latest)
            ? document.sourceUpdatedAt
            : latest,
        null,
      );
      const [previousCheckpoint] = await transaction
        .select({
          lastEventAt: knowledgeSyncCheckpointTable.lastEventAt,
          lastReconciledAt: knowledgeSyncCheckpointTable.lastReconciledAt,
          newestSourceUpdatedAt: knowledgeSyncCheckpointTable.newestSourceUpdatedAt,
        })
        .from(knowledgeSyncCheckpointTable)
        .where(
          and(
            eq(knowledgeSyncCheckpointTable.sourceId, snapshot.sourceId),
            eq(knowledgeSyncCheckpointTable.workspaceId, snapshot.workspaceId),
          ),
        )
        .limit(1);
      const newestSourceUpdatedAt =
        snapshot.mode === "delta" &&
        previousCheckpoint?.newestSourceUpdatedAt !== null &&
        previousCheckpoint?.newestSourceUpdatedAt !== undefined &&
        (newestObservedAt === null || previousCheckpoint.newestSourceUpdatedAt > newestObservedAt)
          ? previousCheckpoint.newestSourceUpdatedAt
          : newestObservedAt;
      const operationalCheckpoint = {
        indexedSourceRevision: snapshot.cursor,
        ...checkpointActivityForTrigger(trigger, now, previousCheckpoint ?? {}),
        newestSourceUpdatedAt,
        lastSucceededAt: now,
        lagSeconds:
          newestSourceUpdatedAt === null
            ? null
            : Math.max(
                0,
                Math.floor((Date.parse(now) - Date.parse(newestSourceUpdatedAt)) / 1_000),
              ),
        retryCount: 0,
        nextReconcileAt: new Date(Date.parse(now) + 60 * 60 * 1_000).toISOString(),
        failureClass: null,
      } as const;
      await transaction
        .insert(knowledgeSyncCheckpointTable)
        .values({
          ...summary,
          ...operationalCheckpoint,
          status: "succeeded",
          errorCode: null,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [knowledgeSyncCheckpointTable.sourceId, knowledgeSyncCheckpointTable.workspaceId],
          set: {
            ...summary,
            ...operationalCheckpoint,
            status: "succeeded",
            errorCode: null,
            syncedAt: now,
          },
        });
      await transaction
        .delete(knowledgeEmbeddingCacheTable)
        .where(
          and(
            eq(knowledgeEmbeddingCacheTable.workspaceId, snapshot.workspaceId),
            eq(knowledgeEmbeddingCacheTable.sourceId, snapshot.sourceId),
          ),
        );
      return summary;
    });
  } catch (cause) {
    throw new KnowledgeReconcileStageError(stage, cause);
  }
};

export const createPostgresKnowledgeRepository = (
  database: KnowledgePostgresDatabase,
  configuration: {
    readonly entityCatalog?: DeliveryEntityCatalog | undefined;
    readonly execution?: DeliveryExecutionContext | undefined;
  } = {},
): KnowledgeRepository => ({
  reconcile: (snapshot, embeddings, trigger) => {
    if (embeddings.dimensions !== 1536) {
      return Effect.fail(
        new RepositoryError({
          message: "Knowledge embedding dimensions must be 1536 for the active projection schema.",
          operation: "knowledge-reconcile",
        }),
      );
    }
    const containsDuplicateLocators = snapshot.documents.some((document) => {
      const locators = document.passages.map(({ locator }) => locator);
      return new Set(locators).size !== locators.length;
    });
    if (containsDuplicateLocators) {
      return Effect.fail(
        new RepositoryError({
          message: "Knowledge source passages require unique locators within each version.",
          operation: "knowledge-reconcile",
        }),
      );
    }
    if (configuration.entityCatalog !== undefined) {
      try {
        validateDeliveryEntityCatalog(configuration.entityCatalog);
      } catch {
        return Effect.fail(
          new RepositoryError({
            message: "Delivery entity catalog is invalid.",
            operation: "knowledge-reconcile.entity-catalog",
          }),
        );
      }
    }
    return Effect.tryPromise({
      try: () => reusableProjectionVersions(database, snapshot, embeddings),
      catch: (failure) =>
        new RepositoryError({
          message: "Knowledge reconciliation could not inspect existing projections.",
          operation: classifyKnowledgeReconcileFailure(failure),
        }),
    }).pipe(
      Effect.flatMap((reusableVersions) => {
        const versionsToEmbed = snapshot.documents.filter(
          (document) => !reusableVersions.has(versionId(document)),
        );
        return Effect.tryPromise({
          try: () =>
            reusableProjectionVectors(
              database,
              { ...snapshot, documents: versionsToEmbed },
              embeddings,
            ),
          catch: (failure) =>
            new RepositoryError({
              message: "Knowledge reconciliation could not reuse existing passage projections.",
              operation: classifyKnowledgeReconcileFailure(failure),
            }),
        }).pipe(
          Effect.flatMap((reusableVectors) => {
            const missingPassages = new Map<string, string>();
            for (const document of versionsToEmbed)
              for (const passage of document.passages)
                if (!reusableVectors.has(passage.contentHash))
                  missingPassages.set(passage.contentHash, passage.body);
            const embeddedAndCached =
              missingPassages.size === 0
                ? Effect.succeed(new Map<string, readonly number[]>())
                : Effect.tryPromise({
                    try: () =>
                      embedAndCacheProjectionVectors(
                        database,
                        snapshot,
                        embeddings,
                        missingPassages,
                      ),
                    catch: (failure) =>
                      failure instanceof RepositoryError
                        ? failure
                        : new RepositoryError({
                            message: "Knowledge embedding progress could not be cached.",
                            operation: classifyKnowledgeReconcileFailure(failure),
                          }),
                  });
            return embeddedAndCached.pipe(
              Effect.flatMap((cachedVectors) => {
                const vectorsByContentHash = new Map(reusableVectors);
                for (const [contentHash, vector] of cachedVectors)
                  vectorsByContentHash.set(contentHash, vector);
                const vectorsByVersion = new Map<string, readonly (readonly number[])[]>();
                for (const document of versionsToEmbed) {
                  const passageVectors = document.passages.map((passage) =>
                    vectorsByContentHash.get(passage.contentHash),
                  );
                  if (passageVectors.some((vector) => vector === undefined))
                    return Effect.fail(
                      new RepositoryError({
                        message: "Embedding result count did not match changed passages.",
                        operation: "knowledge-reconcile",
                      }),
                    );
                  vectorsByVersion.set(
                    versionId(document),
                    passageVectors as readonly (readonly number[])[],
                  );
                }
                return Effect.tryPromise({
                  try: () =>
                    reconcileSnapshot(
                      database,
                      snapshot,
                      embeddings,
                      vectorsByVersion,
                      trigger,
                      configuration.entityCatalog,
                    ),
                  catch: (failure) =>
                    new RepositoryError({
                      message:
                        "Knowledge reconciliation failed; the previous checkpoint remains authoritative.",
                      operation: classifyKnowledgeReconcileFailure(failure),
                    }),
                });
              }),
            );
          }),
        );
      }),
    );
  },
  search: (query, queryEmbedding, control) =>
    Effect.tryPromise({
      try: async () => {
        if (queryEmbedding.length !== 1536)
          throw new Error("Query embedding dimensions do not match the active projection schema.");
        const limit = Math.max(1, Math.min(query.topK, 50));
        const candidateLimit = Math.min(1_000, limit * 20);
        const vectorDistance = cosineDistance(sql`projection.embedding`, [...queryEmbedding]);
        const authorized = authorizedPassages(
          query.audience.workspaceId,
          query.audience.maximumSensitivity,
          query.audience.audienceIds,
          query.audience.actorId,
          query.sources,
          sql`select id from candidates`,
        );
        const [lexical, vectorResult] = await Promise.all([
          readLexicalSearchLists(
            database,
            query,
            limit,
            control?.execution ?? configuration.execution,
            control?.signal,
          ),
          executePostgresKnowledgeSearch<SearchRow>(
            database,
            sql`
            with candidates as materialized (
              select projection.passage_id as id, ${vectorDistance} as distance
              from ${knowledgeProjectionTable} projection
              where projection.workspace_id = ${query.audience.workspaceId}
              order by ${vectorDistance}
              limit ${candidateLimit}
            ), authorized as materialized (${authorized})
            select authorized.*, content.body from authorized
            join candidates on candidates.id = authorized.id
            join ${knowledgePassageTable} content on content.id = authorized.id
            order by candidates.distance
            limit ${limit}`,
            "knowledge.vector",
            control?.execution ?? configuration.execution,
            control?.signal,
          ),
        ]);
        return fuseSearchRows(
          {
            ...lexical,
            vector: valuesFromResult(vectorResult),
          },
          limit,
          query.expandParents === true,
        );
      },
      catch: () =>
        new RepositoryError({
          message: "Authorized hybrid knowledge retrieval failed.",
          operation: "knowledge-query",
        }),
    }),
  searchLexical: (query, control) =>
    Effect.tryPromise({
      try: async () => {
        const limit = Math.max(1, Math.min(query.topK, 50));
        return fuseSearchRows(
          await readLexicalSearchLists(
            database,
            query,
            limit,
            control?.execution ?? configuration.execution,
            control?.signal,
          ),
          limit,
          query.expandParents === true,
        );
      },
      catch: () =>
        new RepositoryError({
          message: "Authorized lexical knowledge retrieval failed.",
          operation: "knowledge-query-lexical",
        }),
    }),
});
