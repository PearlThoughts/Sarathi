import { uniqueId } from "../../domain/hash.ts";
import {
  type AccountabilityAction,
  type AccountabilityChannel,
  deriveAccountabilitySensitivity,
  type EvidenceItem,
  type IntentNode,
  inheritMostRestrictiveSensitivity,
  type KernelEvent,
  type KernelEventAction,
  type StrategyKernelRepository,
} from "../strategy-kernel/index.ts";

export type AccountabilityPolicy = {
  readonly defaultChannel: AccountabilityChannel;
  readonly silenceAfterHours: number;
  readonly escalationAfterHours: number;
  readonly evidenceRequiredForDone: boolean;
};

export type CreateAccountabilityActionInput = {
  readonly repository: StrategyKernelRepository;
  readonly intent: IntentNode;
  readonly actorId?: string | undefined;
  readonly channel?: AccountabilityChannel | undefined;
  readonly policy: AccountabilityPolicy;
  readonly dueAt?: string | undefined;
  readonly occurredAt: string;
};

export type AccountabilityActionTransitionInput = {
  readonly repository: StrategyKernelRepository;
  readonly action: AccountabilityAction;
  readonly actorId?: string | undefined;
  readonly occurredAt: string;
};

export type ActionCardInteraction = {
  readonly interactionId: string;
  readonly action: AccountabilityAction;
  readonly actorId: string;
  readonly response: "acknowledge" | "block" | "done" | "silent" | "comment";
  readonly comment?: string | undefined;
  readonly occurredAt: string;
};

export type AccountabilityActionResult = {
  readonly action: AccountabilityAction;
  readonly event: KernelEvent;
};

export const createAccountabilityAction = async ({
  repository,
  intent,
  actorId,
  channel,
  policy,
  dueAt = intent.dueAt,
  occurredAt,
}: CreateAccountabilityActionInput): Promise<AccountabilityActionResult> =>
  repository.withTransaction(async (transaction) => {
    const persistedIntent = await transaction.getIntentNode(intent.id);

    if (persistedIntent === undefined || persistedIntent.workspaceId !== intent.workspaceId) {
      throw new Error(`Cannot create accountability action for missing commitment ${intent.id}.`);
    }

    assertChaseableCommitment(persistedIntent);
    assertNoOpenActionForIntent(
      await transaction.listWorkspaceAccountabilityActions(persistedIntent.workspaceId),
      persistedIntent.id,
    );
    const ownerActorId = actorId ?? persistedIntent.ownerActorId;

    if (ownerActorId === undefined) {
      throw new Error(
        `Cannot create accountability action for commitment ${persistedIntent.id} without an owner.`,
      );
    }

    const action: AccountabilityAction = {
      id: uniqueId(`action:${persistedIntent.id}`),
      workspaceId: persistedIntent.workspaceId,
      intentNodeId: persistedIntent.id,
      actorId: ownerActorId,
      channel: channel ?? policy.defaultChannel,
      state: "pending",
      dueAt: dueAt ?? persistedIntent.dueAt,
      escalationLevel: 0,
      evidenceRequired: policy.evidenceRequiredForDone,
      sensitivity: deriveAccountabilitySensitivity(persistedIntent, []),
    };
    const event = actionEvent(action, {
      action: "edited",
      actorId: ownerActorId,
      occurredAt,
      payload: {
        operation: "created",
        intentNodeId: persistedIntent.id,
        channel: action.channel,
        dueAt: action.dueAt,
        evidenceRequired: action.evidenceRequired,
      },
    });

    await transaction.saveAccountabilityAction(action);
    await transaction.saveKernelEvent(event);

    return { action, event };
  });

export const assignOwner = (
  input: AccountabilityActionTransitionInput & { readonly ownerActorId: string },
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "edited",
    patch: { actorId: input.ownerActorId },
    payload: { operation: "assign_owner", ownerActorId: input.ownerActorId },
  });

export const setDueDate = (
  input: AccountabilityActionTransitionInput & { readonly dueAt: string },
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "edited",
    patch: { dueAt: input.dueAt },
    payload: { operation: "set_due_date", dueAt: input.dueAt },
  });

export const requireEvidence = (
  input: AccountabilityActionTransitionInput & { readonly evidenceRequired: boolean },
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "edited",
    patch: { evidenceRequired: input.evidenceRequired },
    payload: {
      operation: "require_evidence",
      evidenceRequired: input.evidenceRequired,
    },
  });

