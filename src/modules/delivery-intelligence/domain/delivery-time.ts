import type { DeliveryTimeConstraint } from "./delivery-query.ts";

type CalendarDate = { readonly year: number; readonly month: number; readonly day: number };

const zonedParts = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
};

const zonedMidnight = (date: CalendarDate, timeZone: string): Date => {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += target - represented;
  }
  return new Date(candidate);
};

export type AbsoluteDeliveryTimeWindow = {
  readonly fromInclusive: string;
  readonly toExclusive: string;
};

export const resolveDeliveryTimeConstraint = (
  constraint: Exclude<DeliveryTimeConstraint, { readonly kind: "jira_sprint" }>,
  requestedAt: string,
  timeZone: string,
): AbsoluteDeliveryTimeWindow => {
  if (constraint.kind === "absolute") return constraint;
  const instant = new Date(requestedAt);
  if (Number.isNaN(instant.getTime())) throw new Error("Delivery request time must be ISO-8601.");
  const current = zonedParts(instant, timeZone);
  const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const nextDate = new Date(currentDate.getTime() + 86_400_000);
  const day = {
    fromInclusive: zonedMidnight(current, timeZone).toISOString(),
    toExclusive: zonedMidnight(
      {
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
      },
      timeZone,
    ).toISOString(),
  };
  if (constraint.kind === "workspace_day") return day;
  if (constraint.kind === "lookback") {
    return {
      fromInclusive: new Date(
        Date.parse(day.fromInclusive) - constraint.days * 86_400_000,
      ).toISOString(),
      toExclusive: day.toExclusive,
    };
  }
  const daysSinceMonday = (currentDate.getUTCDay() + 6) % 7;
  const monday = new Date(currentDate.getTime() - daysSinceMonday * 86_400_000);
  const previousMonday = new Date(monday.getTime() - 7 * 86_400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  if (constraint.kind === "workspace_previous_week") {
    return {
      fromInclusive: zonedMidnight(
        {
          year: previousMonday.getUTCFullYear(),
          month: previousMonday.getUTCMonth() + 1,
          day: previousMonday.getUTCDate(),
        },
        timeZone,
      ).toISOString(),
      toExclusive: zonedMidnight(
        {
          year: monday.getUTCFullYear(),
          month: monday.getUTCMonth() + 1,
          day: monday.getUTCDate(),
        },
        timeZone,
      ).toISOString(),
    };
  }
  return {
    fromInclusive: zonedMidnight(
      {
        year: monday.getUTCFullYear(),
        month: monday.getUTCMonth() + 1,
        day: monday.getUTCDate(),
      },
      timeZone,
    ).toISOString(),
    toExclusive: zonedMidnight(
      {
        year: nextMonday.getUTCFullYear(),
        month: nextMonday.getUTCMonth() + 1,
        day: nextMonday.getUTCDate(),
      },
      timeZone,
    ).toISOString(),
  };
};
