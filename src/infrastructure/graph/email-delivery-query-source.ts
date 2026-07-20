import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQueryResult,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type EmailAddress = { readonly address?: string; readonly name?: string };
type GraphMailMessage = {
  readonly id?: string;
  readonly subject?: string;
  readonly bodyPreview?: string;
  readonly receivedDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly webLink?: string;
  readonly from?: { readonly emailAddress?: EmailAddress };
  readonly toRecipients?: readonly { readonly emailAddress?: EmailAddress }[];
  readonly ccRecipients?: readonly { readonly emailAddress?: EmailAddress }[];
};

export type ProjectMailScope = {
  readonly mailboxId: string;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly mode: "dedicated-mailbox" | "matched";
  readonly routingTerms?: readonly string[] | undefined;
  readonly participantAddresses?: readonly string[] | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
};

export type EmailDeliveryQueryConfiguration = {
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly mailScopes: readonly ProjectMailScope[];
  readonly timeoutMs?: number | undefined;
  readonly fetcher?: Fetcher | undefined;
};

const financialContent =
  /\b(?:budget|cost|rate|invoice|payment|burn|revenue|margin|salary|payroll|compensation)\b/i;

const emptyResult = (): DeliveryQueryResult => ({
  items: [],
  conflicts: [],
  unavailableSources: [],
  complete: true,
});

