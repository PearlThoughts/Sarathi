import { z } from "zod";
import { stableSha256 } from "../../../domain/hash.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import {
  type ProductEntityId,
  type ProductEntityKind,
  type ProductExternalReferenceKind,
  type ProductRelation,
  type ProductRelationEndpoint,
  type ProductRelationType,
  productRelationPolicies,
} from "../domain/product-model.ts";
import type { ProductHierarchyNode } from "../ports/product-model-graph-repository.ts";
import type { ProductModelCommand, ProductModelMutationBody } from "./product-model-commands.ts";

const safeKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/u);
const nonBlank = z.string().trim().min(1);
const sensitivity = z.enum(["public", "internal", "confidential", "restricted"]);

const sourceSchema = z
  .object({
    authorization: z.literal("explicit"),
    sourceClass: nonBlank,
    sourceFingerprint: z.string().regex(/^sha256-[a-f0-9]{64}$/u),
    audience: nonBlank,
    sensitivity,
    observedAt: z.iso.datetime(),
    evidenceReference: nonBlank,
  })
  .strict();

const proposalSchema = z
  .object({
    proposalId: z.string().regex(/^sha256-[a-f0-9]{64}$/u),
    workspaceKey: nonBlank,
    proposalKind: z.enum(["entity", "relation", "variant", "invariant"]),
    candidateKey: safeKey,
    status: z.literal("proposal"),
    registration: z.literal("candidate"),
    requiresHumanRatification: z.literal(true),
    contested: z.boolean(),
    candidatePayloads: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
    sources: z.array(sourceSchema).min(1).max(20),
  })
  .strict();

const proposalBatchSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal("proposals-only"),
    workspaceKey: nonBlank,
    proposals: z.array(proposalSchema).min(1).max(2_000),
  })
  .strict()
  .superRefine((batch, context) => {
    const identities = new Set<string>();
    for (const [index, proposal] of batch.proposals.entries()) {
      if (proposal.workspaceKey !== batch.workspaceKey)
        context.addIssue({
          code: "custom",
          path: ["proposals", index, "workspaceKey"],
          message: "proposal workspace must match the batch workspace",
        });
      const identity = `${proposal.proposalKind}\u0000${proposal.candidateKey}`;
      if (identities.has(identity))
        context.addIssue({
          code: "custom",
          path: ["proposals", index, "candidateKey"],
          message: "proposal identity must be unique within the batch",
        });
      identities.add(identity);
    }
  });

const relationType = z.enum([
  "depends_on",
  "enables",
  "conflicts_with",
  "alternative_to",
  "supersedes",
  "implements",
  "contributes_to",
  "governed_by",
  "affected_by",
  "realized_by",
  "exposed_by",
  "configured_by",
  "deployed_as",
  "observed_by",
  "verified_by",
  "constrained_by",
  "available_to",
  "variant_of",
]);

const externalReferenceKind = z.enum([
  "delivery",
  "intent",
  "technical",
  "runtime",
  "evidence",
  "policy",
  "availability",
]);

