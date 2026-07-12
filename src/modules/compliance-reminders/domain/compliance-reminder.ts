import type {
  FollowUpDigest,
  FollowUpDigestKind,
  FollowUpItem,
  FollowUpWindow,
} from "../../follow-up/domain/follow-up.ts";

export type ComplianceReminderRequest = {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly kind: FollowUpDigestKind;
  readonly today: string;
  readonly window?: FollowUpWindow | undefined;
  readonly dryRun: boolean;
  readonly occurredAt: string;
  readonly retryAt: string;
};

export type WorkspaceFollowUpItem = {
  readonly workspaceId: string;
  readonly item: FollowUpItem;
};

export type ComplianceReminderAudit = {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly request: ComplianceReminderRequest;
  readonly digest: FollowUpDigest;
  readonly state: "delivered" | "retryable_failure";
  readonly occurredAt: string;
  readonly retryAt?: string | undefined;
  readonly externalId?: string | undefined;
};

export type ComplianceReminderDryRunEvidence = {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly kind: FollowUpDigestKind;
  readonly itemCount: number;
  readonly digestHash: string;
  readonly occurredAt: string;
};

export type ComplianceReminderResult = {
  readonly state: "planned" | "suppressed_duplicate" | "delivered" | "retryable_failure";
  readonly digest: FollowUpDigest;
  readonly idempotencyKey: string;
};
