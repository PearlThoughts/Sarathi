import type { SensitivityTier } from "../../../domain/policy.ts";
import type {
  DeliveryClaimValue,
  DeliveryMetricCategory,
  DeliveryObjectRef,
  DeliveryObservationKind,
  DeliveryRelationKind,
} from "./delivery-model.ts";

export type DeliveryObjectDraft = DeliveryObjectRef & {
  readonly title: string;
  readonly lifecycleState?: string | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly sensitivity: SensitivityTier;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
};

export type DeliveryRelationDraft = {
  readonly kind: DeliveryRelationKind;
  readonly from: DeliveryObjectRef;
  readonly to: DeliveryObjectRef;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly sensitivity: SensitivityTier;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
};

export type DeliveryObservationDraft = {
  readonly kind: DeliveryObservationKind;
  readonly externalId: string;
  readonly subject?: DeliveryObjectRef | undefined;
  readonly actorExternalKey?: string | undefined;
  readonly summary: string;
  readonly dedupeKey: string;
  readonly occurredAt: string;
  readonly citationUrl?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
};

export type DeliveryMetricDraft = {
  readonly subject: DeliveryObjectRef;
  readonly category: DeliveryMetricCategory;
  readonly kind: string;
  readonly value: string;
  readonly unit: string;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
  readonly sensitivity: SensitivityTier;
};

export type DeliveryClaimDraft = {
  readonly subject?: DeliveryObjectRef | undefined;
  readonly subjectKey: string;
  readonly predicate: string;
  readonly value: DeliveryClaimValue;
  readonly assertedBy?: string | undefined;
  readonly assertedAt: string;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
  readonly citationUrl?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
};

export type DeliveryProjection = {
  readonly objects: readonly DeliveryObjectDraft[];
  readonly relations: readonly DeliveryRelationDraft[];
  readonly observations: readonly DeliveryObservationDraft[];
  readonly metrics: readonly DeliveryMetricDraft[];
  readonly claims: readonly DeliveryClaimDraft[];
};

export const emptyDeliveryProjection = (): DeliveryProjection => ({
  objects: [],
  relations: [],
  observations: [],
  metrics: [],
  claims: [],
});
