import { stableSha256 } from "../../../domain/hash.ts";
import type { DeliverySourceKind } from "../domain/delivery-model.ts";
import type { DeliveryQuestionIntent } from "../domain/delivery-query.ts";
import type { DeliveryResponseMode } from "../domain/delivery-response-mode.ts";
import type { DeliveryAssistantAnswer } from "../ports/delivery-intelligence-ports.ts";

export type DeliveryEvaluationCase = {
  readonly id: string;
  readonly question: string;
  readonly responseMode?: DeliveryResponseMode | undefined;
  readonly expected: {
    readonly outcome: "answer" | "deny";
    readonly failureOperation?: string | undefined;
    readonly intents?: readonly DeliveryQuestionIntent[] | undefined;
    readonly status?: DeliveryAssistantAnswer["status"] | undefined;
    readonly minimumCitations?: number | undefined;
    readonly citationSources?: readonly DeliverySourceKind[] | undefined;
    readonly requiredTerms?: readonly string[] | undefined;
    readonly forbiddenTerms?: readonly string[] | undefined;
    readonly reconstruction?: {
      readonly themeTerms: readonly string[];
      readonly initiativeTerms: readonly string[];
      readonly minimumThemeRecall: number;
      readonly minimumInitiativeRecall: number;
    };
    readonly acceptancePassed?: boolean | undefined;
    readonly ratedAnswerFingerprint?: string | undefined;
    readonly humanUsefulnessRating?: number | undefined;
  };
};

export type DeliveryEvaluationSet = {
  readonly version: 1;
  readonly thresholds: {
    readonly minimumPassRate: number;
    readonly minimumHumanUsefulnessAverage?: number | undefined;
  };
  readonly cases: readonly DeliveryEvaluationCase[];
};

export type DeliveryEvaluationOutcome =
  | { readonly kind: "answer"; readonly answer: DeliveryAssistantAnswer }
  | { readonly kind: "failure"; readonly operation?: string | undefined };

export type DeliveryEvaluationResult = {
  readonly id: string;
  readonly category: "quality" | "authorization";
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly outcome: "answer" | "deny";
  readonly answerFingerprint?: string | undefined;
  readonly responseMode?: DeliveryResponseMode | undefined;
  readonly status?: DeliveryAssistantAnswer["status"] | undefined;
  readonly intents?: readonly DeliveryQuestionIntent[] | undefined;
  readonly citationCount?: number | undefined;
  readonly acceptance?: DeliveryAssistantAnswer["acceptance"] | undefined;
  readonly humanUsefulnessRating?: number | undefined;
  readonly failureOperation?: string | undefined;
  readonly reconstruction?: {
    readonly matchedThemes: number;
    readonly totalThemes: number;
    readonly themeRecall: number;
    readonly matchedInitiatives: number;
    readonly totalInitiatives: number;
    readonly initiativeRecall: number;
    readonly passed: boolean;
  };
};

export type DeliveryEvaluationReport = {
  readonly version: 1;
  readonly passed: boolean;
  readonly total: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly passRate: number;
  readonly humanUsefulness: {
    readonly ratedCount: number;
    readonly answerCount: number;
    readonly average?: number | undefined;
    readonly minimum?: number | undefined;
    readonly passed: boolean;
  };
  readonly quality: {
    readonly answeredCount: number;
    readonly completenessPassRate: number;
    readonly citationPassRate: number;
    readonly groundingPassRate: number;
    readonly freshnessPassRate: number;
    readonly formatPassRate: number;
    readonly latencyPassRate: number;
  };
  readonly authorization: {
    readonly checkCount: number;
    readonly passedCount: number;
    readonly passRate: number;
  };
  readonly results: readonly DeliveryEvaluationResult[];
};

