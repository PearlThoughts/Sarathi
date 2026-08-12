import type { ProductEntityId, ProductVariantAxis } from "./product-model.ts";
import { normalizeProductAlias } from "./product-model.ts";

export type ProductScope = {
  readonly description: string;
  readonly resolution: "question" | "contract_default";
  readonly entityIds: readonly ProductEntityId[];
  readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, readonly string[]>>>;
  readonly requestedAt: string;
};

export type CompletionLifecycleFacet =
  | "migrated_population"
  | "application_deployment"
  | "hostname_compatibility"
  | "rollout_coverage"
  | "legacy_retirement"
  | "regression_verification"
  | "human_acceptance";

export type CompletionEvidenceAuthority =
  | "scope_authority"
  | "plan_commitment"
  | "implementation"
  | "deployment"
  | "runtime_behavior"
  | "acceptance"
  | "informal_claim";

export type ProductCompletionEvidenceSource =
  | "jira"
  | "vault"
  | "github"
  | "teams"
  | "email"
  | "strategy";

export type CompletionEvidenceRelevance = "supports" | "contradicts" | "mentions" | "excluded";

export type CompletionCriterionDefinition = {
  readonly id: string;
  readonly title: string;
  readonly facet: CompletionLifecycleFacet;
  readonly required: boolean;
  readonly invariantIds?: readonly string[] | undefined;
  readonly acceptableAuthorities?: readonly CompletionEvidenceAuthority[] | undefined;
};

export type CompletionEvidenceBinding = {
  readonly source: ProductCompletionEvidenceSource;
  readonly reference:
    | { readonly kind: "external_key"; readonly value: string }
    | { readonly kind: "source_id"; readonly value: string }
    | { readonly kind: "citation_url"; readonly value: string };
  readonly subjectId: string;
  readonly assertionType: string;
  readonly criterionId?: string | undefined;
  readonly relevance: CompletionEvidenceRelevance;
  readonly authority: CompletionEvidenceAuthority;
  readonly scope?: Readonly<Partial<Record<ProductVariantAxis, readonly string[]>>> | undefined;
  readonly exclusionReason?: string | undefined;
};

export type ProductCompletionContract = {
  readonly id: string;
  readonly deliveryChange: {
    readonly id: string;
    readonly canonicalName: string;
    readonly aliases: readonly {
      readonly value: string;
      readonly authority: "ratified_alias" | "external_mapping";
    }[];
  };
  readonly affectedEntityIds: readonly ProductEntityId[];
  readonly defaultScope: {
    readonly description: string;
    readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, readonly string[]>>>;
  };
  readonly criteria: readonly CompletionCriterionDefinition[];
  readonly evidenceBindings: readonly CompletionEvidenceBinding[];
  readonly separateDeliveryChangeIds?: readonly string[] | undefined;
};

export type ResolvedProductSubject = {
  readonly deliveryChangeId: string;
  readonly canonicalName: string;
  readonly matchedPhrase: string;
  readonly matchedBy: "canonical_identity" | "ratified_alias" | "external_mapping";
  readonly affectedEntities: readonly {
    readonly id: ProductEntityId;
    readonly canonicalName: string;
  }[];
};

export type ProductCompletionResolution =
  | {
      readonly kind: "resolved";
      readonly subject: ResolvedProductSubject;
      readonly requestedScope: ProductScope;
      readonly contract: ProductCompletionContract;
    }
  | {
      readonly kind: "scope_ambiguous";
      readonly phrase: string;
      readonly candidateContractIds: readonly string[];
    }
  | { readonly kind: "not_found"; readonly phrase: string };

export class ProductCompletionContractError extends Error {
  readonly name = "ProductCompletionContractError";
}

const nonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const productEntityIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const variantAxes = new Set<ProductVariantAxis>([
  "client",
  "tenant",
  "brand",
  "role",
  "environment",
  "version",
  "build",
  "feature_flag",
]);

const facets = new Set<CompletionLifecycleFacet>([
  "migrated_population",
  "application_deployment",
  "hostname_compatibility",
  "rollout_coverage",
  "legacy_retirement",
  "regression_verification",
  "human_acceptance",
]);

const sources = new Set<ProductCompletionEvidenceSource>([
  "jira",
  "vault",
  "github",
  "teams",
  "email",
  "strategy",
]);

const authorities = new Set<CompletionEvidenceAuthority>([
  "scope_authority",
  "plan_commitment",
  "implementation",
  "deployment",
  "runtime_behavior",
  "acceptance",
  "informal_claim",
]);

const relevances = new Set<CompletionEvidenceRelevance>([
  "supports",
  "contradicts",
  "mentions",
  "excluded",
]);

const qualifiers = (
  value: unknown,
): Readonly<Partial<Record<ProductVariantAxis, readonly string[]>>> => {
  if (!isRecord(value)) throw new ProductCompletionContractError("Completion scope is invalid.");
  const result: Partial<Record<ProductVariantAxis, readonly string[]>> = {};
  for (const [axis, entries] of Object.entries(value)) {
    if (!variantAxes.has(axis as ProductVariantAxis))
      throw new ProductCompletionContractError("Completion scope contains an unknown axis.");
    if (!Array.isArray(entries) || !entries.every(nonBlank))
      throw new ProductCompletionContractError(
        "Completion scope qualifiers must be non-empty strings.",
      );
    result[axis as ProductVariantAxis] = [...new Set(entries.map((entry) => entry.trim()))];
  }
  return result;
};

