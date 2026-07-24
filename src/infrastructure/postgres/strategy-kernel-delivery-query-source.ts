import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import {
  isSensitivityAtOrBelow,
  maxSensitivity,
  type SensitivityTier,
} from "../../domain/policy.ts";
import {
  type DeliveryLifecycleState,
  type DeliveryQueryOperation,
  type DeliveryQuerySource,
  type DeliveryQuestionIntent,
  type DeliveryResultItem,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import type {
  EvidenceItem,
  IntentNode,
  IntentNodeKind,
  StrategyKernelRepository,
} from "../../modules/strategy-kernel/index.ts";

type StrategyKernelDeliveryQuerySourceConfiguration = {
  readonly repository: StrategyKernelRepository;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
};

const acceptedStates = new Set<IntentNode["state"]>([
  "ratified",
  "active",
  "at_risk",
  "kept",
  "broken",
]);

const intentsByKind: Readonly<Record<IntentNodeKind, readonly DeliveryQuestionIntent[]>> = {
  goal: ["goals", "status", "general"],
  commitment: ["commitments", "current_work", "next_actions", "milestones", "status", "general"],
  bet: ["goals", "risks", "status", "general"],
  decision: ["decisions", "status", "general"],
  assumption: ["risks", "status", "general"],
  risk: ["risks", "blockers", "status", "general"],
  kpi: ["goals", "status", "general"],
  capacity_reservation: ["capacity", "status", "general"],
  policy: ["scope", "status", "general"],
};

const sourceKinds = new Set(["jira", "vault", "github", "teams", "email"] as const);
type CitableSource = "jira" | "vault" | "github" | "teams" | "email";

const citableSource = (evidence: EvidenceItem): CitableSource | undefined =>
  sourceKinds.has(evidence.sourceSystem as CitableSource)
    ? (evidence.sourceSystem as CitableSource)
    : undefined;

const resolvableCitation = (evidence: EvidenceItem): string | undefined => {
  const value = evidence.externalUrl;
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const lifecycleState = (state: IntentNode["state"]): DeliveryLifecycleState => {
  if (state === "ratified") return "planned";
  if (state === "active" || state === "at_risk") return "active";
  if (state === "kept") return "done";
  if (state === "broken") return "blocked";
  return "unknown";
};

const normalizedText = (value: string): string => value.replace(/\s+/g, " ").trim();

const summary = (node: IntentNode): string =>
  [
    normalizedText(node.body),
    `State: ${node.state.replaceAll("_", " ")}`,
    node.dueAt === undefined ? undefined : `Due: ${node.dueAt}`,
    node.successSignal === undefined
      ? undefined
      : `Success signal: ${normalizedText(node.successSignal)}`,
  ]
    .filter((value): value is string => value !== undefined && value !== "")
    .join(" · ");

const overlapsOperationTime = (
  node: IntentNode,
  operation: DeliveryQueryOperation,
  requestedAt: string,
  timeZone: string,
): boolean => {
  if (operation.time === undefined) return true;
  if (operation.time.kind === "jira_sprint") return true;
  const window = resolveDeliveryTimeConstraint(operation.time, requestedAt, timeZone);
  const start = Date.parse(node.horizonStart ?? node.createdAt);
  const end = Date.parse(node.horizonEnd ?? node.dueAt ?? node.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  return start < Date.parse(window.toExclusive) && end >= Date.parse(window.fromInclusive);
};

const resultFor = (
  node: IntentNode,
  evidence: EvidenceItem,
  operation: DeliveryQueryOperation,
  sensitivity: SensitivityTier,
): DeliveryResultItem | undefined => {
  const source = citableSource(evidence);
  const citationUrl = resolvableCitation(evidence);
  if (source === undefined || citationUrl === undefined) return undefined;
  return {
    id: node.id,
    workspaceId: node.workspaceId,
    source,
    selector: operation.select,
    intent: operation.purpose,
    title: node.title,
    summary: summary(node),
    citationUrl,
    sensitivity,
    authority: node.createdBy === "human" ? 1 : 0.95,
    observedAt: node.updatedAt,
    sourceCreatedAt: node.createdAt,
    sourceUpdatedAt: node.updatedAt,
    subjectAliases: [node.id, node.title],
    lifecycleState: lifecycleState(node.state),
    dedupeKey: `declared-intent:${node.id}:${node.updatedAt}`,
    evidenceRole: "declared_intent",
  };
};

export const createStrategyKernelDeliveryQuerySource = (
  configuration: StrategyKernelDeliveryQuerySourceConfiguration,
): DeliveryQuerySource => ({
  source: "intent",
  selectors: ["objects", "relations", "claims", "metrics"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        if (
          context.workspaceId !== configuration.workspaceId ||
          !configuration.allowedActorIds.has(context.actorId)
        )
          return { items: [], conflicts: [], unavailableSources: [], complete: true };

        const [nodes, evidenceItems] = await Promise.all([
          configuration.repository.listWorkspaceIntent(context.workspaceId),
          configuration.repository.listWorkspaceEvidence(context.workspaceId),
        ]);
        const evidenceById = new Map(evidenceItems.map((item) => [item.id, item]));
        const items = plan.operations.flatMap((operation) =>
          nodes.flatMap((node) => {
            if (
              !acceptedStates.has(node.state) ||
              !intentsByKind[node.kind].includes(operation.purpose) ||
              !overlapsOperationTime(node, operation, context.requestedAt, context.timeZone)
            )
              return [];
            const evidence =
              node.originEvidenceId === undefined
                ? undefined
                : evidenceById.get(node.originEvidenceId);
            if (evidence === undefined || evidence.workspaceId !== context.workspaceId) return [];
            const sensitivity = maxSensitivity(node.sensitivity, evidence.sensitivity);
            if (!isSensitivityAtOrBelow(sensitivity, context.maximumSensitivity)) return [];
            const item = resultFor(node, evidence, operation, sensitivity);
            return item === undefined ? [] : [item];
          }),
        );
        return {
          items,
          conflicts: [],
          unavailableSources: [],
          complete: true,
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Declared delivery intent is unavailable.",
          operation: "strategy-kernel-delivery-query",
        }),
    }),
});