const responseModes = new Set<DeliveryResponseMode>(["fast", "structured", "deep_dive"]);
const statuses = new Set<DeliveryAssistantAnswer["status"]>(["ok", "partial", "empty"]);
const sourceKinds = new Set<DeliverySourceKind>([
  "jira",
  "vault",
  "github",
  "teams",
  "email",
  "strategy",
]);
const intents = new Set<DeliveryQuestionIntent>([
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validRate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const validStrings = (
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every(
    (entry) => typeof entry === "string" && entry.trim() !== "" && entry.length <= maximumLength,
  );

const optionalStrings = (
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is readonly string[] | undefined =>
  value === undefined || validStrings(value, maximumItems, maximumLength);

export const parseDeliveryEvaluationSet = (value: unknown): DeliveryEvaluationSet => {
  if (!isRecord(value) || value.version !== 1)
    throw new Error("Delivery evaluation set version must be 1.");
  if (!isRecord(value.thresholds) || !validRate(value.thresholds.minimumPassRate))
    throw new Error("Delivery evaluation minimum pass rate must be between 0 and 1.");
  const minimumHumanUsefulnessAverage = value.thresholds.minimumHumanUsefulnessAverage;
  if (
    minimumHumanUsefulnessAverage !== undefined &&
    (typeof minimumHumanUsefulnessAverage !== "number" ||
      !Number.isFinite(minimumHumanUsefulnessAverage) ||
      minimumHumanUsefulnessAverage < 1 ||
      minimumHumanUsefulnessAverage > 5)
  )
    throw new Error("Delivery evaluation human usefulness threshold must be between 1 and 5.");
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 50)
    throw new Error("Delivery evaluation set requires 1 to 50 cases.");
  const caseIds = new Set<string>();
  for (const candidate of value.cases) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(candidate.id) ||
      caseIds.has(candidate.id)
    )
      throw new Error("Delivery evaluation case IDs must be unique safe identifiers.");
    caseIds.add(candidate.id);
    if (
      typeof candidate.question !== "string" ||
      candidate.question.trim() === "" ||
      candidate.question.length > 500
    )
      throw new Error("Delivery evaluation questions must contain 1 to 500 characters.");
    if (
      candidate.responseMode !== undefined &&
      !responseModes.has(candidate.responseMode as DeliveryResponseMode)
    )
      throw new Error("Delivery evaluation response mode is invalid.");
    if (
      !isRecord(candidate.expected) ||
      (candidate.expected.outcome !== "answer" && candidate.expected.outcome !== "deny")
    )
      throw new Error("Delivery evaluation expected outcome must be answer or deny.");
    const expected = candidate.expected;
    if (
      expected.failureOperation !== undefined &&
      (typeof expected.failureOperation !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,99}$/.test(expected.failureOperation))
    )
      throw new Error("Delivery evaluation failure operation is invalid.");
    if (expected.outcome === "deny" && expected.failureOperation === undefined)
      throw new Error("Delivery evaluation denial cases require an exact failure operation.");
    if (expected.outcome === "answer" && expected.failureOperation !== undefined)
      throw new Error("Delivery evaluation answer cases cannot declare a failure operation.");
    if (
      expected.intents !== undefined &&
      (!validStrings(expected.intents, 8, 40) ||
        !expected.intents.every((intent) => intents.has(intent as DeliveryQuestionIntent)))
    )
      throw new Error("Delivery evaluation expected intents are invalid.");
    if (
      expected.status !== undefined &&
      !statuses.has(expected.status as DeliveryAssistantAnswer["status"])
    )
      throw new Error("Delivery evaluation expected status is invalid.");
    if (
      expected.minimumCitations !== undefined &&
      (!Number.isInteger(expected.minimumCitations) ||
        (expected.minimumCitations as number) < 0 ||
        (expected.minimumCitations as number) > 50)
    )
      throw new Error("Delivery evaluation minimum citations must be between 0 and 50.");
    if (
      expected.citationSources !== undefined &&
      (!validStrings(expected.citationSources, 5, 20) ||
        !expected.citationSources.every((source) => sourceKinds.has(source as DeliverySourceKind)))
    )
      throw new Error("Delivery evaluation citation sources are invalid.");
    if (
      !optionalStrings(expected.requiredTerms, 20, 120) ||
      !optionalStrings(expected.forbiddenTerms, 20, 120)
    )
      throw new Error("Delivery evaluation answer terms are invalid.");
    if (expected.reconstruction !== undefined) {
      if (
        !isRecord(expected.reconstruction) ||
        !validStrings(expected.reconstruction.themeTerms, 20, 160) ||
        expected.reconstruction.themeTerms.length === 0 ||
        !validStrings(expected.reconstruction.initiativeTerms, 100, 160) ||
        expected.reconstruction.initiativeTerms.length === 0 ||
        !validRate(expected.reconstruction.minimumThemeRecall) ||
        !validRate(expected.reconstruction.minimumInitiativeRecall)
      )
        throw new Error("Delivery evaluation reconstruction benchmark is invalid.");
      if (expected.outcome !== "answer")
        throw new Error("Delivery reconstruction benchmarks require an answer outcome.");
    }
    if (expected.acceptancePassed !== undefined && typeof expected.acceptancePassed !== "boolean")
      throw new Error("Delivery evaluation acceptance expectation must be boolean.");
    if (
      expected.humanUsefulnessRating !== undefined &&
      (typeof expected.humanUsefulnessRating !== "number" ||
        !Number.isInteger(expected.humanUsefulnessRating) ||
        expected.humanUsefulnessRating < 1 ||
        expected.humanUsefulnessRating > 5)
    )
      throw new Error(
        "Delivery evaluation human usefulness rating must be an integer from 1 to 5.",
      );
    if (
      expected.ratedAnswerFingerprint !== undefined &&
      (typeof expected.ratedAnswerFingerprint !== "string" ||
        !/^sha256-[a-f0-9]{64}$/.test(expected.ratedAnswerFingerprint))
    )
      throw new Error("Delivery evaluation rated answer fingerprint is invalid.");
    if (
      (expected.humanUsefulnessRating === undefined) !==
      (expected.ratedAnswerFingerprint === undefined)
    )
      throw new Error(
        "Delivery evaluation human rating and answer fingerprint must be supplied together.",
      );
    if (
      expected.outcome === "deny" &&
      (expected.humanUsefulnessRating !== undefined ||
        expected.ratedAnswerFingerprint !== undefined)
    )
      throw new Error("Delivery evaluation denial cases cannot carry human answer ratings.");
    if (
      expected.acceptancePassed === false &&
      (expected.humanUsefulnessRating !== undefined ||
        expected.ratedAnswerFingerprint !== undefined)
    )
      throw new Error(
        "Delivery evaluation authorization cases cannot carry human usefulness ratings.",
      );
  }
  return value as DeliveryEvaluationSet;
};

