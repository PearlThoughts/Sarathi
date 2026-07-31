import type { DeliverySourceKind } from "./delivery-model.ts";
import type { DeliveryCompletionStage, PeriodCensus } from "./period-census.ts";

type DeliveryEpisodeLifecycle =
  | "scoped"
  | "implementing"
  | "development_ready"
  | "qa"
  | "production"
  | "accepted";

type DeliveryEpisodeAlignment =
  | "governed_initiative"
  | "operational_support"
  | "emerging_requirement"
  | "unaccounted_work";

export type PeriodDeliveryEvidence = {
  readonly title: string;
  readonly summary: string;
  readonly citationUrl: string;
  readonly source: DeliverySourceKind;
  readonly selector: string;
  readonly intent?: string | undefined;
  readonly subjectAliases?: readonly string[] | undefined;
  readonly dedupeKey: string;
  readonly observedAt?: string | undefined;
  readonly completionStage?: DeliveryCompletionStage | undefined;
  readonly lifecycleState?:
    | "planned"
    | "active"
    | "blocked"
    | "done"
    | "canceled"
    | "unknown"
    | undefined;
  readonly evidenceRole?: "declared_intent" | "observed_evidence" | undefined;
  readonly owner?: { readonly displayName: string } | undefined;
  readonly actionTarget?: { readonly displayName: string } | undefined;
  readonly planning?:
    | {
        readonly externalKey: string;
        readonly status: string;
        readonly sprint?: string | undefined;
        readonly hasDependency: boolean;
        readonly hasAcceptanceInformation: boolean;
        readonly previousSprint?: SprintReference | undefined;
        readonly currentSprint?: SprintReference | undefined;
        readonly sprintClassifications?: readonly SprintClassification[] | undefined;
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
};

type SprintClassification =
  | "planned_at_start"
  | "added_during_sprint"
  | "completed_during_sprint"
  | "rolled_into_current"
  | "dropped"
  | "current_sprint";

type SprintReference = {
  readonly id?: string | undefined;
  readonly name: string;
  readonly state: "active" | "closed" | "future" | "unknown";
  readonly startAt?: string | undefined;
  readonly endAt?: string | undefined;
  readonly completeAt?: string | undefined;
};

export type CapabilityAlias = {
  readonly value: string;
  readonly source?: DeliverySourceKind | undefined;
};

export type CapabilityDefinition = {
  readonly key: string;
  readonly title: string;
  readonly aliases: readonly CapabilityAlias[];
  readonly alignment?: "governed_initiative" | "operational_support" | undefined;
};

export type CapabilityLedger = {
  readonly version: 1;
  readonly capabilities: readonly CapabilityDefinition[];
};

export type DeliveryChainStage = {
  readonly stage:
    | "planned"
    | "implemented"
    | "reviewed"
    | "merged"
    | "checks_passed"
    | "released"
    | "deployed"
    | "accepted"
    | "impact_observed";
  readonly state: "observed" | "missing";
  readonly citations: readonly string[];
};

export type OutcomeAssertion =
  | {
      readonly evidenceClass: "observedOutcome" | "claimedImpact" | "inferredImpact";
      readonly statement: string;
      readonly citations: readonly string[];
      readonly confidence?: number | undefined;
    }
  | {
      readonly evidenceClass: "unknown";
      readonly statement: string;
      readonly citations: readonly [];
    };

export type HumanDependency = {
  readonly waiting: string;
  readonly awaited: string;
  readonly since?: string | undefined;
  readonly requiredAction: string;
  readonly episodeId: string;
  readonly capabilityKey?: string | undefined;
  readonly citations: readonly string[];
};

export type JiraHygieneAdvisory = {
  readonly kind:
    | "missing_jira_item"
    | "contradictory_status"
    | "missing_owner"
    | "missing_sprint"
    | "missing_dependency"
    | "missing_acceptance"
    | "review_for_closure";
  readonly episodeId: string;
  readonly message: string;
  readonly citations: readonly string[];
};

export type ChangeCapsule = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly latestActivityAt: string;
  readonly completedAt?: string | undefined;
  readonly completionStage?: DeliveryCompletionStage | undefined;
  readonly lifecycleState: DeliveryEpisodeLifecycle;
  readonly alignment: DeliveryEpisodeAlignment;
  readonly initiativeTitle?: string | undefined;
  readonly capabilityKeys: readonly string[];
  readonly sprintClassifications: readonly SprintClassification[];
  readonly blocked: boolean;
  readonly owners: readonly string[];
  readonly sources: readonly DeliverySourceKind[];
  readonly citations: readonly {
    readonly source: DeliverySourceKind;
    readonly url: string;
  }[];
  readonly dependencies: readonly HumanDependency[];
  readonly jiraAdvisories: readonly JiraHygieneAdvisory[];
  readonly chain: readonly DeliveryChainStage[];
};

