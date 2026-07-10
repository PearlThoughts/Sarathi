import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { SensitivityTier, TrustTier } from "../../domain/policy.ts";
import type {
  BoundaryAudienceKind,
  BoundaryAuthorizationStatus,
} from "../../modules/boundary-policy/index.ts";
import {
  filterStrategicReportInputsBySensitivity,
  generateBoundarySafeStrategicReport,
  renderStrategicReportMarkdown,
  type StrategicExecutionReport,
  type StrategicReportBoundaryContext,
  StrategicReportBoundaryDeniedError,
} from "../../modules/strategic-reports/index.ts";
import {
  type DurableOperatorRuntimeSelection,
  openSqliteOperatorRuntime,
} from "./operator-runtime.ts";

type ReportRuntimeResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type ParsedValue<Value> = {
  readonly value?: Value | undefined;
  readonly error?: ReportRuntimeResult | undefined;
};

const failure = (message: string): ReportRuntimeResult => ({
  exitCode: 2,
  output: { ok: false, message },
});

const optionValues = (args: readonly string[], option: string): readonly string[] => {
  const values: string[] = [];

  for (const [index, argument] of args.entries()) {
    if (argument === option) {
      const value = args[index + 1];
      values.push(value === undefined || value.startsWith("--") ? "" : value);
      continue;
    }

    const prefix = `${option}=`;
    if (argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length));
    }
  }

  return values;
};

const optionalValue = (args: readonly string[], option: string): ParsedValue<string> => {
  const values = optionValues(args, option);
  if (values.length > 1) {
    return { error: failure(`Ambiguous ${option} value. Provide ${option} at most once.`) };
  }

  const value = values[0]?.trim();
  if (value === "") {
    return { error: failure(`${option} requires a non-empty value.`) };
  }

  return { value };
};

const requiredValue = (args: readonly string[], option: string): ParsedValue<string> => {
  const parsed = optionalValue(args, option);
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  if (parsed.value === undefined) {
    return { error: failure(`File-backed drift review requires ${option}.`) };
  }

  return { value: parsed.value };
};

const maxSensitivityFromArgs = (
  args: readonly string[],
): { readonly value?: SensitivityTier | undefined; readonly error?: ReportRuntimeResult } => {
  const parsed = requiredValue(args, "--max-sensitivity");
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  const value = parsed.value;
  if (
    value !== "public" &&
    value !== "internal" &&
    value !== "confidential" &&
    value !== "restricted"
  ) {
    return {
      error: failure(
        "Invalid --max-sensitivity. Use public, internal, confidential, or restricted.",
      ),
    };
  }

  return { value };
};

const trustTierFromArgs = (args: readonly string[]): ParsedValue<TrustTier> => {
  const parsed = requiredValue(args, "--trust-tier");
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  const value = parsed.value;
  if (
    value !== "guest" &&
    value !== "member" &&
    value !== "trusted" &&
    value !== "maintainer" &&
    value !== "admin"
  ) {
    return {
      error: failure("Invalid --trust-tier. Use guest, member, trusted, maintainer, or admin."),
    };
  }

  return { value };
};

const audienceKindFromArgs = (args: readonly string[]): ParsedValue<BoundaryAudienceKind> => {
  const parsed = requiredValue(args, "--audience-kind");
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  const value = parsed.value;
  if (
    value !== "principal" &&
    value !== "workspace" &&
    value !== "organization" &&
    value !== "external" &&
    value !== "model"
  ) {
    return {
      error: failure(
        "Invalid --audience-kind. Use principal, workspace, organization, external, or model.",
      ),
    };
  }

  return { value };
};

const authorizationStatusFromArgs = (
  args: readonly string[],
  option: "--consent" | "--action-authorization",
): ParsedValue<BoundaryAuthorizationStatus> => {
  const parsed = requiredValue(args, option);
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  const value = parsed.value;
  if (
    value !== "not-required" &&
    value !== "granted" &&
    value !== "denied" &&
    value !== "unknown"
  ) {
    return {
      error: failure(`Invalid ${option}. Use not-required, granted, denied, or unknown.`),
    };
  }

  return { value };
};

