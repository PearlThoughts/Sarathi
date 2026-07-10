import { Effect } from "effect";
import {
  type ProjectionObservation,
  verifyProjectionAgainstObservation,
} from "../../modules/projections/index.ts";
import {
  type DurableOperatorRuntimeSelection,
  openSqliteOperatorRuntime,
} from "./operator-runtime.ts";

type ProjectionRuntimeResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type ProjectionRuntimeClock = () => string;

type ParsedValue<Value> = {
  readonly value?: Value | undefined;
  readonly error?: ProjectionRuntimeResult | undefined;
};

const failure = (message: string): ProjectionRuntimeResult => ({
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

const requiredBoolean = (args: readonly string[], option: string): ParsedValue<boolean> => {
  const parsed = optionalValue(args, option);
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  if (parsed.value === undefined) {
    return { error: failure(`Projection verification requires ${option} true or false.`) };
  }
  if (parsed.value !== "true" && parsed.value !== "false") {
    return { error: failure(`${option} must be true or false.`) };
  }

  return { value: parsed.value === "true" };
};

const optionalBoolean = (args: readonly string[], option: string): ParsedValue<boolean> => {
  const parsed = optionalValue(args, option);
  if (parsed.error !== undefined) {
    return { error: parsed.error };
  }
  if (parsed.value === undefined) {
    return {};
  }
  if (parsed.value !== "true" && parsed.value !== "false") {
    return { error: failure(`${option} must be true or false.`) };
  }

  return { value: parsed.value === "true" };
};

const projectionIdFromArgs = (args: readonly string[]): string | undefined => {
  const projectionId = args[2]?.trim();
  return projectionId === undefined || projectionId === "" || projectionId.startsWith("--")
    ? undefined
    : projectionId;
};

const observationFromArgs = (args: readonly string[]): ParsedValue<ProjectionObservation> => {
  const authorized = requiredBoolean(args, "--observed-authorized");
  if (authorized.error !== undefined) {
    return { error: authorized.error };
  }
  const exists = requiredBoolean(args, "--observed-exists");
  if (exists.error !== undefined) {
    return { error: exists.error };
  }
  const managedBySarathi = optionalBoolean(args, "--observed-managed-by-sarathi");
  if (managedBySarathi.error !== undefined) {
    return { error: managedBySarathi.error };
  }
  const contentHash = optionalValue(args, "--observed-content-hash");
  if (contentHash.error !== undefined) {
    return { error: contentHash.error };
  }
  const targetId = optionalValue(args, "--observed-target-id");
  if (targetId.error !== undefined) {
    return { error: targetId.error };
  }
  const targetUrl = optionalValue(args, "--observed-target-url");
  if (targetUrl.error !== undefined) {
    return { error: targetUrl.error };
  }

  return {
    value: {
      authorized: authorized.value === true,
      exists: exists.value === true,
      ...(managedBySarathi.value === undefined ? {} : { managedBySarathi: managedBySarathi.value }),
      ...(contentHash.value === undefined ? {} : { contentHash: contentHash.value }),
      ...(targetId.value === undefined ? {} : { targetId: targetId.value }),
      ...(targetUrl.value === undefined ? {} : { targetUrl: targetUrl.value }),
    },
  };
};

export const runDurableProjectionCommand = async (
  args: readonly string[],
  selection: DurableOperatorRuntimeSelection,
  clock: ProjectionRuntimeClock = () => new Date().toISOString(),
): Promise<ProjectionRuntimeResult> => {
  const projectionId = projectionIdFromArgs(args);
  if (projectionId === undefined) {
    return failure("Projection verify requires a projection ID.");
  }
  const observation = observationFromArgs(args);
  if (observation.error !== undefined) {
    return observation.error;
  }
  if (observation.value === undefined) {
    return failure("Projection verification observation could not be parsed.");
  }

  const runtime = await Effect.runPromise(openSqliteOperatorRuntime(selection));

  try {
    const projections = await runtime.repository.listWorkspaceProjections(runtime.workspace.id);
    const projection = projections.find((candidate) => candidate.id === projectionId);

    if (projection === undefined) {
      return failure("Projection was not found in the selected workspace.");
    }

    const result = await verifyProjectionAgainstObservation(
      runtime.repository,
      projection,
      observation.value,
      clock(),
    );

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "file-backed",
        projection: {
          observationRecorded: true,
          observationSource: "operator-supplied",
          providerVerified: false,
          liveVerification: false,
          driftStatus: result.projection.driftStatus,
          driftFindingRecorded: result.driftFinding !== undefined,
        },
      },
    };
  } finally {
    runtime.close();
  }
};
