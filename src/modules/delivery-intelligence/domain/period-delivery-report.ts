import type { DeliverySourceKind } from "./delivery-model.ts";
import type { DeliveryCompletionStage, PeriodCensus } from "./period-census.ts";

export type PeriodDeliveryEvidence = {
  readonly title: string;
  readonly summary: string;
  readonly citationUrl: string;
  readonly source: DeliverySourceKind;
  readonly selector: string;
  readonly subjectAliases?: readonly string[] | undefined;
  readonly dedupeKey: string;
  readonly observedAt?: string | undefined;
  readonly completionStage?: DeliveryCompletionStage | undefined;
};

export type CapabilityAlias = {
  readonly value: string;
  readonly source?: DeliverySourceKind | undefined;
};

export type CapabilityDefinition = {
  readonly key: string;
  readonly title: string;
  readonly aliases: readonly CapabilityAlias[];
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

export type ChangeCapsule = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly completedAt: string;
  readonly completionStage: DeliveryCompletionStage;
  readonly capabilityKeys: readonly string[];
  readonly sources: readonly DeliverySourceKind[];
  readonly citations: readonly {
    readonly source: DeliverySourceKind;
    readonly url: string;
  }[];
  readonly chain: readonly DeliveryChainStage[];
};

export type PeriodDeliveryReport = {
  readonly version: 1;
  readonly census: PeriodCensus;
  readonly capsules: readonly ChangeCapsule[];
  readonly capabilitySections: readonly {
    readonly key: string;
    readonly title: string;
    readonly capsules: readonly ChangeCapsule[];
    readonly outcomes: readonly OutcomeAssertion[];
  }[];
  readonly unmappedCapsules: readonly ChangeCapsule[];
  readonly incompleteChainCount: number;
};

const normalized = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const workItemKey = (value: string): string | undefined =>
  value.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0];

const pullRequestKey = (value: string): string | undefined => {
  const match = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i.exec(value);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : `github:${match[1].toLocaleLowerCase("en")}:pull:${match[2]}`;
};

const capsuleKey = (item: PeriodDeliveryEvidence): string => {
  const text = `${item.title}\n${item.summary}\n${item.citationUrl}`;
  return workItemKey(text) ?? pullRequestKey(text) ?? item.dedupeKey;
};

const completionStage = (items: readonly PeriodDeliveryEvidence[]): DeliveryCompletionStage =>
  items.some((item) => item.completionStage === "deployed")
    ? "deployed"
    : items.some((item) => item.completionStage === "released")
      ? "released"
      : "merged";

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
  stage: DeliveryCompletionStage,
  citations: readonly string[],
): readonly DeliveryChainStage[] => {
  return stageOrder.map((candidate) => ({
    stage: candidate,
    state: candidate === stage ? "observed" : "missing",
    citations: candidate === stage ? citations : [],
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
  const text = normalized(
    items
      .flatMap((item) => [
        item.title,
        item.summary,
        item.citationUrl,
        ...(item.subjectAliases ?? []),
      ])
      .join("\n"),
  );
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
      const specificity = value.split(" ").length * 1_000 + value.length;
      return [
        {
          aliasIndex,
          score: specificity + (alias.source === undefined ? 0 : 100_000),
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
        right.citations.length - left.citations.length ||
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
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

export const validateCapabilityLedger = (value: CapabilityLedger): CapabilityLedger => {
  if (value.version !== 1 || value.capabilities.length === 0)
    throw new Error("Capability ledger must contain version 1 capabilities.");
  const keys = new Set<string>();
  for (const capability of value.capabilities) {
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(capability.key))
      throw new Error("Capability ledger contains an invalid key.");
    if (capability.title.trim() === "" || capability.aliases.length === 0)
      throw new Error("Capability ledger capabilities require a title and aliases.");
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
  const acceptedItems = input.items.filter(
    (item) => item.selector === "period_census" && item.completionStage !== undefined,
  );
  const groups = new Map<string, PeriodDeliveryEvidence[]>();
  for (const item of acceptedItems) {
    const key = capsuleKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const capabilityMatches = new Map<string, CapabilityMatch>();
  const capsules = [...groups.entries()]
    .map(([id, items]): ChangeCapsule => {
      const stage = completionStage(items);
      const capabilityMatch = capabilityMatchFor(items, input.capabilityLedger);
      capabilityMatches.set(id, capabilityMatch);
      const citations = [
        ...new Map(
          items.map((item) => [item.citationUrl, { source: item.source, url: item.citationUrl }]),
        ).values(),
      ];
      const latestCompletion = items
        .flatMap((item) => (item.observedAt === undefined ? [] : [item.observedAt]))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
      const completedAt =
        latestCompletion ??
        (input.census.boundary.kind === "absolute" ? input.census.boundary.toExclusive : "");
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
        completedAt,
        completionStage: stage,
        capabilityKeys: capabilityMatch.keys,
        sources: [...new Set(items.map(({ source }) => source))].sort(),
        citations,
        chain: chainFor(
          stage,
          citations.map(({ url }) => url),
        ),
      };
    })
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
        left.title.localeCompare(right.title),
    );
  const capabilitySections = input.capabilityLedger.capabilities
    .map((capability) => {
      const matching = capsules.filter(({ capabilityKeys }) =>
        capabilityKeys.includes(capability.key),
      );
      return {
        key: capability.key,
        title: capability.title,
        capsules: orderForAliasCoverage(matching, capabilityMatches),
        outcomes: [
          {
            evidenceClass: "unknown" as const,
            statement:
              "No authorized outcome measurement was linked to these delivery changes in the requested period.",
            citations: [] as const,
          },
        ],
      };
    })
    .filter(({ capsules: matching }) => matching.length > 0);
  const unmappedCapsules = capsules.filter(({ capabilityKeys }) => capabilityKeys.length === 0);
  return {
    version: 1,
    census: input.census,
    capsules,
    capabilitySections,
    unmappedCapsules,
    incompleteChainCount: capsules.filter(({ chain }) =>
      chain.some(({ state }) => state === "missing"),
    ).length,
  };
};
