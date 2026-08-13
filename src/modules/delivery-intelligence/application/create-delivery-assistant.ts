import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { stableSha256 } from "../../../domain/hash.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type { ProductCompletionResolution } from "../../product-model/index.ts";
import type { DeliveryConflict, DeliverySourceKind } from "../domain/delivery-model.ts";
import type {
  DeliveryQueryOperation,
  DeliveryQueryPlan,
  DeliveryQuestionIntent,
} from "../domain/delivery-query.ts";
import {
  namedCompletionQuestionSubject,
  planDeliveryQuestion,
  validateDeliveryQueryPlan,
} from "../domain/delivery-query.ts";
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
  DeliveryCompletionAssessment,
  DeliveryModelPlanner,
  DeliveryQueryResult,
  DeliveryQuerySource,
  DeliveryResponseAcceptance,
  DeliveryResultItem,
} from "../ports/delivery-intelligence-ports.ts";
import { reconcileProductCompletion } from "./reconcile-product-completion.ts";

export type DeliveryAssistantConfiguration = {
  readonly sources: readonly DeliveryQuerySource[];
  readonly modelPlanner?: DeliveryModelPlanner | undefined;
  readonly answerComposer?: DeliveryAnswerComposer | undefined;
  readonly sourceTimeoutMs?: number | undefined;
  readonly compositionTimeoutMs?: number | undefined;
  readonly totalBudgetMs?: number | undefined;
  readonly capabilityLedger?: CapabilityLedger | undefined;
  readonly completionResolution?: ProductCompletionResolution | undefined;
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

type ReportFailure = Extract<
  NonNullable<DeliveryAssistantAnswer["failure"]>,
  { readonly code: "SARATHI-REPORT-COMPOSITION-FAILED" }
>;
type ReportFailureClassification = ReportFailure["classification"];
type ReportFailureDiagnosticCode = NonNullable<ReportFailure["diagnosticCode"]>;
type AnswerFailure = Extract<
  NonNullable<DeliveryAssistantAnswer["failure"]>,
  { readonly code: "SARATHI-ANSWER-COMPOSITION-FAILED" }
>;
type AnswerFailureClassification = AnswerFailure["classification"];
type AnswerFailureDiagnosticCode = NonNullable<AnswerFailure["diagnosticCode"]>;

const reportFailureDraft = (
  plan: DeliveryQueryPlan,
  classification: ReportFailureClassification,
  diagnosticCode: ReportFailureDiagnosticCode,
): DeliveryAnswerDraft => {
  const correlationCode = `SAR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    text: [
      "Response composition failed.",
      "",
      "Error code: SARATHI-REPORT-COMPOSITION-FAILED",
      `Correlation code: ${correlationCode}`,
      "Please retry the request.",
    ].join("\n"),
    citations: [],
    status: "failed",
    plan,
    unavailableSources: [],
    conflicts: [],
    mentions: [],
    failure: {
      code: "SARATHI-REPORT-COMPOSITION-FAILED",
      classification,
      diagnosticCode,
      correlationCode,
    },
  };
};

const answerFailureDraft = (
  plan: DeliveryQueryPlan,
  classification: AnswerFailureClassification,
  diagnosticCode: AnswerFailureDiagnosticCode,
): DeliveryAnswerDraft => {
  const correlationCode = `SAR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    text: [
      "Response composition failed.",
      "",
      "Error code: SARATHI-ANSWER-COMPOSITION-FAILED",
      `Correlation code: ${correlationCode}`,
      "Please retry the request.",
    ].join("\n"),
    citations: [],
    status: "failed",
    plan,
    unavailableSources: [],
    conflicts: [],
    mentions: [],
    failure: {
      code: "SARATHI-ANSWER-COMPOSITION-FAILED",
      classification,
      diagnosticCode,
      correlationCode,
    },
  };
};

const requiredCompletionVerdict = (
  assessment: DeliveryCompletionAssessment,
): "yes" | "no" | "cannot_verify" =>
  assessment.disposition === "complete"
    ? "yes"
    : assessment.disposition === "incomplete"
      ? "no"
      : "cannot_verify";

const renderedCompletionVerdict = (text: string): "yes" | "no" | "cannot_verify" | undefined =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("- "))
    ?.slice(2)
    .replaceAll("*", "")
    .match(/^(yes|no|cannot verify)\b/i)?.[1]
    ?.toLowerCase()
    .replace(" ", "_") as "yes" | "no" | "cannot_verify" | undefined;

const validatesCompletionSemantics = (
  text: string,
  assessment: DeliveryCompletionAssessment,
): boolean => {
  const normalizedText = text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ");
  const includes = (value: string): boolean =>
    normalizedText.includes(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    );
  return (
    renderedCompletionVerdict(text) === requiredCompletionVerdict(assessment) &&
    (!("affectedEntities" in assessment.subject) ||
      assessment.subject.affectedEntities.every(({ canonicalName }) => includes(canonicalName))) &&
    assessment.criteria.every(({ title }) => includes(title)) &&
    (assessment.conflicts.length === 0 || includes("conflict")) &&
    (assessment.excludedObservations.length === 0 ||
      includes("excluded") ||
      includes("not attributable") ||
      includes("outside"))
  );
};

const invalidReport = (operation: ReportFailureDiagnosticCode): never => {
  throw new RepositoryError({
    message: "Delivery report composition was invalid.",
    operation,
  });
};

