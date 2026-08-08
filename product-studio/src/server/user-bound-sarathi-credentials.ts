import "server-only";
import { z } from "zod";

export type UserBoundSarathiCredential = {
  readonly actorId: string;
  readonly accessToken: string;
  readonly expiresAt: string;
};

type UserBoundSarathiCredentialProvider = {
  readonly resolve: (payloadUserId: string) => UserBoundSarathiCredential;
};

class UserBoundSarathiCredentialUnavailable extends Error {
  constructor() {
    super("A user-bound Sarathi credential is unavailable.");
    this.name = "UserBoundSarathiCredentialUnavailable";
  }
}

const credentialsSchema = z.record(
  z.string().min(1),
  z
    .object({
      actorId: z.string().min(1),
      accessToken: z.string().min(16),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
);

export const createUserBoundSarathiCredentialProvider = (
  serializedCredentials: string | undefined = process.env
    .SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON,
  now: () => string = () => new Date().toISOString(),
): UserBoundSarathiCredentialProvider => {
  let credentials: z.infer<typeof credentialsSchema> = {};
  if (serializedCredentials !== undefined && serializedCredentials.trim() !== "") {
    try {
      credentials = credentialsSchema.parse(JSON.parse(serializedCredentials));
    } catch {
      throw new UserBoundSarathiCredentialUnavailable();
    }
  }

  return {
    resolve: (payloadUserId) => {
      const credential = credentials[payloadUserId];
      if (
        payloadUserId.trim() === "" ||
        credential === undefined ||
        Date.parse(credential.expiresAt) <= Date.parse(now())
      )
        throw new UserBoundSarathiCredentialUnavailable();
      return credential;
    },
  };
};
