import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgePostgresDatabase } from "../src/infrastructure/postgres/knowledge-migrations.ts";
import {
  buildProductCoverageQuery,
  buildProductDossierQuery,
  createPostgresProductModelDetailRepository,
} from "../src/infrastructure/postgres/product-model-detail-repository.ts";
import { parseProductEntityId } from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000003"));
const at = "2026-01-02T00:00:00.000Z";
const visibility = {
  audienceIds: ["workspace:synthetic"],
  maximumSensitivity: "internal" as const,
};

describe("PostgreSQL product-model detail repository", () => {
  it("builds a visibility-filtered metadata-only dossier without proposal or evidence bodies", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductDossierQuery({ workspaceId, entityId, at, visibility }),
    );

    expect(compiled.sql).toContain("from product_entity entity");
    expect(compiled.sql).toContain("from product_claim claim");
    expect(compiled.sql).toContain("from product_external_reference reference");
    expect(compiled.sql).toContain("from product_change_proposal proposal");
    expect(compiled.sql).toContain("jsonb_strip_nulls(jsonb_build_object(");
    expect(compiled.sql.match(/\.audience \?\| array\[/g)?.length).toBe(6);
    expect(compiled.sql).toContain("jsonb_array_length(claim.evidence_reference_ids)");
    expect(compiled.sql).not.toContain("proposal.payload");
    expect(compiled.sql).not.toContain("proposal.evidence_reference_ids");
    expect(compiled.params).toContain(workspaceId);
    expect(compiled.params).toContain(entityId);
    expect(compiled.params).toContain(at);
  });

  it("builds coverage from only visible claims, references, variants, and entity state", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductCoverageQuery({
        workspaceId,
        at,
        staleBefore: "2025-12-01T00:00:00.000Z",
        maximumItems: 25,
        visibility,
      }),
    );

    expect(compiled.sql).toContain("'weakly_evidenced'");
    expect(compiled.sql).toContain("'variant_ambiguous'");
    expect(compiled.sql).toContain("claim.audience ?| array[");
    expect(compiled.sql).toContain("reference.audience ?| array[");
    expect(compiled.sql).toContain(
      "reference.reference_kind in ('delivery', 'technical', 'runtime')",
    );
    expect(compiled.sql).toContain("variant.audience ?| array[");
    expect(compiled.sql).toContain("left_variant.audience ?| array[");
    expect(compiled.sql).toContain("right_variant.audience ?| array[");
    expect(compiled.sql).toContain("limit $");
    expect(compiled.params).toContain(26);
  });

  it("maps dossier metadata and signals bounded coverage truncation", async () => {
    const dossierRow = {
      entity: {
        id: entityId,
        workspaceId,
        kind: "feature",
        canonicalName: "Synthetic Feature",
        registration: "ratified",
        lifecycle: "available",
        sensitivity: "internal",
        audience: ["workspace:synthetic"],
        createdRevision: 1,
        updatedRevision: 4,
      },
      aliases: [],
      variants: [],
      claims: [],
      externalReferences: [],
      proposals: [],
    };
    const coverageRows = [
      {
        entityId,
        canonicalName: "Synthetic Feature",
        kind: "feature",
        flags: ["stale"],
        claimCount: 0,
        referenceCount: 0,
        variantCount: 0,
        updatedRevision: 4,
      },
      {
        entityId: "00000000-0000-4000-8000-000000000004",
        canonicalName: "Synthetic Overflow",
        kind: "feature",
        flags: ["unmapped"],
        claimCount: 1,
        referenceCount: 0,
        variantCount: 0,
        updatedRevision: 4,
      },
    ];
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [dossierRow] })
      .mockResolvedValueOnce({ rows: coverageRows });
    const repository = createPostgresProductModelDetailRepository({
      execute,
    } as unknown as KnowledgePostgresDatabase);

    const dossier = await Effect.runPromise(
      repository.readDossier({ workspaceId, entityId, at, visibility }),
    );
    const coverage = await Effect.runPromise(
      repository.readCoverage({
        workspaceId,
        at,
        staleBefore: "2025-12-01T00:00:00.000Z",
        maximumItems: 1,
        visibility,
      }),
    );

    expect(dossier).toEqual(dossierRow);
    expect(coverage).toEqual({ items: [coverageRows[0]], truncated: true });
  });

  it("rejects invalid bounds and instants before database access", async () => {
    const execute = vi.fn();
    const repository = createPostgresProductModelDetailRepository({
      execute,
    } as unknown as KnowledgePostgresDatabase);

    const dossier = await Effect.runPromise(
      Effect.either(repository.readDossier({ workspaceId, entityId, at: "invalid", visibility })),
    );
    const coverage = await Effect.runPromise(
      Effect.either(
        repository.readCoverage({
          workspaceId,
          at,
          staleBefore: "invalid",
          maximumItems: 501,
          visibility,
        }),
      ),
    );

    expect(dossier._tag).toBe("Left");
    expect(coverage._tag).toBe("Left");
    expect(execute).not.toHaveBeenCalled();
  });
});