export const markSent = (
  input: AccountabilityActionTransitionInput,
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "nudged",
    patch: { state: "sent", lastNudgedAt: input.occurredAt },
    payload: { operation: "mark_sent", channel: input.action.channel },
  });

export const markAcknowledged = (
  input: AccountabilityActionTransitionInput,
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "acknowledged",
    patch: { state: "acknowledged" },
    payload: { operation: "mark_acknowledged" },
  });

export const markBlocked = (
  input: AccountabilityActionTransitionInput & { readonly reason: string },
): Promise<AccountabilityActionResult> =>
  updateAction(input.repository, input.action, {
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    action: "blocked",
    patch: { state: "blocked" },
    payload: { operation: "mark_blocked", reason: input.reason },
  });

export const markDoneWithEvidence = async (
  input: AccountabilityActionTransitionInput & {
    readonly completionEvidence?: EvidenceItem | undefined;
  },
): Promise<AccountabilityActionResult> =>
  input.repository.withTransaction(async (repository) => {
    const action = await persistedAction(repository, input.action);

    if (action.evidenceRequired && input.completionEvidence === undefined) {
      throw new Error(`Action ${action.id} requires completion evidence.`);
    }

    if (
      input.completionEvidence !== undefined &&
      input.completionEvidence.workspaceId !== action.workspaceId
    ) {
      throw new Error(
        `Completion evidence ${input.completionEvidence.id} belongs to another workspace.`,
      );
    }

    const updatedAction: AccountabilityAction = {
      ...action,
      state: "done",
      completionEvidenceId: input.completionEvidence?.id,
      sensitivity:
        input.completionEvidence === undefined
          ? action.sensitivity
          : inheritMostRestrictiveSensitivity([
              action.sensitivity,
              input.completionEvidence.sensitivity,
            ]),
    };
    const event = actionEvent(updatedAction, {
      action: "completed",
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      payload: {
        operation: "mark_done",
        completionEvidenceId: updatedAction.completionEvidenceId,
      },
    });

    await repository.saveAccountabilityAction(updatedAction);
    await repository.saveKernelEvent(event);

    return { action: updatedAction, event };
  });

export const markSilent = async (
  input: AccountabilityActionTransitionInput & {
    readonly policy: AccountabilityPolicy;
  },
): Promise<AccountabilityActionResult> =>
  input.repository.withTransaction(async (repository) => {
    const action = await persistedAction(repository, input.action);
    assertElapsedPolicyWindow(
      action.lastNudgedAt ?? action.dueAt,
      input.occurredAt,
      input.policy.silenceAfterHours,
      "silence",
    );

    return saveActionTransition(repository, action, {
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      action: "silent",
      patch: { state: "silent" },
      payload: { operation: "mark_silent" },
    });
  });

export const escalateAction = async (
  input: AccountabilityActionTransitionInput & {
    readonly policy: AccountabilityPolicy;
  },
): Promise<AccountabilityActionResult> =>
  input.repository.withTransaction(async (repository) => {
    const action = await persistedAction(repository, input.action);
    const escalationLevel = action.escalationLevel + 1;
    assertElapsedPolicyWindow(
      action.lastNudgedAt ?? action.dueAt,
      input.occurredAt,
      input.policy.escalationAfterHours,
      "escalation",
    );

    return saveActionTransition(repository, action, {
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      action: "escalated",
      patch: {
        state: "escalated",
        escalationLevel,
        lastNudgedAt: input.occurredAt,
      },
      payload: {
        operation: "escalate",
        escalationLevel,
      },
    });
  });

export const recordActionCardInteraction = async (
  repository: StrategyKernelRepository,
  interaction: ActionCardInteraction,
): Promise<KernelEvent> =>
  repository.withTransaction(async (transaction) => {
    const action = await persistedAction(transaction, interaction.action);
    const event = actionEvent(action, {
      action: "card_interacted",
      actorId: interaction.actorId,
      occurredAt: interaction.occurredAt,
      payload: {
        interactionId: interaction.interactionId,
        response: interaction.response,
        comment: interaction.comment,
        eventOnly: true,
      },
    });

    await transaction.saveKernelEvent(event);

    return event;
  });

const updateAction = async (
  repository: StrategyKernelRepository,
  action: AccountabilityAction,
  update: {
    readonly actorId?: string | undefined;
    readonly occurredAt: string;
    readonly action: KernelEventAction;
    readonly patch: Partial<AccountabilityAction>;
    readonly payload: Record<string, unknown>;
  },
): Promise<AccountabilityActionResult> =>
  repository.withTransaction(async (transaction) => {
    const persisted = await persistedAction(transaction, action);
    return saveActionTransition(transaction, persisted, update);
  });

