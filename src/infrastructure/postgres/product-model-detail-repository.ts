import { type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type ProductCoverageFlag,
  type ProductCoverageItem,
  type ProductCoverageReadRequest,
  type ProductDetailReadRequest,
  type ProductDossierSnapshot,
  type ProductEntityHistoryEvent,
  type ProductEntityHistoryReadRequest,
  type ProductEntityId,
  type ProductModelDetailRepository,
  ProductModelError,
} from "../../modules/product-model/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";

const maximumCoverageItems = 500;
const sensitivityRank: Record<SensitivityTier, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

type ProductDossierRow = {
  readonly entity: ProductDossierSnapshot["entity"];
  readonly aliases: ProductDossierSnapshot["aliases"];
  readonly variants: ProductDossierSnapshot["variants"];
  readonly claims: ProductDossierSnapshot["claims"];
  readonly externalReferences: ProductDossierSnapshot["externalReferences"];
  readonly proposals: ProductDossierSnapshot["proposals"];
};

type ProductCoverageRow = Omit<ProductCoverageItem, "entityId" | "flags"> & {
  readonly entityId: string;
  readonly flags: readonly ProductCoverageFlag[];
};

type ProductEntityHistoryRow = ProductEntityHistoryEvent;

const invalid = (message: string, reference?: string) =>
  Effect.fail(new ProductModelError("invalid_input", message, reference));

const sqlTextArray = (values: readonly string[]) =>
  values.length === 0
    ? sql`array[]::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;

const visibility = (
  alias: SQL,
  audienceIds: readonly string[],
  maximumSensitivity: SensitivityTier,
) => sql`
  case ${alias}.sensitivity
    when 'public' then 0
    when 'internal' then 1
    when 'confidential' then 2
    when 'restricted' then 3
    else 4
  end <= ${sensitivityRank[maximumSensitivity]}
  and (${alias}.audience = '[]'::jsonb or ${alias}.audience ?| ${sqlTextArray(audienceIds)})