type InitiativeProgress = {
  readonly id: string;
  readonly title: string;
  readonly health: "Green" | "Amber" | "Red" | "Unknown";
  readonly healthExplanation: string;
  readonly progress: "scoped" | "moving" | "at risk" | "stalled" | "unknown";
  readonly currentSprintCapsules: readonly ChangeCapsule[];
  readonly completedQuarterToDateCapsules: readonly ChangeCapsule[];
  readonly activeCapsules: readonly ChangeCapsule[];
  readonly blockedOrWaitingCapsules: readonly ChangeCapsule[];
  readonly rolloverCapsules: readonly ChangeCapsule[];
};

export type SprintReviewProjection = {
  readonly previousSprint?: SprintReference | undefined;
  readonly currentSprint?: SprintReference | undefined;
  readonly plannedAtStart: readonly ChangeCapsule[];
  readonly addedDuringSprint: readonly ChangeCapsule[];
  readonly completedDuringSprint: readonly ChangeCapsule[];
  readonly rolledIntoCurrent: readonly ChangeCapsule[];
  readonly dropped: readonly ChangeCapsule[];
  readonly currentSprintWork: readonly ChangeCapsule[];
  readonly initiatives: readonly InitiativeProgress[];
  readonly initiativesWithoutCurrentSprintActivity: readonly InitiativeProgress[];
  readonly unaccountedWork: readonly ChangeCapsule[];
};

export type PeriodDeliveryReport = {
  readonly version: 1;
  readonly census: PeriodCensus;
  readonly capsules: readonly ChangeCapsule[];
  readonly deliveredEpisodes: readonly ChangeCapsule[];
  readonly inProgressEpisodes: readonly ChangeCapsule[];
  readonly dependencies: readonly HumanDependency[];
  readonly decisionsNeeded: readonly string[];
  readonly jiraAdvisories: readonly JiraHygieneAdvisory[];
  readonly capabilitySections: readonly {
    readonly key: string;
    readonly title: string;
    readonly evidencedAliases: readonly string[];
    readonly capsules: readonly ChangeCapsule[];
    readonly outcomes: readonly OutcomeAssertion[];
  }[];
  readonly unmappedCapsules: readonly ChangeCapsule[];
  readonly excludedImmaterialActivityCount: number;
  readonly incompleteChainCount: number;
  readonly sprintReview?: SprintReviewProjection | undefined;
};

const normalized = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const evidenceText = (item: PeriodDeliveryEvidence): string =>
  [item.title, item.summary, item.citationUrl, ...(item.subjectAliases ?? [])].join("\n");

const workItemKey = (value: string): string | undefined =>
  value.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0];

const pullRequestKey = (value: string): string | undefined => {
  const match = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i.exec(value);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : `github:${match[1].toLocaleLowerCase("en")}:pull:${match[2]}`;
};

const capsuleKey = (item: PeriodDeliveryEvidence): string => {
  const text = evidenceText(item);
  return workItemKey(text) ?? pullRequestKey(text) ?? item.dedupeKey;
};

