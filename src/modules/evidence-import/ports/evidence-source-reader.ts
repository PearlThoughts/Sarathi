import type { NormalizedEvidenceRecord } from "../domain/evidence-import.ts";

export type EvidenceSourceReadRequest = {
  readonly workspaceId: string;
  readonly sourceKey: string;
  readonly afterCursor?: string | undefined;
};

export type EvidenceSourceReadResult = {
  readonly records: readonly NormalizedEvidenceRecord[];
  readonly nextCursor?: string | undefined;
};

/**
 * Source adapters may only read an approved export or CLI surface. They never
 * receive a source mutation capability from the evidence-import module.
 */
export type EvidenceSourceReader = {
  readonly readEvidence: (request: EvidenceSourceReadRequest) => Promise<EvidenceSourceReadResult>;
};
