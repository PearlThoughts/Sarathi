import { Effect, Either } from "effect";
import type { RepositoryError } from "../../domain/errors.ts";

export const runRepositoryEffect = async <Value>(
  effect: Effect.Effect<Value, RepositoryError>,
): Promise<Value> => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) throw result.left;
  return result.right;
};
