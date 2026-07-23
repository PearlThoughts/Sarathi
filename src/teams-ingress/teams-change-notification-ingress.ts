import { timingSafeEqual } from "node:crypto";
import { stableSha256 } from "../domain/hash.ts";

type TeamsChangeNotificationBatch = {
  readonly providerEventId: string;
  readonly payloadHash: string;
  readonly includesLifecycleEvent: boolean;
  readonly notificationCount: number;
};

type SafeNotificationIdentity = {
  readonly subscriptionId: string;
  readonly changeType?: string | undefined;
  readonly lifecycleEvent?: string | undefined;
  readonly resource: string;
  readonly resourceDataId?: string | undefined;
  readonly resourceDataVersion?: string | undefined;
};

const nonBlank = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const protectedEqual = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

const safeIdentity = (
  value: unknown,
  expectedClientState: string,
): SafeNotificationIdentity | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const notification = value as {
    readonly subscriptionId?: unknown;
    readonly clientState?: unknown;
    readonly changeType?: unknown;
    readonly lifecycleEvent?: unknown;
    readonly resource?: unknown;
    readonly resourceData?: unknown;
  };
  const clientState = nonBlank(notification.clientState);
  if (clientState === undefined || !protectedEqual(clientState, expectedClientState))
    throw new Error("Microsoft Graph notification client state is invalid.");
  const subscriptionId = nonBlank(notification.subscriptionId);
  const resource = nonBlank(notification.resource);
  const changeType = nonBlank(notification.changeType);
  const lifecycleEvent = nonBlank(notification.lifecycleEvent);
  if (
    subscriptionId === undefined ||
    resource === undefined ||
    (changeType === undefined && lifecycleEvent === undefined)
  )
    return undefined;
  const resourceData =
    typeof notification.resourceData === "object" && notification.resourceData !== null
      ? (notification.resourceData as {
          readonly id?: unknown;
          readonly "@odata.etag"?: unknown;
        })
      : undefined;
  return {
    subscriptionId,
    resource,
    ...(changeType === undefined ? {} : { changeType }),
    ...(lifecycleEvent === undefined ? {} : { lifecycleEvent }),
    ...(nonBlank(resourceData?.id) === undefined
      ? {}
      : { resourceDataId: nonBlank(resourceData?.id) }),
    ...(nonBlank(resourceData?.["@odata.etag"]) === undefined
      ? {}
      : { resourceDataVersion: nonBlank(resourceData?.["@odata.etag"]) }),
  };
};

export const parseTeamsChangeNotificationBatch = (
  body: unknown,
  expectedClientState: string,
): TeamsChangeNotificationBatch => {
  if (expectedClientState.trim().length < 16)
    throw new Error("Microsoft Graph notification client state is not configured safely.");
  if (typeof body !== "object" || body === null || !("value" in body))
    throw new Error("Microsoft Graph notification body is invalid.");
  const values = (body as { readonly value?: unknown }).value;
  if (!Array.isArray(values) || values.length === 0 || values.length > 1_000)
    throw new Error("Microsoft Graph notification batch size is invalid.");
  const identities = values.flatMap((value) => {
    const identity = safeIdentity(value, expectedClientState);
    return identity === undefined ? [] : [identity];
  });
  if (identities.length === 0)
    throw new Error("Microsoft Graph notification batch contains no actionable events.");
  const canonical = JSON.stringify(
    [...identities].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
  );
  const digest = stableSha256(canonical);
  return {
    providerEventId: `microsoft-graph:${digest}`,
    payloadHash: digest,
    includesLifecycleEvent: identities.some(({ lifecycleEvent }) => lifecycleEvent !== undefined),
    notificationCount: identities.length,
  };
};
