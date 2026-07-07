import { createApp } from "./app.ts";
import { makeSarathiRuntime } from "./platform/runtime.ts";

const runtime = makeSarathiRuntime();
const app = createApp(runtime);
const server = Bun.serve({
  port: runtime.config.http.port,
  fetch: app.fetch,
});

const keepAlive = setInterval(() => undefined, 60_000);
const stopServer = (): never => {
  clearInterval(keepAlive);
  server.stop(true);
  process.exit(0);
};

process.on("SIGINT", stopServer);
process.on("SIGTERM", stopServer);

console.info(`Sarathi API listening on ${server.url.toString()}`);
