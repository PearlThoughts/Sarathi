import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type {
  ComplianceReminderSource,
  WorkspaceFollowUpItem,
} from "../../modules/compliance-reminders/index.ts";

type JiraComplianceReminderSourceConfiguration = {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly projectKey: string;
  readonly labels: readonly string[];
  readonly fetcher?: typeof fetch | undefined;
};

type JiraIssue = {
  readonly key?: string;
  readonly fields?: {
    readonly summary?: string;
    readonly status?: { readonly name?: string };
    readonly duedate?: string | null;
    readonly assignee?: { readonly displayName?: string } | null;
  };
};

const quote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const jqlFor = (
  configuration: JiraComplianceReminderSourceConfiguration,
  dueClause: string,
): string => {
  const labels = configuration.labels.map(quote).join(", ");
  const labelClause = configuration.labels.length === 0 ? "" : ` and labels in (${labels})`;
  return `project = ${quote(configuration.projectKey)}${labelClause} and statusCategory != Done and ${dueClause} order by duedate asc`;
};

export const createJiraComplianceReminderSource = (
  configuration: JiraComplianceReminderSourceConfiguration,
): ComplianceReminderSource => ({
  provider: "compliance-reminder-source",
  findOpenItems: (input) =>
    Effect.tryPromise({
      try: async (): Promise<readonly WorkspaceFollowUpItem[]> => {
        const dueClause =
          input.kind === "planning"
            ? `duedate >= ${quote(input.window?.startDate ?? "")} and duedate <= ${quote(input.window?.endDate ?? "")}`
            : `duedate <= ${quote(input.today)}`;
        const response = await (configuration.fetcher ?? fetch)(
          `${configuration.baseUrl}/rest/api/3/search/jql`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${configuration.email}:${configuration.apiToken}`)}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jql: jqlFor(configuration, dueClause),
              fields: ["summary", "status", "duedate", "assignee"],
            }),
          },
        );
        if (!response.ok)
          throw new Error(`Jira compliance reminder search failed with HTTP ${response.status}.`);
        const payload = (await response.json()) as { readonly issues?: readonly JiraIssue[] };
        return (payload.issues ?? []).flatMap((issue) => {
          const dueDate = issue.fields?.duedate;
          if (issue.key === undefined || dueDate === undefined || dueDate === null) return [];
          return [
            {
              workspaceId: input.workspaceId,
              item: {
                id: issue.key,
                title: issue.fields?.summary ?? issue.key,
                status: issue.fields?.status?.name ?? "Unknown",
                dueDate,
                owner: issue.fields?.assignee?.displayName,
                url: `${configuration.baseUrl}/browse/${encodeURIComponent(issue.key)}`,
                source: { system: "jira", externalId: issue.key, confidence: "declared" },
                sensitivity: "internal",
              },
            },
          ];
        });
      },
      catch: () =>
        new RepositoryError({ message: "Jira compliance reminder source is unavailable." }),
    }),
});
