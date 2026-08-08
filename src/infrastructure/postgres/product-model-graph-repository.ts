import { type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type ProductEntityId,
  type ProductEntityKind,
  type ProductHierarchyNode,
  type ProductHierarchyTraversal,
  type ProductLifecycle,
  ProductModelError,
  type ProductModelGraphRepository,
  type ProductRegistration,
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

const invalid = (message: string, reference?: string) =>
  Effect.fail(new ProductModelError("invalid_input", message, reference));

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
  if (
    request.point.kind === "revision" &&
    (!Number.isSafeInteger(request.point.revision) || request.point.revision < 1)
  )
    return invalid("Historical revision must be a positive integer.");
  if (request.point.kind !== "revision" && !Number.isFinite(Date.parse(request.point.at)))
    return invalid("A valid product-model query instant is required.", request.point.at);
  return Effect.void;
};

export const buildProductHierarchyTraversalQuery = (
  request: ProductHierarchyTraversal,
): SQL<ProductHierarchyRow> => {
  const pointKind = request.point.kind;
  const pointAt = request.point.kind === "revision" ? null : request.point.at;
  const pointRevision = request.point.kind === "revision" ? request.point.revision : null;
  const rootEntityId = request.rootEntityId ?? null;
  const audienceIds = [...request.visibility.audienceIds];
  const audienceArray =
    audienceIds.length === 0
      ? sql`array[]::text[]`
      : sql`array[${sql.join(
          audienceIds.map((audienceId) => sql`${audienceId}`),
          sql`, `,
        )}]::text[]`;
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
