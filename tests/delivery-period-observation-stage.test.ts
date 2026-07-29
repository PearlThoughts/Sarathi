import { describe, expect, it } from "vitest";
import { periodObservationCompletionStage } from "../src/infrastructure/postgres/delivery-intelligence-query-source.ts";

describe("period observation completion stages", () => {
  it("classifies an exact Jira transition to Done as accepted evidence", () => {
    expect(
      periodObservationCompletionStage({
        source: "jira",
        observationKind: "state",
        subjectObjectKind: "work_item",
        subjectLifecycleState: "done",
        summary: "F1851-123 changed from In Progress to Done",
      }),
    ).toBe("accepted");
  });

  it("does not use a later current-state refresh as period acceptance evidence", () => {
    expect(
      periodObservationCompletionStage({
        source: "jira",
        observationKind: "state",
        subjectObjectKind: "work_item",
        subjectLifecycleState: "done",
        summary: "F1851-123 is Done",
      }),
    ).toBeUndefined();
  });

  it("keeps deployments distinct and rejects non-Jira state transitions", () => {
    expect(
      periodObservationCompletionStage({
        source: "github",
        observationKind: "deployment",
        summary: "Production deployment completed",
      }),
    ).toBe("deployed");
    expect(
      periodObservationCompletionStage({
        source: "github",
        observationKind: "state",
        subjectObjectKind: "work_item",
        subjectLifecycleState: "done",
        summary: "DEMO-1 changed from In Progress to Done",
      }),
    ).toBeUndefined();
  });
});
