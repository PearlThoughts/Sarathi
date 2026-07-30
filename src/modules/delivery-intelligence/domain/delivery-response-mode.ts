export type DeliveryResponseMode = "fast" | "structured" | "deep_dive";

export type DeliveryResponseProduct =
  | "operational_answer"
  | "period_delivery_brief"
  | "leadership_report"
  | "implementation_investigation";

export type DeliveryResponseModePolicy = {
  readonly mode: DeliveryResponseMode;
  readonly sourceTimeoutMs: number;
  readonly compositionTimeoutMs: number;
  readonly totalBudgetMs: number;
  readonly latencyTargetMs?: number | undefined;
  readonly maximumLines?: number | undefined;
  readonly maximumItems?: number | undefined;
  readonly freshnessWindowMs: number;
};

export type DeliveryResponseProductPolicy = {
  readonly product: DeliveryResponseProduct;
  readonly responseMode: DeliveryResponseMode;
};

export const deliveryResponseModePolicies: Readonly<
  Record<DeliveryResponseMode, DeliveryResponseModePolicy>
> = {
  fast: {
    mode: "fast",
    sourceTimeoutMs: 15_000,
    compositionTimeoutMs: 15_000,
    totalBudgetMs: 30_000,
    maximumItems: 12,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
  structured: {
    mode: "structured",
    sourceTimeoutMs: 30_000,
    compositionTimeoutMs: 30_000,
    totalBudgetMs: 60_000,
    maximumItems: 24,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
  deep_dive: {
    mode: "deep_dive",
    sourceTimeoutMs: 90_000,
    compositionTimeoutMs: 120_000,
    totalBudgetMs: 240_000,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
};

export const deliveryResponseProductPolicies: Readonly<
  Record<DeliveryResponseProduct, DeliveryResponseProductPolicy>
> = {
  operational_answer: {
    product: "operational_answer",
    responseMode: "fast",
  },
  period_delivery_brief: {
    product: "period_delivery_brief",
    responseMode: "deep_dive",
  },
  leadership_report: {
    product: "leadership_report",
    responseMode: "deep_dive",
  },
  implementation_investigation: {
    product: "implementation_investigation",
    responseMode: "deep_dive",
  },
};

const explicitDeepDive =
  /\b(?:deep[ -]?dive|comprehensive|investigat(?:e|ion)|root[ -]?cause|full history|historical analysis|trend analysis|detailed report)\b/i;
const structuredBrief =
  /\b(?:structured brief|status report|weekly report|sprint report|release report|risk report|comparison|compare|quarterly|executive brief)\b/i;

const leadershipReport =
  /\b(?:leadership report|executive report|quarterly report|comprehensive (?:delivery )?report)\b|\b(?:delivered|delivery|completed|shipped|finished)\b.*\b(?:this|current|last|previous)\s+quarter\b|\b(?:this|current|last|previous)\s+quarter\b.*\b(?:delivered|delivery|completed|shipped|finished)\b/i;
const implementationInvestigation =
  /\b(?:implementation investigation|investigat(?:e|ion).*(?:implementation|code|repository)|(?:implementation|code|repository).*(?:deep[ -]?dive|investigat(?:e|ion)))\b/i;
const periodDeliveryBrief =
  /\b(?:yesterday|this\s+week|last\s+week|previous\s+week|weekly|sprint|release|monthly|month|quarterly|quarter|period|last\s+\d{1,3}\s+days?)\b.*\b(?:deliver(?:y|ed)?|status|report|brief|summary|done|accomplished|achieved)\b|\b(?:deliver(?:y|ed)?|status|report|brief|summary|done|accomplished|achieved)\b.*\b(?:yesterday|this\s+week|last\s+week|previous\s+week|weekly|sprint|release|monthly|month|quarterly|quarter|period|last\s+\d{1,3}\s+days?)\b|\bwhat\s+did\b.{0,80}\bdo\b.{0,80}\b(?:yesterday|this\s+week|last\s+week|previous\s+week|last\s+\d{1,3}\s+days?)\b/i;

export const selectDeliveryResponseProduct = (
  question: string,
  requestedProduct?: DeliveryResponseProduct | undefined,
): DeliveryResponseProduct => {
  if (requestedProduct !== undefined) return requestedProduct;
  if (implementationInvestigation.test(question)) return "implementation_investigation";
  if (leadershipReport.test(question)) return "leadership_report";
  if (periodDeliveryBrief.test(question)) return "period_delivery_brief";
  return "operational_answer";
};

export const selectDeliveryResponseMode = (
  question: string,
  requestedMode?: DeliveryResponseMode | undefined,
  responseProduct?: DeliveryResponseProduct | undefined,
): DeliveryResponseMode => {
  if (requestedMode !== undefined) return requestedMode;
  if (responseProduct !== undefined)
    return deliveryResponseProductPolicies[responseProduct].responseMode;
  if (explicitDeepDive.test(question)) return "deep_dive";
  if (structuredBrief.test(question)) return "structured";
  return "fast";
};

export const deliveryTransportTimeoutMs = (
  product: DeliveryResponseProduct,
  configuredFastTimeoutMs?: number | undefined,
): number => {
  const responseMode = deliveryResponseProductPolicies[product].responseMode;
  const totalBudgetMs = deliveryResponseModePolicies[responseMode].totalBudgetMs;
  if (product !== "operational_answer") return totalBudgetMs + 5_000;
  return Math.max(100, Math.min(configuredFastTimeoutMs ?? totalBudgetMs + 500, 35_000));
};
