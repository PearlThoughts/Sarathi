export type DeliveryResponseMode = "fast" | "structured" | "deep_dive";

export type DeliveryResponseModePolicy = {
  readonly mode: DeliveryResponseMode;
  readonly sourceTimeoutMs: number;
  readonly compositionTimeoutMs: number;
  readonly totalBudgetMs: number;
  readonly latencyTargetMs: number;
  readonly maximumLines: number;
  readonly maximumItems: number;
  readonly freshnessWindowMs: number;
};

export const deliveryResponseModePolicies: Readonly<
  Record<DeliveryResponseMode, DeliveryResponseModePolicy>
> = {
  fast: {
    mode: "fast",
    sourceTimeoutMs: 4_500,
    compositionTimeoutMs: 2_500,
    totalBudgetMs: 6_500,
    latencyTargetMs: 10_000,
    maximumLines: 5,
    maximumItems: 12,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
  structured: {
    mode: "structured",
    sourceTimeoutMs: 8_000,
    compositionTimeoutMs: 4_000,
    totalBudgetMs: 12_000,
    latencyTargetMs: 15_000,
    maximumLines: 12,
    maximumItems: 24,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
  deep_dive: {
    mode: "deep_dive",
    sourceTimeoutMs: 20_000,
    compositionTimeoutMs: 10_000,
    totalBudgetMs: 30_000,
    latencyTargetMs: 45_000,
    maximumLines: 30,
    maximumItems: 50,
    freshnessWindowMs: 2 * 60 * 60 * 1_000,
  },
};

const explicitDeepDive =
  /\b(?:deep[ -]?dive|comprehensive|investigat(?:e|ion)|root[ -]?cause|full history|historical analysis|trend analysis|detailed report)\b/i;
const structuredBrief =
  /\b(?:structured brief|status report|weekly report|sprint report|release report|risk report|comparison|compare|quarterly|executive brief)\b/i;

export const selectDeliveryResponseMode = (
  question: string,
  requestedMode?: DeliveryResponseMode | undefined,
): DeliveryResponseMode => {
  if (requestedMode !== undefined) return requestedMode;
  if (explicitDeepDive.test(question)) return "deep_dive";
  if (structuredBrief.test(question)) return "structured";
  return "fast";
};
