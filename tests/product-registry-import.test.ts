import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProductRegistryImport } from "../src/cli/commands/product-registry-import.ts";
import {
  parseProductRegistryProposalBatch,
  parseProductRegistryRelationMap,
  planProductRegistryImport,
  productRegistryEntityId,
} from "../src/modules/product-model/application/product-registry-import.ts";

const observedAt = "2026-08-10T10:00:00.000Z";

const proposal = (
  index: number,
  proposalKind: "entity" | "relation" | "variant" | "invariant",
  candidateKey: string,
  payload: Readonly<Record<string, unknown>>,
) => ({
  proposalId: `sha256-${index.toString(16).padStart(64, "0")}`,
  workspaceKey: "demo",
  proposalKind,
  candidateKey,
  status: "proposal",
  registration: "candidate",
  requiresHumanRatification: true,
  contested: false,
  candidatePayloads: [payload],
  sources: [
    {
      authorization: "explicit",
      sourceClass: "private-seed",
      sourceFingerprint: `sha256-${(index + 10).toString(16).padStart(64, "0")}`,
      audience: "demo-review",
      sensitivity: "internal",
      observedAt,
      evidenceReference: `seed:${proposalKind}:${candidateKey}`,
    },
  ],
});

const entityPayload = (
  key: string,
  kind: "product" | "area" | "capability" | "feature",
  name: string,
  parent?: string,
) => ({
  key,
  kind,
  name,
  ...(parent === undefined ? {} : { parent }),
  aliases: [`${name} alias`],
  definition: `${name} definition.`,
  exclusions: [`${name} technical realization.`],
  registration: "candidate",
  audience: "demo-review",
  sensitivity: "internal",
  observedAt,
});

const batchValue = {
  version: 1,
  mode: "proposals-only",
  workspaceKey: "demo",
  proposals: [
    proposal(1, "entity", "demo-product", entityPayload("demo-product", "product", "Demo")),
    proposal(
      2,
      "entity",
      "demo-area",
      entityPayload("demo-area", "area", "Demo Area", "demo-product"),
    ),
    proposal(3, "relation", "demo-enables-area", {
      key: "demo-enables-area",
      type: "supplies",
      source: "demo-product",
      target: "demo-area",
      definition: "The product supplies the area.",
      registration: "candidate",
      audience: "demo-review",
      sensitivity: "internal",
      observedAt,
    }),
    proposal(4, "variant", "demo-variant", {
      key: "demo-variant",
      target: "demo-area",
      axes: ["environment"],
      definition: "A qualifier template, not a concrete variant.",
      registration: "candidate",
      audience: "demo-review",
      sensitivity: "internal",
      observedAt,
    }),
  ],
};

const relationMapValue = {
  version: 1,
  relationTypes: { supplies: { type: "enables", direction: "forward" } },
};

const emptyCurrent = {
  revision: 0,
  entities: [],
  relations: [],
  aliasesByEntityId: {},
} as const;

