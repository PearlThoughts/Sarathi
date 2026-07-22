import { and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryClaim,
  type DeliveryLifecycleState,
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQueryPredicate,
  type DeliveryQueryResult,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  type DeliverySourceKind,
  findDeliveryConflicts,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  deliveryAclBindingTable,
  deliveryClaimTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
  knowledgeItemTable,
} from "./knowledge-schema.ts";

type DeliveryTargetType =
  | "object"
  | "relation"
  | "observation"
  | "metric"
  | "finance_metric"
  | "claim";

const sourceKinds = new Set<DeliverySourceKind>(["jira", "vault", "github", "teams", "email"]);
const sensitivityOrder: readonly SensitivityTier[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const sourceKind = (value: string): DeliverySourceKind =>
  sourceKinds.has(value as DeliverySourceKind) ? (value as DeliverySourceKind) : "vault";

const sensitivity = (value: string): SensitivityTier =>
  sensitivityOrder.includes(value as SensitivityTier) ? (value as SensitivityTier) : "restricted";

const lifecycleState = (value: string | null): DeliveryLifecycleState | undefined => {
  if (value === null) return undefined;
  const normalized = value.toLowerCase();
  if (/block|imped|stuck/.test(normalized)) return "blocked";
  if (/cancel|abandon|declin/.test(normalized)) return "canceled";
  if (/done|complete|delivered|released|resolved|closed/.test(normalized)) return "done";
  if (/progress|active|underway|ongoing|review|testing/.test(normalized)) return "active";
  if (/plan|ready|todo|to do|backlog|open/.test(normalized)) return "planned";
  return "unknown";
};

const allowedSensitivities = (maximum: SensitivityTier): readonly SensitivityTier[] =>
  sensitivityOrder.slice(0, sensitivityOrder.indexOf(maximum) + 1);

const matchValue = (actual: unknown, predicate: DeliveryQueryPredicate): boolean => {
  if (predicate.operator === "exists") return actual !== undefined && actual !== null;
  if (predicate.operator === "equals") return String(actual) === String(predicate.value);
  if (predicate.operator === "contains")
    return String(actual).toLowerCase().includes(String(predicate.value).toLowerCase());
  const expected = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
  if (Array.isArray(actual)) return actual.some((entry) => expected.includes(String(entry)));
  return expected.includes(String(actual));
};

const matchesPredicates = (
  values: Readonly<Record<string, unknown>>,
  predicates: readonly DeliveryQueryPredicate[] | undefined,
): boolean =>
  predicates?.every((predicate) => matchValue(values[predicate.field], predicate)) ?? true;

const severityRank: Readonly<Record<string, number>> = {
  critical: 5,
  highest: 5,
  high: 4,
  major: 4,
  medium: 3,
  moderate: 3,
  low: 2,
  minor: 2,
  lowest: 1,
};

const comparableValue = (value: unknown): number | string => {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  const severity = severityRank[text];
  if (severity !== undefined) return severity;
  const timestamp = Date.parse(text);
  if (text !== "" && Number.isFinite(timestamp)) return timestamp;
  const number = Number(text);
  return text !== "" && Number.isFinite(number) ? number : text;
};

const orderForOperation = <Row>(
  rows: readonly Row[],
  operation: DeliveryQueryOperation,
  values: (row: Row) => Readonly<Record<string, unknown>>,
): readonly Row[] => {
  if (operation.orderBy === undefined) return rows;
  const { field, direction } = operation.orderBy;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = comparableValue(values(left)[field]);
    const rightValue = comparableValue(values(right)[field]);
    if (typeof leftValue === "number" && typeof rightValue === "number")
      return (leftValue - rightValue) * multiplier;
    return String(leftValue).localeCompare(String(rightValue)) * multiplier;
  });
};