const boundaryContextFromArgs = (
  args: readonly string[],
  maximumSensitivity: SensitivityTier,
): ParsedValue<StrategicReportBoundaryContext> => {
  const principal = requiredValue(args, "--principal");
  if (principal.error !== undefined) {
    return { error: principal.error };
  }
  const trustTier = trustTierFromArgs(args);
  if (trustTier.error !== undefined) {
    return { error: trustTier.error };
  }
  const authorizedWorkspace = requiredValue(args, "--authorized-workspace");
  if (authorizedWorkspace.error !== undefined) {
    return { error: authorizedWorkspace.error };
  }
  const audienceKind = audienceKindFromArgs(args);
  if (audienceKind.error !== undefined) {
    return { error: audienceKind.error };
  }
  const audienceWorkspace = requiredValue(args, "--audience-workspace");
  if (audienceWorkspace.error !== undefined) {
    return { error: audienceWorkspace.error };
  }
  const consent = authorizationStatusFromArgs(args, "--consent");
  if (consent.error !== undefined) {
    return { error: consent.error };
  }
  const actionAuthorization = authorizationStatusFromArgs(args, "--action-authorization");
  if (actionAuthorization.error !== undefined) {
    return { error: actionAuthorization.error };
  }
  if (
    principal.value === undefined ||
    trustTier.value === undefined ||
    authorizedWorkspace.value === undefined ||
    audienceKind.value === undefined ||
    audienceWorkspace.value === undefined ||
    consent.value === undefined ||
    actionAuthorization.value === undefined
  ) {
    return { error: failure("Report boundary context could not be resolved.") };
  }

  return {
    value: {
      subject: {
        principalId: principal.value,
        trustTier: trustTier.value,
        authorizedWorkspaceIds: [authorizedWorkspace.value],
      },
      audience: {
        kind: audienceKind.value,
        workspaceId: audienceWorkspace.value,
        maximumSensitivity,
      },
      consent: consent.value,
      actionAuthorization: actionAuthorization.value,
    },
  };
};

export const runDurableDriftReviewCommand = async (
  args: readonly string[],
  selection: DurableOperatorRuntimeSelection,
): Promise<ReportRuntimeResult> => {
  const outputPath = optionalValue(args, "--out");
  if (outputPath.error !== undefined) {
    return outputPath.error;
  }
  if (outputPath.value === undefined) {
    return failure(
      "File-backed drift review requires --out so private report content is not printed.",
    );
  }
  const maximumSensitivity = maxSensitivityFromArgs(args);
  if (maximumSensitivity.error !== undefined) {
    return maximumSensitivity.error;
  }
  if (maximumSensitivity.value === undefined) {
    return failure("Report sensitivity ceiling could not be resolved.");
  }
  const boundaryContext = boundaryContextFromArgs(args, maximumSensitivity.value);
  if (boundaryContext.error !== undefined) {
    return boundaryContext.error;
  }
  if (boundaryContext.value === undefined) {
    return failure("Report boundary context could not be resolved.");
  }
  const format = optionalValue(args, "--format");
  if (format.error !== undefined) {
    return format.error;
  }
  if (format.value !== undefined && format.value !== "json" && format.value !== "markdown") {
    return failure("Invalid --format. Use json or markdown.");
  }

  const runtime = await Effect.runPromise(openSqliteOperatorRuntime(selection));
  const workspaceId = runtime.workspace.id;

  try {
    const inputs = filterStrategicReportInputsBySensitivity(
      {
        workspaceId,
        generatedAt: new Date().toISOString(),
        intents: await runtime.repository.listWorkspaceIntent(workspaceId),
        evidence: await runtime.repository.listWorkspaceEvidence(workspaceId),
        projections: await runtime.repository.listWorkspaceProjections(workspaceId),
        actions: await runtime.repository.listWorkspaceAccountabilityActions(workspaceId),
        driftFindings: await runtime.repository.listWorkspaceDriftFindings(workspaceId),
      },
      maximumSensitivity.value,
    );
    let report: StrategicExecutionReport;
    try {
      report = generateBoundarySafeStrategicReport(
        "weekly_drift_review",
        inputs,
        boundaryContext.value,
      );
    } catch (error) {
      if (error instanceof StrategicReportBoundaryDeniedError) {
        return {
          exitCode: 2,
          output: {
            ok: false,
            message: "Strategic report boundary authorization denied.",
            report: {
              authorized: false,
              reasonCode: error.reasonCode,
            },
          },
        };
      }

      throw error;
    }
    const rendered =
      format.value === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderStrategicReportMarkdown(report);

    writeFileSync(resolve(outputPath.value), rendered);

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "file-backed",
        report: {
          kind: report.kind,
          visibility: report.visibility,
          sections: report.sections.length,
          entries: report.sections.reduce((total, section) => total + section.entries.length, 0),
          totals: report.totals,
          written: true,
        },
      },
    };
  } finally {
    runtime.close();
  }
};
