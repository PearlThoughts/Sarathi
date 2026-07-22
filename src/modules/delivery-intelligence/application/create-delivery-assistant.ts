import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type { DeliveryQueryPlan, DeliveryQuestionIntent } from "../domain/delivery-query.ts";
import { planDeliveryQuestion, validateDeliveryQueryPlan } from "../domain/delivery-query.ts";
import type {
  DeliveryAnswerComposer,
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
  readonly answerComposer?: DeliveryAnswerComposer | undefined;
  readonly sourceTimeoutMs?: number | undefined;
  readonly compositionTimeoutMs?: number | undefined;
  readonly totalBudgetMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
};

export const deliveryResponseBudget = {
  sourceTimeoutMs: 4_500,
  compositionTimeoutMs: 2_500,
  totalBudgetMs: 6_500,
} as const;

const sourceLabel: Readonly<Record<DeliverySourceKind, string>> = {
  jira: "Jira",
  vault: "Vault",
  github: "GitHub",
  teams: "Teams",
  email: "Email",
};

const intentLabel: Readonly<Record<DeliveryQuestionIntent, string>> = {
  general: "Delivery context",
  status: "Status",
  goals: "Goals",
  commitments: "Commitments",
  scope: "Scope",
  requirements: "Requirements",
  ownership: "Ownership",
  reviews: "Review queue",
  conflicts: "Conflicts",
  dependencies: "Dependencies",
  blockers: "Blockers",
  delivered: "Delivered",
  current_work: "Current work",
  risks: "Risks",
  recurring: "Recurring issues",
  decisions: "Decisions",
  next_actions: "Next action",
  milestones: "Milestones",
  capacity: "Capacity",
  finance: "Finance",
  activity: "Activity",
  implementation: "Implementation",
};

const intentIcon: Readonly<Record<DeliveryQuestionIntent, string>> = {
  general: "📌",
  status: "📊",
  goals: "🎯",
  commitments: "🤝",
  scope: "🧭",
  requirements: "📋",
  ownership: "👤",
  reviews: "🔎",
  conflicts: "⚖️",
  dependencies: "🔗",
  blockers: "⛔",
  delivered: "✅",
  current_work: "🚧",
  risks: "⚠️",
  recurring: "🔁",
  decisions: "💡",
  next_actions: "➡️",
  milestones: "🏁",
  capacity: "📈",
  finance: "🔒",
  activity: "🗓️",
  implementation: "🧩",
};

const safeText = (value: string): string =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 190);

const safeMentionName = (value: string): string =>
  value
    .replace(/[<>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const responseOpening = (plan: DeliveryQueryPlan): string => {
  const intents = new Set(plan.intents);
  if (intents.has("activity"))
    return "Here’s the current project activity across connected sources.";
  if (intents.has("risks") || intents.has("blockers"))
    return "Here’s the delivery situation that needs attention.";
  if (intents.has("dependencies")) return "Here’s who appears to be waiting on what.";
  if (intents.has("reviews")) return "Here’s the current review queue and requested reviewers.";
  if (intents.has("conflicts")) return "Here’s where connected delivery sources disagree.";
  if (intents.has("status")) return "Here’s the current delivery status I found.";
  if (intents.has("implementation")) return "Here’s the relevant implementation context I found.";
  return "Here’s the delivery context I found for your question.";
};

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
      const intentDedupeKey = `${item.intent}\u0000${item.dedupeKey.trim().toLowerCase()}`;
      const intentCitationUrl = `${item.intent}\u0000${item.citationUrl}`;
      if (seenDedupe.has(intentDedupeKey) || seenUrls.has(intentCitationUrl)) return false;
      seenDedupe.add(intentDedupeKey);
      seenUrls.add(intentCitationUrl);
      return true;
    });
};

const statusSourcePriority: Readonly<Record<DeliverySourceKind, number>> = {
  jira: 0,
  vault: 1,
  teams: 2,
  github: 3,
  email: 4,
};

const rankedForIntent = (
  items: readonly DeliveryResultItem[],
  intent: DeliveryQuestionIntent,
): readonly DeliveryResultItem[] =>
  intent === "status"
    ? [...items].sort(
        (left, right) => statusSourcePriority[left.source] - statusSourcePriority[right.source],
      )
    : items;

const subjectTokens = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 2 && !["the", "and", "for", "with"].includes(token));

