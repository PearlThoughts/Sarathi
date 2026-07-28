import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryClaim,
  type DeliveryEntityCatalog,
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQueryPredicate,
  type DeliveryQueryResult,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  type DeliverySourceKind,
  findDeliveryConflicts,
  normalizeDeliveryEntityAlias,
  resolveDeliveryEntity,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  deliveryAclBindingTable,
  deliveryClaimTable,
  deliveryEntityAliasTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
  knowledgeItemTable,
  knowledgeSourceTable,
  knowledgeSyncCheckpointTable,
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

const sourceVerificationTimes = async (
  database: KnowledgePostgresDatabase,
  workspaceId: string,
): Promise<ReadonlyMap<DeliverySourceKind, string>> => {
  const rows = await database
    .select({
      sourceKind: knowledgeSourceTable.kind,
      lastSucceededAt: knowledgeSyncCheckpointTable.lastSucceededAt,
    })
    .from(knowledgeSourceTable)
    .innerJoin(
      knowledgeSyncCheckpointTable,
      and(
        eq(knowledgeSyncCheckpointTable.sourceId, knowledgeSourceTable.id),
        eq(knowledgeSyncCheckpointTable.workspaceId, knowledgeSourceTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(knowledgeSourceTable.workspaceId, workspaceId),
        eq(knowledgeSourceTable.active, true),
        eq(knowledgeSyncCheckpointTable.status, "succeeded"),
      ),
    );
  const verifiedAt = new Map<DeliverySourceKind, string>();
  for (const row of rows) {
    if (row.lastSucceededAt === null || !sourceKinds.has(row.sourceKind as DeliverySourceKind))
      continue;
    const kind = row.sourceKind as DeliverySourceKind;
    const previous = verifiedAt.get(kind);
    if (previous === undefined || Date.parse(row.lastSucceededAt) < Date.parse(previous))
      verifiedAt.set(kind, row.lastSucceededAt);
  }
  return verifiedAt;
};

const allowedSensitivities = (maximum: SensitivityTier): readonly SensitivityTier[] =>
  sensitivityOrder.slice(0, sensitivityOrder.indexOf(maximum) + 1);

const matchValue = (actual: unknown, predicate: DeliveryQueryPredicate): boolean => {
  if (predicate.operator === "exists") return actual !== undefined && actual !== null;
  if (Array.isArray(actual)) return actual.some((entry) => matchValue(entry, predicate));
  if (predicate.operator === "equals") return String(actual) === String(predicate.value);
  if (predicate.operator === "contains")
    return String(actual).toLowerCase().includes(String(predicate.value).toLowerCase());
  const expected = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
  return expected.includes(String(actual));
};

const matchesPredicates = (
  values: Readonly<Record<string, unknown>>,
  predicates: readonly DeliveryQueryPredicate[] | undefined,
): boolean =>
  predicates?.every((predicate) => matchValue(values[predicate.field], predicate)) ?? true;

const predicateValues = (predicate: DeliveryQueryPredicate): readonly string[] =>
  (Array.isArray(predicate.value) ? predicate.value : [predicate.value])
    .filter((value): value is string | number | boolean => value !== undefined)
    .map(String);

const equalityCondition = (
  column: AnyPgColumn,
  predicate: DeliveryQueryPredicate,
): SQL | undefined => {
  const values = predicateValues(predicate);
  if (values.length === 0) return undefined;
  if (predicate.operator === "equals") return eq(column, values[0]);
  if (predicate.operator === "in") return inArray(column, values);
  return undefined;
};

const escapedLikeValue = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const objectSqlConditions = (
  operation: DeliveryQueryOperation,
  aliasMatchedIds: readonly string[],
): readonly SQL[] =>
  (operation.predicates ?? []).flatMap((predicate): readonly SQL[] => {
    if (predicate.field === "kind") {
      const condition = equalityCondition(deliveryObjectTable.objectKind, predicate);
      return condition === undefined ? [] : [condition];
    }
    if (predicate.field === "externalKey") {
      const condition = equalityCondition(deliveryObjectTable.externalKey, predicate);
      return condition === undefined ? [] : [condition];
    }
    if (predicate.field === "lifecycleState") {
      const condition = equalityCondition(deliveryObjectTable.lifecycleState, predicate);
      return condition === undefined ? [] : [condition];
    }
    if (predicate.field === "source") {
      const condition = equalityCondition(deliveryObjectTable.sourceKind, predicate);
      return condition === undefined ? [] : [condition];
    }
    if (predicate.field !== "title") return [];
    const values = predicateValues(predicate);
    const titleCondition =
      predicate.operator === "contains" && values[0] !== undefined
        ? ilike(deliveryObjectTable.title, `%${escapedLikeValue(values[0])}%`)
        : equalityCondition(deliveryObjectTable.title, predicate);
    if (titleCondition === undefined) return [];
    return aliasMatchedIds.length === 0
      ? [titleCondition]
      : [or(titleCondition, inArray(deliveryObjectTable.id, aliasMatchedIds)) as SQL];
  });

const observationSqlConditions = (operation: DeliveryQueryOperation): readonly SQL[] =>
  (operation.predicates ?? []).flatMap((predicate): readonly SQL[] => {
    const column =
      predicate.field === "kind"
        ? deliveryObservationTable.observationKind
        : predicate.field === "source"
          ? deliveryObservationTable.sourceKind
          : predicate.field === "dedupeKey"
            ? deliveryObservationTable.dedupeKey
            : undefined;
    if (column === undefined) return [];
    const values = predicateValues(predicate);
    if (predicate.operator === "contains" && values[0] !== undefined)
      return [ilike(column, `%${escapedLikeValue(values[0])}%`)];
    const condition = equalityCondition(column, predicate);
    return condition === undefined ? [] : [condition];
  });

const implementationRepositoryCondition = (
  operation: DeliveryQueryOperation,
  entityCatalog: DeliveryEntityCatalog | undefined,
): SQL | undefined => {
  if (operation.purpose !== "implementation") return undefined;
  const target = operation.predicates?.find(
    ({ field, operator }) => field === "title" && operator === "contains",
  )?.value;
  if (typeof target !== "string") return undefined;
  const normalizedTarget = normalizeDeliveryEntityAlias(target);
  const definition = entityCatalog?.entities.find(
    (entity) =>
      entity.kind === "module" &&
      [entity.canonicalKey, entity.title, ...entity.aliases.map(({ value }) => value)].some(
        (candidate) => normalizeDeliveryEntityAlias(candidate) === normalizedTarget,
      ),
  );
  const repositories =
    definition?.aliases
      .filter(({ source }) => source === "github")
      .map(({ value }) => value.trim())
      .filter((value) => value !== "") ?? [];
  const conditions = repositories.map((repository) =>
    ilike(deliveryObservationTable.dedupeKey, `github:${escapedLikeValue(repository)}:%`),
  );
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : or(...conditions);
};

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
  if (
    operation.time === undefined ||
    operation.time.kind === "jira_sprint" ||
    operation.time.kind === "release"
  )
    return undefined;
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

const authorizationCondition = (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  targetType: DeliveryTargetType,
  targetId: AnyPgColumn,
): SQL => {
  const audienceIds = context.audienceIds ?? [];
  const relevantSubject = or(
    and(
      eq(deliveryAclBindingTable.subjectType, "workspace"),
      eq(deliveryAclBindingTable.subjectId, context.workspaceId),
    ),
    and(
      eq(deliveryAclBindingTable.subjectType, "actor"),
      eq(deliveryAclBindingTable.subjectId, context.actorId),
    ),
    ...(audienceIds.length === 0
      ? []
      : [
          and(
            eq(deliveryAclBindingTable.subjectType, "audience"),
            inArray(deliveryAclBindingTable.subjectId, audienceIds),
          ),
        ]),
  );
  const bindingsFor = (effect: "allow" | "deny") =>
    database
      .select({ id: deliveryAclBindingTable.id })
      .from(deliveryAclBindingTable)
      .where(
        and(
          eq(deliveryAclBindingTable.workspaceId, context.workspaceId),
          eq(deliveryAclBindingTable.targetType, targetType),
          eq(deliveryAclBindingTable.targetId, targetId),
          eq(deliveryAclBindingTable.effect, effect),
          relevantSubject,
        ),
      );
  return and(exists(bindingsFor("allow")), notExists(bindingsFor("deny"))) as SQL;
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
): Promise<DeliveryQueryResult> => {
  const titlePredicates = (operation.predicates ?? []).filter(
    ({ field, operator }) =>
      field === "title" && (operator === "equals" || operator === "contains"),
  );
  const aliasMatchedIds =
    titlePredicates.length === 0
      ? []
      : (
          await database
            .select({ sourceObjectId: deliveryEntityAliasTable.sourceObjectId })
            .from(deliveryEntityAliasTable)
            .where(
              and(
                eq(deliveryEntityAliasTable.workspaceId, context.workspaceId),
                authorizationCondition(
                  database,
                  context,
                  "object",
                  deliveryEntityAliasTable.sourceObjectId,
                ),
                inArray(
                  deliveryEntityAliasTable.sensitivity,
                  allowedSensitivities(context.maximumSensitivity),
                ),
                eq(deliveryEntityAliasTable.active, true),
                isNull(deliveryEntityAliasTable.deletedAt),
                ...titlePredicates.flatMap((predicate): readonly SQL[] => {
                  const values = predicateValues(predicate);
                  if (values[0] === undefined) return [];
                  return [
                    predicate.operator === "contains"
                      ? ilike(deliveryEntityAliasTable.alias, `%${escapedLikeValue(values[0])}%`)
                      : eq(deliveryEntityAliasTable.alias, values[0]),
                  ];
                }),
              ),
            )
        ).map(({ sourceObjectId }) => sourceObjectId);
  const rows = await database
    .select({
      id: deliveryObjectTable.id,
      workspaceId: deliveryObjectTable.workspaceId,
      objectKind: deliveryObjectTable.objectKind,
      externalKey: deliveryObjectTable.externalKey,
      canonicalKey: deliveryObjectTable.canonicalKey,
      title: deliveryObjectTable.title,
      lifecycleState: deliveryObjectTable.lifecycleState,
      attributes: deliveryObjectTable.attributes,
      sensitivity: deliveryObjectTable.sensitivity,
      sourceKind: deliveryObjectTable.sourceKind,
      sourceCreatedAt: deliveryObjectTable.sourceCreatedAt,
      sourceUpdatedAt: deliveryObjectTable.sourceUpdatedAt,
      observedAt: deliveryObjectTable.observedAt,
      indexedAt: deliveryObjectTable.indexedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryObjectTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryObjectTable.sourceItemId))
    .where(
      and(
        eq(deliveryObjectTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        authorizationCondition(database, context, "object", deliveryObjectTable.id),
        inArray(deliveryObjectTable.sensitivity, allowedSensitivities(context.maximumSensitivity)),
        eq(deliveryObjectTable.active, true),
        isNull(deliveryObjectTable.deletedAt),
        isNull(knowledgeItemTable.deletedAt),
        ...(operation.objectKinds === undefined
          ? []
          : [inArray(deliveryObjectTable.objectKind, operation.objectKinds)]),
        ...objectSqlConditions(operation, aliasMatchedIds),
        ...timeConditions(deliveryObjectTable.observedAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryObjectTable.observedAt), asc(deliveryObjectTable.externalKey))
    .limit(Math.min(operation.limit * 4, 80));
  const aliasRows =
    rows.length === 0
      ? []
      : await database
          .select({
            sourceObjectId: deliveryEntityAliasTable.sourceObjectId,
            alias: deliveryEntityAliasTable.alias,
          })
          .from(deliveryEntityAliasTable)
          .where(
            and(
              eq(deliveryEntityAliasTable.workspaceId, context.workspaceId),
              inArray(
                deliveryEntityAliasTable.sourceObjectId,
                rows.map(({ id }) => id),
              ),
              inArray(
                deliveryEntityAliasTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryEntityAliasTable.active, true),
              isNull(deliveryEntityAliasTable.deletedAt),
            ),
          );
  const aliases = new Map<string, string[]>();
  for (const alias of aliasRows) {
    const current = aliases.get(alias.sourceObjectId) ?? [];
    current.push(alias.alias);
    aliases.set(alias.sourceObjectId, current);
  }
  const filtered = rows.filter((row) =>
    matchesPredicates(
      {
        kind: row.objectKind,
        title: [row.title, ...(aliases.get(row.id) ?? [])],
        externalKey: row.externalKey,
        canonicalKey: row.canonicalKey,
        aliases: aliases.get(row.id) ?? [],
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
      canonicalKey: row.canonicalKey,
      aliases: aliases.get(row.id) ?? [],
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
        summary: `${row.externalKey}: ${row.title}${row.lifecycleState === null ? "" : ` — ${row.lifecycleState}`}`,
        citationUrl: row.canonicalUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.observedAt,
        sourceCreatedAt: row.sourceCreatedAt ?? undefined,
        sourceUpdatedAt: row.sourceUpdatedAt,
        indexedAt: row.indexedAt,
        subjectAliases: aliases.get(row.id) ?? [],
        dedupeKey:
          operation.purpose === "implementation"
            ? `${row.canonicalKey}:${row.externalKey}:${row.lifecycleState ?? ""}`
            : `${row.canonicalKey}:${row.lifecycleState ?? ""}`,
      })),
  );
};

const queryRelations = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
): Promise<DeliveryQueryResult> => {
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
      sourceCreatedAt: deliveryRelationTable.sourceCreatedAt,
      sourceUpdatedAt: deliveryRelationTable.sourceUpdatedAt,
      observedAt: deliveryRelationTable.observedAt,
      indexedAt: deliveryRelationTable.indexedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryRelationTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryRelationTable.sourceItemId))
    .where(
      and(
        eq(deliveryRelationTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        authorizationCondition(database, context, "relation", deliveryRelationTable.id),
        authorizationCondition(database, context, "object", deliveryRelationTable.fromObjectId),
        authorizationCondition(database, context, "object", deliveryRelationTable.toObjectId),
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
  const objectIds = [...new Set(rows.flatMap((row) => [row.fromObjectId, row.toObjectId]))];
  const objectRows =
    objectIds.length === 0
      ? []
      : await database
          .select({
            id: deliveryObjectTable.id,
            externalKey: deliveryObjectTable.externalKey,
            canonicalKey: deliveryObjectTable.canonicalKey,
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
  const relationAliasRows =
    objectIds.length === 0
      ? []
      : await database
          .select({
            sourceObjectId: deliveryEntityAliasTable.sourceObjectId,
            alias: deliveryEntityAliasTable.alias,
          })
          .from(deliveryEntityAliasTable)
          .where(
            and(
              eq(deliveryEntityAliasTable.workspaceId, context.workspaceId),
              inArray(deliveryEntityAliasTable.sourceObjectId, objectIds),
              inArray(
                deliveryEntityAliasTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryEntityAliasTable.active, true),
              isNull(deliveryEntityAliasTable.deletedAt),
            ),
          );
  const relationAliases = new Map<string, string[]>();
  for (const alias of relationAliasRows) {
    const current = relationAliases.get(alias.sourceObjectId) ?? [];
    current.push(alias.alias);
    relationAliases.set(alias.sourceObjectId, current);
  }
  const objects = new Map(
    objectRows.map((row) => [
      row.id,
      {
        label: `${row.externalKey}: ${row.title}`,
        canonicalKey: row.canonicalKey,
        aliases: relationAliases.get(row.id) ?? [],
      },
    ]),
  );
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
        summary: `${objects.get(row.fromObjectId)?.label} ${row.relationKind.replaceAll("_", " ")} ${objects.get(row.toObjectId)?.label}`,
        citationUrl: row.canonicalUrl,
        sensitivity: sensitivity(row.sensitivity),
        authority: row.authority,
        observedAt: row.observedAt,
        sourceCreatedAt: row.sourceCreatedAt ?? undefined,
        sourceUpdatedAt: row.sourceUpdatedAt,
        indexedAt: row.indexedAt,
        subjectAliases: [
          ...(objects.get(row.fromObjectId)?.aliases ?? []),
          ...(objects.get(row.toObjectId)?.aliases ?? []),
        ],
        dedupeKey: `${objects.get(row.fromObjectId)?.canonicalKey}:${row.relationKind}:${objects.get(row.toObjectId)?.canonicalKey}`,
      })),
  );
};

