import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type { DeliveryQueryPlan, DeliveryQuestionIntent } from "../domain/delivery-query.ts";
import { planDeliveryQuestion, validateDeliveryQueryPlan } from "../domain/delivery-query.ts";
import type {
  DeliveryAssistant,
  DeliveryAssistantAnswer,
  DeliveryAssistantRequest,
  DeliveryModelPlanner,
  DeliveryQueryResult,
  DeliveryQuerySource,
  DeliveryResultItem,
} from "../ports/delivery-intelligence-ports.ts";

export type DeliveryAssistantConfiguration = {
  readonly sources: readonly DeliveryQuerySource[];
  readonly modelPlanner?: DeliveryModelPlanner | undefined;
  readonly sourceTimeoutMs?: number | undefined;
  readonly totalBudgetMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
};

const sourceLabel: Readonly<Record<DeliverySourceKind, string>> = {
  jira: "Jira",
  vault: "Vault",
  github: "GitHub",
  teams: "Teams",
  email: "Email",
};

const intentLabel: Readonly<Record<DeliveryQuestionIntent, string>> = {
  status: "Status",
  scope: "Scope",
  requirements: "Requirements",
  ownership: "Ownership",
  dependencies: "Dependencies",
  blockers: "Blockers",
  delivered: "Delivered",
  current_work: "Current work",
  risks: "Risks",
  recurring: "Recurring issues",
  decisions: "Decisions",
  capacity: "Capacity",
  finance: "Finance",
  activity: "Activity",
  implementation: "Implementation",
};

const safeText = (value: string): string =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 190);

const resolvableUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const sortableTimestamp = (value: string | undefined): number => {
  if (value === undefined) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const uniqueRanked = (items: readonly DeliveryResultItem[]): readonly DeliveryResultItem[] => {
  const seenDedupe = new Set<string>();
  const seenUrls = new Set<string>();
  return [...items]
    .filter((item) => resolvableUrl(item.citationUrl))
    .sort(
      (left, right) =>
        right.authority - left.authority ||
        sortableTimestamp(right.observedAt) - sortableTimestamp(left.observedAt) ||
        left.id.localeCompare(right.id),
    )
    .filter((item) => {
      const dedupeKey = item.dedupeKey.trim().toLowerCase();
      if (seenDedupe.has(dedupeKey) || seenUrls.has(item.citationUrl)) return false;
      seenDedupe.add(dedupeKey);
      seenUrls.add(item.citationUrl);
      return true;
    });
};

const uniqueConflicts = (conflicts: readonly DeliveryConflict[]): readonly DeliveryConflict[] => {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.workspaceId}\u0000${conflict.subjectKey}\u0000${conflict.predicate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const composeAnswer = (
  plan: DeliveryQueryPlan,
  result: DeliveryQueryResult,
): DeliveryAssistantAnswer => {
  const citations: { label: string; url: string }[] = [];
  const citation = (item: DeliveryResultItem): string => {
    const label = `${sourceLabel[item.source]} ${citations.length + 1}`;
    citations.push({ label, url: item.citationUrl });
    return `[${label}](${item.citationUrl})`;
  };
  const lines: string[] = [];
  const items = uniqueRanked(result.items);

  if (plan.intents.length === 1 && plan.intents[0] === "activity") {
    const groups = [
      { label: "Code", sources: new Set<DeliverySourceKind>(["github"]) },
      { label: "Delivery tracking", sources: new Set<DeliverySourceKind>(["jira", "vault"]) },
      { label: "Team updates", sources: new Set<DeliverySourceKind>(["teams", "email"]) },
    ];
    for (const group of groups) {
      const selected = items.filter((item) => group.sources.has(item.source)).slice(0, 2);
      if (selected.length > 0)
        lines.push(
          `${group.label}: ${selected.map((item) => `${safeText(item.summary)} ${citation(item)}`).join("; ")}`,
        );
    }
  } else {
    for (const intent of plan.intents) {
      const selected = items.filter((item) => item.intent === intent).slice(0, 2);
      if (selected.length > 0)
        lines.push(
          `${intentLabel[intent]}: ${selected.map((item) => `${safeText(item.summary)} ${citation(item)}`).join("; ")}`,
        );
    }
  }

  const conflicts = uniqueConflicts(result.conflicts);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    if (conflict !== undefined) {
      const claims = conflict.claims
        .filter((claim) => resolvableUrl(claim.source.citationUrl))
        .slice(0, 2);
      if (claims.length > 1) {
        const summaries = claims.map((claim) => {
          const item: DeliveryResultItem = {
            id: claim.id,
            workspaceId: claim.workspaceId,
            source: claim.source.source,
            selector: "conflicts",
            intent: plan.intents[0] ?? "status",
            title: conflict.subjectKey,
            summary: String(claim.value),
            citationUrl: claim.source.citationUrl,
            sensitivity: claim.sensitivity,
            authority: claim.authority,
            observedAt: claim.observedAt,
            dedupeKey: claim.valueHash,
          };
          return `${safeText(String(claim.value))} ${citation(item)}`;
        });
        const conflictLine = `Conflict — ${conflict.subjectKey} ${conflict.predicate}: ${summaries.join(" vs ")}`;
        if (lines.length >= plan.maximumLines) lines.splice(Math.max(0, plan.maximumLines - 1));
        lines.push(conflictLine);
      }
    }
  }

  if (lines.length === 0) lines.push("No connected project information matched this question.");
  if (result.unavailableSources.length > 0 && lines.length < plan.maximumLines)
    lines.push(
      `Partial: ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")} unavailable.`,
    );

  const text = lines.slice(0, plan.maximumLines).join("\n");
  return {
    text,
    citations: citations.filter(({ url }) => text.includes(url)),
    status: result.unavailableSources.length > 0 ? "partial" : items.length === 0 ? "empty" : "ok",
    plan,
    unavailableSources: result.unavailableSources,
    conflicts,
  };
};

const planQuestion = (
  request: DeliveryAssistantRequest,
  planner: DeliveryModelPlanner | undefined,
): Effect.Effect<DeliveryQueryPlan, RepositoryError> => {
  if (request.plan !== undefined)
    return Effect.try({
      try: () => validateDeliveryQueryPlan(request.plan),
      catch: () =>
        new RepositoryError({
          message: "The delivery question produced an invalid bounded query plan.",
          operation: "delivery-plan-validation",
        }),
    });
  const deterministic = planDeliveryQuestion(request.question);
  if (deterministic !== undefined) return Effect.succeed(deterministic);
  if (planner === undefined)
    return Effect.fail(
      new RepositoryError({
        message: "The delivery question is not supported by the configured planner.",
        operation: "delivery-question-planning",
      }),
    );
  return planner.plan(request.question).pipe(
    Effect.flatMap((planned) =>
      planned === undefined
        ? Effect.fail(
            new RepositoryError({
              message: "The delivery question is not supported by the configured planner.",
              operation: "delivery-question-planning",
            }),
          )
        : Effect.try({
            try: () => validateDeliveryQueryPlan(planned),
            catch: () =>
              new RepositoryError({
                message: "The model proposed an invalid delivery query plan.",
                operation: "delivery-model-plan-validation",
              }),
          }),
    ),
  );
};

export const createDeliveryAssistant = (
  configuration: DeliveryAssistantConfiguration,
): DeliveryAssistant => ({
  answer: (request) =>
    planQuestion(request, configuration.modelPlanner).pipe(
      Effect.flatMap((plan) => {
        if (plan.requiresFinance && !request.financeAccess)
          return Effect.fail(
            new RepositoryError({
              message: "Finance delivery information requires a confidential finance entitlement.",
              operation: "delivery-finance-authorization",
            }),
          );
        const now = configuration.now?.() ?? new Date();
        const totalBudgetMs = Math.max(100, Math.min(configuration.totalBudgetMs ?? 6_500, 8_000));
        const sourceTimeoutMs = Math.max(
          100,
          Math.min(configuration.sourceTimeoutMs ?? 4_500, totalBudgetMs),
        );
        const selectors = new Set(plan.operations.map((operation) => operation.select));
        const sources = configuration.sources.filter((source) =>
          source.selectors.some((selector) => selectors.has(selector)),
        );
        const context = {
          workspaceId: request.workspaceId,
          actorId: request.actorId,
          maximumSensitivity: request.maximumSensitivity,
          financeAccess: request.financeAccess,
          requestedAt: request.requestedAt,
          timeZone: request.timeZone,
          deadlineAt: new Date(now.getTime() + totalBudgetMs).toISOString(),
          question: request.question,
        } as const;
        return Effect.all(
          sources.map((source) =>
            source.execute(context, plan).pipe(
              Effect.timeoutFail({
                duration: sourceTimeoutMs,
                onTimeout: () =>
                  new RepositoryError({
                    message: `${source.source} delivery query exceeded its response budget.`,
                    operation: `delivery-query-${source.source}`,
                  }),
              }),
              Effect.either,
              Effect.map((result) => ({ source, result })),
            ),
          ),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map((results) => {
            const failures = results.filter(({ result }) => result._tag === "Left");
            const successful = results.flatMap(({ result }) =>
              result._tag === "Right" ? [result.right] : [],
            );
            const unavailableSources = [
              ...successful.flatMap((result) => result.unavailableSources),
              ...failures.flatMap(({ source }) => {
                if (source.source === "projection") return ["jira", "vault"] as const;
                if (source.source === "knowledge") return ["vault"] as const;
                return [source.source];
              }),
            ].filter(
              (source, index, values): source is DeliverySourceKind =>
                values.indexOf(source) === index,
            );
            const merged: DeliveryQueryResult = {
              items: successful
                .flatMap((result) => result.items)
                .filter(
                  (item) =>
                    item.workspaceId === request.workspaceId &&
                    isSensitivityAtOrBelow(item.sensitivity, request.maximumSensitivity),
                ),
              conflicts: successful.flatMap((result) => result.conflicts),
              unavailableSources,
              complete:
                failures.length === 0 && successful.every((result) => result.complete === true),
            };
            return composeAnswer(plan, merged);
          }),
          Effect.timeoutFail({
            duration: totalBudgetMs,
            onTimeout: () =>
              new RepositoryError({
                message: "Delivery answer exceeded its response budget.",
                operation: "delivery-answer",
              }),
          }),
        );
      }),
    ),
});
