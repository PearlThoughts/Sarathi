import { Effect } from "effect";
import type { Hono } from "hono";
import { errorBody, statusCodeForError } from "../domain/errors.ts";
import { runEffect } from "./http.ts";
import type { SarathiRuntime } from "./runtime.ts";

export const registerPlatformRoutes = (app: Hono, runtime: SarathiRuntime): void => {
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: runtime.config.serviceName,
      environment: runtime.config.environment,
    }),
  );

  app.get("/platform/foundation", async (c) => {
    const overlay = await runEffect(runtime.workspaceOverlay.readOverlay());

    return overlay.ok
      ? c.json({
          service: runtime.config.serviceName,
          environment: runtime.config.environment,
          authProvider: runtime.auth.provider,
          authorizationProvider: runtime.authorization.provider,
          overlayProvider: runtime.workspaceOverlay.provider,
          sourceSystems: ["microsoft-teams", "linear", "github", "jira"],
          safetyInvariant: "authorization-before-retrieval-tool-and-model-egress",
        })
      : c.json(errorBody(overlay.error), statusCodeForError(overlay.error));
  });

  app.get("/platform/authorization/sample", async (c) => {
    const result = await runEffect(
      runtime.authorization.check({
        principalId: "sample",
        principalTrustTier: "member",
        action: "read-context",
        object: {
          type: "operating-team",
          id: "engineering",
          sensitivity: "internal",
        },
      }),
    );

    return result.ok
      ? c.json({ decision: result.value })
      : c.json(errorBody(result.error), statusCodeForError(result.error));
  });

  app.get("/ready", async (c) => {
    const result = await runEffect(Effect.succeed(true));
    return result.ok ? c.json({ ready: true }) : c.json({ ready: false }, 503);
  });
};
