import { maxSensitivity, type SensitivityTier } from "../../domain/policy.ts";
import type {
  AccountabilityAction,
  DriftFinding,
  EvidenceItem,
  IntentNode,
  Projection,
} from "../strategy-kernel/index.ts";

export type StrategicReportKind =
  | "daily_delivery_brief"
  | "weekly_drift_review"
  | "stakeholder_update_draft"
  | "leadership_review";

export type StrategicReportInputs = {
  readonly workspaceId: string;
  readonly generatedAt?: string | undefined;
  readonly intents: readonly IntentNode[];
  readonly evidence: readonly EvidenceItem[];
  readonly projections: readonly Projection[];
  readonly actions: readonly AccountabilityAction[];
  readonly driftFindings: readonly DriftFinding[];
};

export type StrategicReportEntrySource =
  | "intent"
  | "evidence"
  | "projection"
  | "accountability_action"
  | "drift_finding";

export type StrategicReportEntry = {
  readonly source: StrategicReportEntrySource;
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly sensitivity: SensitivityTier;
  readonly externalUrl?: string | undefined;
};

export type StrategicReportSection = {
  readonly title: string;
  readonly entries: readonly StrategicReportEntry[];
};

export type StrategicReportTotals = {
  readonly intents: number;
  readonly evidence: number;
  readonly projections: number;
  readonly actions: number;
  readonly driftFindings: number;
};

export type StrategicExecutionReport = {
  readonly kind: StrategicReportKind;
  readonly workspaceId: string;
  readonly title: string;
  readonly visibility: SensitivityTier;
  readonly summary: string;
  readonly sections: readonly StrategicReportSection[];
  readonly totals: StrategicReportTotals;
  readonly generatedAt?: string | undefined;
};

type WorkspaceScopedReportInputs = StrategicReportInputs;

const isOpenAction = (action: AccountabilityAction): boolean =>
  !["done", "cancelled"].includes(action.state);

const isOpenDriftFinding = (finding: DriftFinding): boolean =>
  !["resolved", "superseded"].includes(finding.state);

const isDriftedProjection = (projection: Projection): boolean =>
  projection.driftStatus !== "in_sync";

const intentEntry = (intent: IntentNode): StrategicReportEntry => ({
  source: "intent",
  id: intent.id,
  label: `${intent.kind}: ${intent.title}`,
  text: intent.body,
  sensitivity: intent.sensitivity,
});

const evidenceEntry = (evidence: EvidenceItem): StrategicReportEntry => ({
  source: "evidence",
  id: evidence.id,
  label: `${evidence.sourceSystem}/${evidence.sourceType}: ${evidence.title}`,
  text: evidence.bodyExcerpt,
  sensitivity: evidence.sensitivity,
  ...(evidence.externalUrl === undefined ? {} : { externalUrl: evidence.externalUrl }),
});

const projectionEntry = (projection: Projection): StrategicReportEntry => ({
  source: "projection",
  id: projection.id,
  label: `${projection.targetSystem}/${projection.targetType}: ${projection.driftStatus}`,
  text:
    projection.targetId === undefined
      ? `Projection for intent ${projection.intentNodeId}.`
      : `Projection for intent ${projection.intentNodeId} targets ${projection.targetId}.`,
  sensitivity: projection.sensitivity,
  ...(projection.targetUrl === undefined ? {} : { externalUrl: projection.targetUrl }),
});

const actionEntry = (action: AccountabilityAction): StrategicReportEntry => ({
  source: "accountability_action",
  id: action.id,
  label: `${action.channel}: ${action.state}`,
  text:
    action.dueAt === undefined
      ? `Actor ${action.actorId} owns follow-up for intent ${action.intentNodeId}.`
      : `Actor ${action.actorId} owns follow-up for intent ${action.intentNodeId} by ${action.dueAt}.`,
  sensitivity: action.sensitivity,
});

const driftFindingEntry = (finding: DriftFinding): StrategicReportEntry => ({
  source: "drift_finding",
  id: finding.id,
  label: `${finding.findingType}: ${finding.title}`,
  text: finding.body,
  sensitivity: finding.sensitivity,
});

const countTotals = (inputs: WorkspaceScopedReportInputs): StrategicReportTotals => ({
  intents: inputs.intents.length,
  evidence: inputs.evidence.length,
  projections: inputs.projections.length,
  actions: inputs.actions.length,
  driftFindings: inputs.driftFindings.length,
});

const section = (
  title: string,
  entries: readonly StrategicReportEntry[],
): StrategicReportSection => ({
  title,
  entries,
});

const compactSections = (
  sections: readonly StrategicReportSection[],
): readonly StrategicReportSection[] =>
  sections.filter((candidate) => candidate.entries.length > 0);

const deriveWorkspaceScopedVisibility = (inputs: WorkspaceScopedReportInputs): SensitivityTier =>
  [
    ...inputs.intents,
    ...inputs.evidence,
    ...inputs.projections,
    ...inputs.actions,
    ...inputs.driftFindings,
  ]
    .map((item) => item.sensitivity)
    .reduce(maxSensitivity, "public");

