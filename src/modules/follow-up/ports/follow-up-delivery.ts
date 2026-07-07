import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { FollowUpDigest } from "../domain/follow-up.ts";

export type FollowUpDeliveryResult = {
  readonly delivered: boolean;
  readonly externalId?: string | undefined;
};

export type FollowUpDelivery = {
  readonly provider: "follow-up-delivery";
  readonly deliverDigest: (
    digest: FollowUpDigest,
  ) => Effect.Effect<FollowUpDeliveryResult, RepositoryError>;
};
