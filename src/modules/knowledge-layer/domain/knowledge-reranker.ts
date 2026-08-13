import type { KnowledgeSourceKind } from "./knowledge.ts";

const relevanceTerms = (value: string): readonly string[] =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);

const metadataValues = (
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
): readonly string[] => Object.values(attributes ?? {}).flat();

export const rerankKnowledgeCandidates = <
  Candidate extends {
    readonly title: string;
    readonly excerpt: string;
    readonly source: KnowledgeSourceKind;
    readonly authority: number;
    readonly score: number;
    readonly passageKind?: string | undefined;
    readonly parentLocator?: string | undefined;
    readonly hierarchy?: readonly string[] | undefined;
    readonly attributes?: Readonly<Record<string, string | readonly string[]>> | undefined;
  },
>(
  query: {
    readonly question: string;
    readonly subject?: string;
    readonly facets?: readonly string[];
  },
  candidates: readonly Candidate[],
): readonly Candidate[] => {
  const questionTerms = new Set(relevanceTerms(query.question));
  const subjectTerms = relevanceTerms(query.subject ?? "");
  const facetPatterns: Readonly<Record<string, RegExp>> = {
    identity: /\b(?:product|feature|identity|canonical|alias)\b/i,
    capability: /\b(?:capability|initiative|outcome|value)\b/i,
    implementation: /\b(?:code|implementation|repository|module|handler|service|schema)\b/i,
    deployment: /\b(?:deploy|release|environment|production)\b/i,
    rollout: /\b(?:rollout|brand|variant|environment)\b/i,
    compatibility: /\bcompatib/i,
    verification: /\b(?:test|qa|verify|proof|check)\b/i,
    acceptance: /\b(?:accept|approval|sign[ -]?off)\b/i,
    period: /\b(?:week|sprint|month|quarter|period|date)\b/i,
    episode: /\b(?:episode|change|delivery|feedback|fix|retest)\b/i,
    lifecycle: /\b(?:planned|active|blocked|done|complete|canceled|status)\b/i,
    materiality: /\b(?:impact|material|customer|reusable|outcome)\b/i,
    initiative: /\b(?:initiative|goal|commitment|alignment)\b/i,
    dependency: /\b(?:depend|blocked|waiting|requires|await)\b/i,
    conflict: /\b(?:conflict|contradict|supersed|changed)\b/i,
  };
  return candidates
    .map((candidate, index) => {
      const text = `${candidate.title}\n${candidate.excerpt}`;
      const metadata = [...(candidate.hierarchy ?? []), ...metadataValues(candidate.attributes)];
      const structuredText = metadata.join(" ");
      const terms = new Set(relevanceTerms(`${text}\n${structuredText}`));
      const overlap = [...questionTerms].filter((term) => terms.has(term)).length;
      const subjectMatches = subjectTerms.filter((term) => terms.has(term)).length;
      const facetCoverage = (query.facets ?? []).filter((facet) =>
        facetPatterns[facet]?.test(text),
      ).length;
      const direct =
        /\b(?:decided|approved|deployed|implemented|verified|blocked|accepted)\b/i.test(text);
      const incidental = /\b(?:mentioned|fyi|for reference|cc|unrelated|housekeeping)\b/i.test(
        text,
      );
      const superseded = /\b(?:superseded|obsolete|no longer|reverted|canceled)\b/i.test(text);
      const episodeMembership =
        candidate.parentLocator !== undefined ||
        candidate.passageKind === "conversation-span" ||
        candidate.passageKind?.includes("episode") === true;
      const lifecycleEvidence =
        /\b(?:planned|implementing|merged|released|deployed|accepted|blocked|canceled)\b/i.test(
          text,
        );
      const materialEvidence =
        /\b(?:decision|requirement|acceptance|customer|impact|dependency|blocker|rollout)\b/i.test(
          `${text}\n${structuredText}`,
        );
      const sourceStructured =
        (candidate.source === "teams" &&
          metadata.some((value) => /decision|acceptance|blocker/i.test(value))) ||
        (candidate.source === "github" &&
          metadata.some((value) => /symbol|module|handler|service/i.test(value))) ||
        (candidate.source === "vault" &&
          /typed-section|section-parent/.test(candidate.passageKind ?? "")) ||
        (candidate.source === "jira" && /field|comment|change/.test(candidate.passageKind ?? ""));
      const relationshipDistance =
        subjectTerms.length === 0 ? 0 : subjectMatches / subjectTerms.length;
      const score =
        candidate.score +
        subjectMatches * 0.35 +
        relationshipDistance * 0.2 +
        facetCoverage * 0.15 +
        Math.min(overlap, 8) * 0.03 +
        (direct ? 0.12 : 0) +
        (episodeMembership ? 0.08 : 0) +
        (lifecycleEvidence ? 0.08 : 0) +
        (materialEvidence ? 0.08 : 0) +
        (sourceStructured ? 0.06 : 0) +
        (candidate.passageKind?.includes("parent") === true ? 0.04 : 0) -
        (incidental ? 0.4 : 0) -
        (superseded && !(query.facets ?? []).includes("conflict") ? 0.3 : 0);
      return { candidate, index, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.authority - left.candidate.authority ||
        left.index - right.index,
    )
    .map(({ candidate, score }) => ({ ...candidate, score }));
};