const completionStage = (
  items: readonly PeriodDeliveryEvidence[],
): DeliveryCompletionStage | undefined =>
  items.some((item) => item.completionStage === "accepted")
    ? "accepted"
    : items.some((item) => item.completionStage === "deployed")
      ? "deployed"
      : items.some((item) => item.completionStage === "released")
        ? "released"
        : items.some(
              (item) =>
                item.completionStage === "merged" || item.completionStage === "development_ready",
            )
          ? "merged"
          : undefined;

const lifecycleRank: Readonly<Record<DeliveryEpisodeLifecycle, number>> = {
  scoped: 0,
  implementing: 1,
  development_ready: 2,
  qa: 3,
  production: 4,
  accepted: 5,
};

const lifecycleForItem = (item: PeriodDeliveryEvidence): DeliveryEpisodeLifecycle => {
  const text = normalized(evidenceText(item));
  const awaitingAcceptance = /\b(?:waiting|waits on|pending|needs?|requires?)\b/.test(text);
  if (
    item.completionStage === "accepted" ||
    (!awaitingAcceptance &&
      /\b(?:stakeholder|client|responsible owner|product owner)\b.{0,40}\b(?:accepted|approved|sign off|signed off)\b/.test(
        text,
      ))
  )
    return "accepted";
  if (
    item.completionStage === "deployed" ||
    item.completionStage === "released" ||
    /\bproduction|deployed|released|went live|live environment\b/.test(text)
  )
    return "production";
  if (/\bqa|quality assurance|uat|testing|test ready|in review\b/.test(text)) return "qa";
  if (
    item.completionStage === "merged" ||
    item.completionStage === "development_ready" ||
    /\bmerged|development ready|dev ready\b/.test(text)
  )
    return "development_ready";
  if (
    item.lifecycleState === "active" ||
    item.lifecycleState === "blocked" ||
    item.intent === "current_work" ||
    /\bimplementing|in progress|working on|underway\b/.test(text)
  )
    return "implementing";
  return "scoped";
};

const lifecycleFor = (items: readonly PeriodDeliveryEvidence[]): DeliveryEpisodeLifecycle =>
  items
    .map(lifecycleForItem)
    .toSorted((left, right) => lifecycleRank[right] - lifecycleRank[left])[0] ?? "scoped";

const stageOrder = [
  "planned",
  "implemented",
  "reviewed",
  "merged",
  "checks_passed",
  "released",
  "deployed",
  "accepted",
  "impact_observed",
] as const;

const chainFor = (
  stage: DeliveryEpisodeLifecycle,
  citations: readonly string[],
): readonly DeliveryChainStage[] => {
  const observedThrough: Readonly<Record<DeliveryEpisodeLifecycle, number>> = {
    scoped: 0,
    implementing: 1,
    development_ready: 3,
    qa: 4,
    production: 6,
    accepted: 7,
  };
  return stageOrder.map((candidate, index) => ({
    stage: candidate,
    state: index <= observedThrough[stage] ? "observed" : "missing",
    citations: index <= observedThrough[stage] ? citations : [],
  }));
};

const capabilityMatchFor = (
  items: readonly PeriodDeliveryEvidence[],
  ledger: CapabilityLedger,
): {
  readonly keys: readonly string[];
  readonly evidenceScore: number;
  readonly matchedAliasIndexes: readonly number[];
} => {
  const text = normalized(items.map(evidenceText).join("\n"));
  const searchable = ` ${text} `;
  const matches = ledger.capabilities.flatMap((capability, capabilityIndex) => {
    const scores = capability.aliases.flatMap((alias, aliasIndex) => {
      const value = normalized(alias.value);
      if (
        value === "" ||
        (alias.source !== undefined && !items.some((item) => item.source === alias.source)) ||
        !searchable.includes(` ${value} `)
      )
        return [];
      return [
        {
          aliasIndex,
          score:
            value.split(" ").length * 1_000 +
            value.length +
            (alias.source === undefined ? 0 : 100_000),
        },
      ];
    });
    const score = Math.max(
      ...scores.map(({ score: aliasScore }) => aliasScore),
      Number.NEGATIVE_INFINITY,
    );
    return Number.isFinite(score)
      ? [
          {
            key: capability.key,
            score,
            capabilityIndex,
            matchedAliasIndexes: scores.map(({ aliasIndex }) => aliasIndex),
          },
        ]
      : [];
  });
  const primary = matches.toSorted(
    (left, right) => right.score - left.score || left.capabilityIndex - right.capabilityIndex,
  )[0];
  return primary === undefined
    ? { keys: [], evidenceScore: 0, matchedAliasIndexes: [] }
    : {
        keys: [primary.key],
        evidenceScore: primary.score,
        matchedAliasIndexes: primary.matchedAliasIndexes,
      };
};

