import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createProductModelCommandService,
  ProductCommandPersistenceError,
  type ProductModelCommand,
  type ProductModelCommandAuthorizationDecision,
  type ProductModelCommandAuthorizer,
  type ProductModelCommandRepository,
  type ProductModelRequestContext,
} from "../src/modules/product-model/index.ts";
import { createInMemoryProductModelCommandRepository } from "../src/modules/product-model/infrastructure/memory-product-model-command-repository.ts";
import { createInMemoryProductPreviewTokenCodec } from "../src/modules/product-model/infrastructure/memory-product-preview-token-codec.ts";
import {
  createBaseProductModelFixture,
  productEntityId,
  productFixtureIds,
} from "./fixtures/product-model-fixture.ts";

const requestContext: ProductModelRequestContext = {
  organizationId: "synthetic-organization",
  workspaceId: "synthetic-workspace",
  actorId: "synthetic-product-owner",
  trustTier: "trusted",
  effectiveAudience: ["workspace-members"],
  maximumSensitivity: "internal",
  modelEgress: "redact",
  permittedCorpusScopes: ["product-model"],
  requestId: "synthetic-request-0001",
  surface: "product-studio",
};

const allAccess: ProductModelCommandAuthorizationDecision = {
  allowed: true,
  reason: "Synthetic product owner is authorized.",
  policyVersion: "synthetic-policy-v1",
  entityScope: { kind: "all" },
  allowHiddenImpacts: false,
};

const authorizer = (
  decision: ProductModelCommandAuthorizationDecision = allAccess,
  events?: string[],
): ProductModelCommandAuthorizer => ({
  authorize: (_context, request) => {
    events?.push(`authorize:${request.operation}`);
    return Effect.succeed(decision);
  },
});

let generatedId = 100;
const dependencies = () => ({
  now: () => "2026-02-01T00:00:00.000Z",
  newId: () => `90000000-0000-4000-8000-${String(generatedId++).padStart(12, "0")}`,
  previewTokens: createInMemoryProductPreviewTokenCodec(),
});

type RenameCommand = Extract<ProductModelCommand, { readonly type: "RenameEntity" }>;

const renameCommand = (overrides?: Partial<RenameCommand>): RenameCommand => ({
  type: "RenameEntity",
  workspaceId: "synthetic-workspace",
  targetId: productEntityId(productFixtureIds.feature),
  expectedRevision: 5,
  idempotencyKey: "synthetic-command-rename-0001",
  justification: "The product owner approved the canonical name.",
  validFrom: "2026-02-01T00:00:00.000Z",
  payload: {
    canonicalName: "Scheduled Releases",
    canonicalAliasId: "alias-command-rename",
  },
  ...overrides,
});

