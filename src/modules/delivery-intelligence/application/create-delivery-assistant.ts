import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type { DeliveryQueryPlan, DeliveryQuestionIntent } from "../domain/delivery-query.ts";
import { planDeliveryQuestion, validateDeliveryQueryPlan } from "../domain/delivery-query.ts";
import {
  type DeliveryResponseMode,
  type DeliveryResponseProduct,
  deliveryResponseModePolicies,
  selectDeliveryResponseMode,
  selectDeliveryResponseProduct,
} from "../domain/delivery-response-mode.ts";
import {
  buildPeriodDeliveryReport,
  type CapabilityLedger,
  type PeriodDeliveryReport,
} from "../domain/period-delivery-report.ts";
import type {
  DeliveryAnswerComposer,
  DeliveryAssistant,
  DeliveryAssistantAnswer,
  DeliveryAssistantRequest,
  DeliveryModelPlanner,
  DeliveryQueryResult,
  DeliveryQuerySource,
  DeliveryResponseAcceptance,
  DeliveryResultItem,
} from "../ports/delivery-intelligence-ports.ts";

export type DeliveryAssistantConfiguration = {
  readonly sources: readonly DeliveryQuerySource[];
  readonly modelPlanner?: DeliveryModelPlanner | undefined;
  readonly answerComposer?: DeliveryAnswerComposer | undefined;
  readonly sourceTimeoutMs?: number | undefined;
  readonly compositionTimeoutMs?: number | undefined;
  readonly totalBudgetMs?: number | undefined;
  readonly capabilityLedger?: CapabilityLedger | undefined;
  readonly now?: (() => Date) | undefined;
};

export const deliveryResponseBudget = {
  sourceTimeoutMs: deliveryResponseModePolicies.fast.sourceTimeoutMs,
  compositionTimeoutMs: deliveryResponseModePolicies.fast.compositionTimeoutMs,
  totalBudgetMs: deliveryResponseModePolicies.fast.totalBudgetMs,
} as const;

type DeliveryAnswerDraft = Omit<
  DeliveryAssistantAnswer,
  "responseMode" | "responseProduct" | "responseBudget" | "acceptance"
>;

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

const intentPresentationOrder: readonly DeliveryQuestionIntent[] = [
  "status",
  "goals",
  "commitments",
  "scope",
  "requirements",
  "delivered",
  "current_work",
  "activity",
  "ownership",
  "reviews",
  "dependencies",
  "blockers",
  "risks",
  "recurring",
  "conflicts",
  "decisions",
  "milestones",
  "capacity",
  "implementation",
  "general",
  "finance",
  "next_actions",
];

const presentedIntents = (plan: DeliveryQueryPlan): readonly DeliveryQuestionIntent[] =>
  [...plan.intents].sort(
    (left, right) => intentPresentationOrder.indexOf(left) - intentPresentationOrder.indexOf(right),
  );

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

const requestsRestrictedSecretMaterial = (question: string): boolean => {
  const normalized = question.toLowerCase().replace(/[_/]+/g, " ");
  const namesSecretMaterial =
    /\b(?:credentials?|passwords?|passphrases?|private[\s-]+keys?|api[\s-]+keys?|access[\s-]+tokens?|client[\s-]+secrets?|secrets?)\b/.test(
      normalized,
    );
  if (!namesSecretMaterial) return false;
  if (
    /\b(?:where|show|list|find|locate|give|reveal|expose|display|retrieve|provide|tell)\b/.test(
      normalized,
    )
  )
    return true;
  const discussesDeliveryWork =
    /\b(?:status|deliver(?:y|ed|able)?|rotat(?:e|ed|ing|ion)|remediat(?:e|ed|ing|ion)|incident|work[\s-]+item|ticket)\b/.test(
      normalized,
    );
  return !discussesDeliveryWork && /\b(?:what|which|stored?|exist|available)\b/.test(normalized);
};

