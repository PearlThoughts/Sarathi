import type { Server } from "node:http";
import express from "express";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createHostedPlatformApiMiddleware } from "../src/teams-ingress/hosted-platform-api.ts";

const listeningUrl = (server: Server): string => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP listener.");
  return `http://127.0.0.1:${address.port}`;
};

describe("hosted platform API middleware", () => {
  let server: Server | undefined;

  afterEach(
    () =>
      new Promise<void>((resolve, reject) => {
        if (server === undefined) {
          resolve();
          return;
        }
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  );

  it("serves the full versioned Hono path before Express consumes the request body", async () => {
    const platform = new Hono();
    platform.post("/v1/echo", async (context) =>
      context.json({ path: context.req.path, body: await context.req.json() }),
    );
    const hosted = express();
    hosted.use(createHostedPlatformApiMiddleware(platform.fetch));
    hosted.use(express.json());
    hosted.post("/api/messages", (_request, response) => response.json({ surface: "teams" }));
    server = hosted.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server?.once("listening", resolve));

    const response = await fetch(`${listeningUrl(server)}/v1/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ governed: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: "/v1/echo",
      body: { governed: true },
    });
  });

  it("passes non-versioned requests to the existing Express routes", async () => {
    const platform = new Hono();
    const hosted = express();
    hosted.use(createHostedPlatformApiMiddleware(platform.fetch));
    hosted.use(express.json());
    hosted.post("/api/messages", (_request, response) => response.json({ surface: "teams" }));
    server = hosted.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server?.once("listening", resolve));

    const response = await fetch(`${listeningUrl(server)}/api/messages`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ surface: "teams" });
  });
});
