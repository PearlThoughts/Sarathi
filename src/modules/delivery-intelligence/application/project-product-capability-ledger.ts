import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type {
  ProductEntityId,
  ProductFeatureDossier,
  ProductGraphEnvelope,
  ProductModelDetailQueryService,
  ProductModelQueryService,
  ProductModelRequestContext,
} from "../../product-model/index.ts";
import { selectDeliveryResponseProduct } from "../domain/delivery-response-mode.ts";
import {
  type CapabilityAlias,
  type CapabilityDefinition,
  type CapabilityLedger,
  validateCapabilityLedger,
} from "../domain/period-delivery-report.ts";
import type {
  CapabilityLedgerProjection,
  DeliveryAssistant,
  DeliveryAssistantRequest,
} from "../ports/delivery-intelligence-ports.ts";
import {
  createDeliveryAssistant,
  type DeliveryAssistantConfiguration,
} from "./create-delivery-assistant.ts";

export type ProductCapabilityCompatibilityMapping = {
  readonly legacyKey: string;
  readonly entityId: ProductEntityId;
  readonly additionalAliases?: readonly CapabilityAlias[] | undefined;
  readonly alignment?: CapabilityDefinition["alignment"] | undefined;
};

export type ProductCapabilityLedgerProjectionConfiguration = {
  readonly queries: ProductModelQueryService;
  readonly details: ProductModelDetailQueryService;
  readonly contextFor: (request: DeliveryAssistantRequest) => ProductModelRequestContext;
  readonly legacyLedger?: CapabilityLedger | undefined;
  readonly compatibilityMappings?: readonly ProductCapabilityCompatibilityMapping[] | undefined;
  readonly maximumDepth?: number | undefined;
  readonly maximumNodes?: number | undefined;
  readonly maximumRelations?: number | undefined;
};

const projectionFailure = (): RepositoryError =>
  new RepositoryError({
    message: "The authorized product capability projection is unavailable.",
    operation: "delivery-capability-ledger-projection",
  });

const normalized = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const aliasKey = (alias: CapabilityAlias): string =>
  `${alias.source ?? "*"}:${normalized(alias.value)}`;

const uniqueAliases = (aliases: readonly CapabilityAlias[]): readonly CapabilityAlias[] => {
  const unique = new Map<string, CapabilityAlias>();
  for (const alias of aliases)
    if (normalized(alias.value) !== "" && !unique.has(aliasKey(alias)))
      unique.set(aliasKey(alias), alias);
  return [...unique.values()];
};

const validateRequestContext = (
  request: DeliveryAssistantRequest,
  context: ProductModelRequestContext,
): void => {
  if (context.workspaceId !== request.workspaceId || context.actorId !== request.actorId)
    throw projectionFailure();
  if (!isSensitivityAtOrBelow(context.maximumSensitivity, request.maximumSensitivity))
    throw projectionFailure();
  const requestedAudience = new Set(request.audienceIds ?? []);
  if (context.effectiveAudience.some((audienceId) => !requestedAudience.has(audienceId)))
    throw projectionFailure();
};

const mappedLegacyCapabilities = (
  ledger: CapabilityLedger | undefined,
  mappings: readonly ProductCapabilityCompatibilityMapping[],
): ReadonlyMap<ProductEntityId, readonly CapabilityDefinition[]> => {
  const legacyByKey = new Map(
    (ledger?.capabilities ?? []).map((capability) => [capability.key, capability]),
  );
  const mappingKeys = new Set<string>();
  const byEntity = new Map<ProductEntityId, CapabilityDefinition[]>();
  for (const mapping of mappings) {
    if (mappingKeys.has(mapping.legacyKey)) throw projectionFailure();
    mappingKeys.add(mapping.legacyKey);
    const legacy = legacyByKey.get(mapping.legacyKey);
    if (legacy === undefined) throw projectionFailure();
    byEntity.set(mapping.entityId, [...(byEntity.get(mapping.entityId) ?? []), legacy]);
  }
  return byEntity;
};

const capabilityFor = (
  dossier: ProductFeatureDossier,
  legacyCapabilities: readonly CapabilityDefinition[],
  mappings: readonly ProductCapabilityCompatibilityMapping[],
): CapabilityDefinition => {
  const mappedAlignment = mappings
    .flatMap(({ alignment }) => (alignment === undefined ? [] : [alignment]))
    .concat(
      legacyCapabilities.flatMap(({ alignment }) => (alignment === undefined ? [] : [alignment])),
    );
  if (new Set(mappedAlignment).size > 1) throw projectionFailure();
  const alignment = mappedAlignment[0];
  const aliases = uniqueAliases([
    { value: dossier.entity.canonicalName },
    ...dossier.aliases.map(({ value }) => ({ value })),
    ...legacyCapabilities.flatMap((legacy) => [
      { value: legacy.key },
      { value: legacy.title },
      ...legacy.aliases,
    ]),
    ...mappings.flatMap(({ additionalAliases }) => additionalAliases ?? []),
  ]);
  return {
    key: dossier.entity.id,
    title: dossier.entity.canonicalName,
    aliases,
    ...(alignment === undefined ? {} : { alignment }),
  };
};

