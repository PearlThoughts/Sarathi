import { type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type ProductEntityId,
  type ProductEntityKind,
  type ProductExternalReferenceKind,
  type ProductHierarchyNode,
  type ProductHierarchyTraversal,
  type ProductLifecycle,
  ProductModelError,
  type ProductModelGraphRepository,
  type ProductModelReadPoint,
  type ProductRegistration,
  type ProductRelation,
  type ProductRelationEndpoint,
  type ProductRelationType,
} from "../../modules/product-model/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";

const maximumTraversalDepth = 8;
const maximumTraversalNodes = 500;

const sensitivityRank: Record<SensitivityTier, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

type ProductHierarchyRow = {
  readonly entityId: string;
  readonly parentId: string | null;
  readonly kind: ProductEntityKind;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly registration: ProductRegistration;
  readonly lifecycle: ProductLifecycle;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly revision: number;
  readonly depth: number;
};

type ProductRevisionRow = { readonly revision: number | null };

type ProductRelationRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly relationType: ProductRelationType;
  readonly sourceKind: "entity" | "external";
  readonly sourceEntityId: string | null;
  readonly sourceReferenceKind: ProductExternalReferenceKind;
  readonly sourceReferenceId: string | null;
  readonly targetKind: "entity" | "external";
  readonly targetEntityId: string | null;
  readonly targetReferenceKind: ProductExternalReferenceKind;
  readonly targetReferenceId: string | null;
  readonly registration: ProductRegistration;
  readonly sourceClass: string;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly createdRevision: number;
};

const invalid = (message: string, reference?: string) =>
  Effect.fail(new ProductModelError("invalid_input", message, reference));

const validateReadPoint = (point: ProductModelReadPoint) => {
  if (point.kind === "revision" && (!Number.isSafeInteger(point.revision) || point.revision < 1))
    return invalid("Historical revision must be a positive integer.");
  if (point.kind !== "revision" && !Number.isFinite(Date.parse(point.at)))
    return invalid("A valid product-model query instant is required.", point.at);
  return Effect.void;
};

const sqlTextArray = (values: readonly string[]) =>
  values.length === 0
    ? sql`array[]::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;

const sqlUuidArray = (values: readonly ProductEntityId[]) =>
  values.length === 0
    ? sql`array[]::uuid[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}::uuid`),
        sql`, `,
      )}]::uuid[]`;

const validate = (request: ProductHierarchyTraversal) => {
  if (request.workspaceId.trim() === "")
    return invalid("A workspace is required for product hierarchy traversal.");
  if (
    !Number.isSafeInteger(request.maximumDepth) ||
    request.maximumDepth < 0 ||
    request.maximumDepth > maximumTraversalDepth
  )
    return invalid(
      `Hierarchy depth must be between 0 and ${maximumTraversalDepth}.`,
      String(request.maximumDepth),
    );
  if (
    !Number.isSafeInteger(request.maximumNodes) ||
    request.maximumNodes < 1 ||
    request.maximumNodes > maximumTraversalNodes
  )
    return invalid(
      `Hierarchy node limit must be between 1 and ${maximumTraversalNodes}.`,
      String(request.maximumNodes),
    );
  if (request.direction === "ancestors" && request.rootEntityId === undefined)
    return invalid("Ancestor traversal requires a root entity ID.");
  return validateReadPoint(request.point);
};

export const buildProductModelRevisionQuery = (
  workspaceId: string,
  point: ProductModelReadPoint,
): SQL<ProductRevisionRow> => {
  const pointAt = point.kind === "revision" ? null : point.at;
  const pointRevision = point.kind === "revision" ? point.revision : null;
  return sql<ProductRevisionRow>`
    select max(revision)::integer as revision
    from product_revision
    where workspace_id = ${workspaceId}
      and (
        (${point.kind} = 'revision' and revision = ${pointRevision})
        or (${point.kind} = 'current' and recorded_at <= ${pointAt}::timestamptz)
        or (${point.kind} = 'valid_time' and valid_from <= ${pointAt}::timestamptz)
      )
  `;
};

