import { afterEach, describe, expect, it, vi } from "vitest";
import { synchronizationExecutionOwnerId } from "../src/cli/commands/delivery-sync-runtime.ts";
import {
  type DeliverySyncSchedulerDiagnostic,
  runDeliverySyncSchedulerTick,
  startDeliverySyncScheduler,
} from "../src/cli/commands/delivery-sync-scheduler.ts";

describe("delivery sync scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews Teams subscriptions and reconciles every source independently", async () => {
    const commands: string[][] = [];
    const diagnostics: DeliverySyncSchedulerDiagnostic[] = [];
    const result = await runDeliverySyncSchedulerTick(
      async (args) => {
        commands.push([...args]);
        return {
          exitCode: args[0] === "reconcile" && args[1] === "github" ? 1 : 0,
          output: { ok: true },
        };
      },
      (diagnostic) => diagnostics.push(diagnostic),
    );

    expect(commands).toEqual([
      ["subscriptions", "teams"],
      ["reconcile", "jira"],
      ["reconcile", "vault"],
      ["reconcile", "github"],
      ["reconcile", "teams"],
    ]);
    expect(result).toEqual({ succeeded: 4, failed: 1 });
    expect(diagnostics).toContainEqual({
      event: "delivery_sync_scheduler",
      operation: "reconcile",
      source: "teams",
      outcome: "succeeded",
    });
    expect(diagnostics.at(-1)).toEqual({
      event: "delivery_sync_scheduler",
      operation: "tick",
      outcome: "failed",
    });
  });

  it("continues after a source runner throws without logging command output", async () => {
    const commands: string[][] = [];
    const diagnostics: DeliverySyncSchedulerDiagnostic[] = [];
    const result = await runDeliverySyncSchedulerTick(
      async (args) => {
        commands.push([...args]);
        if (args[1] === "vault") throw new Error("private provider response");
        return { exitCode: 0, output: { body: "private provider response" } };
      },
      (diagnostic) => diagnostics.push(diagnostic),
    );

    expect(commands).toHaveLength(5);
    expect(result).toEqual({ succeeded: 4, failed: 1 });
    expect(JSON.stringify(diagnostics)).not.toContain("private provider response");
  });

  it("schedules only when explicitly enabled and exposes safe state", () => {
    vi.useFakeTimers();
    const diagnostics: DeliverySyncSchedulerDiagnostic[] = [];
    const disabled = startDeliverySyncScheduler({}, async () => ({ exitCode: 0, output: {} }));
    expect(disabled.status()).toEqual({
      enabled: false,
      state: "disabled",
      intervalSeconds: 2_700,
      initialDelaySeconds: 60,
    });

    const active = startDeliverySyncScheduler(
      {
        SARATHI_SYNC_SCHEDULER_ENABLED: "true",
        SARATHI_SYNC_RECONCILE_INTERVAL_SECONDS: "3600",
        SARATHI_SYNC_INITIAL_DELAY_SECONDS: "120",
      },
      async () => ({ exitCode: 0, output: {} }),
      (diagnostic) => diagnostics.push(diagnostic),
    );
    expect(active.status()).toEqual({
      enabled: true,
      state: "scheduled",
      intervalSeconds: 3_600,
      initialDelaySeconds: 120,
    });
    expect(diagnostics).toEqual([
      {
        event: "delivery_sync_scheduler",
        operation: "tick",
        outcome: "scheduled",
        intervalSeconds: 3_600,
      },
    ]);
    active.stop();
    expect(active.status().state).toBe("stopped");
  });

  it("derives an exclusive privacy-safe lease owner for every execution", () => {
    const first = synchronizationExecutionOwnerId("railway-production", "execution-1");
    const second = synchronizationExecutionOwnerId("railway-production", "execution-2");

    expect(first).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(second).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("railway-production");
  });
});
