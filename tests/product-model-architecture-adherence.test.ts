import { access, readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const moduleRoot = new URL("../src/modules/product-model/", import.meta.url);
const deliveryRoot = new URL("../src/modules/delivery-intelligence/", import.meta.url);
const postgresRoot = new URL("../src/infrastructure/postgres/", import.meta.url);
const testsRoot = new URL("./", import.meta.url);

const sourceFiles = async (relativeDirectory: string) =>
  (await readdir(new URL(`${relativeDirectory}/`, moduleRoot)))
    .filter((name) => name.endsWith(".ts"))
    .sort();

const sourceText = (relativePath: string) => readFile(new URL(relativePath, moduleRoot), "utf8");

describe("product-model architecture adherence", () => {
  it("keeps the bounded context in domain, application, and port layers", async () => {
    await Promise.all(
      ["domain", "application", "ports", "api"].map((directory) =>
        access(new URL(`${directory}/`, moduleRoot)),
      ),
    );

    expect(await sourceFiles("domain")).toEqual(
      expect.arrayContaining(["product-model.ts", "product-identity-evolution.ts"]),
    );
    expect(await sourceFiles("application")).toEqual(
      expect.arrayContaining([
        "product-model-commands.ts",
        "product-model-detail-queries.ts",
        "product-model-queries.ts",
      ]),
    );
    expect(await sourceFiles("ports")).toEqual(
      expect.arrayContaining([
        "product-model-command-authorizer.ts",
        "product-model-command-repository.ts",
        "product-model-query-authorizer.ts",
      ]),
    );
    expect(await sourceFiles("api")).toContain("register-product-model-routes.ts");
  });

  it("keeps Drizzle, PostgreSQL, and infrastructure imports out of the core", async () => {
    for (const directory of ["domain", "application", "ports"]) {
      for (const file of await sourceFiles(directory)) {
        const source = await sourceText(`${directory}/${file}`);
        expect(source, `${directory}/${file}`).not.toMatch(
          /from\s+["'][^"']*(?:drizzle-orm|node-postgres|\/infrastructure\/)[^"']*["']/,
        );
      }
    }
  });

  it("keeps infrastructure adapters out of the product-model public barrel", async () => {
    const source = await sourceText("index.ts");

    expect(source).not.toMatch(/infrastructure/);
    expect(source).toContain('export * from "./domain/product-model.ts"');
    expect(source).toContain('export * from "./application/product-model-commands.ts"');
    expect(source).toContain('export * from "./ports/product-model-command-repository.ts"');
    expect(source).toContain('export * from "./api/register-product-model-routes.ts"');
  });

  it("keeps delivery compatibility in the application layer and delegates the existing report path", async () => {
    const projection = await readFile(
      new URL("application/project-product-capability-ledger.ts", deliveryRoot),
      "utf8",
    );
    const periodReport = await readFile(
      new URL("domain/period-delivery-report.ts", deliveryRoot),
      "utf8",
    );

    expect(projection).toContain('from "../../product-model/index.ts"');
    expect(projection).not.toMatch(
      /from\s+["']\.\.\/\.\.\/product-model\/(?:domain|application|ports)\//,
    );
    expect(projection).toContain("createDeliveryAssistant({ ...configuration, capabilityLedger })");
    expect(projection).not.toContain("buildPeriodDeliveryReport");
    expect(periodReport.match(/export const buildPeriodDeliveryReport\s*=/g)).toHaveLength(1);
  });

  it("uses typed Drizzle DML across product-model PostgreSQL adapters", async () => {
    const files = (await readdir(postgresRoot))
      .filter((name) => name.startsWith("product-model-") && name.endsWith(".ts"))
      .sort();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(new URL(file, postgresRoot), "utf8");
      const rawSqlBodies = [...source.matchAll(/sql(?:<[^>]+>)?`([\s\S]*?)`/g)].map(
        (match) => match[1] ?? "",
      );
      if (rawSqlBodies.some((body) => /\b(?:insert\s+into|update|delete\s+from)\b/i.test(body)))
        violations.push(file);
    }

    expect(violations).toEqual([]);
    const commandAdapter = await readFile(
      new URL("product-model-command-repository.ts", postgresRoot),
      "utf8",
    );
    expect(commandAdapter).toContain("database.transaction(async");
    expect(commandAdapter).toMatch(/\.insert\(product[A-Za-z]+Table\)/);
    expect(commandAdapter).toMatch(/\.update\(product[A-Za-z]+Table\)/);
  });

  it("registers every permanent product-model Vitest suite in the test manifest", async () => {
    const testFiles = (await readdir(testsRoot))
      .filter((name) => name.startsWith("product-model-") && name.endsWith(".test.ts"))
      .sort();
    const manifest = JSON.parse(await readFile(new URL("manifest.json", testsRoot), "utf8")) as {
      readonly suites: readonly { readonly path: string }[];
    };
    const registered = new Set(manifest.suites.map(({ path }) => path));

    expect(testFiles.filter((name) => !registered.has(`tests/${name}`))).toEqual([]);
  });
});