const responseOpening = (plan: DeliveryQueryPlan): string => {
  const subject = safeText(plan.subject?.externalKey ?? plan.subject?.phrase ?? "");
  if (subject !== "") {
    const requested = presentedIntents(plan).map((intent) => intentLabel[intent].toLowerCase());
    const views =
      requested.length < 2
        ? requested[0]
        : `${requested.slice(0, -1).join(", ")} and ${requested.at(-1)}`;
    return `I checked **${subject}** for ${views}.`;
  }
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

const statusLifecyclePriority = {
  blocked: 0,
  active: 1,
  planned: 2,
  unknown: 3,
  done: 4,
  canceled: 5,
} as const;

const statusPriorityFor = (item: DeliveryResultItem): number =>
  item.lifecycleState === undefined
    ? item.source === "jira"
      ? statusLifecyclePriority.unknown
      : 6
    : statusLifecyclePriority[item.lifecycleState];

const rankedForIntent = (
  items: readonly DeliveryResultItem[],
  intent: DeliveryQuestionIntent,
): readonly DeliveryResultItem[] =>
  intent === "status"
    ? [...items].sort(
        (left, right) =>
          statusPriorityFor(left) - statusPriorityFor(right) ||
          statusSourcePriority[left.source] - statusSourcePriority[right.source] ||
          sortableTimestamp(right.observedAt) - sortableTimestamp(left.observedAt),
      )
    : items;

const sourceBalancedForIntent = (
  items: readonly DeliveryResultItem[],
  intent: DeliveryQuestionIntent,
  requiredSources: readonly DeliverySourceKind[],
  limit: number,
): readonly DeliveryResultItem[] => {
  const ranked = rankedForIntent(items, intent);
  const selected: DeliveryResultItem[] = [];
  const selectedIds = new Set<string>();
  const add = (item: DeliveryResultItem | undefined) => {
    if (item === undefined || selected.length >= limit) return;
    const identity = `${item.source}\u0000${item.id}`;
    if (selectedIds.has(identity)) return;
    selectedIds.add(identity);
    selected.push(item);
  };
  for (const source of requiredSources) add(ranked.find((item) => item.source === source));
  for (const item of ranked) add(item);
  return selected;
};

const isWeeklyCurrentWork = (plan: DeliveryQueryPlan): boolean =>
  plan.operations.some(
    (operation) =>
      operation.purpose === "current_work" && operation.time?.kind === "workspace_week",
  );

const isWeeklyDelivery = (plan: DeliveryQueryPlan): boolean =>
  plan.operations.some(
    (operation) =>
      operation.purpose === "delivered" &&
      (operation.time?.kind === "workspace_week" ||
        operation.time?.kind === "workspace_previous_week"),
  );

const ownerGroupKey = (item: DeliveryResultItem): string =>
  item.owner === undefined
    ? "unassigned"
    : item.owner.externalId === undefined
      ? `display\u0000${item.owner.displayName.toLocaleLowerCase("en")}`
      : `${item.owner.source}\u0000${item.owner.externalId}`;

const deliveredItemSummary = (item: DeliveryResultItem): string => {
  const summary = safeText(item.summary);
  const owner = item.owner?.displayName.trim();
  if (owner === undefined || owner === "") return summary;
  return summary.toLocaleLowerCase("en").includes(owner.toLocaleLowerCase("en"))
    ? summary
    : `${safeText(owner)} — ${summary}`;
};

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
  const searchable =
    `${item.title} ${item.summary} ${(item.subjectAliases ?? []).join(" ")}`.toLowerCase();
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
  responseMode: DeliveryResponseMode,
): DeliveryAnswerDraft => {
  const responsePolicy = deliveryResponseModePolicies[responseMode];
  const maximumDetailLines =
    responseMode === "fast"
      ? plan.maximumLines
      : (responsePolicy.maximumLines ?? Number.POSITIVE_INFINITY);
  const itemsPerIntent = responseMode === "fast" ? 2 : responseMode === "structured" ? 3 : 5;
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
  const missingIntents = new Set(result.missingRequiredIntents ?? []);
  let historicalStatusOnly = false;

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
    for (const intent of presentedIntents(plan)) {
      if (intent === "next_actions") continue;
      if (intent === "current_work" && isWeeklyCurrentWork(plan)) {
        const currentWork = rankedForIntent(
          items.filter((item) => item.intent === intent),
          intent,
        );
        const ownerGroups = new Map<string, DeliveryResultItem[]>();
        for (const item of currentWork) {
          const key = ownerGroupKey(item);
          ownerGroups.set(key, [...(ownerGroups.get(key) ?? []), item]);
        }
        const representatives = [...ownerGroups.values()]
          .map((group) => group[0])
          .filter((item): item is DeliveryResultItem => item !== undefined)
          .sort((left, right) => {
            if (left.owner === undefined && right.owner !== undefined) return 1;
            if (left.owner !== undefined && right.owner === undefined) return -1;
            return sortableTimestamp(right.observedAt) - sortableTimestamp(left.observedAt);
          })
          .slice(0, responsePolicy.maximumItems ?? ownerGroups.size);
        if (representatives.length > 0) {
          detailLines.push(
            `- 🚧 **Planned/active this week:** ${representatives
              .map(
                (item) =>
                  `${safeText(item.owner?.displayName ?? "Unassigned")} — ${safeText(item.title)} ${citation(item)}`,
              )
              .join(" · ")}`,
          );
          const namedOwners = [...ownerGroups.values()].filter(
            (group) => group[0]?.owner !== undefined,
          ).length;
          const unassignedItems = currentWork.filter((item) => item.owner === undefined).length;
          const omittedOwners = Math.max(0, ownerGroups.size - representatives.length);
          detailLines.push(
            `- 📊 **Coverage:** The retrieved window contains ${currentWork.length} source-backed item${currentWork.length === 1 ? "" : "s"} across ${namedOwners} named owner${namedOwners === 1 ? "" : "s"}${unassignedItems === 0 ? "" : `, with ${unassignedItems} unassigned`}; one representative per owner is shown${omittedOwners === 0 ? "" : ` and ${omittedOwners} owner${omittedOwners === 1 ? " is" : "s are"} omitted by the response cap`}.`,
          );
        } else if (missingIntents.has(intent)) {
          detailLines.push(
            `- ⚠️ **${intentLabel[intent]}:** No explicit source-backed information was found.`,
          );
        }
        continue;
      }
      if (intent === "delivered" && isWeeklyDelivery(plan)) {
        const delivered = rankedForIntent(
          items.filter((item) => item.intent === intent),
          intent,
        );
        const requestedLimit = Math.max(
          1,
          ...plan.operations
            .filter((operation) => operation.purpose === intent)
            .map((operation) => operation.limit),
        );
        const ownerRepresentatives = new Map<string, DeliveryResultItem>();
        const withoutOwner: DeliveryResultItem[] = [];
        for (const item of delivered) {
          if (item.owner === undefined) {
            withoutOwner.push(item);
            continue;
          }
          const key = ownerGroupKey(item);
          if (!ownerRepresentatives.has(key)) ownerRepresentatives.set(key, item);
        }
        const selected = sourceBalancedForIntent(
          [...ownerRepresentatives.values(), ...withoutOwner],
          intent,
          plan.requiredSources ?? [],
          Math.min(responsePolicy.maximumItems ?? requestedLimit, requestedLimit),
        );
        if (selected.length > 0) {
          detailLines.push(
            `- ✅ **Delivered:** ${selected
              .map((item) => `${deliveredItemSummary(item)} ${citation(item)}`)
              .join(" · ")}`,
          );
          const sourceCounts = [...new Set(delivered.map((item) => item.source))].map(
            (source) =>
              `${sourceLabel[source]} ${delivered.filter((item) => item.source === source).length}`,
          );
          const namedOwners = ownerRepresentatives.size;
          const omitted = Math.max(0, delivered.length - selected.length);
          detailLines.push(
            `- 📊 **Coverage:** The retrieved window contains ${delivered.length} source-backed delivered item${delivered.length === 1 ? "" : "s"} across ${sourceCounts.join(", ")}${namedOwners === 0 ? "" : ` and ${namedOwners} named owner${namedOwners === 1 ? "" : "s"}`}; ${selected.length} representative item${selected.length === 1 ? " is" : "s are"} shown${omitted === 0 ? "" : ` and ${omitted} item${omitted === 1 ? " is" : "s are"} omitted by the response cap`}.`,
          );
        } else if (missingIntents.has(intent)) {
          detailLines.push(
            `- ⚠️ **${intentLabel[intent]}:** No explicit source-backed information was found.`,
          );
        }
        continue;
      }
      const selected = sourceBalancedForIntent(
        items.filter((item) => item.intent === intent),
        intent,
        plan.requiredSources ?? [],
        itemsPerIntent,
      );
      if (selected.length > 0) {
        historicalStatusOnly =
          intent === "status" &&
          selected.every(
            (item) => item.lifecycleState === "done" || item.lifecycleState === "canceled",
          );
        const label = historicalStatusOnly
          ? `${intentLabel[intent]} — historical only`
          : intentLabel[intent];
        detailLines.push(
          `- ${intentIcon[intent]} **${label}:** ${selected.map((item) => `${item.evidenceRole === "declared_intent" ? "Declared intent — " : ""}${safeText(item.summary)} ${citation(item)}`).join(" · ")}`,
        );
      } else if (missingIntents.has(intent)) {
        detailLines.push(
          `- ⚠️ **${intentLabel[intent]}:** No explicit source-backed information was found.`,
        );
      }
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
        if (detailLines.length >= maximumDetailLines)
          detailLines.splice(Math.max(0, maximumDetailLines - 1));
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
        !result.complete ||
        result.unavailableSources.length > 0 ||
        (result.missingRequiredSources?.length ?? 0) > 0
          ? "partial"
          : "empty",
      plan,
      unavailableSources: result.unavailableSources,
      conflicts,
      missingRequiredSources: result.missingRequiredSources,
      missingRequiredIntents: result.missingRequiredIntents,
      periodCensus: result.periodCensus,
      mentions: [],
    };
  }
  if (result.unavailableSources.length > 0 && detailLines.length < maximumDetailLines)
    detailLines.push(
      `- ⚠️ **Coverage:** ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")} unavailable.`,
    );
  if ((result.missingRequiredSources?.length ?? 0) > 0 && detailLines.length < maximumDetailLines)
    detailLines.push(
      `- ⚠️ **Coverage:** No matching ${result.missingRequiredSources?.map((source) => sourceLabel[source]).join(", ")} result was available.`,
    );
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
  const completeActionLine =
    actionLine ??
    (plan.intents.includes("next_actions")
      ? "1. ➡️ **Next:** No explicit source-backed next action was found."
      : undefined);
  const lines = [
    responseOpening(plan),
    ...detailLines.slice(0, maximumDetailLines),
    ...(completeActionLine === undefined ? [] : [completeActionLine]),
  ];
  const text = lines.join("\n");
  return {
    text,
    citations: citations.filter(({ url }) => text.includes(url)),
    status:
      !result.complete || (result.missingRequiredSources?.length ?? 0) > 0
        ? "partial"
        : missingIntents.size > 0 || historicalStatusOnly
          ? "partial"
          : items.length === 0
            ? "empty"
            : "ok",
    plan,
    unavailableSources: result.unavailableSources,
    conflicts,
    missingRequiredSources: result.missingRequiredSources,
    missingRequiredIntents: result.missingRequiredIntents,
    periodCensus: result.periodCensus,
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
  responseMode: DeliveryResponseMode,
  responseProduct: DeliveryResponseProduct,
  responseBudget: {
    readonly sourceTimeoutMs: number;
    readonly compositionTimeoutMs: number;
    readonly totalBudgetMs: number;
  },
): Effect.Effect<DeliveryAnswerDraft> => {
  const deterministic = composeAnswer(request, plan, result, responseMode);
  if (responseMode !== "fast") return Effect.succeed(deterministic);
  const items = rankedForIntent(uniqueRanked(result.items), plan.intents[0] ?? "general").slice(
    0,
    deliveryResponseModePolicies[responseMode].maximumItems,
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
      responseProduct,
      responseMode,
      responseBudget,
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
            if (
              lines.length < 3 ||
              lines.length >
                (deliveryResponseModePolicies[responseMode].maximumLines ??
                  Number.POSITIVE_INFINITY) +
                  2
            )
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

const responseSources = (
  answer: DeliveryAnswerDraft,
  result: DeliveryQueryResult,
): readonly DeliverySourceKind[] => [
  ...new Set(
    result.items
      .filter((item) => answer.text.includes(item.citationUrl))
      .map((item) => item.source),
  ),
];

const latestTimestamp = (values: readonly (string | undefined)[]): string | undefined =>
  values
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

const localDateParts = (
  value: string,
  timeZone: string,
): { readonly year: number; readonly month: number; readonly day: number } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day"): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day") };
};