const makePlan = () =>
  planProductRegistryImport({
    batch: parseProductRegistryProposalBatch(batchValue),
    relationMap: parseProductRegistryRelationMap(relationMapValue),
    current: emptyCurrent,
    targetWorkspaceId: "demo-local",
    validFrom: observedAt,
    justification: "Product-owner-approved foundational model.",
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product registry proposal importer", () => {
  it("builds a stable topological governed-command plan with explicit dispositions", () => {
    const first = makePlan();
    const repeated = makePlan();

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      expectedRevision: 0,
      resultingRevision: 5,
      impact: {
        proposalCount: 4,
        commandCount: 5,
        plannedChangedEntityCount: 2,
        visibleEntityImpactCount: null,
        hiddenEntityImpactCount: null,
        deferredProposalCount: 1,
      },
    });
    expect(first.commands.map(({ command }) => command.type)).toEqual([
      "ProposeEntity",
      "RatifyEntity",
      "ProposeEntity",
      "RatifyEntity",
      "AddRelation",
    ]);
    expect(first.commands.map(({ command }) => command.expectedRevision)).toEqual([0, 1, 2, 3, 4]);
    expect(first.commands[0]?.command.justification).toContain("sourceFingerprint");
    expect(first.commands[0]?.command.justification).toContain("evidenceReference");
    expect(first.dispositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateKey: "demo-product", status: "will-import" }),
        expect.objectContaining({ candidateKey: "demo-area", status: "will-import" }),
        expect.objectContaining({ candidateKey: "demo-enables-area", status: "will-import" }),
        expect.objectContaining({
          candidateKey: "demo-variant",
          status: "deferred",
          reason: "unsupported-governed-command",
        }),
      ]),
    );
  });

  it("resumes from matching state and ratifies an existing candidate without recreating it", () => {
    const productId = productRegistryEntityId("demo", "demo-product");
    const areaId = productRegistryEntityId("demo", "demo-area");
    const plan = planProductRegistryImport({
      batch: parseProductRegistryProposalBatch(batchValue),
      relationMap: parseProductRegistryRelationMap(relationMapValue),
      current: {
        revision: 3,
        entities: [
          {
            entityId: productId,
            kind: "product",
            canonicalName: "Demo",
            description: "Demo definition.\n\nExcludes: Demo technical realization.",
            registration: "ratified",
            lifecycle: "unknown",
            sensitivity: "internal",
            audience: ["demo-review"],
            revision: 2,
            depth: 0,
          },
          {
            entityId: areaId,
            parentId: productId,
            kind: "area",
            canonicalName: "Demo Area",
            description: "Demo Area definition.\n\nExcludes: Demo Area technical realization.",
            registration: "candidate",
            lifecycle: "unknown",
            sensitivity: "internal",
            audience: ["demo-review"],
            revision: 3,
            depth: 1,
          },
        ],
        relations: [],
        aliasesByEntityId: {
          [productId]: ["Demo", "Demo alias"],
          [areaId]: ["Demo Area", "Demo Area alias"],
        },
      },
      targetWorkspaceId: "demo-local",
      validFrom: observedAt,
      justification: "Resume an approved foundational import.",
    });

    expect(plan.commands.map(({ command }) => command.type)).toEqual([
      "RatifyEntity",
      "AddRelation",
    ]);
    expect(plan.commands.map(({ command }) => command.expectedRevision)).toEqual([3, 4]);
    expect(plan.dispositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateKey: "demo-product", status: "already-current" }),
        expect.objectContaining({
          candidateKey: "demo-area",
          reason: "ratify-existing-candidate",
        }),
      ]),
    );
  });

  it("requires the exact preview fingerprint and uses a fresh server preview token per command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-registry-import-"));
    const batchPath = join(directory, "batch.json");
    const relationMapPath = join(directory, "relations.json");
    await Promise.all([
      writeFile(batchPath, JSON.stringify(batchValue), "utf8"),
      writeFile(relationMapPath, JSON.stringify(relationMapValue), "utf8"),
    ]);
    let committedRevision = 0;
    const requests: { readonly url: string; readonly body?: Readonly<Record<string, unknown>> }[] =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Readonly<Record<string, unknown>>)
            : undefined;
        requests.push({ url, ...(body === undefined ? {} : { body }) });
        if (url.includes("/map?"))
          return new Response(JSON.stringify({ error: { code: "PRODUCT_MODEL_NOT_FOUND" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/entities/")) return Response.json({ data: { aliases: [] } });
        if (url.endsWith("/changes/preview"))
          return Response.json({
            data: {
              status: "previewed",
              workspaceId: "demo-local",
              expectedRevision: body?.expectedRevision,
              resultingRevision: Number(body?.expectedRevision) + 1,
              commandHash: "sha256-preview",
              previewToken: `preview-${body?.expectedRevision}`,
              expiresAt: "2026-08-10T10:05:00.000Z",
              policyVersion: "test-v1",
              impact: {
                changedEntityIds: body?.targetId === undefined ? [] : [body.targetId],
                hiddenEntityImpactCount: 0,
                changedCollections: { entities: 1 },
              },
              invariantResults: [{ status: "passed", name: "product-model-domain-invariants" }],
            },
          });
        committedRevision += 1;
        return Response.json({
          data: {
            status: "committed",
            workspaceId: "demo-local",
            revision: committedRevision,
            commandHash: "sha256-command",
            auditId: `audit-${committedRevision}`,
            outboxEventId: `outbox-${committedRevision}`,
            projectionState: "pending",
          },
        });
      }),
    );
    const args = [
      "preview",
      "--file",
      batchPath,
      "--relation-map",
      relationMapPath,
      "--workspace",
      "demo-local",
      "--valid-from",
      observedAt,
      "--justification",
      "Product-owner-approved foundational model.",
    ];
    const environment = {
      SARATHI_API_BASE_URL: "http://127.0.0.1:3011",
      SARATHI_PRODUCT_MODEL_ACCESS_TOKEN: "test-product-owner-token",
    };
    try {
      const preview = (await runProductRegistryImport(args, environment)) as {
        readonly plan: { readonly planFingerprint: string };
      };
      expect(requests[0]?.url).toContain("maximumRelations=500");
      await expect(
        runProductRegistryImport(
          ["apply", ...args.slice(1), "--approval-fingerprint", "sha256-wrong"],
          environment,
        ),
      ).rejects.toThrow("Approval fingerprint does not match");
      const applied = (await runProductRegistryImport(
        ["apply", ...args.slice(1), "--approval-fingerprint", preview.plan.planFingerprint],
        environment,
      )) as { readonly committedCommandCount: number };

      expect(applied.committedCommandCount).toBe(5);
      const executeBodies = requests
        .filter(({ url }) => url.endsWith("/commands"))
        .map(({ body }) => body);
      expect(executeBodies).toHaveLength(5);
      expect(executeBodies.every((body) => typeof body?.previewToken === "string")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
