import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { FollowUpItem } from "../domain/follow-up.ts";

export type FollowUpQuery = {
  readonly dueFrom?: string | undefined;
  readonly dueTo?: string | undefined;
};

export type FollowUpSource = {
  readonly provider: "follow-up-source";
  readonly findOpenItems: (
    query: FollowUpQuery,
  ) => Effect.Effect<readonly FollowUpItem[], RepositoryError>;
};
