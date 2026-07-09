import type { SensitivityTier } from "../../domain/policy.ts";
import {
  deriveClaimFromEvidence,
  type EvidenceItem,
  type ExtractedClaim,
  type ExtractedClaimType,
  type IntentNode,
  type IntentNodeKind,
  inheritMostRestrictiveSensitivity,
  type KernelEvent,
  type StrategyKernelRepository,
} from "../strategy-kernel/index.ts";

export type EvidenceIngestionInput = Omit<EvidenceItem, "contentHash" | "ingestedAt"> &
  Partial<Pick<EvidenceItem, "contentHash" | "ingestedAt">>;

export type ClaimExtractionRule = {
  readonly claimType: ExtractedClaimType;
  readonly pattern: RegExp;
  readonly confidence: number;
};

export type EvidenceIngestionResult = {
  readonly evidence: EvidenceItem;
  readonly claims: readonly ExtractedClaim[];
  readonly events: readonly KernelEvent[];
};

export type ClaimTransitionResult = {
  readonly claim: ExtractedClaim;
  readonly intent?: IntentNode | undefined;
  readonly event: KernelEvent;
};

export type AcceptClaimInput = {
  readonly repository: StrategyKernelRepository;
  readonly claim: ExtractedClaim;
  readonly actorId?: string | undefined;
  readonly intentId?: string | undefined;
  readonly kind?: IntentNodeKind | undefined;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly dueAt?: string | undefined;
  readonly ownerActorId?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
  readonly occurredAt: string;
};

export type EditClaimInput = {
  readonly repository: StrategyKernelRepository;
  readonly claim: ExtractedClaim;
  readonly actorId?: string | undefined;
  readonly text: string;
  readonly suggestedOwnerId?: string | undefined;
  readonly suggestedDueAt?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
  readonly occurredAt: string;
};

export type RejectClaimInput = {
  readonly repository: StrategyKernelRepository;
  readonly claim: ExtractedClaim;
  readonly actorId?: string | undefined;
  readonly reason: string;
  readonly occurredAt: string;
};

export type MergeClaimInput = {
  readonly repository: StrategyKernelRepository;
  readonly claim: ExtractedClaim;
  readonly actorId?: string | undefined;
  readonly intoIntentNodeId: string;
  readonly reason: string;
  readonly occurredAt: string;
};

export const defaultClaimExtractionRules: readonly ClaimExtractionRule[] = [
  {
    claimType: "possible_commitment",
    pattern: /\b(commit|committed|will|promise|own|owned|deliver|finish)\b/i,
    confidence: 0.86,
  },
  {
    claimType: "blocker",
    pattern: /\b(blocked|blocker|waiting on|cannot proceed|stuck)\b/i,
    confidence: 0.84,
  },
  {
    claimType: "risk",
    pattern: /\b(risk|risky|might miss|at risk|concern)\b/i,
    confidence: 0.8,
  },
  {
    claimType: "possible_decision",
    pattern: /\b(decided|decision|agreed|approved)\b/i,
    confidence: 0.82,
  },
  {
    claimType: "possible_goal",
    pattern: /\b(goal|objective|target|outcome)\b/i,
    confidence: 0.78,
  },
  {
    claimType: "evidence_of_done",
    pattern: /\b(done|completed|shipped|merged|attached evidence)\b/i,
    confidence: 0.76,
  },
];

export const buildEvidenceItem = (
  input: EvidenceIngestionInput,
  ingestedAt = input.ingestedAt ?? input.occurredAt,
): EvidenceItem => ({
  ...input,
  contentHash: input.contentHash ?? stableHash(evidenceHashSource(input)),
  ingestedAt,
});

export const extractClaimsFromEvidence = (
  evidence: EvidenceItem,
  extractedAt = evidence.ingestedAt,
  rules: readonly ClaimExtractionRule[] = defaultClaimExtractionRules,
): readonly ExtractedClaim[] => {
  const matchingRules = rules.filter((rule) => rule.pattern.test(evidence.bodyExcerpt));
  const selectedRules: readonly ClaimExtractionRule[] =
    matchingRules.length === 0
      ? [
          {
            claimType: "status_update",
            pattern: /.*/,
            confidence: 0.52,
          },
        ]
      : matchingRules;

  return selectedRules.map((rule, index) =>
    deriveClaimFromEvidence(
      {
        id: `claim:${evidence.id}:${rule.claimType}:${index + 1}`,
        evidenceItemId: evidence.id,
        workspaceId: evidence.workspaceId,
        claimType: rule.claimType,
        text: claimText(evidence, rule.claimType),
        suggestedOwnerId: suggestedOwnerForClaim(evidence, rule.claimType),
        suggestedDueAt: extractDueDate(evidence.bodyExcerpt),
        confidence: rule.confidence,
        state: "pending",
        createdAt: extractedAt,
        updatedAt: extractedAt,
      },
      evidence,
    ),
  );
};

