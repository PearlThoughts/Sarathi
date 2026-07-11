import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { FollowUpWindow } from "../../follow-up/domain/follow-up.ts";
import type { WorkspaceFollowUpItem } from "../domain/compliance-reminder.ts";

export type ComplianceReminderSource = {
  readonly provider: "compliance-reminder-source";
  readonly findOpenItems: (input: {
    readonly workspaceId: string;
    readonly kind: "planning" | "exceptions";
    readonly today: string;
    readonly window?: FollowUpWindow | undefined;
  }) => Effect.Effect<readonly WorkspaceFollowUpItem[], RepositoryError>;
};
