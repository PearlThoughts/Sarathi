import { describe, expect, it } from "vitest";
import { parseTeamsChangeNotificationBatch } from "../src/teams-ingress/teams-change-notification-ingress.ts";

const clientState = "synthetic-protected-client-state";

describe("Teams change-notification ingress", () => {
  it("reduces provider bodies to one stable privacy-safe event identity", () => {
    const body = {
      value: [
        {
          subscriptionId: "subscription-1",
          clientState,
          changeType: "updated",
          resource: "teams/team-1/channels/channel-1/messages/message-1",
          resourceData: { id: "message-1", "@odata.etag": "version-2", body: "not retained" },
        },
      ],
    };

    const first = parseTeamsChangeNotificationBatch(body, clientState);
    const second = parseTeamsChangeNotificationBatch(body, clientState);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      includesLifecycleEvent: false,
      notificationCount: 1,
    });
    expect(first.providerEventId).toMatch(/^microsoft-graph:sha256-/);
    expect(first.payloadHash).toMatch(/^sha256-/);
    expect(JSON.stringify(first)).not.toContain("not retained");
    expect(JSON.stringify(first)).not.toContain(clientState);
  });

  it("recognizes lifecycle notifications and rejects invalid client state", () => {
    const body = {
      value: [
        {
          subscriptionId: "subscription-1",
          clientState,
          lifecycleEvent: "subscriptionRemoved",
          resource: "teams/team-1/channels/channel-1/messages",
        },
      ],
    };

    expect(parseTeamsChangeNotificationBatch(body, clientState).includesLifecycleEvent).toBe(true);
    expect(() => parseTeamsChangeNotificationBatch(body, "another-protected-client-state")).toThrow(
      "client state is invalid",
    );
  });

  it("fails closed for empty or non-actionable batches", () => {
    expect(() => parseTeamsChangeNotificationBatch({ value: [] }, clientState)).toThrow(
      "batch size is invalid",
    );
    expect(() =>
      parseTeamsChangeNotificationBatch(
        { value: [{ subscriptionId: "subscription-1", clientState, resource: "resource" }] },
        clientState,
      ),
    ).toThrow("no actionable events");
  });
});
