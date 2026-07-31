import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type {
  DeliveryQueryPlan,
  DeliveryQuerySelector,
  DeliveryQuestionIntent,
} from "../domain/delivery-query.ts";
import type {
  DeliveryResponseMode,
  DeliveryResponseProduct,
} from "../domain/delivery-response-mode.ts";
import type { DeliveryCompletionStage, PeriodCensus } from "../domain/period-census.ts";
import type { CapabilityLedger, PeriodDeliveryReport } from "../domain/period-delivery-report.ts";

export type DeliveryQueryContext = {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly audienceIds?: readonly string[] | undefined;
  readonly maximumSensitivity: SensitivityTier;
  readonly financeAccess: boolean;
  readonly requestedAt: string;
  readonly timeZone: string;
  readonly deadlineAt: string;
  readonly question: string;
  readonly responseProduct?: DeliveryResponseProduct | undefined;
  readonly responseMode?: DeliveryResponseMode | undefined;
  readonly totalBudgetMs?: number | undefined;
  readonly sourceTimeoutMs?: number | undefined;
};

type DeliveryQuestionContextEvidence = {
  readonly source: DeliverySourceKind | "intent";
  readonly sourceId: string;
  readonly citationUrl: string;
  readonly title: string;
  readonly excerpt: string;
  readonly observedAt: string;
  readonly contextRole: "conversation";
};

export type DeliveryQuestionContext = {
  readonly channelId: string;
  readonly conversationId: string;
  readonly rootMessageId: string;
  readonly currentMessageId: string;
  readonly evidence: readonly DeliveryQuestionContextEvidence[];
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
  readonly sourceCreatedAt?: string | undefined;
  readonly sourceUpdatedAt?: string | undefined;
  readonly indexedAt?: string | undefined;
  readonly subjectAliases?: readonly string[] | undefined;
  readonly owner?: DeliveryOwnerReference | undefined;
  readonly lifecycleState?: DeliveryLifecycleState | undefined;
  readonly dedupeKey: string;
  readonly actionTarget?: DeliveryActionTarget | undefined;
  readonly planning?:
    | {
        readonly externalKey: string;
        readonly status: string;
        readonly sprint?: string | undefined;
        readonly hasDependency: boolean;
        readonly hasAcceptanceInformation: boolean;
        readonly previousSprint?: DeliverySprintReference | undefined;
        readonly currentSprint?: DeliverySprintReference | undefined;
        readonly sprintClassifications?: readonly DeliverySprintClassification[] | undefined;
      }
    | undefined;
  readonly strategy?:
    | {
        readonly kind: "goal" | "initiative";
        readonly state: string;
        readonly horizonStart?: string | undefined;
        readonly horizonEnd?: string | undefined;
      }
    | undefined;
  readonly evidenceRole?: "declared_intent" | "observed_evidence" | undefined;
  readonly completionStage?: DeliveryCompletionStage | undefined;
};

export type DeliverySprintClassification =
  | "planned_at_start"
  | "added_during_sprint"
  | "completed_during_sprint"
  | "rolled_into_current"
  | "dropped"
  | "current_sprint";

export type DeliverySprintReference = {
  readonly id?: string | undefined;
  readonly name: string;
  readonly state: "active" | "closed" | "future" | "unknown";
  readonly startAt?: string | undefined;
  readonly endAt?: string | undefined;
  readonly completeAt?: string | undefined;
};

export type DeliveryOwnerReference = {
  readonly source: DeliverySourceKind;
  readonly externalId?: string | undefined;
  readonly displayName: string;
};

export type DeliveryLifecycleState =
  | "planned"
  | "active"
  | "blocked"
  | "done"
  | "canceled"
  | "unknown";

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
  readonly missingRequiredIntents?: readonly DeliveryQuestionIntent[] | undefined;
  readonly periodCensus?: PeriodCensus | undefined;
  readonly periodDeliveryReport?: PeriodDeliveryReport | undefined;
};

export type DeliveryQuerySource = {
  readonly source: DeliverySourceKind | "projection" | "knowledge" | "intent";
  readonly selectors: readonly DeliveryQuerySelector[];
  readonly execute: (
    context: DeliveryQueryContext,
    plan: DeliveryQueryPlan,
  ) => Effect.Effect<DeliveryQueryResult, RepositoryError>;
};

