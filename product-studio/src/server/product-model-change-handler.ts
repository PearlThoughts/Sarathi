import { z } from "zod";
import {
  type createSarathiProductModelMutationClient,
  type ProductStudioRenameCommand,
  SarathiProductModelMutationError,
} from "./sarathi-product-model-mutation-client";
import {
  type UserBoundSarathiCredential,
  type UserBoundSarathiCredentialProvider,
  UserBoundSarathiCredentialUnavailable,
} from "./user-bound-sarathi-credentials";

type MutationClient = ReturnType<typeof createSarathiProductModelMutationClient>;

type ProductModelChangeHandlerDependencies = {
  readonly authenticate: (request: Request) => Promise<{ readonly id: string } | undefined>;
  readonly credentials: UserBoundSarathiCredentialProvider;
  readonly clientFor: (credential: UserBoundSarathiCredential) => MutationClient;
  readonly workspaceId: string;
  readonly now: () => string;
  readonly newId: () => string;
};

const previewRequestSchema = z
  .object({
    action: z.literal("preview-rename"),
    entityId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    canonicalName: z.string().trim().min(1).max(240),
    justification: z.string().trim().min(8).max(4_000),
  })
  .strict();

const renameCommandSchema = z
  .object({
    type: z.literal("RenameEntity"),
    workspaceId: z.string().min(1),
    targetId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(8).max(200),
    justification: z.string().trim().min(8).max(4_000),
    validFrom: z.iso.datetime(),
    previewToken: z.string().min(1).max(4_000),
    payload: z
      .object({
        canonicalName: z.string().trim().min(1).max(240),
        canonicalAliasId: z.string().trim().min(1).max(240),
      })
      .strict(),
  })
  .strict();

const executeRequestSchema = z
  .object({ action: z.literal("execute-rename"), command: renameCommandSchema })
  .strict();

const requestSchema = z.discriminatedUnion("action", [previewRequestSchema, executeRequestSchema]);

const safeError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export const createProductModelChangeHandler =
  (dependencies: ProductModelChangeHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    try {
      const user = await dependencies.authenticate(request);
      if (user === undefined)
        return safeError(401, "PRODUCT_STUDIO_AUTH_REQUIRED", "Sign in required.");
      const credential = dependencies.credentials.resolve(user.id);
      const input = requestSchema.parse(await request.json());
      const client = dependencies.clientFor(credential);
      if (input.action === "preview-rename") {
        const changeId = dependencies.newId();
        const command: ProductStudioRenameCommand = {
          type: "RenameEntity",
          workspaceId: dependencies.workspaceId,
          targetId: input.entityId,
          expectedRevision: input.expectedRevision,
          idempotencyKey: `product-studio-${changeId}`,
          justification: input.justification,
          validFrom: dependencies.now(),
          payload: {
            canonicalName: input.canonicalName,
            canonicalAliasId: `product-studio-alias-${changeId}`,
          },
        };
        const preview = await client.previewRename(command);
        return Response.json({
          data: {
            preview,
            command: { ...command, previewToken: preview.previewToken },
          },
        });
      }

      if (input.command.workspaceId !== dependencies.workspaceId)
        return safeError(400, "INVALID_REQUEST", "Product change request is invalid.");

      const result = await client.executeRename(input.command);
      return Response.json({ data: { result } });
    } catch (error) {
      if (error instanceof UserBoundSarathiCredentialUnavailable)
        return safeError(
          403,
          "PRODUCT_STUDIO_MUTATION_UNAVAILABLE",
          "A user-bound Sarathi credential is unavailable.",
        );
      if (error instanceof SarathiProductModelMutationError)
        return safeError(error.status, error.code, error.message);
      if (error instanceof z.ZodError)
        return safeError(400, "INVALID_REQUEST", "Product change request is invalid.");
      return safeError(
        503,
        "PRODUCT_MODEL_UNAVAILABLE",
        "The product change service is unavailable.",
      );
    }
  };
