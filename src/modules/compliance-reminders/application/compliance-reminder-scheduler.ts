import type { ComplianceReminderRequest } from "../domain/compliance-reminder.ts";

export type ComplianceReminderSchedule = {
  readonly enabled: boolean;
  readonly workspaceId: string;
  readonly timezone: string;
  readonly weeklyDigestTime: string;
  readonly exceptionDigestTime: string;
};

type ComplianceReminderManualKind = "planning" | "exceptions";

type Clock = {
  readonly date: string;
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
};

const parseTime = (
  value: string,
): { readonly hour: number; readonly minute: number } | undefined => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : undefined;
};

const clockAt = (now: Date, timezone: string): Clock => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdays[value("weekday")] ?? 0,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
};

const weekWindow = (date: string): { readonly startDate: string; readonly endDate: string } => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
};

export const manualComplianceReminderRequest = (
  schedule: ComplianceReminderSchedule,
  kind: ComplianceReminderManualKind,
  now: Date,
): ComplianceReminderRequest | undefined => {
  if (schedule.workspaceId.trim() === "") return undefined;
  const clock = clockAt(now, schedule.timezone);
  return {
    workspaceId: schedule.workspaceId,
    idempotencyKey: `${schedule.workspaceId}:dry-run:${kind}:${clock.date}`,
    kind,
    today: clock.date,
    ...(kind === "planning" ? { window: weekWindow(clock.date) } : {}),
    dryRun: true,
    occurredAt: now.toISOString(),
    retryAt: now.toISOString(),
  };
};

export const scheduledComplianceReminderRequest = (
  schedule: ComplianceReminderSchedule,
  now: Date,
): ComplianceReminderRequest | undefined => {
  if (!schedule.enabled || schedule.workspaceId.trim() === "") return undefined;
  const clock = clockAt(now, schedule.timezone);
  const weekly = parseTime(schedule.weeklyDigestTime);
  const exceptions = parseTime(schedule.exceptionDigestTime);
  if (
    weekly !== undefined &&
    clock.weekday === 1 &&
    clock.hour === weekly.hour &&
    clock.minute === weekly.minute
  ) {
    return {
      workspaceId: schedule.workspaceId,
      idempotencyKey: `${schedule.workspaceId}:planning:${clock.date}`,
      kind: "planning",
      today: clock.date,
      window: weekWindow(clock.date),
      dryRun: false,
      occurredAt: now.toISOString(),
      retryAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    };
  }
  if (
    exceptions !== undefined &&
    clock.weekday >= 2 &&
    clock.weekday <= 5 &&
    clock.hour === exceptions.hour &&
    clock.minute === exceptions.minute
  ) {
    return {
      workspaceId: schedule.workspaceId,
      idempotencyKey: `${schedule.workspaceId}:exceptions:${clock.date}`,
      kind: "exceptions",
      today: clock.date,
      dryRun: false,
      occurredAt: now.toISOString(),
      retryAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    };
  }
  return undefined;
};

export const startComplianceReminderScheduler = (
  schedule: ComplianceReminderSchedule,
  execute: (request: ComplianceReminderRequest) => Promise<unknown>,
  dueRetries: (now: Date) => Promise<readonly ComplianceReminderRequest[]> = async () => [],
  now: () => Date = () => new Date(),
): { readonly stop: () => void } => {
  const inFlight = new Set<string>();
  const executeSafely = async (request: ComplianceReminderRequest): Promise<void> => {
    if (inFlight.has(request.idempotencyKey)) return;
    inFlight.add(request.idempotencyKey);
    try {
      await execute(request);
    } catch {
      // The next durable retry is driven by retryAt, not by an unhandled timer promise.
    } finally {
      inFlight.delete(request.idempotencyKey);
    }
  };
  const tick = (): void => {
    void runComplianceReminderSchedulerTick(schedule, executeSafely, dueRetries, now()).catch(
      () => undefined,
    );
  };
  tick();
  const interval = setInterval(tick, 60_000);
  return { stop: () => clearInterval(interval) };
};

type ComplianceReminderSchedulerTickResult = {
  readonly retryLoadFailed: boolean;
  readonly retryCount: number;
  readonly scheduledCount: number;
  readonly executionFailures: number;
};

export const runComplianceReminderSchedulerTick = async (
  schedule: ComplianceReminderSchedule,
  execute: (request: ComplianceReminderRequest) => Promise<unknown>,
  dueRetries: (now: Date) => Promise<readonly ComplianceReminderRequest[]>,
  current: Date,
): Promise<ComplianceReminderSchedulerTickResult> => {
  let retries: readonly ComplianceReminderRequest[];
  try {
    retries = await dueRetries(current);
  } catch {
    return { retryLoadFailed: true, retryCount: 0, scheduledCount: 0, executionFailures: 0 };
  }
  const scheduled = scheduledComplianceReminderRequest(schedule, current);
  const requests = [...retries, ...(scheduled === undefined ? [] : [scheduled])];
  const results = await Promise.allSettled(requests.map(execute));
  return {
    retryLoadFailed: false,
    retryCount: retries.length,
    scheduledCount: scheduled === undefined ? 0 : 1,
    executionFailures: results.filter((result) => result.status === "rejected").length,
  };
};