export const buildProductHierarchyTraversalQuery = (
  request: ProductHierarchyTraversal,
): SQL<ProductHierarchyRow> => {
  const pointKind = request.point.kind;
  const pointAt = request.point.kind === "revision" ? null : request.point.at;
  const pointRevision = request.point.kind === "revision" ? request.point.revision : null;
  const rootEntityId = request.rootEntityId ?? null;
  const audienceIds = [...request.visibility.audienceIds];
  const audienceArray = sqlTextArray(audienceIds);
  const maximumSensitivity = sensitivityRank[request.visibility.maximumSensitivity];

  return sql<ProductHierarchyRow>`
    with recursive selected_revision as (
      select recorded_at
      from product_revision
      where workspace_id = ${request.workspaceId}
        and revision = ${pointRevision}
    ),
    visible_state as (
      select distinct on (state.entity_id)
        state.entity_id,
        entity.kind,
        state.canonical_name,
        state.description,
        state.registration,
        state.lifecycle,
        state.sensitivity,
        state.audience,
        state.revision
      from product_entity_state state
      inner join product_entity entity
        on entity.workspace_id = state.workspace_id
       and entity.id = state.entity_id
      left join selected_revision selected on true
      where state.workspace_id = ${request.workspaceId}
        and (
          (${pointKind} = 'current'
            and state.superseded_at is null
            and state.recorded_at <= ${pointAt}::timestamptz
            and state.valid_from <= ${pointAt}::timestamptz
            and (state.valid_to is null or state.valid_to > ${pointAt}::timestamptz))
          or (${pointKind} = 'valid_time'
            and state.valid_from <= ${pointAt}::timestamptz
            and (state.valid_to is null or state.valid_to > ${pointAt}::timestamptz))
          or (${pointKind} = 'revision'
            and selected.recorded_at is not null
            and state.recorded_at <= selected.recorded_at
            and (state.superseded_at is null or state.superseded_at > selected.recorded_at))
        )
        and case state.sensitivity
          when 'public' then 0
          when 'internal' then 1
          when 'confidential' then 2
          when 'restricted' then 3
          else 4
        end <= ${maximumSensitivity}
        and (state.audience = '[]'::jsonb or state.audience ?| ${audienceArray})
      order by state.entity_id, state.revision desc
    ),
    temporal_edges as (
      select distinct on (edge.child_id)
        edge.child_id,
        edge.parent_id
      from product_hierarchy_edge edge
      left join selected_revision selected on true
      where edge.workspace_id = ${request.workspaceId}
        and (
          (${pointKind} = 'current'
            and edge.superseded_at is null
            and edge.recorded_at <= ${pointAt}::timestamptz
            and edge.valid_from <= ${pointAt}::timestamptz
            and (edge.valid_to is null or edge.valid_to > ${pointAt}::timestamptz))
          or (${pointKind} = 'valid_time'
            and edge.valid_from <= ${pointAt}::timestamptz
            and (edge.valid_to is null or edge.valid_to > ${pointAt}::timestamptz))
          or (${pointKind} = 'revision'
            and selected.recorded_at is not null
            and edge.recorded_at <= selected.recorded_at
            and (edge.superseded_at is null or edge.superseded_at > selected.recorded_at))
        )
      order by edge.child_id, edge.created_revision desc
    ),
    visible_edges as (
      select edge.child_id, edge.parent_id
      from temporal_edges edge
      inner join visible_state child on child.entity_id = edge.child_id
      inner join visible_state parent on parent.entity_id = edge.parent_id
    ),
    hierarchy_walk as (
      select
        state.entity_id,
        state.kind,
        state.canonical_name,
        state.description,
        state.registration,
        state.lifecycle,
        state.sensitivity,
        state.audience,
        state.revision,
        0 as depth,
        array[state.entity_id] as path
      from visible_state state
      left join visible_edges parent_edge on parent_edge.child_id = state.entity_id
      where (${rootEntityId}::uuid is not null and state.entity_id = ${rootEntityId}::uuid)
         or (${rootEntityId}::uuid is null and parent_edge.parent_id is null)

      union all

      select
        next_state.entity_id,
        next_state.kind,
        next_state.canonical_name,
        next_state.description,
        next_state.registration,
        next_state.lifecycle,
        next_state.sensitivity,
        next_state.audience,
        next_state.revision,
        walk.depth + 1,
        walk.path || next_state.entity_id
      from hierarchy_walk walk
      inner join visible_edges edge
        on (${request.direction} = 'descendants' and edge.parent_id = walk.entity_id)
        or (${request.direction} = 'ancestors' and edge.child_id = walk.entity_id)
      inner join visible_state next_state
        on next_state.entity_id = case
          when ${request.direction} = 'descendants' then edge.child_id
          else edge.parent_id
        end
      where walk.depth < ${request.maximumDepth}
        and not next_state.entity_id = any(walk.path)
    )
    select
      walk.entity_id as "entityId",
      parent_edge.parent_id as "parentId",
      walk.kind,
      walk.canonical_name as "canonicalName",
      walk.description,
      walk.registration,
      walk.lifecycle,
      walk.sensitivity,
      walk.audience,
      walk.revision,
      walk.depth
    from hierarchy_walk walk
    left join visible_edges parent_edge on parent_edge.child_id = walk.entity_id
    order by walk.depth, walk.path
    limit ${request.maximumNodes + 1}
  `;
};

