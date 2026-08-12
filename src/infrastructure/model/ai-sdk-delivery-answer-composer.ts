import type { DeliveryAnswerComposer } from "../../modules/delivery-intelligence/index.ts";
import type { GroundedAnswerGenerator } from "../../modules/teams-mention/index.ts";

const boundedContext = (value: string, maximumCharacters: number): string =>
  value.trim().slice(0, maximumCharacters);

const reportCapsuleTitleCharacters = 320;
const reportCapsuleExcerptCharacters = 700;
const supplementalTitleCharacters = 320;
const supplementalExcerptCharacters = 900;
const modelTimeoutHeadroomMs = 1_000;
const balancedSupplementalEvidence = <Evidence extends { readonly source: string }>(
  evidence: readonly Evidence[],
  maximumEvidence: number,
): readonly Evidence[] => {
  const sourceOrder = ["strategy", "vault", "teams", "github", "jira", "email", "intent"];
  const buckets = new Map(
    sourceOrder.map((source) => [
      source,
      evidence.filter((candidate) => candidate.source === source),
    ]),
  );
  const selected: Evidence[] = [];
  while (
    selected.length < maximumEvidence &&
    [...buckets.values()].some((remaining) => remaining.length > 0)
  )
    for (const source of sourceOrder) {
      const candidate = buckets.get(source)?.shift();
      if (candidate !== undefined && selected.length < maximumEvidence) selected.push(candidate);
    }
  return selected;
};

const reportEvidence = (
  input: Parameters<DeliveryAnswerComposer["compose"]>[0],
  freshness: (indexedAt: string | undefined) => "current" | "stale",
) => {
  const report = input.periodDeliveryReport;
  if (report === undefined) return [];
  const reduced = input.compositionAttempt === "reduced";
  const maximumCapsules = reduced ? 60 : 160;
  const sections = report.capabilitySections.map((section) => ({
    section,
    remaining: [...section.capsules],
  }));
  const selected: {
    readonly section: (typeof report.capabilitySections)[number];
    readonly capsule: (typeof report.capsules)[number];
  }[] = [];
  while (
    selected.length < maximumCapsules &&
    sections.some(({ remaining }) => remaining.length > 0)
  )
    for (const entry of sections) {
      const capsule = entry.remaining.shift();
      if (capsule === undefined || selected.length >= maximumCapsules) continue;
      selected.push({ section: entry.section, capsule });
    }
  for (const capsule of report.unmappedCapsules) {
    if (selected.length >= maximumCapsules) break;
    if (!selected.some((candidate) => candidate.capsule.id === capsule.id))
      selected.push({
        section: {
          key: "unmapped",
          title: "Unmapped delivery",
          evidencedAliases: [],
          capsules: report.unmappedCapsules,
          outcomes: [],
        },
        capsule,
      });
  }
  return selected.flatMap(({ section, capsule }) => {
    const citation = capsule.citations[0];
    if (citation === undefined) return [];
    return [
      {
        source: citation.source,
        sourceId: capsule.id,
        sourceUrl: citation.url,
        title: boundedContext(
          `Delivery episode — ${section.title}: ${capsule.title}`,
          reportCapsuleTitleCharacters,
        ),
        excerpt: boundedContext(
          `${capsule.summary} Lifecycle: ${capsule.lifecycleState}. Alignment: ${capsule.alignment}. Owners: ${capsule.owners.join(", ") || "not recorded"}. Dependencies: ${capsule.dependencies.map(({ waiting, awaited, requiredAction }) => `${waiting} waits for ${awaited}; ${requiredAction}`).join(" | ") || "none observed"}. Jira advisories: ${capsule.jiraAdvisories.map(({ message }) => message).join(" | ") || "none"}.`,
          reduced ? 450 : reportCapsuleExcerptCharacters,
        ),
        occurredAt: capsule.latestActivityAt,
        updatedAt: capsule.latestActivityAt,
        sensitivity: "internal" as const,
        freshness: freshness(capsule.latestActivityAt),
      },
    ];
  });
};

