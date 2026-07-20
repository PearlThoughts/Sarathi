import { stableSha256 } from "../../../domain/hash.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";

export type DeliverySourceKind = "jira" | "vault" | "github" | "teams" | "email";

export type DeliveryObjectKind =
  | "project"
  | "person"
  | "team"
  | "module"
  | "requirement"
  | "milestone"
  | "sprint"
  | "work_item"
  | "deliverable"
  | "risk"
  | "decision"
  | "extension";

export type DeliveryRelationKind =
  | "contains"
  | "owns"
  | "assigned_to"
  | "depends_on"
  | "blocks"
  | "contributes_to"
  | "implements"
  | "affects"
  | "duplicates"
  | "supersedes"
  | "participates_in";

export type DeliveryObservationKind =
  | "state"
  | "change"
  | "message"
  | "comment"
  | "commit"
  | "pull_request"
  | "review"
  | "check"
  | "deployment"
  | "incident"
  | "decision";

export type DeliveryMetricCategory = "delivery" | "capacity" | "quality" | "finance";

export type DeliveryObjectRef = {
  readonly kind: DeliveryObjectKind;
  readonly externalKey: string;
};

export type DeliverySourceReference = {
  readonly source: DeliverySourceKind;
  readonly sourceId: string;
  readonly sourceItemId: string;
  readonly sourceVersionId?: string | undefined;
  readonly citationUrl: string;
};

export type DeliveryRecordBoundary = {
  readonly workspaceId: string;
  readonly sensitivity: SensitivityTier;
  readonly source: DeliverySourceReference;
  readonly observedAt: string;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
  readonly active: boolean;
  readonly deleted: boolean;
};

export type DeliveryObject = DeliveryRecordBoundary & {
  readonly id: string;
  readonly kind: DeliveryObjectKind;
  readonly externalKey: string;
  readonly title: string;
  readonly lifecycleState?: string | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
};

export type DeliveryRelation = DeliveryRecordBoundary & {
  readonly id: string;
  readonly kind: DeliveryRelationKind;
  readonly from: DeliveryObjectRef;
  readonly to: DeliveryObjectRef;
  readonly attributes: Readonly<Record<string, unknown>>;
};

export type DeliveryObservation = DeliveryRecordBoundary & {
  readonly id: string;
  readonly kind: DeliveryObservationKind;
  readonly subject?: DeliveryObjectRef | undefined;
  readonly actorExternalKey?: string | undefined;
  readonly summary: string;
  readonly dedupeKey: string;
};

export type DeliveryClaimValue = string | number | boolean | null | readonly unknown[] | object;

export type DeliveryClaim = DeliveryRecordBoundary & {
  readonly id: string;
  readonly subjectKey: string;
  readonly subject?: DeliveryObjectRef | undefined;
  readonly predicate: string;
  readonly value: DeliveryClaimValue;
  readonly valueHash: string;
  readonly assertedBy?: string | undefined;
  readonly authority: number;
};

export type DeliveryMetric = DeliveryRecordBoundary & {
  readonly id: string;
  readonly subject: DeliveryObjectRef;
  readonly category: DeliveryMetricCategory;
  readonly kind: string;
  readonly value: string;
  readonly unit: string;
};

export type DeliveryConflict = {
  readonly workspaceId: string;
  readonly subjectKey: string;
  readonly predicate: string;
  readonly claims: readonly DeliveryClaim[];
};

const financeAttributePattern =
  /(?:^|[_-])(budget|cost|rate|burn|revenue|margin|salary|compensation|payroll)(?:$|[_-])/i;

export const isFinanceAttributeKey = (key: string): boolean =>
  financeAttributePattern.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));

export const assertNonFinancialAttributes = (
  attributes: Readonly<Record<string, unknown>>,
): void => {
  const financialKey = Object.keys(attributes).find(isFinanceAttributeKey);
  if (financialKey !== undefined) {
    throw new Error(
      `Financial attribute '${financialKey}' must use the confidential finance metric boundary.`,
    );
  }
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

export const deliveryClaimValueHash = (value: DeliveryClaimValue): string =>
  stableSha256(canonicalJson(value));

export const findDeliveryConflicts = (
  claims: readonly DeliveryClaim[],
): readonly DeliveryConflict[] => {
  const groups = new Map<string, DeliveryClaim[]>();
  for (const claim of claims) {
    if (!claim.active || claim.deleted) continue;
    const key = `${claim.workspaceId}\u0000${claim.subjectKey}\u0000${claim.predicate}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => new Set(group.map((claim) => claim.valueHash)).size > 1)
    .map((group) => ({
      workspaceId: group[0]?.workspaceId ?? "",
      subjectKey: group[0]?.subjectKey ?? "",
      predicate: group[0]?.predicate ?? "",
      claims: [...group].sort(
        (left, right) =>
          right.authority - left.authority ||
          Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        left.subjectKey.localeCompare(right.subjectKey) ||
        left.predicate.localeCompare(right.predicate),
    );
};
