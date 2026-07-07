import type { FollowUpWindow } from "../domain/follow-up.ts";

const parseDateOnly = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => {
  const current = parseDateOnly(date);
  current.setUTCDate(current.getUTCDate() + days);
  return formatDateOnly(current);
};

const getWeekday = (date: string): number => parseDateOnly(date).getUTCDay();

export const getMondayWeekWindow = (date: string): FollowUpWindow => {
  const weekday = getWeekday(date);
  const daysSinceMonday = (weekday + 6) % 7;
  const startDate = addDays(date, -daysSinceMonday);

  return {
    startDate,
    endDate: addDays(startDate, 6),
  };
};

export const daysBetween = (fromDate: string, toDate: string): number => {
  const from = parseDateOnly(fromDate).getTime();
  const to = parseDateOnly(toDate).getTime();

  return Math.round((to - from) / 86_400_000);
};

export const formatFriendlyDate = (date: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateOnly(date));