const reportPeriodTitle = (report: PeriodDeliveryReport): string => {
  if (report.census.boundary.kind !== "absolute") return "Delivery report";
  const start = localDateParts(report.census.boundary.fromInclusive, report.census.timeZone);
  const end = localDateParts(report.census.boundary.toExclusive, report.census.timeZone);
  const quarter =
    start.day === 1 &&
    [1, 4, 7, 10].includes(start.month) &&
    end.day === 1 &&
    end.month === ((start.month + 2) % 12) + 1
      ? Math.floor((start.month - 1) / 3) + 1
      : undefined;
  return quarter === undefined ? "Delivery report" : `Q${quarter} ${start.year} delivery report`;
};

const reportPeriodLabel = (report: PeriodDeliveryReport): string => {
  if (report.census.boundary.kind !== "absolute")
    return `${report.census.boundary.reference} (${report.census.timeZone})`;
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: report.census.timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const endExclusive = new Date(Date.parse(report.census.boundary.toExclusive) - 1);
  return `${format.format(new Date(report.census.boundary.fromInclusive))} – ${format.format(endExclusive)} (${report.census.timeZone})`;
};

const renderLeadershipReport = (
  answer: DeliveryAnswerDraft,
  report: PeriodDeliveryReport,
  result: DeliveryQueryResult,
  _elapsedMs: number,
): DeliveryAnswerDraft => {
  const citationLabels = new Map<string, string>();
  const citations: { label: string; url: string }[] = [];
  const citation = (source: DeliverySourceKind, url: string): string => {
    const existing = citationLabels.get(url);
    if (existing !== undefined) return `[${existing}](${url})`;
    const label = `${sourceLabel[source]} ${citations.length + 1}`;
    citationLabels.set(url, label);
    citations.push({ label, url });
    return `[${label}](${url})`;
  };
  const cleanHeadline = (value: string): string =>
    safeText(value)
      .replace(/^PR #\d+:\s*/i, "")
      .replace(/^\/?[A-Z][A-Z0-9]+-\d+\s*[:—-]?\s*/i, "")
      .replace(/^(?:feat|fix|chore|docs|refactor|build|ci|test)(?:\([^)]+\))?\s*:\s*/i, "")
      .replace(/^(?:feature|fix)[/-]/i, "")
      .trim();
  const capsuleLine = (capsule: PeriodDeliveryReport["capsules"][number]): string => {
    const links = capsule.citations
      .slice(0, 2)
      .map(({ source, url }) => citation(source, url))
      .join(" ");
    const title = cleanHeadline(capsule.title);
    const summary = cleanHeadline(capsule.summary);
    const detail =
      summary === "" || summary.toLocaleLowerCase("en") === title.toLocaleLowerCase("en")
        ? `${capsule.completionStage} evidence`
        : `${summary}; ${capsule.completionStage} evidence`;
    return `- **${title}** — ${detail}. ${links}`;
  };
  const presentationScore = (capsule: PeriodDeliveryReport["capsules"][number]): number =>
    (/\b[A-Z][A-Z0-9]+-\d+\b/.test(capsule.id) ? 10_000 : 0) +
    capsule.citations.length * 100 +
    (capsule.completionStage === "deployed" ? 20 : capsule.completionStage === "released" ? 10 : 0);
  const reportFailure = (reasons: readonly string[], status: "partial" | "empty") => ({
    ...answer,
    text: [
      `## ${reportPeriodTitle(report)}`,
      `**Period:** ${reportPeriodLabel(report)}`,
      "### Report unavailable",
      "Sarathi could not produce a reliable leadership report from the authorized indexed corpus.",
      ...reasons.map((reason) => `- ${reason}`),
      "No delivery conclusion was generated from incomplete or insufficient evidence.",
    ].join("\n"),
    citations: [],
    status,
    periodDeliveryReport: report,
  });
  if (!report.census.complete || result.unavailableSources.length > 0)
    return reportFailure(
      [
        ...(!report.census.complete
          ? [
              `The authorized period census is partial after ${report.census.pagination.pagesRead} page(s); omissions cannot be interpreted as no delivery.`,
            ]
          : []),
        ...(result.unavailableSources.length === 0
          ? []
          : [
              `Required source coverage is unavailable: ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")}.`,
            ]),
      ],
      "partial",
    );
  if (report.capsules.length === 0)
    return reportFailure(
      [
        `The complete census examined ${report.census.examinedCandidateCount} authorized records but found no change with qualifying merged, released, or deployed evidence in the requested period.`,
      ],
      "empty",
    );
  const rankedSections = report.capabilitySections.map((section) => ({
    ...section,
    capsules: section.capsules.toSorted(
      (left, right) =>
        presentationScore(right) - presentationScore(left) ||
        Date.parse(right.completedAt) - Date.parse(left.completedAt),
    ),
  }));
  const selectedByCapability = new Map<string, PeriodDeliveryReport["capsules"][number][]>(
    rankedSections.map((section) => [section.key, []]),
  );
  const teamsReportCharacterBudget = 18_000;
  let selectedCharacters = 0;
  const maximumSectionDepth = Math.max(...rankedSections.map(({ capsules }) => capsules.length));
  for (let depth = 0; depth < maximumSectionDepth; depth += 1) {
    for (const section of rankedSections) {
      const capsule = section.capsules[depth];
      if (capsule === undefined) continue;
      const line = capsuleLine(capsule);
      if (selectedCharacters + line.length > teamsReportCharacterBudget) continue;
      selectedByCapability.get(section.key)?.push(capsule);
      selectedCharacters += line.length;
    }
  }
  const sectionLines = rankedSections.flatMap((section, index) => {
    const shown = selectedByCapability.get(section.key) ?? [];
    const omitted = section.capsules.length - shown.length;
    return [
      `### ${index + 1}. ${safeText(section.title)}`,
      `${section.capsules.length} source-supported change${section.capsules.length === 1 ? " was" : "s were"} completed in this capability during the quarter.`,
      ...shown.map(capsuleLine),
      ...(omitted === 0
        ? []
        : [
            `- ${omitted} additional change${omitted === 1 ? " is" : "s are"} retained in the accepted census but omitted only because the Teams message reached its platform-safe presentation budget.`,
          ]),
      "",
    ];
  });
  const sources = [...new Set(report.capsules.flatMap(({ sources: values }) => values))];
  const sourceCoverage = report.census.sourceCoverage
    .map(
      ({ source, available, candidateCount }) =>
        `${sourceLabel[source]} ${available ? `${candidateCount} accepted` : "unavailable"}`,
    )
    .join("; ");
  const text = [
    `## ${reportPeriodTitle(report)}`,
    `**Period:** ${reportPeriodLabel(report)}`,
    "### Executive summary",
    `The quarter’s authorized evidence resolves into ${report.capsules.length} completed delivery change${report.capsules.length === 1 ? "" : "s"} across ${report.capabilitySections.length} reviewed themes: ${report.capabilitySections.map(({ title }) => title).join("; ")}. The report below retains initiative-level evidence and citations instead of substituting a small top-ranked result set.`,
    ...(sectionLines.length === 0
      ? ["- No accepted change could be mapped to a declared capability."]
      : sectionLines),
    "### Outcomes and delivery confidence",
    `- **Observed delivery:** ${report.capsules.length} change${report.capsules.length === 1 ? "" : "s"} reached a merged, released, or deployed stage in the requested period.`,
    "- **Business impact:** Not established by the indexed completion evidence. The report does not convert technical delivery into customer or commercial impact.",
    "### Gaps and incomplete delivery chains",
    `- ${report.incompleteChainCount} change${report.incompleteChainCount === 1 ? "" : "s"} have no separately observed later-stage evidence such as release, deployment, acceptance, or impact.`,
    `- ${report.unmappedCapsules.length} accepted change${report.unmappedCapsules.length === 1 ? "" : "s"} remain${report.unmappedCapsules.length === 1 ? "s" : ""} outside the reviewed capability ledger; they are counted in coverage but intentionally omitted from the executive highlights.`,
    ...(result.unavailableSources.length === 0
      ? []
      : [
          `- Unavailable sources: ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")}. The report is partial.`,
        ]),
    "### Coverage and freshness",
    `- Census examined ${report.census.examinedCandidateCount} authorized records across ${report.census.pagination.pagesRead} page(s), accepted ${report.census.candidateCount}, collapsed ${report.census.duplicateCandidateCount} duplicate(s), and excluded ${report.census.excludedCandidateCount}.`,
    `- Capability mapping: ${report.capsules.length - report.unmappedCapsules.length}/${report.capsules.length} accepted change capsules map to a reviewed primary theme; unmapped capsules remain visible as a coverage gap.`,
    `- Source coverage: ${sourceCoverage || "No configured source coverage was reported"}.`,
    `- Census status: ${report.census.complete ? "complete within the declared source and time bounds" : "partial; do not treat omissions as no activity"}. Contributing evidence sources: ${sources.length === 0 ? "none" : sources.map((source) => sourceLabel[source]).join(", ")}.`,
    "### Method and inference boundary",
    "- The report is reconstructed from authorized indexed evidence, deduplicated into change groups, assigned to one primary reviewed capability, and then ranked for presentation. Unsupported outcomes and missing stages remain unknown.",
  ].join("\n");
  return {
    ...answer,
    text,
    citations,
    status:
      !report.census.complete || result.unavailableSources.length > 0
        ? "partial"
        : report.capsules.length === 0
          ? "empty"
          : "ok",
    periodDeliveryReport: report,
  };
};