const projectLedger = (
  graph: ProductGraphEnvelope,
  dossiers: readonly ProductFeatureDossier[],
  configuration: ProductCapabilityLedgerProjectionConfiguration,
): CapabilityLedger => {
  if (graph.page.truncated || graph.relationPage.truncated) throw projectionFailure();
  const eligibleIds = new Set(
    graph.entities
      .filter(
        ({ registration, lifecycle }) => registration === "ratified" && lifecycle !== "retired",
      )
      .map(({ entityId }) => entityId),
  );
  const configuredMappings = configuration.compatibilityMappings ?? [];
  const configuredLegacyKeys = new Set(configuredMappings.map(({ legacyKey }) => legacyKey));
  const mappings = [
    ...configuredMappings,
    ...(configuration.legacyLedger?.capabilities ?? []).flatMap((legacy) =>
      eligibleIds.has(legacy.key as ProductEntityId) && !configuredLegacyKeys.has(legacy.key)
        ? [{ legacyKey: legacy.key, entityId: legacy.key as ProductEntityId }]
        : [],
    ),
  ];
  const legacyByEntity = mappedLegacyCapabilities(configuration.legacyLedger, mappings);
  const dossierById = new Map(dossiers.map((dossier) => [dossier.entity.id, dossier]));
  for (const mapping of mappings)
    if (!eligibleIds.has(mapping.entityId) || !dossierById.has(mapping.entityId))
      throw projectionFailure();

  const mappedLegacyKeys = new Set(mappings.map(({ legacyKey }) => legacyKey));
  const registryCapabilities = [...eligibleIds]
    .map((entityId) => {
      const dossier = dossierById.get(entityId);
      if (
        dossier === undefined ||
        dossier.entity.registration !== "ratified" ||
        dossier.entity.lifecycle === "retired"
      )
        throw projectionFailure();
      return capabilityFor(
        dossier,
        legacyByEntity.get(entityId) ?? [],
        mappings.filter((mapping) => mapping.entityId === entityId),
      );
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));
  const legacyOnly = (configuration.legacyLedger?.capabilities ?? [])
    .filter(({ key }) => !mappedLegacyKeys.has(key) && !eligibleIds.has(key as ProductEntityId))
    .toSorted((left, right) => left.key.localeCompare(right.key));
  return validateCapabilityLedger({
    version: 1,
    capabilities: [...registryCapabilities, ...legacyOnly],
  });
};

export const createProductCapabilityLedgerProjection = (
  configuration: ProductCapabilityLedgerProjectionConfiguration,
): CapabilityLedgerProjection => ({
  project: (request) =>
    Effect.gen(function* () {
      const context = yield* Effect.try({
        try: () => configuration.contextFor(request),
        catch: projectionFailure,
      });
      yield* Effect.try({
        try: () => validateRequestContext(request, context),
        catch: projectionFailure,
      });
      const graph = yield* configuration.queries.getProductMap(context, {
        at: request.requestedAt,
        maximumDepth: configuration.maximumDepth ?? 4,
        maximumNodes: configuration.maximumNodes ?? 250,
        maximumRelations: configuration.maximumRelations ?? 250,
      });
      if (graph.page.truncated || graph.relationPage.truncated)
        return yield* Effect.fail(projectionFailure());
      const entityIds = graph.entities
        .filter(
          ({ registration, lifecycle }) => registration === "ratified" && lifecycle !== "retired",
        )
        .map(({ entityId }) => entityId);
      const dossiers = yield* Effect.all(
        entityIds.map((entityId) =>
          configuration.details.getFeatureDossier(context, {
            entityId,
            at: request.requestedAt,
          }),
        ),
        { concurrency: 4 },
      );
      return yield* Effect.try({
        try: () => projectLedger(graph, dossiers, configuration),
        catch: projectionFailure,
      });
    }).pipe(Effect.mapError(projectionFailure)),
});

export const createRegistryBackedDeliveryAssistant = (
  configuration: DeliveryAssistantConfiguration,
  projection: CapabilityLedgerProjection,
): DeliveryAssistant => ({
  answer: (request) => {
    const product = selectDeliveryResponseProduct(request.question, request.responseProduct);
    if (product !== "period_delivery_brief" && product !== "leadership_report")
      return createDeliveryAssistant(configuration).answer(request);
    return projection
      .project(request)
      .pipe(
        Effect.flatMap((capabilityLedger) =>
          createDeliveryAssistant({ ...configuration, capabilityLedger }).answer(request),
        ),
      );
  },
});