type CapabilityMatch = ReturnType<typeof capabilityMatchFor>;

const orderForAliasCoverage = (
  capsules: readonly ChangeCapsule[],
  matches: ReadonlyMap<string, CapabilityMatch>,
): readonly ChangeCapsule[] => {
  const coveredAliases = new Set<number>();
  const remaining = [...capsules];
  const ordered: ChangeCapsule[] = [];
  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftMatch = matches.get(left.id);
      const rightMatch = matches.get(right.id);
      const leftNewAliases =
        leftMatch?.matchedAliasIndexes.filter((index) => !coveredAliases.has(index)).length ?? 0;
      const rightNewAliases =
        rightMatch?.matchedAliasIndexes.filter((index) => !coveredAliases.has(index)).length ?? 0;
      return (
        rightNewAliases - leftNewAliases ||
        (rightMatch?.evidenceScore ?? 0) - (leftMatch?.evidenceScore ?? 0) ||
        lifecycleRank[right.lifecycleState] - lifecycleRank[left.lifecycleState] ||
        Date.parse(right.latestActivityAt) - Date.parse(left.latestActivityAt) ||
        left.title.localeCompare(right.title)
      );
    });
    const selected = remaining.shift();
    if (selected === undefined) break;
    ordered.push(selected);
    for (const aliasIndex of matches.get(selected.id)?.matchedAliasIndexes ?? [])
      coveredAliases.add(aliasIndex);
  }
  return ordered;
};

const negativeCoverage = (item: PeriodDeliveryEvidence): boolean =>
  /(?:^|:)coverage:/.test(item.dedupeKey) ||
  /^no (?:explicit|matching|blocked|connected)\b/i.test(item.summary.trim());

const materialEvidence = (item: PeriodDeliveryEvidence, ledger: CapabilityLedger): boolean => {
  if (item.evidenceRole === "declared_intent" || negativeCoverage(item)) return false;
  if (item.selector === "period_census") {
    if (item.completionStage === undefined) return false;
    const text = evidenceText(item);
    if (
      /\b(?:unclassified|generic) (?:repository )?maintenance\b|\bmerge branch\b|\bdependency bump\b/i.test(
        text,
      ) &&
      capabilityMatchFor([item], ledger).keys.length === 0
    )
      return false;
    return true;
  }
  if (
    ["current_work", "dependencies", "blockers", "decisions", "requirements"].includes(
      item.intent ?? "",
    )
  )
    return true;
  if (
    !(["knowledge", "observations", "objects", "relations"] as readonly string[]).includes(
      item.selector,
    )
  )
    return false;
  const actionable =
    /\bwait(?:ing|s)?|blocked|approved|decision|requirement|qa|testing|production|deployed|released|merged|implement(?:ing|ed)?\b/i.test(
      evidenceText(item),
    );
  return actionable && capabilityMatchFor([item], ledger).keys.length > 0;
};

