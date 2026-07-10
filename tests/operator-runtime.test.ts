import { describe, expect, it } from "vitest";
import {
  parseOperatorRuntimeSelection,
  parseWorkspaceReconcileRuntimeSelection,
} from "../src/cli/commands/operator-runtime.ts";

describe("operator runtime selection", () => {
  it("derives workspace identity from a durable reconciliation pack", () => {
    expect(
      parseWorkspaceReconcileRuntimeSelection(
        ["workspace", "reconcile", "--pack", "fixture", "--db", "runtime.sqlite"],
        {},
      ),
    ).toEqual({
      mode: "sqlite",
      databasePath: "runtime.sqlite",
      workspaceSelector: undefined,
    });
  });

  it("derives synthetic reconciliation identity without a workspace selector", () => {
    expect(
      parseWorkspaceReconcileRuntimeSelection(["workspace", "reconcile", "--synthetic"], {}),
    ).toEqual({
      mode: "synthetic",
      workspaceSelector: undefined,
    });
  });

  it("parses one explicit durable database and workspace selection", () => {
    expect(
      parseOperatorRuntimeSelection(
        ["intent", "inbox", "--db", "runtime.sqlite", "--workspace", "workspace-a"],
        {},
      ),
    ).toEqual({
      mode: "sqlite",
      databasePath: "runtime.sqlite",
      workspaceSelector: "workspace-a",
    });
  });

  it("accepts durable selectors from explicit runtime environment configuration", () => {
    expect(
      parseOperatorRuntimeSelection(["intent", "inbox"], {
        SARATHI_DB_PATH: "runtime.sqlite",
        SARATHI_WORKSPACE_ID: "workspace-a",
      }),
    ).toEqual({
      mode: "sqlite",
      databasePath: "runtime.sqlite",
      workspaceSelector: "workspace-a",
    });
  });

  it("enables deterministic synthetic state only through an explicit flag", () => {
    expect(
      parseOperatorRuntimeSelection(
        ["intent", "inbox", "--synthetic", "--workspace", "workspace-demo"],
        {},
      ),
    ).toEqual({
      mode: "synthetic",
      workspaceSelector: "workspace-demo",
    });
  });

  it.each([
    {
      name: "missing workspace",
      args: ["intent", "inbox", "--db", "runtime.sqlite"],
      message: "Operator runtime requires --workspace",
    },
    {
      name: "missing database",
      args: ["intent", "inbox", "--workspace", "workspace-a"],
      message: "Durable operator runtime requires --db",
    },
    {
      name: "duplicate workspace selector",
      args: [
        "intent",
        "inbox",
        "--db",
        "runtime.sqlite",
        "--workspace",
        "workspace-a",
        "--workspace",
        "workspace-b",
      ],
      message: "Ambiguous --workspace selector",
    },
    {
      name: "duplicate database selector",
      args: [
        "intent",
        "inbox",
        "--db",
        "runtime-a.sqlite",
        "--db",
        "runtime-b.sqlite",
        "--workspace",
        "workspace-a",
      ],
      message: "Ambiguous --db selector",
    },
    {
      name: "synthetic and durable modes combined",
      args: [
        "intent",
        "inbox",
        "--synthetic",
        "--db",
        "runtime.sqlite",
        "--workspace",
        "workspace-a",
      ],
      message: "Synthetic runtime cannot be combined with --db",
    },
  ])("fails closed for $name", ({ args, message }) => {
    expect(() => parseOperatorRuntimeSelection(args, {})).toThrowError(new RegExp(message, "u"));
  });
});
