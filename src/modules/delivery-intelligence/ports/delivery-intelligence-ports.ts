import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type {
  DeliveryQueryPlan,
  DeliveryQuerySelector,
  DeliveryQuestionIntent,
} from "../domain/delivery-query.ts";

export type DeliveryQueryContext = {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly maximumSensitivity: SensitivityTier;
  readonly financeAccess: boolean;
  readonly requestedAt: string;
  readonly timeZone: string;
  readonly deadlineAt: string;
  readonly question: string;
};

export type DeliveryResultItem = {
  readonly id: string;
  readonly workspaceId: string;
  readonly source: DeliverySourceKind;
  readonly selector: DeliveryQuerySelector;
  readonly intent: DeliveryQuestionIntent;
  readonly title: string;
  readonly summary: string;
  readonly citationUrl: string;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
  readonly observedAt?: string | undefined;
  readonly dedupeKey: string;
  readonly actionTarget?: DeliveryActionTarget | undefined;
};

export type DeliveryActionTarget = {
  readonly source: "teams";
  readonly externalId: string;
  readonly displayName: string;
};

export type DeliveryQueryResult = {
  readonly items: readonly DeliveryResultItem[];
  readonly conflicts: readonly DeliveryConflict[];
  readonly unavailableSources: readonly DeliverySourceKind[];
  readonly complete: boolean;
  readonly missingRequiredSources?: readonly DeliverySourceKind[] | undefined;
};

export type DeliveryQuerySource = {
  readonly source: DeliverySourceKind | "projection" | "knowledge";
  readonly selectors: readonly DeliveryQuerySelector[];
  readonly execute: (
    context: DeliveryQueryContext,
    plan: DeliveryQueryPlan,
  ) => Effect.Effect<DeliveryQueryResult, RepositoryError>;
};

export type DeliveryAssistantRequest = Omit<DeliveryQueryContext, "deadlineAt"> & {
  readonly plan?: DeliveryQueryPlan | undefined;
};

export type DeliveryAssistantAnswer = {
  readonly text: string;
  readonly citations: readonly {
    readonly label: string;
    readonly url: string;
  }[];
  readonly status: "ok" | "partial" | "empty";
  readonly plan: DeliveryQueryPlan;
  readonly unavailableSources: readonly DeliverySourceKind[];
  readonly conflicts: readonly DeliveryConflict[];
  readonly missingRequiredSources?: readonly DeliverySourceKind[] | undefined;
  readonly mentions?: readonly DeliveryActionTarget[];
};

export type DeliveryAnswerCompositionInput = {
  readonly workspaceId: string;
  readonly question: string;
  readonly requestedAt: string;
  readonly plan: DeliveryQueryPlan;
  readonly items: readonly DeliveryResultItem[];
  readonly conflicts: readonly DeliveryConflict[];
};

export type DeliveryAnswerComposition = {
  readonly text: string;
  readonly citations: readonly {
    readonly label: string;
    readonly url: string;
  }[];
};

export type DeliveryAnswerComposer = {
  readonly compose: (
    input: DeliveryAnswerCompositionInput,
  ) => Effect.Effect<DeliveryAnswerComposition, RepositoryError>;
};

export type DeliveryAssistant = {
  readonly answer: (
    request: DeliveryAssistantRequest,
  ) => Effect.Effect<DeliveryAssistantAnswer, RepositoryError>;
};

export type DeliveryModelPlanner = {
  readonly plan: (
    question: string,
  ) => Effect.Effect<DeliveryQueryPlan | undefined, RepositoryError>;
};
