import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { FollowUpDigest } from "../../follow-up/domain/follow-up.ts";

export type ComplianceReminderDelivery = {
  readonly provider: "compliance-reminder-delivery";
  readonly deliver: (input: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
    readonly digest: FollowUpDigest;
  }) => Effect.Effect<{ readonly externalId: string }, RepositoryError>;
};
