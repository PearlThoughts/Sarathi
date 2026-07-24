import type {
  DeliveryMetricCategory,
  DeliveryObjectKind,
  DeliveryRelationKind,
  DeliverySourceKind,
} from "./delivery-model.ts";

export type DeliveryQuestionIntent =
  | "general"
  | "status"
  | "goals"
  | "commitments"
  | "scope"
  | "requirements"
  | "ownership"
  | "reviews"
  | "conflicts"
  | "dependencies"
  | "blockers"
  | "delivered"
  | "current_work"
  | "risks"
  | "recurring"
  | "decisions"
  | "next_actions"
  | "milestones"
  | "capacity"
  | "finance"
  | "activity"
  | "implementation";

export type DeliveryQuerySubject = {
  readonly externalKey?: string | undefined;
  readonly phrase?: string | undefined;
};

export type DeliveryQuerySelector =
  | "objects"
  | "relations"
  | "observations"
  | "claims"
  | "metrics"
  | "conflicts"
  | "knowledge"
  | "github_live";

export type DeliveryQueryField =
  | "kind"
  | "title"
  | "externalKey"
  | "lifecycleState"
  | "priority"
  | "component"
  | "sprint"
  | "label"
  | "severity"
  | "source"
  | "subjectKey"
  | "predicate"
  | "metricCategory"
  | "metricKind"
  | "dedupeKey"
  | "observedAt"
  | "startAt"
  | "dueAt";

export type DeliveryQueryPredicate = {
  readonly field: DeliveryQueryField;
  readonly operator: "equals" | "in" | "contains" | "exists";
  readonly value?: string | number | boolean | readonly string[] | undefined;
};

export type DeliveryRelationTraversal = {
  readonly kinds: readonly DeliveryRelationKind[];
  readonly direction: "outgoing" | "incoming" | "both";
  readonly maximumDepth: 1 | 2;
};

export type DeliveryTimeConstraint =
  | {
      readonly kind: "absolute";
      readonly fromInclusive: string;
      readonly toExclusive: string;
    }
  | { readonly kind: "workspace_day" }
  | { readonly kind: "workspace_week" }
  | { readonly kind: "workspace_previous_week" }
  | { readonly kind: "jira_sprint"; readonly sprint: "current" | "previous" }
  | { readonly kind: "lookback"; readonly days: number };

export type DeliveryQueryMeasure = {
  readonly operator: "count" | "sum" | "average";
  readonly field?: "value" | undefined;
  readonly minimumOccurrences?: number | undefined;
};

export type DeliveryQueryOperation = {
  readonly id: string;
  readonly purpose: DeliveryQuestionIntent;
  readonly select: DeliveryQuerySelector;
  readonly objectKinds?: readonly DeliveryObjectKind[] | undefined;
  readonly relationKinds?: readonly DeliveryRelationKind[] | undefined;
  readonly metricCategories?: readonly DeliveryMetricCategory[] | undefined;
  readonly predicates?: readonly DeliveryQueryPredicate[] | undefined;
  readonly traversal?: DeliveryRelationTraversal | undefined;
  readonly groupBy?: readonly DeliveryQueryField[] | undefined;
  readonly measures?: readonly DeliveryQueryMeasure[] | undefined;
  readonly orderBy?:
    | { readonly field: DeliveryQueryField; readonly direction: "asc" | "desc" }
    | undefined;
  readonly time?: DeliveryTimeConstraint | undefined;
  readonly limit: number;
};

export type DeliveryQueryPlan = {
  readonly version: 1;
  readonly intents: readonly DeliveryQuestionIntent[];
  readonly operations: readonly DeliveryQueryOperation[];
  readonly answerMode: "deterministic" | "model_assisted";
  readonly maximumLines: 2 | 3 | 4 | 5 | 6;
  readonly requiresFinance: boolean;
  readonly subject?: DeliveryQuerySubject | undefined;
  readonly requiredSources?: readonly DeliverySourceKind[] | undefined;
};