describe("product model commands", () => {
  it("denies before any repository access", async () => {
    const events: string[] = [];
    const denied: ProductModelCommandAuthorizationDecision = {
      ...allAccess,
      allowed: false,
      reason: "Synthetic denial.",
    };
    const repository: ProductModelCommandRepository = {
      replay: () => {
        events.push("repository:replay");
        return Effect.succeed(undefined);
      },
      current: () => {
        events.push("repository:current");
        return Effect.succeed(undefined);
      },
      commit: () => {
        events.push("repository:commit");
        return Effect.die("commit must not run");
      },
    };
    const service = createProductModelCommandService(
      authorizer(denied, events),
      repository,
      dependencies(),
    );

    const result = await Effect.runPromise(
      Effect.either(service.preview(requestContext, renameCommand())),
    );

    expect(result._tag).toBe("Left");
    expect(result._tag === "Left" ? result.left._tag : "unexpected-success").toBe(
      "ProductModelCommandAccessDenied",
    );
    expect(events).toEqual(["authorize:preview-change"]);
  });

  it("previews without writes and filters entity IDs outside the authorized scope", async () => {
    const model = await createBaseProductModelFixture();
    const repository = createInMemoryProductModelCommandRepository({ initialModels: [model] });
    const survivorId = productEntityId(productFixtureIds.capabilityA);
    const sourceId = productEntityId(productFixtureIds.capabilityB);
    const service = createProductModelCommandService(
      authorizer({
        ...allAccess,
        entityScope: { kind: "entities", entityIds: [survivorId] },
      }),
      repository,
      dependencies(),
    );
    const command: ProductModelCommand = {
      type: "MergeEntities",
      workspaceId: model.workspaceId,
      targetId: survivorId,
      payload: { sourceIds: [sourceId] },
      expectedRevision: model.revision,
      idempotencyKey: "synthetic-command-merge-0001",
      justification: "The product owner approved the identity consolidation.",
      validFrom: "2026-02-01T00:00:00.000Z",
    };

    const preview = await Effect.runPromise(service.preview(requestContext, command));

    expect(preview.status).toBe("previewed");
    expect(preview.resultingRevision).toBe(6);
    expect(preview.previewToken).toMatch(/^sha256-/);
    expect(preview.impact.changedEntityIds).not.toContain(sourceId);
    expect(preview.impact.hiddenEntityImpactCount).toBeGreaterThan(0);
    expect(repository.history(model.workspaceId)).toHaveLength(1);
    expect(repository.audits(model.workspaceId)).toEqual([]);
    expect(repository.outbox(model.workspaceId)).toEqual([]);
  });

  it("commits model, revision, audit, identity event, and outbox once across retries", async () => {
    const model = await createBaseProductModelFixture();
    const repository = createInMemoryProductModelCommandRepository({ initialModels: [model] });
    const service = createProductModelCommandService(authorizer(), repository, dependencies());
    const preview = await Effect.runPromise(service.preview(requestContext, renameCommand()));
    const command = renameCommand({ previewToken: preview.previewToken });

    const first = await Effect.runPromise(service.execute(requestContext, command));
    const retry = await Effect.runPromise(service.execute(requestContext, command));

    expect(first).toMatchObject({ status: "committed", revision: 6, replayed: false });
    expect(retry).toMatchObject({ status: "committed", revision: 6, replayed: true });
    expect(retry.eventId).toBe(first.eventId);
    expect(repository.history(model.workspaceId)).toHaveLength(2);
    expect(repository.history(model.workspaceId).at(-1)?.identityEvents.at(-1)?.type).toBe(
      "renamed",
    );
    expect(repository.audits(model.workspaceId)).toHaveLength(1);
    expect(repository.outbox(model.workspaceId)).toHaveLength(1);
    expect(repository.outbox(model.workspaceId)[0]?.revision).toBe(6);
  });

  it("rejects stale revisions and conflicting reuse of an idempotency key", async () => {
    const model = await createBaseProductModelFixture();
    const repository = createInMemoryProductModelCommandRepository({ initialModels: [model] });
    const service = createProductModelCommandService(authorizer(), repository, dependencies());

    const stale = await Effect.runPromise(
      Effect.either(service.execute(requestContext, renameCommand({ expectedRevision: 4 }))),
    );
    expect(stale._tag === "Left" ? stale.left : undefined).toMatchObject({
      code: "stale_revision",
    });

    await Effect.runPromise(service.execute(requestContext, renameCommand()));
    const conflict = await Effect.runPromise(
      Effect.either(
        service.execute(
          requestContext,
          renameCommand({
            payload: {
              canonicalName: "Release Planner",
              canonicalAliasId: "alias-command-conflict",
            },
          }),
        ),
      ),
    );
    expect(conflict._tag === "Left" ? conflict.left : undefined).toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("rolls back every staged effect when the atomic commit hook fails", async () => {
    const model = await createBaseProductModelFixture();
    const repository = createInMemoryProductModelCommandRepository({
      initialModels: [model],
      beforeCommit: () =>
        Effect.fail(
          new ProductCommandPersistenceError(
            "transaction_failed",
            "Synthetic transaction failure.",
          ),
        ),
    });
    const service = createProductModelCommandService(authorizer(), repository, dependencies());

    const result = await Effect.runPromise(
      Effect.either(service.execute(requestContext, renameCommand())),
    );

    expect(result._tag === "Left" ? result.left : undefined).toMatchObject({
      code: "transaction_failed",
    });
    expect(repository.history(model.workspaceId)).toHaveLength(1);
    expect(repository.audits(model.workspaceId)).toEqual([]);
    expect(repository.outbox(model.workspaceId)).toEqual([]);
  });
});
