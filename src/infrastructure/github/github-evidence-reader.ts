import type { EvidenceSourceReader } from "../../modules/evidence-import/index.ts";

export type GitHubEvidenceReaderConfiguration = {
  readonly token: string;
  readonly allowedRepositories: ReadonlySet<string>;
  readonly fetcher?: typeof fetch | undefined;
};

export const createGitHubEvidenceReader = (
  configuration: GitHubEvidenceReaderConfiguration,
): EvidenceSourceReader => ({
  readEvidence: async ({ sourceKey }) => {
    const match = /^github:([^/]+\/[^#]+)#(\d+)$/.exec(sourceKey);
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      !configuration.allowedRepositories.has(match[1])
    )
      return { records: [] };
    const response = await (configuration.fetcher ?? fetch)(
      `https://api.github.com/repos/${match[1]}/issues/${match[2]}`,
      {
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub read failed with HTTP ${response.status}.`);
    const issue = (await response.json()) as {
      readonly number: number;
      readonly title: string;
      readonly html_url: string;
      readonly updated_at: string;
      readonly body?: string;
    };
    return {
      records: [
        {
          sourceSystem: "github",
          sourceType: "pull_request",
          externalId: `${match[1]}#${issue.number}`,
          externalUrl: issue.html_url,
          occurredAt: issue.updated_at,
          title: issue.title,
          bodyExcerpt: (issue.body ?? issue.title).replace(/\s+/g, " ").trim().slice(0, 1200),
          sensitivity: "internal",
          consent: {
            status: "not_required",
            scope: "github-app-read",
            recordedAt: issue.updated_at,
          },
        },
      ],
    };
  },
});
