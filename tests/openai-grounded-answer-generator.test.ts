import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createOpenAiGroundedAnswerGenerator,
  openAiGroundedAnswerConfigurationFromEnvironment,
} from "../src/infrastructure/model/index.ts";

describe("approved OpenAI answer generator", () => {
  it("fails closed without explicit provider configuration", () => {
    expect(() => openAiGroundedAnswerConfigurationFromEnvironment({})).toThrow(
      "Approved OpenAI model configuration is required",
    );
  });

  it("sends bounded evidence and returns only evidence citations", async () => {
    let requestBody = "";
    const generator = createOpenAiGroundedAnswerGenerator({
      apiKey: "key",
      model: "model",
      baseUrl: "https://model.example.test/v1",
      fetcher: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Known fact." } }] }),
          { status: 200 },
        );
      },
    });
    await expect(
      Effect.runPromise(
        generator.generate({
          workspaceId: "workspace",
          question: "What changed?",
          evidence: [
            {
              source: "jira",
              sourceId: "F1851-754",
              sourceUrl: "https://jira.example.test/F1851-754",
              title: "Delivery",
              excerpt: "Approved detail",
              occurredAt: "2026-07-11T00:00:00.000Z",
              updatedAt: "2026-07-11T00:00:00.000Z",
              sensitivity: "internal",
              freshness: "current",
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      text: "Known fact.",
      citations: [{ url: "https://jira.example.test/F1851-754" }],
    });
    expect(requestBody).toContain("Approved detail");
    expect(requestBody).not.toContain("workspace");
  });
});
