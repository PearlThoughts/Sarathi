import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../../domain/policy.ts";
import type { NormalizedEvidenceRecord } from "../../evidence-import/domain/evidence-import.ts";
import type { EvidenceSourceReader } from "../../evidence-import/ports/evidence-source-reader.ts";
import type {
  AuthorizedContextEnvelope,
  ContextEvidence,
  ResolvedTeamsMention,
  TeamsMentionCommand,
} from "../domain/teams-mention.ts";
import type { TeamsMentionContextAssembler } from "../ports/teams-mention-ports.ts";

type AuthorizedContextSource = {
  readonly reader: EvidenceSourceReader;
  readonly sourceKey: (command: TeamsMentionCommand, resolved: ResolvedTeamsMention) => string;
};

const validEvidenceUrl = (value: string | undefined): value is string => {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const asContextEvidence = (
  record: NormalizedEvidenceRecord,
  maximumSensitivity: ResolvedTeamsMention["channelSensitivity"],
): ContextEvidence | undefined => {
  const sensitivity = record.sensitivity ?? "internal";
  if (
    (record.consent.status !== "granted" && record.consent.status !== "not_required") ||
    !isSensitivityAtOrBelow(sensitivity, maximumSensitivity) ||
    !validEvidenceUrl(record.externalUrl)
  ) {
    return undefined;
  }
  return {
    source:
      record.sourceSystem === "teams" ||
      record.sourceSystem === "jira" ||
      record.sourceSystem === "github" ||
      record.sourceSystem === "vault"
        ? record.sourceSystem
        : "intent",
    sourceId: record.externalId,
    sourceUrl: record.externalUrl,
    title: record.title,
    excerpt: (record.bodyExcerpt ?? record.body ?? record.title)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200),
    occurredAt: record.occurredAt,
    updatedAt: record.consent.recordedAt,
    sensitivity,
    freshness: "current",
    actorId: record.actorId,
  };
};

export const createAuthorizedContextAssembler = (
  sources: readonly AuthorizedContextSource[],
): TeamsMentionContextAssembler => ({
  assemble: (command, resolved) =>
    Effect.tryPromise({
      try: async (): Promise<AuthorizedContextEnvelope> => {
        const results = await Promise.all(
          sources.map(async (source) =>
            source.reader.readEvidence({
              workspaceId: resolved.workspaceId,
              sourceKey: source.sourceKey(command, resolved),
            }),
          ),
        );
        const evidence = results
          .flatMap((result) => result.records)
          .map((record) => asContextEvidence(record, resolved.channelSensitivity))
          .filter((record): record is ContextEvidence => record !== undefined);
        return { workspaceId: resolved.workspaceId, question: command.question, evidence };
      },
      catch: () =>
        new RepositoryError({
          message: "Approved context retrieval failed; Sarathi will not use partial evidence.",
        }),
    }),
});
