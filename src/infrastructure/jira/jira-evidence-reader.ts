import type { EvidenceSourceReader } from "../../modules/evidence-import/index.ts";

export type JiraEvidenceReaderConfiguration = {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly fetcher?: typeof fetch | undefined;
};

export const createJiraEvidenceReader = (
  configuration: JiraEvidenceReaderConfiguration,
): EvidenceSourceReader => ({
  readEvidence: async ({ sourceKey }) => {
    const issueKey = sourceKey.startsWith("jira:") ? sourceKey.slice(5).trim() : "";
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) return { records: [] };
    const response = await (configuration.fetcher ?? fetch)(
      `${configuration.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        headers: {
          Authorization: `Basic ${btoa(`${configuration.email}:${configuration.apiToken}`)}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`Jira read failed with HTTP ${response.status}.`);
    const issue = (await response.json()) as {
      key: string;
      fields?: {
        summary?: string;
        updated?: string;
        status?: { name?: string };
      };
    };
    const status = issue.fields?.status?.name?.trim() || "Unknown";
    return {
      records: [
        {
          sourceSystem: "jira",
          sourceType: "issue",
          externalId: issue.key,
          externalUrl: new URL(
            `/browse/${encodeURIComponent(issue.key)}`,
            configuration.baseUrl,
          ).toString(),
          occurredAt: issue.fields?.updated ?? new Date().toISOString(),
          title: issue.fields?.summary ?? issue.key,
          bodyExcerpt: `Status: ${status}. Jira issue metadata retrieved through approved read adapter.`,
          sensitivity: "internal",
          consent: {
            status: "not_required",
            scope: "jira-read",
            recordedAt: issue.fields?.updated ?? new Date().toISOString(),
          },
        },
      ],
    };
  },
});
