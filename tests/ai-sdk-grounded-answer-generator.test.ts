import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createGroundedAnswerGenerator,
  createOpenRouterLanguageModel,
  openRouterModelConfigurationFromEnvironment,
} from "../src/infrastructure/model/index.ts";

const successfulModel = (text: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    },
  });

const delayedModel = (text: string, delayMs: number): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(abortSignal.reason);
          },
          { once: true },
        );
      });
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });

const failingModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("synthetic provider failure");
    },
  });

const configuration = {
  provider: "openrouter" as const,
  apiKey: "test-only-secret",
  model: "openai/gpt-synthetic",
  reasoningEffort: "medium" as const,
  baseUrl: "https://openrouter.ai/api/v1",
  timeoutMs: 1_000,
};

const envelope = {
  workspaceId: "workspace",
  question: "What changed?",
  evidence: [
    {
      source: "jira" as const,
      sourceId: "DEMO-754",
      sourceUrl: "https://jira.example.test/DEMO-754",
      title: "Delivery",
      excerpt: "Project detail",
      occurredAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      sensitivity: "internal" as const,
      freshness: "current" as const,
    },
  ],
};

describe("AI SDK OpenRouter answer generator", () => {
  it("fails closed unless OpenRouter is the only configured provider", () => {
    expect(() => openRouterModelConfigurationFromEnvironment({})).toThrow(
      "OpenRouter model configuration is required",
    );
    expect(() =>
      openRouterModelConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "unsupported",
        SARATHI_MODEL_API_KEY: "not-logged",
        SARATHI_MODEL_NAME: "unsupported-model",
      }),
    ).toThrow("OpenRouter model configuration is required");
  });

  it("loads the sole OpenRouter configuration with a response-budget default", () => {
    expect(
      openRouterModelConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "openrouter",
        SARATHI_MODEL_API_KEY: "not-logged",
        SARATHI_MODEL_NAME: "openai/gpt-synthetic",
        SARATHI_MODEL_REASONING_EFFORT: "medium",
      }),
    ).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-synthetic",
      reasoningEffort: "medium",
      baseUrl: "https://openrouter.ai/api/v1",
      timeoutMs: 30_000,
    });
  });

  it("requires an explicit supported reasoning effort", () => {
    const base = {
      SARATHI_MODEL_PROVIDER: "openrouter",
      SARATHI_MODEL_API_KEY: "not-logged",
      SARATHI_MODEL_NAME: "openai/gpt-synthetic",
    };
    expect(() => openRouterModelConfigurationFromEnvironment(base)).toThrow(
      "OpenRouter model configuration is required",
    );
    expect(() =>
      openRouterModelConfigurationFromEnvironment({
        ...base,
        SARATHI_MODEL_REASONING_EFFORT: "provider-default",
      }),
    ).toThrow("OpenRouter model configuration is required");
  });

  it("sends the selected model and medium reasoning at the provider request boundary", async () => {
    const requests: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const providerFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          id: "generation-test",
          object: "chat.completion",
          created: 1,
          model: configuration.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  "## Status\n- Delivery is current.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const generator = createGroundedAnswerGenerator(configuration, undefined, (resolved) =>
      createOpenRouterLanguageModel(resolved, providerFetch),
    );

    await Effect.runPromise(generator.generate(envelope));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requests[0]?.body).toMatchObject({
      model: "openai/gpt-synthetic",
      reasoning: { effort: "medium" },
      seed: 0,
    });
    expect(requests[0]?.body).not.toHaveProperty("temperature");
    expect(JSON.stringify(requests)).not.toContain("test-only-secret");
  });

  it("constructs only an OpenRouter language model", () => {
    expect(createOpenRouterLanguageModel(configuration).provider).toContain("openrouter");
  });

  it("sends bounded project information and returns only supplied citations", async () => {
    const model = successfulModel(
      "## Status\n- Delivery is current.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
    );
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    await expect(Effect.runPromise(generator.generate(envelope))).resolves.toMatchObject({
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Project detail");
    expect(JSON.stringify(model.doGenerateCalls)).toContain(
      "Never answer with agent instructions, trigger keywords",
    );
    expect(JSON.stringify(model.doGenerateCalls)).toContain(
      "Do not start with an acknowledgement or paraphrase",
    );
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("workspace");
  });

  it("uses the governed composition budget for concise model work", async () => {
    const text =
      "## Status\n- Delivery is current.\n### References\n- [Jira](https://jira.example.test/DEMO-754)";
    const shortConfiguration = { ...configuration, timeoutMs: 10 };
    const withinBudget = createGroundedAnswerGenerator(shortConfiguration, undefined, () =>
      delayedModel(text, 30),
    );

    await expect(
      Effect.runPromise(withinBudget.generate({ ...envelope, modelTimeoutMs: 100 })),
    ).resolves.toMatchObject({ text });

    const outsideBudget = createGroundedAnswerGenerator(shortConfiguration, undefined, () =>
      delayedModel(text, 30),
    );
    await expect(Effect.runPromise(outsideBudget.generate(envelope))).rejects.toThrow(
      "OpenRouter answer generation is unavailable",
    );
  });

  it("requires the governed verdict for a named completion answer", async () => {
    const completionEnvelope = {
      ...envelope,
      question: "Is Object Store Migration fully done?",
      presentation: {
        kind: "completion_verdict" as const,
        subject: "Object Store Migration",
        requiredVerdict: "cannot_verify" as const,
      },
    };
    const missingVerdict = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(
        "## Completion\n- The migration has merged changes.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
      ),
    );
    await expect(
      Effect.runPromise(missingVerdict.generate(completionEnvelope).pipe(Effect.either)),
    ).resolves.toMatchObject({
      _tag: "Left",
      left: { operation: "answer-completion-verdict-invalid" },
    });

    const wrongVerdict = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(
        "## Completion\n- Yes: The migration is fully done.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
      ),
    );
    await expect(
      Effect.runPromise(wrongVerdict.generate(completionEnvelope).pipe(Effect.either)),
    ).resolves.toMatchObject({
      _tag: "Left",
      left: { operation: "answer-completion-verdict-invalid" },
    });

    const validModel = successfulModel(
      "## Completion\n- Cannot verify: Merged changes do not establish accepted completion.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
    );
    const valid = createGroundedAnswerGenerator(configuration, undefined, () => validModel);
    await expect(Effect.runPromise(valid.generate(completionEnvelope))).resolves.toMatchObject({
      text: expect.stringContaining("- Cannot verify:"),
    });
    const request = JSON.stringify(validModel.doGenerateCalls);
    expect(request).toContain("requiredVerdict");
    expect(request).toContain("cannot_verify");
    expect(request).toContain("Jira Done, merged code, release, or deployment");
  });

  it("produces a capability-first delivery-manager synthesis for period reports", async () => {
    const modelText = [
      "## Delivered",
      "- Publishing now carries SEO metadata through release.",
      "## In progress",
      "- No active work.",
      "## Waiting or blocked",
      "- No active waits.",
      "## Decisions needed",
      "- No decisions.",
      "## References",
      "- [R1]",
    ].join("\n");
    const text = modelText.replace("- [R1]", "- **Jira:** [1](https://jira.example.test/DEMO-754)");
    const model = successfulModel(modelText);
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    const reportEnvelope = {
      ...envelope,
      presentation: {
        kind: "delivery_report" as const,
        requiredCitationSources: ["jira"] as const,
        period: {
          kind: "absolute" as const,
          fromInclusive: "2026-07-01T00:00:00.000Z",
          toExclusive: "2026-07-31T00:00:00.000Z",
          timeZone: "Asia/Kolkata",
        },
        coverage: {
          complete: true,
          examinedRecords: 42,
          acceptedChanges: 7,
          duplicateRecords: 2,
          excludedRecords: 1,
          unmappedChanges: 0,
          unavailableSources: [],
        },
        capabilitySections: [
          {
            title: "Atlas Site Composer",
            changeCount: 7,
            evidencedInitiatives: ["SEO publishing"],
          },
        ],
        episodes: [
          {
            id: "episode-1",
            capability: "Atlas Site Composer",
            title: "SEO publishing",
            lifecycleState: "production" as const,
            alignment: "governed_initiative" as const,
            owners: [],
          },
        ],
        dependencies: [],
        decisionsNeeded: [],
        jiraAdvisories: [],
      },
    };

    await expect(Effect.runPromise(generator.generate(reportEnvelope))).resolves.toMatchObject({
      text,
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    const request = JSON.stringify(model.doGenerateCalls);
    expect(request).toContain("experienced delivery manager");
    expect(request).toContain("acceptedChanges");
    expect(request).toContain("Atlas Site Composer");
    expect(request).toContain("Synthesize the supplied multi-source delivery episodes");
    expect(request).toContain("Never write, copy, alter, or invent a URL");
    expect(request).toContain("referenceId");
    expect(request).not.toContain("sourceUrl");
    expect(request).not.toContain("Finish with exactly one numbered");
    expect(request).toContain('"maxOutputTokens":12000');
  });

  it("deduplicates repeated report references by authorized URL", async () => {
    const originalEvidence = envelope.evidence[0];
    if (originalEvidence === undefined) throw new Error("Expected report evidence fixture");
    const model = successfulModel(
      [
        "## Delivered",
        "- Publishing now carries SEO metadata through release.",
        "## In progress",
        "- No active work.",
        "## Waiting or blocked",
        "- No active waits.",
        "## Decisions needed",
        "- No decisions.",
        "## References",
        "- [R1]",
        "- [R2]",
      ].join("\n"),
    );
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    const result = await Effect.runPromise(
      generator.generate({
        ...envelope,
        evidence: [...envelope.evidence, { ...originalEvidence, sourceId: "DEMO-754-duplicate" }],
        presentation: {
          kind: "delivery_report" as const,
          requiredCitationSources: ["jira"] as const,
          period: {
            kind: "absolute" as const,
            fromInclusive: "2026-07-01T00:00:00.000Z",
            toExclusive: "2026-07-31T00:00:00.000Z",
            timeZone: "Asia/Kolkata",
          },
          coverage: {
            complete: true,
            examinedRecords: 2,
            acceptedChanges: 1,
            duplicateRecords: 1,
            excludedRecords: 0,
            unmappedChanges: 0,
            unavailableSources: [],
          },
          capabilitySections: [],
          episodes: [],
          dependencies: [],
          decisionsNeeded: [],
          jiraAdvisories: [],
        },
      }),
    );

    expect(result.citations).toMatchObject([{ url: "https://jira.example.test/DEMO-754" }]);
    expect(result.text.match(/https:\/\/jira\.example\.test\/DEMO-754/g)).toHaveLength(1);
  });

  it("fails closed when a composed report omits a required citation source", async () => {
    const jiraEvidence = envelope.evidence[0];
    if (jiraEvidence === undefined) throw new Error("Expected Jira evidence fixture");
    const githubEvidence = {
      ...jiraEvidence,
      source: "github" as const,
      sourceId: "pull-754",
      sourceUrl: "https://github.example.test/pull/754",
      title: "Implementation",
    };
    const presentation = {
      kind: "delivery_report" as const,
      requiredCitationSources: ["jira", "github"] as const,
      period: {
        kind: "absolute" as const,
        fromInclusive: "2026-07-01T00:00:00.000Z",
        toExclusive: "2026-07-31T00:00:00.000Z",
        timeZone: "Asia/Kolkata",
      },
      coverage: {
        complete: true,
        examinedRecords: 2,
        acceptedChanges: 1,
        duplicateRecords: 0,
        excludedRecords: 0,
        unmappedChanges: 0,
        unavailableSources: [],
      },
      capabilitySections: [],
      episodes: [],
      dependencies: [],
      decisionsNeeded: [],
      jiraAdvisories: [],
    };
    const reportText = (references: readonly string[]): string =>
      [
        "## Delivered",
        "- Delivery is current.",
        "## In progress",
        "- No active work.",
        "## Waiting or blocked",
        "- No active waits.",
        "## Decisions needed",
        "- No decisions.",
        "## References",
        ...references,
      ].join("\n");
    const reportEnvelope = {
      ...envelope,
      evidence: [jiraEvidence, githubEvidence],
      presentation,
    };
    const incomplete = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(reportText(["- [R1]"])),
    );

    await expect(
      Effect.runPromise(incomplete.generate(reportEnvelope).pipe(Effect.either)),
    ).resolves.toMatchObject({
      _tag: "Left",
      left: { operation: "report-composition-required-citation-source-missing" },
    });

    const complete = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(reportText(["- [R1]", "- [R2]"])),
    );
    await expect(Effect.runPromise(complete.generate(reportEnvelope))).resolves.toMatchObject({
      citations: [
        { url: "https://jira.example.test/DEMO-754" },
        { url: "https://github.example.test/pull/754" },
      ],
    });
  });

  it("fails closed when a Sprint Review omits a mandatory planning label", async () => {
    const presentation = {
      kind: "delivery_report" as const,
      requiredCitationSources: ["jira"] as const,
      period: {
        kind: "source_defined" as const,
        reference: "current sprint",
        timeZone: "Asia/Kolkata",
      },
      coverage: {
        complete: true,
        examinedRecords: 1,
        acceptedChanges: 1,
        duplicateRecords: 0,
        excludedRecords: 0,
        unmappedChanges: 0,
        unavailableSources: [],
      },
      capabilitySections: [],
      episodes: [],
      dependencies: [],
      decisionsNeeded: [],
      jiraAdvisories: [],
      sprintReview: {
        previous: {
          plannedAtStart: [],
          addedDuringSprint: [],
          completedDuringSprint: [],
          rolledIntoCurrent: [],
          dropped: [],
        },
        current: [],
        initiatives: [],
        noCurrentSprintActivity: [],
        unaccountedWork: [],
      },
    };
    const reportText = (includeUnaccountedWork: boolean): string =>
      [
        "## Sprint overview",
        "- Delivery remains on plan.",
        "## Previous sprint",
        "- **Planned at start:** No observed work.",
        "- **Delivered:** No observed work.",
        "- **Rolled over:** No observed work.",
        "- **Added during sprint:** No observed work.",
        "- **Dropped or superseded:** No observed work.",
        "## Current sprint",
        "- No active work.",
        "## Q3 alignment",
        "- **No current-sprint activity:** No initiatives.",
        ...(includeUnaccountedWork ? ["- **Unaccounted work:** None."] : []),
        "## Waiting or decisions",
        "- No active waits.",
        "## Jira hygiene",
        "- No advisory corrections.",
        "## References",
        "- [R1]",
      ].join("\n");
    const reportEnvelope = { ...envelope, presentation };
    const incomplete = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(reportText(false)),
    );

    await expect(
      Effect.runPromise(incomplete.generate(reportEnvelope).pipe(Effect.either)),
    ).resolves.toMatchObject({
      _tag: "Left",
      left: { operation: "report-composition-structure" },
    });

    const complete = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(reportText(true)),
    );
    await expect(Effect.runPromise(complete.generate(reportEnvelope))).resolves.toMatchObject({
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    const promptModel = successfulModel(reportText(true));
    await Effect.runPromise(
      createGroundedAnswerGenerator(configuration, undefined, () => promptModel).generate(
        reportEnvelope,
      ),
    );
    expect(JSON.stringify(promptModel.doGenerateCalls)).toContain(
      "always include the two explicit labels 'No current-sprint activity' and 'Unaccounted work'",
    );
  });

  it("classifies malformed or invalidly cited model output separately from provider failure", async () => {
    for (const text of [
      "Uncited answer.\nStill uncited.",
      "Claim. [Unknown](https://evil.example.test/x)\nNext. [Unknown](https://evil.example.test/x)",
      "One [Delivery](https://jira.example.test/DEMO-754)\nTwo [Delivery](https://jira.example.test/DEMO-754)\nThree [Delivery](https://jira.example.test/DEMO-754)\nFour [Delivery](https://jira.example.test/DEMO-754)",
    ]) {
      const generator = createGroundedAnswerGenerator(configuration, undefined, () =>
        successfulModel(text),
      );
      await expect(
        Effect.runPromise(generator.generate(envelope).pipe(Effect.either)),
      ).resolves.toMatchObject({
        _tag: "Left",
        left: { operation: "report-composition-invalid" },
      });
    }
  });

  it("retains privacy-safe report validation diagnostics", async () => {
    const validSections = [
      "## Delivered",
      "- Delivery is current.",
      "## In progress",
      "- No active work.",
      "## Waiting or blocked",
      "- No active waits.",
      "## Decisions needed",
      "- No decisions.",
      "## References",
      "- [Jira](https://jira.example.test/DEMO-754)",
    ];
    const cases = [
      { text: "", operation: "report-composition-empty" },
      {
        text: validSections.filter((line) => line !== "## Decisions needed").join("\n"),
        operation: "report-composition-structure",
      },
      {
        text: validSections.slice(0, -1).join("\n"),
        operation: "report-composition-citations-missing",
      },
      {
        text: validSections
          .map((line) =>
            line.includes("jira.example.test")
              ? "- [Unknown](https://unknown.example.test/item)"
              : line,
          )
          .join("\n"),
        operation: "report-composition-citation-url-unknown",
      },
      {
        text: validSections
          .map((line) => (line.includes("jira.example.test") ? "- [R2]" : line))
          .join("\n"),
        operation: "report-composition-reference-id-unknown",
      },
      {
        text: validSections
          .map((line) =>
            line === "- Delivery is current."
              ? "- Delivery is current. [Jira](https://jira.example.test/DEMO-754)"
              : line,
          )
          .join("\n"),
        operation: "report-composition-citation-placement",
      },
      {
        text: validSections
          .map((line) =>
            line === "- Delivery is current." ? "- Evidence-backed delivery is current." : line,
          )
          .join("\n"),
        operation: "report-composition-prohibited-prose",
      },
    ];
    const reportEnvelope = {
      ...envelope,
      presentation: {
        kind: "delivery_report" as const,
        requiredCitationSources: ["jira"] as const,
        period: {
          kind: "absolute" as const,
          fromInclusive: "2026-07-01T00:00:00.000Z",
          toExclusive: "2026-07-31T00:00:00.000Z",
          timeZone: "Asia/Kolkata",
        },
        coverage: {
          complete: true,
          examinedRecords: 1,
          acceptedChanges: 1,
          duplicateRecords: 0,
          excludedRecords: 0,
          unmappedChanges: 0,
          unavailableSources: [],
        },
        capabilitySections: [],
        episodes: [],
        dependencies: [],
        decisionsNeeded: [],
        jiraAdvisories: [],
      },
    };

    for (const testCase of cases) {
      const generator = createGroundedAnswerGenerator(configuration, undefined, () =>
        successfulModel(testCase.text),
      );
      await expect(
        Effect.runPromise(generator.generate(reportEnvelope).pipe(Effect.either)),
      ).resolves.toMatchObject({
        _tag: "Left",
        left: { operation: testCase.operation },
      });
    }

    const inlineReferenceText = validSections
      .map((line) =>
        line === "- Delivery is current."
          ? "- Delivery is current. [R1]"
          : line.includes("jira.example.test")
            ? "- [R1]"
            : line,
      )
      .join("\n");
    const inlineReferenceGenerator = createGroundedAnswerGenerator(configuration, undefined, () =>
      successfulModel(inlineReferenceText),
    );
    const resolved = await Effect.runPromise(inlineReferenceGenerator.generate(reportEnvelope));
    expect(resolved.text).not.toContain("[R1]");
    expect(resolved.text).toContain("- **Jira:** [1](https://jira.example.test/DEMO-754)");
    expect(resolved.citations).toEqual([
      { label: "Delivery", url: "https://jira.example.test/DEMO-754" },
    ]);
  });

  it("emits a privacy-safe failure without trying another provider", async () => {
    const diagnostics: unknown[] = [];
    const model = failingModel();
    const generator = createGroundedAnswerGenerator(
      configuration,
      (event) => diagnostics.push(event),
      () => model,
    );

    await expect(Effect.runPromise(generator.generate(envelope))).rejects.toThrow(
      "OpenRouter answer generation is unavailable",
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(diagnostics).toEqual([
      { event: "model_provider", outcome: "failed", provider: "openrouter" },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
    expect(JSON.stringify(diagnostics)).not.toContain("What changed");
  });
});