const queryObservations = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  entityCatalog: DeliveryEntityCatalog | undefined,
): Promise<DeliveryQueryResult> => {
  const isWeeklyDelivery =
    operation.purpose === "delivered" &&
    (operation.time?.kind === "workspace_week" ||
      operation.time?.kind === "workspace_previous_week");
  const isImplementation = operation.purpose === "implementation";
  const repositoryCondition = implementationRepositoryCondition(operation, entityCatalog);
  const rows = await database
    .select()
    .from(deliveryObservationTable)
    .where(
      and(
        eq(deliveryObservationTable.workspaceId, context.workspaceId),
        authorizationCondition(database, context, "observation", deliveryObservationTable.id),
        inArray(
          deliveryObservationTable.sensitivity,
          allowedSensitivities(context.maximumSensitivity),
        ),
        eq(deliveryObservationTable.active, true),
        isNull(deliveryObservationTable.deletedAt),
        ...observationSqlConditions(operation),
        ...(repositoryCondition === undefined ? [] : [repositoryCondition]),
        ...timeConditions(deliveryObservationTable.occurredAt, operation, context),
      ),
    )
    .orderBy(desc(deliveryObservationTable.occurredAt), asc(deliveryObservationTable.id))
    .limit(
      isWeeklyDelivery || isImplementation
        ? Math.min(operation.limit * 80, 400)
        : Math.min(operation.limit * 8, 120),
    );
  const prefiltered = rows.filter((row) =>
    matchesPredicates(
      {
        kind: row.observationKind,
        source: row.sourceKind,
        dedupeKey: row.dedupeKey,
        observedAt: row.observedAt,
      },
      operation.predicates?.filter(({ field }) => field !== "title"),
    ),
  );
  const subjectObjectIds = [
    ...new Set(
      prefiltered.flatMap(({ subjectObjectId }) =>
        subjectObjectId === null ? [] : [subjectObjectId],
      ),
    ),
  ];
  const subjectObjectRows =
    subjectObjectIds.length === 0
      ? []
      : await database
          .select({
            id: deliveryObjectTable.id,
            objectKind: deliveryObjectTable.objectKind,
            externalKey: deliveryObjectTable.externalKey,
            title: deliveryObjectTable.title,
            attributes: deliveryObjectTable.attributes,
            sourceKind: deliveryObjectTable.sourceKind,
            sensitivity: deliveryObjectTable.sensitivity,
          })
          .from(deliveryObjectTable)
          .where(
            and(
              eq(deliveryObjectTable.workspaceId, context.workspaceId),
              inArray(deliveryObjectTable.id, subjectObjectIds),
              authorizationCondition(database, context, "object", deliveryObjectTable.id),
              inArray(
                deliveryObjectTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryObjectTable.active, true),
              isNull(deliveryObjectTable.deletedAt),
            ),
          );
  const subjectAliasRows =
    subjectObjectIds.length === 0
      ? []
      : await database
          .select({
            sourceObjectId: deliveryEntityAliasTable.sourceObjectId,
            alias: deliveryEntityAliasTable.alias,
          })
          .from(deliveryEntityAliasTable)
          .where(
            and(
              eq(deliveryEntityAliasTable.workspaceId, context.workspaceId),
              inArray(deliveryEntityAliasTable.sourceObjectId, subjectObjectIds),
              inArray(
                deliveryEntityAliasTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryEntityAliasTable.active, true),
              isNull(deliveryEntityAliasTable.deletedAt),
            ),
          );
  const persistedSubjectAliases = new Map<string, string[]>();
  for (const alias of subjectAliasRows) {
    const current = persistedSubjectAliases.get(alias.sourceObjectId) ?? [];
    current.push(alias.alias);
    persistedSubjectAliases.set(alias.sourceObjectId, current);
  }
  const subjectAliases = new Map(
    subjectObjectRows.map((object) => {
      const repository =
        typeof object.attributes.repository === "string" ? object.attributes.repository : undefined;
      const resolved =
        object.objectKind === "module"
          ? resolveDeliveryEntity(entityCatalog, sourceKind(object.sourceKind), {
              kind: "module",
              externalKey: object.externalKey,
              title: object.title,
              attributes: object.attributes,
              sensitivity: sensitivity(object.sensitivity),
            })
          : repository === undefined
            ? undefined
            : resolveDeliveryEntity(entityCatalog, "github", {
                kind: "module",
                externalKey: repository,
                title: repository,
                attributes: { aliases: [repository] },
                sensitivity: sensitivity(object.sensitivity),
              });
      return [
        object.id,
        [
          ...new Set([
            object.externalKey,
            object.title,
            ...(persistedSubjectAliases.get(object.id) ?? []),
            ...(resolved?.aliases ?? []),
            ...(resolved === undefined ? [] : [resolved.canonicalTitle]),
          ]),
        ],
      ] as const;
    }),
  );
  const filtered = prefiltered.filter((row) =>
    matchesPredicates(
      {
        kind: row.observationKind,
        source: row.sourceKind,
        dedupeKey: row.dedupeKey,
        observedAt: row.observedAt,
        title: [
          row.summary,
          ...(row.subjectObjectId === null ? [] : (subjectAliases.get(row.subjectObjectId) ?? [])),
        ],
      },
      operation.predicates,
    ),
  );
  const actorExternalKeys = [
    ...new Set(
      filtered.flatMap(({ actorExternalKey }) =>
        actorExternalKey === null ? [] : [actorExternalKey],
      ),
    ),
  ];
  const actorRows =
    actorExternalKeys.length === 0
      ? []
      : await database
          .select({
            externalKey: deliveryObjectTable.externalKey,
            title: deliveryObjectTable.title,
            sourceKind: deliveryObjectTable.sourceKind,
            sensitivity: deliveryObjectTable.sensitivity,
          })
          .from(deliveryObjectTable)
          .where(
            and(
              eq(deliveryObjectTable.workspaceId, context.workspaceId),
              eq(deliveryObjectTable.objectKind, "person"),
              inArray(deliveryObjectTable.externalKey, actorExternalKeys),
              authorizationCondition(database, context, "object", deliveryObjectTable.id),
              inArray(
                deliveryObjectTable.sensitivity,
                allowedSensitivities(context.maximumSensitivity),
              ),
              eq(deliveryObjectTable.active, true),
              isNull(deliveryObjectTable.deletedAt),
            ),
          );
  const actors = new Map(
    actorRows.map((actor) => {
      const source = sourceKind(actor.sourceKind);
      const sourcePrefix = `${source}:`;
      const sourceExternalKey = actor.externalKey.startsWith(sourcePrefix)
        ? actor.externalKey.slice(sourcePrefix.length)
        : actor.externalKey;
      const resolved = resolveDeliveryEntity(entityCatalog, source, {
        kind: "person",
        externalKey: actor.externalKey,
        title: actor.title,
        attributes: { aliases: [sourceExternalKey, actor.title] },
        sensitivity: sensitivity(actor.sensitivity),
      });
      return [
        actor.externalKey,
        {
          source,
          externalId: actor.externalKey,
          displayName: resolved.canonicalTitle,
        },
      ] as const;
    }),
  );
  const minimumOccurrences = operation.measures?.find(
    (measure) => measure.operator === "count",
  )?.minimumOccurrences;
  const counts = new Map<string, number>();
  for (const row of filtered) counts.set(row.dedupeKey, (counts.get(row.dedupeKey) ?? 0) + 1);
  const eligible = filtered
    .filter(
      (row) =>
        minimumOccurrences === undefined || (counts.get(row.dedupeKey) ?? 0) >= minimumOccurrences,
    )
    .filter((row, index, values) =>
      operation.groupBy?.includes("dedupeKey") === true
        ? values.findIndex((candidate) => candidate.dedupeKey === row.dedupeKey) === index
        : true,
    );
  const selected = isWeeklyDelivery
    ? (() => {
        const ownerRepresentatives = new Map<string, (typeof eligible)[number]>();
        for (const row of eligible) {
          if (row.actorExternalKey === null || !actors.has(row.actorExternalKey)) continue;
          if (!ownerRepresentatives.has(row.actorExternalKey))
            ownerRepresentatives.set(row.actorExternalKey, row);
        }
        const representatives = [...ownerRepresentatives.values()];
        const representativeIds = new Set(representatives.map(({ id }) => id));
        return [
          ...representatives,
          ...eligible.filter(({ id }) => !representativeIds.has(id)),
        ].slice(0, operation.limit);
      })()
    : eligible.slice(0, operation.limit);
  return result(
    selected.map((row) => ({
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
      sourceCreatedAt: row.sourceCreatedAt ?? undefined,
      sourceUpdatedAt: row.sourceUpdatedAt,
      indexedAt: row.indexedAt,
      owner: row.actorExternalKey === null ? undefined : actors.get(row.actorExternalKey),
      subjectAliases:
        row.subjectObjectId === null ? undefined : subjectAliases.get(row.subjectObjectId),
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
  externalAssertionId: row.externalAssertionId ?? undefined,
  supersedesAssertionIds: row.supersedesAssertionIds,
  confidence: row.confidence ?? undefined,
  assertionSchemaVersion: row.assertionSchemaVersion ?? undefined,
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
  sourceCreatedAt: row.sourceCreatedAt ?? undefined,
  sourceUpdatedAt: row.sourceUpdatedAt,
  indexedAt: row.indexedAt,
  effectiveFrom: row.effectiveFrom ?? undefined,
  effectiveTo: row.effectiveTo ?? undefined,
  active: row.active,
  deleted: row.deletedAt !== null,
});

const queryClaims = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  conflictsOnly: boolean,
): Promise<DeliveryQueryResult> => {
  const [rows, supersessionRows] = await Promise.all([
    database
      .select()
      .from(deliveryClaimTable)
      .where(
        and(
          eq(deliveryClaimTable.workspaceId, context.workspaceId),
          authorizationCondition(database, context, "claim", deliveryClaimTable.id),
          inArray(deliveryClaimTable.sensitivity, allowedSensitivities(context.maximumSensitivity)),
          eq(deliveryClaimTable.active, true),
          isNull(deliveryClaimTable.deletedAt),
          or(
            isNull(deliveryClaimTable.effectiveFrom),
            lte(deliveryClaimTable.effectiveFrom, context.requestedAt),
          ),
          or(
            isNull(deliveryClaimTable.effectiveTo),
            gt(deliveryClaimTable.effectiveTo, context.requestedAt),
          ),
          ...timeConditions(deliveryClaimTable.observedAt, operation, context),
        ),
      )
      .orderBy(
        desc(deliveryClaimTable.authority),
        desc(deliveryClaimTable.confidence),
        desc(deliveryClaimTable.observedAt),
      )
      .limit(Math.min(operation.limit * 8, 120)),
    database
      .select({
        subjectKey: deliveryClaimTable.subjectKey,
        predicate: deliveryClaimTable.predicate,
        supersedesAssertionIds: deliveryClaimTable.supersedesAssertionIds,
      })
      .from(deliveryClaimTable)
      .where(
        and(
          eq(deliveryClaimTable.workspaceId, context.workspaceId),
          authorizationCondition(database, context, "claim", deliveryClaimTable.id),
          eq(deliveryClaimTable.active, true),
          isNull(deliveryClaimTable.deletedAt),
          or(
            isNull(deliveryClaimTable.effectiveFrom),
            lte(deliveryClaimTable.effectiveFrom, context.requestedAt),
          ),
          or(
            isNull(deliveryClaimTable.effectiveTo),
            gt(deliveryClaimTable.effectiveTo, context.requestedAt),
          ),
        ),
      ),
  ]);
  const globallySuperseded = new Set(
    supersessionRows.flatMap(({ subjectKey, predicate, supersedesAssertionIds }) =>
      supersedesAssertionIds.map(
        (assertionId) => `${subjectKey}\u0000${predicate}\u0000${assertionId}`,
      ),
    ),
  );
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
    .filter(
      (row) =>
        row.externalAssertionId === null ||
        !globallySuperseded.has(
          `${row.subjectKey}\u0000${row.predicate}\u0000${row.externalAssertionId}`,
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
      sourceCreatedAt: claim.sourceCreatedAt,
      sourceUpdatedAt: claim.sourceUpdatedAt,
      indexedAt: claim.indexedAt,
      dedupeKey: `${claim.subjectKey}:${claim.predicate}:${claim.valueHash}`,
    })),
    conflicts,
  );
};