export const buildProductRelationReadQuery = (
  request: Parameters<ProductModelGraphRepository["readRelations"]>[0],
): SQL<ProductRelationRow> => {
  const pointAt = request.point.kind === "revision" ? null : request.point.at;
  const pointRevision = request.point.kind === "revision" ? request.point.revision : null;
  const entityIds = sqlUuidArray(request.entityIds);
  const audience = sqlTextArray(request.visibility.audienceIds);
  const maximumSensitivity = sensitivityRank[request.visibility.maximumSensitivity];
  return sql<ProductRelationRow>`
    with selected_revision as (
      select recorded_at
      from product_revision
      where workspace_id = ${request.workspaceId}
        and revision = ${pointRevision}
    )
    select distinct on (relation.id)
      relation.id,
      relation.workspace_id as "workspaceId",
      relation.relation_type as "relationType",
      relation.source_kind as "sourceKind",
      relation.source_entity_id as "sourceEntityId",
      relation.source_reference_kind as "sourceReferenceKind",
      relation.source_reference_id as "sourceReferenceId",
      relation.target_kind as "targetKind",
      relation.target_entity_id as "targetEntityId",
      relation.target_reference_kind as "targetReferenceKind",
      relation.target_reference_id as "targetReferenceId",
      relation.registration,
      relation.source_class as "sourceClass",
      relation.sensitivity,
      relation.audience,
      relation.valid_from as "validFrom",
      relation.valid_to as "validTo",
      relation.created_revision as "createdRevision"
    from product_relation relation
    left join selected_revision selected on true
    where relation.workspace_id = ${request.workspaceId}
      and (
        (${request.point.kind} = 'current'
          and relation.superseded_at is null
          and relation.recorded_at <= ${pointAt}::timestamptz
          and relation.valid_from <= ${pointAt}::timestamptz
          and (relation.valid_to is null or relation.valid_to > ${pointAt}::timestamptz))
        or (${request.point.kind} = 'valid_time'
          and relation.valid_from <= ${pointAt}::timestamptz
          and (relation.valid_to is null or relation.valid_to > ${pointAt}::timestamptz))
        or (${request.point.kind} = 'revision'
          and selected.recorded_at is not null
          and relation.recorded_at <= selected.recorded_at
          and (relation.superseded_at is null or relation.superseded_at > selected.recorded_at))
      )
      and case relation.sensitivity
        when 'public' then 0
        when 'internal' then 1
        when 'confidential' then 2
        when 'restricted' then 3
        else 4
      end <= ${maximumSensitivity}
      and (relation.audience = '[]'::jsonb or relation.audience ?| ${audience})
      and (
        (relation.source_kind = 'entity' and relation.target_kind = 'entity'
          and relation.source_entity_id = any(${entityIds})
          and relation.target_entity_id = any(${entityIds}))
        or (relation.source_kind = 'entity' and relation.target_kind = 'external'
          and relation.source_entity_id = any(${entityIds}))
        or (relation.source_kind = 'external' and relation.target_kind = 'entity'
          and relation.target_entity_id = any(${entityIds}))
      )
    order by relation.id, relation.created_revision desc
    limit ${request.maximumRelations + 1}
  `;
};

