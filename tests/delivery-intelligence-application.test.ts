import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  compilePeriodCensus,
  createDeliveryAssistant,
  type DeliveryAnswerComposer,
  type DeliveryClaim,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  deliveryClaimValueHash,
  deliveryResponseBudget,
  deliveryResponseModePolicies,
  planDeliveryQuestion,
  selectDeliveryResponseMode,
} from "../src/modules/delivery-intelligence/index.ts";

const request = {
  workspaceId: "workspace-example",
  actorId: "actor-example",
  maximumSensitivity: "internal",
  financeAccess: false,
  requestedAt: "2026-07-20T13:09:00.000Z",
  timeZone: "Asia/Kolkata",
  question: "What did the team do today?",
} as const;

const item = (
  source: "github" | "jira" | "teams" | "vault" | "strategy",
  id: string,
  summary: string,
  intent:
    | "activity"
    | "dependencies"
    | "status"
    | "risks"
    | "next_actions"
    | "goals"
    | "delivered"
    | "current_work" = "activity",
): DeliveryResultItem => ({
  id,
  workspaceId: request.workspaceId,
  source,
  selector:
    intent === "activity" ? "observations" : intent === "dependencies" ? "relations" : "objects",
  intent,
  title: summary,
  summary,
  citationUrl: `https://example.com/${source}/${id}`,
  sensitivity: "internal",
  authority: 0.9,
  observedAt: "2026-07-20T10:00:00.000Z",
  dedupeKey: summary.toLowerCase(),
});

const capabilityReportComposer: DeliveryAnswerComposer = {
  compose: (input) => {
    const report = input.periodDeliveryReport;
    if (report === undefined)
      return Effect.fail(
        new RepositoryError({ message: "missing report", operation: "test-report-composer" }),
      );
    const selected = [
      ...new Map(
        report.capabilitySections
          .flatMap(({ capsules }) => capsules)
          .map((capsule) => [capsule.id, capsule]),
      ).values(),
    ].slice(0, 20);
    const citations = (
      selected.length === 0
        ? input.items.slice(0, 20).map(({ source, citationUrl: url }) => ({ source, url }))
        : selected.flatMap((capsule) => capsule.citations.slice(0, 1))
    ).map(({ source, url }, index) => ({ label: `${source}-${index + 1}`, url }));
    const uniqueCitations = [
      ...new Map(citations.map((citation) => [citation.url, citation])).values(),
    ];
    const references = uniqueCitations.map(
      ({ url }, index) => `- [Reference ${index + 1}](${url})`,
    );
    if (report.sprintReview !== undefined) {
      const review = report.sprintReview;
      const sprintLabel = (
        sprint: typeof review.previousSprint | typeof review.currentSprint,
        fallback: string,
      ): string =>
        sprint === undefined
          ? fallback
          : `${sprint.name} (${sprint.startAt?.slice(0, 10) ?? "start unknown"} to ${sprint.endAt?.slice(0, 10) ?? "end unknown"})`;
      const initiativeLines = review.initiatives.map(
        (initiative) =>
          `- **${initiative.title} — ${initiative.health}:** ${initiative.progress}; ${initiative.healthExplanation}`,
      );
      return Effect.succeed({
        text: [
          "## Sprint overview",
          `- ${sprintLabel(review.previousSprint, "Previous sprint")} closed; ${sprintLabel(review.currentSprint, "Current sprint")} is active.`,
          "## Previous sprint",
          ...(review.plannedAtStart.length === 0
            ? ["- **Planned at start:** No committed work was observed."]
            : review.plannedAtStart.map(({ title }) => `- **Planned at start:** ${title}`)),
          ...(review.completedDuringSprint.length === 0
            ? ["- **Delivered:** No completed work was observed."]
            : review.completedDuringSprint.map(({ title }) => `- **Delivered:** ${title}`)),
          ...(review.rolledIntoCurrent.length === 0
            ? ["- **Rolled over:** No rollover was observed."]
            : review.rolledIntoCurrent.map(({ title }) => `- **Rolled over:** ${title}`)),
          ...(review.addedDuringSprint.length === 0
            ? ["- **Added during sprint:** No material addition was observed."]
            : review.addedDuringSprint.map(({ title }) => `- **Added during sprint:** ${title}`)),
          ...(review.dropped.length === 0
            ? ["- No dropped or superseded work was observed."]
            : review.dropped.map(({ title }) => `- **Dropped:** ${title}`)),
          "## Current sprint",
          ...(initiativeLines.length === 0
            ? review.currentSprintWork.map(({ title }) => `- **Unknown:** ${title}`)
            : initiativeLines),
          "## Q3 alignment",
          ...initiativeLines,
          ...(review.initiativesWithoutCurrentSprintActivity.length === 0
            ? []
            : [
                `- **No current-sprint activity:** ${review.initiativesWithoutCurrentSprintActivity.map(({ title }) => title).join(", ")}`,
              ]),
          ...(review.unaccountedWork.length === 0
            ? []
            : [
                `- **Unaccounted work:** ${review.unaccountedWork.map(({ title }) => title).join(", ")}`,
              ]),
          "## Waiting or decisions",
          ...(report.dependencies.length === 0
            ? ["- No material wait was observed."]
            : report.dependencies.map(
                ({ waiting, awaited, requiredAction }) =>
                  `- ${waiting} is waiting for ${awaited}. ${requiredAction}`,
              )),
          "## Jira hygiene",
          ...(report.jiraAdvisories.length === 0
            ? ["- No Jira correction was identified."]
            : report.jiraAdvisories.map(({ message }) => `- ${message}`)),
          "## References",
          ...references,
        ].join("\n"),
        citations: uniqueCitations,
      });
    }
    const period =
      report.census.boundary.kind === "absolute"
        ? "1 Apr 2026 – 30 Jun 2026 (Asia/Kolkata)"
        : report.census.boundary.reference;
    const lineFor = (capsule: (typeof report.capsules)[number]): string => {
      const capability =
        report.capabilitySections.find(({ key }) => capsule.capabilityKeys.includes(key))?.title ??
        "Unaccounted work";
      return `- **${capability}** — ${capsule.title}`;
    };
    return Effect.succeed({
      text: [
        "## Delivered",
        `**Period:** ${period}`,
        ...selected
          .filter(
            ({ lifecycleState }) =>
              lifecycleState === "production" || lifecycleState === "accepted",
          )
          .map(lineFor),
        "## In progress",
        ...selected
          .filter(
            ({ lifecycleState }) =>
              lifecycleState !== "production" && lifecycleState !== "accepted",
          )
          .map(lineFor),
        "## Waiting or blocked",
        ...(report.dependencies.length === 0
          ? ["- No active waits."]
          : report.dependencies.map(
              ({ waiting, awaited }) => `- ${waiting} is waiting for ${awaited}.`,
            )),
        "## Decisions needed",
        ...(report.decisionsNeeded.length === 0
          ? ["- No decisions."]
          : report.decisionsNeeded.map((decision) => `- ${decision}`)),
        "## References",
        ...references,
      ].join("\n"),
      citations: uniqueCitations,
    });
  },
};

