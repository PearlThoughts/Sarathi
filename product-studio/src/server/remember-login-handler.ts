import {
  addDataAndFileToRequest,
  generatePayloadCookie,
  headersWithCors,
  loginOperation,
  type PayloadHandler,
} from "payload";
import { STUDIO_USER_COLLECTION_SLUG, withStudioSessionLifetime } from "../domain/studio-session";

export const rememberLoginHandler: PayloadHandler = async (req) => {
  await addDataAndFileToRequest(req);
  const configuredCollection = req.payload.collections[STUDIO_USER_COLLECTION_SLUG];
  if (configuredCollection === undefined) {
    throw new Error(`Payload collection ${STUDIO_USER_COLLECTION_SLUG} is unavailable.`);
  }

  const collection = withStudioSessionLifetime(configuredCollection, req.data?.remember);
  const authData =
    collection.config.auth.loginWithUsername !== false
      ? {
          email: typeof req.data?.email === "string" ? req.data.email : "",
          password: typeof req.data?.password === "string" ? req.data.password : "",
          username: typeof req.data?.username === "string" ? req.data.username : "",
        }
      : {
          email: typeof req.data?.email === "string" ? req.data.email : "",
          password: typeof req.data?.password === "string" ? req.data.password : "",
        };

  const result = await loginOperation({ collection, data: authData, req });
  if (typeof result.token !== "string") {
    throw new Error("Payload login completed without issuing a session token.");
  }

  const cookie = generatePayloadCookie({
    collectionAuthConfig: collection.config.auth,
    cookiePrefix: req.payload.config.cookiePrefix,
    token: result.token,
  });
  if (collection.config.auth.removeTokenFromResponses) delete result.token;

  return Response.json(
    {
      message: req.t("authentication:passed"),
      ...result,
    },
    {
      headers: headersWithCors({
        headers: new Headers({ "Set-Cookie": cookie }),
        req,
      }),
    },
  );
};