const operationWindow = (operation: DeliveryQueryOperation, context: DeliveryQueryContext) => {
  if (operation.time === undefined || operation.time.kind === "jira_sprint") return undefined;
  return resolveDeliveryTimeConstraint(operation.time, context.requestedAt, context.timeZone);
};

const timeConditions = (
  column: AnyPgColumn,
  operation: DeliveryQueryOperation,
  context: DeliveryQueryContext,
): readonly SQL[] => {
  const window = operationWindow(operation, context);
  return window === undefined
    ? []
    : [gte(column, window.fromInclusive), lt(column, window.toExclusive)];
};

const loadAuthorizedIds = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  targetTypes: readonly DeliveryTargetType[],
): Promise<ReadonlyMap<DeliveryTargetType, ReadonlySet<string>>> => {
  const rows = await database
    .select({
      targetType: deliveryAclBindingTable.targetType,
      targetId: deliveryAclBindingTable.targetId,
      effect: deliveryAclBindingTable.effect,
    })
    .from(deliveryAclBindingTable)
    .where(
      and(
        eq(deliveryAclBindingTable.workspaceId, context.workspaceId),
        inArray(deliveryAclBindingTable.targetType, targetTypes),
        or(
          and(
            eq(deliveryAclBindingTable.subjectType, "workspace"),
            eq(deliveryAclBindingTable.subjectId, context.workspaceId),
          ),
          and(
            eq(deliveryAclBindingTable.subjectType, "actor"),
            eq(deliveryAclBindingTable.subjectId, context.actorId),
          ),
        ),
      ),
    );
  const allowed = new Map<DeliveryTargetType, Set<string>>();
  const denied = new Set<string>();
  for (const row of rows) {
    if (!targetTypes.includes(row.targetType as DeliveryTargetType)) continue;
    const targetType = row.targetType as DeliveryTargetType;
    const key = `${targetType}\u0000${row.targetId}`;
    if (row.effect === "deny") denied.add(key);
    if (row.effect === "allow") {
      const ids = allowed.get(targetType) ?? new Set<string>();
      ids.add(row.targetId);
      allowed.set(targetType, ids);
    }
  }
  for (const [targetType, ids] of allowed)
    for (const id of ids) if (denied.has(`${targetType}\u0000${id}`)) ids.delete(id);
  return allowed;
};

const result = (
  items: readonly DeliveryResultItem[],
  conflicts: DeliveryQueryResult["conflicts"] = [],
): DeliveryQueryResult => ({
  items,
  conflicts,
  unavailableSources: [],
  complete: true,
});

const queryObjects = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  authorized: ReadonlySet<string>,
): Promise<DeliveryQueryResult> => {
  if (authorized.size === 0) return result([]);
  const rows = await database
    .select({
      id: deliveryObjectTable.id,
      workspaceId: deliveryObjectTable.workspaceId,
      objectKind: deliveryObjectTable.objectKind,
      externalKey: deliveryObjectTable.externalKey,
      title: deliveryObjectTable.title,
      lifecycleState: deliveryObjectTable.lifecycleState,
      attributes: deliveryObjectTable.attributes,
      sensitivity: deliveryObjectTable.sensitivity,
      sourceKind: deliveryObjectTable.sourceKind,
      observedAt: deliveryObjectTable.observedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryObjectTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryObjectTable.sourceItemId))
    .where(
      and(
        eq(deliveryObjectTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        inArray(deliveryObjectTable.id, [...authorized]),
        inArray(deliveryObjectTable.sensitivity, allowedSensitivities(context.maximumSensitivity)),
        eq(deliveryObjectTable.active, true),
        isNull(deliveryObjectTable.deletedAt),
        isNull(knowledgeItemTable.deletedAt),
        ...(operation.objectKinds === undefined
          ? []
          : [inArray(deliveryObjectTable.objectKind, operation.objectKinds)]),
        ...timeConditions(deliveryObjectTable.observedAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryObjectTable.observedAt), asc(deliveryObjectTable.externalKey))
    .limit(Math.min(operation.limit * 4, 80));
  const filtered = rows.filter((row) =>
    matchesPredicates(
      {
        kind: row.objectKind,
        title: row.title,
        externalKey: row.externalKey,
        lifecycleState: row.lifecycleState,
        source: row.sourceKind,
        ...row.attributes,
      },
      operation.predicates,
    ),
  );
  return result(
    orderForOperation(filtered, operation, (row) => ({
      kind: row.objectKind,
      title: row.title,
      externalKey: row.externalKey,
      lifecycleState: row.lifecycleState,
      source: row.sourceKind,
      ...row.attributes,
    }))
      .slice(0, operation.limit)
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        source: sourceKind(row.sourceKind),
        selector: "objects" as const,
        intent: operation.purpose,
        title: row.title,
        summary:
          typeof row.attributes.summary === "string" && row.attributes.summary.trim() !== ""
            ? row.attributes.summary.trim()
            : `${row.externalKey}: ${row.title}${row.lifecycleState === null ? "" : ` — ${row.lifecycleState}`}`,
        citationUrl: row.canonicalUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.observedAt,
        lifecycleState: lifecycleState(row.lifecycleState),
        dedupeKey: `${row.externalKey}:${row.lifecycleState ?? ""}`,
      })),
  );
};

