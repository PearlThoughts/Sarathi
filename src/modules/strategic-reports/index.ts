import {
  defaultBoundaryForSensitivity,
  isSensitivityAtOrBelow,
  maxSensitivity,
  type SensitivityTier,
} from "../../domain/policy.ts";
import {
  type BoundaryAudience,
  type BoundaryAuthorizationStatus,
  type BoundaryDecisionReason,
  type BoundarySubject,
  evaluateBoundaryAccess,
} from "../boundary-policy/index.ts";
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

export type StrategicReportBoundaryContext = {
  readonly subject: BoundarySubject;
  readonly audience: BoundaryAudience;
  readonly consent: BoundaryAuthorizationStatus;
  readonly actionAuthorization: BoundaryAuthorizationStatus;
};

export class StrategicReportBoundaryDeniedError extends Error {
  readonly reasonCode: BoundaryDecisionReason;

  constructor(reasonCode: BoundaryDecisionReason, reason: string) {
    super(`Strategic report access denied: ${reason}`);
    this.name = "StrategicReportBoundaryDeniedError";
    this.reasonCode = reasonCode;
  }
}

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

const isActiveIntent = (intent: IntentNode): boolean =>
  ["candidate", "ratified", "active", "at_risk"].includes(intent.state);

const isFinishedIntent = (intent: IntentNode): boolean =>
  ["dropped", "superseded", "archived"].includes(intent.state);

const isWorkEvidence = (evidence: EvidenceItem): boolean =>
  ["issue", "pull_request", "commit", "event"].includes(evidence.sourceType);

const stableDriftId = (
  workspaceId: string,
  findingType: DriftFinding["findingType"],
  relatedEntityId: string,
): string => `drift-${workspaceId}-${findingType}-${relatedEntityId}`;

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

const deriveRenderedVisibility = (sections: readonly StrategicReportSection[]): SensitivityTier =>
  sections
    .flatMap((candidate) => candidate.entries)
    .map((entry) => entry.sensitivity)
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
    visibility: deriveRenderedVisibility(filteredSections),
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

export const filterStrategicReportInputsBySensitivity = (
  inputs: StrategicReportInputs,
  maximumSensitivity: SensitivityTier,
): WorkspaceScopedReportInputs => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);
  const allowed = (sensitivity: SensitivityTier): boolean =>
    isSensitivityAtOrBelow(sensitivity, maximumSensitivity);

  return {
    ...scoped,
    intents: scoped.intents.filter((intent) => allowed(intent.sensitivity)),
    evidence: scoped.evidence.filter((evidence) => allowed(evidence.sensitivity)),
    projections: scoped.projections.filter((projection) => allowed(projection.sensitivity)),
    actions: scoped.actions.filter((action) => allowed(action.sensitivity)),
    driftFindings: scoped.driftFindings.filter((finding) => allowed(finding.sensitivity)),
  };
};

const deriveWeeklyDriftFindings = (inputs: StrategicReportInputs): readonly DriftFinding[] => {
  const scoped = filterStrategicReportInputsByWorkspace(inputs);
  const generatedAt = inputs.generatedAt ?? new Date().toISOString();
  const projectionIntentIds = new Set(
    scoped.projections.map((projection) => projection.intentNodeId),
  );
  const actionIntentIds = new Set(scoped.actions.map((action) => action.intentNodeId));
  const intentOriginEvidenceIds = new Set(
    scoped.intents.flatMap((intent) =>
      intent.originEvidenceId === undefined ? [] : [intent.originEvidenceId],
    ),
  );
  const completionEvidenceIds = new Set(
    scoped.actions.flatMap((action) =>
      action.completionEvidenceId === undefined ? [] : [action.completionEvidenceId],
    ),
  );
  const generated: DriftFinding[] = [];

  for (const intent of scoped.intents) {
    if (
      intent.kind === "goal" &&
      isActiveIntent(intent) &&
      !projectionIntentIds.has(intent.id) &&
      !actionIntentIds.has(intent.id) &&
      intent.originEvidenceId === undefined
    ) {
      generated.push({
        id: stableDriftId(scoped.workspaceId, "goal_without_work", intent.id),
        workspaceId: scoped.workspaceId,
        findingType: "goal_without_work",
        title: `Goal has no linked work: ${intent.title}`,
        body: "No projection, accountability action, or origin evidence is linked to this goal.",
        state: "open",
        relatedEntityType: "intent_node",
        relatedEntityId: intent.id,
        sensitivity: intent.sensitivity,
        createdAt: generatedAt,
      });
    }

    if (
      intent.kind === "commitment" &&
      isActiveIntent(intent) &&
      intent.dueAt !== undefined &&
      intent.dueAt < generatedAt &&
      !completionEvidenceIds.has(intent.originEvidenceId ?? "")
    ) {
      generated.push({
        id: stableDriftId(scoped.workspaceId, "stale_commitment", intent.id),
        workspaceId: scoped.workspaceId,
        findingType: "stale_commitment",
        title: `Commitment is stale: ${intent.title}`,
        body: `The commitment was due at ${intent.dueAt} and still needs review or evidence.`,
        state: "open",
        relatedEntityType: "intent_node",
        relatedEntityId: intent.id,
        sensitivity: intent.sensitivity,
        createdAt: generatedAt,
      });
    }
  }

  for (const evidence of scoped.evidence) {
    if (
      isWorkEvidence(evidence) &&
      !intentOriginEvidenceIds.has(evidence.id) &&
      !completionEvidenceIds.has(evidence.id)
    ) {
      generated.push({
        id: stableDriftId(scoped.workspaceId, "work_without_goal", evidence.id),
        workspaceId: scoped.workspaceId,
        findingType: "work_without_goal",
        title: `Work evidence is not linked to intent: ${evidence.title}`,
        body: "This work signal is not connected to a ratified goal, commitment, or completion record.",
        state: "open",
        relatedEntityType: "evidence_item",
        relatedEntityId: evidence.id,
        sensitivity: evidence.sensitivity,
        createdAt: generatedAt,
      });
    }
  }

  for (const action of scoped.actions) {
    if (
      action.evidenceRequired &&
      !isFinishedIntent(
        scoped.intents.find((intent) => intent.id === action.intentNodeId) ?? {
          id: action.intentNodeId,
          workspaceId: scoped.workspaceId,
          kind: "commitment",
          title: action.intentNodeId,
          body: "",
          state: "active",
          sensitivity: action.sensitivity,
          createdBy: "sarathi",
          createdAt: generatedAt,
          updatedAt: generatedAt,
        },
      ) &&
      action.completionEvidenceId === undefined
    ) {
      generated.push({
        id: stableDriftId(scoped.workspaceId, "missing_evidence", action.id),
        workspaceId: scoped.workspaceId,
        findingType: "missing_evidence",
        title: `Required evidence is missing for action ${action.id}`,
        body: "This accountability action requires completion evidence before it can be treated as done.",
        state: "open",
        relatedEntityType: "accountability_action",
        relatedEntityId: action.id,
        sensitivity: action.sensitivity,
        createdAt: generatedAt,
      });
    }
  }

  for (const projection of scoped.projections.filter(isDriftedProjection)) {
    generated.push({
      id: stableDriftId(scoped.workspaceId, "projection_drift", projection.id),
      workspaceId: scoped.workspaceId,
      findingType: "projection_drift",
      title: `Projection drift detected: ${projection.targetSystem}/${projection.targetType}`,
      body: `Projection ${projection.id} is ${projection.driftStatus}.`,
      state: "open",
      relatedEntityType: "projection",
      relatedEntityId: projection.id,
      sensitivity: projection.sensitivity,
      createdAt: generatedAt,
    });
  }

  const findingsById = new Map<string, DriftFinding>();

  for (const finding of [...scoped.driftFindings, ...generated]) {
    findingsById.set(finding.id, finding);
  }

  return [...findingsById.values()];
};

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
  const scoped = {
    ...filterStrategicReportInputsByWorkspace(inputs),
    driftFindings: deriveWeeklyDriftFindings(inputs),
  };

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

