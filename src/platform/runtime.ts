import { existsSync } from "node:fs";
import { Effect } from "effect";
import { makeBetterAuthWorkspaceAuth } from "../infrastructure/auth/better-auth-workspace-auth.ts";
import { makeStaticAuthService } from "../infrastructure/auth/static-auth.ts";
import { makeInMemoryAuthorizationService } from "../infrastructure/authorization/in-memory-authorization.ts";
import {
  makeStaticWorkspaceOverlaySource,
  makeYamlWorkspaceOverlaySource,
} from "../infrastructure/overlay/yaml-workspace-overlay.ts";
import type { AuthorizationService, AuthService } from "../modules/identity-access/index.ts";
import type { WorkspaceSourceSnapshot } from "../modules/workspace-model/contracts.ts";
import type { WorkspaceOverlaySource } from "../modules/workspace-model/ports/workspace-overlay-source.ts";
import type { SarathiConfig } from "./config.ts";
import { loadPlatformConfig } from "./config.ts";
import { defaultSourceSnapshot } from "./source-snapshot.ts";

export type SarathiRuntime = {
  readonly config: SarathiConfig;
  readonly sourceSnapshot: WorkspaceSourceSnapshot;
  readonly auth: AuthService;
  readonly workspaceOverlay: WorkspaceOverlaySource;
  readonly authorization: AuthorizationService;
  readonly clock: {
    readonly now: () => string;
  };
};

export type RuntimeOverrides = {
  readonly config?: SarathiConfig | undefined;
  readonly sourceSnapshot?: WorkspaceSourceSnapshot | undefined;
  readonly auth?: AuthService | undefined;
  readonly workspaceOverlay?: WorkspaceOverlaySource | undefined;
  readonly authorization?: AuthorizationService | undefined;
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

export const makeSarathiRuntime = (overrides: RuntimeOverrides = {}): SarathiRuntime => {
  const config = overrides.config ?? Effect.runSync(loadPlatformConfig());

  return {
    config,
    sourceSnapshot: overrides.sourceSnapshot ?? defaultSourceSnapshot,
    auth: overrides.auth ?? makeAuthService(config),
    workspaceOverlay: overrides.workspaceOverlay ?? makeOverlaySource(config),
    authorization: overrides.authorization ?? makeInMemoryAuthorizationService(),
    clock: overrides.clock ?? { now: () => new Date().toISOString() },
  };
};
