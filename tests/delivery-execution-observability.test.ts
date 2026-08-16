import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createOpenTelemetryDeliveryExecutionObserver } from "../src/infrastructure/observability/open-telemetry-delivery-execution-observer.ts";
import {
  createInMemoryDeliveryExecutionObserver,
  deliveryExecutionStages,
  endDeliveryExecution,
  observeDeliveryEffect,
  sanitizeDeliveryExecutionAttributes,
  sanitizeDeliveryExecutionMetricLabels,
  startDeliveryExecution,
} from "../src/modules/delivery-execution-observability/index.ts";
import {
  createDeliveryAssistant,
  type DeliveryQuerySource,
} from "../src/modules/delivery-intelligence/index.ts";

describe("delivery execution observability", () => {
  it("keeps only allowlisted, bounded, non-content span attributes", () => {
    const sanitized = sanitizeDeliveryExecutionAttributes({
      "service.name": "sarathi",
      "response.mode": "deep_dive",
      "candidates.retrieved": 1451,
      question: "private question",
      answer: "private answer",
      prompt: "private prompt",
      source_excerpt: "private source material",
      url: "https://private.invalid/path",
      headers: { authorization: "secret" },
      "model.name": "x".repeat(161),
    });

    expect(sanitized).toEqual({
      "service.name": "sarathi",
      "response.mode": "deep_dive",
      "candidates.retrieved": 1451,
    });
    expect(JSON.stringify(sanitized)).not.toContain("private");
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });

  it("drops identifier-shaped metric keys and collapses unknown enum values", () => {
    const labels = sanitizeDeliveryExecutionMetricLabels({
      stage: "unregistered-stage",
      outcome: "success",
      response_mode: "deep_dive",
      trace_id: "deadbeef",
      execution_id: "request-1",
      entity_id: "entity-1",
      question_id: "question-1",
      customer_id: "customer-1",
    });

    expect(labels).toEqual({
      stage: "other",
      outcome: "success",
      response_mode: "deep_dive",
    });
  });

  it("records the required lifecycle stages as children of one report trace", async () => {
    const observer = createInMemoryDeliveryExecutionObserver();
    const controller = new AbortController();
    const root = startDeliveryExecution({
      observer,
      deadlineEpochMs: Date.now() + 10_000,
      signal: controller.signal,
    });

    for (const stage of deliveryExecutionStages.filter(
      (candidate) =>
        candidate !== "delivery.report" &&
        candidate !== "scheduler.execute" &&
        candidate !== "synchronization.execute",
    ))
      await Effect.runPromise(observeDeliveryEffect(root, stage, {}, () => Effect.succeed(stage)));
    endDeliveryExecution(root, "success");

    const report = observer.spans.find(({ span }) => span.stage === "delivery.report");
    expect(report?.outcome).toBe("success");
    const children = observer.spans.filter(({ span }) => span.stage !== "delivery.report");
    expect(children).toHaveLength(deliveryExecutionStages.length - 3);
    expect(children.every(({ span }) => span.traceId === report?.span.traceId)).toBe(true);
    expect(children.every(({ span }) => span.parentSpanId === report?.span.spanId)).toBe(true);
    expect(
      children.every(({ attributes }) => attributes?.["budget.remaining.ms"] !== undefined),
    ).toBe(true);
  });

  it("instruments the real assistant path and propagates its deadline context to sources", async () => {
    const observer = createInMemoryDeliveryExecutionObserver();
    const execute = vi.fn<DeliveryQuerySource["execute"]>((context) => {
      expect(context.execution?.deadlineEpochMs).toBe(Date.parse(context.deadlineAt));
      expect(context.execution?.signal).toBeInstanceOf(AbortSignal);
      return Effect.succeed({
        items: [
          {
            id: "synthetic-item",
            workspaceId: context.workspaceId,
            source: "jira",
            selector: "observations",
            intent: "activity",
            title: "Synthetic delivery item",
            summary: "Synthetic delivery item completed.",
            citationUrl: "https://example.com/synthetic-item",
            sensitivity: "internal",
            authority: 1,
            observedAt: context.requestedAt,
            dedupeKey: "synthetic-item",
          },
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      });
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute,
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source], executionObserver: observer }).answer({
        workspaceId: "synthetic-workspace",
        actorId: "synthetic-actor",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: new Date().toISOString(),
        timeZone: "UTC",
        question: "What did the team do today?",
      }),
    );

    expect(answer.status).toBe("ok");
    expect(execute).toHaveBeenCalledOnce();
    expect(observer.spans.map(({ span }) => span.stage)).toEqual(
      expect.arrayContaining([
        "delivery.report",
        "authorization.resolve",
        "question.plan",
        "source.retrieve",
        "retrieval.fuse",
        "episode.consolidate",
        "completion.assess",
      ]),
    );
    expect(observer.spans.every(({ outcome }) => outcome !== undefined)).toBe(true);
  });

  it("reuses an ingress-owned absolute deadline without ending the shared report root", async () => {
    const observer = createInMemoryDeliveryExecutionObserver();
    const controller = new AbortController();
    const deadlineEpochMs = Date.now() + 5_000;
    const execution = startDeliveryExecution({
      observer,
      deadlineEpochMs,
      signal: controller.signal,
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: (context) => {
        expect(context.execution?.deadlineEpochMs).toBe(deadlineEpochMs);
        expect(context.deadlineAt).toBe(new Date(deadlineEpochMs).toISOString());
        return Effect.succeed({
          items: [],
          conflicts: [],
          unavailableSources: ["jira"],
          complete: false,
        });
      },
    };

    await Effect.runPromise(
      createDeliveryAssistant({ sources: [source], execution }).answer({
        workspaceId: "synthetic-workspace",
        actorId: "synthetic-actor",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: new Date().toISOString(),
        timeZone: "UTC",
        question: "What did the team do today?",
      }),
    );

    const report = observer.spans.find(({ span }) => span.stage === "delivery.report");
    expect(report?.outcome).toBeUndefined();
    expect(observer.spans.filter(({ span }) => span.stage === "delivery.report")).toHaveLength(1);
    endDeliveryExecution(execution, "success");
    expect(report?.outcome).toBeUndefined();
    expect(observer.spans.find(({ span }) => span.stage === "delivery.report")?.outcome).toBe(
      "success",
    );
  });

  it("keeps structured logging and safe error capture fail-open", async () => {
    const observer = createOpenTelemetryDeliveryExecutionObserver({
      structuredLog: () => {
        throw new Error("unavailable");
      },
      safeErrorCapture: () => {
        throw new Error("unavailable");
      },
    });
    const span = observer.startSpan({ stage: "delivery.report" });

    expect(() =>
      observer.endSpan(span, { outcome: "failed", failureClass: "other" }),
    ).not.toThrow();
    expect(() =>
      observer.captureError({
        code: "SAFE-CODE",
        stage: "delivery.report",
        failureClass: "other",
      }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("adds bounded synchronous overhead before asynchronous export", () => {
    const structuredLog = vi.fn();
    const observer = createOpenTelemetryDeliveryExecutionObserver({ structuredLog });
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      const span = observer.startSpan({ stage: "source.retrieve" });
      observer.endSpan(span, { outcome: "success" });
    }
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(500);
  });
});