const normalize = (value: string | undefined): string =>
  (value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const addresses = (message: GraphMailMessage): readonly string[] =>
  [
    message.from?.emailAddress?.address,
    ...(message.toRecipients ?? []).map(({ emailAddress }) => emailAddress?.address),
    ...(message.ccRecipients ?? []).map(({ emailAddress }) => emailAddress?.address),
  ].flatMap((value) => (value === undefined ? [] : [value.toLowerCase()]));

const matchesScope = (message: GraphMailMessage, scope: ProjectMailScope): boolean => {
  if (scope.mode === "dedicated-mailbox") return true;
  const text = `${normalize(message.subject)} ${normalize(message.bodyPreview)}`.toLowerCase();
  const termMatch = (scope.routingTerms ?? []).some((term) =>
    text.includes(term.trim().toLowerCase()),
  );
  const participants = new Set(addresses(message));
  const participantMatch = (scope.participantAddresses ?? []).some((address) =>
    participants.has(address.trim().toLowerCase()),
  );
  return termMatch || participantMatch;
};

const operationWindow = (operation: DeliveryQueryOperation, context: DeliveryQueryContext) => {
  if (operation.time !== undefined && operation.time.kind !== "jira_sprint")
    return resolveDeliveryTimeConstraint(operation.time, context.requestedAt, context.timeZone);
  const requestedAt = new Date(context.requestedAt);
  return {
    fromInclusive: new Date(requestedAt.getTime() - 366 * 86_400_000).toISOString(),
    toExclusive: new Date(requestedAt.getTime() + 86_400_000).toISOString(),
  };
};

const mailUrl = (
  scope: ProjectMailScope,
  fromInclusive: string,
  toExclusive: string,
  limit: number,
): URL => {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(scope.mailboxId)}/messages`,
  );
  url.searchParams.set(
    "$select",
    "id,subject,bodyPreview,receivedDateTime,lastModifiedDateTime,webLink,from,toRecipients,ccRecipients",
  );
  url.searchParams.set(
    "$filter",
    `receivedDateTime ge ${fromInclusive} and receivedDateTime lt ${toExclusive}`,
  );
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set("$top", String(Math.min(limit * 5, 50)));
  return url;
};

const readMailbox = async (
  configuration: EmailDeliveryQueryConfiguration,
  scope: ProjectMailScope,
  accessToken: string,
  fromInclusive: string,
  toExclusive: string,
  limit: number,
): Promise<readonly GraphMailMessage[]> => {
  const response = await (configuration.fetcher ?? fetch)(
    mailUrl(scope, fromInclusive, toExclusive, limit),
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(configuration.timeoutMs ?? 4_000),
    },
  );
  if (!response.ok)
    throw new Error(`Project email delivery query failed with HTTP ${response.status}.`);
  return ((await response.json()) as { readonly value?: readonly GraphMailMessage[] }).value ?? [];
};

export const createEmailDeliveryQuerySource = (
  configuration: EmailDeliveryQueryConfiguration,
): DeliveryQuerySource => ({
  source: "email",
  selectors: ["objects", "relations", "observations", "claims"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        const scopes = configuration.mailScopes.filter(
          (scope) =>
            scope.workspaceId === context.workspaceId &&
            scope.allowedActorIds.has(context.actorId) &&
            isSensitivityAtOrBelow(scope.sensitivity ?? "internal", context.maximumSensitivity) &&
            (scope.mode === "dedicated-mailbox" ||
              (scope.routingTerms?.length ?? 0) + (scope.participantAddresses?.length ?? 0) > 0),
        );
        const operations = plan.operations.filter((operation) =>
          ["objects", "relations", "observations", "claims"].includes(operation.select),
        );
        if (scopes.length === 0 || scopes.length > 10 || operations.length === 0)
          return emptyResult();
        const windows = operations.map((operation) => operationWindow(operation, context));
        const fromInclusive = new Date(
          Math.min(...windows.map((window) => Date.parse(window.fromInclusive))),
        ).toISOString();
        const toExclusive = new Date(
          Math.max(...windows.map((window) => Date.parse(window.toExclusive))),
        ).toISOString();
        const maximumLimit = Math.max(...operations.map(({ limit }) => limit));
        const accessToken = await configuration.tokenProvider.getAccessToken();
        const mailboxMessages = await Promise.all(
          scopes.map(async (scope) => ({
            scope,
            messages: await readMailbox(
              configuration,
              scope,
              accessToken,
              fromInclusive,
              toExclusive,
              maximumLimit,
            ),
          })),
        );
        const items = mailboxMessages.flatMap(({ scope, messages }) =>
          operations.flatMap((operation) => {
            const window = operationWindow(operation, context);
            return messages
              .flatMap((message): readonly DeliveryResultItem[] => {
                const observedAt = message.receivedDateTime ?? message.lastModifiedDateTime;
                const subject = normalize(message.subject) || "Project email";
                const preview = normalize(message.bodyPreview).slice(0, 180);
                const containsFinance = financialContent.test(`${subject} ${preview}`);
                const sensitivity: SensitivityTier = containsFinance
                  ? "confidential"
                  : (scope.sensitivity ?? "internal");
                if (
                  message.id === undefined ||
                  observedAt === undefined ||
                  message.webLink === undefined ||
                  !message.webLink.startsWith("https://") ||
                  Date.parse(observedAt) < Date.parse(window.fromInclusive) ||
                  Date.parse(observedAt) >= Date.parse(window.toExclusive) ||
                  !matchesScope(message, scope) ||
                  containsFinance ||
                  !isSensitivityAtOrBelow(sensitivity, context.maximumSensitivity)
                )
                  return [];
                const sender =
                  message.from?.emailAddress?.name ??
                  message.from?.emailAddress?.address ??
                  "Project contact";
                return [
                  {
                    id: `email:${scope.mailboxId}:${message.id}:${operation.purpose}`,
                    workspaceId: context.workspaceId,
                    source: "email",
                    selector: operation.select,
                    intent: operation.purpose,
                    title: subject,
                    summary: `${sender}: ${subject}${preview === "" ? "" : ` — ${preview}`}`,
                    citationUrl: message.webLink,
                    sensitivity,
                    authority: 0.75,
                    observedAt,
                    dedupeKey: `email:${scope.mailboxId}:${message.id}`,
                  },
                ];
              })
              .slice(0, operation.limit);
          }),
        );
        return { items, conflicts: [], unavailableSources: [], complete: true };
      },
      catch: () =>
        new RepositoryError({
          message: "Connected project email is unavailable.",
          operation: "delivery-query-email",
        }),
    }),
});
