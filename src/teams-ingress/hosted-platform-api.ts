import { getRequestListener } from "@hono/node-server";
import type { RequestHandler } from "express";

type PlatformFetch = Parameters<typeof getRequestListener>[0];

const unavailable = (): Response =>
  Response.json(
    { error: { code: "PLATFORM_API_UNAVAILABLE", message: "Platform API is unavailable." } },
    { status: 503 },
  );

export const createHostedPlatformApiMiddleware = (fetch: PlatformFetch): RequestHandler => {
  const listener = getRequestListener(fetch, {
    overrideGlobalObjects: false,
    errorHandler: unavailable,
  });
  return (request, response, next) => {
    if (!request.path.startsWith("/v1/")) {
      next();
      return;
    }
    void listener(request, response).catch(() => {
      if (!response.headersSent) {
        response.status(503).json({
          error: { code: "PLATFORM_API_UNAVAILABLE", message: "Platform API is unavailable." },
        });
        return;
      }
      response.destroy();
    });
  };
};
