import { Hono } from "hono";
import { registerProductModelRoutes } from "./modules/product-model/index.ts";
import { registerWorkspaceModelRoutes } from "./modules/workspace-model/index.ts";
import { registerPlatformRoutes } from "./platform/routes.ts";
import type { SarathiRuntime } from "./platform/runtime.ts";
import { makeSarathiRuntime } from "./platform/runtime.ts";

export const createApp = (runtime: SarathiRuntime = makeSarathiRuntime()): Hono => {
  const app = new Hono();

  registerPlatformRoutes(app, runtime);
  registerWorkspaceModelRoutes(app, runtime);
  registerProductModelRoutes(app, runtime.productModelApi);

  return app;
};
