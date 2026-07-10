import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  filterStrategicReportInputsBySensitivity,
  generateBoundarySafeStrategicReport,
  renderStrategicReportMarkdown,
} from "../../modules/strategic-reports/index.ts";
import {
  type DurableOperatorRuntimeSelection,
  openSqliteOperatorRuntime,
} from "./operator-runtime.ts";

type ReportRuntimeResult = {
  readonly exitCode: number;
  readonly output: unknown;
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

const optionalValue = (
  args: readonly string[],
  option: string,
): { readonly value?: string | undefined; readonly error?: ReportRuntimeResult | undefined } => {
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

const maxSensitivityFromArgs = (
  args: readonly string[],
): { readonly value?: SensitivityTier | undefined; readonly error?: ReportRuntimeResult } => {
  const parsed = optionalValue(args, "--max-sensitivity");
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  const value = parsed.value ?? "restricted";
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
    const report = generateBoundarySafeStrategicReport("weekly_drift_review", inputs, {
      subject: {
        principalId: "local-operator",
        trustTier: "maintainer",
        authorizedWorkspaceIds: [workspaceId],
      },
      audience: {
        kind: "workspace",
        workspaceId,
        maximumSensitivity: maximumSensitivity.value,
      },
      consent: "granted",
      actionAuthorization: "granted",
    });
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