const queryRelations = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  authorized: ReadonlySet<string>,
  authorizedObjects: ReadonlySet<string>,
): Promise<DeliveryQueryResult> => {
  if (authorized.size === 0) return result([]);
  const rows = await database
    .select({
      id: deliveryRelationTable.id,
      workspaceId: deliveryRelationTable.workspaceId,
      relationKind: deliveryRelationTable.relationKind,
      fromObjectId: deliveryRelationTable.fromObjectId,
      toObjectId: deliveryRelationTable.toObjectId,
      attributes: deliveryRelationTable.attributes,
      sensitivity: deliveryRelationTable.sensitivity,
      sourceKind: deliveryRelationTable.sourceKind,
      observedAt: deliveryRelationTable.observedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryRelationTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryRelationTable.sourceItemId))
    .where(
      and(
        eq(deliveryRelationTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        inArray(deliveryRelationTable.id, [...authorized]),
        inArray(
          deliveryRelationTable.sensitivity,
          allowedSensitivities(context.maximumSensitivity),
        ),
        eq(deliveryRelationTable.active, true),
        isNull(deliveryRelationTable.deletedAt),
        isNull(knowledgeItemTable.deletedAt),
        ...(operation.relationKinds === undefined
          ? []
          : [inArray(deliveryRelationTable.relationKind, operation.relationKinds)]),
        ...timeConditions(deliveryRelationTable.observedAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryRelationTable.observedAt), asc(deliveryRelationTable.id))
    .limit(Math.min(operation.limit * 4, 80));
  const objectIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.fromObjectId, row.toObjectId])
        .filter((id) => authorizedObjects.has(id)),
    ),
  ];
  const objectRows =
    objectIds.length === 0
      ? []
      : await database
          .select({
            id: deliveryObjectTable.id,
            externalKey: deliveryObjectTable.externalKey,
            title: deliveryObjectTable.title,
          })
          .from(deliveryObjectTable)
          .where(
            and(
              eq(deliveryObjectTable.workspaceId, context.workspaceId),
              inArray(deliveryObjectTable.id, objectIds),
              inArray(
                deliveryObjectTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryObjectTable.active, true),
              isNull(deliveryObjectTable.deletedAt),
            ),
          );
  const objects = new Map(objectRows.map((row) => [row.id, `${row.externalKey}: ${row.title}`]));
  return result(
    rows
      .filter(
        (row) =>
          objects.has(row.fromObjectId) &&
          objects.has(row.toObjectId) &&
          matchesPredicates(
            {
              kind: row.relationKind,
              source: row.sourceKind,
              ...row.attributes,
            },
            operation.predicates,
          ),
      )
      .slice(0, operation.limit)
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        source: sourceKind(row.sourceKind),
        selector: "relations" as const,
        intent: operation.purpose,
        title: row.relationKind,
        summary: `${objects.get(row.fromObjectId)} ${row.relationKind.replaceAll("_", " ")} ${objects.get(row.toObjectId)}`,
        citationUrl: row.canonicalUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.observedAt,
        dedupeKey: `${row.fromObjectId}:${row.relationKind}:${row.toObjectId}`,
      })),
  );
};

