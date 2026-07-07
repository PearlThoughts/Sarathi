import type { Hono } from "hono";
import { errorBody, statusCodeForError } from "../../../domain/errors.ts";
import { parseJsonBody, runEffect } from "../../../platform/http.ts";
import type { SarathiRuntime } from "../../../platform/runtime.ts";
import { compileWorkspaceModel } from "../application/compile-workspace-model.ts";
import type { WorkspaceOverlay } from "../domain/workspace-model.ts";

export const registerWorkspaceModelRoutes = (app: Hono, runtime: SarathiRuntime): void => {
  app.get("/workspace-model", async (c) => {
    const overlay = await runEffect(runtime.workspaceOverlay.readOverlay());

    if (!overlay.ok) {
      return c.json(errorBody(overlay.error), statusCodeForError(overlay.error));
    }

    const compiled = await runEffect(
      compileWorkspaceModel(runtime.sourceSnapshot, overlay.value, runtime.clock.now()),
    );

    return compiled.ok
      ? c.json({ model: compiled.value })
      : c.json(errorBody(compiled.error), statusCodeForError(compiled.error));
  });

  app.post("/workspace-model/preview", async (c) => {
    const body = (await parseJsonBody(c.req.raw)) as WorkspaceOverlay;
    const compiled = await runEffect(
      compileWorkspaceModel(runtime.sourceSnapshot, body, runtime.clock.now()),
    );

    return compiled.ok
      ? c.json({ model: compiled.value })
      : c.json(errorBody(compiled.error), statusCodeForError(compiled.error));
  });
};
