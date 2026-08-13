import { Effect } from "effect";
import type {
  DeliveryAnswerComposer,
  DeliveryRelevanceProfile,
} from "../../modules/delivery-intelligence/index.ts";
import type { GroundedAnswerGenerator } from "../../modules/teams-mention/index.ts";

const boundedContext = (value: string, maximumCharacters: number): string =>
  value.trim().slice(0, maximumCharacters);

const reportCapsuleTitleCharacters = 320;
const supplementalTitleCharacters = 320;
const supplementalExcerptCharacters = 900;
const modelTimeoutHeadroomMs = 1_000;
const questionTerms = (value: string): readonly string[] =>
  value
    .toLocaleLowerCase("en")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);

const relevantSupplementalEvidence = <
  Evidence extends { readonly title: string; readonly excerpt: string; readonly freshness: string },
>(
  question: string,
  evidence: readonly Evidence[],
  maximumEvidence: number,
): readonly Evidence[] => {
  const terms = questionTerms(question);
  return evidence
    .map((candidate, index) => {
      const text = `${candidate.title} ${candidate.excerpt}`.toLocaleLowerCase("en");
      const coverage = terms.filter((term) => text.includes(term)).length;
      const decisive =
        /\b(?:decided|approved|accepted|verified|deployed|blocked|superseded)\b/i.test(text);
      return {
        candidate,
        index,
        score: coverage * 2 + (decisive ? 3 : 0) + (candidate.freshness === "current" ? 0.25 : 0),
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maximumEvidence)
    .map(({ candidate }) => candidate);
};

const sourceBalancedEvidence = <Evidence extends { readonly source: string }>(
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
    [...buckets.values()].some((values) => values.length > 0)
  )
    for (const source of sourceOrder) {
      const candidate = buckets.get(source)?.shift();
      if (candidate !== undefined && selected.length < maximumEvidence) selected.push(candidate);
    }
  return selected;
};

const episodeCoversFacet = (
  episode: NonNullable<
    Parameters<DeliveryAnswerComposer["compose"]>[0]["periodDeliveryReport"]
  >["capsules"][number],
  facet: string,
): boolean => {
  const observedStages = new Set(
    episode.chain.filter(({ state }) => state === "observed").map(({ stage }) => stage),
  );
  if (facet === "identity" || facet === "capability") return episode.capabilityKeys.length > 0;
  if (facet === "implementation") return observedStages.has("implemented");
  if (facet === "deployment") return observedStages.has("deployed");
  if (facet === "rollout" || facet === "compatibility")
    return /\b(?:rollout|brand|variant|environment|compatib)\b/i.test(
      `${episode.title} ${episode.summary}`,
    );
  if (facet === "verification")
    return observedStages.has("checks_passed") || episode.lifecycleState === "qa";
  if (facet === "acceptance") return observedStages.has("accepted");
  if (facet === "period" || facet === "episode" || facet === "lifecycle") return true;
  if (facet === "materiality")
    return episode.alignment !== "unaccounted_work" || episode.capabilityKeys.length > 0;
  if (facet === "initiative") return episode.initiativeTitle !== undefined;
  if (facet === "dependency") return episode.dependencies.length > 0;
  if (facet === "conflict")
    return episode.jiraAdvisories.some(({ kind }) => kind === "contradictory_status");
  return false;
};

const reportEvidence = (
  input: Parameters<DeliveryAnswerComposer["compose"]>[0],
  freshness: (indexedAt: string | undefined) => "current" | "stale",
  relevanceProfile: DeliveryRelevanceProfile,
) => {
  const report = input.periodDeliveryReport;
  if (report === undefined) return [];
  const reduced = input.compositionAttempt === "reduced";
  const maximumCapsules =
    relevanceProfile === "expanded" ? (reduced ? 24 : 48) : reduced ? 60 : 160;
  const facets = new Set(input.plan.facets ?? []);
  const scored = report.capabilitySections
    .flatMap((section) => section.capsules.map((capsule) => ({ section, capsule })))
    .map((candidate, index) => {
      const { capsule } = candidate;
      const facetCoverage = [
        facets.has("lifecycle"),
        facets.has("dependency") && capsule.dependencies.length > 0,
        facets.has("capability") && capsule.capabilityKeys.length > 0,
        facets.has("initiative") && capsule.initiativeTitle !== undefined,
        facets.has("acceptance") && capsule.completionStage === "accepted",
        facets.has("deployment") && capsule.completionStage === "deployed",
        facets.has("verification") &&
          ["development_ready", "merged", "released", "deployed", "accepted"].includes(
            capsule.completionStage ?? "",
          ),
      ].filter(Boolean).length;
      const materiality =
        capsule.capabilityKeys.length * 2 +
        capsule.dependencies.length * 2 +
        capsule.chain.length +
        (capsule.blocked ? 2 : 0) +
        (capsule.alignment === "unaccounted_work" ? -2 : 1);
      return { ...candidate, index, score: facetCoverage * 5 + materiality };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.capsule.latestActivityAt.localeCompare(left.capsule.latestActivityAt) ||
        left.index - right.index,
    )
    .slice(0, maximumCapsules);
  const selected = (() => {
    if (relevanceProfile === "expanded") return scored;
    const sections = report.capabilitySections.map((section) => ({
      section,
      remaining: [...section.capsules],
    }));
    const values: typeof scored = [];
    let index = 0;
    while (
      values.length < maximumCapsules &&
      sections.some(({ remaining }) => remaining.length > 0)
    )
      for (const entry of sections) {
        const capsule = entry.remaining.shift();
        if (capsule !== undefined && values.length < maximumCapsules)
          values.push({ section: entry.section, capsule, index: index++, score: 0 });
      }
    return values;
  })();
  return selected.flatMap(({ section, capsule }) => {
    if (capsule.citations.length === 0) return [];
    const episodeExcerpt = boundedContext(
      `${capsule.summary} Lifecycle: ${capsule.lifecycleState}. Completion: ${capsule.completionStage ?? "not recorded"}. Lifecycle facets: ${capsule.chain.map(({ stage, state }) => `${stage}=${state}`).join(", ") || "not recorded"}. Alignment: ${capsule.alignment}. Owners: ${capsule.owners.join(", ") || "not recorded"}. Dependencies: ${capsule.dependencies.map(({ waiting, awaited, requiredAction }) => `${waiting} waits for ${awaited}; ${requiredAction}`).join(" | ") || "none observed"}. Jira advisories: ${capsule.jiraAdvisories.map(({ message }) => message).join(" | ") || "none"}.`,
      reduced ? 550 : 1_000,
    );
    const citationLimit = relevanceProfile === "expanded" ? (reduced ? 2 : 3) : 1;
    return capsule.citations.slice(0, citationLimit).map((citation, citationIndex) => ({
      source: citation.source,
      sourceId: citationIndex === 0 ? capsule.id : `${capsule.id}:evidence-${citationIndex + 1}`,
      sourceUrl: citation.url,
      title: boundedContext(
        `Delivery episode — ${section.title}: ${capsule.title}`,
        reportCapsuleTitleCharacters,
      ),
      excerpt: episodeExcerpt,
      occurredAt: capsule.latestActivityAt,
      updatedAt: capsule.latestActivityAt,
      sensitivity: "internal" as const,
      freshness: freshness(capsule.latestActivityAt),
    }));
  });
};

export const createAiSdkDeliveryAnswerComposer = (
  generator: GroundedAnswerGenerator,
  configuration: { readonly relevanceProfile?: DeliveryRelevanceProfile } = {},
): DeliveryAnswerComposer => ({
  compose: (input) => {
    const relevanceProfile = configuration.relevanceProfile ?? "expanded";
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
    const reportInformation = reportEvidence(input, freshness, relevanceProfile);
    const reportUrls = new Set(reportInformation.map(({ sourceUrl }) => sourceUrl));
    const supplementalCandidates = itemInformation.filter(
      (item) => !reportUrls.has(item.sourceUrl),
    );
    const supplementalInformation =
      relevanceProfile === "expanded"
        ? relevantSupplementalEvidence(
            input.question,
            supplementalCandidates,
            input.compositionAttempt === "reduced" ? 12 : 24,
          )
        : sourceBalancedEvidence(
            supplementalCandidates,
            input.compositionAttempt === "reduced" ? 18 : 36,
          );
    const report = input.periodDeliveryReport;
    const reportEpisodeIds = new Set(reportInformation.map(({ sourceId }) => sourceId));
    const selectedEpisodes = report?.capsules.filter(({ id }) => reportEpisodeIds.has(id)) ?? [];
    const missingFacets = (input.plan.facets ?? []).filter(
      (facet) => !selectedEpisodes.some((episode) => episodeCoversFacet(episode, facet)),
    );
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
    return generator
      .generate({
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
                ...(missingFacets.length === 0 ? {} : { missingFacets }),
                episodes: report.capsules
                  .filter((episode) =>
                    relevanceProfile === "expanded"
                      ? reportEpisodeIds.has(episode.id)
                      : input.compositionAttempt === "full" || reportEpisodeIds.has(episode.id),
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
                          currentSprintEpisodes: initiative.currentSprintCapsules.map(
                            ({ id }) => id,
                          ),
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
      })
      .pipe(
        Effect.map((answer) => ({
          ...answer,
          compositionDiagnostics: {
            selectedEpisodeCount: selectedEpisodes.length,
            missingFacetCount: missingFacets.length,
          },
        })),
      );
  },
});
