import type { Effect } from "effect";
import type { ValidationError } from "../../../domain/errors.ts";
import type { WorkspaceOverlay } from "../domain/workspace-model.ts";

export type { WorkspaceOverlay } from "../domain/workspace-model.ts";

export type WorkspaceOverlaySource = {
  readonly provider: "yaml";
  readonly readOverlay: () => Effect.Effect<WorkspaceOverlay, ValidationError>;
};
