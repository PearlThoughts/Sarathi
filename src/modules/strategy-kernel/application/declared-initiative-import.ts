import { stableSha256 } from "../../../domain/hash.ts";
import type {
  EvidenceItem,
  IntentEdge,
  IntentNode,
  IntentNodeState,
  KernelEvent,
} from "../domain/strategy-kernel.ts";
import type { StrategyKernelRepository } from "../ports/strategy-kernel-repository.ts";

export type DeclaredInitiativeSnapshotItem = {
  readonly key: string;
  readonly kind: "goal" | "initiative";
  readonly parentKey?: string | undefined;
  readonly title: string;
  readonly status:
    | "Active"
    | "Deployed"
    | "Done"
    | "In Progress"
    | "In QA"
    | "Not Started"
    | "Ongoing"
    | "Planned"
    | "Ready for PROD";
  readonly sourceRow?: number | undefined;
  readonly estimateHours?: number | undefined;
  readonly aliases?: readonly string[] | undefined;
  readonly notes?: string | undefined;
};

export type DeclaredInitiativeSnapshot = {
  readonly version: 1;
  readonly workspaceKey: string;
  readonly period: {
    readonly key: string;
    readonly title: string;
    readonly horizonStart: string;
    readonly horizonEnd: string;
  };
  readonly source: {
    readonly system: "spreadsheet";
    readonly externalId: string;
    readonly url: string;
    readonly title: string;
    readonly revision: string;
    readonly revisedAt: string;
  };
  readonly items: readonly DeclaredInitiativeSnapshotItem[];
};

type DeclaredInitiativeImportResult = {
  readonly workspaceId: string;
  readonly periodKey: string;
  readonly sourceRevision: string;
  readonly goals: number;
  readonly initiatives: number;
  readonly archived: number;
  readonly unchanged: number;
  readonly upserted: number;
};

const keyPattern = /^[a-z0-9][a-z0-9-]{0,119}$/;
const statuses = new Set<DeclaredInitiativeSnapshotItem["status"]>([
  "Active",
  "Deployed",
  "Done",
  "In Progress",
  "In QA",
  "Not Started",
  "Ongoing",
  "Planned",
  "Ready for PROD",
]);

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${path} must be a non-empty string.`);
  return value.trim();
};

const optionalText = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : text(value, path);

const timestamp = (value: unknown, path: string): string => {
  const selected = text(value, path);
  if (!Number.isFinite(Date.parse(selected))) throw new Error(`${path} must be an ISO timestamp.`);
  return selected;
};

const optionalPositiveNumber = (value: unknown, path: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${path} must be a positive number.`);
  return value;
};

const optionalPositiveInteger = (value: unknown, path: string): number | undefined => {
  const selected = optionalPositiveNumber(value, path);
  if (selected !== undefined && !Number.isInteger(selected))
    throw new Error(`${path} must be a positive integer.`);
  return selected;
};

const optionalAliases = (value: unknown, path: string): readonly string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  const aliases = value.map((alias, index) => text(alias, `${path}[${index}]`));
  if (new Set(aliases.map((alias) => alias.toLocaleLowerCase("en"))).size !== aliases.length)
    throw new Error(`${path} must not contain duplicate aliases.`);
  return aliases;
};

const assertHttpsUrl = (value: unknown, path: string): string => {
  const selected = text(value, path);
  try {
    if (new URL(selected).protocol !== "https:") throw new Error("not https");
  } catch {
    throw new Error(`${path} must be a resolvable HTTPS URL.`);
  }
  return selected;
};

const assertAcyclicHierarchy = (items: readonly DeclaredInitiativeSnapshotItem[]): void => {
  const byKey = new Map(items.map((item) => [item.key, item]));
  for (const item of items) {
    const visited = new Set([item.key]);
    let parentKey = item.parentKey;
    while (parentKey !== undefined) {
      if (visited.has(parentKey))
        throw new Error(`Declared initiative hierarchy contains a cycle at ${item.key}.`);
      visited.add(parentKey);
      parentKey = byKey.get(parentKey)?.parentKey;
    }
  }
};

