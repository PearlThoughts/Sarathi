import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type DriftFinding,
  deriveProjectionSensitivity,
  type EvidenceItem,
  type IntentNode,
  type KernelEvent,
  type Projection,
  type ProjectionDriftStatus,
  type ProjectionTargetSystem,
  type ProjectionTargetType,
  type StrategyKernelRepository,
} from "../strategy-kernel/index.ts";

export type IntendedProjectionInput = {
  readonly intent: IntentNode;
  readonly targetSystem: ProjectionTargetSystem;
  readonly targetType: ProjectionTargetType;
  readonly targetId?: string | undefined;
  readonly targetUrl?: string | undefined;
  readonly relatedEvidence?: readonly EvidenceItem[] | undefined;
  readonly publishedHash?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
};

export type SimulatedProjectionState = {
  readonly authorized: boolean;
  readonly exists: boolean;
  readonly targetId?: string | undefined;
  readonly targetUrl?: string | undefined;
  readonly contentHash?: string | undefined;
  readonly managedBySarathi?: boolean | undefined;
};

export type ProjectionVerificationResult = {
  readonly projection: Projection;
  readonly event: KernelEvent;
  readonly driftFinding?: DriftFinding | undefined;
};

export const createIntendedProjection = ({
  intent,
  targetSystem,
  targetType,
  targetId,
  targetUrl,
  relatedEvidence = [],
  publishedHash = projectionHash(intent, targetSystem, targetType),
  sensitivity = deriveProjectionSensitivity(intent, relatedEvidence),
}: IntendedProjectionInput): Projection => ({
  id: projectionId(intent.id, targetSystem, targetType, targetId),
  workspaceId: intent.workspaceId,
  intentNodeId: intent.id,
  targetSystem,
  targetType,
  targetId,
  targetUrl,
  lastPublishedHash: publishedHash,
  driftStatus: targetId === undefined ? "missing" : "in_sync",
  sensitivity,
});

export const recordIntendedProjection = async (
  repository: StrategyKernelRepository,
  projection: Projection,
  occurredAt: string,
): Promise<KernelEvent> => {
  const event = kernelEvent({
    id: `event:${projection.id}:published`,
    workspaceId: projection.workspaceId,
    entityType: "projection",
    entityId: projection.id,
    action: "published",
    payload: {
      targetSystem: projection.targetSystem,
      targetType: projection.targetType,
      targetId: projection.targetId,
      intendedOnly: true,
    },
    occurredAt,
    sensitivity: projection.sensitivity,
  });

  await repository.saveProjection(projection);
  await repository.saveKernelEvent(event);

  return event;
};

export const determineProjectionDriftStatus = (
  projection: Projection,
  simulated: SimulatedProjectionState,
): ProjectionDriftStatus => {
  if (!simulated.authorized) {
    return "unauthorized";
  }

  if (!simulated.exists) {
    return "missing";
  }

  if (
    projection.lastPublishedHash !== undefined &&
    simulated.contentHash === projection.lastPublishedHash
  ) {
    return "in_sync";
  }

  if (simulated.managedBySarathi === false) {
    return "conflicting";
  }

  return "stale";
};

export const verifyProjectionAgainstSimulation = async (
  repository: StrategyKernelRepository,
  projection: Projection,
  simulated: SimulatedProjectionState,
  verifiedAt: string,
): Promise<ProjectionVerificationResult> => {
  const driftStatus = determineProjectionDriftStatus(projection, simulated);
  const verifiedProjection: Projection = {
    ...projection,
    targetId: simulated.targetId ?? projection.targetId,
    targetUrl: simulated.targetUrl ?? projection.targetUrl,
    lastVerifiedAt: verifiedAt,
    driftStatus,
  };
  const event = kernelEvent({
    id: `event:${projection.id}:verified:${stableHash(`${verifiedAt}:${driftStatus}`)}`,
    workspaceId: projection.workspaceId,
    entityType: "projection",
    entityId: projection.id,
    action: driftStatus === "in_sync" ? "verified" : "drift_detected",
    payload: {
      previousDriftStatus: projection.driftStatus,
      driftStatus,
      targetSystem: projection.targetSystem,
      targetType: projection.targetType,
      contentHash: simulated.contentHash,
    },
    occurredAt: verifiedAt,
    sensitivity: projection.sensitivity,
  });
  const driftFinding =
    driftStatus === "in_sync"
      ? undefined
      : projectionDriftFinding(verifiedProjection, driftStatus, verifiedAt);

  await repository.saveProjection(verifiedProjection);
  await repository.saveKernelEvent(event);

  if (driftFinding !== undefined) {
    await repository.saveDriftFinding(driftFinding);
  }

  return { projection: verifiedProjection, event, driftFinding };
};

export const projectionDriftFinding = (
  projection: Projection,
  driftStatus: Exclude<ProjectionDriftStatus, "in_sync">,
  createdAt: string,
): DriftFinding => ({
  id: `drift:${projection.id}:${driftStatus}`,
  workspaceId: projection.workspaceId,
  findingType: "projection_drift",
  title: projectionDriftTitle(projection, driftStatus),
  body: projectionDriftBody(projection, driftStatus),
  state: "open",
  relatedEntityType: "projection",
  relatedEntityId: projection.id,
  sensitivity: projection.sensitivity,
  createdAt,
});

const projectionId = (
  intentNodeId: string,
  targetSystem: ProjectionTargetSystem,
  targetType: ProjectionTargetType,
  targetId: string | undefined,
): string => `projection:${intentNodeId}:${targetSystem}:${targetType}:${targetId ?? "planned"}`;

const projectionHash = (
  intent: IntentNode,
  targetSystem: ProjectionTargetSystem,
  targetType: ProjectionTargetType,
): string =>
  stableHash(
    [
      intent.id,
      intent.workspaceId,
      intent.kind,
      intent.title,
      intent.body,
      intent.dueAt ?? "",
      intent.successSignal ?? "",
      targetSystem,
      targetType,
    ].join("\n"),
  );

const projectionDriftTitle = (
  projection: Projection,
  driftStatus: Exclude<ProjectionDriftStatus, "in_sync">,
): string => {
  switch (driftStatus) {
    case "missing":
      return `Missing ${projection.targetSystem} ${projection.targetType} projection`;
    case "stale":
      return `Stale ${projection.targetSystem} ${projection.targetType} projection`;
    case "conflicting":
      return `Conflicting ${projection.targetSystem} ${projection.targetType} projection`;
    case "unauthorized":
      return `Unauthorized ${projection.targetSystem} ${projection.targetType} projection`;
  }
};

const projectionDriftBody = (
  projection: Projection,
  driftStatus: Exclude<ProjectionDriftStatus, "in_sync">,
): string =>
  [
    `Projection ${projection.id} for intent ${projection.intentNodeId} is ${driftStatus}.`,
    "Sarathi records drift only; live external writes are outside this slice.",
  ].join(" ");

const stableHash = (input: string): string => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

type KernelEventInput = Omit<KernelEvent, "payloadJson"> & {
  readonly payload: Record<string, unknown>;
};

const kernelEvent = ({ payload, ...event }: KernelEventInput): KernelEvent => ({
  ...event,
  payloadJson: JSON.stringify(payload),
});