const queryMetrics = async (
  database: KnowledgePostgresDatabase,
  context: DeliveryQueryContext,
  operation: DeliveryQueryOperation,
  finance: boolean,
): Promise<DeliveryQueryResult> => {
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
        sourceCreatedAt: deliveryFinanceMetricTable.sourceCreatedAt,
        sourceUpdatedAt: deliveryFinanceMetricTable.sourceUpdatedAt,
        observedAt: deliveryFinanceMetricTable.observedAt,
        indexedAt: deliveryFinanceMetricTable.indexedAt,
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
          authorizationCondition(
            database,
            context,
            "finance_metric",
            deliveryFinanceMetricTable.id,
          ),
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
        sourceCreatedAt: row.sourceCreatedAt ?? undefined,
        sourceUpdatedAt: row.sourceUpdatedAt,
        indexedAt: row.indexedAt,
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
      sourceCreatedAt: deliveryMetricTable.sourceCreatedAt,
      sourceUpdatedAt: deliveryMetricTable.sourceUpdatedAt,
      observedAt: deliveryMetricTable.observedAt,
      indexedAt: deliveryMetricTable.indexedAt,
      canonicalUrl: knowledgeItemTable.canonicalUrl,
      authority: knowledgeItemTable.authority,
    })
    .from(deliveryMetricTable)
    .innerJoin(knowledgeItemTable, eq(knowledgeItemTable.id, deliveryMetricTable.sourceItemId))
    .where(
      and(
        eq(deliveryMetricTable.workspaceId, context.workspaceId),
        eq(knowledgeItemTable.workspaceId, context.workspaceId),
        authorizationCondition(database, context, "metric", deliveryMetricTable.id),
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
      sourceCreatedAt: row.sourceCreatedAt ?? undefined,
      sourceUpdatedAt: row.sourceUpdatedAt,
      indexedAt: row.indexedAt,
      dedupeKey: `${row.metricCategory}:${row.metricKind}:${row.value}:${row.unit}`,
    })),
  );
};

