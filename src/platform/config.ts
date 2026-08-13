import { Effect } from "effect";
import { z } from "zod";
import type { ModelEgressPolicy, SensitivityTier, TrustTier } from "../domain/policy.ts";
import type {
  ProductEntityId,
  ProductModelCommandOperation,
  ProductModelQueryOperation,
} from "../modules/product-model/index.ts";

export type PlatformEnvironment = "local" | "test" | "production";

export type ProductModelPrincipalConfiguration = {
  readonly accessToken: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly trustTier: TrustTier;
  readonly effectiveAudience: readonly string[];
  readonly maximumSensitivity: SensitivityTier;
  readonly modelEgress: ModelEgressPolicy;
  readonly permittedCorpusScopes: readonly string[];
  readonly surfaces: readonly ("api" | "product-studio")[];
  readonly queryOperations: readonly ProductModelQueryOperation[];
  readonly commandOperations: readonly ProductModelCommandOperation[];
  readonly entityIds?: readonly ProductEntityId[] | undefined;
  readonly allowHiddenImpacts: boolean;
  readonly policyVersion: string;
};

export type ProductModelRuntimeConfiguration = {
  readonly databaseUrl: string;
  readonly previewSecret: string;
  readonly principals: readonly ProductModelPrincipalConfiguration[];
};

export type DeliveryExplorationRuntimeConfiguration = {
  readonly databaseUrl: string;
  readonly timeZone: string;
  readonly entityCatalogJson?: string | undefined;
};

export type SarathiConfig = {
  readonly serviceName: "sarathi";
  readonly environment: PlatformEnvironment;
  readonly http: {
    readonly port: number;
  };
  readonly overlayPath: string;
  readonly productModel?: ProductModelRuntimeConfiguration | undefined;
  readonly deliveryExploration?: DeliveryExplorationRuntimeConfiguration | undefined;
  readonly auth:
    | {
        readonly provider: "better-auth-postgres";
        readonly databaseUrl: string;
        readonly baseUrl: string;
        readonly secret: string;
      }
    | {
        readonly provider: "static";
      };
};

const productModelPrincipalSchema = z
  .object({
    accessToken: z.string().min(16),
    organizationId: z.string().min(1),
    workspaceId: z.string().min(1),
    actorId: z.string().min(1),
    trustTier: z.enum(["guest", "member", "trusted", "maintainer", "admin"]),
    effectiveAudience: z.array(z.string().min(1)),
    maximumSensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    modelEgress: z.enum(["allow", "redact", "approval-required", "block"]),
    permittedCorpusScopes: z.array(z.string().min(1)),
    surfaces: z.array(z.enum(["api", "product-studio"])).min(1),
    queryOperations: z.array(
      z.enum([
        "get-map",
        "get-subgraph",
        "get-dossier",
        "get-historical-graph",
        "get-coverage",
        "get-availability",
        "list-proposals",
      ]),
    ),
    commandOperations: z.array(z.enum(["preview-change", "execute-command"])),
    entityIds: z.array(z.uuid()).optional(),
    allowHiddenImpacts: z.boolean().default(false),
    policyVersion: z.string().min(1),
  })
  .strict();

const parseProductModelConfiguration = (
  environment: Record<string, string | undefined>,
): ProductModelRuntimeConfiguration | undefined => {
  const databaseUrl = environment.SARATHI_PRODUCT_MODEL_DATABASE_URL;
  const previewSecret = environment.SARATHI_PRODUCT_MODEL_PREVIEW_SECRET;
  const serializedPrincipals = environment.SARATHI_PRODUCT_MODEL_PRINCIPALS_JSON;
  if (
    databaseUrl === undefined &&
    previewSecret === undefined &&
    serializedPrincipals === undefined
  )
    return undefined;
  if (
    databaseUrl === undefined ||
    databaseUrl.trim() === "" ||
    previewSecret === undefined ||
    serializedPrincipals === undefined
  )
    throw new Error(
      "Product-model runtime requires database URL, preview secret, and principal configuration.",
    );
  let decoded: unknown;
  try {
    decoded = JSON.parse(serializedPrincipals);
  } catch {
    throw new Error("SARATHI_PRODUCT_MODEL_PRINCIPALS_JSON must contain valid JSON.");
  }
  const principals = z.array(productModelPrincipalSchema).min(1).parse(decoded);
  const identities = principals.map(({ workspaceId, actorId }) => `${workspaceId}\u0000${actorId}`);
  if (new Set(identities).size !== identities.length)
    throw new Error("Product-model principal workspace and actor identities must be unique.");
  return {
    databaseUrl,
    previewSecret,
    principals: principals as readonly ProductModelPrincipalConfiguration[],
  };
};

const parseDeliveryExplorationConfiguration = (
  environment: Record<string, string | undefined>,
): DeliveryExplorationRuntimeConfiguration | undefined => {
  const databaseUrl = environment.SARATHI_STRATEGY_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") return undefined;
  const timeZone = environment.SARATHI_WORKSPACE_TIMEZONE;
  if (timeZone === undefined || timeZone.trim() === "")
    throw new Error(
      "Delivery exploration requires SARATHI_WORKSPACE_TIMEZONE with the strategy database.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date(0));
  } catch {
    throw new Error("SARATHI_WORKSPACE_TIMEZONE must be a valid IANA time zone.");
  }
  return {
    databaseUrl,
    timeZone,
    ...(environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON === undefined
      ? {}
      : { entityCatalogJson: environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON }),
  };
};

const environmentFrom = (value: string | undefined): PlatformEnvironment => {
  if (value === "production" || value === "test") {
    return value;
  }

  return "local";
};

const authModeFrom = (value: string | undefined): "static" | "better-auth-postgres" | undefined => {
  if (value === "static" || value === "better-auth-postgres") {
    return value;
  }

  return undefined;
};

export const loadPlatformConfig = (
  source: Record<string, string | undefined> = process.env,
): Effect.Effect<SarathiConfig> =>
  Effect.sync(() => {
    const environment = environmentFrom(source.SARATHI_ENVIRONMENT ?? source.NODE_ENV);
    const authMode = authModeFrom(source.SARATHI_AUTH_MODE);
    const databaseUrl = source.SARATHI_AUTH_DATABASE_URL;
    const secret = source.SARATHI_AUTH_SECRET;
    const baseUrl = source.SARATHI_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const auth =
      authMode === "better-auth-postgres" ||
      (authMode === undefined && databaseUrl !== undefined && secret !== undefined)
        ? {
            provider: "better-auth-postgres" as const,
            databaseUrl: databaseUrl ?? "",
            baseUrl,
            secret: secret ?? "",
          }
        : { provider: "static" as const };

    if (
      auth.provider === "better-auth-postgres" &&
      (auth.databaseUrl === "" || auth.secret === "")
    ) {
      throw new Error(
        "SARATHI_AUTH_MODE=better-auth-postgres requires SARATHI_AUTH_DATABASE_URL and SARATHI_AUTH_SECRET",
      );
    }

    if (environment === "production" && auth.provider === "static") {
      throw new Error("Production Sarathi requires SARATHI_AUTH_MODE=better-auth-postgres");
    }

    return {
      serviceName: "sarathi",
      environment,
      http: {
        port: Number.parseInt(source.PORT ?? "3000", 10),
      },
      overlayPath: source.SARATHI_WORKSPACE_OVERLAY_PATH ?? "config/workspace.overlay.yaml",
      auth,
      productModel: parseProductModelConfiguration(source),
      deliveryExploration: parseDeliveryExplorationConfiguration(source),
    };
  });
