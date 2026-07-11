import { describe, expect, it } from "vitest";
import {
  type ComplianceReminderSchedule,
  scheduledComplianceReminderRequest,
  startComplianceReminderScheduler,
} from "../src/modules/compliance-reminders/index.ts";

const schedule: ComplianceReminderSchedule = {
  enabled: true,
  workspaceId: "synthetic-workspace",
  timezone: "UTC",
  weeklyDigestTime: "09:00",
  exceptionDigestTime: "10:00",
};

describe("compliance reminder scheduler", () => {
  it("creates an explicit workspace-scoped Monday planning request", () => {
    const request = scheduledComplianceReminderRequest(
      schedule,
      new Date("2026-07-13T09:00:00.000Z"),
    );
    expect(request).toMatchObject({
      workspaceId: "synthetic-workspace",
      kind: "planning",
      idempotencyKey: "synthetic-workspace:planning:2026-07-13",
      window: { startDate: "2026-07-13", endDate: "2026-07-19" },
    });
  });

  it("creates weekday exception requests and fails closed outside the cadence", () => {
    expect(
      scheduledComplianceReminderRequest(schedule, new Date("2026-07-14T10:00:00.000Z")),
    ).toMatchObject({ kind: "exceptions" });
    expect(
      scheduledComplianceReminderRequest(schedule, new Date("2026-07-18T10:00:00.000Z")),
    ).toBeUndefined();
    expect(
      scheduledComplianceReminderRequest(
        { ...schedule, enabled: false },
        new Date("2026-07-13T09:00:00.000Z"),
      ),
    ).toBeUndefined();
  });

  it("does not execute when an explicit schedule is disabled", () => {
    let calls = 0;
    const handle = startComplianceReminderScheduler(
      { ...schedule, enabled: false },
      async () => {
        calls += 1;
      },
      () => new Date("2026-07-13T09:00:00.000Z"),
    );
    handle.stop();
    expect(calls).toBe(0);
  });
});
