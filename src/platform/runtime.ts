import { existsSync } from "node:fs";
import { Effect } from "effect";
import { makeBetterAuthWorkspaceAuth } from "../infrastructure/auth/better-auth-workspace-auth.ts";
import { createHmacProductPreviewTokenCodec } from "../infrastructure/auth/hmac-product-preview-token.ts";
import { createProductModelApiSecurity } from "../infrastructure/auth/product-model-api-security.ts";
import { makeStaticAuthService } from "../infrastructure/auth/static-auth.ts";
import { makeInMemoryAuthorizationService } from "../infrastructure/authorization/in-memory-authorization.ts";
import {
  makeStaticWorkspaceOverlaySource,
  makeYamlWorkspaceOverlaySource,
} from "../infrastructure/overlay/yaml-workspace-overlay.ts";
import {
  createPostgresDeliveryQuerySource,
  createPostgresProductModelCommandRepository,
  createPostgresProductModelDetailRepository,
  createPostgresProductModelGraphRepository,
  openKnowledgePostgresDatabase,
} from "../infrastructure/postgres/index.ts";
import {
  createProductDeliveryExplorationProjection,
  parseDeliveryEntityCatalog,
} from "../modules/delivery-intelligence/index.ts";
import type { AuthorizationService, AuthService } from "../modules/identity-access/index.ts";
import {
  createProductModelCommandService,
  createProductModelDetailQueryService,
  createProductModelQueryService,
  type ProductModelApiDependencies,
} from "../modules/product-model/index.ts";
import type { WorkspaceSourceSnapshot } from "../modules/workspace-model/contracts.ts";
import type { WorkspaceOverlaySource } from "../modules/workspace-model/ports/workspace-overlay-source.ts";
import type {
  DeliveryExplorationRuntimeConfiguration,
  ProductModelRuntimeConfiguration,
  SarathiConfig,
} from "./config.ts";
import { loadPlatformConfig } from "./config.ts";
import { defaultSourceSnapshot } from "./source-snapshot.ts";

export type SarathiRuntime = {
  readonly config: SarathiConfig;
  readonly sourceSnapshot: WorkspaceSourceSnapshot;
  readonly auth: AuthService;
  readonly workspaceOverlay: WorkspaceOverlaySource;
  readonly authorization: AuthorizationService;
  readonly productModelApi?: ProductModelApiDependencies | undefined;
  readonly clock: {
    readonly now: () => string;
  };
  readonly close: () => Promise<void>;
};

export type RuntimeOverrides = {
  readonly config?: SarathiConfig | undefined;
  readonly sourceSnapshot?: WorkspaceSourceSnapshot | undefined;
  readonly auth?: AuthService | undefined;
  readonly workspaceOverlay?: WorkspaceOverlaySource | undefined;
  readonly authorization?: AuthorizationService | undefined;
  readonly productModelApi?: ProductModelApiDependencies | undefined;
  readonly clock?: { readonly now: () => string } | undefined;
};

const defaultOverlay = {
  version: 1,
  organizationId: "acme",
  teams: [],
} as const;

const makeAuthService = (config: SarathiConfig): AuthService =>
  config.auth.provider === "better-auth-postgres"
    ? makeBetterAuthWorkspaceAuth(config.auth)
    : makeStaticAuthService();

const makeOverlaySource = (config: SarathiConfig): WorkspaceOverlaySource =>
  existsSync(config.overlayPath)
    ? makeYamlWorkspaceOverlaySource(config.overlayPath)
    : makeStaticWorkspaceOverlaySource(defaultOverlay);

const composeProductModelApi = (
  configuration: ProductModelRuntimeConfiguration,
  deliveryConfiguration: DeliveryExplorationRuntimeConfiguration | undefined,
  now: () => string,
): { readonly api: ProductModelApiDependencies; readonly close: () => Promise<void> } => {
  const opened = openKnowledgePostgresDatabase(configuration.databaseUrl);
  const security = createProductModelApiSecurity(configuration.principals);
  const graphRepository = createPostgresProductModelGraphRepository(opened.database);
  const detailRepository = createPostgresProductModelDetailRepository(opened.database);
  const details = createProductModelDetailQueryService(
    security.queries,
    graphRepository,
    detailRepository,
  );
  const commandRepository = createPostgresProductModelCommandRepository(opened.database);
  const deliveryOpened =
    deliveryConfiguration === undefined
      ? undefined
      : openKnowledgePostgresDatabase(deliveryConfiguration.databaseUrl);
  const delivery =
    deliveryOpened === undefined || deliveryConfiguration === undefined
      ? undefined
      : createProductDeliveryExplorationProjection({
          source: createPostgresDeliveryQuerySource(deliveryOpened.database, {
            entityCatalog: parseDeliveryEntityCatalog(deliveryConfiguration.entityCatalogJson),
          }),
          details,
          timeZone: deliveryConfiguration.timeZone,
        });
  return {
    api: {
      queries: createProductModelQueryService(security.queries, graphRepository),
      details,
      ...(delivery === undefined ? {} : { delivery }),
      commands: createProductModelCommandService(security.commands, commandRepository, {
        now,
        newId: () => globalThis.crypto.randomUUID(),
        previewTokens: createHmacProductPreviewTokenCodec(configuration.previewSecret),
      }),
      context: security.context,
      now,
    },
    close: async () => {
      await Promise.all([opened.pool.end(), deliveryOpened?.pool.end()]);
    },
  };
};

export const makeSarathiRuntime = (overrides: RuntimeOverrides = {}): SarathiRuntime => {
  const config = overrides.config ?? Effect.runSync(loadPlatformConfig());
  const clock = overrides.clock ?? { now: () => new Date().toISOString() };
  const productModel =
    overrides.productModelApi !== undefined
      ? { api: overrides.productModelApi, close: () => Promise.resolve() }
      : config.productModel === undefined
        ? undefined
        : composeProductModelApi(config.productModel, config.deliveryExploration, clock.now);

  return {
    config,
    sourceSnapshot: overrides.sourceSnapshot ?? defaultSourceSnapshot,
    auth: overrides.auth ?? makeAuthService(config),
    workspaceOverlay: overrides.workspaceOverlay ?? makeOverlaySource(config),
    authorization: overrides.authorization ?? makeInMemoryAuthorizationService(),
    productModelApi: productModel?.api,
    clock,
    close: productModel?.close ?? (() => Promise.resolve()),
  };
};
