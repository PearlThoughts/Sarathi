import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createAiSdkDeliveryAnswerComposer } from "../src/infrastructure/model/index.ts";
import type { DeliveryAnswerComposer } from "../src/modules/delivery-intelligence/index.ts";
import type { GroundedAnswerGenerator } from "../src/modules/teams-mention/index.ts";

describe("AI SDK delivery answer composer", () => {
  it("passes completion governance and lifecycle metadata to grounded composition", async () => {
    const generate = vi.fn<GroundedAnswerGenerator["generate"]>(() =>
      Effect.succeed({ text: "generated", citations: [], unavailableSources: [] }),
    );
    const composer = createAiSdkDeliveryAnswerComposer({ generate });

    await Effect.runPromise(
      composer.compose({
        compositionAttempt: "full",
        workspaceId: "workspace",
        question: "Is Object Store Migration fully done?",
        requestedAt: "2026-08-03T10:00:00.000Z",
        plan: {
          version: 1,
          intents: ["delivered", "status"],
          operations: [{ id: "status-1", purpose: "status", select: "objects", limit: 10 }],
          subject: { phrase: "Object Store Migration" },
          answerMode: "model_assisted",
          maximumLines: 3,
          requiresFinance: false,
        },
        items: [
          {
            id: "migration",
            workspaceId: "workspace",
            source: "jira",
            selector: "objects",
            intent: "status",
            title: "Object Store Migration",
            summary: "Implementation is merged.",
            citationUrl: "https://jira.example.test/DEMO-1",
            sensitivity: "internal",
            authority: 0.9,
            lifecycleState: "done",
            completionStage: "merged",
            dedupeKey: "jira:migration",
          },
        ],
        conflicts: [],
        completionAssessment: {
          subject: {
            unresolvedPhrase: "Object Store Migration",
            candidateContractIds: [],
          },
          criteria: [],
          conflicts: [],
          excludedObservations: [],
          disposition: "not_established",
          summaryReason: "Required evidence is missing.",
        },
        responseProduct: "operational_answer",
        responseMode: "fast",
        responseBudget: {
          sourceTimeoutMs: 1_000,
          compositionTimeoutMs: 1_000,
          totalBudgetMs: 3_000,
        },
      }),
    );

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      modelTimeoutMs: 100,
      presentation: {
        kind: "completion_verdict",
        subject: "Object Store Migration",
        requiredVerdict: "cannot_verify",
      },
      evidence: [
        expect.objectContaining({
          excerpt: expect.stringContaining("Lifecycle: done. Completion stage: merged."),
        }),
      ],
    });
  });

  it("projects period capsules and supplemental Vault and Teams context into report synthesis", async () => {
    const generate = vi.fn<GroundedAnswerGenerator["generate"]>(() =>
      Effect.succeed({
        text: "generated",
        citations: [],
        unavailableSources: [],
      }),
    );
    const composer = createAiSdkDeliveryAnswerComposer({ generate });
    const input: Parameters<DeliveryAnswerComposer["compose"]>[0] = {
      compositionAttempt: "full",
      workspaceId: "workspace",
      question: "What did we deliver in the last 30 days?",
      requestedAt: "2026-07-30T10:00:00.000Z",
      plan: {
        version: 1,
        intents: ["delivered"],
        operations: [
          {
            id: "delivered-1",
            purpose: "delivered",
            select: "period_census",
            time: { kind: "lookback", days: 30 },
            census: { pageSize: 200, maximumCandidates: 50_000 },
            limit: 1,
          },
        ],
        answerMode: "model_assisted",
        maximumLines: 3,
        requiresFinance: false,
        requiredSources: ["github", "vault", "teams"],
      },
      items: [
        {
          id: "vault-context",
          workspaceId: "workspace",
          source: "vault",
          selector: "knowledge",
          intent: "delivered",
          title: "Publishing rationale",
          summary: "SEO metadata supports launch discoverability.",
          citationUrl: "https://vault.example.test/publishing",
          sensitivity: "internal",
          authority: 0.9,
          observedAt: "2026-07-29T10:00:00.000Z",
          dedupeKey: "vault:publishing",
        },
        {
          id: "teams-context",
          workspaceId: "workspace",
          source: "teams",
          selector: "observations",
          intent: "delivered",
          title: "Publishing handoff",
          summary: "The team confirmed the release handoff.",
          citationUrl: "https://teams.example.test/publishing",
          sensitivity: "internal",
          authority: 0.8,
          observedAt: "2026-07-29T11:00:00.000Z",
          dedupeKey: "teams:publishing",
        },
        ...Array.from({ length: 60 }, (_, index) => ({
          id: `supplemental-${index}`,
          workspaceId: "workspace",
          source: index % 2 === 0 ? ("vault" as const) : ("teams" as const),
          selector: "knowledge" as const,
          intent: "delivered" as const,
          title: `Supplemental context ${index}`,
          summary: "x".repeat(1_200),
          citationUrl: `https://context.example.test/${index}`,
          sensitivity: "internal" as const,
          authority: 0.7,
          observedAt: "2026-07-29T12:00:00.000Z",
          dedupeKey: `supplemental:${index}`,
        })),
      ],
      conflicts: [],
      periodDeliveryReport: {
        version: 1,
        census: {
          version: 1,
          boundary: {
            kind: "absolute",
            fromInclusive: "2026-07-01T00:00:00.000Z",
            toExclusive: "2026-07-31T00:00:00.000Z",
          },
          timeZone: "Asia/Kolkata",
          examinedCandidateCount: 12,
          candidateCount: 4,
          deliveredCandidateCount: 3,
          excludedCandidateCount: 1,
          duplicateCandidateCount: 2,
          unmappedCandidateCount: 0,
          exclusions: { generic_source_update_not_completion: 1 },
          unavailableSources: [],
          sourceCoverage: [
            {
              source: "github",
              available: true,
              checkpointAt: "2026-07-30T09:00:00.000Z",
              candidateCount: 3,
            },
          ],
          pagination: {
            pageSize: 200,
            pagesRead: 1,
            exhausted: true,
            maximumCandidates: 50_000,
          },
          complete: true,
          replayChecksum: "sha256-report",
        },
        capsules: [
          {
            id: "github:pull:101",
            title: "SEO metadata publishing",
            summary: "Published SEO metadata throughout the website builder.",
            latestActivityAt: "2026-07-29T09:00:00.000Z",
            completedAt: "2026-07-29T09:00:00.000Z",
            completionStage: "merged",
            lifecycleState: "development_ready",
            alignment: "governed_initiative",
            initiativeTitle: "Atlas Site Composer",
            capabilityKeys: ["modern-website-builder"],
            sprintClassifications: [],
            blocked: false,
            owners: [],
            sources: ["github"],
            citations: [
              {
                source: "github",
                url: "https://github.com/example/product/pull/101",
              },
            ],
            dependencies: [],
            jiraAdvisories: [],
            chain: [],
          },
        ],
        capabilitySections: [
          {
            key: "modern-website-builder",
            title: "Atlas Site Composer",
            evidencedAliases: ["SEO publishing"],
            capsules: [
              {
                id: "github:pull:101",
                title: "SEO metadata publishing",
                summary: "Published SEO metadata throughout the website builder.",
                latestActivityAt: "2026-07-29T09:00:00.000Z",
                completedAt: "2026-07-29T09:00:00.000Z",
                completionStage: "merged",
                lifecycleState: "development_ready",
                alignment: "governed_initiative",
                initiativeTitle: "Atlas Site Composer",
                capabilityKeys: ["modern-website-builder"],
                sprintClassifications: [],
                blocked: false,
                owners: [],
                sources: ["github"],
                citations: [
                  {
                    source: "github",
                    url: "https://github.com/example/product/pull/101",
                  },
                ],
                dependencies: [],
                jiraAdvisories: [],
                chain: [],
              },
            ],
            outcomes: [
              {
                evidenceClass: "unknown",
                statement: "No measured outcome is linked.",
                citations: [],
              },
            ],
          },
        ],
        deliveredEpisodes: [],
        inProgressEpisodes: [],
        dependencies: [],
        decisionsNeeded: [],
        jiraAdvisories: [],
        unmappedCapsules: [],
        excludedImmaterialActivityCount: 0,
        incompleteChainCount: 1,
      },
      responseProduct: "period_delivery_brief",
      responseMode: "deep_dive",
      responseBudget: {
        sourceTimeoutMs: 90_000,
        compositionTimeoutMs: 60_000,
        totalBudgetMs: 150_000,
      },
    };

    await Effect.runPromise(composer.compose(input));

    const envelope = generate.mock.calls[0]?.[0];
    expect(envelope?.presentation).toMatchObject({
      kind: "delivery_report",
      requiredCitationSources: ["github", "vault", "teams"],
      coverage: {
        examinedRecords: 12,
        acceptedChanges: 1,
        duplicateRecords: 2,
      },
      capabilitySections: [
        {
          title: "Atlas Site Composer",
          changeCount: 1,
          evidencedInitiatives: ["SEO publishing"],
        },
      ],
      episodes: [
        expect.objectContaining({
          capability: "Atlas Site Composer",
          initiative: "Atlas Site Composer",
          lifecycleState: "development_ready",
        }),
      ],
    });
    expect(envelope?.evidence.slice(0, 3).map(({ source }) => source)).toEqual([
      "github",
      "vault",
      "teams",
    ]);
    expect(envelope?.evidence[0]).toMatchObject({
      title: "Delivery episode — Atlas Site Composer: SEO metadata publishing",
      sourceUrl: "https://github.com/example/product/pull/101",
    });
    expect(envelope?.evidence).toHaveLength(37);
    expect(
      envelope?.evidence
        .slice(1)
        .every(({ excerpt, title }) => excerpt.length <= 900 && title.length <= 320),
    ).toBe(true);

    await Effect.runPromise(composer.compose({ ...input, compositionAttempt: "reduced" }));

    const reducedEnvelope = generate.mock.calls[1]?.[0];
    expect(reducedEnvelope?.evidence).toHaveLength(19);
    expect(reducedEnvelope?.evidence[0]?.excerpt.length).toBeLessThanOrEqual(450);
    expect(
      reducedEnvelope?.presentation?.kind === "delivery_report"
        ? reducedEnvelope.presentation.episodes
        : undefined,
    ).toHaveLength(1);
  });
});
