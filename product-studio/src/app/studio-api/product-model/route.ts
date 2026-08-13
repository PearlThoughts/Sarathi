import config from "@payload-config";
import { getPayload } from "payload";
import { createProductModelReadHandler } from "../../../server/product-model-read-handler";
import { createSarathiProductModelClientFromEnvironment } from "../../../server/sarathi-product-model-client";

export const GET = createProductModelReadHandler({
  authenticate: async (request) => {
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    return user !== null;
  },
  client: createSarathiProductModelClientFromEnvironment(),
});