export const parseDeclaredInitiativeSnapshot = (value: unknown): DeclaredInitiativeSnapshot => {
  const root = record(value, "declared initiative snapshot");
  if (root.version !== 1) throw new Error("Declared initiative snapshot version must be 1.");
  const workspaceKey = text(root.workspaceKey, "workspaceKey");
  const period = record(root.period, "period");
  const source = record(root.source, "source");
  const horizonStart = timestamp(period.horizonStart, "period.horizonStart");
  const horizonEnd = timestamp(period.horizonEnd, "period.horizonEnd");
  if (Date.parse(horizonStart) >= Date.parse(horizonEnd))
    throw new Error("Declared initiative snapshot period must end after it starts.");
  if (source.system !== "spreadsheet")
    throw new Error("Declared initiative snapshot source.system must be spreadsheet.");
  if (!Array.isArray(root.items) || root.items.length === 0)
    throw new Error("Declared initiative snapshot must contain items.");

  const items = root.items.map((candidate, index): DeclaredInitiativeSnapshotItem => {
    const item = record(candidate, `items[${index}]`);
    const key = text(item.key, `items[${index}].key`);
    if (!keyPattern.test(key)) throw new Error(`items[${index}].key is invalid.`);
    if (item.kind !== "goal" && item.kind !== "initiative")
      throw new Error(`items[${index}].kind must be goal or initiative.`);
    const status = text(item.status, `items[${index}].status`);
    if (!statuses.has(status as DeclaredInitiativeSnapshotItem["status"]))
      throw new Error(`items[${index}].status is unsupported.`);
    return {
      key,
      kind: item.kind,
      parentKey: optionalText(item.parentKey, `items[${index}].parentKey`),
      title: text(item.title, `items[${index}].title`),
      status: status as DeclaredInitiativeSnapshotItem["status"],
      sourceRow: optionalPositiveInteger(item.sourceRow, `items[${index}].sourceRow`),
      estimateHours: optionalPositiveNumber(item.estimateHours, `items[${index}].estimateHours`),
      aliases: optionalAliases(item.aliases, `items[${index}].aliases`),
      notes: optionalText(item.notes, `items[${index}].notes`),
    };
  });
  const keys = new Set(items.map((item) => item.key));
  if (keys.size !== items.length) throw new Error("Declared initiative keys must be unique.");
  for (const item of items) {
    if (item.parentKey !== undefined && !keys.has(item.parentKey))
      throw new Error(
        `Declared initiative ${item.key} references missing parent ${item.parentKey}.`,
      );
  }
  assertAcyclicHierarchy(items);

  return {
    version: 1,
    workspaceKey,
    period: {
      key: text(period.key, "period.key"),
      title: text(period.title, "period.title"),
      horizonStart,
      horizonEnd,
    },
    source: {
      system: "spreadsheet",
      externalId: text(source.externalId, "source.externalId"),
      url: assertHttpsUrl(source.url, "source.url"),
      title: text(source.title, "source.title"),
      revision: text(source.revision, "source.revision"),
      revisedAt: timestamp(source.revisedAt, "source.revisedAt"),
    },
    items,
  };
};

const nodeState = (status: DeclaredInitiativeSnapshotItem["status"]): IntentNodeState => {
  switch (status) {
    case "Deployed":
    case "Done":
      return "kept";
    case "Active":
    case "In Progress":
    case "In QA":
    case "Ongoing":
    case "Ready for PROD":
      return "active";
    case "Not Started":
    case "Planned":
      return "ratified";
  }
};

const nodePrefix = (workspaceId: string, snapshot: DeclaredInitiativeSnapshot): string =>
  `intent:declared:${workspaceId}:${snapshot.period.key}:`;

const nodeId = (workspaceId: string, snapshot: DeclaredInitiativeSnapshot, key: string): string =>
  `${nodePrefix(workspaceId, snapshot)}${key}`;

const itemBody = (
  snapshot: DeclaredInitiativeSnapshot,
  item: DeclaredInitiativeSnapshotItem,
): string =>
  [
    `${snapshot.period.title} ${item.kind}.`,
    `Plan status: ${item.status}.`,
    item.aliases === undefined || item.aliases.length === 0
      ? undefined
      : `Also known as: ${item.aliases.join(", ")}.`,
    item.estimateHours === undefined ? undefined : `Planned estimate: ${item.estimateHours} hours.`,
    item.notes,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");

const contentHash = (snapshot: DeclaredInitiativeSnapshot): string =>
  stableSha256(JSON.stringify(snapshot));

const sameIntentNode = (left: IntentNode, right: IntentNode): boolean =>
  left.id === right.id &&
  left.workspaceId === right.workspaceId &&
  left.kind === right.kind &&
  left.title === right.title &&
  left.body === right.body &&
  left.ownerActorId === right.ownerActorId &&
  left.state === right.state &&
  left.horizonStart === right.horizonStart &&
  left.horizonEnd === right.horizonEnd &&
  left.dueAt === right.dueAt &&
  left.successSignal === right.successSignal &&
  left.sensitivity === right.sensitivity &&
  left.originEvidenceId === right.originEvidenceId &&
  left.createdBy === right.createdBy &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt;

const kernelEvent = (input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly entityType: KernelEvent["entityType"];
  readonly entityId: string;
  readonly action: KernelEvent["action"];
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}): KernelEvent => ({
  id: input.id,
  workspaceId: input.workspaceId,
  entityType: input.entityType,
  entityId: input.entityId,
  action: input.action,
  payloadJson: JSON.stringify(input.payload),
  occurredAt: input.occurredAt,
  sensitivity: "internal",
});

