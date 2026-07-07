import { Effect } from "effect";
import { ValidationError } from "../../../domain/errors.ts";
import {
  defaultBoundaryForSensitivity,
  maxSensitivity,
  maxTrustTier,
  type PolicyBoundary,
  type SensitivityTier,
} from "../../../domain/policy.ts";
import type {
  CompiledTeamModel,
  CompiledWorkspaceModel,
  OperatingTeam,
  TeamOverlay,
  WorkspaceOverlay,
  WorkspaceSourceSnapshot,
} from "../domain/workspace-model.ts";

const inferSensitivity = (team: OperatingTeam): SensitivityTier => {
  if (team.declaredSensitivity !== undefined) {
    return team.declaredSensitivity;
  }

  const hasIncidentSurface = team.communication.some((surface) => surface.purpose === "incident");
  const hasExecutionSurface = team.communication.some((surface) => surface.purpose === "execution");
  const hasPrivateSystem = team.sourceRefs.some((source) =>
    ["github", "jira", "linear"].includes(source.system),
  );

  if (hasIncidentSurface) {
    return "restricted";
  }

  if (hasExecutionSurface || hasPrivateSystem) {
    return "internal";
  }

  return "public";
};

const applyOverlay = (base: PolicyBoundary, overlay: TeamOverlay | undefined): PolicyBoundary => {
  if (overlay === undefined) {
    return base;
  }

  const overlaySensitivity = overlay.sensitivity ?? base.sensitivity;
  const sensitivity = maxSensitivity(base.sensitivity, overlaySensitivity);
  const sensitivityDefaults = defaultBoundaryForSensitivity(sensitivity);

  return {
    sensitivity,
    minimumTrustTier:
      overlay.minimumTrustTier === undefined
        ? maxTrustTier(base.minimumTrustTier, sensitivityDefaults.minimumTrustTier)
        : maxTrustTier(overlay.minimumTrustTier, sensitivityDefaults.minimumTrustTier),
    allowedDelegationStages:
      overlay.allowedDelegationStages ?? sensitivityDefaults.allowedDelegationStages,
    modelEgress: overlay.modelEgress ?? sensitivityDefaults.modelEgress,
    requiresHumanApproval:
      overlay.requiresHumanApproval ?? sensitivityDefaults.requiresHumanApproval,
    requiresPreRetrievalAuthorization: true,
    requiresToolAuthorization: true,
  };
};

const compileTeam = (team: OperatingTeam, overlay: TeamOverlay | undefined): CompiledTeamModel => {
  const declaredSensitivity = inferSensitivity(team);
  const boundary = applyOverlay(defaultBoundaryForSensitivity(declaredSensitivity), overlay);

  return {
    id: team.id,
    name: overlay?.displayName ?? team.name,
    sourceRefs: team.sourceRefs,
    communication: team.communication,
    boundary,
    overlayApplied: overlay !== undefined,
    ...(overlay?.notes === undefined ? {} : { notes: overlay.notes }),
  };
};

export const compileWorkspaceModel = (
  snapshot: WorkspaceSourceSnapshot,
  overlay: WorkspaceOverlay,
  generatedAt: string = new Date().toISOString(),
): Effect.Effect<CompiledWorkspaceModel, ValidationError> =>
  Effect.gen(function* () {
    if (snapshot.organization.id !== overlay.organizationId) {
      return yield* Effect.fail(
        new ValidationError({
          field: "organizationId",
          message: "workspace overlay organizationId must match the source snapshot",
        }),
      );
    }

    const teamIds = new Set(snapshot.teams.map((team) => team.id));
    const unknownOverlay = overlay.teams.find((team) => !teamIds.has(team.teamId));

    if (unknownOverlay !== undefined) {
      return yield* Effect.fail(
        new ValidationError({
          field: "teams.teamId",
          message: `workspace overlay references unknown team ${unknownOverlay.teamId}`,
        }),
      );
    }

    const overlaysByTeam = new Map(overlay.teams.map((team) => [team.teamId, team]));

    return {
      organization: snapshot.organization,
      teams: snapshot.teams.map((team) => compileTeam(team, overlaysByTeam.get(team.id))),
      generatedAt,
      safetyInvariant: "authorization-before-retrieval-tool-and-model-egress",
    };
  });
