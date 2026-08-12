import type {
  CompletionCriterionDefinition,
  CompletionEvidenceBinding,
  ProductCompletionResolution,
} from "../../product-model/index.ts";
import type {
  CompletionAssessment,
  CompletionConflict,
  CompletionCriterionAssessment,
  CompletionDisposition,
  CompletionObservation,
  ExcludedObservation,
} from "../domain/completion-model.ts";
import type {
  DeliveryQueryResult,
  DeliveryResultItem,
} from "../ports/delivery-intelligence-ports.ts";

export type CompletionReconciliation = {
  readonly assessment: CompletionAssessment;
  readonly selectedItems: readonly DeliveryResultItem[];
};

const observationTimestamp = (item: DeliveryResultItem, requestedAt: string): string =>
  item.observedAt ?? item.sourceUpdatedAt ?? item.sourceCreatedAt ?? item.indexedAt ?? requestedAt;

const referenceMatches = (
  item: DeliveryResultItem,
  binding: CompletionEvidenceBinding,
): boolean => {
  if (item.source !== binding.source) return false;
  switch (binding.reference.kind) {
    case "external_key":
      return item.planning?.externalKey === binding.reference.value;
    case "source_id":
      return item.id === binding.reference.value;
    case "citation_url":
      return item.citationUrl === binding.reference.value;
  }
};

const observationFor = (
  item: DeliveryResultItem,
  binding: CompletionEvidenceBinding,
  criterion: CompletionCriterionDefinition | undefined,
  requestedAt: string,
): CompletionObservation => ({
  id: `${item.source}:${item.id}:${binding.assertionType}`,
  subjectId: binding.subjectId,
  assertionType: binding.assertionType,
  ...(criterion === undefined ? {} : { lifecycleFacet: criterion.facet }),
  applicableScope: binding.scope ?? {},
  timestamp: observationTimestamp(item, requestedAt),
  sourceAuthority: binding.authority,
  source: item.source,
  sourceReference: item.citationUrl,
  relevance: binding.relevance as "supports" | "contradicts" | "mentions",
  ...(binding.criterionId === undefined ? {} : { criterionId: binding.criterionId }),
});

const criterionAssessment = (
  criterion: CompletionCriterionDefinition,
  observations: readonly CompletionObservation[],
): CompletionCriterionAssessment => {
  const applicable = observations.filter(({ criterionId }) => criterionId === criterion.id);
  const contradicted = applicable.filter(({ relevance }) => relevance === "contradicts");
  const authorities = new Set(criterion.acceptableAuthorities ?? []);
  const satisfied = applicable.filter(
    ({ relevance, sourceAuthority }) =>
      relevance === "supports" && (authorities.size === 0 || authorities.has(sourceAuthority)),
  );
  if (contradicted.length > 0)
    return {
      ...criterion,
      disposition: "contradicted",
      observations: applicable,
      reason: "A mapped authoritative observation confirms open work or contradicts completion.",
    };
  if (satisfied.length > 0)
    return {
      ...criterion,
      disposition: "satisfied",
      observations: applicable,
      reason: "The required authority class supports this criterion for the requested scope.",
    };
  if (!criterion.required && applicable.length === 0)
    return {
      ...criterion,
      disposition: "not_applicable",
      observations: [],
      reason: "The optional criterion does not apply to the resolved scope.",
    };
  return {
    ...criterion,
    disposition: "unknown",
    observations: applicable,
    reason:
      applicable.length === 0
        ? "No mapped observation establishes this criterion for the requested scope."
        : "Available observations only mention the criterion or lack the required authority class.",
  };
};

