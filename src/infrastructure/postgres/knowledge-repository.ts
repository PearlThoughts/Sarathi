import { and, cosineDistance, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  assertNonFinancialAttributes,
  type DeliveryObjectRef,
  deliveryClaimValueHash,
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
} from "../../modules/knowledge-layer/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  deliveryAclBindingTable,
  deliveryClaimTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
  knowledgeAclBindingTable,
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
};

const postgresBindBatchSize = 1_000;

export const boundedPostgresBindBatches = <Value>(
  values: readonly Value[],
): readonly (readonly Value[])[] => {
  const batches: Value[][] = [];
  for (let offset = 0; offset < values.length; offset += postgresBindBatchSize)
    batches.push(values.slice(offset, offset + postgresBindBatchSize));
  return batches;
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
    database
      .select({ id: knowledgeVersionTable.id })
      .from(knowledgeVersionTable)
      .where(inArray(knowledgeVersionTable.id, versionIds)),
    database
      .select({ versionId: knowledgePassageTable.versionId })
      .from(knowledgePassageTable)
      .innerJoin(
        knowledgeProjectionTable,
        eq(knowledgeProjectionTable.passageId, knowledgePassageTable.id),
      )
      .where(
        and(
          inArray(knowledgePassageTable.versionId, versionIds),
          eq(knowledgeProjectionTable.embeddingModel, embeddings.model),
          eq(knowledgeProjectionTable.embeddingDimensions, embeddings.dimensions),
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
  const projections = await database
    .select({
      contentHash: knowledgeProjectionTable.contentHash,
      embedding: knowledgeProjectionTable.embedding,
    })
    .from(knowledgeProjectionTable)
    .where(
      and(
        inArray(knowledgeProjectionTable.contentHash, contentHashes),
        eq(knowledgeProjectionTable.embeddingModel, embeddings.model),
        eq(knowledgeProjectionTable.embeddingDimensions, embeddings.dimensions),
      ),
    );
  const vectors = new Map<string, readonly number[]>();
  for (const projection of projections) {
    if (
      !vectors.has(projection.contentHash) &&
      projection.embedding.length === embeddings.dimensions
    )
      vectors.set(projection.contentHash, projection.embedding);
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

const authorizedPassages = (
  workspaceId: string,
  maximumSensitivity: SensitivityTier,
  audienceIds: readonly string[],
  actorId: string | undefined,
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
): Promise<Readonly<Record<"exact" | "keyword", readonly SearchRow[]>>> => {
  const externalId = /\b[a-z][a-z0-9]+-\d+\b/i.exec(query.question)?.[0];
  const candidateLimit = Math.min(1_000, limit * 20);
  const authorizedCandidates = () =>
    authorizedPassages(
      query.audience.workspaceId,
      query.audience.maximumSensitivity,
      query.audience.audienceIds,
      query.audience.actorId,
      sql`select id from candidates`,
    );
  const [exactResult, keywordResult] = await Promise.all([
    externalId === undefined
      ? Promise.resolve({ rows: [] })
      : database.execute(sql`
          with candidates as materialized (
            select passage.id
            from ${knowledgeItemTable} item
            join ${knowledgePassageTable} passage on passage.item_id = item.id
            where item.workspace_id = ${query.audience.workspaceId}
              and passage.workspace_id = ${query.audience.workspaceId}
              and passage.active = true
              and upper(item.external_id) = upper(${externalId})
            order by passage.ordinal
            limit ${candidateLimit}
          ), authorized as materialized (${authorizedCandidates()})
          select authorized.*, content.body from authorized
          join ${knowledgePassageTable} content on content.id = authorized.id
          order by content.ordinal
          limit ${limit}`),
    database.execute(sql`
      with query as (
        select websearch_to_tsquery('english', ${query.question}) as value
      ), candidates as materialized (
        select passage.id,
               ts_rank_cd(to_tsvector('english', passage.title || ' ' || passage.body), query.value) as rank
        from ${knowledgePassageTable} passage
        cross join query
        where passage.workspace_id = ${query.audience.workspaceId}
          and passage.active = true
          and to_tsvector('english', passage.title || ' ' || passage.body) @@ query.value
        order by rank desc, passage.source_updated_at desc
        limit ${candidateLimit}
      ), authorized as materialized (${authorizedCandidates()})
      select authorized.*, content.body from authorized
      join ${knowledgePassageTable} content on content.id = authorized.id
      join candidates on candidates.id = authorized.id
      order by candidates.rank desc, authorized.source_updated_at desc
      limit ${limit}`),
  ]);
  return {
    exact: valuesFromResult(exactResult),
    keyword: valuesFromResult(keywordResult),
  };
};

const fuseSearchRows = (
  lists: Readonly<Record<string, readonly SearchRow[]>>,
  limit: number,
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
              excerpt: row.body.replace(/\s+/g, " ").trim().slice(0, 1200),
              citationUrl: row.canonical_url,
              sourceUpdatedAt: new Date(row.source_updated_at).toISOString(),
              sensitivity: row.sensitivity,
              authority: Number(row.authority),
              freshness: freshness(row.source_updated_at),
              componentRanks: candidate.componentRanks,
              score: candidate.fusedScore,
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
  deliveryDeactivateRelations: "knowledge-reconcile.delivery-deactivate-relations-stage",
  deliveryDeactivateObservations: "knowledge-reconcile.delivery-deactivate-observations-stage",
  deliveryDeactivateMetrics: "knowledge-reconcile.delivery-deactivate-metrics-stage",
  deliveryDeactivateFinanceMetrics: "knowledge-reconcile.delivery-deactivate-finance-metrics-stage",
  deliveryDeactivateClaims: "knowledge-reconcile.delivery-deactivate-claims-stage",
  deliveryDeactivateAcl: "knowledge-reconcile.delivery-deactivate-acl-stage",
  deliveryObjects: "knowledge-reconcile.delivery-objects-stage",
  deliveryRelations: "knowledge-reconcile.delivery-relations-stage",
  deliveryObservations: "knowledge-reconcile.delivery-observations-stage",
  deliveryMetrics: "knowledge-reconcile.delivery-metrics-stage",
  deliveryClaims: "knowledge-reconcile.delivery-claims-stage",
  checkpoint: "knowledge-reconcile.checkpoint-stage",
} as const;

type ReconcileStage = keyof typeof reconcileStageFailureOperations;

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
    typeof deliveryObjectTable.$inferInsert & { readonly rules: readonly KnowledgeAclRule[] }
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
      objectRows.set(id, {
        id,
        workspaceId: projected.document.workspaceId,
        objectKind: object.kind,
        externalKey: object.externalKey,
        title: object.title,
        lifecycleState: object.lifecycleState ?? null,
        attributes: object.attributes,
        sensitivity: object.sensitivity,
        sourceKind: projected.document.source,
        sourceId: projected.document.sourceId,
        sourceItemId: projected.documentItemId,
        sourceVersionId: projected.versionId,
        effectiveFrom: object.effectiveFrom ?? null,
        effectiveTo: object.effectiveTo ?? null,
        observedAt: now,
        active: true,
        deletedAt: null,
        rules: projected.document.acl,
      });
    }
  }
  for (const { rules, ...row } of objectRows.values()) {
    await database
      .insert(deliveryObjectTable)
      .values(row)
      .onConflictDoUpdate({
        target: deliveryObjectTable.id,
        set: {
          title: row.title,
          lifecycleState: row.lifecycleState,
          attributes: row.attributes,
          sensitivity: row.sensitivity,
          sourceItemId: row.sourceItemId,
          sourceVersionId: row.sourceVersionId,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          observedAt: now,
          active: true,
          deletedAt: null,
        },
      });
    await database
      .insert(deliveryAclBindingTable)
      .values(deliveryTargetAclRows("object", row.id, row.workspaceId, rules, now))
      .onConflictDoNothing();
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
          observedAt: now,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: deliveryRelationTable.id,
          set: {
            attributes: relation.attributes,
            effectiveFrom: relation.effectiveFrom ?? null,
            effectiveTo: relation.effectiveTo ?? null,
            observedAt: now,
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
          observedAt: now,
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
            observedAt: now,
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
          observedAt: now,
          active: true,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: targetTable.id,
          set: { value: metric.value, observedAt: now, active: true, deletedAt: null },
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
      const valueHash = deliveryClaimValueHash(claim.value);
      const id = `delivery-claim:${stableSha256(`${projected.versionId}:${claim.subjectKey}:${claim.predicate}:${valueHash}:${index}`)}`;
      await database
        .insert(deliveryClaimTable)
        .values({
          id,
          workspaceId: projected.document.workspaceId,
          subjectObjectId,
          subjectKey: claim.subjectKey,
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
          observedAt: now,
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
            observedAt: now,
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
      await syncDeliveryProjection(transaction, projectedDocuments, now, (nextStage) => {
        stage = nextStage;
      });

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
        lastEventAt: snapshot.mode === "delta" ? now : (previousCheckpoint?.lastEventAt ?? null),
        lastReconciledAt:
          snapshot.mode === "delta" ? (previousCheckpoint?.lastReconciledAt ?? null) : now,
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
      return summary;
    });
  } catch (cause) {
    throw new KnowledgeReconcileStageError(stage, cause);
  }
};

export const createPostgresKnowledgeRepository = (
  database: KnowledgePostgresDatabase,
): KnowledgeRepository => ({
  reconcile: (snapshot, embeddings) => {
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
            const passageBodies = [...missingPassages.values()];
            const embedded =
              passageBodies.length === 0
                ? Effect.succeed([] as readonly number[][])
                : embeddings.embed(passageBodies);
            return embedded.pipe(
              Effect.flatMap((vectors) => {
                const vectorsByContentHash = new Map(reusableVectors);
                for (const [index, contentHash] of [...missingPassages.keys()].entries()) {
                  const vector = vectors[index];
                  if (vector !== undefined) vectorsByContentHash.set(contentHash, vector);
                }
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
                  try: () => reconcileSnapshot(database, snapshot, embeddings, vectorsByVersion),
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
  search: (query, queryEmbedding) =>
    Effect.tryPromise({
      try: async () => {
        if (queryEmbedding.length !== 1536)
          throw new Error("Query embedding dimensions do not match the active projection schema.");
        const authorized = authorizedPassages(
          query.audience.workspaceId,
          query.audience.maximumSensitivity,
          query.audience.audienceIds,
          query.audience.actorId,
        );
        const limit = Math.max(1, Math.min(query.topK, 50));
        const [lexical, vectorResult] = await Promise.all([
          readLexicalSearchLists(database, query, limit),
          database.execute(sql`
            with authorized as materialized (${authorized})
            select authorized.*, content.body from authorized
            join ${knowledgeProjectionTable} projection on projection.passage_id = authorized.id
            join ${knowledgePassageTable} content on content.id = authorized.id
            order by ${cosineDistance(sql`projection.embedding`, [...queryEmbedding])}
            limit ${limit}`),
        ]);
        return fuseSearchRows(
          {
            ...lexical,
            vector: valuesFromResult(vectorResult),
          },
          limit,
        );
      },
      catch: () =>
        new RepositoryError({
          message: "Authorized hybrid knowledge retrieval failed.",
          operation: "knowledge-query",
        }),
    }),
  searchLexical: (query) =>
    Effect.tryPromise({
      try: async () => {
        const limit = Math.max(1, Math.min(query.topK, 50));
        return fuseSearchRows(await readLexicalSearchLists(database, query, limit), limit);
      },
      catch: () =>
        new RepositoryError({
          message: "Authorized lexical knowledge retrieval failed.",
          operation: "knowledge-query-lexical",
        }),
    }),
});
