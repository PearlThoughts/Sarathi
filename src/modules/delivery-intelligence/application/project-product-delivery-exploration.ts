import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import {
  type ProductDeliveryExploration,
  type ProductDeliveryProjection,
  type ProductDeliveryStage,
  type ProductFeatureDossier,
  type ProductModelDetailQueryService,
  productDeliveryStages,
} from "../../product-model/index.ts";
import type { DeliveryQueryPlan } from "../domain/delivery-query.ts";
import { buildPeriodDeliveryReport } from "../domain/period-delivery-report.ts";
import type { DeliveryQuerySource } from "../ports/delivery-intelligence-ports.ts";

export type ProductDeliveryExplorationConfiguration = {
  readonly source: DeliveryQuerySource;
  readonly details: ProductModelDetailQueryService;
  readonly timeZone: string;
};

const planFor = (lookbackDays: number, maximumItems: number): DeliveryQueryPlan => ({
  version: 1,
  intents: ["delivered", "current_work", "dependencies", "blockers", "goals"],
  operations: [
    {
      id: "product-current-sprint",
      purpose: "current_work",
      select: "objects",
      objectKinds: ["work_item", "deliverable"],
      time: { kind: "jira_sprint", sprint: "current" },
      limit: maximumItems,
    },
    {
      id: "product-previous-sprint",
      purpose: "delivered",
      select: "objects",
      objectKinds: ["work_item", "deliverable"],
      time: { kind: "jira_sprint", sprint: "previous" },
      limit: maximumItems,
    },
    {
      id: "product-quarter-intent",
      purpose: "goals",
      select: "objects",
      objectKinds: ["goal", "commitment", "deliverable"],
      time: { kind: "workspace_quarter", quarter: "current" },
      limit: maximumItems,
    },
    {
      id: "product-activity",
      purpose: "delivered",
      select: "observations",
      time: { kind: "lookback", days: lookbackDays },
      limit: maximumItems,
    },
    {
      id: "product-dependencies",
      purpose: "dependencies",
      select: "relations",
      traversal: { kinds: ["depends_on", "blocks"], direction: "both", maximumDepth: 2 },
      limit: maximumItems,
    },
    {
      id: "product-period-census",
      purpose: "delivered",
      select: "period_census",
      time: { kind: "lookback", days: lookbackDays },
      census: { pageSize: 200, maximumCandidates: 2_000 },
      limit: 1,
    },
  ],
  answerMode: "deterministic",
  maximumLines: 6,
  requiresFinance: false,
});

const ledgerFor = (dossier: ProductFeatureDossier) => ({
  version: 1 as const,
  capabilities: [
    {
      key: dossier.entity.id,
      title: dossier.entity.canonicalName,
      aliases: [
        { value: dossier.entity.canonicalName },
        ...dossier.aliases.map(({ value }) => ({ value })),
      ],
    },
  ],
});

const stageMap = {
  planned: "planned",
  implemented: "implemented",
  reviewed: "reviewed",
  merged: "merged",
  checks_passed: "checked",
  released: "released",
  deployed: "deployed",
  accepted: "accepted",
  impact_observed: "impact_observed",
} as const satisfies Readonly<Record<string, ProductDeliveryStage>>;

export const createProductDeliveryExplorationProjection = (
  configuration: ProductDeliveryExplorationConfiguration,
): ProductDeliveryProjection => ({
  getProductDelivery: (context, query) =>
    Effect.gen(function* () {
      const dossier = yield* configuration.details.getFeatureDossier(context, {
        entityId: query.entityId,
        at: query.at,
      });
      const deadlineAt = new Date(Date.parse(query.at) + 8_000).toISOString();
      const result = yield* configuration.source.execute(
        {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          audienceIds: context.effectiveAudience,
          maximumSensitivity: context.maximumSensitivity,
          financeAccess: false,
          requestedAt: query.at,
          timeZone: configuration.timeZone,
          deadlineAt,
          question: `Delivery exploration for ${dossier.entity.canonicalName}`,
          totalBudgetMs: 8_000,
          sourceTimeoutMs: 6_000,
        },
        planFor(query.lookbackDays, query.maximumItems),
      );
      if (result.periodCensus === undefined)
        return {
          workspaceId: context.workspaceId,
          entityId: query.entityId,
          asOf: query.at,
          availability: "unavailable" as const,
          stages: productDeliveryStages.map((stage) => ({
            stage,
            state: "not_observed" as const,
            supportingWorkCount: 0,
          })),
          supportingWork: [],
          sourceCoverage: [],
          truncated: false,
          safeWarnings: ["The delivery census required for this projection is unavailable."],
        };
      const census = result.periodCensus;
      const report = yield* Effect.try({
        try: () =>
          buildPeriodDeliveryReport({
            census,
            items: result.items,
            capabilityLedger: ledgerFor(dossier),
          }),
        catch: () =>
          new RepositoryError({
            message: "The authorized product delivery projection is unavailable.",
            operation: "product-delivery-exploration",
          }),
      });
      const section = report.capabilitySections.find(({ key }) => key === query.entityId);
      const capsules = section?.capsules ?? [];
      const supportingWork = capsules.slice(0, query.maximumItems).map((capsule) => ({
        title: capsule.title,
        summary: capsule.summary,
        latestActivityAt: capsule.latestActivityAt,
        lifecycle: capsule.lifecycleState,
        blocked: capsule.blocked,
        currentSprint: capsule.sprintClassifications.includes("current_sprint"),
        recentlyCompletedSprint: capsule.sprintClassifications.includes("completed_during_sprint"),
        sources: capsule.sources,
        citations: capsule.citations,
      }));
      const observedCounts = new Map<ProductDeliveryStage, number>();
      for (const capsule of capsules) {
        if (capsule.lifecycleState === "implementing")
          observedCounts.set(
            "being_implemented",
            (observedCounts.get("being_implemented") ?? 0) + 1,
          );
        for (const chain of capsule.chain) {
          if (chain.state !== "observed") continue;
          const stage = stageMap[chain.stage];
          observedCounts.set(stage, (observedCounts.get(stage) ?? 0) + 1);
        }
      }
      const availability: ProductDeliveryExploration["availability"] = result.complete
        ? "available"
        : "partial";
      return {
        workspaceId: context.workspaceId,
        entityId: query.entityId,
        asOf: query.at,
        availability,
        stages: productDeliveryStages.map((stage) => ({
          stage,
          state: observedCounts.has(stage) ? ("observed" as const) : ("not_observed" as const),
          supportingWorkCount: observedCounts.get(stage) ?? 0,
        })),
        supportingWork,
        sourceCoverage: result.periodCensus.sourceCoverage.map(
          ({ source, available, checkpointAt }) => ({
            source,
            available,
            ...(checkpointAt === undefined ? {} : { checkpointAt }),
          }),
        ),
        truncated: capsules.length > query.maximumItems,
        safeWarnings: [
          ...(result.complete
            ? []
            : ["The delivery projection is partial because one or more sources are unavailable."]),
          ...(capsules.length > query.maximumItems
            ? ["Delivery supporting work was truncated at the authorized query bound."]
            : []),
          "A stage is observed only when the delivery projection supplies supporting evidence; deployment does not imply verification or acceptance.",
        ],
      };
    }).pipe(
      Effect.mapError((error) =>
        error instanceof RepositoryError
          ? error
          : new RepositoryError({
              message: "The authorized product delivery projection is unavailable.",
              operation: "product-delivery-exploration",
            }),
      ),
    ),
});