export const ingestEvidenceAndExtractClaims = async (
  repository: StrategyKernelRepository,
  input: EvidenceIngestionInput,
  ingestedAt = input.ingestedAt ?? input.occurredAt,
): Promise<EvidenceIngestionResult> => {
  const evidence = buildEvidenceItem(input, ingestedAt);
  const claims = extractClaimsFromEvidence(evidence, ingestedAt);
  const harvestEvent = kernelEvent({
    id: `event:${evidence.id}:harvested`,
    workspaceId: evidence.workspaceId,
    actorId: evidence.actorId,
    entityType: "evidence_item",
    entityId: evidence.id,
    action: "harvested",
    payload: {
      sourceSystem: evidence.sourceSystem,
      sourceType: evidence.sourceType,
      externalId: evidence.externalId,
    },
    occurredAt: ingestedAt,
    sensitivity: evidence.sensitivity,
  });
  const inferenceEvents = claims.map((claim) =>
    kernelEvent({
      id: `event:${claim.id}:inferred`,
      workspaceId: claim.workspaceId,
      entityType: "extracted_claim",
      entityId: claim.id,
      action: "inferred",
      payload: {
        evidenceItemId: claim.evidenceItemId,
        claimType: claim.claimType,
        confidence: claim.confidence,
      },
      occurredAt: ingestedAt,
      sensitivity: claim.sensitivity,
    }),
  );

  await repository.saveEvidenceItem(evidence);
  await repository.saveKernelEvent(harvestEvent);

  for (const claim of claims) {
    await repository.saveExtractedClaim(claim);
  }

  for (const event of inferenceEvents) {
    await repository.saveKernelEvent(event);
  }

  return {
    evidence,
    claims,
    events: [harvestEvent, ...inferenceEvents],
  };
};