const relationMapSchema = z
  .object({
    version: z.literal(1),
    relationTypes: z.record(
      nonBlank,
      z
        .object({
          type: relationType,
          direction: z.enum(["forward", "reverse"]).default("forward"),
          externalReferenceKind: externalReferenceKind.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const entityPayloadSchema = z
  .object({
    key: safeKey,
    kind: z.enum(["product", "area", "capability", "feature"]),
    name: nonBlank,
    parent: safeKey.optional(),
    aliases: z.array(nonBlank).max(100).default([]),
    definition: nonBlank,
    exclusions: z.array(nonBlank).max(100).default([]),
    registration: z.literal("candidate"),
    audience: nonBlank,
    sensitivity,
    observedAt: z.iso.datetime(),
  })
  .strict();

const relationPayloadSchema = z
  .object({
    key: safeKey,
    type: nonBlank,
    source: safeKey,
    target: safeKey.optional(),
    externalTarget: nonBlank.optional(),
    definition: nonBlank,
    registration: z.literal("candidate"),
    audience: nonBlank,
    sensitivity,
    observedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => (value.target === undefined) !== (value.externalTarget === undefined), {
    message: "relation must contain exactly one entity or external target",
  });

type ProductRegistryProposalBatch = z.infer<typeof proposalBatchSchema>;
type ProductRegistryRelationMap = z.infer<typeof relationMapSchema>;

export type ProductRegistryImportCurrentState = {
  readonly revision: number;
  readonly entities: readonly ProductHierarchyNode[];
  readonly relations: readonly ProductRelation[];
  readonly aliasesByEntityId: Readonly<Record<string, readonly string[]>>;
};

export type ProductRegistryImportDisposition = {
  readonly proposalId: string;
  readonly proposalKind: "entity" | "relation" | "variant" | "invariant";
  readonly candidateKey: string;
  readonly status: "will-import" | "already-current" | "deferred";
  readonly reason: string;
  readonly entityId?: ProductEntityId | undefined;
};

export type ProductRegistryImportPlannedCommand = {
  readonly proposalId: string;
  readonly candidateKey: string;
  readonly command: ProductModelCommand;
};

export type ProductRegistryImportPlan = {
  readonly version: 1;
  readonly mode: "governed-commands";
  readonly sourceWorkspaceKey: string;
  readonly targetWorkspaceId: string;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly planFingerprint: string;
  readonly commands: readonly ProductRegistryImportPlannedCommand[];
  readonly dispositions: readonly ProductRegistryImportDisposition[];
  readonly impact: {
    readonly proposalCount: number;
    readonly commandCount: number;
    readonly changedEntityIds: readonly ProductEntityId[];
    readonly plannedChangedEntityCount: number;
    readonly visibleEntityImpactCount: null;
    readonly hiddenEntityImpactCount: null;
    readonly deferredProposalCount: number;
  };
};

export const parseProductRegistryProposalBatch = (value: unknown): ProductRegistryProposalBatch =>
  proposalBatchSchema.parse(value);

export const parseProductRegistryRelationMap = (value: unknown): ProductRegistryRelationMap =>
  relationMapSchema.parse(value);

const deterministicImportUuid = (
  workspaceKey: string,
  category: string,
  candidateKey: string,
): string => {
  const hex = stableSha256(`${workspaceKey}\u0000${category}\u0000${candidateKey}`)
    .slice("sha256-".length, "sha256-".length + 32)
    .split("");
  hex[12] = "8";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex
    .slice(12, 16)
    .join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export const productRegistryEntityId = (
  workspaceKey: string,
  candidateKey: string,
): ProductEntityId =>
  deterministicImportUuid(workspaceKey, "entity", candidateKey) as ProductEntityId;

const descriptionFor = (definition: string, exclusions: readonly string[]): string =>
  exclusions.length === 0 ? definition : `${definition}\n\nExcludes: ${exclusions.join("; ")}`;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const provenanceFor = (proposal: ProductRegistryProposalBatch["proposals"][number]): string => {
  const sources = proposal.sources.map((source) => ({
    sourceClass: source.sourceClass,
    sourceFingerprint: source.sourceFingerprint,
    audience: source.audience,
    sensitivity: source.sensitivity,
    observedAt: source.observedAt,
    evidenceReference: source.evidenceReference,
  }));
  return canonical(sources);
};

const commandJustification = (
  justification: string,
  proposal: ProductRegistryProposalBatch["proposals"][number],
): string => {
  const value = `${justification.trim()} Proposal ${proposal.proposalId}; provenance ${provenanceFor(
    proposal,
  )}`;
  if (value.length > 4_000)
    throw new Error(
      `Proposal ${proposal.proposalId} provenance exceeds command justification bounds.`,
    );
  return value;
};

const idempotencyKey = (workspaceKey: string, proposalId: string, operation: string): string =>
  `registry-import:${stableSha256(`${workspaceKey}\u0000${proposalId}\u0000${operation}`).slice(
    "sha256-".length,
    "sha256-".length + 40,
  )}`;

const sameEndpoint = (left: ProductRelationEndpoint, right: ProductRelationEndpoint): boolean =>
  canonical(left) === canonical(right);

const entityPayloads = (
  batch: ProductRegistryProposalBatch,
): ReadonlyMap<string, z.infer<typeof entityPayloadSchema>> => {
  const values = new Map<string, z.infer<typeof entityPayloadSchema>>();
  for (const proposal of batch.proposals) {
    if (
      proposal.proposalKind !== "entity" ||
      proposal.contested ||
      proposal.candidatePayloads.length !== 1
    )
      continue;
    const parsed = entityPayloadSchema.safeParse(proposal.candidatePayloads[0]);
    if (parsed.success) values.set(proposal.candidateKey, parsed.data);
  }
  return values;
};

const topologicalEntityKeys = (
  payloads: ReadonlyMap<string, z.infer<typeof entityPayloadSchema>>,
  existingKeys: ReadonlySet<string>,
): readonly string[] => {
  const ordered: string[] = [];
  const available = new Set(existingKeys);
  const pending = new Map(payloads);
  while (pending.size > 0) {
    const selectable = [...pending.entries()]
      .filter(([, payload]) => payload.parent === undefined || available.has(payload.parent))
      .sort(([left], [right]) => left.localeCompare(right));
    if (selectable.length === 0) break;
    for (const [key] of selectable) {
      ordered.push(key);
      available.add(key);
      pending.delete(key);
    }
  }
  return ordered;
};

const endpointFor = (
  entityIds: ReadonlyMap<string, ProductEntityId>,
  key: string,
): ProductRelationEndpoint | undefined => {
  const entityId = entityIds.get(key);
  return entityId === undefined ? undefined : { kind: "entity", entityId };
};

const relationEndpoints = (
  payload: z.infer<typeof relationPayloadSchema>,
  mapping: ProductRegistryRelationMap["relationTypes"][string],
  entityIds: ReadonlyMap<string, ProductEntityId>,
):
  | { readonly source: ProductRelationEndpoint; readonly target: ProductRelationEndpoint }
  | undefined => {
  const source = endpointFor(entityIds, payload.source);
  const target =
    payload.target === undefined
      ? mapping?.externalReferenceKind === undefined || payload.externalTarget === undefined
        ? undefined
        : {
            kind: "external" as const,
            referenceKind: mapping.externalReferenceKind as ProductExternalReferenceKind,
            referenceId: payload.externalTarget,
          }
      : endpointFor(entityIds, payload.target);
  if (source === undefined || target === undefined) return undefined;
  return mapping?.direction === "reverse" ? { source: target, target: source } : { source, target };
};

const validRelationEndpoints = (
  type: ProductRelationType,
  endpoints: { readonly source: ProductRelationEndpoint; readonly target: ProductRelationEndpoint },
): boolean => {
  const policy = productRelationPolicies[type];
  if (policy.source.kind !== endpoints.source.kind || policy.target.kind !== endpoints.target.kind)
    return false;
  if (
    endpoints.source.kind === "external" &&
    policy.source.kind === "external" &&
    !policy.source.referenceKinds.includes(endpoints.source.referenceKind)
  )
    return false;
  if (
    endpoints.target.kind === "external" &&
    policy.target.kind === "external" &&
    !policy.target.referenceKinds.includes(endpoints.target.referenceKind)
  )
    return false;
  return true;
};

export const planProductRegistryImport = (input: {
  readonly batch: ProductRegistryProposalBatch;
  readonly relationMap: ProductRegistryRelationMap;
  readonly current: ProductRegistryImportCurrentState;
  readonly targetWorkspaceId: string;
  readonly validFrom: string;
  readonly justification: string;
}): ProductRegistryImportPlan => {
  if (input.targetWorkspaceId.trim() === "") throw new Error("Target workspace is required.");
  if (!Number.isFinite(Date.parse(input.validFrom)))
    throw new Error("Import valid time is invalid.");
  if (input.justification.trim().length < 8) throw new Error("Import justification is too short.");

  const dispositions = new Map<string, ProductRegistryImportDisposition>();
  const entityIds = new Map<string, ProductEntityId>();
  for (const proposal of input.batch.proposals)
    if (proposal.proposalKind === "entity")
      entityIds.set(
        proposal.candidateKey,
        productRegistryEntityId(input.batch.workspaceKey, proposal.candidateKey),
      );

  const currentById = new Map(input.current.entities.map((entity) => [entity.entityId, entity]));
  const currentCandidateKeys = new Set(
    [...entityIds.entries()]
      .filter(([, entityId]) => currentById.has(entityId))
      .map(([candidateKey]) => candidateKey),
  );
  const payloads = entityPayloads(input.batch);
  const orderedKeys = topologicalEntityKeys(payloads, currentCandidateKeys);
  const commands: ProductRegistryImportPlannedCommand[] = [];
  let revision = input.current.revision;

  const addCommand = (
    proposal: ProductRegistryProposalBatch["proposals"][number],
    operation: string,
    body: ProductModelMutationBody,
  ): void => {
    commands.push({
      proposalId: proposal.proposalId,
      candidateKey: proposal.candidateKey,
      command: {
        ...body,
        workspaceId: input.targetWorkspaceId,
        expectedRevision: revision,
        idempotencyKey: idempotencyKey(input.batch.workspaceKey, proposal.proposalId, operation),
        justification: commandJustification(input.justification, proposal),
        validFrom: input.validFrom,
      },
    });
    revision += 1;
  };

  for (const proposal of input.batch.proposals) {
    if (
      proposal.proposalKind === "entity" &&
      (proposal.contested || proposal.candidatePayloads.length !== 1)
    )
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "contested-proposal",
      });
    else if (proposal.proposalKind === "entity" && !payloads.has(proposal.candidateKey))
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "invalid-entity-payload",
      });
  }

  for (const candidateKey of orderedKeys) {
    const payload = payloads.get(candidateKey);
    const proposal = input.batch.proposals.find(
      (candidate) => candidate.proposalKind === "entity" && candidate.candidateKey === candidateKey,
    );
    const entityId = entityIds.get(candidateKey);
    if (payload === undefined || proposal === undefined || entityId === undefined) continue;
    const parentId = payload.parent === undefined ? undefined : entityIds.get(payload.parent);
    if (payload.parent !== undefined && parentId === undefined) {
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey,
        status: "deferred",
        reason: "parent-entity-unavailable",
      });
      continue;
    }
    const current = currentById.get(entityId);
    if (current !== undefined) {
      if (
        current.kind !== payload.kind ||
        current.canonicalName !== payload.name ||
        current.description !== descriptionFor(payload.definition, payload.exclusions) ||
        current.parentId !== parentId ||
        current.lifecycle !== "unknown" ||
        current.sensitivity !== payload.sensitivity ||
        canonical(current.audience) !== canonical([payload.audience]) ||
        canonical([...(input.current.aliasesByEntityId[entityId] ?? [])].sort()) !==
          canonical([payload.name, ...payload.aliases].sort())
      ) {
        dispositions.set(proposal.proposalId, {
          proposalId: proposal.proposalId,
          proposalKind: proposal.proposalKind,
          candidateKey,
          status: "deferred",
          reason: "existing-entity-conflict",
          entityId,
        });
        continue;
      }
      if (current.registration === "ratified") {
        dispositions.set(proposal.proposalId, {
          proposalId: proposal.proposalId,
          proposalKind: proposal.proposalKind,
          candidateKey,
          status: "already-current",
          reason: "matching-ratified-entity",
          entityId,
        });
        continue;
      }
      if (current.registration === "candidate") {
        addCommand(proposal, "ratify", { type: "RatifyEntity", targetId: entityId });
        dispositions.set(proposal.proposalId, {
          proposalId: proposal.proposalId,
          proposalKind: proposal.proposalKind,
          candidateKey,
          status: "will-import",
          reason: "ratify-existing-candidate",
          entityId,
        });
        continue;
      }
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey,
        status: "deferred",
        reason: "existing-entity-registration-conflict",
        entityId,
      });
      continue;
    }

    addCommand(proposal, "propose", {
      type: "ProposeEntity",
      targetId: entityId,
      payload: {
        kind: payload.kind as ProductEntityKind,
        canonicalName: payload.name,
        description: descriptionFor(payload.definition, payload.exclusions),
        lifecycle: "unknown",
        sensitivity: payload.sensitivity as SensitivityTier,
        audience: [payload.audience],
        canonicalAliasId: deterministicImportUuid(
          input.batch.workspaceKey,
          "canonical-alias",
          candidateKey,
        ),
        aliases: payload.aliases.map((value, index) => ({
          id: deterministicImportUuid(
            input.batch.workspaceKey,
            "alternate-alias",
            `${candidateKey}:${index}:${value}`,
          ),
          value,
          kind: "alternate" as const,
          sourceClass: proposal.sources[0]?.sourceClass,
        })),
        ...(parentId === undefined ? {} : { parentId }),
      },
    });
    addCommand(proposal, "ratify", { type: "RatifyEntity", targetId: entityId });
    dispositions.set(proposal.proposalId, {
      proposalId: proposal.proposalId,
      proposalKind: proposal.proposalKind,
      candidateKey,
      status: "will-import",
      reason: "propose-and-ratify",
      entityId,
    });
  }

  for (const proposal of input.batch.proposals) {
    if (proposal.proposalKind !== "entity" || dispositions.has(proposal.proposalId)) continue;
    dispositions.set(proposal.proposalId, {
      proposalId: proposal.proposalId,
      proposalKind: proposal.proposalKind,
      candidateKey: proposal.candidateKey,
      status: "deferred",
      reason: "unresolved-hierarchy",
    });
  }

  for (const proposal of input.batch.proposals) {
    if (proposal.proposalKind !== "relation") continue;
    if (proposal.contested || proposal.candidatePayloads.length !== 1) {
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "contested-proposal",
      });
      continue;
    }
    const parsed = relationPayloadSchema.safeParse(proposal.candidatePayloads[0]);
    if (!parsed.success) {
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "invalid-relation-payload",
      });
      continue;
    }
    const mapping = input.relationMap.relationTypes[parsed.data.type];
    if (mapping === undefined) {
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "unmapped-relation-type",
      });
      continue;
    }
    const endpoints = relationEndpoints(parsed.data, mapping, entityIds);
    if (endpoints === undefined || !validRelationEndpoints(mapping.type, endpoints)) {
      dispositions.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        proposalKind: proposal.proposalKind,
        candidateKey: proposal.candidateKey,
        status: "deferred",
        reason: "incompatible-relation-resolution",
      });
      continue;
    }
    const relationId = deterministicImportUuid(
      input.batch.workspaceKey,
      "relation",
      proposal.candidateKey,
    );
    const current = input.current.relations.find(({ id }) => id === relationId);
    if (current !== undefined) {
      if (
        current.type === mapping.type &&
        sameEndpoint(current.source, endpoints.source) &&
        sameEndpoint(current.target, endpoints.target) &&
        current.registration === "ratified" &&
        current.sourceClass === (proposal.sources[0]?.sourceClass ?? "proposal") &&
        current.sensitivity === parsed.data.sensitivity &&
        canonical(current.audience) === canonical([parsed.data.audience])
      ) {
        dispositions.set(proposal.proposalId, {
          proposalId: proposal.proposalId,
          proposalKind: proposal.proposalKind,
          candidateKey: proposal.candidateKey,
          status: "already-current",
          reason: "matching-ratified-relation",
        });
      } else {
        dispositions.set(proposal.proposalId, {
          proposalId: proposal.proposalId,
          proposalKind: proposal.proposalKind,
          candidateKey: proposal.candidateKey,
          status: "deferred",
          reason: "existing-relation-conflict",
        });
      }
      continue;
    }
    addCommand(proposal, "add-relation", {
      type: "AddRelation",
      payload: {
        id: relationId,
        type: mapping.type,
        source: endpoints.source,
        target: endpoints.target,
        registration: "ratified",
        sourceClass: proposal.sources[0]?.sourceClass ?? "proposal",
        sensitivity: parsed.data.sensitivity as SensitivityTier,
        audience: [parsed.data.audience],
      },
    });
    dispositions.set(proposal.proposalId, {
      proposalId: proposal.proposalId,
      proposalKind: proposal.proposalKind,
      candidateKey: proposal.candidateKey,
      status: "will-import",
      reason: "add-ratified-relation",
    });
  }

  for (const proposal of input.batch.proposals) {
    if (dispositions.has(proposal.proposalId)) continue;
    dispositions.set(proposal.proposalId, {
      proposalId: proposal.proposalId,
      proposalKind: proposal.proposalKind,
      candidateKey: proposal.candidateKey,
      status: "deferred",
      reason: "unsupported-governed-command",
    });
  }

  const orderedDispositions = input.batch.proposals.map((proposal) => {
    const disposition = dispositions.get(proposal.proposalId);
    if (disposition === undefined)
      throw new Error(`Proposal ${proposal.proposalId} is missing an explicit disposition.`);
    return disposition;
  });
  const changedEntityIds = [
    ...new Set(
      orderedDispositions.flatMap((disposition) =>
        disposition.status === "will-import" && disposition.entityId !== undefined
          ? [disposition.entityId]
          : [],
      ),
    ),
  ].sort();
  const planWithoutFingerprint = {
    version: 1 as const,
    mode: "governed-commands" as const,
    sourceWorkspaceKey: input.batch.workspaceKey,
    targetWorkspaceId: input.targetWorkspaceId,
    expectedRevision: input.current.revision,
    resultingRevision: revision,
    commands,
    dispositions: orderedDispositions,
    impact: {
      proposalCount: input.batch.proposals.length,
      commandCount: commands.length,
      changedEntityIds,
      plannedChangedEntityCount: changedEntityIds.length,
      visibleEntityImpactCount: null,
      hiddenEntityImpactCount: null,
      deferredProposalCount: orderedDispositions.filter(({ status }) => status === "deferred")
        .length,
    },
  };
  return {
    ...planWithoutFingerprint,
    planFingerprint: stableSha256(canonical(planWithoutFingerprint)),
  };
};