const saveActionTransition = async (
  repository: StrategyKernelRepository,
  action: AccountabilityAction,
  update: {
    readonly actorId?: string | undefined;
    readonly occurredAt: string;
    readonly action: KernelEventAction;
    readonly patch: Partial<AccountabilityAction>;
    readonly payload: Record<string, unknown>;
  },
): Promise<AccountabilityActionResult> => {
  const updatedAction: AccountabilityAction = {
    ...action,
    ...update.patch,
  };
  assertActionTransitionAllowed(action, updatedAction);
  const event = actionEvent(updatedAction, {
    action: update.action,
    actorId: update.actorId,
    occurredAt: update.occurredAt,
    payload: update.payload,
  });

  await repository.saveAccountabilityAction(updatedAction);
  await repository.saveKernelEvent(event);

  return { action: updatedAction, event };
};

const persistedAction = async (
  repository: StrategyKernelRepository,
  action: AccountabilityAction,
): Promise<AccountabilityAction> => {
  const actions = await repository.listWorkspaceAccountabilityActions(action.workspaceId);
  const persisted = actions.find((candidate) => candidate.id === action.id);

  if (persisted === undefined) {
    throw new Error(`Accountability action ${action.id} does not exist.`);
  }

  return persisted;
};

const assertChaseableCommitment = (intent: IntentNode): void => {
  if (intent.kind !== "commitment" || !["ratified", "active", "at_risk"].includes(intent.state)) {
    throw new Error(
      `Sarathi only chases ratified, active, or at-risk commitments, not ${intent.kind}:${intent.state}.`,
    );
  }
};

const assertNoOpenActionForIntent = (
  actions: readonly AccountabilityAction[],
  intentNodeId: string,
): void => {
  const existing = actions.find(
    (action) =>
      action.intentNodeId === intentNodeId && !["done", "cancelled"].includes(action.state),
  );

  if (existing !== undefined) {
    throw new Error(`Commitment ${intentNodeId} already has open action ${existing.id}.`);
  }
};

const allowedStateTransitions: Readonly<
  Record<AccountabilityAction["state"], readonly AccountabilityAction["state"][]>
> = {
  pending: ["sent"],
  sent: ["acknowledged", "blocked", "done", "silent", "escalated"],
  acknowledged: ["blocked", "done", "escalated"],
  blocked: [],
  done: [],
  silent: ["acknowledged", "blocked", "escalated"],
  escalated: ["acknowledged", "blocked", "done"],
  cancelled: [],
};

const assertActionTransitionAllowed = (
  current: AccountabilityAction,
  next: AccountabilityAction,
): void => {
  if (current.state === next.state) {
    if (["done", "cancelled"].includes(current.state)) {
      throw new Error(`Cannot edit terminal accountability action ${current.id}.`);
    }
    return;
  }

  if (!allowedStateTransitions[current.state].includes(next.state)) {
    throw new Error(
      `Cannot transition accountability action ${current.id} from ${current.state} to ${next.state}.`,
    );
  }
};

const assertElapsedPolicyWindow = (
  anchorAt: string | undefined,
  occurredAt: string,
  thresholdHours: number,
  label: string,
): void => {
  if (anchorAt === undefined) {
    throw new Error(`Cannot mark ${label} without a due date or previous nudge.`);
  }

  const elapsedHours = (Date.parse(occurredAt) - Date.parse(anchorAt)) / 3_600_000;

  if (!Number.isFinite(elapsedHours)) {
    throw new Error(`Cannot mark ${label} with invalid timestamp.`);
  }

  if (elapsedHours < thresholdHours) {
    throw new Error(`Cannot mark ${label} before ${thresholdHours} hours have elapsed.`);
  }
};

const actionEvent = (
  action: AccountabilityAction,
  input: {
    readonly action: KernelEventAction;
    readonly actorId?: string | undefined;
    readonly occurredAt: string;
    readonly payload: Record<string, unknown>;
  },
): KernelEvent => ({
  id: uniqueId(`event:${action.id}:${input.action}`),
  workspaceId: action.workspaceId,
  actorId: input.actorId,
  entityType: "accountability_action",
  entityId: action.id,
  action: input.action,
  payloadJson: JSON.stringify(input.payload),
  occurredAt: input.occurredAt,
  sensitivity: action.sensitivity,
});
