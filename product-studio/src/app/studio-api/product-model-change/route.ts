import config from "@payload-config";
import { getPayload } from "payload";
import { createProductModelChangeHandler } from "../../../server/product-model-change-handler";
import { createSarathiProductModelMutationClient } from "../../../server/sarathi-product-model-mutation-client";
import { createUserBoundSarathiCredentialProvider } from "../../../server/user-bound-sarathi-credentials";

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

const credentials = createUserBoundSarathiCredentialProvider();

export const POST = createProductModelChangeHandler({
  authenticate: async (request) => {
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    return user === null ? undefined : { id: String(user.id) };
  },
  credentials,
  clientFor: (credential) =>
    createSarathiProductModelMutationClient({
      baseUrl: required("SARATHI_API_BASE_URL", process.env.SARATHI_API_BASE_URL),
      workspaceId: required(
        "SARATHI_PRODUCT_STUDIO_WORKSPACE_ID",
        process.env.SARATHI_PRODUCT_STUDIO_WORKSPACE_ID,
      ),
      credential,
    }),
  workspaceId: required(
    "SARATHI_PRODUCT_STUDIO_WORKSPACE_ID",
    process.env.SARATHI_PRODUCT_STUDIO_WORKSPACE_ID,
  ),
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
});
