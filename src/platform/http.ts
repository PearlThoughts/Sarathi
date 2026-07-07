import { Effect } from "effect";

type EffectResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const runEffect = async <T, E>(effect: Effect.Effect<T, E>): Promise<EffectResult<T, E>> => {
  return Effect.runPromise(
    Effect.match(effect, {
      onSuccess: (value) => ({ ok: true, value }),
      onFailure: (error) => ({ ok: false, error }),
    }),
  );
};

export const parseJsonBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text.trim().length === 0 ? {} : JSON.parse(text);
};