const parseContract = (value: unknown): ProductCompletionContract => {
  if (!isRecord(value) || !nonBlank(value.id) || !isRecord(value.deliveryChange))
    throw new ProductCompletionContractError("Completion contract identity is invalid.");
  const deliveryChange = value.deliveryChange;
  if (
    !nonBlank(deliveryChange.id) ||
    !nonBlank(deliveryChange.canonicalName) ||
    !Array.isArray(deliveryChange.aliases)
  )
    throw new ProductCompletionContractError("Completion delivery-change identity is invalid.");
  const aliases = deliveryChange.aliases.map((alias) => {
    if (
      !isRecord(alias) ||
      !nonBlank(alias.value) ||
      (alias.authority !== "ratified_alias" && alias.authority !== "external_mapping")
    )
      throw new ProductCompletionContractError("Completion delivery-change alias is invalid.");
    return {
      value: alias.value.trim(),
      authority: alias.authority as "ratified_alias" | "external_mapping",
    };
  });
  if (
    !Array.isArray(value.affectedEntityIds) ||
    value.affectedEntityIds.length === 0 ||
    !value.affectedEntityIds.every(
      (entityId) => nonBlank(entityId) && productEntityIdPattern.test(entityId),
    ) ||
    !isRecord(value.defaultScope) ||
    !nonBlank(value.defaultScope.description) ||
    !Array.isArray(value.criteria) ||
    value.criteria.length === 0 ||
    !Array.isArray(value.evidenceBindings)
  )
    throw new ProductCompletionContractError("Completion contract structure is invalid.");
  const criteria = value.criteria.map((criterion) => {
    if (
      !isRecord(criterion) ||
      !nonBlank(criterion.id) ||
      !nonBlank(criterion.title) ||
      !facets.has(criterion.facet as CompletionLifecycleFacet) ||
      typeof criterion.required !== "boolean" ||
      (criterion.acceptableAuthorities !== undefined &&
        (!Array.isArray(criterion.acceptableAuthorities) ||
          criterion.acceptableAuthorities.length === 0 ||
          !criterion.acceptableAuthorities.every((authority) =>
            authorities.has(authority as CompletionEvidenceAuthority),
          ))) ||
      (criterion.invariantIds !== undefined &&
        (!Array.isArray(criterion.invariantIds) || !criterion.invariantIds.every(nonBlank)))
    )
      throw new ProductCompletionContractError("Completion criterion is invalid.");
    return {
      id: criterion.id.trim(),
      title: criterion.title.trim(),
      facet: criterion.facet as CompletionLifecycleFacet,
      required: criterion.required,
      ...(criterion.invariantIds === undefined
        ? {}
        : { invariantIds: [...new Set(criterion.invariantIds.map((entry) => entry.trim()))] }),
      ...(criterion.acceptableAuthorities === undefined
        ? {}
        : {
            acceptableAuthorities: [
              ...new Set(criterion.acceptableAuthorities as readonly CompletionEvidenceAuthority[]),
            ],
          }),
    };
  });
  if (new Set(criteria.map(({ id }) => id)).size !== criteria.length)
    throw new ProductCompletionContractError("Completion criterion IDs must be unique.");
  const criterionIds = new Set(criteria.map(({ id }) => id));
  const evidenceBindings = value.evidenceBindings.map((binding) => {
    if (
      !isRecord(binding) ||
      !sources.has(binding.source as ProductCompletionEvidenceSource) ||
      !isRecord(binding.reference) ||
      !["external_key", "source_id", "citation_url"].includes(String(binding.reference.kind)) ||
      !nonBlank(binding.reference.value) ||
      !nonBlank(binding.subjectId) ||
      !nonBlank(binding.assertionType) ||
      !relevances.has(binding.relevance as CompletionEvidenceRelevance) ||
      !authorities.has(binding.authority as CompletionEvidenceAuthority) ||
      (binding.criterionId !== undefined &&
        (!nonBlank(binding.criterionId) || !criterionIds.has(binding.criterionId))) ||
      (binding.relevance !== "excluded" && binding.criterionId === undefined) ||
      (binding.relevance === "excluded" && !nonBlank(binding.exclusionReason))
    )
      throw new ProductCompletionContractError("Completion evidence binding is invalid.");
    return {
      source: binding.source as ProductCompletionEvidenceSource,
      reference: {
        kind: binding.reference.kind as "external_key" | "source_id" | "citation_url",
        value: binding.reference.value.trim(),
      },
      subjectId: binding.subjectId.trim(),
      assertionType: binding.assertionType.trim(),
      ...(binding.criterionId === undefined ? {} : { criterionId: binding.criterionId.trim() }),
      relevance: binding.relevance as CompletionEvidenceRelevance,
      authority: binding.authority as CompletionEvidenceAuthority,
      ...(binding.scope === undefined ? {} : { scope: qualifiers(binding.scope) }),
      ...(nonBlank(binding.exclusionReason)
        ? { exclusionReason: binding.exclusionReason.trim() }
        : {}),
    };
  });
  return {
    id: value.id.trim(),
    deliveryChange: {
      id: deliveryChange.id.trim(),
      canonicalName: deliveryChange.canonicalName.trim(),
      aliases,
    },
    affectedEntityIds: [...new Set(value.affectedEntityIds)] as readonly ProductEntityId[],
    defaultScope: {
      description: value.defaultScope.description.trim(),
      qualifiers: qualifiers(value.defaultScope.qualifiers ?? {}),
    },
    criteria,
    evidenceBindings,
    ...(value.separateDeliveryChangeIds === undefined
      ? {}
      : {
          separateDeliveryChangeIds:
            Array.isArray(value.separateDeliveryChangeIds) &&
            value.separateDeliveryChangeIds.every(nonBlank)
              ? [...new Set(value.separateDeliveryChangeIds.map((entry) => entry.trim()))]
              : (() => {
                  throw new ProductCompletionContractError(
                    "Separate delivery-change identities are invalid.",
                  );
                })(),
        }),
  };
};

