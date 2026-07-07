import type { SensitivityTier } from "../../../domain/policy.ts";
import type { SourceReference } from "../../../domain/source-systems.ts";

export type FollowUpDigestKind = "planning" | "exceptions";

export type FollowUpItem = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dueDate: string;
  readonly owner?: string | undefined;
  readonly url?: string | undefined;
  readonly source: SourceReference;
  readonly sensitivity: SensitivityTier;
};

export type FollowUpWindow = {
  readonly startDate: string;
  readonly endDate: string;
};

export type FollowUpDigest = {
  readonly kind: FollowUpDigestKind;
  readonly today: string;
  readonly itemCount: number;
  readonly text: string;
  readonly window?: FollowUpWindow | undefined;
};