`;

export const buildProductDossierQuery = (
  request: ProductDetailReadRequest,
): SQL<ProductDossierRow> => {
  const stateVisibility = visibility(
    sql.raw("state"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const aliasVisibility = visibility(
    sql.raw("alias"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const variantVisibility = visibility(
    sql.raw("variant"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const claimVisibility = visibility(
    sql.raw("claim"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const referenceVisibility = visibility(
    sql.raw("reference"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const proposalVisibility = visibility(
    sql.raw("proposal"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  return sql<ProductDossierRow>`
    select
      jsonb_strip_nulls(jsonb_build_object(
        'id', entity.id,
        'workspaceId', entity.workspace_id,
        'kind', entity.kind,
        'canonicalName', state.canonical_name,
        'description', state.description,
        'registration', state.registration,
        'lifecycle', state.lifecycle,
        'sensitivity', state.sensitivity,
        'audience', state.audience,
        'createdRevision', entity.created_revision,
        'updatedRevision', state.revision
      )) as entity,
      coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', alias.id,
          'entityId', alias.entity_id,
          'value', alias.value,
          'normalizedValue', alias.normalized_value,
          'kind', alias.kind,
          'sourceClass', alias.source_class,
          'createdRevision', alias.created_revision
        )) order by alias.kind, alias.normalized_value, alias.id)
        from product_entity_alias alias
        where alias.workspace_id = ${request.workspaceId}
          and alias.entity_id = ${request.entityId}::uuid
          and alias.superseded_at is null
          and alias.recorded_at <= ${request.at}::timestamptz
          and alias.valid_from <= ${request.at}::timestamptz
          and (alias.valid_to is null or alias.valid_to > ${request.at}::timestamptz)
          and ${aliasVisibility}
      ), '[]'::jsonb) as aliases,
      coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', variant.id,
          'workspaceId', variant.workspace_id,
          'baseEntityId', variant.base_entity_id,
          'qualifiers', variant.qualifiers,
          'delta', variant.delta,
          'precedence', variant.precedence,
          'registration', variant.registration,
          'sourceClass', variant.source_class,
          'sensitivity', variant.sensitivity,
          'audience', variant.audience,
          'validFrom', variant.valid_from,
          'validTo', variant.valid_to,
          'createdRevision', variant.created_revision
        )) order by variant.precedence desc, variant.id)
        from product_variant variant
        where variant.workspace_id = ${request.workspaceId}
          and variant.base_entity_id = ${request.entityId}::uuid
          and variant.superseded_at is null
          and variant.recorded_at <= ${request.at}::timestamptz
          and variant.valid_from <= ${request.at}::timestamptz
          and (variant.valid_to is null or variant.valid_to > ${request.at}::timestamptz)
          and ${variantVisibility}
      ), '[]'::jsonb) as variants,
      coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', claim.id,
          'entityId', claim.entity_id,
          'type', claim.claim_type,
          'predicate', claim.predicate,
          'value', claim.value,
          'evidenceReferenceCount', jsonb_array_length(claim.evidence_reference_ids),
          'registration', claim.registration,
          'sourceClass', claim.source_class,
          'sensitivity', claim.sensitivity,
          'audience', claim.audience,
          'validFrom', claim.valid_from,
          'validTo', claim.valid_to,
          'createdRevision', claim.created_revision
        )) order by claim.claim_type, claim.predicate, claim.id)
        from product_claim claim
        where claim.workspace_id = ${request.workspaceId}
          and claim.entity_id = ${request.entityId}::uuid
          and claim.superseded_at is null
          and claim.recorded_at <= ${request.at}::timestamptz
          and claim.valid_from <= ${request.at}::timestamptz
          and (claim.valid_to is null or claim.valid_to > ${request.at}::timestamptz)
          and ${claimVisibility}
      ), '[]'::jsonb) as claims,
      coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', reference.id,
          'entityId', reference.entity_id,
          'kind', reference.reference_kind,
          'sourceClass', reference.source_class,
          'externalId', reference.external_id,
          'canonicalUrl', reference.canonical_url,
          'sensitivity', reference.sensitivity,
          'audience', reference.audience,
          'modelEgress', reference.model_egress,
          'validFrom', reference.valid_from,
          'validTo', reference.valid_to,
          'createdRevision', reference.created_revision
        )) order by reference.reference_kind, reference.source_class, reference.external_id)
        from product_external_reference reference
        where reference.workspace_id = ${request.workspaceId}
          and reference.entity_id = ${request.entityId}::uuid
          and reference.superseded_at is null
          and reference.recorded_at <= ${request.at}::timestamptz
          and reference.valid_from <= ${request.at}::timestamptz
          and (reference.valid_to is null or reference.valid_to > ${request.at}::timestamptz)
          and ${referenceVisibility}
      ), '[]'::jsonb) as "externalReferences",
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', proposal.id,
          'commandType', proposal.command_type,
          'targetEntityIds', proposal.target_entity_ids,
          'expectedRevision', proposal.expected_revision,
          'state', proposal.state,
          'sourceClass', proposal.source_class,
          'sensitivity', proposal.sensitivity,
          'audience', proposal.audience,
          'proposedAt', proposal.proposed_at,
          'expiresAt', proposal.expires_at
        ) order by proposal.proposed_at desc, proposal.id)
        from product_change_proposal proposal
        where proposal.workspace_id = ${request.workspaceId}
          and proposal.target_entity_ids ? ${request.entityId}
          and proposal.proposed_at <= ${request.at}::timestamptz
          and ${proposalVisibility}
      ), '[]'::jsonb) as proposals
    from product_entity entity
    inner join product_entity_state state
      on state.workspace_id = entity.workspace_id
     and state.entity_id = entity.id
    where entity.workspace_id = ${request.workspaceId}
      and entity.id = ${request.entityId}::uuid
      and state.superseded_at is null
      and state.recorded_at <= ${request.at}::timestamptz
      and state.valid_from <= ${request.at}::timestamptz
      and (state.valid_to is null or state.valid_to > ${request.at}::timestamptz)
      and ${stateVisibility}
    order by state.revision desc
    limit 1
  `;
};

export const buildProductEntityHistoryQuery = (
  request: ProductEntityHistoryReadRequest,
): SQL<ProductEntityHistoryRow> => sql<ProductEntityHistoryRow>`
  select
    id,
    revision,
    event_type as type,
    valid_from as "validFrom",
    recorded_at as "recordedAt"
  from product_identity_event
  where workspace_id = ${request.workspaceId}
    and entity_ids ? ${request.entityId}
  order by revision desc, id
  limit ${request.maximumItems + 1}
