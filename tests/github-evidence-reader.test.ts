import { describe, expect, it, vi } from "vitest";
import {
  createGitHubEvidenceReader,
  type GitHubEvidenceReaderConfiguration,
} from "../src/infrastructure/github/index.ts";

describe("GitHub evidence reader", () => {
  it("denies repositories outside the allow-list before a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const configuration: GitHubEvidenceReaderConfiguration = {
      token: "synthetic",
      allowedRepositories: new Set(),
      fetcher: fetcher as unknown as typeof fetch,
    };
    const reader = createGitHubEvidenceReader(configuration);
    await expect(
      reader.readEvidence({
        workspaceId: "workspace",
        sourceKey: "github:PearlThoughts/Sarathi#1",
      }),
    ).resolves.toEqual({ records: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes an allowed GitHub issue as evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 1,
          title: "Synthetic PR",
          html_url: "https://github.example.test/pr/1",
          updated_at: "2026-07-11T00:00:00Z",
          body: "Verified change",
        }),
        { status: 200 },
      ),
    );
    const reader = createGitHubEvidenceReader({
      token: "synthetic",
      allowedRepositories: new Set(["PearlThoughts/Sarathi"]),
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(
      reader.readEvidence({
        workspaceId: "workspace",
        sourceKey: "github:PearlThoughts/Sarathi#1",
      }),
    ).resolves.toMatchObject({
      records: [{ sourceSystem: "github", externalId: "PearlThoughts/Sarathi#1" }],
    });
  });
});