describe("delivery intelligence application", () => {
  it("allows bounded live sources to finish before the Teams response deadline", () => {
    expect(deliveryResponseBudget).toEqual({
      sourceTimeoutMs: 15_000,
      compositionTimeoutMs: 15_000,
      totalBudgetMs: 30_000,
    });
    expect(deliveryResponseBudget.sourceTimeoutMs).toBeLessThan(
      deliveryResponseBudget.totalBudgetMs,
    );
    expect(deliveryResponseModePolicies.structured.totalBudgetMs).toBeGreaterThan(
      deliveryResponseBudget.totalBudgetMs,
    );
    expect(deliveryResponseModePolicies.deep_dive.maximumItems).toBeUndefined();
    expect(deliveryResponseModePolicies.deep_dive.maximumLines).toBeUndefined();
    expect(deliveryResponseModePolicies.deep_dive.latencyTargetMs).toBeUndefined();
    expect(deliveryResponseModePolicies.deep_dive.totalBudgetMs).toBe(240_000);
  });

  it("selects response depth before retrieval and honors an explicit mode", () => {
    expect(selectDeliveryResponseMode("Who owns DEMO-1 today?")).toBe("fast");
    expect(selectDeliveryResponseMode("Give me a weekly status report")).toBe("structured");
    expect(selectDeliveryResponseMode("Investigate the full history and root cause")).toBe(
      "deep_dive",
    );
    expect(selectDeliveryResponseMode("Quick status", "deep_dive")).toBe("deep_dive");
  });

  it("propagates a period-report product and budget and renders exhaustive census coverage", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.succeed({
        items: [
          item("jira", "period-jira", "Jira delivery evidence", "delivered"),
          item("github", "period-github", "Merged delivery evidence", "delivered"),
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
        periodCensus: {
          version: 1,
          boundary: {
            kind: "absolute",
            fromInclusive: "2026-06-21T18:30:00.000Z",
            toExclusive: "2026-07-21T18:30:00.000Z",
          },
          timeZone: "Asia/Kolkata",
          examinedCandidateCount: 43,
          candidateCount: 40,
          deliveredCandidateCount: 12,
          excludedCandidateCount: 2,
          duplicateCandidateCount: 1,
          unmappedCandidateCount: 3,
          exclusions: { generic_source_update_not_completion: 2 },
          unavailableSources: [],
          sourceCoverage: [
            {
              source: "github",
              available: true,
              checkpointAt: "2026-07-20T12:00:00.000Z",
              candidateCount: 20,
            },
            {
              source: "jira",
              available: true,
              checkpointAt: "2026-07-20T12:00:00.000Z",
              candidateCount: 20,
            },
          ],
          pagination: {
            pageSize: 20,
            pagesRead: 3,
            exhausted: true,
            maximumCandidates: 100,
          },
          complete: true,
          replayChecksum: "sha256-period-census",
        },
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["period_census"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: capabilityReportComposer,
        capabilityLedger: {
          version: 1,
          capabilities: [
            { key: "delivery", title: "Delivery capability", aliases: [{ value: "delivery" }] },
          ],
        },
        now: () => new Date(request.requestedAt),
      }).answer({
        ...request,
        question: "Give me a delivery report for the last 30 days",
      }),
    );

    expect(answer).toMatchObject({
      responseProduct: "period_delivery_brief",
      responseMode: "deep_dive",
      responseBudget: {
        sourceTimeoutMs: 90_000,
        compositionTimeoutMs: 120_000,
        totalBudgetMs: 240_000,
      },
      periodCensus: {
        candidateCount: 40,
        deliveredCandidateCount: 12,
        complete: true,
      },
      acceptance: {
        product: "period_delivery_brief",
        mode: "deep_dive",
      },
    });
    expect(answer.text).toContain("## Delivered");
    expect(answer.text).toContain("## References");
    expect(answer.text).not.toContain("Coverage");
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      responseProduct: "period_delivery_brief",
      responseMode: "deep_dive",
      totalBudgetMs: 240_000,
      sourceTimeoutMs: 90_000,
      deadlineAt: "2026-07-20T13:13:00.000Z",
    });
    expect(
      execute.mock.calls[0]?.[1].operations.find(({ select }) => select === "period_census"),
    ).toMatchObject({
      select: "period_census",
      census: { pageSize: 200, maximumCandidates: 50_000 },
    });
  });

  it("composes a sub-30-day report from completed changes and cross-source context", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>((input) =>
      Effect.succeed({
        text:
          input.compositionAttempt === "full"
            ? "## Delivery report\nFirst composition omitted the required synthesis structure."
            : [
                "## Delivered",
                "- SEO publishing moved through implementation, while the Vault record preserves the product rationale.",
                "## In progress",
                "- No active work.",
                "## Waiting or blocked",
                "- No active waits.",
                "## Decisions needed",
                "- No decisions.",
                "## References",
                "- [PR](https://example.com/github/publishing-pr(release))",
              ].join("\n"),
        citations:
          input.compositionAttempt === "full"
            ? []
            : [{ label: "PR", url: "https://example.com/github/publishing-pr(release)" }],
      }),
    );
    const execute = vi.fn<DeliveryQuerySource["execute"]>((context) =>
      context.question.startsWith("Latest delivery state")
        ? Effect.succeed({
            items: [
              {
                ...item(
                  "vault",
                  "publishing-rationale",
                  "Publishing metadata is required for launch discoverability",
                  "delivered",
                ),
                selector: "knowledge",
              },
            ],
            conflicts: [],
            unavailableSources: [],
            complete: true,
          })
        : Effect.succeed({
            items: [
              {
                ...item("github", "publishing-pr", "Merged SEO metadata publishing", "delivered"),
                selector: "period_census",
                completionStage: "merged",
                subjectAliases: ["SEO publishing"],
                citationUrl: "https://example.com/github/publishing-pr(release)",
              },
              {
                ...item(
                  "teams",
                  "publishing-handoff",
                  "The team confirmed the publishing handoff",
                  "delivered",
                ),
                selector: "observations",
              },
              {
                ...item(
                  "jira",
                  "publishing-work",
                  "DEMO-41 completed SEO metadata publishing",
                  "delivered",
                ),
                lifecycleState: "done" as const,
              },
            ],
            conflicts: [],
            unavailableSources: [],
            complete: true,
            periodCensus: {
              version: 1,
              boundary: {
                kind: "absolute",
                fromInclusive: "2026-06-20T18:30:00.000Z",
                toExclusive: "2026-07-20T18:30:00.000Z",
              },
              timeZone: "Asia/Kolkata",
              examinedCandidateCount: 3,
              candidateCount: 1,
              deliveredCandidateCount: 1,
              excludedCandidateCount: 0,
              duplicateCandidateCount: 0,
              unmappedCandidateCount: 0,
              exclusions: {},
              unavailableSources: [],
              sourceCoverage: [
                {
                  source: "github",
                  available: true,
                  checkpointAt: "2026-07-20T12:00:00.000Z",
                  candidateCount: 1,
                },
              ],
              pagination: {
                pageSize: 200,
                pagesRead: 1,
                exhausted: true,
                maximumCandidates: 50_000,
              },
              complete: true,
              replayChecksum: "sha256-sub-30-day",
            },
          }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "period_census", "knowledge"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
        capabilityLedger: {
          version: 1,
          capabilities: [
            {
              key: "modern-website-builder",
              title: "Atlas Site Composer",
              aliases: [{ value: "SEO publishing" }],
            },
          ],
        },
      }).answer({
        ...request,
        question: "What did the team deliver in the last 30 days?",
      }),
    );

    expect(compose).toHaveBeenCalledTimes(2);
    expect(compose.mock.calls.map(([input]) => input.compositionAttempt)).toEqual([
      "full",
      "reduced",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0].question).toContain("Latest delivery state");
    expect(execute.mock.calls[1]?.[0].question).toContain("Atlas Site Composer");
    expect(compose.mock.calls[0]?.[0]).toMatchObject({
      responseProduct: "period_delivery_brief",
      responseMode: "deep_dive",
      periodDeliveryReport: {
        capsules: [expect.objectContaining({ title: "Merged SEO metadata publishing" })],
      },
    });
    expect(compose.mock.calls[0]?.[0].items.map(({ source }) => source).toSorted()).toEqual([
      "jira",
      "teams",
      "vault",
    ]);
    expect(answer.text).toContain("## Delivered");
    expect(answer.text).toContain("Vault record preserves the product rationale");
    expect(answer.text.split(/\r?\n/).length).toBeGreaterThan(3);
    expect(answer.acceptance).toMatchObject({
      mode: "deep_dive",
      product: "period_delivery_brief",
      formatPassed: true,
      citationPassed: true,
      groundingPassed: true,
      passed: true,
    });
  });

  it("renders a previous-quarter delivery question as a capability-grouped leadership report", async () => {
    const periodCensus = {
      version: 1,
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-03-31T18:30:00.000Z",
        toExclusive: "2026-06-30T18:30:00.000Z",
      },
      timeZone: "Asia/Kolkata",
      examinedCandidateCount: 3,
      candidateCount: 2,
      deliveredCandidateCount: 2,
      excludedCandidateCount: 1,
      duplicateCandidateCount: 0,
      unmappedCandidateCount: 0,
      exclusions: { generic_source_update_not_completion: 1 },
      unavailableSources: [],
      sourceCoverage: [
        {
          source: "github",
          available: true,
          checkpointAt: "2026-07-20T12:00:00.000Z",
          candidateCount: 1,
        },
        {
          source: "jira",
          available: true,
          checkpointAt: "2026-07-20T12:00:00.000Z",
          candidateCount: 1,
        },
      ],
      pagination: {
        pageSize: 200,
        pagesRead: 2,
        exhausted: true,
        maximumCandidates: 50_000,
      },
      complete: true,
      replayChecksum: "sha256-private-report-census",
    } as const;
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item(
                "github",
                "github-pr",
                "PROJ-101 added SEO metadata publishing support",
                "delivered",
              ),
              selector: "period_census" as const,
              title: "SEO metadata publishing",
              citationUrl: "https://github.com/example/product/pull/101",
              completionStage: "merged" as const,
              observedAt: "2026-05-12T10:00:00.000Z",
            },
            {
              ...item(
                "jira",
                "jira-work",
                "PROJ-101 completed SEO metadata publishing",
                "delivered",
              ),
              selector: "period_census" as const,
              title: "SEO metadata publishing",
              completionStage: "merged" as const,
              observedAt: "2026-05-12T10:00:00.000Z",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: capabilityReportComposer,
        capabilityLedger: {
          version: 1,
          capabilities: [
            {
              key: "seo-improvements",
              title: "SEO improvements",
              aliases: [{ value: "SEO" }, { value: "metadata" }],
            },
          ],
        },
        now: () => new Date(request.requestedAt),
      }).answer({
        ...request,
        question: "What have we delivered in the previous quarter?",
      }),
    );

    expect(answer).toMatchObject({
      responseProduct: "leadership_report",
      responseMode: "deep_dive",
      status: "ok",
      periodDeliveryReport: {
        capsules: [{ completionStage: "merged", capabilityKeys: ["seo-improvements"] }],
        capabilitySections: [{ key: "seo-improvements" }],
      },
      acceptance: {
        product: "leadership_report",
        formatPassed: true,
        citationPassed: true,
        groundingPassed: true,
        completenessPassed: true,
        passed: true,
      },
    });
    expect(answer.text).toContain("## Delivered");
    expect(answer.text).toContain("**Period:** 1 Apr 2026 – 30 Jun 2026 (Asia/Kolkata)");
    expect(answer.text).toContain("**SEO improvements**");
    expect(answer.text).toContain("## References");
    expect(answer.text).not.toContain("evidence");
    expect(answer.text).not.toContain("Business impact");
    expect(answer.text).not.toContain("Gaps and unknowns");
    expect(answer.text).not.toContain("replay checksum");
    expect(answer.text).not.toContain("### Delivery brief");
    expect(answer.text.match(/- \*\*SEO improvements\*\*/g)).toHaveLength(1);
  });

  it("reconstructs a capability episode with lifecycle, dependency, and advisory Jira hygiene", async () => {
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-07-12T18:30:00.000Z",
        toExclusive: "2026-07-19T18:30:00.000Z",
      },
      timeZone: "Asia/Kolkata",
      candidates: [],
      configuredSources: ["github", "jira"],
      sourceCheckpoints: new Map([
        ["github", "2026-07-19T17:00:00.000Z"],
        ["jira", "2026-07-19T17:00:00.000Z"],
      ]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "relations", "observations", "period_census", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item(
                "github",
                "lead-routing-release",
                "PROJ-101 deployed the lead-routing dashboard to production",
                "delivered",
              ),
              selector: "period_census" as const,
              completionStage: "deployed" as const,
              dedupeKey: "github:lead-routing-release",
            },
            {
              ...item(
                "jira",
                "PROJ-101-current",
                "PROJ-101 In Progress: lead-routing dashboard",
                "current_work",
              ),
              lifecycleState: "active" as const,
              owner: { source: "jira" as const, displayName: "Pavithra" },
              planning: {
                externalKey: "PROJ-101",
                status: "In Progress",
                sprint: "Delivery Sprint 8",
                hasDependency: true,
                hasAcceptanceInformation: false,
              },
            },
            {
              ...item(
                "strategy",
                "q3-lead-response",
                "Q3 faster lead response through the lead-routing dashboard",
                "goals",
              ),
              evidenceRole: "declared_intent" as const,
            },
            {
              ...item(
                "jira",
                "PROJ-101-dependency",
                "PROJ-101 (Pavithra) waits on PROJ-102 (Arun): QA sign-off for the lead-routing dashboard",
                "dependencies",
              ),
              owner: { source: "jira" as const, displayName: "Pavithra" },
              planning: {
                externalKey: "PROJ-101",
                status: "In Progress",
                sprint: "Delivery Sprint 8",
                hasDependency: true,
                hasAcceptanceInformation: false,
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: capabilityReportComposer,
        capabilityLedger: {
          version: 1,
          capabilities: [
            {
              key: "lead-routing-dashboard",
              title: "Lead-routing dashboard",
              aliases: [{ value: "lead-routing dashboard" }],
            },
          ],
        },
      }).answer({
        ...request,
        question: "What did we deliver last week?",
      }),
    );

    expect(answer.periodDeliveryReport).toMatchObject({
      deliveredEpisodes: [
        {
          lifecycleState: "production",
          alignment: "governed_initiative",
          initiativeTitle: "Q3 faster lead response through the lead-routing dashboard",
          capabilityKeys: ["lead-routing-dashboard"],
        },
      ],
      dependencies: [expect.objectContaining({ waiting: "Pavithra", awaited: "Arun" })],
      jiraAdvisories: expect.arrayContaining([
        expect.objectContaining({ kind: "contradictory_status" }),
        expect.objectContaining({ kind: "missing_acceptance" }),
      ]),
    });
    for (const heading of [
      "## Delivered",
      "## In progress",
      "## Waiting or blocked",
      "## Decisions needed",
      "## References",
    ])
      expect(answer.text).toContain(heading);
    expect(answer.text).toContain("Pavithra is waiting for Arun");
    expect(answer.text).not.toContain("coverage");
  });

  it("assigns an initiative to one primary capability without a fixed three-item cap", async () => {
    const capabilityLedger = {
      version: 1 as const,
      capabilities: [
        {
          key: "website-builder",
          title: "Website Builder enhancements",
          aliases: [{ value: "builder" }],
        },
        {
          key: "compliance-technology",
          title: "Compliance and technology updates",
          aliases: [{ value: "dependency hardening" }, { value: "security" }],
        },
      ],
    };
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-03-31T18:30:00.000Z",
        toExclusive: "2026-06-30T18:30:00.000Z",
      },
      timeZone: "Asia/Kolkata",
      candidates: [],
      configuredSources: ["github"],
      sourceCheckpoints: new Map([["github", "2026-06-30T18:00:00.000Z"]]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            ...Array.from({ length: 5 }, (_, index) => ({
              ...item(
                "github",
                `security-${index}`,
                `PROJ-${700 + index} builder dependency hardening ${index}`,
                "delivered",
              ),
              selector: "period_census" as const,
              title: `PR #${index + 1}: PROJ-${700 + index} builder dependency hardening ${index}`,
              completionStage: "merged" as const,
              observedAt: `2026-06-${String(10 + index).padStart(2, "0")}T10:00:00.000Z`,
            })),
            ...Array.from({ length: 20 }, (_, index) => ({
              ...item(
                "github",
                `unmapped-${index}`,
                `Unclassified repository maintenance ${index}`,
                "delivered",
              ),
              selector: "period_census" as const,
              title: `PR #${index + 10}: Unclassified repository maintenance ${index}`,
              completionStage: "merged" as const,
              observedAt: `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
            })),
            {
              ...item("jira", "PROJ-700", "PROJ-700 builder dependency hardening 0", "delivered"),
              selector: "period_census" as const,
              completionStage: "development_ready" as const,
              dedupeKey: "PROJ-700",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        capabilityLedger,
        answerComposer: capabilityReportComposer,
      }).answer({
        ...request,
        question: "What have we delivered in the previous quarter?",
      }),
    );

    expect(answer.periodDeliveryReport?.capabilitySections).toHaveLength(1);
    expect(answer.periodDeliveryReport?.capabilitySections[0]?.key).toBe("compliance-technology");
    expect(answer.text).not.toContain("**Website Builder enhancements**");
    expect(answer.text.match(/- \*\*Compliance and technology updates\*\*/g)).toHaveLength(5);
    expect(answer.text).not.toContain("additional changes");
    expect(answer.text).toContain("## In progress");
    expect(answer.text).not.toContain("coverage");
    expect(answer.citations).toHaveLength(5);
  });

  it("registers citations only for rendered leadership initiatives and removes raw projection summaries", async () => {
    const capabilityLedger = {
      version: 1 as const,
      capabilities: [
        {
          key: "website-builder",
          title: "Website Builder enhancements",
          aliases: [
            { value: "builder" },
            { value: "landing page" },
            { value: "subpage" },
            { value: "widget integration" },
            { value: "modern web composer" },
          ],
        },
      ],
    };
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-03-31T18:30:00.000Z",
        toExclusive: "2026-06-30T18:30:00.000Z",
      },
      timeZone: "Asia/Kolkata",
      candidates: [],
      configuredSources: ["github"],
      sourceCheckpoints: new Map([["github", "2026-06-30T18:00:00.000Z"]]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            ...Array.from({ length: 200 }, (_, index) => {
              const title =
                index === 0
                  ? "Landing page builder initiative"
                  : index === 1
                    ? "Subpage builder initiative"
                    : index === 2
                      ? "Widget integration builder initiative"
                      : `Generic builder maintenance ${index}`;
              return {
                ...item("github", `builder-${index}`, title, "delivered"),
                selector: "period_census" as const,
                title,
                summary: `github:example/repository:activity:pull_request:${index}: raw projection summary that must not appear${index === 0 ? " for modern web composer" : ""} ${"x".repeat(160)}`,
                completionStage: "merged" as const,
                observedAt: "2026-06-20T10:00:00.000Z",
              };
            }),
            {
              ...item("jira", "builder-0", "Landing page builder initiative", "delivered"),
              selector: "period_census" as const,
              completionStage: "development_ready" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        capabilityLedger,
        answerComposer: capabilityReportComposer,
      }).answer({
        ...request,
        question: "What have we delivered in the previous quarter?",
      }),
    );

    expect(answer.failure).toBeUndefined();
    expect(answer.citations.length).toBeLessThan(200);
    expect(answer.citations.every(({ url }) => answer.text.includes(url))).toBe(true);
    expect(answer.text).not.toContain("github:example/repository:activity");
    expect(answer.text).not.toContain("Evidence-backed initiative index:");
    expect(answer.text).toContain("Landing page builder initiative");
    expect(answer.text).toContain("Subpage builder initiative");
    expect(answer.text).toContain("Widget integration builder initiative");
    expect(answer.acceptance.groundingPassed).toBe(true);
  });

  it("fails closed instead of rendering generic delivery evidence without a capability ledger", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.succeed({
        items: [item("github", "unrelated", "Unrelated merged maintenance", "delivered")],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "period_census"],
      execute,
    };

    const outcome = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] })
        .answer({
          ...request,
          question: "What have we delivered in the previous quarter?",
        })
        .pipe(Effect.either),
    );

    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { operation: "delivery-leadership-report-configuration" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects finance before any source call", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>((_context, _plan) =>
      Effect.succeed({
        items: [],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["metrics"],
      execute,
    };
    await expect(
      Effect.runPromise(
        createDeliveryAssistant({ sources: [source] }).answer({
          ...request,
          question: "What is the project budget?",
        }),
      ),
    ).rejects.toThrow("confidential finance entitlement");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects secret discovery before planning, retrieval, or composition", async () => {
    const plan = vi.fn<
      NonNullable<Parameters<typeof createDeliveryAssistant>[0]["modelPlanner"]>["plan"]
    >(() => Effect.die("model planner must not receive a restricted question"));
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.die("source must not receive a restricted question"),
    );
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>(() =>
      Effect.die("answer composer must not receive restricted evidence"),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations"],
      execute,
    };

    const result = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        modelPlanner: { plan },
        answerComposer: { compose },
      })
        .answer({
          ...request,
          question: "List the credentials, API keys, and private keys stored in this project.",
        })
        .pipe(Effect.either),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { operation: "delivery-restricted-content-authorization" },
    });
    expect(plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it("allows delivery-safe questions about secret rotation work", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.succeed({
        items: [
          {
            ...item("jira", "SEC-1", "Rotated the affected credential", "delivered"),
            lifecycleState: "done" as const,
          },
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What was delivered for the credential rotation?",
      }),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(answer.text).toContain("Rotated the affected credential");
  });

  it("inherits a named subject from the authorized Teams thread for a contextual follow-up", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>((_context, _plan) =>
      Effect.succeed({
        items: [],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["relations", "objects"],
      execute,
    };

    await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "Who owns it, what is blocked, and what should happen next?",
        questionContext: {
          channelId: "channel-1",
          conversationId: "conversation-1",
          rootMessageId: "root-1",
          currentMessageId: "reply-2",
          evidence: [
            {
              source: "teams",
              sourceId: "root-1",
              citationUrl: "https://teams.example.test/root-1",
              title: "Teams thread",
              excerpt: "What is the current status of Atlas Site Composer?",
              observedAt: "2026-07-20T12:00:00.000Z",
              contextRole: "conversation",
            },
            {
              source: "teams",
              sourceId: "reply-2",
              citationUrl: "https://teams.example.test/reply-2",
              title: "Current question",
              excerpt: "Who owns it, what is blocked, and what should happen next?",
              observedAt: "2026-07-20T12:05:00.000Z",
              contextRole: "conversation",
            },
          ],
        },
      }),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      subject: { phrase: "Atlas Site Composer" },
      intents: ["ownership", "blockers", "next_actions"],
    });
  });

  it("deduplicates cross-source facts and returns a decision-ready cited response", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            item("github", "1", "Merged delivery report"),
            {
              ...item("jira", "2", "Merged delivery report"),
              dedupeKey: "merged delivery report",
            },
            item("teams", "3", "Team confirmed rollout"),
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.text.split("\n")[0]).toBe("## Activity");
    expect(answer.text).toContain("- 🧩 **Code:**");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("Here’s");
    expect(answer.text).not.toContain("Recommended next step");
    expect(answer.text.match(/Merged delivery report/g)).toHaveLength(1);
    expect(answer.citations).toHaveLength(2);
    expect(answer.failure).toBeUndefined();
    expect(answer.status).toBe("ok");
    expect(answer.responseMode).toBe("fast");
    expect(answer.acceptance).toMatchObject({
      mode: "fast",
      completenessRatio: 1,
      citationCoverage: 1,
      groundingPassed: true,
      freshnessPassed: true,
      formatPassed: true,
      passed: true,
    });
  });

  it("does not present Jira-only weekly delivery evidence as complete", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item(
                "jira",
                "DEMO-20",
                "DEMO-20 Done: Published the website builder",
                "delivered",
              ),
              lifecycleState: "done" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What was delivered this week?",
      }),
    );

    expect(answer.status).toBe("failed");
    expect(answer.failure?.diagnosticCode).toBe("report-composer-unavailable");
    expect(answer.text).toContain("SARATHI-REPORT-COMPOSITION-FAILED");
    expect(answer.text).not.toContain("DEMO-20 Done");
    expect(answer.acceptance.completenessPassed).toBe(false);
    expect(answer.acceptance.passed).toBe(false);
  });

  it("preserves source and owner breadth in a whole-team weekly delivery rollup", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "DEMO-21", "DEMO-21 Done: Published the builder", "delivered"),
              lifecycleState: "done" as const,
              authority: 1,
              owner: {
                source: "jira" as const,
                externalId: "jira-person-sneha",
                displayName: "Sneha K",
              },
            },
            {
              ...item("jira", "DEMO-22", "DEMO-22 Done: Verified the builder", "delivered"),
              lifecycleState: "done" as const,
              authority: 0.99,
              owner: {
                source: "jira" as const,
                externalId: "jira-person-manikandan",
                displayName: "Manikandan",
              },
            },
            {
              ...item("github", "pr-42", "Merged the builder release", "delivered"),
              lifecycleState: "done" as const,
              authority: 0.8,
              owner: {
                source: "github" as const,
                externalId: "github-person-kamesh",
                displayName: "Kamesh",
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What delivery items were completed?",
      }),
    );

    expect(answer.status).toBe("ok");
    expect(answer.missingRequiredSources).toEqual([]);
    expect(answer.citations.map(({ label }) => label)).toEqual(["Jira 1", "GitHub 2", "Jira 3"]);
    expect(answer.text).toContain("DEMO-21 Done");
    expect(answer.text).toContain("Merged the builder release");
    expect(answer.text).toContain("DEMO-22 Done");
    expect(answer.text).toContain("## Delivered");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.acceptance).toMatchObject({
      completenessPassed: true,
      citationPassed: true,
      passed: true,
    });
  });

  it("represents distinct owners as one scannable weekly-work bullet each", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "DEMO-31", "Improve editor canvas", "current_work"),
              title: "Improve editor canvas",
              owner: {
                source: "jira" as const,
                externalId: "jira-person-sneha",
                displayName: "Sneha K",
              },
            },
            {
              ...item("jira", "DEMO-32", "Fix editor toolbar", "current_work"),
              title: "Fix editor toolbar",
              owner: {
                source: "jira" as const,
                externalId: "jira-person-sneha",
                displayName: "Sneha K",
              },
              observedAt: "2026-07-20T09:00:00.000Z",
            },
            {
              ...item("jira", "DEMO-33", "Complete publishing workflow", "current_work"),
              title: "Complete publishing workflow",
              owner: {
                source: "jira" as const,
                externalId: "jira-person-manikandan",
                displayName: "Manikandan",
              },
            },
            {
              ...item("jira", "DEMO-34", "Verify unassigned migration", "current_work"),
              title: "Verify unassigned migration",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is planned this week?",
      }),
    );

    expect(answer.text).toContain("## Planned this week");
    expect(answer.text).toContain("- **Sneha K** — Improve editor canvas");
    expect(answer.text).toContain("- **Manikandan** — Complete publishing workflow");
    expect(answer.text).toContain("- **Unassigned** — Verify unassigned migration");
    expect(answer.text).not.toContain("Fix editor toolbar");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("Coverage");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.text.split("### References")[0]).not.toContain(" · ");
    expect(answer.acceptance).toMatchObject({
      completenessPassed: true,
      citationCoverage: 1,
      groundingPassed: true,
      passed: true,
    });
  });

  it("renders a structured brief with independent format and quality acceptance", async () => {
    const plan = planDeliveryQuestion(request.question);
    if (plan === undefined) throw new Error("Expected a structured activity plan");
    const execute = vi.fn<DeliveryQuerySource["execute"]>((_context, _plan) =>
      Effect.succeed({
        items: [
          {
            ...item("github", "structured-code", "Merged the delivery dashboard"),
            indexedAt: "2026-07-20T12:30:00.000Z",
          },
          {
            ...item("teams", "structured-team", "Confirmed rollout readiness"),
            indexedAt: "2026-07-20T12:45:00.000Z",
          },
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        now: () => new Date(request.requestedAt),
      }).answer({
        ...request,
        question: "Give me a structured activity update",
        responseMode: "structured",
        plan,
      }),
    );

    expect(answer.responseMode).toBe("structured");
    expect(answer.text).toContain("## Activity");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("Evidence");
    expect(execute.mock.calls[0]?.[0].deadlineAt).toBe("2026-07-20T13:10:00.000Z");
    expect(execute.mock.calls[0]?.[1].operations.every(({ limit }) => limit === 15)).toBe(true);
    expect(answer.acceptance).toMatchObject({
      completenessPassed: true,
      citationPassed: true,
      groundingPassed: true,
      freshnessPassed: true,
      formatPassed: true,
      passed: true,
    });
  });

  it("formats quarterly alignment as an initiative-first feature list", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "relations", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            item("strategy", "goal-1", "Grow qualified delivery outcomes", "goals"),
            item("strategy", "initiative-1", "Delivery slice publishing", "current_work"),
            item("jira", "work-1", "Publish the current delivery slice", "current_work"),
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "How does this week's current work align with quarterly goals?",
        responseMode: "structured",
      }),
    );

    expect(answer.text).toContain("## Initiative alignment");
    expect(answer.text).toContain(
      "**Delivery slice publishing** — Publish the current delivery slice",
    );
    expect(answer.text).not.toContain("## Unassigned work");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.text).not.toContain("completion percentage");
    expect(answer.acceptance).toMatchObject({
      completenessPassed: true,
      citationPassed: true,
      groundingPassed: true,
      formatPassed: true,
      passed: true,
    });
  });

  it("preserves feature-first deep-dive content without diagnostic sections", async () => {
    const plan = planDeliveryQuestion("What is the current status of DEMO-1?");
    if (plan === undefined) throw new Error("Expected a deep-dive status plan");
    const execute = vi.fn<DeliveryQuerySource["execute"]>((_context, _plan) =>
      Effect.succeed({
        items: [
          {
            ...item("jira", "deep-status", "DEMO-1 is actively in review", "status"),
            lifecycleState: "active" as const,
            sourceUpdatedAt: "2026-07-20T12:30:00.000Z",
            indexedAt: "2026-07-20T12:45:00.000Z",
          },
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "knowledge"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        now: () => new Date(request.requestedAt),
      }).answer({
        ...request,
        question: "Investigate DEMO-1 in a comprehensive deep dive",
        responseMode: "deep_dive",
        plan,
      }),
    );

    expect(answer.responseMode).toBe("deep_dive");
    expect(answer.text).toContain("## Status");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("Sources and freshness");
    expect(answer.text).not.toContain("Inference boundary");
    expect(answer.text).not.toContain("Completed in");
    expect(execute.mock.calls[0]?.[0].deadlineAt).toBe("2026-07-20T13:13:00.000Z");
    expect(execute.mock.calls[0]?.[1].operations.every(({ limit }) => limit === 50)).toBe(true);
    expect(answer.acceptance.latencyTargetMs).toBeUndefined();
    expect(answer.acceptance.formatPassed).toBe(true);
    expect(answer.acceptance.passed).toBe(true);
  });

  it("fails freshness acceptance for an hourly projection that is stale", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("github", "stale-code", "Merged an old delivery report"),
              indexedAt: "2026-07-20T08:00:00.000Z",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );

    expect(answer.acceptance).toMatchObject({
      evaluatedEvidence: 1,
      freshEvidence: 0,
      freshnessCoverage: 0,
      freshnessPassed: false,
      passed: false,
    });
  });

  it("delegates with a real Teams mention only when the source resolves the target identity", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item(
                "teams",
                "review",
                "Pavithra, please review the delivery issue",
                "next_actions",
              ),
              actionTarget: {
                source: "teams",
                externalId: "pavithra-entra-id",
                displayName: "Pavithra",
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the next action?",
      }),
    );

    expect(answer.text).toContain("## Next");
    expect(answer.text).toContain("- <at>Pavithra</at>, please confirm the next step and due date");
    expect(answer.mentions).toEqual([
      {
        source: "teams",
        externalId: "pavithra-entra-id",
        displayName: "Pavithra",
      },
    ]);
  });

  it("does not delegate merely because a non-actionable update mentions a person", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("teams", "thanks", "Delivery Lead: Thanks to Pavithra for the update"),
              actionTarget: {
                source: "teams",
                externalId: "pavithra-entra-id",
                displayName: "Pavithra",
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );

    expect(answer.text).not.toContain("<at>Pavithra</at>");
    expect(answer.mentions).toEqual([]);
  });

  it("does not invent an action when a requested action has no cited evidence", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [item("jira", "status", "DEMO-12 In Progress", "status")],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of DEMO-12? Include the next action.",
      }),
    );

    expect(answer.status).toBe("partial");
    expect(answer.text).toContain("No next action found");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.text).not.toContain("Recommended next step");
    expect(answer.missingRequiredIntents).toContain("next_actions");
  });

  it("preserves each requested intent when one Jira issue supports a compound answer", async () => {
    const sharedCitation = "https://example.com/jira/DEMO-9";
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "risk", "DEMO-9 is a high delivery risk", "risks"),
              citationUrl: sharedCitation,
              dedupeKey: "jira:DEMO-9:risk",
            },
            {
              ...item("jira", "action", "Owner — DEMO-9 In Progress", "next_actions"),
              citationUrl: sharedCitation,
              dedupeKey: "jira:DEMO-9:next",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What are the delivery risks and next action?",
      }),
    );

    expect(answer.text.split("\n")).toEqual([
      "## Risks",
      "- ⚠️ DEMO-9 is a high delivery risk",
      "## Next",
      "- Owner — DEMO-9 In Progress",
      "### References",
      `- **Jira:** [1](${sharedCitation})`,
    ]);
    expect(answer.citations).toHaveLength(1);
  });

  it("prefers structured Jira lifecycle state for status answers", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            { ...item("vault", "boundary", "Builder scope table", "status"), authority: 1 },
            {
              ...item("jira", "done", "DEMO-10 Done: Builder navigation fix", "status"),
              lifecycleState: "done",
            },
            {
              ...item("jira", "active", "DEMO-11 In Progress: Builder acceptance", "status"),
              lifecycleState: "active",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of Builder?",
      }),
    );
    expect(answer.text.indexOf("DEMO-11 In Progress")).toBeLessThan(
      answer.text.indexOf("DEMO-10 Done"),
    );
    expect(answer.text).not.toContain("Builder scope table");
  });

  it("marks a current-status answer as partial when Jira only returns terminal history", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "done", "DEMO-10 Done: Builder navigation fix", "status"),
              lifecycleState: "done" as const,
            },
            {
              ...item("jira", "canceled", "DEMO-9 Canceled: Legacy form parity", "status"),
              lifecycleState: "canceled" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of Builder?",
      }),
    );

    expect(answer.status).toBe("partial");
    expect(answer.text).toContain("## Status — historical only");
  });

  it("accounts for every requested field in a compound decision brief", async () => {
    const compoundItem = (
      id: string,
      intent: "scope" | "reviews" | "status",
      summary: string,
    ): DeliveryResultItem => ({
      ...item("teams", id, summary, "status"),
      selector: intent === "reviews" ? "observations" : "objects",
      intent,
      subjectAliases: ["Operations Console Migration"],
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            compoundItem("scope", "scope", "Page-content migration is in scope"),
            compoundItem("review", "reviews", "UI integration awaits review"),
            compoundItem("status", "status", "The migration remains active"),
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question:
          "What is the current status of Operations Console Migration? Summarize scope, progress, review queue, risks, and next action.",
      }),
    );

    expect(answer.text.split("\n")[0]).toBe("## Status");
    expect(answer.text).toContain("## Scope");
    expect(answer.text).toContain("## Review queue");
    expect(answer.text).toContain("## Risks");
    expect(answer.text).toContain("No matching items found.");
    expect(answer.text).toContain("## Next");
    expect(answer.text).toContain("No next action found.");
    expect(answer.text).toContain("### References");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.status).toBe("partial");
  });

  it("discloses competing claims rather than choosing one silently", async () => {
    const claim = (id: string, value: string, source: "jira" | "teams"): DeliveryClaim => ({
      id,
      workspaceId: request.workspaceId,
      subjectKey: "DEMO-1",
      predicate: "status",
      value,
      valueHash: deliveryClaimValueHash(value),
      authority: source === "jira" ? 1 : 0.8,
      sensitivity: "internal",
      observedAt: "2026-07-20T10:00:00.000Z",
      active: true,
      deleted: false,
      source: {
        source,
        sourceId: `${source}-source`,
        sourceItemId: id,
        citationUrl: `https://example.com/${source}/${id}`,
      },
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            item("jira", "status", "DEMO-1 is blocked", "status"),
            item("jira", "dependency", "DEMO-1 waits for DEMO-2", "dependencies"),
          ],
          conflicts: [
            {
              workspaceId: request.workspaceId,
              subjectKey: "DEMO-1",
              predicate: "status",
              claims: [claim("1", "blocked", "jira"), claim("2", "ready", "teams")],
            },
          ],
          unavailableSources: [],
          complete: true,
        }),
    };
    const statusPlan = planDeliveryQuestion("What is the current status of DEMO-1?");
    const dependencyPlan = planDeliveryQuestion("Who is waiting for whom?");
    if (statusPlan === undefined) throw new Error("Expected deterministic status plan");
    if (dependencyPlan === undefined) throw new Error("Expected deterministic dependency plan");
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of DEMO-1?",
        plan: {
          ...statusPlan,
          intents: ["status", "dependencies"],
          operations: [...statusPlan.operations, ...dependencyPlan.operations],
          maximumLines: 2,
        },
      }),
    );
    expect(answer.text).toContain("## Status");
    expect(answer.text).toContain("## Dependencies");
    expect(answer.text).toContain("## Conflicts");
    expect(answer.text).toContain("**DEMO-1 status:** blocked");
    expect(answer.text).toContain("vs ready");
    expect(answer.conflicts).toHaveLength(1);
    expect(answer.acceptance).toMatchObject({
      requestedIntents: 2,
      coveredIntents: 2,
      completenessRatio: 1,
      completenessPassed: true,
      passed: true,
    });
  });

  it("does not call two messages from one source a cross-source conflict", async () => {
    const claim = (id: string, value: string): DeliveryClaim => ({
      id,
      workspaceId: request.workspaceId,
      subjectKey: "DEMO-4",
      predicate: "status",
      value,
      valueHash: deliveryClaimValueHash(value),
      authority: 0.8,
      sensitivity: "internal",
      observedAt: "2026-07-20T10:00:00.000Z",
      active: true,
      deleted: false,
      source: {
        source: "teams",
        sourceId: "teams-source",
        sourceItemId: id,
        citationUrl: `https://example.com/teams/${id}`,
      },
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["conflicts", "claims", "github_live"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("teams", "message-1", "Resolved, but one regression remains", "status"),
              selector: "claims",
              intent: "conflicts",
            },
          ],
          conflicts: [
            {
              workspaceId: request.workspaceId,
              subjectKey: "DEMO-4",
              predicate: "status",
              claims: [claim("1", "ready"), claim("2", "blocked")],
            },
          ],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "Where do Jira, Teams, and GitHub disagree about delivery status?",
      }),
    );

    expect(answer.conflicts).toEqual([]);
    expect(answer.text).not.toContain("Resolved, but one regression remains");
    expect(answer.status).toBe("partial");
  });

  it("filters wrong-workspace and excessive-sensitivity results before composition", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "other", "Other workspace"),
              workspaceId: "other",
            },
            {
              ...item("jira", "restricted", "Restricted"),
              sensitivity: "restricted",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.status).toBe("empty");
    expect(answer.citations).toEqual([]);
  });

  it("reports indexed Jira and Vault as partial when the projection store fails", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.fail(
          new RepositoryError({
            message: "test projection failure",
            operation: "test",
          }),
        ),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.status).toBe("partial");
    expect(answer.unavailableSources).toEqual(["jira", "vault"]);
    expect(answer.text).toContain("## Unavailable");
    expect(answer.text).toContain("- Jira, Vault");
    expect(answer.text).not.toContain("Coverage");
  });

  it("discloses an optional unavailable source without downgrading complete evidence", async () => {
    const projection: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [item("jira", "risk", "DEMO-21 is at risk", "risks")],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const teams: DeliveryQuerySource = {
      source: "teams",
      selectors: ["objects"],
      execute: () =>
        Effect.fail(
          new RepositoryError({
            message: "test Teams failure",
            operation: "test",
          }),
        ),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [projection, teams] }).answer({
        ...request,
        question: "What are the delivery risks?",
      }),
    );

    expect(answer.status).toBe("ok");
    expect(answer.unavailableSources).toEqual(["teams"]);
    expect(answer.text).toContain("## Unavailable");
    expect(answer.text).toContain("- Teams");
    expect(answer.text).not.toContain("Coverage");
    expect(answer.acceptance).toMatchObject({
      completenessRatio: 1,
      completenessPassed: true,
      passed: true,
    });
  });

  it("fails completeness when a bounded source reports unexplained truncation", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [item("jira", "risk", "DEMO-21 is at risk", "risks")],
          conflicts: [],
          unavailableSources: [],
          complete: false,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What are the delivery risks?",
      }),
    );

    expect(answer.status).toBe("partial");
    expect(answer.acceptance).toMatchObject({
      completenessRatio: 1,
      completenessPassed: false,
      passed: false,
    });
  });

  it("does not promote a partial census to complete when it reports unavailable sources", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            item("jira", "period-jira", "Jira delivery evidence", "delivered"),
            item("github", "period-github", "Merged delivery evidence", "delivered"),
          ],
          conflicts: [],
          unavailableSources: ["teams"],
          complete: false,
          periodCensus: compilePeriodCensus({
            boundary: {
              kind: "absolute",
              fromInclusive: "2026-06-20T18:30:00.000Z",
              toExclusive: "2026-07-20T18:30:00.000Z",
            },
            timeZone: "Asia/Kolkata",
            candidates: [],
            configuredSources: ["teams"],
            sourceCheckpoints: new Map(),
            pageSize: 10,
            pagesRead: 1,
            paginationExhausted: true,
            maximumCandidates: 100,
          }),
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "Give me a delivery report for the last 30 days",
      }),
    );

    expect(answer.status).toBe("failed");
    expect(answer.text).toContain("SARATHI-REPORT-COMPOSITION-FAILED");
    expect(answer.text).not.toContain("Jira delivery evidence");
    expect(answer.acceptance).toMatchObject({
      product: "period_delivery_brief",
      completenessPassed: false,
      passed: false,
    });
  });

  it("fails safely when sprint intent has no reconstructed sprint projection", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>(() =>
      Effect.die("the missing sprint projection must stop before composition"),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "observations", "knowledge", "github_live", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item(
                "jira",
                "generic-period-item",
                "Completed onboarding capability",
                "delivered",
              ),
              selector: "period_census" as const,
              subjectAliases: ["Onboarding"],
              completionStage: "development_ready" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus: compilePeriodCensus({
            boundary: {
              kind: "absolute",
              fromInclusive: "2026-07-01T00:00:00.000Z",
              toExclusive: "2026-08-01T00:00:00.000Z",
            },
            timeZone: "Asia/Kolkata",
            candidates: [],
            configuredSources: [],
            sourceCheckpoints: new Map(),
            pageSize: 200,
            pagesRead: 1,
            paginationExhausted: true,
            maximumCandidates: 50_000,
          }),
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
        capabilityLedger: {
          version: 1,
          capabilities: [
            { key: "onboarding", title: "Onboarding", aliases: [{ value: "Onboarding" }] },
          ],
        },
      }).answer({
        ...request,
        question:
          "What did we commit to in the previous sprint, what was completed, what was added during the sprint, and what rolled over?",
      }),
    );

    expect(compose).not.toHaveBeenCalled();
    expect(answer).toMatchObject({
      status: "failed",
      citations: [],
      failure: {
        code: "SARATHI-REPORT-COMPOSITION-FAILED",
        classification: "SARATHI-REPORT-QUALITY-FAILED",
        diagnosticCode: "report-sprint-projection-missing",
      },
      acceptance: { passed: false },
    });
    expect(answer.text).toContain("SARATHI-REPORT-COMPOSITION-FAILED");
    expect(answer.text).not.toContain("Completed onboarding capability");
  });

  it("synthesizes only authorized deduplicated records and validates model citations", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>((_input) =>
      Effect.succeed({
        text: `## Activity\n- Merged code and project activity.\n## Next\n- Confirm the team-owned follow-up.\n### References\n- **GitHub:** [1](https://example.com/github/code)\n- **Teams:** [2](https://example.com/teams/team)`,
        citations: [
          { label: "Code", url: "https://example.com/github/code" },
          { label: "Team", url: "https://example.com/teams/team" },
        ],
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            item("github", "code", "Merged code"),
            item("teams", "team", "Confirmed next step", "next_actions"),
            {
              ...item("jira", "other", "Other workspace"),
              workspaceId: "other",
            },
            {
              ...item("jira", "restricted", "Restricted"),
              sensitivity: "restricted",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
      }).answer({
        ...request,
        question: "What did the team do today, and what is the next action?",
      }),
    );
    const composition = compose.mock.calls[0]?.[0];
    expect(composition?.items.map(({ id }) => id)).toEqual(["code", "team"]);
    expect(answer.text).toContain("Merged code and project activity");
    expect(answer.citations).toHaveLength(2);
  });

  it("falls back to the bounded deterministic answer for an invented model citation", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [item("github", "code", "Merged code"), item("teams", "team", "Team update")],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: {
          compose: () =>
            Effect.succeed({
              text: "Invented [source](https://evil.example.test/x)",
              citations: [{ label: "source", url: "https://evil.example.test/x" }],
            }),
        },
      }).answer(request),
    );
    expect(answer.text).not.toContain("evil.example.test");
    expect(answer.text).toContain("Merged code");
  });

  it("falls back before the total deadline when optional model composition exceeds the remaining budget", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>(() => Effect.never);
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.sleep("150 millis").pipe(
          Effect.as({
            items: [
              item("jira", "risk", "DEMO-1 release dependency is at risk", "risks"),
              {
                ...item("jira", "action", "DEMO-1 confirm the release owner", "next_actions"),
                objectKind: "work_item",
                lifecycleState: "active",
              },
            ],
            conflicts: [],
            unavailableSources: [],
            complete: true,
          }),
        ),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
        sourceTimeoutMs: 250,
        compositionTimeoutMs: 250,
        totalBudgetMs: 300,
      }).answer({
        ...request,
        question: "What are the delivery risks and next action?",
      }),
    );

    expect(compose).toHaveBeenCalledOnce();
    expect(answer.status).toBe("ok");
    expect(answer.text).toContain("DEMO-1 release dependency is at risk");
    expect(answer.text).toContain("DEMO-1 confirm the release owner");
  });

  it("fails closed when an implementation answer has no matching live GitHub result", async () => {
    const source: DeliveryQuerySource = {
      source: "knowledge",
      selectors: ["github_live", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("vault", "unrelated", "Generic repository workflow", "status"),
              selector: "knowledge",
              intent: "implementation",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question:
          "Which GitHub PR or commits implement the Partner Intake Dashboard, and what changed?",
      }),
    );
    expect(answer.status).toBe("partial");
    expect(answer.missingRequiredSources).toEqual(["github"]);
    expect(answer.text).toContain("No matching GitHub result");
    expect(answer.text).not.toContain("Generic repository workflow");
  });

  it("does not compose records outside a named entity boundary", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [item("jira", "other", "PROJ-812 Modern lead form is In Progress", "status")],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of Operations Console Migration?",
      }),
    );
    expect(answer.status).toBe("partial");
    expect(answer.text).toContain("No matching items found");
    expect(answer.text).not.toContain("source-backed");
    expect(answer.text).not.toContain("Modern lead form");
  });

  it("renders a cohesive Sprint Review and Outlook and keeps fresh indexed Teams fallback", async () => {
    const previousSprint = {
      id: "81",
      name: "Delivery Sprint 8",
      state: "closed" as const,
      startAt: "2026-07-14T03:30:00.000Z",
      endAt: "2026-07-28T03:30:00.000Z",
    };
    const currentSprint = {
      id: "82",
      name: "Delivery Sprint 9",
      state: "active" as const,
      startAt: "2026-07-28T03:30:00.000Z",
      endAt: "2026-08-11T03:30:00.000Z",
    };
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-06-30T18:30:00.000Z",
        toExclusive: "2026-07-31T18:30:00.000Z",
      },
      timeZone: request.timeZone,
      candidates: [],
      configuredSources: ["jira", "strategy", "teams", "vault", "github"],
      sourceCheckpoints: new Map([
        ["jira", "2026-07-31T12:00:00.000Z"],
        ["strategy", "2026-07-31T12:00:00.000Z"],
        ["teams", "2026-07-31T12:00:00.000Z"],
        ["vault", "2026-07-31T12:00:00.000Z"],
        ["github", "2026-07-31T12:00:00.000Z"],
      ]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const jira = {
      ...item(
        "jira",
        "DEMO-42",
        "Pavithra — DEMO-42 In Progress: Lead-routing dashboard",
        "current_work",
      ),
      owner: { source: "jira" as const, displayName: "Pavithra" },
      planning: {
        externalKey: "DEMO-42",
        status: "In Progress",
        sprint: currentSprint.name,
        hasDependency: false,
        hasAcceptanceInformation: false,
        previousSprint,
        currentSprint,
        sprintClassifications: [
          "planned_at_start",
          "rolled_into_current",
          "current_sprint",
        ] as const,
      },
    };
    const projection: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "relations", "observations", "knowledge", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            jira,
            {
              ...jira,
              id: "DEMO-42-previous",
              intent: "commitments" as const,
              dedupeKey: "jira:DEMO-42:previous",
            },
            {
              ...item("strategy", "initiative-1", "Increase qualified lead response", "goals"),
              intent: "commitments" as const,
              evidenceRole: "declared_intent" as const,
              strategy: { kind: "initiative" as const, state: "active" },
              subjectAliases: ["lead-routing dashboard", "qualified lead response"],
            },
            {
              ...item("teams", "message-1", "DEMO-42 please test; test not yet done", "activity"),
              title: "Lead-routing dashboard QA coordination",
              indexedAt: "2026-07-31T12:30:00.000Z",
              observedAt: "2026-07-31T12:00:00.000Z",
            },
            {
              ...item("vault", "requirement-1", "DEMO-42 requires lead routing QA", "current_work"),
              title: "Lead-routing dashboard acceptance requirement",
            },
            {
              ...item("github", "pull-42", "DEMO-42 lead-routing dashboard merged", "delivered"),
              selector: "observations" as const,
              completionStage: "development_ready" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };
    const liveTeams: DeliveryQuerySource = {
      source: "teams",
      selectors: ["objects", "observations"],
      execute: () =>
        Effect.fail(
          new RepositoryError({ message: "live Teams timeout", operation: "test-live-teams" }),
        ),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [projection, liveTeams],
        answerComposer: capabilityReportComposer,
        capabilityLedger: {
          version: 1,
          capabilities: [
            {
              key: "lead-routing-dashboard",
              title: "Lead-routing dashboard",
              aliases: [{ value: "lead-routing dashboard" }],
            },
          ],
        },
      }).answer({
        ...request,
        requestedAt: "2026-07-31T13:00:00.000Z",
        question:
          "Give me a Sprint Review and Outlook suitable for Pavithra to share with leadership.",
      }),
    );

    expect(answer.failure).toBeUndefined();
    expect(answer.status).toBe("ok");
    expect(answer.unavailableSources).not.toContain("teams");
    for (const heading of [
      "## Sprint overview",
      "## Previous sprint",
      "## Current sprint",
      "## Q3 alignment",
      "## Waiting or decisions",
      "## Jira hygiene",
      "## References",
    ])
      expect(answer.text).toContain(heading);
    expect(answer.text).toContain("Delivery Sprint 8");
    expect(answer.text).toContain("Delivery Sprint 9");
    expect(answer.text).toContain("Increase qualified lead response");
    expect(answer.text).toContain("Rolled over");
    expect(answer.text).not.toContain("please test; test not yet done");
    expect(answer.acceptance.passed).toBe(true);
  });

  it("publishes only a short failed result when both report composition attempts fail", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>(() =>
      Effect.fail(
        new RepositoryError({
          message: "provider unavailable",
          operation: "openrouter-answer-generation",
        }),
      ),
    );
    const rawEnvelopeMarker = `RAW-CAPSULE-${"x".repeat(20_000)}`;
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-07-20T18:30:00.000Z",
        toExclusive: "2026-07-27T18:30:00.000Z",
      },
      timeZone: request.timeZone,
      candidates: [],
      configuredSources: ["jira", "github"],
      sourceCheckpoints: new Map([
        ["jira", "2026-07-27T12:00:00.000Z"],
        ["github", "2026-07-27T12:00:00.000Z"],
      ]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "DEMO-90", `DEMO-90 ${rawEnvelopeMarker}`, "delivered"),
              lifecycleState: "done" as const,
            },
            {
              ...item("github", "DEMO-90", `DEMO-90 ${rawEnvelopeMarker}`, "delivered"),
              selector: "period_census" as const,
              completionStage: "development_ready" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
        capabilityLedger: {
          version: 1,
          capabilities: [{ key: "release", title: "Release", aliases: [{ value: "DEMO-90" }] }],
        },
      }).answer({ ...request, question: "What was delivered last week?" }),
    );

    expect(compose).toHaveBeenCalledTimes(2);
    expect(answer.status).toBe("failed");
    expect(answer.failure).toMatchObject({
      code: "SARATHI-REPORT-COMPOSITION-FAILED",
      classification: "SARATHI-REPORT-PROVIDER-FAILED",
      diagnosticCode: "report-provider",
    });
    expect(answer.text).toMatch(/^Response composition failed\./);
    expect(answer.text).not.toContain("RAW-CAPSULE");
    expect(answer.text).not.toContain("## Delivered");
    expect(answer.citations).toEqual([]);
    expect(answer.acceptance.passed).toBe(false);
  });

  it("rejects structurally invalid or unknown-citation report output without fallback", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>(() =>
      Effect.succeed({
        text: [
          "## Delivered",
          "- Raw deterministic capsule inventory must not escape.",
          "## In progress",
          "- None.",
          "## Waiting or blocked",
          "- None.",
          "## Decisions needed",
          "- None.",
          "## References",
          "- [Unknown](https://outside.example.test/invented)",
        ].join("\n"),
        citations: [{ label: "Unknown", url: "https://outside.example.test/invented" }],
      }),
    );
    const periodCensus = compilePeriodCensus({
      boundary: {
        kind: "absolute",
        fromInclusive: "2026-07-20T18:30:00.000Z",
        toExclusive: "2026-07-27T18:30:00.000Z",
      },
      timeZone: request.timeZone,
      candidates: [],
      configuredSources: ["jira", "github"],
      sourceCheckpoints: new Map([
        ["jira", "2026-07-27T12:00:00.000Z"],
        ["github", "2026-07-27T12:00:00.000Z"],
      ]),
      pageSize: 200,
      pagesRead: 1,
      paginationExhausted: true,
      maximumCandidates: 50_000,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "period_census"],
      execute: () =>
        Effect.succeed({
          items: [
            item("jira", "DEMO-91", "DEMO-91 release work", "delivered"),
            {
              ...item("github", "DEMO-91", "DEMO-91 release work", "delivered"),
              selector: "period_census" as const,
              completionStage: "development_ready" as const,
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
          periodCensus,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
        capabilityLedger: {
          version: 1,
          capabilities: [{ key: "release", title: "Release", aliases: [{ value: "DEMO-91" }] }],
        },
      }).answer({ ...request, question: "What was delivered last week?" }),
    );

    expect(compose).toHaveBeenCalledTimes(2);
    expect(answer.status).toBe("failed");
    expect(answer.failure?.classification).toBe("SARATHI-REPORT-COMPOSITION-INVALID");
    expect(answer.failure?.diagnosticCode).toBe("report-composition-composer-citation-unknown");
    expect(answer.text).not.toContain("Raw deterministic capsule inventory");
    expect(answer.text).not.toContain("outside.example.test");
    expect(answer.acceptance.passed).toBe(false);

    const identifierInventory = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: {
          compose: () =>
            Effect.succeed({
              text: [
                "## Delivered",
                "- Release capability shipped across DEMO-1, DEMO-2, DEMO-3, DEMO-4, DEMO-5, and DEMO-6.",
                "## In progress",
                "- None.",
                "## Waiting or blocked",
                "- None.",
                "## Decisions needed",
                "- None.",
                "## References",
                "- [Jira](https://example.com/jira/DEMO-91)",
              ].join("\n"),
              citations: [{ label: "Jira", url: "https://example.com/jira/DEMO-91" }],
            }),
        },
        capabilityLedger: {
          version: 1,
          capabilities: [{ key: "release", title: "Release", aliases: [{ value: "DEMO-91" }] }],
        },
      }).answer({ ...request, question: "What was delivered last week?" }),
    );

    expect(identifierInventory.status).toBe("failed");
    expect(identifierInventory.failure).toMatchObject({
      classification: "SARATHI-REPORT-COMPOSITION-INVALID",
      diagnosticCode: "report-composition-identifier-inventory",
    });
    expect(identifierInventory.text).not.toContain("DEMO-1");
    expect(identifierInventory.acceptance.passed).toBe(false);
  });

  it("does not invoke a delivery adapter outside the resolved source grant", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.succeed({ items: [], conflicts: [], unavailableSources: [], complete: true }),
    );
    const jiraSource: DeliveryQuerySource = {
      source: "jira",
      selectors: ["objects", "observations"],
      execute,
    };

    await Effect.runPromise(
      createDeliveryAssistant({ sources: [jiraSource] }).answer({
        ...request,
        question: "What is the current delivery status?",
        permittedSourceScopes: ["teams"],
      }),
    );

    expect(execute).not.toHaveBeenCalled();
  });
});