export const createPostgresDeliveryQuerySource = (
  database: KnowledgePostgresDatabase,
  configuration: {
    readonly entityCatalog?: DeliveryEntityCatalog | undefined;
  } = {},
): DeliveryQuerySource => ({
  source: "projection",
  selectors: ["objects", "relations", "observations", "claims", "metrics", "conflicts"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        const verifiedAt = await sourceVerificationTimes(database, context.workspaceId);
        const results: DeliveryQueryResult[] = [];
        for (const operation of plan.operations) {
          if (operation.select === "objects")
            results.push(await queryObjects(database, context, operation));
          if (operation.select === "relations")
            results.push(await queryRelations(database, context, operation));
          if (operation.select === "observations")
            results.push(
              await queryObservations(database, context, operation, configuration.entityCatalog),
            );
          if (operation.select === "claims" || operation.select === "conflicts")
            results.push(
              await queryClaims(database, context, operation, operation.select === "conflicts"),
            );
          if (operation.select === "metrics") {
            const finance = operation.metricCategories?.includes("finance") === true;
            results.push(await queryMetrics(database, context, operation, finance));
          }
        }
        const items = results.flatMap((entry) => entry.items);
        return {
          items: items.map((item) => ({
            ...item,
            indexedAt: verifiedAt.get(item.source) ?? item.indexedAt,
          })),
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
