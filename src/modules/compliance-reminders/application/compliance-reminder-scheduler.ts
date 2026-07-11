import type { ComplianceReminderRequest } from "../domain/compliance-reminder.ts";

export type ComplianceReminderSchedule = {
  readonly enabled: boolean;
  readonly workspaceId: string;
  readonly timezone: string;
  readonly weeklyDigestTime: string;
  readonly exceptionDigestTime: string;
};

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
  now: () => Date = () => new Date(),
): { readonly stop: () => void } => {
  const inFlight = new Set<string>();
  const tick = (): void => {
    const request = scheduledComplianceReminderRequest(schedule, now());
    if (request === undefined || inFlight.has(request.idempotencyKey)) return;
    inFlight.add(request.idempotencyKey);
    void execute(request).finally(() => inFlight.delete(request.idempotencyKey));
  };
  tick();
  const interval = setInterval(tick, 60_000);
  return { stop: () => clearInterval(interval) };
};
