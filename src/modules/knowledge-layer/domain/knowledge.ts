import { stableSha256 } from "../../../domain/hash.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../../domain/policy.ts";

export type KnowledgeSourceKind = "jira" | "vault" | "github" | "teams" | "email";
export type KnowledgeAclEffect = "allow" | "deny";
export type KnowledgeAclSubjectType = "workspace" | "audience" | "actor";

export type KnowledgeAclRule = {
  readonly effect: KnowledgeAclEffect;
  readonly subjectType: KnowledgeAclSubjectType;
  readonly subjectId: string;
};

export type KnowledgeAudience = {
  readonly workspaceId: string;
  readonly actorId?: string | undefined;
  readonly audienceIds: readonly string[];
  readonly maximumSensitivity: SensitivityTier;
};

export type KnowledgeCandidateMetadata = {
  readonly id: string;
  readonly workspaceId: string;
  readonly sensitivity: SensitivityTier;
  readonly active: boolean;
  readonly deleted: boolean;
  readonly acl: readonly KnowledgeAclRule[];
};

export type KnowledgePassageDraft = {
  readonly kind: string;
  readonly locator: string;
  readonly ordinal: number;
  readonly title: string;
  readonly body: string;
  readonly contentHash: string;
};

export type RankedKnowledgeCandidate = {
  readonly id: string;
  readonly source: KnowledgeSourceKind;
  readonly authority: number;
  readonly freshness: number;
};

export type FusedKnowledgeCandidate = RankedKnowledgeCandidate & {
  readonly fusedScore: number;
  readonly componentRanks: Readonly<Record<string, number>>;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const subjectMatches = (rule: KnowledgeAclRule, audience: KnowledgeAudience): boolean => {
  switch (rule.subjectType) {
    case "workspace":
      return rule.subjectId === audience.workspaceId;
    case "audience":
      return audience.audienceIds.includes(rule.subjectId);
    case "actor":
      return audience.actorId !== undefined && rule.subjectId === audience.actorId;
  }
};

export const isKnowledgeCandidateAuthorized = (
  candidate: KnowledgeCandidateMetadata,
  audience: KnowledgeAudience,
): boolean => {
  if (
    candidate.workspaceId !== audience.workspaceId ||
    !candidate.active ||
    candidate.deleted ||
    !isSensitivityAtOrBelow(candidate.sensitivity, audience.maximumSensitivity)
  ) {
    return false;
  }

  const applicable = candidate.acl.filter((rule) => subjectMatches(rule, audience));
  return applicable.length > 0 && !applicable.some((rule) => rule.effect === "deny");
};

const splitWithOverlap = (
  body: string,
  maximumCharacters: number,
  overlapCharacters: number,
): readonly string[] => {
  if (body.length <= maximumCharacters) return [body];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < body.length) {
    const targetEnd = Math.min(offset + maximumCharacters, body.length);
    const paragraphBreak = body.lastIndexOf("\n\n", targetEnd);
    const end =
      paragraphBreak > offset + Math.floor(maximumCharacters / 2) ? paragraphBreak : targetEnd;
    chunks.push(body.slice(offset, end).trim());
    if (end >= body.length) break;
    offset = Math.max(end - overlapCharacters, offset + 1);
  }
  return chunks.filter((chunk) => chunk !== "");
};

const slug = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export const chunkVaultMarkdown = (
  markdown: string,
  maximumCharacters = 2500,
  overlapCharacters = 300,
): readonly KnowledgePassageDraft[] => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: { title: string; anchor: string; lines: string[] }[] = [];
  const headingOccurrences = new Map<string, number>();
  let current = { title: "Document", anchor: "document", lines: [] as string[] };
  for (const line of lines) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[2] !== undefined) {
      if (current.lines.some((entry) => entry.trim() !== "")) sections.push(current);
      const title = normalizeWhitespace(heading[2]);
      const baseAnchor = slug(title) || "section";
      const occurrence = headingOccurrences.get(baseAnchor) ?? 0;
      headingOccurrences.set(baseAnchor, occurrence + 1);
      current = {
        title,
        anchor: occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`,
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((entry) => entry.trim() !== "") || sections.length === 0)
    sections.push(current);

  const passages: KnowledgePassageDraft[] = [];
  for (const section of sections) {
    const body = section.lines.join("\n").trim();
    const chunks = splitWithOverlap(body, maximumCharacters, overlapCharacters);
    chunks.forEach((chunk, chunkIndex) => {
      const locator =
        chunks.length === 1 ? `#${section.anchor}` : `#${section.anchor}:part-${chunkIndex + 1}`;
      passages.push({
        kind: "heading",
        locator,
        ordinal: passages.length,
        title: section.title,
        body: chunk,
        contentHash: stableSha256(`${section.title}\n${chunk}`),
      });
    });
  }
  return passages;
};

export const createTypedPassage = (
  kind: string,
  locator: string,
  ordinal: number,
  title: string,
  body: string,
): KnowledgePassageDraft | undefined => {
  const normalizedBody = normalizeWhitespace(body);
  if (normalizedBody === "") return undefined;
  return {
    kind,
    locator,
    ordinal,
    title: normalizeWhitespace(title),
    body: normalizedBody,
    contentHash: stableSha256(`${kind}\n${locator}\n${normalizedBody}`),
  };
};

export const reciprocalRankFusion = (
  rankedLists: Readonly<Record<string, readonly RankedKnowledgeCandidate[]>>,
  rrfK = 60,
): readonly FusedKnowledgeCandidate[] => {
  if (!Number.isFinite(rrfK) || rrfK <= 0) throw new Error("rrfK must be positive.");
  const fused = new Map<
    string,
    RankedKnowledgeCandidate & { score: number; componentRanks: Record<string, number> }
  >();
  for (const [component, candidates] of Object.entries(rankedLists)) {
    const seen = new Set<string>();
    candidates.forEach((candidate, index) => {
      if (seen.has(candidate.id)) return;
      seen.add(candidate.id);
      const current = fused.get(candidate.id) ?? {
        ...candidate,
        score: 0,
        componentRanks: {},
      };
      const rank = index + 1;
      current.score += 1 / (rrfK + rank);
      current.componentRanks[component] = rank;
      fused.set(candidate.id, current);
    });
  }

  return [...fused.values()]
    .map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      authority: candidate.authority,
      freshness: candidate.freshness,
      fusedScore:
        candidate.score *
        (1 + Math.min(Math.max(candidate.authority, 0), 1) * 0.1) *
        (1 + Math.min(Math.max(candidate.freshness, 0), 1) * 0.05),
      componentRanks: candidate.componentRanks,
    }))
    .sort((left, right) => right.fusedScore - left.fusedScore || left.id.localeCompare(right.id));
};