export const renderStrategicReportMarkdown = (report: StrategicExecutionReport): string => {
  const lines = [
    `# ${report.title}`,
    "",
    `Workspace: ${report.workspaceId}`,
    `Visibility: ${report.visibility}`,
    ...(report.generatedAt === undefined ? [] : [`Generated: ${report.generatedAt}`]),
    "",
    report.summary,
    "",
    "## Totals",
    "",
    `- Intent: ${report.totals.intents}`,
    `- Evidence: ${report.totals.evidence}`,
    `- Projections: ${report.totals.projections}`,
    `- Actions: ${report.totals.actions}`,
    `- Drift findings: ${report.totals.driftFindings}`,
  ];

  for (const section of report.sections) {
    lines.push("", `## ${section.title}`, "");

    for (const entry of section.entries) {
      lines.push(`- ${entry.label}`);
      lines.push(`  - Source: ${entry.source}`);
      lines.push(`  - Sensitivity: ${entry.sensitivity}`);
      lines.push(`  - Detail: ${entry.text}`);
      if (entry.externalUrl !== undefined) {
        lines.push(`  - URL: ${entry.externalUrl}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
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

const allReportInputs = (inputs: StrategicReportInputs) => [
  ...inputs.intents,
  ...inputs.evidence,
  ...inputs.projections,
  ...inputs.actions,
  ...inputs.driftFindings,
];

const reportGenerators: Readonly<
  Record<StrategicReportKind, (inputs: StrategicReportInputs) => StrategicExecutionReport>
> = {
  daily_delivery_brief: generateDailyDeliveryBrief,
  weekly_drift_review: generateWeeklyDriftReview,
  stakeholder_update_draft: generateStakeholderUpdateDraft,
  leadership_review: generateLeadershipReview,
};

export const generateBoundarySafeStrategicReport = (
  kind: StrategicReportKind,
  inputs: StrategicReportInputs,
  boundaryContext: StrategicReportBoundaryContext,
): StrategicExecutionReport => {
  if (allReportInputs(inputs).some((input) => input.workspaceId !== inputs.workspaceId)) {
    throw new StrategicReportBoundaryDeniedError(
      "workspace-denied",
      "The report input contains records from another workspace.",
    );
  }

  const derivedSensitivity = deriveStrategicReportVisibility(inputs);
  const decision = evaluateBoundaryAccess({
    subject: boundaryContext.subject,
    action: "render-report",
    target: {
      type: "report",
      id: kind,
      workspaceId: inputs.workspaceId,
      boundary: defaultBoundaryForSensitivity(derivedSensitivity),
    },
    output: {
      workspaceId: inputs.workspaceId,
      audience: boundaryContext.audience,
      consent: boundaryContext.consent,
      actionAuthorization: boundaryContext.actionAuthorization,
    },
  });

  if (!decision.allowed) {
    throw new StrategicReportBoundaryDeniedError(decision.reasonCode, decision.reason);
  }

  return reportGenerators[kind](inputs);
};
