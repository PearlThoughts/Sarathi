import { describe, expect, it } from "vitest";
import { rerankKnowledgeCandidates } from "../src/modules/knowledge-layer/index.ts";

describe("knowledge reranker", () => {
  it("ranks direct facet evidence above incidental and superseded mentions", () => {
    const candidates = [
      {
        title: "Housekeeping",
        excerpt: "FYI, the product was mentioned in unrelated housekeeping.",
        source: "teams" as const,
        authority: 1,
        score: 1,
      },
      {
        title: "Product rollout",
        excerpt: "The product was deployed and QA verified the environment rollout.",
        source: "github" as const,
        authority: 0.9,
        score: 0.8,
      },
    ];
    expect(
      rerankKnowledgeCandidates(
        {
          question: "Is Product rollout deployed and verified?",
          subject: "Product rollout",
          facets: ["identity", "deployment", "verification"],
        },
        candidates,
      ).map(({ source }) => source),
    ).toEqual(["github", "teams"]);
  });

  it("uses episode, relationship, lifecycle, materiality, and source structure after fusion", () => {
    const ranked = rerankKnowledgeCandidates(
      {
        question: "Is Atlas rollout deployed and accepted?",
        subject: "Atlas rollout",
        facets: ["identity", "deployment", "acceptance", "lifecycle"],
      },
      [
        {
          title: "Atlas mention",
          excerpt: "Atlas rollout appeared in a weekly index.",
          source: "vault" as const,
          authority: 0.95,
          score: 1,
          passageKind: "paragraph",
        },
        {
          title: "Atlas rollout decision",
          excerpt: "The production deployment was accepted after QA verification.",
          source: "teams" as const,
          authority: 0.85,
          score: 0.75,
          passageKind: "message-acceptance",
          parentLocator: "#conversation-1-4",
          hierarchy: ["Delivery", "Atlas rollout"],
          attributes: { roles: ["decision", "acceptance"], identifiers: ["ATLAS-42"] },
        },
      ],
    );

    expect(ranked.map(({ source }) => source)).toEqual(["teams", "vault"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