const renderResponseMode = (
  answer: DeliveryAnswerDraft,
  _request: DeliveryAssistantRequest,
  result: DeliveryQueryResult,
  responseMode: DeliveryResponseMode,
  responseProduct: DeliveryResponseProduct,
  _elapsedMs: number,
): DeliveryAnswerDraft => {
  if (responseMode === "fast") return answer;
  if (responseProduct === "leadership_report" && result.periodDeliveryReport !== undefined)
    return renderLeadershipReport(answer, result.periodDeliveryReport, result, _elapsedMs);
  if (responseProduct === "leadership_report")
    return {
      ...answer,
      text: [
        "## Leadership report unavailable",
        "Sarathi could not produce a reliable report from the authorized indexed corpus.",
        "- The exhaustive period census or reviewed capability projection did not complete.",
        ...(result.unavailableSources.length === 0
          ? []
          : [
              `- Unavailable source coverage: ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")}.`,
            ]),
        ...(result.missingRequiredSources?.length === 0 ||
        result.missingRequiredSources === undefined
          ? []
          : [
              `- Required evidence was not found from: ${result.missingRequiredSources.map((source) => sourceLabel[source]).join(", ")}.`,
            ]),
        "- No delivery conclusion was generated from the incomplete evidence population.",
      ].join("\n"),
      citations: [],
      status: "partial",
    };
  const lines = answer.text.split(/\r?\n/).filter(Boolean);
  const opening =
    lines.find((line) => !/^(?:-|\d+\.)\s/.test(line)) ?? responseOpening(answer.plan);
  const evidence = lines.filter((line) => line.startsWith("- "));
  const action = lines.find((line) => /^\d+\.\s/.test(line));
  if (responseMode === "structured") {
    const alignmentReview =
      answer.plan.intents.includes("goals") && answer.plan.intents.includes("current_work");
    const alignmentRelations = result.items.filter(
      (item) => item.intent === "goals" && item.selector === "relations",
    ).length;
    const text = [
      "### Delivery brief",
      opening,
      "### Evidence",
      ...(evidence.length === 0
        ? ["- No source-backed evidence matched the requested scope."]
        : evidence),
      ...(alignmentReview
        ? [
            "### Alignment gaps",
            `${alignmentRelations} source-backed alignment relation(s) were retrieved. This is evidence coverage, not a completion percentage; missing source links remain unknown.`,
          ]
        : []),
      ...(result.periodCensus === undefined
        ? []
        : [
            "### Coverage",
            `Examined ${result.periodCensus.examinedCandidateCount} authorized period records across ${result.periodCensus.pagination.pagesRead} page(s); accepted ${result.periodCensus.candidateCount}, collapsed ${result.periodCensus.duplicateCandidateCount} duplicate(s), excluded ${result.periodCensus.excludedCandidateCount}, and left ${result.periodCensus.unmappedCandidateCount} unmapped. Census ${result.periodCensus.complete ? "complete" : "partial"}.`,
          ]),
      ...(action === undefined ? [] : ["### Action", action]),
    ].join("\n");
    return { ...answer, text, citations: answer.citations.filter(({ url }) => text.includes(url)) };
  }
  const sources = responseSources(answer, result);
  const latestSourceUpdate = latestTimestamp(
    result.items
      .filter((item) => answer.text.includes(item.citationUrl))
      .map((item) => item.sourceUpdatedAt ?? item.observedAt),
  );
  const gaps = [
    ...(result.missingRequiredIntents ?? []).map((intent) => intentLabel[intent]),
    ...(result.missingRequiredSources ?? []).map((source) => sourceLabel[source]),
    ...result.unavailableSources.map((source) => `${sourceLabel[source]} unavailable`),
  ];
  const censusCoverage =
    result.periodCensus === undefined
      ? undefined
      : `Period census examined ${result.periodCensus.examinedCandidateCount} authorized records across ${result.periodCensus.pagination.pagesRead} page(s), accepted ${result.periodCensus.candidateCount}, collapsed ${result.periodCensus.duplicateCandidateCount} duplicate(s), excluded ${result.periodCensus.excludedCandidateCount}, and left ${result.periodCensus.unmappedCandidateCount} unmapped. Census ${result.periodCensus.complete ? "complete" : "partial"}.`;
  const text = [
    "### Scope and time window",
    opening,
    "### Sources and freshness",
    sources.length === 0
      ? "No matching connected source produced authorized evidence."
      : `${sources.map((source) => sourceLabel[source]).join(", ")} contributed evidence. Latest source update: ${latestSourceUpdate ?? "not reported"}.`,
    ...(censusCoverage === undefined ? [] : ["### Coverage", censusCoverage]),
    "### Evidence",
    ...(evidence.length === 0
      ? ["- No source-backed evidence matched the requested scope."]
      : evidence),
    "### Conflicts and gaps",
    answer.conflicts.length === 0
      ? `No verified cross-source conflict was found. Gaps: ${gaps.length === 0 ? "none reported" : gaps.join(", ")}.`
      : `${answer.conflicts.length} verified cross-source conflict(s) are disclosed above. Gaps: ${gaps.length === 0 ? "none reported" : gaps.join(", ")}.`,
    "### Inference boundary",
    "The evidence above is source-observed. Missing fields remain unknown; no uncited recommendation or ownership inference was added.",
    ...(action === undefined ? [] : ["### Action", action]),
  ].join("\n");
  return { ...answer, text, citations: answer.citations.filter(({ url }) => text.includes(url)) };
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));

