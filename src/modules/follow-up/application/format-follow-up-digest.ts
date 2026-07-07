import type { FollowUpDigest, FollowUpItem, FollowUpWindow } from "../domain/follow-up.ts";
import { daysBetween, formatFriendlyDate } from "./date-window.ts";

type FollowUpDigestCopy = {
  readonly title: string;
  readonly emptyText: string;
  readonly footer?: string | undefined;
};

const defaultPlanningCopy: FollowUpDigestCopy = {
  title: "Items for this week",
  emptyText: "No open items are due this week.",
  footer: "Source systems own item status. Sarathi only formats approved follow-up context.",
};

const defaultExceptionCopy: FollowUpDigestCopy = {
  title: "Follow-up exceptions",
  emptyText: "No open items are due today or overdue.",
  footer: "Resolve the source item to stop follow-up prompts.",
};

const itemLine = (item: FollowUpItem, today: string): string => {
  const delta = daysBetween(today, item.dueDate);
  const dueText =
    delta < 0
      ? `overdue by ${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"}`
      : delta === 0
        ? "due today"
        : `due in ${delta} day${delta === 1 ? "" : "s"}`;
  const link = item.url === undefined ? item.id : `[${item.id}](${item.url})`;
  const owner = item.owner === undefined ? "Unassigned" : item.owner;

  return `- ${link} ${item.title} - ${formatFriendlyDate(item.dueDate)} (${dueText}) - ${item.status} - ${owner}`;
};

export const formatPlanningDigest = (
  items: readonly FollowUpItem[],
  today: string,
  window: FollowUpWindow,
  copy: FollowUpDigestCopy = defaultPlanningCopy,
): FollowUpDigest => {
  const lines = [
    copy.title,
    `${formatFriendlyDate(window.startDate)} to ${formatFriendlyDate(window.endDate)}`,
    "",
  ];

  if (items.length === 0) {
    lines.push(copy.emptyText);
  } else {
    lines.push(...items.map((item) => itemLine(item, today)));
  }

  if (copy.footer !== undefined) {
    lines.push("", copy.footer);
  }

  return {
    kind: "planning",
    today,
    itemCount: items.length,
    text: lines.join("\n"),
    window,
  };
};

export const formatExceptionDigest = (
  items: readonly FollowUpItem[],
  today: string,
  copy: FollowUpDigestCopy = defaultExceptionCopy,
): FollowUpDigest => {
  const overdue = items.filter((item) => daysBetween(today, item.dueDate) < 0);
  const dueToday = items.filter((item) => daysBetween(today, item.dueDate) === 0);
  const lines = [copy.title, formatFriendlyDate(today), ""];

  if (overdue.length === 0 && dueToday.length === 0) {
    lines.push(copy.emptyText);
  }

  if (dueToday.length > 0) {
    lines.push("Due today", ...dueToday.map((item) => itemLine(item, today)), "");
  }

  if (overdue.length > 0) {
    lines.push("Overdue", ...overdue.map((item) => itemLine(item, today)), "");
  }

  if (copy.footer !== undefined) {
    lines.push(copy.footer);
  }

  return {
    kind: "exceptions",
    today,
    itemCount: dueToday.length + overdue.length,
    text: lines.join("\n"),
  };
};
