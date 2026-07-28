import { describe, expect, it } from "vitest";
import {
  planDeliveryQuestion,
  resolveDeliveryTimeConstraint,
} from "../src/modules/delivery-intelligence/index.ts";

describe("delivery reporting period boundaries", () => {
  it("parses arbitrary and source-defined report periods", () => {
    expect(
      planDeliveryQuestion("Give me a delivery report for the last 37 days")?.operations.at(-1),
    ).toMatchObject({
      select: "period_census",
      time: { kind: "lookback", days: 37 },
    });
    expect(
      planDeliveryQuestion("Give me the previous sprint delivery report")?.operations.at(-1),
    ).toMatchObject({
      select: "period_census",
      time: { kind: "jira_sprint", sprint: "previous" },
    });
    expect(
      planDeliveryQuestion("Give me the release v2.4 delivery report")?.operations.at(-1),
    ).toMatchObject({
      select: "period_census",
      time: { kind: "release", release: "v2.4" },
    });
  });

  it("uses inclusive/exclusive workspace-local boundaries across daylight-saving changes", () => {
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "workspace_day" },
        "2026-03-08T16:00:00.000Z",
        "America/New_York",
      ),
    ).toEqual({
      fromInclusive: "2026-03-08T05:00:00.000Z",
      toExclusive: "2026-03-09T04:00:00.000Z",
    });
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "lookback", days: 2 },
        "2026-03-08T16:00:00.000Z",
        "America/New_York",
      ),
    ).toEqual({
      fromInclusive: "2026-03-07T05:00:00.000Z",
      toExclusive: "2026-03-09T04:00:00.000Z",
    });
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "lookback", days: 3 },
        "2026-03-09T16:00:00.000Z",
        "America/New_York",
      ),
    ).toEqual({
      fromInclusive: "2026-03-07T05:00:00.000Z",
      toExclusive: "2026-03-10T04:00:00.000Z",
    });
  });

  it("resolves month and quarter boundaries in the workspace timezone", () => {
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "workspace_month", month: { year: 2026, month: 2 } },
        "2026-07-20T13:09:00.000Z",
        "Asia/Kolkata",
      ),
    ).toEqual({
      fromInclusive: "2026-01-31T18:30:00.000Z",
      toExclusive: "2026-02-28T18:30:00.000Z",
    });
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "workspace_quarter", quarter: { year: 2026, quarter: 2 } },
        "2026-07-20T13:09:00.000Z",
        "Asia/Kolkata",
      ),
    ).toEqual({
      fromInclusive: "2026-03-31T18:30:00.000Z",
      toExclusive: "2026-06-30T18:30:00.000Z",
    });
  });
});