`;

export const buildProductCoverageQuery = (
  request: ProductCoverageReadRequest,
): SQL<ProductCoverageRow> => {
  const stateVisibility = visibility(
    sql.raw("state"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const claimVisibility = visibility(
    sql.raw("claim"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const referenceVisibility = visibility(
    sql.raw("reference"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const variantVisibility = visibility(
    sql.raw("variant"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const leftVariantVisibility = visibility(
    sql.raw("left_variant"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  const rightVariantVisibility = visibility(
    sql.raw("right_variant"),
    request.visibility.audienceIds,
    request.visibility.maximumSensitivity,
  );
  return sql<ProductCoverageRow>`
    select
      entity.id as "entityId",
      state.canonical_name as "canonicalName",
      entity.kind,
      array_remove(array[
        case when state.recorded_at < ${request.staleBefore}::timestamptz then 'stale' end,
        case when state.registration = 'contested' then 'contested' end,
        case when counts.mapped_reference_count = 0 then 'unmapped' end,
        case when counts.evidenced_claim_count = 0 then 'weakly_evidenced' end,
        case when state.lifecycle <> 'available' then 'unavailable' end,
        case when counts.ambiguous_variant_count > 0 then 'variant_ambiguous' end
      ], null) as flags,
      counts.claim_count::integer as "claimCount",
      counts.reference_count::integer as "referenceCount",
      counts.variant_count::integer as "variantCount",
      state.revision as "updatedRevision"
    from product_entity entity
    inner join product_entity_state state
      on state.workspace_id = entity.workspace_id
     and state.entity_id = entity.id
    cross join lateral (
      select
        (select count(*) from product_claim claim
          where claim.workspace_id = entity.workspace_id and claim.entity_id = entity.id
            and claim.superseded_at is null and claim.recorded_at <= ${request.at}::timestamptz
            and claim.valid_from <= ${request.at}::timestamptz
            and (claim.valid_to is null or claim.valid_to > ${request.at}::timestamptz)
            and ${claimVisibility}) as claim_count,
        (select count(*) from product_claim claim
          where claim.workspace_id = entity.workspace_id and claim.entity_id = entity.id
            and claim.superseded_at is null and jsonb_array_length(claim.evidence_reference_ids) > 0
            and claim.recorded_at <= ${request.at}::timestamptz
            and claim.valid_from <= ${request.at}::timestamptz
            and (claim.valid_to is null or claim.valid_to > ${request.at}::timestamptz)
            and ${claimVisibility}) as evidenced_claim_count,
        (select count(*) from product_external_reference reference
          where reference.workspace_id = entity.workspace_id and reference.entity_id = entity.id
            and reference.superseded_at is null and reference.recorded_at <= ${request.at}::timestamptz
            and reference.valid_from <= ${request.at}::timestamptz
            and (reference.valid_to is null or reference.valid_to > ${request.at}::timestamptz)
            and ${referenceVisibility}) as reference_count,
        (select count(*) from product_external_reference reference
          where reference.workspace_id = entity.workspace_id and reference.entity_id = entity.id
            and reference.reference_kind in ('delivery', 'technical', 'runtime')
            and reference.superseded_at is null and reference.recorded_at <= ${request.at}::timestamptz
            and reference.valid_from <= ${request.at}::timestamptz
            and (reference.valid_to is null or reference.valid_to > ${request.at}::timestamptz)
            and ${referenceVisibility}) as mapped_reference_count,
        (select count(*) from product_variant variant
          where variant.workspace_id = entity.workspace_id and variant.base_entity_id = entity.id
            and variant.superseded_at is null and variant.recorded_at <= ${request.at}::timestamptz
            and variant.valid_from <= ${request.at}::timestamptz
            and (variant.valid_to is null or variant.valid_to > ${request.at}::timestamptz)
            and ${variantVisibility}) as variant_count,
        (select count(*) from product_variant left_variant
          inner join product_variant right_variant
            on right_variant.workspace_id = left_variant.workspace_id
           and right_variant.base_entity_id = left_variant.base_entity_id
           and right_variant.id > left_variant.id
           and right_variant.qualifiers = left_variant.qualifiers
           and right_variant.precedence = left_variant.precedence
           and right_variant.delta <> left_variant.delta
          where left_variant.workspace_id = entity.workspace_id
            and left_variant.base_entity_id = entity.id
            and left_variant.superseded_at is null and right_variant.superseded_at is null
            and left_variant.recorded_at <= ${request.at}::timestamptz
            and right_variant.recorded_at <= ${request.at}::timestamptz
            and left_variant.valid_from <= ${request.at}::timestamptz
            and right_variant.valid_from <= ${request.at}::timestamptz
            and (left_variant.valid_to is null or left_variant.valid_to > ${request.at}::timestamptz)
            and (right_variant.valid_to is null or right_variant.valid_to > ${request.at}::timestamptz)
            and ${leftVariantVisibility}
            and ${rightVariantVisibility}) as ambiguous_variant_count
    ) counts
    where entity.workspace_id = ${request.workspaceId}
      and state.superseded_at is null
      and state.recorded_at <= ${request.at}::timestamptz
      and state.valid_from <= ${request.at}::timestamptz
      and (state.valid_to is null or state.valid_to > ${request.at}::timestamptz)
      and ${stateVisibility}
      and cardinality(array_remove(array[
        case when state.recorded_at < ${request.staleBefore}::timestamptz then 'stale' end,
        case when state.registration = 'contested' then 'contested' end,
        case when counts.mapped_reference_count = 0 then 'unmapped' end,
        case when counts.evidenced_claim_count = 0 then 'weakly_evidenced' end,
        case when state.lifecycle <> 'available' then 'unavailable' end,
        case when counts.ambiguous_variant_count > 0 then 'variant_ambiguous' end
      ], null)) > 0
    order by state.canonical_name, entity.id
    limit ${request.maximumItems + 1}
  `;
};

const validInstant = (value: string) => Number.isFinite(Date.parse(value));

export const createPostgresProductModelDetailRepository = (
  database: KnowledgePostgresDatabase,
): ProductModelDetailRepository => ({
  readDossier: (request) =>
    Effect.gen(function* () {
      if (request.workspaceId.trim() === "" || !validInstant(request.at))
        return yield* invalid("A workspace and valid query instant are required.");
      const result = yield* Effect.tryPromise({
        try: () => database.execute(buildProductDossierQuery(request)),
        catch: () =>
          new RepositoryError({
            message: "Product dossier read failed.",
            operation: "product-model-read-dossier",
          }),
      });
      return result.rows[0] as ProductDossierSnapshot | undefined;
    }),
  readCoverage: (request) =>
    Effect.gen(function* () {
      if (
        request.workspaceId.trim() === "" ||
        !validInstant(request.at) ||
        !validInstant(request.staleBefore)
      )
        return yield* invalid("Coverage requires a workspace and valid query instants.");
      if (
        !Number.isSafeInteger(request.maximumItems) ||
        request.maximumItems < 1 ||
        request.maximumItems > maximumCoverageItems
      )
        return yield* invalid(
          `Coverage item limit must be between 1 and ${maximumCoverageItems}.`,
          String(request.maximumItems),
        );
      const result = yield* Effect.tryPromise({
        try: () => database.execute(buildProductCoverageQuery(request)),
        catch: () =>
          new RepositoryError({
            message: "Product coverage read failed.",
            operation: "product-model-read-coverage",
          }),
      });
      const rows = result.rows as unknown as readonly ProductCoverageRow[];
      return {
        items: rows.slice(0, request.maximumItems).map((row) => ({
          ...row,
          entityId: row.entityId as ProductEntityId,
        })),
        truncated: rows.length > request.maximumItems,
      };
    }),
  readEntityHistory: (request) =>
    Effect.gen(function* () {
      if (request.workspaceId.trim() === "")
        return yield* invalid("Entity history requires a workspace.");
      if (
        !Number.isSafeInteger(request.maximumItems) ||
        request.maximumItems < 1 ||
        request.maximumItems > 100
      )
        return yield* invalid(
          "Entity history item limit must be between 1 and 100.",
          String(request.maximumItems),
        );
      const result = yield* Effect.tryPromise({
        try: () => database.execute(buildProductEntityHistoryQuery(request)),
        catch: () =>
          new RepositoryError({
            message: "Product entity history read failed.",
            operation: "product-model-read-entity-history",
          }),
      });
      const rows = result.rows as unknown as readonly ProductEntityHistoryRow[];
      return {
        events: rows.slice(0, request.maximumItems),
        truncated: rows.length > request.maximumItems,
      };
    }),
});