export const createAiSdkDeliveryAnswerComposer = (
  generator: GroundedAnswerGenerator,
): DeliveryAnswerComposer => ({
  compose: (input) => {
    const freshness = (indexedAt: string | undefined): "current" | "stale" => {
      if (indexedAt === undefined) return "current";
      return Date.parse(input.requestedAt) - Date.parse(indexedAt) <= 2 * 60 * 60 * 1_000
        ? "current"
        : "stale";
    };
    const itemInformation = input.items.map((item) => ({
      source: item.source,
      sourceId: item.id,
      sourceUrl: item.citationUrl,
      title: boundedContext(
        `${item.evidenceRole === "declared_intent" ? "Declared intent" : "Observed evidence"} — ${item.intent.replaceAll("_", " ")}: ${item.title}`,
        supplementalTitleCharacters,
      ),
      excerpt: boundedContext(
        [
          item.summary,
          `Lifecycle: ${item.lifecycleState ?? "not recorded"}.`,
          `Completion stage: ${item.completionStage ?? "not recorded"}.`,
        ].join(" "),
        supplementalExcerptCharacters,
      ),
      occurredAt: item.observedAt ?? input.requestedAt,
      updatedAt: item.sourceUpdatedAt ?? item.observedAt ?? input.requestedAt,
      sensitivity: item.sensitivity,
      freshness: freshness(item.indexedAt),
    }));
    const conflictInformation = input.conflicts.flatMap((conflict) =>
      conflict.claims.slice(0, 2).map((claim) => ({
        source: claim.source.source,
        sourceId: claim.id,
        sourceUrl: claim.source.citationUrl,
        title: `Conflict: ${conflict.subjectKey} ${conflict.predicate}`,
        excerpt: `${conflict.subjectKey} ${conflict.predicate}: ${String(claim.value)} (attributed to ${claim.assertedBy ?? claim.source.source})`,
        occurredAt: claim.observedAt,
        updatedAt: claim.sourceUpdatedAt ?? claim.observedAt,
        sensitivity: claim.sensitivity,
        freshness: freshness(claim.indexedAt),
      })),
    );
    const reportInformation = reportEvidence(input, freshness);
    const reportUrls = new Set(reportInformation.map(({ sourceUrl }) => sourceUrl));
    const supplementalInformation = balancedSupplementalEvidence(
      itemInformation.filter((item) => !reportUrls.has(item.sourceUrl)),
      input.compositionAttempt === "reduced" ? 18 : 36,
    );
    const report = input.periodDeliveryReport;
    const reportEpisodeIds = new Set(reportInformation.map(({ sourceId }) => sourceId));
    const evidence = [...reportInformation, ...supplementalInformation, ...conflictInformation];
    if (input.completionAssessment !== undefined) {
      const assessment = input.completionAssessment;
      const subject =
        "canonicalName" in assessment.subject
          ? assessment.subject.canonicalName
          : assessment.subject.unresolvedPhrase;
      const requiredVerdict =
        assessment.disposition === "complete"
          ? "yes"
          : assessment.disposition === "incomplete"
            ? "no"
            : "cannot_verify";
      return generator.generate({
        workspaceId: input.workspaceId,
        question: input.question,
        evidence,
        modelTimeoutMs: Math.max(
          100,
          input.responseBudget.compositionTimeoutMs - modelTimeoutHeadroomMs,
        ),
        presentation: {
          kind: "completion_verdict",
          subject,
          requiredVerdict,
          disposition: assessment.disposition,
          ...(assessment.requestedScope === undefined
            ? {}
            : { requestedScope: assessment.requestedScope.description }),
          ...("affectedEntities" in assessment.subject
            ? {
                affectedEntities: assessment.subject.affectedEntities.map(
                  ({ canonicalName }) => canonicalName,
                ),
              }
            : {}),
          criteria: assessment.criteria.map(({ title, facet, disposition, reason }) => ({
            title,
            facet,
            disposition,
            reason,
          })),
          conflicts: assessment.conflicts.map(({ reason }) => reason),
          excludedObservations: assessment.excludedObservations.map(({ reason }) => reason),
        },
      });
    }
    return generator.generate({
      workspaceId: input.workspaceId,
      question: input.question,
      evidence,
      modelTimeoutMs: Math.max(
        100,
        input.responseBudget.compositionTimeoutMs - modelTimeoutHeadroomMs,
      ),
      ...(report === undefined
        ? {}
        : {
            presentation: {
              kind: "delivery_report" as const,
              requiredCitationSources: input.plan.requiredSources ?? [],
              period:
                report.census.boundary.kind === "absolute"
                  ? {
                      kind: "absolute" as const,
                      fromInclusive: report.census.boundary.fromInclusive,
                      toExclusive: report.census.boundary.toExclusive,
                      timeZone: report.census.timeZone,
                    }
                  : {
                      kind: "source_defined" as const,
                      reference: report.census.boundary.reference,
                      timeZone: report.census.timeZone,
                    },
              coverage: {
                complete: report.census.complete,
                examinedRecords: report.census.examinedCandidateCount,
                acceptedChanges: report.capsules.length,
                duplicateRecords: report.census.duplicateCandidateCount,
                excludedRecords: report.census.excludedCandidateCount,
                unmappedChanges: report.unmappedCapsules.length,
                unavailableSources: report.census.unavailableSources,
              },
              capabilitySections: report.capabilitySections.map((section) => ({
                title: section.title,
                changeCount: section.capsules.length,
                evidencedInitiatives: section.evidencedAliases,
              })),
              episodes: report.capsules
                .filter(
                  (episode) =>
                    input.compositionAttempt === "full" || reportEpisodeIds.has(episode.id),
                )
                .map((episode) => ({
                  id: episode.id,
                  capability:
                    report.capabilitySections.find(({ key }) =>
                      episode.capabilityKeys.includes(key),
                    )?.title ?? "Unaccounted work",
                  initiative: episode.initiativeTitle,
                  title: episode.title,
                  lifecycleState: episode.lifecycleState,
                  alignment: episode.alignment,
                  owners: episode.owners,
                })),
              dependencies: report.dependencies.map((dependency) => ({
                waiting: dependency.waiting,
                awaited: dependency.awaited,
                since: dependency.since,
                requiredAction: dependency.requiredAction,
                episodeId: dependency.episodeId,
              })),
              decisionsNeeded: report.decisionsNeeded,
              jiraAdvisories: report.jiraAdvisories.map(({ kind, episodeId, message }) => ({
                kind,
                episodeId,
                message,
              })),
              ...(report.sprintReview === undefined
                ? {}
                : {
                    sprintReview: {
                      ...(report.sprintReview.previousSprint === undefined
                        ? {}
                        : { previousSprint: report.sprintReview.previousSprint }),
                      ...(report.sprintReview.currentSprint === undefined
                        ? {}
                        : { currentSprint: report.sprintReview.currentSprint }),
                      previous: {
                        plannedAtStart: report.sprintReview.plannedAtStart.map(({ id }) => id),
                        addedDuringSprint: report.sprintReview.addedDuringSprint.map(
                          ({ id }) => id,
                        ),
                        completedDuringSprint: report.sprintReview.completedDuringSprint.map(
                          ({ id }) => id,
                        ),
                        rolledIntoCurrent: report.sprintReview.rolledIntoCurrent.map(
                          ({ id }) => id,
                        ),
                        dropped: report.sprintReview.dropped.map(({ id }) => id),
                      },
                      current: report.sprintReview.currentSprintWork.map(({ id }) => id),
                      initiatives: report.sprintReview.initiatives.map((initiative) => ({
                        title: initiative.title,
                        health: initiative.health,
                        healthExplanation: initiative.healthExplanation,
                        progress: initiative.progress,
                        currentSprintEpisodes: initiative.currentSprintCapsules.map(({ id }) => id),
                        completedQuarterToDateEpisodes:
                          initiative.completedQuarterToDateCapsules.map(({ id }) => id),
                        activeEpisodes: initiative.activeCapsules.map(({ id }) => id),
                        blockedOrWaitingEpisodes: initiative.blockedOrWaitingCapsules.map(
                          ({ id }) => id,
                        ),
                        rolloverEpisodes: initiative.rolloverCapsules.map(({ id }) => id),
                      })),
                      noCurrentSprintActivity:
                        report.sprintReview.initiativesWithoutCurrentSprintActivity.map(
                          ({ title }) => title,
                        ),
                      unaccountedWork: report.sprintReview.unaccountedWork.map(({ id }) => id),
                    },
                  }),
            },
          }),
    });
  },
});