const report = (
  inputs: StrategicReportInputs,
  kind: StrategicReportKind,
  title: string,
  summary: string,
  sections: readonly StrategicReportSection[],
): StrategicExecutionReport => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);
  const filteredSections = compactSections(sections);

  return {
    kind,
    workspaceId: scoped.workspaceId,
    title,
    visibility: deriveWorkspaceScopedVisibility(scoped),
    summary,
    sections: filteredSections,
    totals: countTotals(scoped),
    ...(scoped.generatedAt === undefined ? {} : { generatedAt: scoped.generatedAt }),
  };
};

export const filterStrategicReportInputsByWorkspace = (
  inputs: StrategicReportInputs,
): WorkspaceScopedReportInputs => ({
  ...inputs,
  intents: inputs.intents.filter((intent) => intent.workspaceId === inputs.workspaceId),
  evidence: inputs.evidence.filter((evidence) => evidence.workspaceId === inputs.workspaceId),
  projections: inputs.projections.filter(
    (projection) => projection.workspaceId === inputs.workspaceId,
  ),
  actions: inputs.actions.filter((action) => action.workspaceId === inputs.workspaceId),
  driftFindings: inputs.driftFindings.filter(
    (finding) => finding.workspaceId === inputs.workspaceId,
  ),
});

export const deriveStrategicReportVisibility = (inputs: StrategicReportInputs): SensitivityTier => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);

  return deriveWorkspaceScopedVisibility(scoped);
};

export const generateDailyDeliveryBrief = (
  inputs: StrategicReportInputs,
): StrategicExecutionReport => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);

  return report(
    scoped,
    "daily_delivery_brief",
    "Daily Delivery Brief",
    "Workspace-scoped execution focus, fresh evidence, accountability actions, and open drift.",
    [
      section(
        "Intent focus",
        scoped.intents
          .filter((intent) => ["active", "at_risk", "ratified"].includes(intent.state))
          .map(intentEntry),
      ),
      section("Evidence signals", scoped.evidence.map(evidenceEntry)),
      section("Accountability actions", scoped.actions.filter(isOpenAction).map(actionEntry)),
      section("Open drift", scoped.driftFindings.filter(isOpenDriftFinding).map(driftFindingEntry)),
    ],
  );
};

export const generateWeeklyDriftReview = (
  inputs: StrategicReportInputs,
): StrategicExecutionReport => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);

  return report(
    scoped,
    "weekly_drift_review",
    "Weekly Drift Review",
    "Workspace-scoped review of unresolved drift, projection divergence, and at-risk intent.",
    [
      section(
        "Open drift findings",
        scoped.driftFindings.filter(isOpenDriftFinding).map(driftFindingEntry),
      ),
      section(
        "Drifted projections",
        scoped.projections.filter(isDriftedProjection).map(projectionEntry),
      ),
      section(
        "At-risk or broken intent",
        scoped.intents
          .filter((intent) => ["at_risk", "broken", "dropped"].includes(intent.state))
          .map(intentEntry),
      ),
      section(
        "Silent or escalated actions",
        scoped.actions
          .filter((action) => ["silent", "escalated", "blocked"].includes(action.state))
          .map(actionEntry),
      ),
    ],
  );
};

export const generateStakeholderUpdateDraft = (
  inputs: StrategicReportInputs,
): StrategicExecutionReport => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);

  return report(
    scoped,
    "stakeholder_update_draft",
    "Stakeholder Update Draft",
    "Workspace-scoped narrative draft covering visible commitments, decisions, evidence, and next actions.",
    [
      section(
        "Commitments and decisions",
        scoped.intents
          .filter((intent) => ["goal", "commitment", "decision", "kpi"].includes(intent.kind))
          .map(intentEntry),
      ),
      section("Evidence to cite", scoped.evidence.map(evidenceEntry)),
      section("Next actions", scoped.actions.filter(isOpenAction).map(actionEntry)),
      section(
        "Risks to acknowledge",
        scoped.driftFindings.filter(isOpenDriftFinding).map(driftFindingEntry),
      ),
    ],
  );
};

export const generateLeadershipReview = (
  inputs: StrategicReportInputs,
): StrategicExecutionReport => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);

  return report(
    scoped,
    "leadership_review",
    "Leadership Review",
    "Workspace-scoped leadership view of goals, bets, risks, projection health, and accountability pressure.",
    [
      section(
        "Strategic intent",
        scoped.intents
          .filter((intent) => ["goal", "bet", "risk", "kpi", "policy"].includes(intent.kind))
          .map(intentEntry),
      ),
      section("Projection health", scoped.projections.map(projectionEntry)),
      section(
        "Escalation pressure",
        scoped.actions
          .filter((action) => ["silent", "escalated", "blocked", "pending"].includes(action.state))
          .map(actionEntry),
      ),
      section("Drift requiring leadership attention", scoped.driftFindings.map(driftFindingEntry)),
    ],
  );
};