const dependencyFor = (
  item: PeriodDeliveryEvidence,
  episodeId: string,
  capabilityKey?: string,
): HumanDependency | undefined => {
  const jira =
    /\b[A-Z][A-Z0-9]+-\d+\s+\(([^)]+)\)\s+waits on\s+[A-Z][A-Z0-9]+-\d+\s+\(([^)]+)\)/i.exec(
      item.summary,
    );
  const human = /\b(.{1,80}?)\s+(?:is\s+)?waiting for\s+(.{1,100}?)(?:[.;]|$)/i.exec(item.summary);
  const waiting = jira?.[1]?.trim() ?? human?.[1]?.trim() ?? item.owner?.displayName;
  const awaited = jira?.[2]?.trim() ?? item.actionTarget?.displayName ?? human?.[2]?.trim();
  if (waiting === undefined || awaited === undefined) return undefined;
  return {
    waiting,
    awaited,
    since: item.observedAt,
    requiredAction: item.summary.trim(),
    episodeId,
    ...(capabilityKey === undefined ? {} : { capabilityKey }),
    citations: [item.citationUrl],
  };
};

const jiraAdvisoriesFor = (
  episodeId: string,
  items: readonly PeriodDeliveryEvidence[],
  lifecycle: DeliveryEpisodeLifecycle,
): readonly JiraHygieneAdvisory[] => {
  const citations = items.map(({ citationUrl }) => citationUrl);
  const jira = items.find((item) => item.source === "jira");
  if (jira === undefined)
    return [
      {
        kind: "missing_jira_item",
        episodeId,
        message: "Material work has no linked Jira item.",
        citations,
      },
    ];
  const context = jira.planning;
  const advisories: JiraHygieneAdvisory[] = [];
  const add = (kind: JiraHygieneAdvisory["kind"], message: string): void => {
    advisories.push({ kind, episodeId, message, citations: [jira.citationUrl] });
  };
  if (jira.owner === undefined)
    add("missing_owner", `${context?.externalKey ?? jira.title} has no Jira owner.`);
  if (context?.sprint === undefined)
    add("missing_sprint", `${context?.externalKey ?? jira.title} has no Jira sprint.`);
  if (
    items.some((item) => item.intent === "dependencies" || item.intent === "blockers") &&
    context?.hasDependency !== true
  )
    add(
      "missing_dependency",
      `${context?.externalKey ?? jira.title} has an observed wait that is not recorded as a Jira dependency.`,
    );
  if (context?.hasAcceptanceInformation !== true)
    add(
      "missing_acceptance",
      `${context?.externalKey ?? jira.title} has no recorded acceptance signal.`,
    );
  if ((lifecycle === "production" || lifecycle === "accepted") && jira.lifecycleState !== "done")
    add(
      "contradictory_status",
      `${context?.externalKey ?? jira.title} is ${context?.status ?? "not done"} in Jira while delivery evidence has reached ${lifecycle}.`,
    );
  if (lifecycle === "accepted" && jira.lifecycleState === "done")
    add(
      "review_for_closure",
      `${context?.externalKey ?? jira.title} should be reviewed for closure or archive.`,
    );
  return advisories;
};

export const validateCapabilityLedger = (value: CapabilityLedger): CapabilityLedger => {
  if (value.version !== 1 || value.capabilities.length === 0)
    throw new Error("Capability ledger must contain version 1 capabilities.");
  const keys = new Set<string>();
  for (const capability of value.capabilities) {
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(capability.key))
      throw new Error("Capability ledger contains an invalid key.");
    if (capability.title.trim() === "" || capability.aliases.length === 0)
      throw new Error("Capability ledger capabilities require a title and aliases.");
    if (
      capability.alignment !== undefined &&
      !["governed_initiative", "operational_support"].includes(capability.alignment)
    )
      throw new Error("Capability ledger contains an invalid alignment.");
    if (keys.has(capability.key)) throw new Error("Capability ledger keys must be unique.");
    keys.add(capability.key);
  }
  return value;
};

