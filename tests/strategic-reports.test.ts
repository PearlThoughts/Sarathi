import { describe, expect, it } from "vitest";
import {
  deriveStrategicReportVisibility,
  filterStrategicReportInputsByWorkspace,
  generateBoundarySafeStrategicReport,
  generateDailyDeliveryBrief,
  generateLeadershipReview,
  generateStakeholderUpdateDraft,
  generateWeeklyDriftReview,
  type StrategicExecutionReport,
  type StrategicReportBoundaryContext,
  StrategicReportBoundaryDeniedError,
  type StrategicReportEntry,
  type StrategicReportEntrySource,
  type StrategicReportInputs,
  type StrategicReportKind,
  type StrategicReportSection,
  type StrategicReportTotals,
} from "../src/modules/strategic-reports/index.ts";
import type {
  AccountabilityAction,
  DriftFinding,
  EvidenceItem,
  IntentNode,
  Projection,
} from "../src/modules/strategy-kernel/index.ts";

const now = "2026-07-09T12:00:00.000Z";
const workspaceA = "workspace-alpha";
const workspaceB = "workspace-beta";

const intent = (workspaceId: string, overrides: Partial<IntentNode> = {}): IntentNode => ({
  id: `${workspaceId}-intent`,
  workspaceId,
  kind: "goal",
  title: `${workspaceId} delivery goal`,
  body: `${workspaceId} delivery goal body`,
  state: "active",
  sensitivity: "internal",
  createdBy: "human",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const evidence = (workspaceId: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: `${workspaceId}-evidence`,
  workspaceId,
  sourceSystem: "teams",
  sourceType: "message",
  externalId: `${workspaceId}-message`,
  occurredAt: now,
  title: `${workspaceId} evidence`,
  bodyExcerpt: `${workspaceId} evidence excerpt`,
  contentHash: `${workspaceId}-hash`,
  sensitivity: "internal",
  ingestedAt: now,
  ...overrides,
});

const projection = (workspaceId: string, overrides: Partial<Projection> = {}): Projection => ({
  id: `${workspaceId}-projection`,
  workspaceId,
  intentNodeId: `${workspaceId}-intent`,
  targetSystem: "jira",
  targetType: "issue",
  targetId: `${workspaceId}-issue`,
  driftStatus: "in_sync",
  sensitivity: "public",
  ...overrides,
});

const action = (
  workspaceId: string,
  overrides: Partial<AccountabilityAction> = {},
): AccountabilityAction => ({
  id: `${workspaceId}-action`,
  workspaceId,
  intentNodeId: `${workspaceId}-intent`,
  actorId: `${workspaceId}-owner`,
  channel: "teams_channel",
  state: "pending",
  dueAt: "2026-07-10",
  escalationLevel: 0,
  evidenceRequired: true,
  sensitivity: "internal",
  ...overrides,
});

const driftFinding = (
  workspaceId: string,
  overrides: Partial<DriftFinding> = {},
): DriftFinding => ({
  id: `${workspaceId}-drift`,
  workspaceId,
  findingType: "stale_commitment",
  title: `${workspaceId} drift`,
  body: `${workspaceId} drift body`,
  state: "open",
  sensitivity: "internal",
  createdAt: now,
  ...overrides,
});

const reportText = (value: unknown): string => JSON.stringify(value);

describe("strategic reports", () => {
  it("filters every input collection to the requested workspace", () => {
    const kind: StrategicReportKind = "daily_delivery_brief";
    const source: StrategicReportEntrySource = "intent";
    const entry: StrategicReportEntry = {
      source,
      id: "entry-1",
      label: "Entry",
      text: "Entry text",
      sensitivity: "public",
    };
    const section: StrategicReportSection = {
      title: "Section",
      entries: [entry],
    };
    const totals: StrategicReportTotals = {
      intents: 0,
      evidence: 0,
      projections: 0,
      actions: 0,
      driftFindings: 0,
    };
    const publicReport: StrategicExecutionReport = {
      kind,
      workspaceId: workspaceB,
      title: "Contract check",
      visibility: "public",
      summary: "Contract check",
      sections: [section],
      totals,
    };
    const scoped = filterStrategicReportInputsByWorkspace({
      workspaceId: workspaceB,
      generatedAt: now,
      intents: [intent(workspaceA), intent(workspaceB)],
      evidence: [evidence(workspaceA), evidence(workspaceB)],
      projections: [projection(workspaceA), projection(workspaceB)],
      actions: [action(workspaceA), action(workspaceB)],
      driftFindings: [driftFinding(workspaceA), driftFinding(workspaceB)],
    });

    expect(publicReport.kind).toBe("daily_delivery_brief");
    expect(scoped.intents).toHaveLength(1);
    expect(scoped.evidence).toHaveLength(1);
    expect(scoped.projections).toHaveLength(1);
    expect(scoped.actions).toHaveLength(1);
    expect(scoped.driftFindings).toHaveLength(1);
    expect(scoped.intents[0]?.workspaceId).toBe(workspaceB);
    expect(scoped.evidence[0]?.workspaceId).toBe(workspaceB);
    expect(scoped.projections[0]?.workspaceId).toBe(workspaceB);
    expect(scoped.actions[0]?.workspaceId).toBe(workspaceB);
    expect(scoped.driftFindings[0]?.workspaceId).toBe(workspaceB);
  });

  it("does not let workspace A evidence appear in workspace B reports", () => {
    const inputs: StrategicReportInputs = {
      workspaceId: workspaceB,
      generatedAt: now,
      intents: [
        intent(workspaceA, {
          title: "Alpha restricted roadmap",
          body: "Alpha restricted intent body",
          sensitivity: "restricted",
        }),
        intent(workspaceB, {
          title: "Beta launch goal",
          body: "Beta launch intent body",
          sensitivity: "internal",
        }),
      ],
      evidence: [
        evidence(workspaceA, {
          title: "Alpha restricted evidence",
          bodyExcerpt: "Alpha restricted customer escalation should never leak",
          sensitivity: "restricted",
        }),
        evidence(workspaceB, {
          title: "Beta evidence",
          bodyExcerpt: "Beta has implementation evidence",
          sensitivity: "internal",
        }),
      ],
      projections: [
        projection(workspaceA, {
          targetId: "ALPHA-1",
          driftStatus: "conflicting",
          sensitivity: "restricted",
        }),
        projection(workspaceB),
      ],
      actions: [
        action(workspaceA, {
          state: "escalated",
          completionEvidenceId: `${workspaceA}-evidence`,
          sensitivity: "restricted",
        }),
        action(workspaceB, { completionEvidenceId: `${workspaceA}-evidence` }),
      ],
      driftFindings: [
        driftFinding(workspaceA, {
          title: "Alpha restricted drift",
          body: "Alpha restricted drift body",
          sensitivity: "restricted",
        }),
        driftFinding(workspaceB, {
          title: "Beta drift",
          body: "Beta drift body",
          sensitivity: "internal",
        }),
      ],
    };

    const reports = [
      generateDailyDeliveryBrief(inputs),
      generateWeeklyDriftReview(inputs),
      generateStakeholderUpdateDraft(inputs),
      generateLeadershipReview(inputs),
    ];

    for (const generatedReport of reports) {
      const text = reportText(generatedReport);

      expect(generatedReport.workspaceId).toBe(workspaceB);
      expect(generatedReport.visibility).toBe("internal");
      expect(text).toContain("Beta");
      expect(text).not.toContain("Alpha");
      expect(text).not.toContain("ALPHA-1");
      expect(text).not.toContain("restricted customer escalation");
      expect(generatedReport.totals).toEqual({
        intents: 1,
        evidence: 1,
        projections: 1,
        actions: 1,
        driftFindings: 1,
      });
    }
  });

  it("derives the most restrictive visibility from included workspace records only", () => {
    const inputs: StrategicReportInputs = {
      workspaceId: workspaceA,
      intents: [intent(workspaceA, { sensitivity: "internal" }), intent(workspaceB)],
      evidence: [
        evidence(workspaceA, { sensitivity: "confidential" }),
        evidence(workspaceB, { sensitivity: "restricted" }),
      ],
      projections: [projection(workspaceA, { sensitivity: "public" })],
      actions: [action(workspaceA, { sensitivity: "restricted" })],
      driftFindings: [driftFinding(workspaceA, { sensitivity: "internal" })],
    };

    expect(deriveStrategicReportVisibility(inputs)).toBe("restricted");
  });

  it("rejects cross-workspace inputs before report rendering", () => {
    const privateText = "Invented cross-workspace detail must stay private";
    const inputs: StrategicReportInputs = {
      workspaceId: workspaceB,
      intents: [intent(workspaceB)],
      evidence: [
        evidence(workspaceA, {
          bodyExcerpt: privateText,
          sensitivity: "restricted",
        }),
      ],
      projections: [],
      actions: [],
      driftFindings: [],
    };

    try {
      generateBoundarySafeStrategicReport("daily_delivery_brief", inputs, {
        subject: {
          principalId: "operator-1",
          trustTier: "maintainer",
          authorizedWorkspaceIds: [workspaceB],
        },
        audience: {
          kind: "workspace",
          workspaceId: workspaceB,
          maximumSensitivity: "restricted",
        },
        consent: "granted",
        actionAuthorization: "granted",
      });
      throw new Error("Expected cross-workspace report generation to be denied.");
    } catch (error) {
      expect(error).toBeInstanceOf(StrategicReportBoundaryDeniedError);
      expect(error).toMatchObject({ reasonCode: "workspace-denied" });
      expect(String(error)).not.toContain(privateText);
    }
  });

  it("rejects a report when strictest input sensitivity exceeds the audience ceiling", () => {
    const restrictedText = "Invented restricted evidence must not reach the audience";
    const inputs: StrategicReportInputs = {
      workspaceId: workspaceA,
      intents: [intent(workspaceA, { sensitivity: "internal" })],
      evidence: [
        evidence(workspaceA, {
          bodyExcerpt: restrictedText,
          sensitivity: "restricted",
        }),
      ],
      projections: [],
      actions: [],
      driftFindings: [],
    };

    try {
      generateBoundarySafeStrategicReport("stakeholder_update_draft", inputs, {
        subject: {
          principalId: "operator-1",
          trustTier: "maintainer",
          authorizedWorkspaceIds: [workspaceA],
        },
        audience: {
          kind: "external",
          maximumSensitivity: "public",
        },
        consent: "granted",
        actionAuthorization: "granted",
      });
      throw new Error("Expected lower-sensitivity report generation to be denied.");
    } catch (error) {
      expect(error).toBeInstanceOf(StrategicReportBoundaryDeniedError);
      expect(error).toMatchObject({ reasonCode: "audience-sensitivity-denied" });
      expect(String(error)).not.toContain(restrictedText);
    }
  });

  it("generates an authorized workspace report with inherited visibility", () => {
    const boundaryContext: StrategicReportBoundaryContext = {
      subject: {
        principalId: "operator-1",
        trustTier: "trusted",
        authorizedWorkspaceIds: [workspaceA],
      },
      audience: {
        kind: "organization",
        maximumSensitivity: "confidential",
      },
      consent: "granted",
      actionAuthorization: "granted",
    };
    const report = generateBoundarySafeStrategicReport(
      "leadership_review",
      {
        workspaceId: workspaceA,
        intents: [intent(workspaceA, { sensitivity: "internal" })],
        evidence: [],
        projections: [projection(workspaceA, { sensitivity: "confidential" })],
        actions: [],
        driftFindings: [],
      },
      boundaryContext,
    );

    expect(report.workspaceId).toBe(workspaceA);
    expect(report.visibility).toBe("confidential");
  });
});
