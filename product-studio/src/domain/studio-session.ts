import type { Collection } from "payload";

export const STUDIO_USER_COLLECTION_SLUG = "studio-users";
export const REMEMBERED_SESSION_SECONDS = 365 * 24 * 60 * 60;

export const sessionLifetimeSeconds = (
  configuredLifetimeSeconds: number,
  remember: unknown,
): number => (remember === true ? REMEMBERED_SESSION_SECONDS : configuredLifetimeSeconds);

export const withStudioSessionLifetime = (
  collection: Collection,
  remember: unknown,
): Collection => ({
  ...collection,
  config: {
    ...collection.config,
    auth: {
      ...collection.config.auth,
      tokenExpiration: sessionLifetimeSeconds(collection.config.auth.tokenExpiration, remember),
    },
  },
});