const endpoint = (
  kind: ProductRelationRow["sourceKind"],
  entityId: string | null,
  referenceKind: ProductRelationRow["sourceReferenceKind"],
  referenceId: string | null,
): ProductRelationEndpoint =>
  kind === "entity"
    ? { kind, entityId: entityId as ProductEntityId }
    : { kind, referenceKind, referenceId: referenceId ?? "" };

const toRelation = (row: ProductRelationRow): ProductRelation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  type: row.relationType,
  source: endpoint(
    row.sourceKind,
    row.sourceEntityId,
    row.sourceReferenceKind,
    row.sourceReferenceId,
  ),
  target: endpoint(
    row.targetKind,
    row.targetEntityId,
    row.targetReferenceKind,
    row.targetReferenceId,
  ),
  registration: row.registration,
  sourceClass: row.sourceClass,
  sensitivity: row.sensitivity,
  audience: row.audience,
  validFrom: row.validFrom,
  ...(row.validTo === null ? {} : { validTo: row.validTo }),
  createdRevision: row.createdRevision,
});

const toNode = (row: ProductHierarchyRow): ProductHierarchyNode => ({
  entityId: row.entityId as ProductEntityId,
  ...(row.parentId === null ? {} : { parentId: row.parentId as ProductEntityId }),
  kind: row.kind,
  canonicalName: row.canonicalName,
  ...(row.description === null ? {} : { description: row.description }),
  registration: row.registration,
  lifecycle: row.lifecycle,
  sensitivity: row.sensitivity,
  audience: row.audience,
  revision: row.revision,
  depth: row.depth,
});

export const createPostgresProductModelGraphRepository = (
  database: KnowledgePostgresDatabase,
): ProductModelGraphRepository => ({
  resolveRevision: ({ workspaceId, point }) =>
    Effect.gen(function* () {
      if (workspaceId.trim() === "")
        return yield* invalid("A workspace is required for product revision resolution.");
      yield* validateReadPoint(point);
      const result = yield* Effect.tryPromise({
        try: () => database.execute(buildProductModelRevisionQuery(workspaceId, point)),
        catch: () =>
          new RepositoryError({
            message: "Product revision resolution failed.",
            operation: "product-model-resolve-revision",
          }),
      });
      const row = result.rows[0] as ProductRevisionRow | undefined;
      return row?.revision ?? undefined;
    }),
  readRelations: (request) =>
    Effect.gen(function* () {
      if (request.workspaceId.trim() === "")
        return yield* invalid("A workspace is required for product relation reads.");
      yield* validateReadPoint(request.point);
      if (
        !Number.isSafeInteger(request.maximumRelations) ||
        request.maximumRelations < 1 ||
        request.maximumRelations > maximumTraversalNodes
      )
        return yield* invalid(
          `Relation limit must be between 1 and ${maximumTraversalNodes}.`,
          String(request.maximumRelations),
        );
      if (request.entityIds.length === 0) return { relations: [], truncated: false };
      const result = yield* Effect.tryPromise({
        try: () => database.execute(buildProductRelationReadQuery(request)),
        catch: () =>
          new RepositoryError({
            message: "Product relation read failed.",
            operation: "product-model-read-relations",
          }),
      });
      const rows = result.rows as unknown as readonly ProductRelationRow[];
      return {
        relations: rows.slice(0, request.maximumRelations).map(toRelation),
        truncated: rows.length > request.maximumRelations,
      };
    }),
  traverseHierarchy: (request) =>
    Effect.gen(function* () {
      yield* validate(request);
      const query = buildProductHierarchyTraversalQuery(request);
      const result = yield* Effect.tryPromise({
        try: () => database.execute(query),
        catch: () =>
          new RepositoryError({
            message: "Product hierarchy traversal failed.",
            operation: "product-model-traverse-hierarchy",
          }),
      });
      const rows = result.rows as unknown as readonly ProductHierarchyRow[];
      return {
        nodes: rows.slice(0, request.maximumNodes).map(toNode),
        truncated: rows.length > request.maximumNodes,
      };
    }),
});
