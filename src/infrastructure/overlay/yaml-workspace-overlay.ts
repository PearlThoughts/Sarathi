import { Effect } from "effect";
import { parse } from "yaml";
import { ValidationError } from "../../domain/errors.ts";
import type {
  WorkspaceOverlay,
  WorkspaceOverlaySource,
} from "../../modules/workspace-model/ports/workspace-overlay-source.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toWorkspaceOverlay = (value: unknown): WorkspaceOverlay => {
  if (!isRecord(value)) {
    throw new ValidationError({ message: "workspace overlay must be a YAML object" });
  }

  if (value.version !== 1) {
    throw new ValidationError({ field: "version", message: "workspace overlay version must be 1" });
  }

  if (typeof value.organizationId !== "string") {
    throw new ValidationError({
      field: "organizationId",
      message: "workspace overlay organizationId must be a string",
    });
  }

  if (!Array.isArray(value.teams)) {
    throw new ValidationError({
      field: "teams",
      message: "workspace overlay teams must be an array",
    });
  }

  return value as WorkspaceOverlay;
};

export const makeYamlWorkspaceOverlaySource = (path: string): WorkspaceOverlaySource => ({
  provider: "yaml",
  readOverlay: () =>
    Effect.tryPromise({
      try: async () => toWorkspaceOverlay(parse(await Bun.file(path).text())),
      catch: (error) =>
        error instanceof ValidationError
          ? error
          : new ValidationError({
              field: "overlay",
              message: error instanceof Error ? error.message : "workspace overlay parse failed",
            }),
    }),
});

export const makeStaticWorkspaceOverlaySource = (
  overlay: WorkspaceOverlay,
): WorkspaceOverlaySource => ({
  provider: "yaml",
  readOverlay: () => Effect.succeed(overlay),
});