const selectors = new Set<DeliveryQuerySelector>([
  "objects",
  "relations",
  "observations",
  "claims",
  "metrics",
  "conflicts",
  "knowledge",
  "github_live",
]);
const purposes = new Set<DeliveryQuestionIntent>([
  "general",
  "status",
  "goals",
  "commitments",
  "scope",
  "requirements",
  "ownership",
  "reviews",
  "conflicts",
  "dependencies",
  "blockers",
  "delivered",
  "current_work",
  "risks",
  "recurring",
  "decisions",
  "next_actions",
  "milestones",
  "capacity",
  "finance",
  "activity",
  "implementation",
]);

class DeliveryQueryPlanValidationError extends Error {
  readonly name = "DeliveryQueryPlanValidationError";
}

const assertTimeConstraint = (time: DeliveryTimeConstraint | undefined): void => {
  if (time === undefined) return;
  if (time.kind === "absolute") {
    const from = Date.parse(time.fromInclusive);
    const to = Date.parse(time.toExclusive);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
      throw new DeliveryQueryPlanValidationError("Absolute delivery time bounds are invalid.");
  }
  if (
    time.kind === "lookback" &&
    (!Number.isInteger(time.days) || time.days < 1 || time.days > 366)
  )
    throw new DeliveryQueryPlanValidationError("Delivery lookback must be between 1 and 366 days.");
};

export const validateDeliveryQueryPlan = (input: unknown): DeliveryQueryPlan => {
  if (typeof input !== "object" || input === null)
    throw new DeliveryQueryPlanValidationError("Delivery query plan must be an object.");
  const plan = input as Partial<DeliveryQueryPlan>;
  if (plan.version !== 1) throw new DeliveryQueryPlanValidationError("Unsupported plan version.");
  if (!Array.isArray(plan.intents) || plan.intents.length < 1 || plan.intents.length > 8)
    throw new DeliveryQueryPlanValidationError("Delivery query plan requires 1 to 8 intents.");
  if (!plan.intents.every((intent) => purposes.has(intent)))
    throw new DeliveryQueryPlanValidationError("Delivery query plan contains an unknown intent.");
  if (!Array.isArray(plan.operations) || plan.operations.length < 1 || plan.operations.length > 12)
    throw new DeliveryQueryPlanValidationError("Delivery query plan requires 1 to 12 operations.");
  for (const operation of plan.operations) {
    if (!selectors.has(operation.select))
      throw new DeliveryQueryPlanValidationError(
        "Delivery query plan contains an unknown selector.",
      );
    if (!purposes.has(operation.purpose))
      throw new DeliveryQueryPlanValidationError(
        "Delivery query operation has an unknown purpose.",
      );
    if (!Number.isInteger(operation.limit) || operation.limit < 1 || operation.limit > 20)
      throw new DeliveryQueryPlanValidationError("Delivery query operation limit must be 1 to 20.");
    if (operation.traversal !== undefined && ![1, 2].includes(operation.traversal.maximumDepth))
      throw new DeliveryQueryPlanValidationError(
        "Delivery relation traversal depth must be 1 or 2.",
      );
    assertTimeConstraint(operation.time);
  }
  if (plan.answerMode !== "deterministic" && plan.answerMode !== "model_assisted")
    throw new DeliveryQueryPlanValidationError("Delivery answer mode is invalid.");
  const maximumLines = plan.maximumLines;
  if (
    typeof maximumLines !== "number" ||
    !Number.isInteger(maximumLines) ||
    maximumLines < 2 ||
    maximumLines > 6
  )
    throw new DeliveryQueryPlanValidationError("Delivery answers must use two to six detail rows.");
  if (typeof plan.requiresFinance !== "boolean")
    throw new DeliveryQueryPlanValidationError("Delivery finance requirement must be explicit.");
  const selectsFinance = plan.operations.some(
    (operation) =>
      operation.purpose === "finance" || operation.metricCategories?.includes("finance") === true,
  );
  if (selectsFinance !== plan.requiresFinance)
    throw new DeliveryQueryPlanValidationError(
      "Finance operations and the plan finance boundary must agree.",
    );
  if (
    plan.requiredSources !== undefined &&
    (!Array.isArray(plan.requiredSources) ||
      !plan.requiredSources.every((source) =>
        ["jira", "vault", "github", "teams", "email"].includes(source),
      ))
  )
    throw new DeliveryQueryPlanValidationError("Delivery required sources are invalid.");
  if (plan.subject !== undefined) {
    const key = plan.subject.externalKey?.trim();
    const phrase = plan.subject.phrase?.trim();
    if ((key === undefined || key === "") && (phrase === undefined || phrase === ""))
      throw new DeliveryQueryPlanValidationError("Delivery query subject is empty.");
  }
  return plan as DeliveryQueryPlan;
};

