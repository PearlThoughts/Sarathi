import { describe, expect, it } from "vitest";
import {
  createBetterStackSafeErrorCapture,
  safeBetterStackErrorEvent,
} from "../src/infrastructure/observability/index.ts";

describe("Better Stack safe error boundary", () => {
  it("exports only bounded codes, stage, failure class, deployment, and elapsed time", () => {
    const event = safeBetterStackErrorEvent({
      code: "SARATHI-REPORT-DEADLINE",
      stage: "parent.expand",
      failureClass: "internal_deadline_exhaustion",
      deploymentId: "deployment-opaque",
      elapsedMs: 90_001,
    });

    expect(event).toEqual({
      message: "SARATHI-REPORT-DEADLINE",
      level: "error",
      tags: {
        code: "SARATHI-REPORT-DEADLINE",
        stage: "parent.expand",
        failure_class: "internal_deadline_exhaustion",
        deployment_id: "deployment-opaque",
      },
      extra: { elapsed_ms: 90_001 },
    });
  });

  it("collapses content-shaped or unbounded values before the Sentry-compatible edge", () => {
    const event = safeBetterStackErrorEvent({
      code: "private question and answer",
      stage: "https://private.invalid/source/path",
      failureClass: "private provider response\nwith headers",
      deploymentId: "x".repeat(161),
      elapsedMs: Number.NaN,
    });
    const serialized = JSON.stringify(event);

    expect(event).toEqual({
      message: "SARATHI-SAFE-ERROR",
      level: "error",
      tags: {
        code: "SARATHI-SAFE-ERROR",
        stage: "other",
        failure_class: "other",
        deployment_id: "other",
      },
    });
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("headers");
    expect(serialized).not.toContain("invalid");
  });

  it("stays disabled and fail-open when the Errors endpoint is absent or invalid", () => {
    expect(createBetterStackSafeErrorCapture({})).toBeUndefined();
    expect(
      createBetterStackSafeErrorCapture({
        SARATHI_ERRORS_DSN: "https://example.invalid/not-better-stack",
      }),
    ).toBeUndefined();
  });
});