const queryObservations = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  authorized: ReadonlySet<string>,
): Promise<DeliveryQueryResult> => {
  if (authorized.size === 0) return result([]);
  const rows = await database
    .select()
    .from(deliveryObservationTable)
    .where(
      and(
        eq(deliveryObservationTable.workspaceId, context.workspaceId),
        inArray(deliveryObservationTable.id, [...authorized]),
        inArray(
          deliveryObservationTable.sensitivity,
          allowedSensitivities(context.maximumSensitivity),
        ),
        eq(deliveryObservationTable.active, true),
        isNull(deliveryObservationTable.deletedAt),
        ...timeConditions(deliveryObservationTable.occurredAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryObservationTable.occurredAt), asc(deliveryObservationTable.id))
    .limit(Math.min(operation.limit * 8, 120));
  const filtered = rows.filter((row) =>
    matchesPredicates(
      {
        kind: row.observationKind,
        source: row.sourceKind,
        dedupeKey: row.dedupeKey,
        observedAt: row.observedAt,
      },
      operation.predicates,
    ),
  );
  const minimumOccurrences = operation.measures?.find(
    (measure) => measure.operator === "count",
  )?.minimumOccurrences;
  const counts = new Map<string, number>();
  for (const row of filtered) counts.set(row.dedupeKey, (counts.get(row.dedupeKey) ?? 0) + 1);
  return result(
    filtered
      .filter(
        (row) =>
          minimumOccurrences === undefined ||
          (counts.get(row.dedupeKey) ?? 0) >= minimumOccurrences,
      )
      .filter((row, index, values) =>
        operation.groupBy?.includes("dedupeKey") === true
          ? values.findIndex((candidate) => candidate.dedupeKey === row.dedupeKey) === index
          : true,
      )
      .slice(0, operation.limit)
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        source: sourceKind(row.sourceKind),
        selector: "observations" as const,
        intent: operation.purpose,
        title: row.observationKind,
        summary: `${row.summary}${minimumOccurrences === undefined ? "" : ` (${counts.get(row.dedupeKey)} occurrences)`}`,
        citationUrl: row.citationUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.occurredAt,
        dedupeKey: row.dedupeKey,
      })),
  );
};

const mapClaim = (row: typeof deliveryClaimTable.$inferSelect): DeliveryClaim => ({
  id: row.id,
  workspaceId: row.workspaceId,
  subjectKey: row.subjectKey,
  predicate: row.predicate,
  value: row.value as DeliveryClaim["value"],
  valueHash: row.valueHash,
  assertedBy: row.assertedBy ?? undefined,
  authority: row.authority,
  sensitivity: sensitivity(row.sensitivity),
  source: {
    source: sourceKind(row.sourceKind),
    sourceId: row.sourceId,
    sourceItemId: row.sourceItemId,
    sourceVersionId: row.sourceVersionId,
    citationUrl: row.citationUrl,
  },
  observedAt: row.observedAt,
  effectiveFrom: row.effectiveFrom ?? undefined,
  effectiveTo: row.effectiveTo ?? undefined,
  active: row.active,
  deleted: row.deletedAt !== null,
});