const conflictsFor = (
  criteria: readonly CompletionCriterionAssessment[],
  separateDeliveryChangeIds: readonly string[],
): readonly CompletionConflict[] => {
  const direct = criteria.flatMap((criterion) => {
    const supporting = criterion.observations.filter(({ relevance }) => relevance === "supports");
    const contradicting = criterion.observations.filter(
      ({ relevance }) => relevance === "contradicts",
    );
    return supporting.length > 0 && contradicting.length > 0
      ? [
          {
            id: `criterion:${criterion.id}`,
            criterionIds: [criterion.id],
            observationIds: [...supporting, ...contradicting].map(({ id }) => id),
            reason: "Authorized sources assert incompatible states for the same completion facet.",
          },
        ]
      : [];
  });
  const delivered = criteria.flatMap(({ observations }) =>
    observations.filter(
      ({ relevance, subjectId }) =>
        relevance !== "contradicts" && !separateDeliveryChangeIds.includes(subjectId),
    ),
  );
  const separateOpen = criteria.flatMap((criterion) =>
    criterion.observations.filter(
      ({ subjectId, relevance }) =>
        relevance === "contradicts" && separateDeliveryChangeIds.includes(subjectId),
    ),
  );
  return [
    ...direct,
    ...(delivered.length > 0 && separateOpen.length > 0
      ? [
          {
            id: "separate-delivery-change-state",
            criterionIds: [
              ...new Set(
                [...delivered, ...separateOpen].flatMap(({ criterionId }) =>
                  criterionId === undefined ? [] : [criterionId],
                ),
              ),
            ],
            observationIds: [...delivered, ...separateOpen].map(({ id }) => id),
            reason:
              "Delivery activity is recorded while a separately governed required change remains open.",
          },
        ]
      : []),
  ];
};

export const reconcileProductCompletion = (input: {
  readonly resolution: ProductCompletionResolution;
  readonly result: DeliveryQueryResult;
  readonly requestedAt: string;
}): CompletionReconciliation => {
  if (input.resolution.kind !== "resolved")
    return {
      assessment: {
        subject: {
          unresolvedPhrase: input.resolution.phrase,
          candidateContractIds:
            input.resolution.kind === "scope_ambiguous"
              ? input.resolution.candidateContractIds
              : [],
        },
        criteria: [],
        conflicts: [],
        excludedObservations: input.result.items.map((item) => ({
          id: item.id,
          source: item.source,
          sourceReference: item.citationUrl,
          reason: "No unique ratified product subject governs this observation.",
        })),
        disposition: "scope_ambiguous",
        summaryReason:
          "The named subject cannot be resolved uniquely to governed product identity.",
      },
      selectedItems: [],
    };

  const criteriaById = new Map(input.resolution.contract.criteria.map((item) => [item.id, item]));
  const selected = new Map<string, DeliveryResultItem>();
  const observations: CompletionObservation[] = [];
  const excluded: ExcludedObservation[] = [];
  for (const item of input.result.items) {
    const bindings = input.resolution.contract.evidenceBindings.filter((binding) =>
      referenceMatches(item, binding),
    );
    if (bindings.length === 0) {
      excluded.push({
        id: item.id,
        source: item.source,
        sourceReference: item.citationUrl,
        reason: "The observation is not explicitly linked to the resolved product subject.",
      });
      continue;
    }
    for (const binding of bindings) {
      if (binding.relevance === "excluded") {
        excluded.push({
          id: item.id,
          source: item.source,
          sourceReference: item.citationUrl,
          reason: binding.exclusionReason ?? "The observation is outside the completion boundary.",
        });
        continue;
      }
      const criterion =
        binding.criterionId === undefined ? undefined : criteriaById.get(binding.criterionId);
      observations.push(observationFor(item, binding, criterion, input.requestedAt));
      selected.set(`${item.source}:${item.id}`, item);
    }
  }
  const criteria = input.resolution.contract.criteria.map((criterion) =>
    criterionAssessment(criterion, observations),
  );
  const required = criteria.filter(({ required }) => required);
  const disposition: CompletionDisposition = required.some(
    ({ disposition }) => disposition === "contradicted",
  )
    ? "incomplete"
    : required.length > 0 && required.every(({ disposition }) => disposition === "satisfied")
      ? "complete"
      : "not_established";
  const conflicts = conflictsFor(
    criteria,
    input.resolution.contract.separateDeliveryChangeIds ?? [],
  );
  return {
    assessment: {
      subject: input.resolution.subject,
      requestedScope: input.resolution.requestedScope,
      criteria,
      conflicts,
      excludedObservations: excluded,
      disposition,
      summaryReason:
        disposition === "complete"
          ? "Every required applicable criterion is satisfied for the resolved scope."
          : disposition === "incomplete"
            ? "At least one required criterion has confirmed open or contradictory work."
            : "Required completion evidence is missing, stale, or below the required authority.",
    },
    selectedItems: [...selected.values()],
  };
};