export type DeliveryAssistantRequest = Omit<DeliveryQueryContext, "deadlineAt"> & {
  readonly plan?: DeliveryQueryPlan | undefined;
  readonly responseMode?: DeliveryResponseMode | undefined;
  readonly responseProduct?: DeliveryResponseProduct | undefined;
  readonly questionContext?: DeliveryQuestionContext | undefined;
};

export type DeliveryResponseAcceptance = {
  readonly mode: DeliveryResponseMode;
  readonly product: DeliveryResponseProduct;
  readonly elapsedMs: number;
  readonly latencyTargetMs?: number | undefined;
  readonly latencyPassed: boolean;
  readonly requestedIntents: number;
  readonly coveredIntents: number;
  readonly completenessRatio: number;
  readonly completenessPassed: boolean;
  readonly materialStatements: number;
  readonly citedStatements: number;
  readonly citationCoverage: number;
  readonly citationPassed: boolean;
  readonly groundingPassed: boolean;
  readonly freshEvidence: number;
  readonly evaluatedEvidence: number;
  readonly freshnessCoverage: number;
  readonly freshnessPassed: boolean;
  readonly formatPassed: boolean;
  readonly passed: boolean;
};

export type DeliveryAssistantAnswer = {
  readonly text: string;
  readonly citations: readonly {
    readonly label: string;
    readonly url: string;
  }[];
  readonly status: "ok" | "partial" | "empty" | "failed";
  readonly responseMode: DeliveryResponseMode;
  readonly responseProduct: DeliveryResponseProduct;
  readonly responseBudget: {
    readonly sourceTimeoutMs: number;
    readonly compositionTimeoutMs: number;
    readonly totalBudgetMs: number;
  };
  readonly acceptance: DeliveryResponseAcceptance;
  readonly plan: DeliveryQueryPlan;
  readonly unavailableSources: readonly DeliverySourceKind[];
  readonly conflicts: readonly DeliveryConflict[];
  readonly missingRequiredSources?: readonly DeliverySourceKind[] | undefined;
  readonly missingRequiredIntents?: readonly DeliveryQuestionIntent[] | undefined;
  readonly periodCensus?: PeriodCensus | undefined;
  readonly periodDeliveryReport?: PeriodDeliveryReport | undefined;
  readonly failure?:
    | {
        readonly code: "SARATHI-REPORT-COMPOSITION-FAILED";
        readonly classification:
          | "SARATHI-REPORT-PROVIDER-FAILED"
          | "SARATHI-REPORT-COMPOSITION-TIMEOUT"
          | "SARATHI-REPORT-COMPOSITION-INVALID"
          | "SARATHI-REPORT-QUALITY-FAILED";
        readonly diagnosticCode?:
          | "report-provider"
          | "report-composer-unavailable"
          | "report-composition-timeout"
          | "report-composition-empty"
          | "report-composition-structure"
          | "report-composition-sprint-identity"
          | "report-composition-initiative-identity"
          | "report-composition-citations-missing"
          | "report-composition-citation-unknown"
          | "report-composition-citation-placement"
          | "report-composition-prohibited-prose"
          | "report-composition-invalid"
          | "report-quality"
          | undefined;
        readonly correlationCode: string;
      }
    | undefined;
  readonly mentions?: readonly DeliveryActionTarget[];
};

export type DeliveryAnswerCompositionInput = {
  readonly compositionAttempt: "full" | "reduced";
  readonly workspaceId: string;
  readonly question: string;
  readonly requestedAt: string;
  readonly plan: DeliveryQueryPlan;
  readonly items: readonly DeliveryResultItem[];
  readonly conflicts: readonly DeliveryConflict[];
  readonly periodDeliveryReport?: PeriodDeliveryReport | undefined;
  readonly responseProduct: DeliveryResponseProduct;
  readonly responseMode: DeliveryResponseMode;
  readonly responseBudget: {
    readonly sourceTimeoutMs: number;
    readonly compositionTimeoutMs: number;
    readonly totalBudgetMs: number;
  };
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

export type DeliveryReportingConfiguration = {
  readonly capabilityLedger?: CapabilityLedger | undefined;
};

export type DeliveryModelPlanner = {
  readonly plan: (
    question: string,
  ) => Effect.Effect<DeliveryQueryPlan | undefined, RepositoryError>;
};