export const parseProductCompletionContracts = (
  input: unknown,
): readonly ProductCompletionContract[] => {
  if (!Array.isArray(input))
    throw new ProductCompletionContractError("Completion contracts must be an array.");
  const contracts = input.map(parseContract);
  if (new Set(contracts.map(({ id }) => id)).size !== contracts.length)
    throw new ProductCompletionContractError("Completion contract IDs must be unique.");
  return contracts;
};

const matchPriority = (
  phrase: string,
  contract: ProductCompletionContract,
): ResolvedProductSubject["matchedBy"] | undefined => {
  const target = normalizeProductAlias(phrase);
  if (target === normalizeProductAlias(contract.deliveryChange.canonicalName))
    return "canonical_identity";
  const alias = contract.deliveryChange.aliases.find(
    ({ value }) => normalizeProductAlias(value) === target,
  );
  return alias?.authority;
};

export const resolveProductCompletionContract = (input: {
  readonly phrase: string;
  readonly requestedAt: string;
  readonly contracts: readonly ProductCompletionContract[];
  readonly visibleEntities: readonly {
    readonly entityId: ProductEntityId;
    readonly canonicalName: string;
    readonly registration: string;
    readonly lifecycle: string;
  }[];
  readonly ratifiedDeliveryRelations: readonly {
    readonly deliveryChangeId: string;
    readonly entityId: ProductEntityId;
  }[];
}): ProductCompletionResolution => {
  const matches = input.contracts.flatMap((contract) => {
    const matchedBy = matchPriority(input.phrase, contract);
    return matchedBy === undefined ? [] : [{ contract, matchedBy }];
  });
  if (matches.length === 0) return { kind: "not_found", phrase: input.phrase };
  const highestPriority = Math.min(
    ...matches.map(({ matchedBy }) =>
      matchedBy === "canonical_identity" ? 0 : matchedBy === "ratified_alias" ? 1 : 2,
    ),
  );
  const preferred = matches.filter(({ matchedBy }) =>
    highestPriority === 0
      ? matchedBy === "canonical_identity"
      : highestPriority === 1
        ? matchedBy === "ratified_alias"
        : matchedBy === "external_mapping",
  );
  if (preferred.length !== 1)
    return {
      kind: "scope_ambiguous",
      phrase: input.phrase,
      candidateContractIds: preferred.map(({ contract }) => contract.id).toSorted(),
    };
  const selected = preferred[0];
  if (selected === undefined)
    throw new ProductCompletionContractError("Completion subject resolution failed.");
  const { contract, matchedBy } = selected;
  if (
    !input.ratifiedDeliveryRelations.some(
      ({ deliveryChangeId, entityId }) =>
        deliveryChangeId === contract.deliveryChange.id &&
        contract.affectedEntityIds.includes(entityId),
    )
  )
    throw new ProductCompletionContractError(
      "The completion contract is not linked by a ratified product relation.",
    );
  const visibleById = new Map(input.visibleEntities.map((entity) => [entity.entityId, entity]));
  const affectedEntities = contract.affectedEntityIds.map((entityId) => {
    const entity = visibleById.get(entityId);
    if (
      entity === undefined ||
      entity.registration !== "ratified" ||
      entity.lifecycle === "retired"
    )
      throw new ProductCompletionContractError(
        "The completion contract references unavailable product identity.",
      );
    return { id: entity.entityId, canonicalName: entity.canonicalName };
  });
  return {
    kind: "resolved",
    subject: {
      deliveryChangeId: contract.deliveryChange.id,
      canonicalName: contract.deliveryChange.canonicalName,
      matchedPhrase: input.phrase,
      matchedBy,
      affectedEntities,
    },
    requestedScope: {
      description: contract.defaultScope.description,
      resolution: "contract_default",
      entityIds: contract.affectedEntityIds,
      qualifiers: contract.defaultScope.qualifiers,
      requestedAt: input.requestedAt,
    },
    contract,
  };
};