const queryClaims = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  authorized: ReadonlySet<string>,
  conflictsOnly: boolean,
): Promise<DeliveryQueryResult> => {
  if (authorized.size === 0) return result([]);
  const rows = await database
    .select()
    .from(deliveryClaimTable)
    .where(
      and(
        eq(deliveryClaimTable.workspaceId, context.workspaceId),
        inArray(deliveryClaimTable.id, [...authorized]),
        inArray(deliveryClaimTable.sensitivity, allowedSensitivities(context.maximumSensitivity)),
        eq(deliveryClaimTable.active, true),
        isNull(deliveryClaimTable.deletedAt),
        ...timeConditions(deliveryClaimTable.observedAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryClaimTable.authority), desc(deliveryClaimTable.observedAt))
    .limit(Math.min(operation.limit * 8, 120));
  const claims = rows
    .filter((row) =>
      matchesPredicates(
        {
          subjectKey: row.subjectKey,
          predicate: row.predicate,
          source: row.sourceKind,
          observedAt: row.observedAt,
        },
        operation.predicates,
      ),
    )
    .map(mapClaim);
  const conflicts = findDeliveryConflicts(claims).slice(0, operation.limit);
  if (conflictsOnly) return result([], conflicts);
  return result(
    claims.slice(0, operation.limit).map((claim) => ({
      id: claim.id,
      workspaceId: claim.workspaceId,
      source: claim.source.source,
      selector: "claims" as const,
      intent: operation.purpose,
      title: `${claim.subjectKey} ${claim.predicate}`,
      summary: `${claim.subjectKey} ${claim.predicate}: ${String(claim.value)}`,
      citationUrl: claim.source.citationUrl,
      sensitivity: claim.sensitivity,
      authority: claim.authority,
      observedAt: claim.observedAt,
      dedupeKey: `${claim.subjectKey}:${claim.predicate}:${claim.valueHash}`,
    })),
    conflicts,
  );
};

const queryMetrics = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  authorized: ReadonlySet<string>,
  finance: boolean,
): Promise<DeliveryQueryResult> => {
  if (authorized.size === 0) return result([]);
  if (finance) {
    if (!context.financeAccess) return result([]);
    const rows = await database
      .select({
        id: deliveryFinanceMetricTable.id,
        workspaceId: deliveryFinanceMetricTable.workspaceId,
        metricKind: deliveryFinanceMetricTable.metricKind,
        value: deliveryFinanceMetricTable.value,
        unit: deliveryFinanceMetricTable.unit,
        sensitivity: deliveryFinanceMetricTable.sensitivity,
        sourceKind: deliveryFinanceMetricTable.sourceKind,
        observedAt: deliveryFinanceMetricTable.observedAt,
        canonicalUrl: knowledgeItemTable.canonicalUrl,
        authority: knowledgeItemTable.authority,
      })
      .from(deliveryFinanceMetricTable)
      .innerJoin(
        knowledgeItemTable,
        eq(knowledgeItemTable.id, deliveryFinanceMetricTable.sourceItemId),
      )
      .where(
        and(
          eq(deliveryFinanceMetricTable.workspaceId, context.workspaceId),
          eq(knowledgeItemTable.workspaceId, context.workspaceId),
          inArray(deliveryFinanceMetricTable.id, [...authorized]),
          inArray(
            deliveryFinanceMetricTable.sensitivity,
            allowedSensitivities(context.maximumSensitivity),
          ),
          eq(deliveryFinanceMetricTable.active, true),
          isNull(deliveryFinanceMetricTable.deletedAt),
          isNull(knowledgeItemTable.deletedAt),
          ...timeConditions(deliveryFinanceMetricTable.observedAt, operation, context),
        ),
      )
      .orderBy(desc(deliveryFinanceMetricTable.observedAt))
      .limit(operation.limit);
    return result(
      rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        source: sourceKind(row.sourceKind),
        selector: "metrics" as const,
        intent: operation.purpose,
        title: row.metricKind,
        summary: `${row.metricKind}: ${row.value} ${row.unit}`,
        citationUrl: row.canonicalUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.observedAt,
        dedupeKey: `${row.metricKind}:${row.value}:${row.unit}`,
      })),
    );
  }
  const rows = await database
    .select({
      id: deliveryMetricTable.id,
      workspaceId: deliveryMetricTable.workspaceId,
      metricCategory: deliveryMetricTable.metricCategory,
      metricKind: deliveryMetricTable.metricKind,
      value: deliveryMetricTable.value,
      unit: deliveryMetricTable.unit,
      sensitivity: deliveryMetricTable.sensitivity,
      sourceKind: deliveryMetricTable.sourceKind,
      observedAt: deliveryMetricTable.observedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryMetricTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryMetricTable.sourceItemId))
    .where(
      and(
        eq(deliveryMetricTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        inArray(deliveryMetricTable.id, [...authorized]),
        inArray(deliveryMetricTable.sensitivity, allowedSensitivities(context.maximumSensitivity)),
        eq(deliveryMetricTable.active, true),
        isNull(deliveryMetricTable.deletedAt),
        isNull(knowledgeItemTable.deletedAt),
        ...(operation.metricCategories === undefined
          ? []
          : [
              inArray(
                deliveryMetricTable.metricCategory,
                operation.metricCategories.filter((category) => category !== "finance"),
              ),
            ]),
        ...timeConditions(deliveryMetricTable.observedAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryMetricTable.observedAt))
    .limit(operation.limit);
  return result(
    rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      source: sourceKind(row.sourceKind),
      selector: "metrics" as const,
      intent: operation.purpose,
      title: row.metricKind,
      summary: `${row.metricKind}: ${row.value} ${row.unit}`,
      citationUrl: row.canonicalUrl,
      sensitivity: sensitivity(row.sensitivity),
      authority: row.authority,
      observedAt: row.observedAt,
      dedupeKey: `${row.metricCategory}:${row.metricKind}:${row.value}:${row.unit}`,
    })),
  );
};