const normalized = (value: string): string => value.toLocaleLowerCase("en");
const termRecall = (
  text: string,
  terms: readonly string[],
): { readonly matched: number; readonly total: number; readonly recall: number } => {
  const normalizedText = normalized(text).normalize("NFKC").replace(/\s+/g, " ");
  const matched = terms.filter((term) =>
    normalizedText.includes(normalized(term).normalize("NFKC").replace(/\s+/g, " ")),
  ).length;
  return {
    matched,
    total: terms.length,
    recall: Number((matched / terms.length).toFixed(4)),
  };
};
const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index]);

const citationSources = (answer: DeliveryAssistantAnswer): ReadonlySet<string> =>
  new Set(
    answer.citations.flatMap(({ label }) => {
      const source = label.split(/\s+/)[0]?.toLocaleLowerCase("en");
      return source === undefined ? [] : [source];
    }),
  );

export const evaluateDeliveryCase = (
  evaluationCase: DeliveryEvaluationCase,
  outcome: DeliveryEvaluationOutcome,
): DeliveryEvaluationResult => {
  const failures: string[] = [];
  const category =
    evaluationCase.expected.outcome === "deny" || evaluationCase.expected.acceptancePassed === false
      ? "authorization"
      : "quality";
  if (outcome.kind === "failure") {
    if (evaluationCase.expected.outcome !== "deny") failures.push("unexpected_denial");
    if (
      evaluationCase.expected.failureOperation !== undefined &&
      outcome.operation !== evaluationCase.expected.failureOperation
    )
      failures.push("denial_operation_mismatch");
    return {
      id: evaluationCase.id,
      category,
      passed: failures.length === 0,
      failures,
      outcome: "deny",
      failureOperation: outcome.operation,
    };
  }

  const { answer } = outcome;
  const answerFingerprint = stableSha256(answer.text);
  const ratingMatches =
    evaluationCase.expected.ratedAnswerFingerprint === undefined ||
    evaluationCase.expected.ratedAnswerFingerprint === answerFingerprint;
  if (evaluationCase.expected.outcome === "deny") failures.push("unexpected_answer");
  if (
    evaluationCase.expected.intents !== undefined &&
    !sameSet(answer.plan.intents, evaluationCase.expected.intents)
  )
    failures.push("intent_mismatch");
  if (
    evaluationCase.expected.status !== undefined &&
    answer.status !== evaluationCase.expected.status
  )
    failures.push("status_mismatch");
  if (answer.citations.length < (evaluationCase.expected.minimumCitations ?? 0))
    failures.push("citation_count_below_minimum");
  const observedSources = citationSources(answer);
  if (evaluationCase.expected.citationSources?.some((source) => !observedSources.has(source)))
    failures.push("required_citation_source_missing");
  const text = normalized(answer.text);
  if (evaluationCase.expected.requiredTerms?.some((term) => !text.includes(normalized(term))))
    failures.push("required_term_missing");
  if (evaluationCase.expected.forbiddenTerms?.some((term) => text.includes(normalized(term))))
    failures.push("forbidden_term_present");
  if (answer.acceptance.passed !== (evaluationCase.expected.acceptancePassed ?? true))
    failures.push("acceptance_mismatch");
  if (!ratingMatches) failures.push("human_rating_fingerprint_mismatch");
  const reconstruction =
    evaluationCase.expected.reconstruction === undefined
      ? undefined
      : (() => {
          const themes = termRecall(answer.text, evaluationCase.expected.reconstruction.themeTerms);
          const initiatives = termRecall(
            answer.text,
            evaluationCase.expected.reconstruction.initiativeTerms,
          );
          const passed =
            themes.recall >= evaluationCase.expected.reconstruction.minimumThemeRecall &&
            initiatives.recall >= evaluationCase.expected.reconstruction.minimumInitiativeRecall;
          if (themes.recall < evaluationCase.expected.reconstruction.minimumThemeRecall)
            failures.push("theme_recall_below_minimum");
          if (initiatives.recall < evaluationCase.expected.reconstruction.minimumInitiativeRecall)
            failures.push("initiative_recall_below_minimum");
          return {
            matchedThemes: themes.matched,
            totalThemes: themes.total,
            themeRecall: themes.recall,
            matchedInitiatives: initiatives.matched,
            totalInitiatives: initiatives.total,
            initiativeRecall: initiatives.recall,
            passed,
          };
        })();
  return {
    id: evaluationCase.id,
    category,
    passed: failures.length === 0,
    failures,
    outcome: "answer",
    answerFingerprint,
    responseMode: answer.responseMode,
    status: answer.status,
    intents: answer.plan.intents,
    citationCount: answer.citations.length,
    acceptance: answer.acceptance,
    humanUsefulnessRating: ratingMatches
      ? evaluationCase.expected.humanUsefulnessRating
      : undefined,
    ...(reconstruction === undefined ? {} : { reconstruction }),
  };
};

