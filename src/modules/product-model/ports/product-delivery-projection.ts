import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { ProductEntityId } from "../domain/product-model.ts";
import type { ProductModelRequestContext } from "./product-model-query-authorizer.ts";

export type ProductDeliverySource =
  | "jira"
  | "vault"
  | "github"
  | "teams"
  | "email"
  | "strategy"
  | "telemetry";

export const productDeliveryStages = [
  "proposed",
  "planned",
  "being_implemented",
  "implemented",
  "reviewed",
  "merged",
  "checked",
  "released",
  "migrated",
  "deployed",
  "compatible",
  "verified",
  "accepted",
  "impact_observed",
  "retired",
] as const;

export type ProductDeliveryStage = (typeof productDeliveryStages)[number];

export type ProductDeliveryStageSummary = {
  readonly stage: ProductDeliveryStage;
  readonly state: "observed" | "not_observed";
  readonly supportingWorkCount: number;
};

export type ProductDeliveryWorkSummary = {
  readonly title: string;
  readonly summary: string;
  readonly latestActivityAt: string;
  readonly lifecycle:
    | "scoped"
    | "implementing"
    | "development_ready"
    | "qa"
    | "production"
    | "accepted";
  readonly blocked: boolean;
  readonly currentSprint: boolean;
  readonly recentlyCompletedSprint: boolean;
  readonly quarterRelevant: boolean;
  readonly sources: readonly ProductDeliverySource[];
  readonly citations: readonly {
    readonly source: ProductDeliverySource;
    readonly url: string;
  }[];
};

export type ProductDeliveryExploration = {
  readonly workspaceId: string;
  readonly entityId: ProductEntityId;
  readonly asOf: string;
  readonly availability: "available" | "partial" | "unavailable";
  readonly stages: readonly ProductDeliveryStageSummary[];
  readonly supportingWork: readonly ProductDeliveryWorkSummary[];
  readonly sourceCoverage: readonly {
    readonly source: ProductDeliverySource;
    readonly available: boolean;
    readonly checkpointAt?: string | undefined;
  }[];
  readonly truncated: boolean;
  readonly safeWarnings: readonly string[];
};

export type ProductDeliveryProjection = {
  readonly getProductDelivery: (
    context: ProductModelRequestContext,
    query: {
      readonly entityId: ProductEntityId;
      readonly at: string;
      readonly lookbackDays: number;
      readonly maximumItems: number;
    },
  ) => Effect.Effect<ProductDeliveryExploration, RepositoryError>;
};

export const unavailableProductDelivery = (
  workspaceId: string,
  entityId: ProductEntityId,
  asOf: string,
): ProductDeliveryExploration => ({
  workspaceId,
  entityId,
  asOf,
  availability: "unavailable",
  stages: productDeliveryStages.map((stage) => ({
    stage,
    state: "not_observed",
    supportingWorkCount: 0,
  })),
  supportingWork: [],
  sourceCoverage: [],
  truncated: false,
  safeWarnings: ["The authorized delivery projection is currently unavailable."],
});