export const acceptClaimAsIntent = async ({
  repository,
  claim,
  actorId,
  intentId = `intent:${claim.id}`,
  kind = intentKindForClaim(claim.claimType),
  title = titleFromClaim(claim.text),
  body = claim.text,
  dueAt = claim.suggestedDueAt,
  ownerActorId = claim.suggestedOwnerId,
  sensitivity = claim.sensitivity,
  occurredAt,
}: AcceptClaimInput): Promise<ClaimTransitionResult> => {
  const intentSensitivity = inheritMostRestrictiveSensitivity([claim.sensitivity, sensitivity]);
  const intent: IntentNode = {
    id: intentId,
    workspaceId: claim.workspaceId,
    kind,
    title,
    body,
    ownerActorId,
    state: "ratified",
    dueAt,
    sensitivity: intentSensitivity,
    originEvidenceId: claim.evidenceItemId,
    createdBy: "sarathi",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const updatedClaim: ExtractedClaim = {
    ...claim,
    state: "accepted",
    sensitivity: intentSensitivity,
    ratifiedNodeId: intent.id,
    updatedAt: occurredAt,
  };
  const event = kernelEvent({
    id: `event:${claim.id}:ratified`,
    workspaceId: claim.workspaceId,
    actorId,
    entityType: "extracted_claim",
    entityId: claim.id,
    action: "ratified",
    payload: {
      intentNodeId: intent.id,
      evidenceItemId: claim.evidenceItemId,
    },
    occurredAt,
    sensitivity: intentSensitivity,
  });

  await repository.saveIntentNode(intent);
  await repository.saveExtractedClaim(updatedClaim);
  await repository.saveKernelEvent(event);

  return { claim: updatedClaim, intent, event };
};

export const editClaim = async ({
  repository,
  claim,
  actorId,
  text,
  suggestedOwnerId,
  suggestedDueAt,
  sensitivity = claim.sensitivity,
  occurredAt,
}: EditClaimInput): Promise<ClaimTransitionResult> => {
  const editedSensitivity = inheritMostRestrictiveSensitivity([claim.sensitivity, sensitivity]);
  const editedClaim: ExtractedClaim = {
    ...claim,
    text,
    suggestedOwnerId,
    suggestedDueAt,
    sensitivity: editedSensitivity,
    state: "edited",
    updatedAt: occurredAt,
  };
  const event = kernelEvent({
    id: `event:${claim.id}:edited:${stableHash(`${text}:${occurredAt}`)}`,
    workspaceId: claim.workspaceId,
    actorId,
    entityType: "extracted_claim",
    entityId: claim.id,
    action: "edited",
    payload: {
      previousText: claim.text,
      text,
      suggestedOwnerId,
      suggestedDueAt,
    },
    occurredAt,
    sensitivity: editedSensitivity,
  });

  await repository.saveExtractedClaim(editedClaim);
  await repository.saveKernelEvent(event);

  return { claim: editedClaim, event };
};

export const rejectClaim = async ({
  repository,
  claim,
  actorId,
  reason,
  occurredAt,
}: RejectClaimInput): Promise<ClaimTransitionResult> => {
  const rejectedClaim: ExtractedClaim = {
    ...claim,
    state: "rejected",
    updatedAt: occurredAt,
  };
  const event = kernelEvent({
    id: `event:${claim.id}:rejected`,
    workspaceId: claim.workspaceId,
    actorId,
    entityType: "extracted_claim",
    entityId: claim.id,
    action: "rejected",
    payload: { reason },
    occurredAt,
    sensitivity: claim.sensitivity,
  });

  await repository.saveExtractedClaim(rejectedClaim);
  await repository.saveKernelEvent(event);

  return { claim: rejectedClaim, event };
};

export const mergeClaim = async ({
  repository,
  claim,
  actorId,
  intoIntentNodeId,
  reason,
  occurredAt,
}: MergeClaimInput): Promise<ClaimTransitionResult> => {
  const mergedClaim: ExtractedClaim = {
    ...claim,
    state: "merged",
    ratifiedNodeId: intoIntentNodeId,
    updatedAt: occurredAt,
  };
  const event = kernelEvent({
    id: `event:${claim.id}:merged`,
    workspaceId: claim.workspaceId,
    actorId,
    entityType: "extracted_claim",
    entityId: claim.id,
    action: "merged",
    payload: { intoIntentNodeId, reason },
    occurredAt,
    sensitivity: claim.sensitivity,
  });

  await repository.saveExtractedClaim(mergedClaim);
  await repository.saveKernelEvent(event);

  return { claim: mergedClaim, event };
};

const intentKindForClaim = (claimType: ExtractedClaimType): IntentNodeKind => {
  switch (claimType) {
    case "possible_commitment":
    case "ownership_signal":
    case "evidence_of_done":
      return "commitment";
    case "possible_decision":
      return "decision";
    case "blocker":
    case "risk":
      return "risk";
    case "possible_goal":
      return "goal";
    case "status_update":
      return "assumption";
  }
};

const suggestedOwnerForClaim = (
  evidence: EvidenceItem,
  claimType: ExtractedClaimType,
): string | undefined => {
  if (
    claimType === "possible_commitment" ||
    claimType === "ownership_signal" ||
    claimType === "evidence_of_done"
  ) {
    return evidence.actorId;
  }

  return undefined;
};

const extractDueDate = (body: string): string | undefined => {
  const match = /\bby\s+(\d{4}-\d{2}-\d{2})\b/i.exec(body);
  return match?.[1] === undefined ? undefined : `${match[1]}T23:59:59.000Z`;
};

const claimText = (evidence: EvidenceItem, claimType: ExtractedClaimType): string =>
  `${claimLabel(claimType)}: ${evidence.bodyExcerpt}`;

const claimLabel = (claimType: ExtractedClaimType): string => {
  switch (claimType) {
    case "possible_goal":
      return "Possible goal";
    case "possible_commitment":
      return "Possible commitment";
    case "possible_decision":
      return "Possible decision";
    case "blocker":
      return "Blocker";
    case "risk":
      return "Risk";
    case "status_update":
      return "Status update";
    case "ownership_signal":
      return "Ownership signal";
    case "evidence_of_done":
      return "Evidence of done";
  }
};

const titleFromClaim = (text: string): string => {
  const firstSentence = text.split(/[.!?]\s/)[0]?.trim() ?? text.trim();
  return firstSentence.length > 96 ? `${firstSentence.slice(0, 93)}...` : firstSentence;
};

const evidenceHashSource = (input: EvidenceIngestionInput): string =>
  [
    input.workspaceId,
    input.sourceSystem,
    input.sourceType,
    input.externalId,
    input.occurredAt,
    input.title,
    input.bodyExcerpt,
    input.sensitivity,
  ].join("\n");

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