export const buildPeriodDeliveryReport = (input: {
  readonly census: PeriodCensus;
  readonly items: readonly PeriodDeliveryEvidence[];
  readonly capabilityLedger: CapabilityLedger;
}): PeriodDeliveryReport => {
  const declaredIntentByCapability = new Map<string, PeriodDeliveryEvidence>();
  for (const item of input.items.filter(
    (candidate) => candidate.evidenceRole === "declared_intent" || candidate.source === "strategy",
  )) {
    const capabilityKey = capabilityMatchFor([item], input.capabilityLedger).keys[0];
    if (capabilityKey !== undefined && !declaredIntentByCapability.has(capabilityKey))
      declaredIntentByCapability.set(capabilityKey, item);
  }
  const materialItems = input.items.filter((item) =>
    materialEvidence(item, input.capabilityLedger),
  );
  const groups = new Map<string, PeriodDeliveryEvidence[]>();
  for (const item of materialItems) {
    const key = capsuleKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const capabilityMatches = new Map<string, CapabilityMatch>();
  const capsules = [...groups.entries()]
    .map(([id, items]): ChangeCapsule => {
      const stage = completionStage(items);
      const lifecycle = lifecycleFor(items);
      const capabilityMatch = capabilityMatchFor(items, input.capabilityLedger);
      capabilityMatches.set(id, capabilityMatch);
      const capability = input.capabilityLedger.capabilities.find(({ key }) =>
        capabilityMatch.keys.includes(key),
      );
      const declaredIntent =
        capabilityMatch.keys[0] === undefined
          ? undefined
          : declaredIntentByCapability.get(capabilityMatch.keys[0]);
      const citations = [
        ...new Map(
          items.map((item) => [item.citationUrl, { source: item.source, url: item.citationUrl }]),
        ).values(),
      ];
      const latestActivityAt =
        items
          .flatMap((item) => (item.observedAt === undefined ? [] : [item.observedAt]))
          .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0] ??
        (input.census.boundary.kind === "absolute" ? input.census.boundary.toExclusive : "");
      const alignment: DeliveryEpisodeAlignment =
        capability === undefined
          ? items.some(
              (item) =>
                item.intent === "requirements" ||
                item.intent === "decisions" ||
                /\bemerging|new requirement|requested\b/i.test(evidenceText(item)),
            )
            ? "emerging_requirement"
            : "unaccounted_work"
          : (capability.alignment ?? "governed_initiative");
      const dependencies = items.flatMap((item) => {
        const dependency = dependencyFor(item, id, capabilityMatch.keys[0]);
        return dependency === undefined ? [] : [dependency];
      });
      const jiraAdvisories = jiraAdvisoriesFor(id, items, lifecycle);
      const completedAt = stage === undefined ? undefined : latestActivityAt;
      const sprintClassifications = [
        ...new Set(items.flatMap((item) => item.planning?.sprintClassifications ?? [])),
      ];
      return {
        id,
        title: items[0]?.title ?? id,
        summary:
          items
            .map(({ summary }) => summary.trim())
            .filter(Boolean)
            .toSorted((left, right) => right.length - left.length)[0] ??
          items[0]?.title ??
          id,
        latestActivityAt,
        ...(completedAt === undefined ? {} : { completedAt }),
        ...(stage === undefined ? {} : { completionStage: stage }),
        lifecycleState: lifecycle,
        alignment,
        ...(capability === undefined
          ? {}
          : { initiativeTitle: declaredIntent?.title ?? capability.title }),
        capabilityKeys: capabilityMatch.keys,
        sprintClassifications,
        blocked:
          items.some((item) => item.lifecycleState === "blocked") ||
          items.some((item) => /\bblocked|impediment|stuck\b/i.test(evidenceText(item))),
        owners: [
          ...new Set(
            items.flatMap((item) =>
              item.owner?.displayName === undefined ? [] : [item.owner.displayName],
            ),
          ),
        ],
        sources: [...new Set(items.map(({ source }) => source))].sort(),
        citations,
        dependencies,
        jiraAdvisories,
        chain: chainFor(
          lifecycle,
          citations.map(({ url }) => url),
        ),
      };
    })
    .toSorted(
      (left, right) =>
        lifecycleRank[right.lifecycleState] - lifecycleRank[left.lifecycleState] ||
        Date.parse(right.latestActivityAt) - Date.parse(left.latestActivityAt) ||
        left.title.localeCompare(right.title),
    );
  const capabilitySections = input.capabilityLedger.capabilities
    .map((capability) => {
      const matching = capsules.filter(({ capabilityKeys }) =>
        capabilityKeys.includes(capability.key),
      );
      const evidencedAliasIndexes = new Set(
        matching.flatMap(({ id }) => capabilityMatches.get(id)?.matchedAliasIndexes ?? []),
      );
      return {
        key: capability.key,
        title: capability.title,
        evidencedAliases: capability.aliases.flatMap((alias, index) =>
          evidencedAliasIndexes.has(index) ? [alias.value] : [],
        ),
        capsules: orderForAliasCoverage(matching, capabilityMatches),
        outcomes: [] as readonly OutcomeAssertion[],
      };
    })
    .filter(({ capsules: matching }) => matching.length > 0);
  const deliveredEpisodes = capsules.filter(
    ({ lifecycleState }) => lifecycleState === "production" || lifecycleState === "accepted",
  );
  const inProgressEpisodes = capsules.filter(
    ({ lifecycleState }) => lifecycleRank[lifecycleState] < lifecycleRank.production,
  );
  const dependencies = capsules.flatMap(({ dependencies: values }) => values);
  const jiraAdvisories = capsules.flatMap(({ jiraAdvisories: values }) => values);
  const decisionsNeeded = [
    ...capsules
      .filter(({ alignment }) => alignment === "emerging_requirement")
      .map(({ title }) => `Confirm scope and initiative placement for ${title}.`),
    ...jiraAdvisories.map(({ message }) => message),
  ];
  const unmappedCapsules = capsules.filter(({ alignment }) => alignment === "unaccounted_work");
  const sprintItems = input.items.filter(
    (item) => (item.planning?.sprintClassifications?.length ?? 0) > 0,
  );
  const previousSprint = sprintItems.find((item) => item.planning?.previousSprint !== undefined)
    ?.planning?.previousSprint;
  const currentSprint = sprintItems.find((item) => item.planning?.currentSprint !== undefined)
    ?.planning?.currentSprint;
  const initiativeItems = [
    ...new Map(
      input.items
        .filter((item) => item.strategy?.kind === "initiative")
        .map((item) => [item.dedupeKey, item]),
    ).values(),
  ];
  const healthReferenceAt =
    input.census.boundary.kind === "absolute"
      ? Date.parse(input.census.boundary.toExclusive)
      : Math.max(
          ...input.census.sourceCoverage.flatMap(({ checkpointAt }) =>
            checkpointAt === undefined ? [] : [Date.parse(checkpointAt)],
          ),
        );
  const meaningfulTokens = (value: string): readonly string[] =>
    normalized(value)
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !["and", "for", "the", "with", "from", "initiative", "q3", "2026"].includes(token),
      );
  const matchesInitiative = (
    capsule: ChangeCapsule,
    initiative: PeriodDeliveryEvidence,
  ): boolean => {
    const text = ` ${normalized(`${capsule.title} ${capsule.summary}`)} `;
    const aliases = [initiative.title, ...(initiative.subjectAliases ?? [])];
    return aliases.some((alias) => {
      const exact = normalized(alias);
      if (exact.length >= 6 && text.includes(` ${exact} `)) return true;
      const tokens = meaningfulTokens(alias);
      const matched = tokens.filter((token) => text.includes(` ${token} `)).length;
      return tokens.length >= 2 && matched >= 2 && matched / tokens.length >= 2 / 3;
    });
  };
  const initiatives: InitiativeProgress[] = initiativeItems.map((initiative) => {
    const matching = capsules.filter((capsule) => matchesInitiative(capsule, initiative));
    const currentSprintCapsules = matching.filter(({ sprintClassifications }) =>
      sprintClassifications.includes("current_sprint"),
    );
    const completedQuarterToDateCapsules = matching.filter(
      ({ lifecycleState }) => lifecycleRank[lifecycleState] >= lifecycleRank.development_ready,
    );
    const activeCapsules = matching.filter(
      ({ lifecycleState }) =>
        lifecycleState === "implementing" || lifecycleState === "qa" || lifecycleState === "scoped",
    );
    const blockedOrWaitingCapsules = matching.filter(
      ({ blocked, dependencies: waits }) => blocked || waits.length > 0,
    );
    const rolloverCapsules = matching.filter(({ sprintClassifications }) =>
      sprintClassifications.includes("rolled_into_current"),
    );
    const missingOwner = currentSprintCapsules.some(({ owners }) => owners.length === 0);
    const agingQa =
      Number.isFinite(healthReferenceAt) &&
      currentSprintCapsules.some(
        ({ lifecycleState, latestActivityAt }) =>
          lifecycleState === "qa" &&
          healthReferenceAt - Date.parse(latestActivityAt) >= 7 * 24 * 60 * 60 * 1_000,
      );
    const health: InitiativeProgress["health"] =
      currentSprintCapsules.length === 0
        ? "Unknown"
        : blockedOrWaitingCapsules.some(({ blocked }) => blocked)
          ? "Red"
          : rolloverCapsules.length > 0 ||
              blockedOrWaitingCapsules.length > 0 ||
              missingOwner ||
              agingQa
            ? "Amber"
            : "Green";
    const healthExplanation =
      health === "Unknown"
        ? "No executable current-sprint work was observed."
        : health === "Red"
          ? "Current work is blocked and requires intervention."
          : health === "Amber"
            ? `${[
                rolloverCapsules.length > 0 ? "rollover" : undefined,
                blockedOrWaitingCapsules.length > 0 ? "an unresolved dependency" : undefined,
                missingOwner ? "unclear ownership" : undefined,
                agingQa ? "work remaining in QA" : undefined,
              ]
                .filter((value): value is string => value !== undefined)
                .join(", ")}.`
            : "Meaningful current-sprint progress is visible without a material unresolved delay.";
    return {
      id: initiative.dedupeKey,
      title: initiative.title,
      health,
      healthExplanation,
      progress:
        health === "Red"
          ? "stalled"
          : health === "Amber"
            ? "at risk"
            : health === "Green"
              ? "moving"
              : matching.length > 0
                ? "scoped"
                : "unknown",
      currentSprintCapsules,
      completedQuarterToDateCapsules,
      activeCapsules,
      blockedOrWaitingCapsules,
      rolloverCapsules,
    };
  });
  const sprintReview: SprintReviewProjection | undefined =
    sprintItems.length === 0
      ? undefined
      : {
          ...(previousSprint === undefined ? {} : { previousSprint }),
          ...(currentSprint === undefined ? {} : { currentSprint }),
          plannedAtStart: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("planned_at_start"),
          ),
          addedDuringSprint: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("added_during_sprint"),
          ),
          completedDuringSprint: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("completed_during_sprint"),
          ),
          rolledIntoCurrent: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("rolled_into_current"),
          ),
          dropped: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("dropped"),
          ),
          currentSprintWork: capsules.filter(({ sprintClassifications }) =>
            sprintClassifications.includes("current_sprint"),
          ),
          initiatives,
          initiativesWithoutCurrentSprintActivity: initiatives.filter(
            ({ currentSprintCapsules }) => currentSprintCapsules.length === 0,
          ),
          unaccountedWork: unmappedCapsules,
        };
  return {
    version: 1,
    census: input.census,
    capsules,
    deliveredEpisodes,
    inProgressEpisodes,
    dependencies,
    decisionsNeeded: [...new Set(decisionsNeeded)],
    jiraAdvisories,
    capabilitySections,
    unmappedCapsules,
    excludedImmaterialActivityCount: input.items.length - materialItems.length,
    incompleteChainCount: capsules.filter(
      ({ lifecycleState }) => lifecycleRank[lifecycleState] < lifecycleRank.accepted,
    ).length,
    ...(sprintReview === undefined ? {} : { sprintReview }),
  };
};