const has = (value: string, pattern: RegExp): boolean => pattern.test(value);

export const planDeliveryQuestion = (question: string): DeliveryQueryPlan | undefined => {
  const value = question.replace(/\s+/g, " ").trim().toLowerCase();
  const intents: DeliveryQuestionIntent[] = [];
  const operations: DeliveryQueryOperation[] = [];
  const add = (
    intent: DeliveryQuestionIntent,
    operation: Omit<DeliveryQueryOperation, "id" | "purpose">,
  ) => {
    if (!intents.includes(intent)) intents.push(intent);
    operations.push({
      id: `${intent}-${operations.length + 1}`,
      purpose: intent,
      ...operation,
    });
  };
  const top = Math.max(1, Math.min(Number(/\btop\s+(\d{1,2})\b/.exec(value)?.[1] ?? 5), 10));
  const requestedLookbackDays = Math.max(
    1,
    Math.min(Number(/\blast\s+(\d{1,3})\s+days?\b/.exec(value)?.[1] ?? 120), 366),
  );
  const sprintTime: DeliveryTimeConstraint | undefined = has(value, /\blast sprint\b/)
    ? { kind: "jira_sprint", sprint: "previous" }
    : has(value, /\b(?:current|active|this) sprint\b/)
      ? { kind: "jira_sprint", sprint: "current" }
      : undefined;
  const exactKey = /\b([a-z][a-z0-9]+-\d+)\b/i.exec(value)?.[1]?.toUpperCase();
  const statusTarget = /\b(?:current |project |overall )?status of (.+?)(?:\?|$)/i
    .exec(question)?.[1]
    ?.trim();
  const implementationTarget =
    /\b(?:implement(?:s|ed|ing)?|code for)\s+(?:the\s+)?(.+?)(?:,|\band what\b|\?|$)/i
      .exec(question)?.[1]
      ?.trim();
  const ownershipTarget =
    /^\s*(?:who owns|who is (?:the )?owner of|owner of|ownership of)\s+(?:the\s+)?([^,?]+?)\s*\??\s*$/i
      .exec(question)?.[1]
      ?.trim();
  const subject: DeliveryQuerySubject | undefined =
    exactKey !== undefined
      ? { externalKey: exactKey }
      : statusTarget !== undefined
        ? { phrase: statusTarget }
        : implementationTarget !== undefined
          ? { phrase: implementationTarget }
          : ownershipTarget !== undefined
            ? { phrase: ownershipTarget }
            : undefined;
  const activityQuestion =
    has(value, /\bactivity\b/) ||
    (has(value, /\b(?:team|delivery|work)\b/) &&
      has(value, /\b(?:today|daily|summary|summarize|report|update|accomplished)\b/) &&
      !has(value, /\b(?:capacity|allocation|availability|bandwidth)\b/));

  if (has(value, /\b(?:scope|project boundary|in scope|out of scope)\b/))
    add("scope", {
      select: "objects",
      objectKinds: ["project", "module", "milestone", "deliverable"],
      limit: top,
    });
  if (has(value, /\b(?:goal|goals|objective|objectives|outcome|outcomes)\b/))
    add("goals", { select: "objects", objectKinds: ["goal"], limit: top });
  if (has(value, /\b(?:commitment|commitments|promise|promises|committed)\b/))
    add("commitments", {
      select: "objects",
      objectKinds: ["commitment", "deliverable"],
      limit: top,
    });
  if (has(value, /\b(?:requirement|requirements|acceptance criteria)\b/))
    add("requirements", {
      select: "objects",
      objectKinds: ["requirement"],
      limit: top,
    });
  if (has(value, /\b(?:who owns|ownership|owner|who is working on what)\b/))
    add("ownership", {
      select: "relations",
      relationKinds: ["owns", "assigned_to"],
      traversal: {
        kinds: ["owns", "assigned_to"],
        direction: "both",
        maximumDepth: 1,
      },
      limit: top,
    });
  if (has(value, /\b(?:waiting for review|review queue|needs? to review|review each|in review)\b/))
    add("reviews", {
      select: "observations",
      predicates: [{ field: "kind", operator: "equals", value: "review" }],
      time: sprintTime,
      limit: top,
    });
  if (has(value, /\b(?:waiting for whom|waits? on|dependenc(?:y|ies)|depends? on|blocked by)\b/))
    add("dependencies", {
      select: "relations",
      relationKinds: ["depends_on", "blocks"],
      traversal: {
        kinds: ["depends_on", "blocks"],
        direction: "both",
        maximumDepth: 2,
      },
      time: sprintTime,
      limit: top,
    });
  if (has(value, /\b(?:stuck|blocked|blocker|impediment|unable to progress)\b/))
    add("blockers", {
      select: "objects",
      objectKinds: ["work_item"],
      predicates: [
        {
          field: "lifecycleState",
          operator: "in",
          value: ["blocked", "impeded"],
        },
      ],
      time: sprintTime,
      limit: top,
    });
  if (has(value, /\b(?:deliver(?:ed)?|completed|shipped|finished)\b/))
    add("delivered", {
      select: "objects",
      objectKinds: ["work_item", "deliverable"],
      predicates: [
        {
          field: "lifecycleState",
          operator: "in",
          value: ["done", "delivered"],
        },
      ],
      time:
        sprintTime ??
        (has(value, /\blast week\b/) ? { kind: "workspace_previous_week" } : undefined),
      limit: top,
    });
  if (has(value, /\b(?:doing|working on|current work|in progress|this week)\b/))
    add("current_work", {
      select: "objects",
      objectKinds: ["work_item"],
      predicates: [
        {
          field: "lifecycleState",
          operator: "in",
          value: ["in_progress", "active"],
        },
      ],
      time: has(value, /\bthis week\b/) ? { kind: "workspace_week" } : sprintTime,
      limit: top,
    });
  if (has(value, /\b(?:risk|risks|at risk|concern|threat)\b/))
    add("risks", {
      select: "objects",
      objectKinds: ["risk"],
      orderBy: { field: "severity", direction: "desc" },
      limit: top,
    });
  if (has(value, /\b(?:recurring|repeated|repeat issue|keeps happening|pattern)\b/))
    add("recurring", {
      select: "observations",
      groupBy: ["dedupeKey"],
      measures: [{ operator: "count", minimumOccurrences: 2 }],
      time: { kind: "lookback", days: requestedLookbackDays },
      orderBy: { field: "observedAt", direction: "desc" },
      limit: top,
    });
  if (has(value, /\b(?:decision|decisions|decided|decision log)\b/))
    add("decisions", {
      select: "objects",
      objectKinds: ["decision"],
      limit: top,
    });
  if (activityQuestion)
    add("activity", {
      select: "observations",
      time:
        has(value, /\b(?:today|daily)\b/) || !has(value, /\bthis week\b/)
          ? { kind: "workspace_day" }
          : { kind: "workspace_week" },
      limit: top,
    });
  if (
    has(
      value,
      /\b(?:next action|next actions|next step|next steps|follow[- ]?up|what (?:should|do) (?:we|they|the team) do next|what should happen next)\b/,
    )
  )
    add("next_actions", {
      select: "objects",
      objectKinds: ["work_item", "deliverable", "milestone"],
      predicates: [
        {
          field: "lifecycleState",
          operator: "in",
          value: ["planned", "ready", "active", "in_progress", "blocked", "impeded"],
        },
      ],
      orderBy: { field: "dueAt", direction: "asc" },
      limit: top,
    });
  if (has(value, /\b(?:milestone|milestones|deadline|deadlines|timeline|due date|due dates)\b/))
    add("milestones", {
      select: "objects",
      objectKinds: ["milestone", "sprint", "deliverable"],
      orderBy: { field: "dueAt", direction: "asc" },
      limit: top,
    });
  if (has(value, /\b(?:capacity|allocation|availability|bandwidth)\b/)) {
    add("capacity", {
      select: "metrics",
      metricCategories: ["capacity"],
      time: has(value, /\btoday\b/)
        ? { kind: "workspace_day" }
        : has(value, /\bthis week\b/)
          ? { kind: "workspace_week" }
          : sprintTime,
      limit: top,
    });
    add("capacity", {
      select: "objects",
      objectKinds: ["person", "team"],
      predicates: [{ field: "label", operator: "equals", value: "capacity" }],
      time: has(value, /\btoday\b/) ? { kind: "workspace_day" } : undefined,
      limit: top,
    });
  }
  const nonFinancialBudget = has(
    value,
    /\b(?:response|time|latency|token|compute|memory|performance|retry|timeout)\s+budget\b/,
  );
  const financialQuestion =
    (has(value, /\bbudget\b/) && !nonFinancialBudget) ||
    has(
      value,
      /\b(?:cost|costs|billing|financial|finance|revenue|profit|profits|margin|margins|burn rate|hourly rate|day rate)\b/,
    );
  if (financialQuestion)
    add("finance", {
      select: "metrics",
      metricCategories: ["finance"],
      limit: top,
    });
  if (
    has(
      value,
      /\b(?:implementation|implemented|code|repository|pull requests?|prs?|commits?|function|class)\b/,
    )
  )
    add("implementation", { select: "github_live", limit: top });
  if (has(value, /\b(?:disagree|disagreement|conflict|conflicting)\b/)) {
    add("conflicts", { select: "conflicts", limit: top });
    add("conflicts", { select: "claims", limit: top });
    add("conflicts", { select: "github_live", limit: top });
  }
  if (has(value, /\b(?:current status|project status|status of|overall status)\b/))
    add("status", {
      select: "objects",
      objectKinds: [
        "project",
        "module",
        "milestone",
        "sprint",
        "work_item",
        "deliverable",
        "goal",
        "commitment",
        "action",
        "risk",
      ],
      predicates:
        exactKey !== undefined
          ? [{ field: "externalKey", operator: "equals", value: exactKey }]
          : statusTarget === undefined
            ? undefined
            : [{ field: "title", operator: "contains", value: statusTarget }],
      limit: top,
    });
  if (intents.includes("status")) add("status", { select: "knowledge", limit: top });

  if (operations.length === 0) {
    add("general", { select: "objects", limit: top });
    add("general", { select: "relations", limit: top });
    add("general", { select: "claims", limit: top });
    add("general", {
      select: "observations",
      time: { kind: "lookback", days: 120 },
      limit: top,
    });
    add("general", {
      select: "metrics",
      metricCategories: ["delivery", "capacity", "quality"],
      limit: top,
    });
    add("general", { select: "knowledge", limit: top });
  }
  return validateDeliveryQueryPlan({
    version: 1,
    intents,
    operations,
    answerMode: operations.some((operation) => operation.select === "knowledge")
      ? "model_assisted"
      : "deterministic",
    maximumLines: Math.max(3, Math.min(intents.length, 6)) as 3 | 4 | 5 | 6,
    requiresFinance: intents.includes("finance"),
    subject,
    requiredSources: intents.includes("implementation")
      ? ["github"]
      : intents.includes("conflicts")
        ? ["jira", "teams", "github"]
        : intents.includes("capacity")
          ? ["teams"]
          : undefined,
  });
};
