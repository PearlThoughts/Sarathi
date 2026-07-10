import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { StrategyKernelSqliteDatabase } from "../../infrastructure/sqlite/index.ts";
import type { StrategyKernelRepository, Workspace } from "../../modules/strategy-kernel/index.ts";

export type DurableOperatorRuntimeSelection = {
  readonly mode: "sqlite";
  readonly databasePath: string;
  readonly workspaceSelector: string;
};

type SyntheticOperatorRuntimeSelection = {
  readonly mode: "synthetic";
  readonly workspaceSelector: string;
};

type OperatorRuntimeSelection = DurableOperatorRuntimeSelection | SyntheticOperatorRuntimeSelection;

type WorkspaceReconcileRuntimeSelection =
  | {
      readonly mode: "sqlite";
      readonly databasePath: string;
      readonly workspaceSelector: string | undefined;
    }
  | {
      readonly mode: "synthetic";
      readonly workspaceSelector: string | undefined;
    };

type SqliteOperatorRuntime = {
  readonly mode: "sqlite";
  readonly database: StrategyKernelSqliteDatabase;
  readonly repository: StrategyKernelRepository;
  readonly workspace: Workspace;
  readonly close: () => void;
};

export class OperatorRuntimeSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorRuntimeSelectionError";
  }
}

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

const selectorValue = (
  args: readonly string[],
  option: string,
  environmentValue: string | undefined,
): string | undefined => {
  const values = optionValues(args, option);

  if (values.length > 1) {
    throw new OperatorRuntimeSelectionError(
      `Ambiguous ${option} selector. Provide exactly one ${option} value.`,
    );
  }

  const selected = values[0] ?? environmentValue;
  if (selected === undefined) {
    return undefined;
  }

  const normalized = selected.trim();
  if (normalized === "") {
    throw new OperatorRuntimeSelectionError(`${option} requires a non-empty value.`);
  }

  return normalized;
};

export const parseOperatorRuntimeSelection = (
  args: readonly string[],
  env: Record<string, string | undefined>,
): OperatorRuntimeSelection => {
  const workspaceSelector = selectorValue(args, "--workspace", env.SARATHI_WORKSPACE_ID);

  if (workspaceSelector === undefined) {
    throw new OperatorRuntimeSelectionError(
      "Operator runtime requires --workspace or SARATHI_WORKSPACE_ID. Select one workspace ID or key.",
    );
  }

  if (args.includes("--synthetic")) {
    if (optionValues(args, "--db").length > 0) {
      throw new OperatorRuntimeSelectionError(
        "Synthetic runtime cannot be combined with --db. Remove --db or remove --synthetic.",
      );
    }

    return {
      mode: "synthetic",
      workspaceSelector,
    };
  }

  const databasePath = selectorValue(args, "--db", env.SARATHI_DB_PATH);
  if (databasePath === undefined) {
    throw new OperatorRuntimeSelectionError(
      "Durable operator runtime requires --db or SARATHI_DB_PATH. Select a SQLite database, or use --synthetic for deterministic test/demo state.",
    );
  }

  return {
    mode: "sqlite",
    databasePath,
    workspaceSelector,
  };
};

export const parseWorkspaceReconcileRuntimeSelection = (
  args: readonly string[],
  env: Record<string, string | undefined>,
): WorkspaceReconcileRuntimeSelection => {
  const workspaceSelector = selectorValue(args, "--workspace", env.SARATHI_WORKSPACE_ID);

  if (args.includes("--synthetic")) {
    if (optionValues(args, "--db").length > 0) {
      throw new OperatorRuntimeSelectionError(
        "Synthetic runtime cannot be combined with --db. Remove --db or remove --synthetic.",
      );
    }

    return {
      mode: "synthetic",
      workspaceSelector,
    };
  }

  const databasePath = selectorValue(args, "--db", env.SARATHI_DB_PATH);
  if (databasePath === undefined) {
    throw new OperatorRuntimeSelectionError(
      "Durable workspace reconciliation requires --db or SARATHI_DB_PATH. Select a SQLite database, or use --synthetic for deterministic test/demo state.",
    );
  }

  return {
    mode: "sqlite",
    databasePath,
    workspaceSelector,
  };
};

export const openSqliteOperatorRuntime = (
  selection: DurableOperatorRuntimeSelection,
): Effect.Effect<SqliteOperatorRuntime, OperatorRuntimeSelectionError> => {
  if (!existsSync(selection.databasePath)) {
    return Effect.fail(
      new OperatorRuntimeSelectionError(
        "Selected SQLite database does not exist. Reconcile the workspace pack first or choose an existing database path.",
      ),
    );
  }

  return Effect.tryPromise({
    try: async () => {
      const {
        applyStrategyKernelSqliteMigrations,
        createSqliteStrategyKernelRepository,
        findStrategyKernelSqliteWorkspaces,
        openStrategyKernelSqliteDatabase,
      } = await import("../../infrastructure/sqlite/index.ts");
      const database = openStrategyKernelSqliteDatabase(selection.databasePath);

      try {
        applyStrategyKernelSqliteMigrations(database);
        const matches = findStrategyKernelSqliteWorkspaces(database, selection.workspaceSelector);

        if (matches.length === 0) {
          throw new OperatorRuntimeSelectionError(
            "Workspace selector did not match a persisted workspace. Reconcile the workspace pack first or select an existing workspace ID or key.",
          );
        }

        if (matches.length > 1) {
          throw new OperatorRuntimeSelectionError(
            "Workspace selector matched multiple persisted workspaces. Use an unambiguous workspace ID.",
          );
        }

        const workspace = matches[0];
        if (workspace === undefined) {
          throw new OperatorRuntimeSelectionError(
            "Workspace resolution failed unexpectedly. Select an existing workspace ID.",
          );
        }

        return {
          mode: "sqlite" as const,
          database,
          repository: createSqliteStrategyKernelRepository(database),
          workspace,
          close: () => database.close(),
        };
      } catch (error) {
        database.close();
        throw error;
      }
    },
    catch: (error) =>
      error instanceof OperatorRuntimeSelectionError
        ? error
        : new OperatorRuntimeSelectionError(
            "Unable to open the selected SQLite operator runtime. Verify that --db points to a readable SQLite file and retry.",
          ),
  });
};
