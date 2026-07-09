import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  EvidenceItem,
  EvidenceSourceType,
  ExternalSystemKind,
  StrategyKernelRepository,
} from "../strategy-kernel/index.ts";

type LocalEvidenceImportRecord = {
  readonly sourceSystem: ExternalSystemKind;
  readonly sourceType: EvidenceSourceType;
  readonly externalId: string;
  readonly occurredAt: string;
  readonly title: string;
  readonly bodyExcerpt?: string | undefined;
  readonly body?: string | undefined;
  readonly externalUrl?: string | undefined;
  readonly actorId?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
};

export type EvidenceImportWatermark = {
  readonly workspaceId: string;
  readonly sourceKey: string;
  readonly lastCursor: string;
  readonly recordCount: number;
  readonly contentHash: string;
  readonly updatedAt: string;
};

type EvidenceImportSummary = {
  readonly recordsRead: number;
  readonly evidenceItemsSaved: number;
  readonly watermark: EvidenceImportWatermark;
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

const excerpt = (record: LocalEvidenceImportRecord): string =>
  normalizeWhitespace(record.bodyExcerpt ?? record.body ?? record.title).slice(0, 1200);

const stableHash = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
};

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

const parseRecord = (value: unknown): LocalEvidenceImportRecord => {
  if (!isRecord(value)) {
    throw new Error("Invalid evidence import file: each item must be an object.");
  }

  const sourceSystem = value.sourceSystem;
  const sourceType = value.sourceType;
  const sensitivity = value.sensitivity;

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
    externalId: requiredString(value, "externalId"),
    occurredAt: requiredString(value, "occurredAt"),
    title: normalizeWhitespace(requiredString(value, "title")),
    bodyExcerpt: optionalString(value, "bodyExcerpt"),
    body: optionalString(value, "body"),
    externalUrl: optionalString(value, "externalUrl"),
    actorId: optionalString(value, "actorId"),
    sensitivity: sensitivity ?? "internal",
  };
};

const recordsFromJsonValue = (value: unknown): readonly LocalEvidenceImportRecord[] => {
  if (Array.isArray(value)) {
    return value.map(parseRecord);
  }

  if (isRecord(value)) {
    const nested = value.records ?? value.evidence ?? value.items;

    if (Array.isArray(nested)) {
      return nested.map(parseRecord);
    }
  }

  throw new Error("Invalid evidence import file: expected an array or a records array.");
};

export const parseLocalEvidenceExport = (
  contents: string,
): readonly LocalEvidenceImportRecord[] => {
  const trimmed = contents.trim();

  if (trimmed === "") {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return recordsFromJsonValue(JSON.parse(trimmed) as unknown);
    } catch (error) {
      if (!trimmed.includes("\n")) {
        throw error;
      }
    }
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => parseRecord(JSON.parse(line) as unknown));
};

const evidenceItemFromLocalRecord = (
  record: LocalEvidenceImportRecord,
  workspaceId: string,
  ingestedAt: string,
): EvidenceItem => {
  const normalizedExternalId = normalizeWhitespace(record.externalId);

  return {
    id: `evidence-${workspaceId}-${record.sourceSystem}-${stableHash(normalizedExternalId)}`,
    workspaceId,
    sourceSystem: record.sourceSystem,
    sourceType: record.sourceType,
    externalId: normalizedExternalId,
    externalUrl: record.externalUrl,
    actorId: record.actorId,
    occurredAt: record.occurredAt,
    title: record.title,
    bodyExcerpt: excerpt(record),
    contentHash: `fnv1a64-${stableHash(canonicalize(record))}`,
    sensitivity: record.sensitivity ?? "internal",
    ingestedAt,
  };
};

const buildEvidenceImportWatermark = (
  records: readonly LocalEvidenceImportRecord[],
  workspaceId: string,
  sourceKey: string,
  updatedAt: string,
): EvidenceImportWatermark => ({
  workspaceId,
  sourceKey,
  lastCursor: records.at(-1)?.occurredAt ?? updatedAt,
  recordCount: records.length,
  contentHash: `fnv1a64-${stableHash(canonicalize(records))}`,
  updatedAt,
});

export const importLocalEvidenceRecords = async (
  repository: StrategyKernelRepository,
  records: readonly LocalEvidenceImportRecord[],
  workspaceId: string,
  sourceKey: string,
  ingestedAt: string,
): Promise<EvidenceImportSummary> => {
  for (const record of records) {
    await repository.saveEvidenceItem(evidenceItemFromLocalRecord(record, workspaceId, ingestedAt));
  }

  return {
    recordsRead: records.length,
    evidenceItemsSaved: records.length,
    watermark: buildEvidenceImportWatermark(records, workspaceId, sourceKey, ingestedAt),
  };
};