const responseAcceptance = (
  answer: DeliveryAnswerDraft,
  request: DeliveryAssistantRequest,
  result: DeliveryQueryResult,
  responseMode: DeliveryResponseMode,
  responseProduct: DeliveryResponseProduct,
  elapsedMs: number,
): DeliveryResponseAcceptance => {
  const policy = deliveryResponseModePolicies[responseMode];
  const missingIntents = new Set(result.missingRequiredIntents ?? []);
  const requestedIntents = answer.plan.intents.length;
  const emittedIntents = new Set(
    result.items
      .filter((item) => answer.text.includes(item.citationUrl))
      .map((item) => item.intent),
  );
  if (
    result.conflicts.some((conflict) =>
      conflict.claims.some((claim) => answer.text.includes(claim.source.citationUrl)),
    )
  )
    emittedIntents.add("conflicts");
  const coveredIntents = answer.plan.intents.filter(
    (intent) => !missingIntents.has(intent) && emittedIntents.has(intent),
  ).length;
  const completenessRatio = ratio(coveredIntents, requestedIntents);
  const lines = answer.text.split(/\r?\n/).map((line) => line.trim());
  const materialLines =
    responseProduct === "leadership_report"
      ? lines.filter((line) => /^- \*\*.+\*\* —/.test(line))
      : lines.filter(
          (line) =>
            /^(?:-|\d+\.)\s/.test(line) &&
            !line.includes("**Coverage:**") &&
            !line.includes("No explicit source-backed") &&
            !line.includes("No source-backed evidence"),
        );
  const citedLines = materialLines.filter((line) => /\]\(https:\/\//.test(line));
  const allowedUrls = new Set([
    ...result.items.map((item) => item.citationUrl),
    ...result.conflicts.flatMap((conflict) =>
      conflict.claims.map((claim) => claim.source.citationUrl),
    ),
  ]);
  const linkedUrls = [...answer.text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  const evaluatedItems = result.items.filter((item) => answer.text.includes(item.citationUrl));
  const requestedAt = Date.parse(request.requestedAt);
  const freshEvidence = evaluatedItems.filter((item) => {
    if (item.indexedAt === undefined) return true;
    const indexedAt = Date.parse(item.indexedAt);
    return (
      Number.isFinite(indexedAt) && Math.max(0, requestedAt - indexedAt) <= policy.freshnessWindowMs
    );
  }).length;
  const citationCoverage = ratio(citedLines.length, materialLines.length);
  const freshnessCoverage = ratio(freshEvidence, evaluatedItems.length);
  const completenessPassed =
    result.complete &&
    completenessRatio === 1 &&
    (result.missingRequiredSources?.length ?? 0) === 0;
  const citationPassed = citationCoverage === 1;
  const groundingPassed = linkedUrls.every((url) => allowedUrls.has(url));
  const freshnessPassed = freshnessCoverage >= 0.95;
  const headings = new Set(lines.filter((line) => line.startsWith("### ")));
  const formatPassed =
    responseMode === "fast"
      ? headings.size === 0 && lines.length <= (policy.maximumLines ?? 5) + 2
      : responseMode === "structured"
        ? headings.has("### Delivery brief") && headings.has("### Evidence")
        : responseProduct === "leadership_report"
          ? [
              "### Executive summary",
              "### Outcomes and delivery confidence",
              "### Gaps and incomplete delivery chains",
              "### Coverage and freshness",
              "### Method and inference boundary",
            ].every((heading) => headings.has(heading))
          : [
              "### Scope and time window",
              "### Sources and freshness",
              "### Evidence",
              "### Conflicts and gaps",
              "### Inference boundary",
            ].every((heading) => headings.has(heading));
  const latencyPassed = policy.latencyTargetMs === undefined || elapsedMs <= policy.latencyTargetMs;
  return {
    mode: responseMode,
    product: responseProduct,
    elapsedMs,
    ...(policy.latencyTargetMs === undefined ? {} : { latencyTargetMs: policy.latencyTargetMs }),
    latencyPassed,
    requestedIntents,
    coveredIntents,
    completenessRatio,
    completenessPassed,
    materialStatements: materialLines.length,
    citedStatements: citedLines.length,
    citationCoverage,
    citationPassed,
    groundingPassed,
    freshEvidence,
    evaluatedEvidence: evaluatedItems.length,
    freshnessCoverage,
    freshnessPassed,
    formatPassed,
    passed:
      latencyPassed &&
      completenessPassed &&
      citationPassed &&
      groundingPassed &&
      freshnessPassed &&
      formatPassed,
  };
};

const planQuestion = (
  request: DeliveryAssistantRequest,
  planner: DeliveryModelPlanner | undefined,
): Effect.Effect<DeliveryQueryPlan, RepositoryError> => {
  const contextualize = (plan: DeliveryQueryPlan): DeliveryQueryPlan => {
    if (plan.subject !== undefined || request.questionContext === undefined) return plan;
    const contextDependent = /\b(?:it|its|this|that|these|those|they|them|their)\b/i.test(
      request.question,
    );
    if (!contextDependent) return plan;
    const subject = request.questionContext.evidence
      .filter(
        (record) =>
          record.source === "teams" &&
          record.contextRole === "conversation" &&
          record.sourceId !== request.questionContext?.currentMessageId,
      )
      .toSorted((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
      .map((record) => planDeliveryQuestion(record.excerpt)?.subject)
      .find((candidate) => candidate !== undefined);
    return subject === undefined ? plan : { ...plan, subject };
  };
  if (request.plan !== undefined)
    return Effect.try({
      try: () => contextualize(validateDeliveryQueryPlan(request.plan)),
      catch: () =>
        new RepositoryError({
          message: "The delivery question produced an invalid bounded query plan.",
          operation: "delivery-plan-validation",
        }),
    });
  const deterministic = planDeliveryQuestion(request.question);
  if (deterministic !== undefined) return Effect.succeed(contextualize(deterministic));
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
            try: () => contextualize(validateDeliveryQueryPlan(planned)),
            catch: () =>
              new RepositoryError({
                message: "The model proposed an invalid delivery query plan.",
                operation: "delivery-model-plan-validation",
              }),
          }),
    ),
  );
};