export const createPostgresDeliveryQuerySource = (
  database: KnowledgePostgresDatabase,
): DeliveryQuerySource => ({
  source: "projection",
  selectors: ["objects", "relations", "observations", "claims", "metrics", "conflicts"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        const authorized = await loadAuthorizedIds(database, context, [
          "object",
          "relation",
          "observation",
          "metric",
          ...(context.financeAccess && plan.requiresFinance ? (["finance_metric"] as const) : []),
          "claim",
        ]);
        const results: DeliveryQueryResult[] = [];
        for (const operation of plan.operations) {
          if (operation.select === "objects")
            results.push(
              await queryObjects(
                database,
                context,
                operation,
                authorized.get("object") ?? new Set(),
              ),
            );
          if (operation.select === "relations")
            results.push(
              await queryRelations(
                database,
                context,
                operation,
                authorized.get("relation") ?? new Set(),
                authorized.get("object") ?? new Set(),
              ),
            );
          if (operation.select === "observations")
            results.push(
              await queryObservations(
                database,
                context,
                operation,
                authorized.get("observation") ?? new Set(),
              ),
            );
          if (operation.select === "claims" || operation.select === "conflicts")
            results.push(
              await queryClaims(
                database,
                context,
                operation,
                authorized.get("claim") ?? new Set(),
                operation.select === "conflicts",
              ),
            );
          if (operation.select === "metrics") {
            const finance = operation.metricCategories?.includes("finance") === true;
            results.push(
              await queryMetrics(
                database,
                context,
                operation,
                authorized.get(finance ? "finance_metric" : "metric") ?? new Set(),
                finance,
              ),
            );
          }
        }
        return {
          items: results.flatMap((entry) => entry.items),
          conflicts: results.flatMap((entry) => entry.conflicts),
          unavailableSources: [],
          complete: true,
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Delivery intelligence projection is unavailable.",
          operation: "delivery-projection-query",
        }),
    }),
});
