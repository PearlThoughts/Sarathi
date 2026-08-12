import type { DeliverySourceKind } from "./delivery-model.ts";

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

export type CompletionProductScope = {
  readonly description: string;
  readonly resolution: "question" | "contract_default";
  readonly entityIds: readonly string[];
  readonly qualifiers: Readonly<Record<string, readonly string[] | undefined>>;
  readonly requestedAt: string;
};

export type CompletionProductSubject = {
  readonly deliveryChangeId: string;
  readonly canonicalName: string;
  readonly matchedPhrase: string;
  readonly matchedBy: "canonical_identity" | "ratified_alias" | "external_mapping";
  readonly affectedEntities: readonly { readonly id: string; readonly canonicalName: string }[];
};

export type CompletionDisposition =
  | "complete"
  | "incomplete"
  | "not_established"
  | "scope_ambiguous";

export type CriterionDisposition = "satisfied" | "contradicted" | "unknown" | "not_applicable";

export type CompletionObservation = {
  readonly id: string;
  readonly subjectId: string;
  readonly assertionType: string;
  readonly lifecycleFacet?: CompletionLifecycleFacet | undefined;
  readonly applicableScope: Readonly<Record<string, readonly string[]>>;
  readonly timestamp: string;
  readonly sourceAuthority: CompletionEvidenceAuthority;
  readonly source: DeliverySourceKind;
  readonly sourceReference: string;
  readonly relevance: "supports" | "contradicts" | "mentions";
  readonly criterionId?: string | undefined;
};

export type ExcludedObservation = {
  readonly id: string;
  readonly source: DeliverySourceKind;
  readonly sourceReference: string;
  readonly reason: string;
};

export type CompletionCriterionAssessment = {
  readonly id: string;
  readonly title: string;
  readonly facet: CompletionLifecycleFacet;
  readonly required: boolean;
  readonly disposition: CriterionDisposition;
  readonly observations: readonly CompletionObservation[];
  readonly reason: string;
};

export type CompletionConflict = {
  readonly id: string;
  readonly criterionIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly reason: string;
};

export type CompletionAssessment = {
  readonly subject:
    | CompletionProductSubject
    | { readonly unresolvedPhrase: string; readonly candidateContractIds: readonly string[] };
  readonly requestedScope?: CompletionProductScope | undefined;
  readonly criteria: readonly CompletionCriterionAssessment[];
  readonly conflicts: readonly CompletionConflict[];
  readonly excludedObservations: readonly ExcludedObservation[];
  readonly disposition: CompletionDisposition;
  readonly summaryReason: string;
};