export const importDeclaredInitiativeSnapshot = async (input: {
  readonly repository: StrategyKernelRepository;
  readonly workspaceId: string;
  readonly expectedWorkspaceKey: string;
  readonly snapshot: DeclaredInitiativeSnapshot;
  readonly importedAt: string;
}): Promise<DeclaredInitiativeImportResult> => {
  if (input.snapshot.workspaceKey !== input.expectedWorkspaceKey)
    throw new Error(
      `Declared initiative snapshot workspace ${input.snapshot.workspaceKey} does not match selected workspace ${input.expectedWorkspaceKey}.`,
    );
  const prefix = nodePrefix(input.workspaceId, input.snapshot);
  const expectedIds = new Set(
    input.snapshot.items.map((item) => nodeId(input.workspaceId, input.snapshot, item.key)),
  );
  const existing = await input.repository.listWorkspaceIntent(input.workspaceId);
  const existingById = new Map(existing.map((node) => [node.id, node]));
  const sourceEvidenceId = `evidence:declared:${stableSha256(
    `${input.workspaceId}:${input.snapshot.source.externalId}`,
  )}`;
  const evidence: EvidenceItem = {
    id: sourceEvidenceId,
    workspaceId: input.workspaceId,
    sourceSystem: "manual",
    sourceType: "note",
    externalId: input.snapshot.source.externalId,
    externalUrl: input.snapshot.source.url,
    occurredAt: input.snapshot.source.revisedAt,
    title: input.snapshot.source.title,
    bodyExcerpt: `${input.snapshot.period.title} declared plan snapshot with ${input.snapshot.items.length} items.`,
    contentHash: contentHash(input.snapshot),
    sensitivity: "internal",
    consentStatus: "not_required",
    ingestedAt: input.importedAt,
  };
  let archived = 0;
  let unchanged = 0;
  let upserted = 0;

  await input.repository.withTransaction(async (repository) => {
    await repository.saveEvidenceItem(evidence);
    await repository.saveKernelEvent(
      kernelEvent({
        id: `event:declared:${stableSha256(
          `${sourceEvidenceId}:${input.snapshot.source.revision}`,
        )}`,
        workspaceId: input.workspaceId,
        entityType: "evidence_item",
        entityId: sourceEvidenceId,
        action: "harvested",
        payload: {
          sourceRevision: input.snapshot.source.revision,
          periodKey: input.snapshot.period.key,
          itemCount: input.snapshot.items.length,
        },
        occurredAt: input.importedAt,
      }),
    );

    for (const item of input.snapshot.items) {
      const id = nodeId(input.workspaceId, input.snapshot, item.key);
      const previous = existingById.get(id);
      const node: IntentNode = {
        id,
        workspaceId: input.workspaceId,
        kind: item.kind === "goal" ? "goal" : "commitment",
        title: item.title,
        body: itemBody(input.snapshot, item),
        state: nodeState(item.status),
        horizonStart: input.snapshot.period.horizonStart,
        horizonEnd: input.snapshot.period.horizonEnd,
        sensitivity: "internal",
        originEvidenceId: sourceEvidenceId,
        createdBy: "human",
        createdAt: previous?.createdAt ?? input.snapshot.source.revisedAt,
        updatedAt: input.snapshot.source.revisedAt,
      };
      if (previous !== undefined && sameIntentNode(previous, node)) unchanged += 1;
      else upserted += 1;
      await repository.saveIntentNode(node);
      await repository.saveKernelEvent(
        kernelEvent({
          id: `event:declared:${stableSha256(`${id}:${input.snapshot.source.revision}:ratified`)}`,
          workspaceId: input.workspaceId,
          entityType: "intent_node",
          entityId: id,
          action: "ratified",
          payload: {
            sourceRevision: input.snapshot.source.revision,
            sourceRow: item.sourceRow,
            sourceStatus: item.status,
          },
          occurredAt: input.importedAt,
        }),
      );
    }

    for (const item of input.snapshot.items) {
      if (item.parentKey === undefined) continue;
      const childId = nodeId(input.workspaceId, input.snapshot, item.key);
      const parentId = nodeId(input.workspaceId, input.snapshot, item.parentKey);
      const edge: IntentEdge = {
        id: `edge:declared:${stableSha256(`${childId}:part_of:${parentId}`)}`,
        fromNodeId: childId,
        toNodeId: parentId,
        type: "part_of",
        confidence: 1,
        createdAt: input.snapshot.source.revisedAt,
        createdBy: "human",
      };
      await repository.saveIntentEdge(edge);
    }

    for (const previous of existing) {
      if (
        !previous.id.startsWith(prefix) ||
        expectedIds.has(previous.id) ||
        previous.state === "archived"
      )
        continue;
      archived += 1;
      await repository.saveIntentNode({
        ...previous,
        state: "archived",
        updatedAt: input.snapshot.source.revisedAt,
      });
      await repository.saveKernelEvent(
        kernelEvent({
          id: `event:declared:${stableSha256(
            `${previous.id}:${input.snapshot.source.revision}:archived`,
          )}`,
          workspaceId: input.workspaceId,
          entityType: "intent_node",
          entityId: previous.id,
          action: "superseded",
          payload: { sourceRevision: input.snapshot.source.revision },
          occurredAt: input.importedAt,
        }),
      );
    }
  });

  return {
    workspaceId: input.workspaceId,
    periodKey: input.snapshot.period.key,
    sourceRevision: input.snapshot.source.revision,
    goals: input.snapshot.items.filter((item) => item.kind === "goal").length,
    initiatives: input.snapshot.items.filter((item) => item.kind === "initiative").length,
    archived,
    unchanged,
    upserted,
  };
};
