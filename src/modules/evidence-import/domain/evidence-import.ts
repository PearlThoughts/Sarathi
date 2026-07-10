import type { SensitivityTier } from "../../../domain/policy.ts";

type EvidenceImportSourceSystem =
  | "jira"
  | "teams"
  | "github"
  | "pulse"
  | "vault"
  | "email"
  | "meeting"
  | "manual";

type EvidenceImportSourceType =
  | "message"
  | "thread"
  | "card_interaction"
  | "issue"
  | "pull_request"
  | "commit"
  | "transcript"
  | "note"
  | "event";

export type EvidenceConsentStatus = "granted" | "not_required" | "unknown" | "withdrawn";

export type EvidenceConsent = {
  readonly status: EvidenceConsentStatus;
  readonly scope: string;
  readonly recordedAt: string;
  readonly recordedBy?: string | undefined;
};

export type NormalizedEvidenceRecord = {
  readonly sourceSystem: EvidenceImportSourceSystem;
  readonly sourceType: EvidenceImportSourceType;
  readonly externalId: string;
  readonly occurredAt: string;
  readonly title: string;
  readonly bodyExcerpt?: string | undefined;
  readonly body?: string | undefined;
  readonly externalUrl?: string | undefined;
  readonly actorId?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
  readonly consent: EvidenceConsent;
};

export type EvidenceImportWatermark = {
  readonly workspaceId: string;
  readonly sourceKey: string;
  readonly lastCursor: string;
  readonly recordCount: number;
  readonly contentHash: string;
  readonly updatedAt: string;
};

export type EvidenceImportSummary = {
  readonly recordsRead: number;
  readonly evidenceItemsSaved: number;
  readonly watermark: EvidenceImportWatermark;
};