const rate = (values: readonly boolean[]): number =>
  values.length === 0 ? 1 : Number((values.filter(Boolean).length / values.length).toFixed(4));

export const summarizeDeliveryEvaluation = (
  evaluationSet: DeliveryEvaluationSet,
  results: readonly DeliveryEvaluationResult[],
): DeliveryEvaluationReport => {
  const answered = results.filter(
    (
      result,
    ): result is DeliveryEvaluationResult & {
      readonly acceptance: DeliveryAssistantAnswer["acceptance"];
    } =>
      result.category === "quality" &&
      result.outcome === "answer" &&
      result.acceptance !== undefined,
  );
  const authorization = results.filter((result) => result.category === "authorization");
  const ratings = answered.flatMap((result) =>
    result.humanUsefulnessRating === undefined ? [] : [result.humanUsefulnessRating],
  );
  const humanAverage =
    ratings.length === 0
      ? undefined
      : Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2));
  const minimumHuman = evaluationSet.thresholds.minimumHumanUsefulnessAverage;
  const humanPassed =
    minimumHuman === undefined ||
    (ratings.length === answered.length &&
      humanAverage !== undefined &&
      humanAverage >= minimumHuman);
  const passedCount = results.filter((result) => result.passed).length;
  const passRate = rate(results.map((result) => result.passed));
  return {
    version: 1,
    passed:
      results.length === evaluationSet.cases.length &&
      passRate >= evaluationSet.thresholds.minimumPassRate &&
      humanPassed,
    total: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    passRate,
    humanUsefulness: {
      ratedCount: ratings.length,
      answerCount: answered.length,
      average: humanAverage,
      minimum: minimumHuman,
      passed: humanPassed,
    },
    quality: {
      answeredCount: answered.length,
      completenessPassRate: rate(answered.map((result) => result.acceptance.completenessPassed)),
      citationPassRate: rate(answered.map((result) => result.acceptance.citationPassed)),
      groundingPassRate: rate(answered.map((result) => result.acceptance.groundingPassed)),
      freshnessPassRate: rate(answered.map((result) => result.acceptance.freshnessPassed)),
      formatPassRate: rate(answered.map((result) => result.acceptance.formatPassed)),
      latencyPassRate: rate(answered.map((result) => result.acceptance.latencyPassed)),
    },
    authorization: {
      checkCount: authorization.length,
      passedCount: authorization.filter((result) => result.passed).length,
      passRate: rate(authorization.map((result) => result.passed)),
    },
    results,
  };
};
