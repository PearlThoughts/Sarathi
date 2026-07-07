import type { WorkspaceSourceSnapshot } from "../modules/workspace-model/contracts.ts";

export const defaultSourceSnapshot: WorkspaceSourceSnapshot = {
  organization: {
    id: "acme",
    name: "Acme",
  },
  teams: [
    {
      id: "engineering",
      name: "Engineering",
      sourceRefs: [
        {
          system: "github",
          externalId: "Acme",
          confidence: "observed",
        },
        {
          system: "linear",
          externalId: "engineering-workspace",
          confidence: "inferred",
        },
      ],
      communication: [
        {
          system: "microsoft-teams",
          externalId: "engineering-general",
          purpose: "discussion",
          sourceConfidence: "observed",
        },
        {
          system: "github",
          externalId: "pull-requests",
          purpose: "review",
          sourceConfidence: "observed",
        },
      ],
    },
    {
      id: "delivery-operations",
      name: "Delivery Operations",
      sourceRefs: [
        {
          system: "jira",
          externalId: "delivery-board",
          confidence: "inferred",
        },
      ],
      communication: [
        {
          system: "microsoft-teams",
          externalId: "delivery-ops",
          purpose: "execution",
          sourceConfidence: "observed",
        },
      ],
    },
  ],
};
