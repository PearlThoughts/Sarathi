import type {
  EvidenceSourceReader,
  NormalizedEvidenceRecord,
} from "../../modules/evidence-import/index.ts";

type VaultProjection = {
  readonly records: readonly (NormalizedEvidenceRecord & {
    readonly workspaceId: string;
    readonly sourceKey: string;
  })[];
};

const required = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Vault projection ${label} is required.`);
  return value;
};

export const vaultProjectionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): VaultProjection => {
  const raw = environment.SARATHI_VAULT_PROJECTION_JSON;
  if (raw === undefined || raw.trim() === "")
    throw new Error("SARATHI_VAULT_PROJECTION_JSON is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Vault projection must be valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { records?: unknown }).records)
  ) {
    throw new Error("Vault projection must contain records.");
  }
  const records = (parsed as { records: readonly unknown[] }).records.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null)
      throw new Error("Vault projection record must be an object.");
    const record = candidate as Record<string, unknown>;
    return {
      ...record,
      workspaceId: required(record.workspaceId, "workspaceId"),
      sourceKey: required(record.sourceKey, "sourceKey"),
      sourceSystem: "vault" as const,
      externalId: required(record.externalId, "externalId"),
      occurredAt: required(record.occurredAt, "occurredAt"),
      title: required(record.title, "title"),
      sourceType: "note" as const,
      consent: record.consent as NormalizedEvidenceRecord["consent"],
    } as NormalizedEvidenceRecord & { readonly workspaceId: string; readonly sourceKey: string };
  });
  return { records };
};

export const createVaultProjectionReader = (projection: VaultProjection): EvidenceSourceReader => ({
  readEvidence: async ({ workspaceId, sourceKey }) => ({
    records: projection.records.filter(
      (record) => record.workspaceId === workspaceId && record.sourceKey === sourceKey,
    ),
  }),
});
