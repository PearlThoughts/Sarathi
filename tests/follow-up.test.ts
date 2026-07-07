import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  type FollowUpDelivery,
  type FollowUpItem,
  type FollowUpSource,
  formatExceptionDigest,
  formatPlanningDigest,
  getMondayWeekWindow,
} from "../src/modules/follow-up/index.ts";

const item = (overrides: Partial<FollowUpItem>): FollowUpItem => ({
  id: "WORK-1",
  title: "Refresh acceptance criteria",
  status: "In Progress",
  dueDate: "2026-07-02",
  owner: "Product",
  source: {
    system: "jira",
    externalId: "WORK-1",
    confidence: "observed",
  },
  sensitivity: "internal",
  ...overrides,
});

describe("follow-up capability", () => {
  it("builds a Monday-Sunday planning window", () => {
    expect(getMondayWeekWindow("2026-07-02")).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-07-05",
    });
  });

  it("formats generic planning digests without internal workflow language", () => {
    const copy = {
      title: "Review queue",
      emptyText: "No open items are due this week.",
      footer: "Source systems own item status.",
    };
    const digest = formatPlanningDigest(
      [item({ id: "WORK-2", dueDate: "2026-07-03", url: "https://example.test/browse/WORK-2" })],
      "2026-07-02",
      getMondayWeekWindow("2026-07-02"),
      copy,
    );

    expect(digest).toMatchObject({
      kind: "planning",
      itemCount: 1,
    });
    expect(digest.text).toContain("[WORK-2](https://example.test/browse/WORK-2)");
    expect(digest.text).toContain("due in 1 day");
    expect(digest.text).toContain("Source systems own item status.");
  });

  it("formats exception digests from due and overdue items only", () => {
    const digest = formatExceptionDigest(
      [
        item({ id: "WORK-1", dueDate: "2026-07-01" }),
        item({ id: "WORK-2", dueDate: "2026-07-02" }),
        item({ id: "WORK-3", dueDate: "2026-07-04" }),
      ],
      "2026-07-02",
    );

    expect(digest).toMatchObject({
      kind: "exceptions",
      itemCount: 2,
    });
    expect(digest.text).toContain("WORK-1");
    expect(digest.text).toContain("WORK-2");
    expect(digest.text).not.toContain("WORK-3");
  });

  it("defines source and delivery ports without binding to a vendor", async () => {
    const source: FollowUpSource = {
      provider: "follow-up-source",
      findOpenItems: () => Effect.succeed([item({ id: "WORK-4" })]),
    };
    const delivery: FollowUpDelivery = {
      provider: "follow-up-delivery",
      deliverDigest: () => Effect.succeed({ delivered: true, externalId: "message-1" }),
    };

    const items = await Effect.runPromise(source.findOpenItems({ dueTo: "2026-07-02" }));
    const digest = formatExceptionDigest(items, "2026-07-02");
    const result = await Effect.runPromise(delivery.deliverDigest(digest));

    expect(items).toHaveLength(1);
    expect(result).toEqual({ delivered: true, externalId: "message-1" });
  });
});