const itemMatchesPlan = (item: DeliveryResultItem, plan: DeliveryQueryPlan): boolean => {
  // A cross-source conflict is a relationship between attributed claims, not a
  // conflict-shaped sentence from any single adapter.
  if (item.intent === "conflicts") return false;
  const operation = plan.operations.find(
    (candidate) => candidate.purpose === item.intent && candidate.select === item.selector,
  );
  if (operation === undefined) return false;
  if (operation.select === "github_live" && item.source !== "github") return false;
  const subject = plan.subject;
  if (subject === undefined) return true;
  const searchable = `${item.title} ${item.summary}`.toLowerCase();
  if (subject.externalKey !== undefined)
    return searchable.includes(subject.externalKey.toLowerCase());
  const tokens = subjectTokens(subject.phrase ?? "");
  return tokens.every((token) => searchable.includes(token));
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

const authorizedConflicts = (
  conflicts: readonly DeliveryConflict[],
  workspaceId: string,
  maximumSensitivity: DeliveryAssistantRequest["maximumSensitivity"],
): readonly DeliveryConflict[] =>
  conflicts.flatMap((conflict) => {
    if (conflict.workspaceId !== workspaceId) return [];
    const claims = conflict.claims.filter(
      (claim) =>
        claim.workspaceId === workspaceId &&
        isSensitivityAtOrBelow(claim.sensitivity, maximumSensitivity),
    );
    const sources = new Set(claims.map((claim) => claim.source.source));
    return claims.length < 2 || sources.size < 2 ? [] : [{ ...conflict, claims }];
  });

const composeAnswer = (
  _request: DeliveryAssistantRequest,
  plan: DeliveryQueryPlan,
  result: DeliveryQueryResult,
): DeliveryAssistantAnswer => {
  const citations: { label: string; url: string }[] = [];
  const citationLabels = new Map<string, string>();
  const citation = (item: DeliveryResultItem): string => {
    const key = `${item.intent}\u0000${item.citationUrl}`;
    const existing = citationLabels.get(key);
    if (existing !== undefined) return `[${existing}](${item.citationUrl})`;
    const label = `${sourceLabel[item.source]} ${citations.length + 1}`;
    citations.push({ label, url: item.citationUrl });
    citationLabels.set(key, label);
    return `[${label}](${item.citationUrl})`;
  };
  const detailLines: string[] = [];
  const items = uniqueRanked(result.items.filter((item) => itemMatchesPlan(item, plan)));
  const missingIntentLabels = (result.missingRequiredIntents ?? []).map(
    (intent) => intentLabel[intent],
  );

  if (plan.intents.length === 1 && plan.intents[0] === "activity") {
    const groups = [
      { icon: "🧩", label: "Code", sources: new Set<DeliverySourceKind>(["github"]) },
      {
        icon: "📋",
        label: "Delivery tracking",
        sources: new Set<DeliverySourceKind>(["jira", "vault"]),
      },
      {
        icon: "💬",
        label: "Team updates",
        sources: new Set<DeliverySourceKind>(["teams", "email"]),
      },
    ];
    for (const group of groups) {
      const selected = items.filter((item) => group.sources.has(item.source)).slice(0, 2);
      if (selected.length > 0)
        detailLines.push(
          `- ${group.icon} **${group.label}:** ${selected.map((item) => `${safeText(item.summary)} ${citation(item)}`).join("; ")}`,
        );
    }
  } else {
    for (const intent of plan.intents) {
      if (intent === "next_actions") continue;
      const selected = rankedForIntent(
        items.filter((item) => item.intent === intent),
        intent,
      ).slice(0, 2);
      if (selected.length > 0)
        detailLines.push(
          `- ${intentIcon[intent]} **${intentLabel[intent]}:** ${selected.map((item) => `${safeText(item.summary)} ${citation(item)}`).join("; ")}`,
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
        const conflictLine = `- ⚖️ **Conflict — ${conflict.subjectKey} ${conflict.predicate}:** ${summaries.join(" vs ")}`;
        if (detailLines.length >= plan.maximumLines)
          detailLines.splice(Math.max(0, plan.maximumLines - 1));
        detailLines.push(conflictLine);
      }
    }
  }

  const hasSourceBackedAction = items.some((item) => item.intent === "next_actions");
  if (detailLines.length === 0 && !hasSourceBackedAction) {
    const unavailable = result.unavailableSources.map((source) => sourceLabel[source]).join(", ");
    const missing = (result.missingRequiredSources ?? [])
      .map((source) => sourceLabel[source])
      .join(", ");
    return {
      text:
        missing !== ""
          ? [
              "I couldn’t verify this answer from every required project source.",
              `- ⚠️ **Coverage:** No matching ${missing} result was available.`,
              "1. ➡️ **Next:** Verify the required source connection or refine the project item.",
            ].join("\n")
          : result.unavailableSources.length === 0
            ? "I couldn’t find connected project information that answers this yet."
            : [
                "I couldn’t answer this yet because connected project sources are unavailable.",
                `- ⚠️ **Coverage:** ${unavailable} unavailable.`,
                "1. ➡️ **Next:** Retry after connected source access is restored.",
              ].join("\n"),
      citations: [],
      status:
        result.unavailableSources.length > 0 || (result.missingRequiredSources?.length ?? 0) > 0
          ? "partial"
          : "empty",
      plan,
      unavailableSources: result.unavailableSources,
      conflicts,
      missingRequiredSources: result.missingRequiredSources,
      missingRequiredIntents: result.missingRequiredIntents,
      mentions: [],
    };
  }
  if (result.unavailableSources.length > 0 && detailLines.length < plan.maximumLines)
    detailLines.push(
      `- ⚠️ **Coverage:** ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")} unavailable.`,
    );
  if ((result.missingRequiredSources?.length ?? 0) > 0 && detailLines.length < plan.maximumLines)
    detailLines.push(
      `- ⚠️ **Coverage:** No matching ${result.missingRequiredSources?.map((source) => sourceLabel[source]).join(", ")} result was available.`,
    );
  if (missingIntentLabels.length > 0) {
    const coverage = `- ⚠️ **Coverage:** No explicit ${missingIntentLabels.join(", ")} evidence was found.`;
    if (detailLines.length >= plan.maximumLines) detailLines.splice(plan.maximumLines - 1);
    detailLines.push(coverage);
  }

  const materialItems = items.filter((item) => item.intent !== "next_actions");
  const relatedToMaterial = (candidate: DeliveryResultItem): boolean => {
    if (materialItems.length === 0) return true;
    const candidateKeys = new Set(candidate.summary.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []);
    return materialItems.some(
      (item) =>
        item.citationUrl === candidate.citationUrl ||
        [...candidateKeys].some((key) => item.summary.includes(key)),
    );
  };
  const mentionActionItem = items.find(
    (item) =>
      item.intent === "next_actions" && item.actionTarget !== undefined && relatedToMaterial(item),
  );
  const actionItem =
    mentionActionItem ??
    items.find((item) => item.intent === "next_actions" && relatedToMaterial(item));
  const mentionName =
    mentionActionItem?.actionTarget === undefined
      ? undefined
      : safeMentionName(mentionActionItem.actionTarget.displayName);
  const actionLine =
    actionItem === undefined
      ? undefined
      : mentionName !== undefined && mentionName !== ""
        ? `1. ➡️ **Next:** <at>${mentionName}</at>, please confirm the next step and due date for this item. ${citation(actionItem)}`
        : `1. ➡️ **Next:** ${safeText(actionItem.summary)} ${citation(actionItem)}`;
  const lines = [
    responseOpening(plan),
    ...detailLines.slice(0, plan.maximumLines),
    ...(actionLine === undefined ? [] : [actionLine]),
  ];
  const text = lines.join("\n");
  return {
    text,
    citations: citations.filter(({ url }) => text.includes(url)),
    status:
      result.unavailableSources.length > 0 || (result.missingRequiredSources?.length ?? 0) > 0
        ? "partial"
        : missingIntentLabels.length > 0
          ? "partial"
          : items.length === 0
            ? "empty"
            : "ok",
    plan,
    unavailableSources: result.unavailableSources,
    conflicts,
    missingRequiredSources: result.missingRequiredSources,
    missingRequiredIntents: result.missingRequiredIntents,
    mentions:
      mentionActionItem?.actionTarget === undefined ||
      mentionName === undefined ||
      mentionName === ""
        ? []
        : [{ ...mentionActionItem.actionTarget, displayName: mentionName }],
  };
};

const composeWithModel = (
  composer: DeliveryAnswerComposer,
  request: DeliveryAssistantRequest,
  plan: DeliveryQueryPlan,
  result: DeliveryQueryResult,
  timeoutMs: number,
): Effect.Effect<DeliveryAssistantAnswer> => {
  const deterministic = composeAnswer(request, plan, result);
  const items = rankedForIntent(uniqueRanked(result.items), plan.intents[0] ?? "general").slice(
    0,
    12,
  );
  const hasSourceBackedAction = items.some((item) => item.intent === "next_actions");
  if (
    items.length < 2 ||
    !hasSourceBackedAction ||
    (result.missingRequiredIntents?.length ?? 0) > 0 ||
    (deterministic.mentions?.length ?? 0) > 0
  )
    return Effect.succeed(deterministic);
  const allowedCitationUrls = new Set([
    ...items.map((item) => item.citationUrl),
    ...result.conflicts.flatMap((conflict) =>
      conflict.claims.map((claim) => claim.source.citationUrl),
    ),
  ]);
  return composer
    .compose({
      workspaceId: request.workspaceId,
      question: request.question,
      requestedAt: request.requestedAt,
      plan,
      items,
      conflicts: result.conflicts,
    })
    .pipe(
      Effect.timeoutFail({
        duration: timeoutMs,
        onTimeout: () =>
          new RepositoryError({
            message: "Delivery answer composition exceeded its response budget.",
            operation: "delivery-answer-composition",
          }),
      }),
      Effect.flatMap((composed) =>
        Effect.try({
          try: () => {
            const lines = composed.text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            if (lines.length < 3 || lines.length > plan.maximumLines + 2)
              throw new Error("Composed delivery answer has an invalid line count.");
            if (/^(?:-|\d+\.)\s/.test(lines[0] ?? ""))
              throw new Error("Composed delivery answer lacks a short opening paragraph.");
            if (!lines.slice(1, -1).some((line) => line.startsWith("- ")))
              throw new Error("Composed delivery answer lacks scannable evidence bullets.");
            if (!/^1\.\s/.test(lines.at(-1) ?? ""))
              throw new Error("Composed delivery answer lacks an explicit next action.");
            if (
              composed.citations.some(
                ({ url }) => !resolvableUrl(url) || !allowedCitationUrls.has(url),
              )
            )
              throw new Error("Composed delivery answer contains an unknown citation.");
            return {
              ...deterministic,
              text: lines.join("\n"),
              citations: composed.citations,
              mentions: [],
            };
          },
          catch: () =>
            new RepositoryError({
              message: "Delivery answer composition was invalid.",
              operation: "delivery-answer-composition-validation",
            }),
        }),
      ),
      Effect.catchAll(() => Effect.succeed(deterministic)),
    );
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
        const totalBudgetMs = Math.max(
          100,
          Math.min(configuration.totalBudgetMs ?? deliveryResponseBudget.totalBudgetMs, 8_000),
        );
        const sourceTimeoutMs = Math.max(
          100,
          Math.min(
            configuration.sourceTimeoutMs ?? deliveryResponseBudget.sourceTimeoutMs,
            totalBudgetMs,
          ),
        );
        const compositionTimeoutMs = Math.max(
          100,
          Math.min(
            configuration.compositionTimeoutMs ?? deliveryResponseBudget.compositionTimeoutMs,
            totalBudgetMs,
          ),
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
          Effect.flatMap((results) => {
            const failures = results.filter(({ result }) => result._tag === "Left");
            const successful = results.flatMap(({ result }) =>
              result._tag === "Right" ? [result.right] : [],
            );
            const unavailableSources = [
              ...successful.flatMap((result) => result.unavailableSources),
              ...failures.flatMap(({ source }) => {
                if (source.source === "projection") return ["jira", "vault"] as const;
                if (source.source === "knowledge") return ["jira", "vault"] as const;
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
                    isSensitivityAtOrBelow(item.sensitivity, request.maximumSensitivity) &&
                    itemMatchesPlan(item, plan),
                ),
              conflicts: authorizedConflicts(
                successful.flatMap((result) => result.conflicts),
                request.workspaceId,
                request.maximumSensitivity,
              ),
              unavailableSources,
              complete:
                failures.length === 0 && successful.every((result) => result.complete === true),
            };
            const representedSources = new Set([
              ...merged.items.map((item) => item.source),
              ...merged.conflicts.flatMap((conflict) =>
                conflict.claims.map((claim) => claim.source.source),
              ),
            ]);
            const missingRequiredSources = (plan.requiredSources ?? []).filter(
              (source) => !representedSources.has(source),
            );
            const representedIntents = new Set(merged.items.map((item) => item.intent));
            if (merged.conflicts.length > 0) representedIntents.add("conflicts");
            const missingRequiredIntents = plan.intents.filter(
              (intent) => !representedIntents.has(intent),
            );
            const completed: DeliveryQueryResult = {
              ...merged,
              complete:
                merged.complete &&
                missingRequiredSources.length === 0 &&
                missingRequiredIntents.length === 0,
              missingRequiredSources,
              missingRequiredIntents,
            };
            return configuration.answerComposer === undefined
              ? Effect.succeed(composeAnswer(request, plan, completed))
              : composeWithModel(
                  configuration.answerComposer,
                  request,
                  plan,
                  completed,
                  compositionTimeoutMs,
                );
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
