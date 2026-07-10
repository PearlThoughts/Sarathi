import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  EvidenceItem,
  EvidenceSourceType,
  ExternalSystemKind,
} from "../strategy-kernel/index.ts";
import type {
  EvidenceConsent,
  EvidenceConsentStatus,
  EvidenceImportSummary,
  EvidenceImportWatermark,
  NormalizedEvidenceRecord,
} from "./domain/evidence-import.ts";

export type {
  EvidenceConsent,
  EvidenceConsentStatus,
  EvidenceImportSummary,
  EvidenceImportWatermark,
  NormalizedEvidenceRecord,
} from "./domain/evidence-import.ts";
export type {
  EvidenceSourceReader,
  EvidenceSourceReadRequest,
  EvidenceSourceReadResult,
} from "./ports/evidence-source-reader.ts";

export type EvidenceImportRepository = {
  readonly withTransaction: <Result>(
    operation: (repository: EvidenceImportRepository) => Promise<Result>,
  ) => Promise<Result>;
  readonly saveEvidenceItem: (item: EvidenceItem) => Promise<void>;
  readonly saveEvidenceImportWatermark: (watermark: EvidenceImportWatermark) => Promise<void>;
};

const sourceSystems: readonly ExternalSystemKind[] = [
  "jira",
  "teams",
  "github",
  "vault",
  "email",
  "meeting",
  "manual",
  "pulse",
];

const sourceTypes: readonly EvidenceSourceType[] = [
  "message",
  "thread",
  "card_interaction",
  "issue",
  "pull_request",
  "commit",
  "transcript",
  "note",
  "event",
];

const sensitivities: readonly SensitivityTier[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const consentStatuses: readonly EvidenceConsentStatus[] = [
  "granted",
  "not_required",
  "unknown",
  "withdrawn",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <Value extends string>(value: unknown, options: readonly Value[]): value is Value =>
  typeof value === "string" && options.includes(value as Value);

const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid evidence import record: ${field} is required.`);
  }

  return value;
};

const optionalString = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid evidence import record: ${field} must be a string.`);
  }

  return value;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const parseConsent = (value: unknown, occurredAt: string): EvidenceConsent => {
  if (value === undefined) {
    return { status: "unknown", scope: "source-export", recordedAt: occurredAt };
  }

  if (!isRecord(value) || !isOneOf(value.status, consentStatuses)) {
    throw new Error("Invalid evidence import record: consent status is not supported.");
  }

  return {
    status: value.status,
    scope: normalizeWhitespace(requiredString(value, "scope")),
    recordedAt: requiredString(value, "recordedAt"),
    recordedBy: optionalString(value, "recordedBy"),
  };
};

const parseRecord = (value: unknown): NormalizedEvidenceRecord => {
  if (!isRecord(value)) {
    throw new Error("Invalid evidence import file: each item must be an object.");
  }

  const sourceSystem = value.sourceSystem;
  const sourceType = value.sourceType;
  const sensitivity = value.sensitivity;
  const occurredAt = requiredString(value, "occurredAt");

  if (!isOneOf(sourceSystem, sourceSystems)) {
    throw new Error("Invalid evidence import record: sourceSystem is not supported.");
  }
  if (!isOneOf(sourceType, sourceTypes)) {
    throw new Error("Invalid evidence import record: sourceType is not supported.");
  }
  if (sensitivity !== undefined && !isOneOf(sensitivity, sensitivities)) {
    throw new Error("Invalid evidence import record: sensitivity is not supported.");
  }

  return {
    sourceSystem,
    sourceType,
    externalId: normalizeWhitespace(requiredString(value, "externalId")),
    occurredAt,
    title: normalizeWhitespace(requiredString(value, "title")),
    bodyExcerpt: optionalString(value, "bodyExcerpt"),
    body: optionalString(value, "body"),
    externalUrl: optionalString(value, "externalUrl"),
    actorId: optionalString(value, "actorId"),
    sensitivity: sensitivity ?? "internal",
    consent: parseConsent(value.consent, occurredAt),
  };
};

const recordsFromJsonValue = (value: unknown): readonly NormalizedEvidenceRecord[] => {
  if (Array.isArray(value)) return value.map(parseRecord);

  if (isRecord(value)) {
    const nested = value.records ?? value.evidence ?? value.items;
    if (Array.isArray(nested)) return nested.map(parseRecord);
  }

  throw new Error("Invalid evidence import file: expected an array or a records array.");
};

export const parseLocalEvidenceExport = (contents: string): readonly NormalizedEvidenceRecord[] => {
  const trimmed = contents.trim();
  if (trimmed === "") return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return recordsFromJsonValue(JSON.parse(trimmed) as unknown);
    } catch (error) {
      if (!trimmed.includes("\n")) throw error;
    }
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => parseRecord(JSON.parse(line) as unknown));
};

const excerpt = (record: NormalizedEvidenceRecord): string =>
  normalizeWhitespace(record.bodyExcerpt ?? record.body ?? record.title).slice(0, 1200);

const evidenceItemFromRecord = (
  record: NormalizedEvidenceRecord,
  workspaceId: string,
  ingestedAt: string,
): EvidenceItem => ({
  id: `evidence:${workspaceId}:${record.sourceSystem}:${stableSha256(record.externalId)}`,
  workspaceId,
  sourceSystem: record.sourceSystem,
  sourceType: record.sourceType,
  externalId: record.externalId,
  externalUrl: record.externalUrl,
  actorId: record.actorId,
  occurredAt: record.occurredAt,
  title: record.title,
  bodyExcerpt: excerpt(record),
  contentHash: stableSha256(canonicalize(record)),
  sensitivity: record.sensitivity ?? "internal",
  consentStatus: record.consent.status,
  consentScope: record.consent.scope,
  consentRecordedAt: record.consent.recordedAt,
  consentRecordedBy: record.consent.recordedBy,
  ingestedAt,
});

const buildEvidenceImportWatermark = (
  records: readonly NormalizedEvidenceRecord[],
  workspaceId: string,
  sourceKey: string,
  updatedAt: string,
  nextCursor?: string,
): EvidenceImportWatermark => ({
  workspaceId,
  sourceKey,
  lastCursor: nextCursor ?? records.at(-1)?.occurredAt ?? updatedAt,
  recordCount: records.length,
  contentHash: stableSha256(canonicalize(records)),
  updatedAt,
});

export const importEvidenceRecords = async (
  repository: EvidenceImportRepository,
  records: readonly NormalizedEvidenceRecord[],
  workspaceId: string,
  sourceKey: string,
  ingestedAt: string,
  nextCursor?: string,
): Promise<EvidenceImportSummary> => {
  const watermark = buildEvidenceImportWatermark(
    records,
    workspaceId,
    sourceKey,
    ingestedAt,
    nextCursor,
  );

  return repository.withTransaction(async (transaction) => {
    for (const record of records) {
      await transaction.saveEvidenceItem(evidenceItemFromRecord(record, workspaceId, ingestedAt));
    }
    await transaction.saveEvidenceImportWatermark(watermark);

    return { recordsRead: records.length, evidenceItemsSaved: records.length, watermark };
  });
};
