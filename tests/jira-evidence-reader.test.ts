import { describe, expect, it, vi } from "vitest";
import {
  createJiraEvidenceReader,
  type JiraEvidenceReaderConfiguration,
} from "../src/infrastructure/jira/index.ts";

describe("Jira evidence reader", () => {
  it("rejects non-issue source keys without a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const configuration: JiraEvidenceReaderConfiguration = {
      baseUrl: "https://jira.example.test",
      email: "synthetic@example.test",
      apiToken: "synthetic",
      fetcher: fetcher as unknown as typeof fetch,
    };
    const reader = createJiraEvidenceReader(configuration);
    await expect(
      reader.readEvidence({ workspaceId: "workspace", sourceKey: "jira:bad key" }),
    ).resolves.toEqual({ records: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes an approved issue through a read-only request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          key: "F1851-1",
          self: "https://jira.example.test/browse/F1851-1",
          fields: { summary: "Synthetic delivery issue", updated: "2026-07-11T00:00:00Z" },
        }),
        { status: 200 },
      ),
    );
    const reader = createJiraEvidenceReader({
      baseUrl: "https://jira.example.test",
      email: "synthetic@example.test",
      apiToken: "synthetic",
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(
      reader.readEvidence({ workspaceId: "workspace", sourceKey: "jira:F1851-1" }),
    ).resolves.toMatchObject({ records: [{ sourceSystem: "jira", externalId: "F1851-1" }] });
  });
});
