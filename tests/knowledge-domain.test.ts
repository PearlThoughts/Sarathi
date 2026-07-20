import { describe, expect, it } from "vitest";
import {
  chunkVaultMarkdown,
  createTypedPassage,
  isKnowledgeCandidateAuthorized,
  type RankedKnowledgeCandidate,
  reciprocalRankFusion,
} from "../src/modules/knowledge-layer/index.ts";

describe("knowledge domain", () => {
  it("fails closed before content retrieval for wrong workspace, sensitivity, deletion, and ACL", () => {
    const base = {
      id: "passage-1",
      workspaceId: "example",
      sensitivity: "internal" as const,
      active: true,
      deleted: false,
      acl: [{ effect: "allow" as const, subjectType: "audience" as const, subjectId: "delivery" }],
    };
    const audience = {
      workspaceId: "example",
      actorId: "actor-1",
      audienceIds: ["delivery"],
      maximumSensitivity: "internal" as const,
    };

    expect(isKnowledgeCandidateAuthorized(base, audience)).toBe(true);
    expect(isKnowledgeCandidateAuthorized({ ...base, workspaceId: "finance" }, audience)).toBe(
      false,
    );
    expect(isKnowledgeCandidateAuthorized({ ...base, sensitivity: "restricted" }, audience)).toBe(
      false,
    );
    expect(isKnowledgeCandidateAuthorized({ ...base, active: false }, audience)).toBe(false);
    expect(isKnowledgeCandidateAuthorized({ ...base, deleted: true }, audience)).toBe(false);
    expect(isKnowledgeCandidateAuthorized({ ...base, acl: [] }, audience)).toBe(false);
    expect(
      isKnowledgeCandidateAuthorized(
        {
          ...base,
          acl: [...base.acl, { effect: "deny", subjectType: "actor", subjectId: "actor-1" }],
        },
        audience,
      ),
    ).toBe(false);
  });

  it("chunks Vault Markdown by headings and splits oversized sections with overlap", () => {
    const body = `# Decision\nApproved direction.\n\n## Risks\n${"risk ".repeat(700)}`;
    const passages = chunkVaultMarkdown(body, 400, 60);

    expect(passages[0]).toMatchObject({ title: "Decision", locator: "#decision" });
    expect(passages.filter((passage) => passage.title === "Risks").length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.body.length <= 400)).toBe(true);
    expect(new Set(passages.map((passage) => passage.locator)).size).toBe(passages.length);
  });

  it("creates stable typed Jira passages and omits empty fields", () => {
    expect(createTypedPassage("field", "status", 0, "Status", "  In   Progress ")).toMatchObject({
      locator: "status",
      body: "In Progress",
      contentHash: expect.stringMatching(/^sha256-/),
    });
    expect(createTypedPassage("comment", "comment-1", 1, "Comment", "   ")).toBeUndefined();
  });

  it("fuses independent ranks, suppresses duplicates, and applies bounded authority/freshness", () => {
    const candidate = (
      id: string,
      source: RankedKnowledgeCandidate["source"],
      authority: number,
      freshness: number,
    ): RankedKnowledgeCandidate => ({ id, source, authority, freshness });
    const fused = reciprocalRankFusion({
      exact: [candidate("jira-1", "jira", 1, 1), candidate("jira-1", "jira", 1, 1)],
      keyword: [candidate("vault-1", "vault", 0.8, 0.8), candidate("jira-1", "jira", 1, 1)],
      vector: [candidate("vault-1", "vault", 0.8, 0.8)],
    });

    expect(fused.map((entry) => entry.id)).toEqual(["jira-1", "vault-1"]);
    expect(fused[0]?.componentRanks).toEqual({ exact: 1, keyword: 2 });
    expect(fused[1]?.componentRanks).toEqual({ keyword: 1, vector: 1 });
  });
});
