import { Effect } from "effect";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import type { AccountabilityActionState } from "../../modules/strategy-kernel/index.ts";
import {
  type DurableOperatorRuntimeSelection,
  openSqliteOperatorRuntime,
} from "./operator-runtime.ts";

type AccountabilityRuntimeResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

const actionStates: readonly AccountabilityActionState[] = [
  "pending",
  "sent",
  "acknowledged",
  "blocked",
  "done",
  "silent",
  "escalated",
  "cancelled",
];

const failure = (message: string): AccountabilityRuntimeResult => ({
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

const maxSensitivityFromArgs = (
  args: readonly string[],
): {
  readonly value?: SensitivityTier | undefined;
  readonly error?: AccountabilityRuntimeResult;
} => {
  const values = optionValues(args, "--max-sensitivity");
  if (values.length > 1) {
    return {
      error: failure("Ambiguous --max-sensitivity value. Provide --max-sensitivity at most once."),
    };
  }

  const value = values[0]?.trim();
  if (value === undefined || value === "") {
    return {
      error: failure(
        "Accountability list requires --max-sensitivity so the output ceiling is explicit.",
      ),
    };
  }
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

export const runDurableAccountabilityCommand = async (
  args: readonly string[],
  selection: DurableOperatorRuntimeSelection,
): Promise<AccountabilityRuntimeResult> => {
  const maximumSensitivity = maxSensitivityFromArgs(args);
  if (maximumSensitivity.error !== undefined) {
    return maximumSensitivity.error;
  }
  const sensitivityCeiling = maximumSensitivity.value;
  if (sensitivityCeiling === undefined) {
    return failure("Accountability sensitivity ceiling could not be resolved.");
  }

  const runtime = await Effect.runPromise(openSqliteOperatorRuntime(selection));

  try {
    const actions = (
      await runtime.repository.listWorkspaceAccountabilityActions(runtime.workspace.id)
    ).filter((action) => isSensitivityAtOrBelow(action.sensitivity, sensitivityCeiling));
    const states = Object.fromEntries(
      actionStates.map((state) => [
        state,
        actions.reduce((count, action) => count + (action.state === state ? 1 : 0), 0),
      ]),
    );

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "file-backed",
        accountability: {
          listed: true,
          total: actions.length,
          states,
        },
      },
    };
  } finally {
    runtime.close();
  }
};