const renderSprintIdentity = (
  text: string,
  review: NonNullable<PeriodDeliveryReport["sprintReview"]>,
  timeZone: string,
): string => {
  const previous = review.previousSprint;
  const current = review.currentSprint;
  if (
    previous?.startAt === undefined ||
    previous.endAt === undefined ||
    current?.startAt === undefined ||
    current.endAt === undefined
  )
    return text;
  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  const lines = text.split(/\r?\n/);
  const overviewAt = lines.findIndex((line) => line.trim() === "## Sprint overview");
  if (overviewAt < 0) return text;
  const nextHeadingAt = lines.findIndex(
    (line, index) => index > overviewAt && line.trim().startsWith("## "),
  );
  const overviewEnd = nextHeadingAt < 0 ? lines.length : nextHeadingAt;
  const narrative = lines
    .slice(overviewAt + 1, overviewEnd)
    .filter((line) => !line.includes(previous.name) && !line.includes(current.name));
  const identities = [
    `- **Previous sprint — ${safeText(previous.name).replace(/[*_`[\]<>]/g, "")}:** ${formatDate(previous.startAt)} to ${formatDate(previous.endAt)}.`,
    `- **Current sprint — ${safeText(current.name).replace(/[*_`[\]<>]/g, "")}:** ${formatDate(current.startAt)} to ${formatDate(current.endAt)}.`,
  ];
  return [
    ...lines.slice(0, overviewAt + 1),
    "",
    ...identities,
    ...narrative,
    ...lines.slice(overviewEnd),
  ].join("\n");
};

const reportDiagnosticCode = (error: RepositoryError): ReportFailureDiagnosticCode => {
  switch (error.operation) {
    case "report-composition-timeout":
    case "report-composition-empty":
    case "report-composition-structure":
    case "report-sprint-projection-missing":
    case "report-sprint-previous-metadata-missing":
    case "report-sprint-current-metadata-missing":
    case "report-composition-sprint-identity":
    case "report-composition-sprint-classification":
    case "report-composition-initiative-identity":
    case "report-composition-citations-missing":
    case "report-composition-required-citation-source-missing":
    case "report-composition-citation-unknown":
    case "report-composition-citation-url-unknown":
    case "report-composition-reference-id-unknown":
    case "report-composition-text-citation-unknown":
    case "report-composition-composer-citation-unknown":
    case "report-composition-citation-placement":
    case "report-composition-prohibited-prose":
    case "report-composition-identifier-inventory":
    case "report-composition-invalid":
      return error.operation;
    default:
      return "report-provider";
  }
};

const sourceLabel: Readonly<Record<DeliverySourceKind, string>> = {
  jira: "Jira",
  vault: "Vault",
  github: "GitHub",
  teams: "Teams",
  email: "Email",
  strategy: "Strategy",
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

const intentHeading: Readonly<Record<DeliveryQuestionIntent, string>> = {
  ...intentLabel,
  goals: "Goals and alignment",
  current_work: "Planned this week",
  recurring: "Recurring issues",
  next_actions: "Next",
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

const sourcePermitted = (
  source: DeliveryQuerySource,
  permittedSourceScopes: DeliveryAssistantRequest["permittedSourceScopes"],
): boolean => {
  if (permittedSourceScopes === undefined) return true;
  if (source.source === "intent") return permittedSourceScopes.includes("strategy");
  if (source.source === "projection" || source.source === "knowledge")
    return permittedSourceScopes.some((scope) => scope !== "strategy");
  return permittedSourceScopes.includes(source.source);
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
      const sharesDeclaredIntentSource = item.evidenceRole === "declared_intent";
      if (
        seenDedupe.has(intentDedupeKey) ||
        (!sharesDeclaredIntentSource && seenUrls.has(intentCitationUrl))
      )
        return false;
      seenDedupe.add(intentDedupeKey);
      if (!sharesDeclaredIntentSource) seenUrls.add(intentCitationUrl);
      return true;
    });
};

const statusSourcePriority: Readonly<Record<DeliverySourceKind, number>> = {
  jira: 0,
  strategy: 1,
  vault: 2,
  teams: 3,
  github: 4,
  email: 5,
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

const alignmentStopWords = new Set([
  "admin",
  "and",
  "enhancements",
  "for",
  "from",
  "has",
  "improve",
  "into",
  "mapping",
  "new",
  "no",
  "of",
  "on",
  "page",
  "portal",
  "product",
  "refresh",
  "security",
  "system",
  "the",
  "this",
  "to",
  "token",
  "website",
  "when",
  "with",
  "you",
]);

const normalizedAlignmentText = (value: string): string =>
  value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const alignmentMorphologyPrefixes = [
  "automat",
  "implement",
  "integrat",
  "migrat",
  "remediat",
  "vulnerab",
] as const;

const normalizedAlignmentToken = (value: string): string => {
  const singular = value.length > 3 && value.endsWith("s") ? value.slice(0, -1) : value;
  return alignmentMorphologyPrefixes.find((prefix) => singular.startsWith(prefix)) ?? singular;
};

const alignmentTokens = (value: string): readonly string[] =>
  normalizedAlignmentText(value)
    .split(" ")
    .map(normalizedAlignmentToken)
    .filter((token) => token.length > 1 && !alignmentStopWords.has(token));

const alignmentScore = (initiative: DeliveryResultItem, activity: DeliveryResultItem): number => {
  const initiativeValues = [initiative.title, ...(initiative.subjectAliases ?? [])];
  const activityText = normalizedAlignmentText(
    `${activity.title} ${activity.summary} ${(activity.subjectAliases ?? []).join(" ")}`,
  );
  const activityTokens = new Set(
    activityText.split(" ").map(normalizedAlignmentToken).filter(Boolean),
  );
  let best = 0;
  for (const value of initiativeValues) {
    const normalized = normalizedAlignmentText(value);
    if (normalized.length >= 6 && activityText.includes(normalized))
      best = Math.max(best, 100 + alignmentTokens(value).length);
    const tokens = alignmentTokens(value);
    const matched = tokens.filter((token) => activityTokens.has(token)).length;
    if (tokens.length >= 2 && matched === tokens.length) best = Math.max(best, 20 + tokens.length);
    else if (tokens.length >= 3 && matched >= 2 && matched / tokens.length >= 2 / 3)
      best = Math.max(best, 10 + matched);
  }
  return best;
};

const activitySourcePriority: Readonly<Record<DeliverySourceKind, number>> = {
  jira: 0,
  github: 1,
  vault: 2,
  email: 3,
  teams: 4,
  strategy: 5,
};

const initiativeAlignmentLines = (
  items: readonly DeliveryResultItem[],
  registerCitation: (item: DeliveryResultItem) => void,
): readonly string[] => {
  const initiatives = items
    .filter((item) => item.source === "strategy")
    .sort(
      (left, right) =>
        alignmentTokens(right.title).length - alignmentTokens(left.title).length ||
        left.title.localeCompare(right.title),
    );
  const seenActivities = new Set<string>();
  const activities = items
    .filter((item) => item.source !== "strategy" && item.intent === "current_work")
    .sort(
      (left, right) =>
        activitySourcePriority[left.source] - activitySourcePriority[right.source] ||
        sortableTimestamp(right.observedAt) - sortableTimestamp(left.observedAt),
    )
    .filter((item) => {
      const identity = safeText(item.title).toLocaleLowerCase("en");
      if (seenActivities.has(identity)) return false;
      seenActivities.add(identity);
      return true;
    });
  const grouped = new Map<string, DeliveryResultItem[]>();
  const unassigned: DeliveryResultItem[] = [];
  for (const activity of activities) {
    const scored = initiatives
      .map((initiative) => ({
        initiative,
        score: alignmentScore(initiative, activity),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          alignmentTokens(right.initiative.title).length -
            alignmentTokens(left.initiative.title).length,
      );
    const match = scored[0];
    if (match === undefined || match.score < 12) {
      unassigned.push(activity);
      continue;
    }
    grouped.set(match.initiative.id, [...(grouped.get(match.initiative.id) ?? []), activity]);
  }
  const lines: string[] = [];
  const matchedInitiatives = initiatives.filter((initiative) => grouped.has(initiative.id));
  if (matchedInitiatives.length > 0) {
    lines.push("## Initiative alignment");
    for (const goal of initiatives.filter((initiative) => initiative.intent === "goals"))
      registerCitation(goal);
    for (const initiative of matchedInitiatives) {
      const activity = grouped.get(initiative.id) ?? [];
      registerCitation(initiative);
      for (const item of activity) registerCitation(item);
      lines.push(
        `- **${safeText(initiative.title)}** — ${activity
          .map((item) => safeText(item.title))
          .join("; ")}`,
      );
    }
  }
  if (unassigned.length > 0) {
    lines.push("## Unassigned work");
    for (const item of unassigned) {
      registerCitation(item);
      lines.push(`- ${safeText(item.title)}`);
    }
  }
  return lines;
};

const subjectTokens = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(
      (token) =>
        (token.length > 2 || /\d/.test(token)) && !["the", "and", "for", "with"].includes(token),
    );

const itemMatchesPlan = (item: DeliveryResultItem, plan: DeliveryQueryPlan): boolean => {
  // A cross-source conflict is a relationship between attributed claims, not a
  // conflict-shaped sentence from any single adapter.
  if (item.intent === "conflicts") return false;
  const operation = plan.operations.find(
    (candidate) => candidate.purpose === item.intent && candidate.select === item.selector,
  );
  if (operation === undefined) return false;
  if (operation.select === "github_live" && item.source !== "github") return false;
  const explicitlyBound = plan.operations.some(
    (candidate) =>
      candidate.purpose === item.intent &&
      candidate.select === item.selector &&
      candidate.predicates?.some(
        ({ field, operator, value }) =>
          operator === "equals" &&
          ((field === "sourceReference" && value === item.citationUrl) ||
            (field === "externalKey" && value === item.planning?.externalKey)),
      ),
  );
  if (explicitlyBound) return true;
  const subject = plan.subject;
  if (subject === undefined) return true;
  const searchable =
    `${item.title} ${item.summary} ${(item.subjectAliases ?? []).join(" ")}`.toLowerCase();
  if (subject.externalKey !== undefined)
    return searchable.includes(subject.externalKey.toLowerCase());
  const tokens = subjectTokens(subject.phrase ?? "");
  return tokens.every((token) => searchable.includes(token));
};

const completionRetrievalPlan = (
  plan: DeliveryQueryPlan,
  resolution: ProductCompletionResolution | undefined,
): DeliveryQueryPlan => {
  if (resolution?.kind !== "resolved") return plan;
  const referenceOperations: readonly DeliveryQueryOperation[] =
    resolution.contract.evidenceBindings.flatMap<DeliveryQueryOperation>((binding, index) => {
      if (binding.source === "jira" && binding.reference.kind === "external_key")
        return [
          {
            id: `completion-reference-${index + 1}`,
            purpose: "status" as const,
            select: "objects" as const,
            objectKinds: ["work_item" as const],
            predicates: [
              { field: "source" as const, operator: "equals" as const, value: "jira" },
              {
                field: "externalKey" as const,
                operator: "equals" as const,
                value: binding.reference.value,
              },
            ],
            limit: 1,
          },
        ];
      if (binding.source === "github" && binding.reference.kind === "citation_url")
        return [
          {
            id: `completion-reference-${index + 1}`,
            purpose: "status" as const,
            select: "observations" as const,
            predicates: [
              { field: "source" as const, operator: "equals" as const, value: "github" },
              {
                field: "sourceReference" as const,
                operator: "equals" as const,
                value: binding.reference.value,
              },
            ],
            limit: 1,
          },
        ];
      return [];
    });
  return {
    ...plan,
    operations: [...plan.operations, ...referenceOperations],
  };
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

const citationsWithSourceProvenance = (
  citations: readonly { readonly label: string; readonly url: string }[],
  result: DeliveryQueryResult,
): readonly DeliveryAssistantAnswer["citations"][number][] => {
  const sourceByUrl = new Map<string, DeliverySourceKind>();
  const register = (url: string, source: DeliverySourceKind): void => {
    const existing = sourceByUrl.get(url);
    if (existing !== undefined && existing !== source)
      invalidReport("report-composition-citation-unknown");
    sourceByUrl.set(url, source);
  };
  for (const item of result.items) register(item.citationUrl, item.source);
  for (const citation of result.periodDeliveryReport?.capsules.flatMap(
    (capsule) => capsule.citations,
  ) ?? [])
    register(citation.url, citation.source);
  for (const claim of result.conflicts.flatMap((conflict) => conflict.claims))
    register(claim.source.citationUrl, claim.source.source);
  return citations.map((citation) => {
    const source = sourceByUrl.get(citation.url);
    if (source === undefined) return invalidReport("report-composition-citation-unknown");
    return { ...citation, source };
  });
};

const validatedReportCitations = (
  citations: readonly { readonly label: string; readonly url: string }[],
  result: DeliveryQueryResult,
  requiredSources: readonly DeliverySourceKind[],
): readonly DeliveryAssistantAnswer["citations"][number][] => {
  const resolved = citationsWithSourceProvenance(citations, result);
  const observedSources = new Set(resolved.map(({ source }) => source));
  if (requiredSources.some((source) => !observedSources.has(source)))
    invalidReport("report-composition-required-citation-source-missing");
  return resolved;
};

const composeAnswer = (
  _request: DeliveryAssistantRequest,
  plan: DeliveryQueryPlan,
  result: DeliveryQueryResult,
  responseMode: DeliveryResponseMode,
): DeliveryAnswerDraft => {
  const responsePolicy = deliveryResponseModePolicies[responseMode];
  const isPeriodReport = plan.operations.some(({ select }) => select === "period_census");
  const isInitiativeAlignment =
    !isPeriodReport && plan.intents.includes("goals") && plan.intents.includes("current_work");
  const maximumDetailLines = isInitiativeAlignment
    ? Number.POSITIVE_INFINITY
    : (responsePolicy.maximumLines ?? Number.POSITIVE_INFINITY);
  const itemsPerIntent = 5;
  const citations: DeliveryAssistantAnswer["citations"][number][] = [];
  const citationLabels = new Map<string, string>();
  const registerCitation = (item: DeliveryResultItem): void => {
    const key = item.citationUrl;
    if (citationLabels.has(key)) return;
    const label = `${sourceLabel[item.source]} ${citations.length + 1}`;
    citations.push({ label, url: item.citationUrl, source: item.source });
    citationLabels.set(key, label);
  };
  const references = (): readonly string[] => {
    if (citations.length === 0) return [];
    const maximumPerSource = isInitiativeAlignment ? 6 : Number.POSITIVE_INFINITY;
    const grouped = new Map<string, { label: string; url: string }[]>();
    for (const value of citations) {
      const source = value.label.split(" ")[0] ?? "Source";
      grouped.set(source, [...(grouped.get(source) ?? []), value]);
    }
    return [
      "### References",
      ...[...grouped.entries()].map(([source, values]) => {
        const shown = values.slice(0, maximumPerSource);
        const omitted = values.length - shown.length;
        return `- **${source}:** ${shown
          .map(({ url }, index) => `[${index + 1}](${url})`)
          .join(" · ")}${omitted > 0 ? ` · _+${omitted} more_` : ""}`;
      }),
    ];
  };
  const detailLines: string[] = [];
  const items = uniqueRanked(result.items.filter((item) => itemMatchesPlan(item, plan)));
  const missingIntents = new Set(result.missingRequiredIntents ?? []);
  let historicalStatusOnly = false;

  if (plan.intents.length === 1 && plan.intents[0] === "activity") {
    const activityLines: string[] = [];
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
      for (const item of selected) {
        registerCitation(item);
        activityLines.push(`- ${group.icon} **${group.label}:** ${safeText(item.summary)}`);
      }
    }
    if (activityLines.length > 0) detailLines.push("## Activity", ...activityLines);
  } else if (isInitiativeAlignment) {
    detailLines.push(...initiativeAlignmentLines(items, registerCitation));
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
          detailLines.push(`## ${intentHeading[intent]}`);
          for (const item of representatives) {
            registerCitation(item);
            detailLines.push(
              `- **${safeText(item.owner?.displayName ?? "Unassigned")}** — ${safeText(item.title)}`,
            );
          }
        } else if (missingIntents.has(intent)) {
          detailLines.push(`## ${intentHeading[intent]}`, "- No matching items found.");
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
          detailLines.push(`## ${intentHeading[intent]}`);
          for (const item of selected) {
            registerCitation(item);
            detailLines.push(`- ${deliveredItemSummary(item)}`);
          }
        } else if (missingIntents.has(intent)) {
          detailLines.push(`## ${intentHeading[intent]}`, "- No matching items found.");
        }
        continue;
      }
      const selected = sourceBalancedForIntent(
        items.filter((item) => item.intent === intent),
        intent,
        plan.requiredSources ?? [],
        intent === "status" ? 2 : itemsPerIntent,
      );
      if (selected.length > 0) {
        historicalStatusOnly =
          intent === "status" &&
          selected.every(
            (item) => item.lifecycleState === "done" || item.lifecycleState === "canceled",
          );
        const label = historicalStatusOnly
          ? `${intentLabel[intent]} — historical only`
          : intentHeading[intent];
        detailLines.push(`## ${label}`);
        for (const item of selected) {
          registerCitation(item);
          detailLines.push(
            `- ${intentIcon[intent]} ${item.evidenceRole === "declared_intent" ? "**Planned:** " : ""}${safeText(item.summary)}`,
          );
        }
      } else if (missingIntents.has(intent)) {
        detailLines.push(`## ${intentHeading[intent]}`, "- No matching items found.");
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
          registerCitation(item);
          return safeText(String(claim.value));
        });
        const conflictLine = `- ⚖️ **${conflict.subjectKey} ${conflict.predicate}:** ${summaries.join(" vs ")}`;
        if (detailLines.length >= maximumDetailLines)
          detailLines.splice(Math.max(0, maximumDetailLines - 1));
        detailLines.push("## Conflicts", conflictLine);
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
          ? ["## Missing", `- No matching ${missing} result was available.`].join("\n")
          : result.unavailableSources.length === 0
            ? [
                "## No matching items",
                "- No connected project information matched the question.",
              ].join("\n")
            : ["## Unavailable", `- ${unavailable}`].join("\n"),
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
      "## Unavailable",
      `- ${result.unavailableSources.map((source) => sourceLabel[source]).join(", ")}`,
    );
  if ((result.missingRequiredSources?.length ?? 0) > 0 && detailLines.length < maximumDetailLines)
    detailLines.push(
      "## Missing",
      `- No matching ${result.missingRequiredSources?.map((source) => sourceLabel[source]).join(", ")} result was available.`,
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
        ? `- <at>${mentionName}</at>, please confirm the next step and due date for this item.`
        : `- ${safeText(actionItem.summary)}`;
  if (actionItem !== undefined) registerCitation(actionItem);
  const completeActionLine =
    actionLine ?? (plan.intents.includes("next_actions") ? "- No next action found." : undefined);
  const lines = [
    ...detailLines.slice(0, maximumDetailLines),
    ...(completeActionLine === undefined ? [] : ["## Next", completeActionLine]),
    ...references(),
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
  requiredCompletionAssessment?: DeliveryCompletionAssessment,
): Effect.Effect<DeliveryAnswerDraft> => {
  const reportComposition =
    responseProduct === "period_delivery_brief" || responseProduct === "leadership_report";
  const requiresSprintReview = plan.operations.some(({ time }) => time?.kind === "jira_sprint");
  if (
    reportComposition &&
    requiresSprintReview &&
    result.periodDeliveryReport?.sprintReview === undefined
  )
    return Effect.succeed(
      reportFailureDraft(plan, "SARATHI-REPORT-QUALITY-FAILED", "report-sprint-projection-missing"),
    );
  if (reportComposition && requiresSprintReview) {
    const review = result.periodDeliveryReport?.sprintReview;
    for (const [sprint, diagnosticCode] of [
      [review?.previousSprint, "report-sprint-previous-metadata-missing"],
      [review?.currentSprint, "report-sprint-current-metadata-missing"],
    ] as const)
      if (
        sprint?.startAt === undefined ||
        sprint.endAt === undefined ||
        !Number.isFinite(Date.parse(sprint.startAt)) ||
        !Number.isFinite(Date.parse(sprint.endAt))
      )
        return Effect.succeed(
          reportFailureDraft(plan, "SARATHI-REPORT-QUALITY-FAILED", diagnosticCode),
        );
  }
  const deterministic = composeAnswer(request, plan, result, responseMode);
  const rankedItems = rankedForIntent(uniqueRanked(result.items), plan.intents[0] ?? "general");
  const maximumItems = deliveryResponseModePolicies[responseMode].maximumItems;
  const items =
    maximumItems === undefined
      ? rankedItems.filter((item) => item.selector !== "period_census")
      : rankedItems.slice(0, maximumItems);
  if (
    !reportComposition &&
    requiredCompletionAssessment === undefined &&
    (items.length === 0 || (deterministic.mentions?.length ?? 0) > 0)
  )
    return Effect.succeed(deterministic);
  const allowedCitationUrls = new Set([
    ...items.map((item) => item.citationUrl),
    ...(result.periodDeliveryReport?.capsules.flatMap((capsule) =>
      capsule.citations.map(({ url }) => url),
    ) ?? []),
    ...result.conflicts.flatMap((conflict) =>
      conflict.claims.map((claim) => claim.source.citationUrl),
    ),
  ]);
  const composition = (compositionAttempt: "full" | "reduced") => {
    const compositionInput = {
      compositionAttempt,
      workspaceId: request.workspaceId,
      question: request.question,
      requestedAt: request.requestedAt,
      plan,
      items,
      conflicts: result.conflicts,
      periodDeliveryReport: result.periodDeliveryReport,
      responseProduct,
      responseMode,
      responseBudget,
      ...(requiredCompletionAssessment === undefined
        ? {}
        : { completionAssessment: requiredCompletionAssessment }),
    } as const;
    const compositionEnvelopeFingerprint = stableSha256(
      JSON.stringify({
        ...compositionInput,
        requestedAt: undefined,
        workspaceId: undefined,
      }),
    );
    const retrievalFingerprint = stableSha256(
      JSON.stringify({
        items: result.items.map(({ id, source, selector, intent, dedupeKey, citationUrl }) => ({
          id,
          source,
          selector,
          intent,
          dedupeKey,
          citationUrl,
        })),
        episodes: result.periodDeliveryReport?.capsules.map(({ id }) => id) ?? [],
      }),
    );
    return Effect.suspend(() => composer.compose(compositionInput)).pipe(
      Effect.flatMap((composed) =>
        Effect.try({
          try: () => {
            if (reportComposition) {
              const review = result.periodDeliveryReport?.sprintReview;
              const text =
                review === undefined
                  ? composed.text.trim()
                  : renderSprintIdentity(composed.text.trim(), review, request.timeZone);
              const requiredHeadings =
                result.periodDeliveryReport?.sprintReview === undefined
                  ? [
                      "## Delivered",
                      "## In progress",
                      "## Waiting or blocked",
                      "## Decisions needed",
                      "## References",
                    ]
                  : [
                      "## Sprint overview",
                      "## Previous sprint",
                      "## Current sprint",
                      "## Q3 alignment",
                      "## Waiting or decisions",
                      "## Jira hygiene",
                      "## References",
                    ];
              if (!requiredHeadings.every((heading) => text.includes(heading)))
                invalidReport("report-composition-structure");
              const sprintDateIsPresent = (value: string): boolean => {
                const parsed = new Date(value);
                if (Number.isNaN(parsed.getTime())) return false;
                const formats: readonly Intl.DateTimeFormatOptions[] = [
                  { day: "numeric", month: "short", year: "numeric" },
                  { day: "numeric", month: "long", year: "numeric" },
                  { day: "numeric", month: "short" },
                  { day: "numeric", month: "long" },
                ];
                return [
                  value.slice(0, 10),
                  ...formats.map((format) =>
                    new Intl.DateTimeFormat("en-GB", {
                      timeZone: request.timeZone,
                      ...format,
                    }).format(parsed),
                  ),
                ].some((candidate) => text.includes(candidate));
              };
              for (const [, sprint] of [
                ["previous", review?.previousSprint],
                ["current", review?.currentSprint],
              ] as const) {
                if (review === undefined) break;
                if (
                  sprint === undefined ||
                  sprint.startAt === undefined ||
                  sprint.endAt === undefined ||
                  !text.includes(sprint.name) ||
                  !sprintDateIsPresent(sprint.startAt) ||
                  !sprintDateIsPresent(sprint.endAt)
                )
                  invalidReport("report-composition-sprint-identity");
              }
              if (review !== undefined) {
                const previousAt = text.indexOf("## Previous sprint");
                const currentAt = text.indexOf("## Current sprint");
                const previousSection = text.slice(previousAt, currentAt);
                if (
                  ![
                    /planned at start/i,
                    /delivered/i,
                    /rolled over/i,
                    /added during sprint/i,
                    /dropped|superseded/i,
                  ].every((classification) => classification.test(previousSection))
                )
                  invalidReport("report-composition-sprint-classification");
              }
              if (review?.initiatives.some(({ title }) => !text.includes(title)))
                invalidReport("report-composition-initiative-identity");
              if (
                /\b(?:evidence-backed|proof|grounding|source count|business impact unknown|completeness ratio)\b/i.test(
                  text,
                ) ||
                /\b(?:sir here is|please test|test done\?)\b/i.test(text)
              )
                invalidReport("report-composition-prohibited-prose");
              const referencesAt = text.indexOf("## References");
              const reportBody = text.slice(0, referencesAt);
              const inlineJiraIdentifiers = [
                ...reportBody.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g),
              ].flatMap((match) => (match[0] === undefined ? [] : [match[0]]));
              if (
                new Set(inlineJiraIdentifiers).size > 5 ||
                reportBody
                  .split(/\r?\n/)
                  .some((line) => new Set(line.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []).size > 2)
              )
                invalidReport("report-composition-identifier-inventory");
              if (
                composed.citations.some(
                  ({ url }) => !resolvableUrl(url) || !allowedCitationUrls.has(url),
                )
              )
                invalidReport("report-composition-composer-citation-unknown");
              if (text.slice(0, referencesAt).includes("](https://"))
                invalidReport("report-composition-citation-placement");
              const referenceFooter = text.slice(referencesAt);
              if (composed.citations.some(({ url }) => !referenceFooter.includes(`](${url})`)))
                invalidReport("report-composition-text-citation-unknown");
              const unmatchedReferenceFooter = composed.citations.reduce(
                (footer, { url }) => footer.replaceAll(`](${url})`, "]"),
                referenceFooter,
              );
              if (unmatchedReferenceFooter.includes("](https://"))
                invalidReport("report-composition-text-citation-unknown");
              if (allowedCitationUrls.size > 0 && composed.citations.length === 0)
                invalidReport("report-composition-citations-missing");
              return {
                ...deterministic,
                text,
                citations: validatedReportCitations(
                  composed.citations,
                  result,
                  plan.requiredSources ?? [],
                ),
                mentions: [],
                relevanceDiagnostics: {
                  retrievalFingerprint,
                  compositionEnvelopeFingerprint,
                  selectedCandidateCount: items.length,
                  selectedEpisodeCount: result.periodDeliveryReport?.capsules.length ?? 0,
                  ...(composed.modelUsage === undefined ? {} : { modelUsage: composed.modelUsage }),
                },
                ...(result.periodDeliveryReport === undefined
                  ? {}
                  : { periodDeliveryReport: result.periodDeliveryReport }),
              };
            }
            const lines = composed.text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            if (!lines.some((line) => line.startsWith("## ")))
              throw new Error("Composed delivery answer lacks topic headings.");
            if (!lines.some((line) => line.startsWith("- ")))
              throw new Error("Composed delivery answer lacks scannable bullets.");
            if (!lines.includes("### References"))
              throw new Error("Composed delivery answer lacks a references footer.");
            if (
              requiredCompletionAssessment !== undefined &&
              renderedCompletionVerdict(composed.text) !==
                requiredCompletionVerdict(requiredCompletionAssessment)
            )
              throw new RepositoryError({
                message: "Delivery answer did not contain the required completion verdict.",
                operation: "answer-completion-verdict-invalid",
              });
            if (
              requiredCompletionAssessment !== undefined &&
              !validatesCompletionSemantics(composed.text, requiredCompletionAssessment)
            )
              throw new RepositoryError({
                message: "Delivery answer omitted required completion semantics.",
                operation: "answer-completion-semantic-invalid",
              });
            if (
              composed.citations.some(
                ({ url }) => !resolvableUrl(url) || !allowedCitationUrls.has(url),
              )
            )
              throw new Error("Composed delivery answer contains an unknown citation.");
            return {
              ...deterministic,
              text: lines.join("\n"),
              citations: citationsWithSourceProvenance(composed.citations, result),
              mentions: [],
              relevanceDiagnostics: {
                retrievalFingerprint,
                compositionEnvelopeFingerprint,
                selectedCandidateCount: items.length,
                selectedEpisodeCount: result.periodDeliveryReport?.capsules.length ?? 0,
                ...(composed.modelUsage === undefined ? {} : { modelUsage: composed.modelUsage }),
              },
              ...(requiredCompletionAssessment === undefined
                ? {}
                : { completionAssessment: requiredCompletionAssessment }),
            };
          },
          catch: (error) =>
            error instanceof RepositoryError
              ? error
              : new RepositoryError({
                  message: "Delivery answer composition was invalid.",
                  operation: "report-composition-invalid",
                }),
        }),
      ),
    );
  };
  const retriedComposition = reportComposition
    ? composition("full").pipe(Effect.catchAll(() => composition("reduced")))
    : composition("full");
  return retriedComposition.pipe(
    Effect.timeoutFail({
      duration: timeoutMs,
      onTimeout: () =>
        new RepositoryError({
          message: "Delivery answer composition exceeded its response budget.",
          operation: "delivery-answer-composition",
        }),
    }),
    Effect.catchAll((error) =>
      reportComposition
        ? Effect.succeed(
            reportFailureDraft(
              plan,
              error.operation?.startsWith("report-composition-")
                ? error.operation === "report-composition-timeout"
                  ? "SARATHI-REPORT-COMPOSITION-TIMEOUT"
                  : "SARATHI-REPORT-COMPOSITION-INVALID"
                : error.operation === "delivery-answer-composition"
                  ? "SARATHI-REPORT-COMPOSITION-TIMEOUT"
                  : "SARATHI-REPORT-PROVIDER-FAILED",
              error.operation === "delivery-answer-composition"
                ? "report-composition-timeout"
                : reportDiagnosticCode(error),
            ),
          )
        : Effect.succeed(
            answerFailureDraft(
              plan,
              error.operation === "delivery-answer-composition"
                ? "SARATHI-ANSWER-COMPOSITION-TIMEOUT"
                : error.operation === "answer-completion-verdict-invalid" ||
                    error.operation === "answer-completion-semantic-invalid" ||
                    error.operation === "report-composition-invalid"
                  ? "SARATHI-ANSWER-COMPOSITION-INVALID"
                  : "SARATHI-ANSWER-PROVIDER-FAILED",
              error.operation === "delivery-answer-composition"
                ? "answer-composition-timeout"
                : error.operation === "answer-completion-verdict-invalid"
                  ? "answer-completion-verdict-invalid"
                  : error.operation === "answer-completion-semantic-invalid"
                    ? "answer-completion-semantic-invalid"
                    : error.operation === "report-composition-invalid"
                      ? "answer-composition-invalid"
                      : "answer-provider",
            ),
          ),
    ),
  );
};

const renderResponseMode = (
  answer: DeliveryAnswerDraft,
  _request: DeliveryAssistantRequest,
  _result: DeliveryQueryResult,
  responseMode: DeliveryResponseMode,
  responseProduct: DeliveryResponseProduct,
  _elapsedMs: number,
): DeliveryAnswerDraft => {
  if (responseMode === "fast") return answer;
  const reportProduct =
    responseProduct === "period_delivery_brief" || responseProduct === "leadership_report";
  if (reportProduct) return answer;
  return answer;
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
  const reportProduct =
    (responseProduct === "period_delivery_brief" || responseProduct === "leadership_report") &&
    answer.plan.operations.some(({ select }) => select === "period_census");
  const acceptanceIntents = reportProduct
    ? answer.plan.intents.filter((intent) => intent === "delivered")
    : answer.plan.intents;
  const semanticCompletionPassed =
    answer.completionAssessment === undefined ||
    (answer.status !== "failed" &&
      validatesCompletionSemantics(answer.text, answer.completionAssessment));
  const completionProduct = answer.completionAssessment !== undefined;
  const requestedIntents = reportProduct || completionProduct ? 1 : acceptanceIntents.length;
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
  const coveredIntents = completionProduct
    ? semanticCompletionPassed
      ? 1
      : 0
    : reportProduct
      ? result.periodDeliveryReport !== undefined &&
        result.periodDeliveryReport.capsules.length > 0 &&
        result.complete &&
        (result.missingRequiredSources?.length ?? 0) === 0
        ? 1
        : 0
      : acceptanceIntents.filter(
          (intent) => !missingIntents.has(intent) && emittedIntents.has(intent),
        ).length;
  const completenessRatio = ratio(coveredIntents, requestedIntents);
  const lines = answer.text.split(/\r?\n/).map((line) => line.trim());
  const structuredReportProduct = reportProduct && result.periodDeliveryReport !== undefined;
  const referencesIndex = lines.findIndex(
    (line) => line === "### References" || line === "## References",
  );
  const materialLines = lines
    .slice(0, referencesIndex < 0 ? lines.length : referencesIndex)
    .filter((line) => line.startsWith("- "));
  const allowedUrls = new Set([
    ...result.items.map((item) => item.citationUrl),
    ...(result.periodDeliveryReport?.capsules.flatMap((capsule) =>
      capsule.citations.map(({ url }) => url),
    ) ?? []),
    ...result.conflicts.flatMap((conflict) =>
      conflict.claims.map((claim) => claim.source.citationUrl),
    ),
  ]);
  const linkedUrls = structuredReportProduct
    ? answer.citations.flatMap(({ url }) => (answer.text.includes(`](${url})`) ? [url] : []))
    : [...answer.text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].flatMap((match) =>
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
  const citedStatements =
    materialLines.length === 0 ? 0 : linkedUrls.length > 0 ? materialLines.length : 0;
  const citationCoverage = ratio(citedStatements, materialLines.length);
  const freshnessCoverage = ratio(freshEvidence, evaluatedItems.length);
  const completenessPassed =
    result.complete &&
    completenessRatio === 1 &&
    (result.missingRequiredSources?.length ?? 0) === 0;
  const citationPassed = citationCoverage === 1;
  const groundingPassed = linkedUrls.every((url) => allowedUrls.has(url));
  const freshnessPassed = freshnessCoverage >= 0.95;
  const headings = new Set(lines.filter((line) => /^#{2,3} /.test(line)));
  const reportHeadings =
    result.periodDeliveryReport?.sprintReview === undefined
      ? [
          "## Delivered",
          "## In progress",
          "## Waiting or blocked",
          "## Decisions needed",
          "## References",
        ]
      : [
          "## Sprint overview",
          "## Previous sprint",
          "## Current sprint",
          "## Q3 alignment",
          "## Waiting or decisions",
          "## Jira hygiene",
          "## References",
        ];
  const formatPassed = structuredReportProduct
    ? reportHeadings.every((heading) => headings.has(heading))
    : headings.size > 0 && headings.has("### References");
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
    citedStatements,
    citationCoverage,
    citationPassed,
    groundingPassed,
    freshEvidence,
    evaluatedEvidence: evaluatedItems.length,
    freshnessCoverage,
    freshnessPassed,
    formatPassed,
    semanticCompletionPassed,
    passed:
      answer.status !== "failed" &&
      latencyPassed &&
      completenessPassed &&
      citationPassed &&
      groundingPassed &&
      freshnessPassed &&
      formatPassed &&
      semanticCompletionPassed,
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

const periodReportEnrichmentQuestions = (report: PeriodDeliveryReport): readonly string[] => {
  const capabilityQuestions = report.capabilitySections.map((section) => {
    const initiatives = section.capsules
      .slice(0, 8)
      .map(({ title }) => safeText(title))
      .join("; ");
    return `Latest delivery state, decisions, emerging requirements, human waits, awaited action, acceptance, and project rationale for ${safeText(section.title)}${initiatives === "" ? "" : `: ${initiatives}`}`;
  });
  const unmapped =
    report.unmappedCapsules.length === 0
      ? []
      : [
          `Latest delivery state, decisions, emerging requirements, human waits, awaited action, acceptance, and initiative placement for these unaccounted changes: ${report.unmappedCapsules
            .slice(0, 12)
            .map(({ title }) => safeText(title))
            .join("; ")}`,
        ];
  return [...capabilityQuestions, ...unmapped];
};

const retrievePeriodReportEnrichment = (
  sources: readonly DeliveryQuerySource[],
  context: Parameters<DeliveryQuerySource["execute"]>[0],
  report: PeriodDeliveryReport,
  sourceTimeoutMs: number,
): Effect.Effect<readonly DeliveryResultItem[]> => {
  const knowledgeSources = sources.filter((source) => source.selectors.includes("knowledge"));
  const questions = periodReportEnrichmentQuestions(report);
  if (knowledgeSources.length === 0 || questions.length === 0) return Effect.succeed([]);
  return Effect.all(
    questions.flatMap((question, index) => {
      const plan: DeliveryQueryPlan = {
        version: 1,
        intents: ["delivered"],
        operations: [
          {
            id: `delivery-report-enrichment-${index + 1}`,
            purpose: "delivered",
            select: "knowledge",
            limit: 20,
          },
        ],
        answerMode: "model_assisted",
        maximumLines: 3,
        requiresFinance: false,
      };
      return knowledgeSources.map((source) =>
        source
          .execute(
            {
              ...context,
              question,
            },
            plan,
          )
          .pipe(
            Effect.timeoutFail({
              duration: sourceTimeoutMs,
              onTimeout: () =>
                new RepositoryError({
                  message: `${source.source} report enrichment exceeded its response budget.`,
                  operation: `delivery-report-enrichment-${source.source}`,
                }),
            }),
            Effect.either,
          ),
      );
    }),
    { concurrency: 4 },
  ).pipe(
    Effect.map((results) =>
      uniqueRanked(
        results
          .flatMap((result) => (result._tag === "Right" ? result.right.items : []))
          .filter(
            (item) =>
              item.selector === "knowledge" &&
              item.workspaceId === context.workspaceId &&
              isSensitivityAtOrBelow(item.sensitivity, context.maximumSensitivity),
          ),
      ),
    ),
  );
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
        const retrievalPlan = completionRetrievalPlan(plan, configuration.completionResolution);
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
        const selectors = new Set(retrievalPlan.operations.map((operation) => operation.select));
        const sources = configuration.sources.filter(
          (source) =>
            source.selectors.some((selector) => selectors.has(selector)) &&
            sourcePermitted(source, request.permittedSourceScopes),
        );
        const context = {
          workspaceId: request.workspaceId,
          actorId: request.actorId,
          audienceIds: request.audienceIds,
          permittedSourceScopes: request.permittedSourceScopes,
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
            source.execute(context, retrievalPlan).pipe(
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
            const reportedUnavailableSources = [
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
            const mergedItems = successful
              .flatMap((result) => result.items)
              .filter(
                (item) =>
                  item.workspaceId === request.workspaceId &&
                  (request.permittedSourceScopes === undefined ||
                    request.permittedSourceScopes.includes(item.source)) &&
                  isSensitivityAtOrBelow(item.sensitivity, request.maximumSensitivity) &&
                  itemMatchesPlan(item, retrievalPlan),
              );
            const requestedAt = Date.parse(request.requestedAt);
            const unavailableSources = reportedUnavailableSources.filter(
              (source) =>
                !mergedItems.some((item) => {
                  if (item.source !== source || item.indexedAt === undefined) return false;
                  const indexedAt = Date.parse(item.indexedAt);
                  return (
                    Number.isFinite(indexedAt) &&
                    Math.max(0, requestedAt - indexedAt) <= responsePolicy.freshnessWindowMs
                  );
                }),
            );
            const merged: DeliveryQueryResult = {
              items: mergedItems,
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
            const intentsRequiredForCompleteness =
              responseProduct === "period_delivery_brief" || responseProduct === "leadership_report"
                ? plan.intents.filter((intent) => intent === "delivered")
                : plan.intents;
            const missingRequiredIntents = intentsRequiredForCompleteness.filter(
              (intent) => !representedIntents.has(intent),
            );
            const periodDeliveryReport =
              (responseProduct === "leadership_report" ||
                responseProduct === "period_delivery_brief") &&
              merged.periodCensus !== undefined &&
              configuration.capabilityLedger !== undefined
                ? buildPeriodDeliveryReport({
                    census: merged.periodCensus,
                    items: merged.items,
                    capabilityLedger: configuration.capabilityLedger,
                  })
                : undefined;
            const enrichment =
              periodDeliveryReport === undefined || configuration.answerComposer === undefined
                ? Effect.succeed([])
                : retrievePeriodReportEnrichment(
                    configuration.sources,
                    context,
                    periodDeliveryReport,
                    sourceTimeoutMs,
                  );
            return enrichment.pipe(
              Effect.flatMap((enrichmentItems) => {
                const reportMissingDelivery =
                  (responseProduct === "leadership_report" ||
                    responseProduct === "period_delivery_brief") &&
                  plan.intents.includes("delivered") &&
                  (periodDeliveryReport === undefined ||
                    periodDeliveryReport.capsules.length === 0);
                const completed: DeliveryQueryResult = {
                  ...merged,
                  items: uniqueRanked([...merged.items, ...enrichmentItems]),
                  complete:
                    merged.complete &&
                    missingRequiredSources.length === 0 &&
                    !reportMissingDelivery,
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
                const reportProduct =
                  responseProduct === "period_delivery_brief" ||
                  responseProduct === "leadership_report";
                const completionRequested =
                  plan.intents.includes("delivered") &&
                  plan.intents.includes("status") &&
                  namedCompletionQuestionSubject(request.question) !== undefined;
                const completionReconciliation =
                  !completionRequested || configuration.completionResolution === undefined
                    ? undefined
                    : reconcileProductCompletion({
                        resolution: configuration.completionResolution,
                        result: completed,
                        requestedAt: request.requestedAt,
                      });
                const requiredCompletionAssessment = completionReconciliation?.assessment;
                const compositionResult: DeliveryQueryResult =
                  completionReconciliation === undefined
                    ? completed
                    : {
                        ...completed,
                        items: completionReconciliation.selectedItems,
                        conflicts: [],
                      };
                const composed =
                  completionRequested && configuration.completionResolution === undefined
                    ? Effect.succeed(
                        answerFailureDraft(
                          plan,
                          "SARATHI-ANSWER-PROVIDER-FAILED",
                          "answer-provider",
                        ),
                      )
                    : configuration.answerComposer === undefined
                      ? Effect.succeed(
                          reportProduct
                            ? reportFailureDraft(
                                plan,
                                "SARATHI-REPORT-PROVIDER-FAILED",
                                "report-composer-unavailable",
                              )
                            : requiredCompletionAssessment === undefined
                              ? composeAnswer(request, plan, compositionResult, responseMode)
                              : answerFailureDraft(
                                  plan,
                                  "SARATHI-ANSWER-PROVIDER-FAILED",
                                  "answer-composer-unavailable",
                                ),
                        )
                      : remainingCompositionBudgetMs <= 0
                        ? Effect.succeed(
                            reportProduct
                              ? reportFailureDraft(
                                  plan,
                                  "SARATHI-REPORT-COMPOSITION-TIMEOUT",
                                  "report-composition-timeout",
                                )
                              : answerFailureDraft(
                                  plan,
                                  "SARATHI-ANSWER-COMPOSITION-TIMEOUT",
                                  "answer-composition-timeout",
                                ),
                          )
                        : composeWithModel(
                            configuration.answerComposer,
                            request,
                            plan,
                            compositionResult,
                            Math.min(compositionTimeoutMs, remainingCompositionBudgetMs),
                            responseMode,
                            responseProduct,
                            responseBudget,
                            requiredCompletionAssessment,
                          );
                return composed.pipe(
                  Effect.map((draft) => {
                    const assessedDraft =
                      requiredCompletionAssessment === undefined
                        ? draft
                        : { ...draft, completionAssessment: requiredCompletionAssessment };
                    const elapsedMs = Math.max(0, Date.now() - startedAt);
                    const rendered = renderResponseMode(
                      assessedDraft,
                      request,
                      compositionResult,
                      responseMode,
                      responseProduct,
                      elapsedMs,
                    );
                    const acceptance = responseAcceptance(
                      rendered,
                      request,
                      compositionResult,
                      responseMode,
                      responseProduct,
                      elapsedMs,
                    );
                    const qualityFailed =
                      reportProduct &&
                      rendered.failure === undefined &&
                      (completed.periodDeliveryReport === undefined || !acceptance.passed);
                    const finalRendered = qualityFailed
                      ? reportFailureDraft(plan, "SARATHI-REPORT-QUALITY-FAILED", "report-quality")
                      : rendered;
                    return {
                      ...finalRendered,
                      responseMode,
                      responseProduct,
                      responseBudget,
                      acceptance: qualityFailed
                        ? { ...acceptance, formatPassed: false, passed: false }
                        : acceptance,
                    };
                  }),
                );
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
