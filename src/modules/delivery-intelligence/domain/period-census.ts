import { stableSha256 } from "../../../domain/hash.ts";
import type { DeliverySourceKind } from "./delivery-model.ts";

export type DeliveryCompletionStage =
  | "development_ready"
  | "merged"
  | "released"
  | "deployed"
  | "accepted";

export type PeriodCensusBoundary =
  | {
      readonly kind: "absolute";
      readonly fromInclusive: string;
      readonly toExclusive: string;
    }
  | {
      readonly kind: "source_defined";
      readonly source: "jira" | "github";
      readonly reference: string;
    };

export type PeriodCensusCandidate = {
  readonly id: string;
  readonly source: DeliverySourceKind;
  readonly occurredAt: string;
  readonly dedupeKey: string;
  readonly mapped: boolean;
  readonly classification: "candidate" | "generic_source_update";
  readonly completionStage?: DeliveryCompletionStage | undefined;
};

export type PeriodCensusSourceCoverage = {
  readonly source: DeliverySourceKind;
  readonly available: boolean;
  readonly checkpointAt?: string | undefined;
  readonly candidateCount: number;
};

export type PeriodCensus = {
  readonly version: 1;
  readonly boundary: PeriodCensusBoundary;
  readonly timeZone: string;
  readonly examinedCandidateCount: number;
  readonly candidateCount: number;
  readonly deliveredCandidateCount: number;
  readonly excludedCandidateCount: number;
  readonly duplicateCandidateCount: number;
  readonly unmappedCandidateCount: number;
  readonly exclusions: Readonly<Record<string, number>>;
  readonly unavailableSources: readonly DeliverySourceKind[];
  readonly sourceCoverage: readonly PeriodCensusSourceCoverage[];
  readonly pagination: {
    readonly pageSize: number;
    readonly pagesRead: number;
    readonly exhausted: boolean;
    readonly maximumCandidates: number;
  };
  readonly complete: boolean;
  readonly replayChecksum: string;
};

export const compilePeriodCensus = (input: {
  readonly boundary: PeriodCensusBoundary;
  readonly timeZone: string;
  readonly candidates: readonly PeriodCensusCandidate[];
  readonly configuredSources: readonly DeliverySourceKind[];
  readonly sourceCheckpoints: ReadonlyMap<DeliverySourceKind, string>;
  readonly pageSize: number;
  readonly pagesRead: number;
  readonly paginationExhausted: boolean;
  readonly maximumCandidates: number;
  readonly unresolvedBoundary?: boolean | undefined;
}): PeriodCensus => {
  const accepted = input.candidates.filter(({ classification }) => classification === "candidate");
  const unique = new Map<string, PeriodCensusCandidate>();
  let duplicateCandidateCount = 0;
  for (const candidate of accepted) {
    const key = `${candidate.source}\u0000${candidate.dedupeKey}`;
    if (unique.has(key)) {
      duplicateCandidateCount += 1;
      continue;
    }
    unique.set(key, candidate);
  }
  const candidates = [...unique.values()].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.source.localeCompare(right.source) ||
      left.dedupeKey.localeCompare(right.dedupeKey),
  );
  const unavailableSources = input.configuredSources.filter(
    (source) => !input.sourceCheckpoints.has(source),
  );
  const genericUpdates = input.candidates.length - accepted.length;
  const exclusions = {
    ...(genericUpdates === 0 ? {} : { generic_source_update_not_completion: genericUpdates }),
    ...(input.unresolvedBoundary === true ? { unresolved_source_boundary: 1 } : {}),
  };
  const sourceCoverage = [...new Set(input.configuredSources)].sort().map((source) => ({
    source,
    available: input.sourceCheckpoints.has(source),
    checkpointAt: input.sourceCheckpoints.get(source),
    candidateCount: candidates.filter((candidate) => candidate.source === source).length,
  }));
  const complete =
    input.paginationExhausted &&
    input.unresolvedBoundary !== true &&
    unavailableSources.length === 0;
  return {
    version: 1,
    boundary: input.boundary,
    timeZone: input.timeZone,
    examinedCandidateCount: input.candidates.length,
    candidateCount: candidates.length,
    deliveredCandidateCount: candidates.filter(
      ({ completionStage }) => completionStage !== undefined,
    ).length,
    excludedCandidateCount: genericUpdates + (input.unresolvedBoundary === true ? 1 : 0),
    duplicateCandidateCount,
    unmappedCandidateCount: candidates.filter(({ mapped }) => !mapped).length,
    exclusions,
    unavailableSources,
    sourceCoverage,
    pagination: {
      pageSize: input.pageSize,
      pagesRead: input.pagesRead,
      exhausted: input.paginationExhausted,
      maximumCandidates: input.maximumCandidates,
    },
    complete,
    replayChecksum: stableSha256(
      candidates
        .map(
          ({ source, dedupeKey, occurredAt, mapped, completionStage }) =>
            `${source}\u0000${dedupeKey}\u0000${occurredAt}\u0000${mapped}\u0000${completionStage ?? ""}`,
        )
        .join("\n"),
    ),
  };
};
