import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runRepositoryEffect } from "../src/cli/commands/effect-repository-promise.ts";
import { RepositoryError } from "../src/domain/errors.ts";

describe("repository Effect promise boundary", () => {
  it("returns successful values", async () => {
    await expect(runRepositoryEffect(Effect.succeed("ready"))).resolves.toBe("ready");
  });

  it("preserves the typed repository failure instead of a FiberFailure wrapper", async () => {
    const failure = new RepositoryError({
      message: "private diagnostic detail",
      operation: "knowledge-reconcile",
    });

    await expect(runRepositoryEffect(Effect.fail(failure))).rejects.toBe(failure);
  });
});
