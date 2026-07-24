import { runDeliverySyncCommand } from "./delivery-sync-runtime.ts";

type Environment = Record<string, string | undefined>;
type SyncCommandRunner = typeof runDeliverySyncCommand;
type ContinuousSourceKind = "jira" | "vault" | "github" | "teams";

export type DeliverySyncSchedulerDiagnostic = {
  readonly event: "delivery_sync_scheduler";
  readonly operation: "subscriptions" | "reconcile" | "tick";
  readonly outcome: "succeeded" | "failed" | "scheduled" | "stopped";
  readonly source?: ContinuousSourceKind | undefined;
  readonly intervalSeconds?: number | undefined;
};

type DeliverySyncSchedulerStatus = {
  readonly enabled: boolean;
  readonly state: "disabled" | "scheduled" | "running" | "stopped";
  readonly intervalSeconds: number;
  readonly initialDelaySeconds: number;
};

type DeliverySyncSchedulerController = {
  readonly status: () => DeliverySyncSchedulerStatus;
  readonly stop: () => void;
};

type DiagnosticSink = (diagnostic: DeliverySyncSchedulerDiagnostic) => void;

const continuousSources = ["jira", "vault", "teams", "github"] as const;
const defaultIntervalSeconds = 45 * 60;
const defaultInitialDelaySeconds = 60;

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

const positiveInteger = (name: string, value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive.`);
  return parsed;
};

const defaultDiagnosticSink: DiagnosticSink = (diagnostic) => {
  console.info(JSON.stringify(diagnostic));
};

export const runDeliverySyncSchedulerTick = async (
  runCommand: SyncCommandRunner = runDeliverySyncCommand,
  diagnostics: DiagnosticSink = defaultDiagnosticSink,
): Promise<{ readonly succeeded: number; readonly failed: number }> => {
  let succeeded = 0;
  let failed = 0;
  const run = async (
    operation: "subscriptions" | "reconcile",
    source: ContinuousSourceKind,
  ): Promise<void> => {
    try {
      const result = await runCommand([operation, source]);
      const outcome = result.exitCode === 0 ? "succeeded" : "failed";
      diagnostics({ event: "delivery_sync_scheduler", operation, source, outcome });
      if (outcome === "succeeded") succeeded += 1;
      else failed += 1;
    } catch {
      failed += 1;
      diagnostics({
        event: "delivery_sync_scheduler",
        operation,
        source,
        outcome: "failed",
      });
    }
  };

  await run("subscriptions", "teams");
  for (const source of continuousSources) await run("reconcile", source);
  diagnostics({
    event: "delivery_sync_scheduler",
    operation: "tick",
    outcome: failed === 0 ? "succeeded" : "failed",
  });
  return { succeeded, failed };
};

export const startDeliverySyncScheduler = (
  environment: Environment = process.env,
  runCommand: SyncCommandRunner = runDeliverySyncCommand,
  diagnostics: DiagnosticSink = defaultDiagnosticSink,
): DeliverySyncSchedulerController => {
  const schedulerEnabled = enabled(environment.SARATHI_SYNC_SCHEDULER_ENABLED);
  const intervalSeconds = positiveInteger(
    "SARATHI_SYNC_RECONCILE_INTERVAL_SECONDS",
    environment.SARATHI_SYNC_RECONCILE_INTERVAL_SECONDS,
    defaultIntervalSeconds,
  );
  const initialDelaySeconds = positiveInteger(
    "SARATHI_SYNC_INITIAL_DELAY_SECONDS",
    environment.SARATHI_SYNC_INITIAL_DELAY_SECONDS,
    defaultInitialDelaySeconds,
  );
  let state: DeliverySyncSchedulerStatus["state"] = schedulerEnabled ? "scheduled" : "disabled";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const trigger = (): void => {
    if (state === "stopped" || !schedulerEnabled) return;
    state = "running";
    void runDeliverySyncSchedulerTick(runCommand, diagnostics)
      .catch(() => {
        diagnostics({
          event: "delivery_sync_scheduler",
          operation: "tick",
          outcome: "failed",
        });
      })
      .finally(() => {
        if (state === "stopped") return;
        state = "scheduled";
        timer = setTimeout(trigger, intervalSeconds * 1_000);
      });
  };

  if (schedulerEnabled) {
    diagnostics({
      event: "delivery_sync_scheduler",
      operation: "tick",
      outcome: "scheduled",
      intervalSeconds,
    });
    timer = setTimeout(trigger, initialDelaySeconds * 1_000);
  }

  return {
    status: () => ({
      enabled: schedulerEnabled,
      state,
      intervalSeconds,
      initialDelaySeconds,
    }),
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      state = "stopped";
      diagnostics({
        event: "delivery_sync_scheduler",
        operation: "tick",
        outcome: "stopped",
      });
    },
  };
};
