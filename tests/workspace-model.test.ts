import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type {
  WorkspaceOverlay,
  WorkspaceSourceSnapshot,
} from "../src/modules/workspace-model/index.ts";
import { compileWorkspaceModel } from "../src/modules/workspace-model/index.ts";

const snapshot: WorkspaceSourceSnapshot = {
  organization: {
    id: "acme",
    name: "Acme",
  },
  teams: [
    {
      id: "engineering",
      name: "Engineering",
      sourceRefs: [
        { system: "github", externalId: "Acme", confidence: "observed" },
        { system: "linear", externalId: "engineering", confidence: "inferred" },
      ],
      communication: [
        {
          system: "microsoft-teams",
          externalId: "Engineering General",
          purpose: "discussion",
          sourceConfidence: "observed",
        },
      ],
    },
    {
      id: "incident-response",
      name: "Incident Response",
      sourceRefs: [{ system: "github", externalId: "production", confidence: "observed" }],
      communication: [
        {
          system: "microsoft-teams",
          externalId: "Prod Incident War Room",
          purpose: "incident",
          sourceConfidence: "observed",
        },
      ],
    },
  ],
};

describe("compileWorkspaceModel", () => {
  it("infers internal source boundaries from Teams, Linear, and GitHub evidence", async () => {
    const overlay: WorkspaceOverlay = {
      version: 1,
      organizationId: "acme",
      teams: [],
    };

    const model = await Effect.runPromise(
      compileWorkspaceModel(snapshot, overlay, "2026-07-02T00:00:00.000Z"),
    );

    const engineering = model.teams.find((team) => team.id === "engineering");

    expect(engineering?.boundary).toMatchObject({
      sensitivity: "internal",
      minimumTrustTier: "member",
      modelEgress: "redact",
      requiresPreRetrievalAuthorization: true,
      requiresToolAuthorization: true,
    });
    expect(model.safetyInvariant).toBe("authorization-before-retrieval-tool-and-model-egress");
  });

  it("uses YAML overlay to tighten a team boundary", async () => {
    const overlay: WorkspaceOverlay = {
      version: 1,
      organizationId: "acme",
      teams: [
        {
          teamId: "engineering",
          sensitivity: "confidential",
          minimumTrustTier: "trusted",
          modelEgress: "approval-required",
          requiresHumanApproval: true,
          notes: "Engineering context includes private code and delivery commitments.",
        },
      ],
    };

    const model = await Effect.runPromise(
      compileWorkspaceModel(snapshot, overlay, "2026-07-02T00:00:00.000Z"),
    );

    const engineering = model.teams.find((team) => team.id === "engineering");

    expect(engineering).toMatchObject({
      overlayApplied: true,
      notes: "Engineering context includes private code and delivery commitments.",
      boundary: {
        sensitivity: "confidential",
        minimumTrustTier: "trusted",
        modelEgress: "approval-required",
        requiresHumanApproval: true,
      },
    });
  });

  it("keeps incident surfaces restricted even without an overlay", async () => {
    const model = await Effect.runPromise(
      compileWorkspaceModel(
        snapshot,
        { version: 1, organizationId: "acme", teams: [] },
        "2026-07-02T00:00:00.000Z",
      ),
    );

    const incidentResponse = model.teams.find((team) => team.id === "incident-response");

    expect(incidentResponse?.boundary).toMatchObject({
      sensitivity: "restricted",
      minimumTrustTier: "maintainer",
      modelEgress: "block",
      requiresHumanApproval: true,
    });
  });
});
