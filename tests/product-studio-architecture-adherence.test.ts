import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const studioRoot = new URL("../product-studio/", import.meta.url);
const sourceRoot = new URL("src/", studioRoot);

const collectSourceFiles = async (directory: URL): Promise<URL[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) return collectSourceFiles(url);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [url] : [];
    }),
  );
  return files.flat();
};

describe("Product Studio architecture adherence", () => {
  it("keeps Payload persistence independent and migration-controlled", async () => {
    const config = await readFile(new URL("src/payload.config.ts", studioRoot), "utf8");
    const readme = await readFile(new URL("README.md", studioRoot), "utf8");

    expect(config).toContain('"PRODUCT_STUDIO_DATABASE_URL"');
    expect(config).toContain('schemaName: "product_studio"');
    expect(config).toContain("push: false");
    expect(config).toContain("migrationDir:");
    expect(config).toContain("prodMigrations: migrations");
    expect(config).not.toContain("SARATHI_STRATEGY_DATABASE_URL");
    expect(readme).toContain("must have no privileges on Sarathi product-model");
  });

  it("confines framework-generated raw migration SQL to the Product Studio schema", async () => {
    const migrationRoot = new URL("src/migrations/", studioRoot);
    const migrationNames = (await readdir(migrationRoot))
      .filter((name) => /^\d+_.+\.ts$/.test(name))
      .sort();

    expect(migrationNames.length).toBeGreaterThan(0);
    for (const name of migrationNames) {
      const migration = await readFile(new URL(name, migrationRoot), "utf8");
      expect(migration).toContain('"product_studio".');
      expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "product_studio"');
      expect(migration.indexOf('CREATE SCHEMA IF NOT EXISTS "product_studio"')).toBeLessThan(
        migration.indexOf('CREATE TABLE "product_studio".'),
      );
      expect(migration).not.toContain('"public".');
      expect(migration).not.toMatch(
        /product_(?:entity|hierarchy|relation|revision|audit|identity_event|outbox)/,
      );
    }

    const migrationIndex = await readFile(new URL("index.ts", migrationRoot), "utf8");
    for (const name of migrationNames) expect(migrationIndex).toContain(name.replace(/\.ts$/, ""));
  });

  it("uses only Sarathi's versioned read API and never imports domain storage", async () => {
    const files = await collectSourceFiles(sourceRoot);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (
        /(?:drizzle-orm|node-postgres|product-model-command-repository|src\/modules\/product-model|product_entity|product_revision)/.test(
          source,
        )
      )
        violations.push(file.pathname);
    }

    expect(violations).toEqual([]);
    const adapter = await readFile(
      new URL("src/server/sarathi-product-model-client.ts", studioRoot),
      "utf8",
    );
    expect(adapter).toContain("/v1/workspaces/");
    expect(adapter).toContain('method: "GET"');
    expect(adapter).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\b/);
    expect(adapter).not.toMatch(/sql`|\.insert\(|\.update\(|\.delete\(/);
  });

  it("separates user-bound mutation authority from the shared read token", async () => {
    const mutationAdapter = await readFile(
      new URL("src/server/sarathi-product-model-mutation-client.ts", studioRoot),
      "utf8",
    );
    const credentialProvider = await readFile(
      new URL("src/server/user-bound-sarathi-credentials.ts", studioRoot),
      "utf8",
    );

    expect(mutationAdapter).toContain('method: "POST"');
    expect(mutationAdapter).toContain('"changes/preview"');
    expect(mutationAdapter).toContain('"commands"');
    expect(mutationAdapter).not.toContain("SARATHI_PRODUCT_STUDIO_READ_TOKEN");
    expect(mutationAdapter).not.toMatch(/sql`|\.insert\(|\.update\(|\.delete\(/);
    expect(credentialProvider).toContain("SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON");
    expect(credentialProvider).toContain("expiresAt");
    expect(credentialProvider).not.toContain("SARATHI_PRODUCT_STUDIO_READ_TOKEN");
  });

  it("reauthenticates every mutation request and preserves preview and stale recovery", async () => {
    const route = await readFile(
      new URL("src/app/studio-api/product-model-change/route.ts", studioRoot),
      "utf8",
    );
    const handler = await readFile(
      new URL("src/server/product-model-change-handler.ts", studioRoot),
      "utf8",
    );
    const form = await readFile(new URL("src/views/RenameEntityForm.tsx", studioRoot), "utf8");

    expect(route).toContain("payload.auth({ headers: request.headers })");
    expect(route).toContain("createUserBoundSarathiCredentialProvider()");
    expect(route).not.toContain("SARATHI_PRODUCT_STUDIO_READ_TOKEN");
    expect(handler.indexOf("dependencies.authenticate(request)")).toBeLessThan(
      handler.indexOf("dependencies.credentials.resolve(user.id)"),
    );
    expect(handler.indexOf("dependencies.credentials.resolve(user.id)")).toBeLessThan(
      handler.indexOf("dependencies.clientFor(credential)"),
    );
    expect(form).toContain("Preview Rename");
    expect(form).toContain("Confirm Rename");
    expect(form).toContain("hiddenEntityImpactCount > 0");
    expect(form).toContain('state.code === "stale_revision"');
    expect(form).toContain("deliberately reapply or discard");
  });

  it("provides a semantic non-graph reading path and runs in the root check", async () => {
    const view = await readFile(new URL("src/views/ProductMapView.tsx", studioRoot), "utf8");
    const explorer = await readFile(
      new URL("src/views/ProductCapabilityExplorer.tsx", studioRoot),
      "utf8",
    );
    const adapter = await readFile(
      new URL("src/server/sarathi-product-model-client.ts", studioRoot),
      "utf8",
    );
    const rootPackage = await readFile(new URL("../package.json", studioRoot), "utf8");
    const testManifest = await readFile(new URL("../tests/manifest.json", studioRoot), "utf8");

    expect(view).toContain("<ProductCapabilityExplorer");
    expect(explorer).toContain("Text navigator");
    expect(explorer).toContain('data-testid="capability-text-node"');
    expect(explorer).toContain("Keyboard-accessible nodes in the current graph.");
    expect(explorer).toContain('aria-label="Interactive 3D product capability graph"');
    expect(adapter).toContain("coverage?maximumItems=");
    expect(explorer).not.toContain("<canvas");
    expect(rootPackage).toContain('"check:product-studio"');
    expect(rootPackage).toMatch(/"ci"[^\n]+check:product-studio/);
    expect(testManifest).toContain('"path": "tests/product-studio-architecture-adherence.test.ts"');
  });
});