const planForResponseMode = (
  plan: DeliveryQueryPlan,
  responseMode: DeliveryResponseMode,
): DeliveryQueryPlan => {
  if (responseMode === "fast") return plan;
  const minimumLimit = responseMode === "structured" ? 15 : 50;
  return {
    ...plan,
    operations: plan.operations.map((operation) => ({
      ...operation,
      limit:
        operation.select === "period_census"
          ? operation.limit
          : Math.min(50, Math.max(operation.limit, minimumLimit)),
    })),
  };
};

export const createDeliveryAssistant = (
  configuration: DeliveryAssistantConfiguration,
): DeliveryAssistant => ({
  answer: (request) => {
    const startedAt = Date.now();
    const responseProduct = selectDeliveryResponseProduct(
      request.question,
      request.responseProduct,
    );
    const responseMode = selectDeliveryResponseMode(
      request.question,
      request.responseMode,
      responseProduct,
    );
    const responsePolicy = deliveryResponseModePolicies[responseMode];
    if (responseProduct === "leadership_report" && configuration.capabilityLedger === undefined)
      return Effect.fail(
        new RepositoryError({
          message:
            "Leadership reporting requires a reviewed capability ledger; no report was generated.",
          operation: "delivery-leadership-report-configuration",
        }),
      );
    if (requestsRestrictedSecretMaterial(request.question))
      return Effect.fail(
        new RepositoryError({
          message: "Credential and secret material is excluded from delivery-assistant answers.",
          operation: "delivery-restricted-content-authorization",
        }),
      );
    return planQuestion(request, configuration.modelPlanner).pipe(
      Effect.flatMap((planned) => {
        const plan = planForResponseMode(planned, responseMode);
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
          Math.min(
            responseMode === "fast"
              ? (configuration.totalBudgetMs ?? responsePolicy.totalBudgetMs)
              : responsePolicy.totalBudgetMs,
            responsePolicy.totalBudgetMs,
          ),
        );
        const sourceTimeoutMs = Math.max(
          100,
          Math.min(
            responseMode === "fast"
              ? (configuration.sourceTimeoutMs ?? responsePolicy.sourceTimeoutMs)
              : responsePolicy.sourceTimeoutMs,
            totalBudgetMs,
          ),
        );
        const compositionTimeoutMs = Math.max(
          100,
          Math.min(
            responseMode === "fast"
              ? (configuration.compositionTimeoutMs ?? responsePolicy.compositionTimeoutMs)
              : responsePolicy.compositionTimeoutMs,
            totalBudgetMs,
          ),
        );
        const responseBudget = {
          sourceTimeoutMs,
          compositionTimeoutMs,
          totalBudgetMs,
        } as const;
        const selectors = new Set(plan.operations.map((operation) => operation.select));
        const sources = configuration.sources.filter((source) =>
          source.selectors.some((selector) => selectors.has(selector)),
        );
        const context = {
          workspaceId: request.workspaceId,
          actorId: request.actorId,
          audienceIds: request.audienceIds,
          maximumSensitivity: request.maximumSensitivity,
          financeAccess: request.financeAccess,
          requestedAt: request.requestedAt,
          timeZone: request.timeZone,
          deadlineAt: new Date(now.getTime() + totalBudgetMs).toISOString(),
          question: request.question,
          responseProduct,
          responseMode,
          totalBudgetMs,
          sourceTimeoutMs,
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
                if (source.source === "intent") return [] as const;
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
              complete: successful.every(
                (result) =>
                  result.complete ||
                  (result.periodCensus === undefined && result.unavailableSources.length > 0),
              ),
              periodCensus: successful.find((result) => result.periodCensus !== undefined)
                ?.periodCensus,
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
            const periodDeliveryReport =
              responseProduct === "leadership_report" &&
              merged.periodCensus !== undefined &&
              configuration.capabilityLedger !== undefined
                ? buildPeriodDeliveryReport({
                    census: merged.periodCensus,
                    items: merged.items,
                    capabilityLedger: configuration.capabilityLedger,
                  })
                : undefined;
            const reportMissingDelivery =
              responseProduct === "leadership_report" &&
              plan.intents.includes("delivered") &&
              (periodDeliveryReport === undefined || periodDeliveryReport.capsules.length === 0);
            const completed: DeliveryQueryResult = {
              ...merged,
              complete:
                merged.complete && missingRequiredSources.length === 0 && !reportMissingDelivery,
              missingRequiredSources,
              missingRequiredIntents: [
                ...new Set([
                  ...missingRequiredIntents,
                  ...(reportMissingDelivery ? (["delivered"] as const) : []),
                ]),
              ],
              ...(periodDeliveryReport === undefined ? {} : { periodDeliveryReport }),
            };
            const remainingCompositionBudgetMs = totalBudgetMs - (Date.now() - startedAt) - 100;
            const composed =
              configuration.answerComposer === undefined || remainingCompositionBudgetMs <= 0
                ? Effect.succeed(composeAnswer(request, plan, completed, responseMode))
                : composeWithModel(
                    configuration.answerComposer,
                    request,
                    plan,
                    completed,
                    Math.min(compositionTimeoutMs, remainingCompositionBudgetMs),
                    responseMode,
                    responseProduct,
                    responseBudget,
                  );
            return composed.pipe(
              Effect.map((draft) => {
                const elapsedMs = Math.max(0, Date.now() - startedAt);
                const rendered = renderResponseMode(
                  draft,
                  request,
                  completed,
                  responseMode,
                  responseProduct,
                  elapsedMs,
                );
                return {
                  ...rendered,
                  responseMode,
                  responseProduct,
                  responseBudget,
                  acceptance: responseAcceptance(
                    rendered,
                    request,
                    completed,
                    responseMode,
                    responseProduct,
                    elapsedMs,
                  ),
                };
              }),
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
    );
  },
});
