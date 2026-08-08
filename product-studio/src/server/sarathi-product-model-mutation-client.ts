import "server-only";
import { z } from "zod";
import type { UserBoundSarathiCredential } from "./user-bound-sarathi-credentials";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type MutationClientConfiguration = {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly credential: UserBoundSarathiCredential;
  readonly fetch?: Fetcher | undefined;
};

type ProductStudioRenameCommand = {
  readonly type: "RenameEntity";
  readonly workspaceId: string;
  readonly targetId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly justification: string;
  readonly validFrom: string;
  readonly previewToken?: string | undefined;
  readonly payload: {
    readonly canonicalName: string;
    readonly canonicalAliasId: string;
  };
};

const previewSchema = z
  .object({
    status: z.literal("previewed"),
    workspaceId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    resultingRevision: z.number().int().nonnegative(),
    commandHash: z.string().min(1),
    previewToken: z.string().min(1),
    expiresAt: z.iso.datetime(),
    policyVersion: z.string().min(1),
    impact: z
      .object({
        changedEntityIds: z.array(z.uuid()),
        hiddenEntityImpactCount: z.number().int().nonnegative(),
        changedCollections: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    invariantResults: z.array(
      z.object({ status: z.literal("passed"), name: z.string().min(1) }).strict(),
    ),
  })
  .strict();

const commitSchema = z
  .object({
    status: z.literal("committed"),
    revision: z.number().int().nonnegative(),
    eventId: z.string().min(1),
    changedEntityIds: z.array(z.uuid()),
    replayed: z.boolean(),
    projectionState: z.literal("pending"),
  })
  .strict();

const errorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "INVALID_REQUEST",
          "PRODUCT_MODEL_COMMAND_ACCESS_DENIED",
          "PRODUCT_MODEL_NOT_FOUND",
          "PRODUCT_MODEL_UNAVAILABLE",
          "approval_required",
          "stale_revision",
          "idempotency_conflict",
          "invalid_input",
          "entity_not_found",
          "entity_conflict",
          "entity_retired",
          "alias_conflict",
          "parent_conflict",
          "kind_incompatible",
          "hierarchy_cycle",
          "redirect_conflict",
          "redirect_cycle",
          "identity_incompatible",
          "disposition_incomplete",
          "relation_conflict",
          "relation_incompatible",
          "variant_conflict",
          "variant_ambiguous",
          "transition_invalid",
          "revision_conflict",
          "no_change",
        ]),
        message: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

type ProductStudioChangePreview = z.infer<typeof previewSchema>;
type ProductStudioCommandResult = z.infer<typeof commitSchema>;

class SarathiProductModelMutationError extends Error {
  constructor(
    readonly status: number,
    readonly code: z.infer<typeof errorSchema>["error"]["code"],
    message: string,
  ) {
    super(message);
    this.name = "SarathiProductModelMutationError";
  }
}

const requiredUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Sarathi API must use HTTPS outside local development.");
  return url;
};

const required = (name: string, value: string): string => {
  if (value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

export const createSarathiProductModelMutationClient = (
  configuration: MutationClientConfiguration,
) => {
  const baseUrl = requiredUrl(configuration.baseUrl);
  const workspaceId = required("workspaceId", configuration.workspaceId);
  const accessToken = required("user access token", configuration.credential.accessToken);
  const request = configuration.fetch ?? fetch;

  const write = async (path: "changes/preview" | "commands", body: unknown): Promise<unknown> => {
    const url = new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/product-model/${path}`,
      baseUrl,
    );
    const response = await request(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    });
    const envelope = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(envelope);
      if (!parsed.success)
        throw new SarathiProductModelMutationError(
          response.status,
          "PRODUCT_MODEL_UNAVAILABLE",
          "The product change service is unavailable.",
        );
      throw new SarathiProductModelMutationError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
      );
    }
    if (typeof envelope !== "object" || envelope === null || !("data" in envelope))
      throw new SarathiProductModelMutationError(
        502,
        "PRODUCT_MODEL_UNAVAILABLE",
        "The product change service is unavailable.",
      );
    return envelope.data;
  };

  return {
    previewRename: async (
      command: ProductStudioRenameCommand,
    ): Promise<ProductStudioChangePreview> =>
      previewSchema.parse(await write("changes/preview", command)),
    executeRename: async (
      command: ProductStudioRenameCommand & { readonly previewToken: string },
    ): Promise<ProductStudioCommandResult> => commitSchema.parse(await write("commands", command)),
  };
};
