import {
  AgentApplication,
  MemoryStorage,
  type TurnContext,
  type TurnState,
} from "@microsoft/agents-hosting";
import { startServer } from "@microsoft/agents-hosting-express";

export type TeamsIngressConfiguration = {
  readonly appId: string;
  readonly appPassword: string;
  readonly tenantId: string;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") {
    throw new Error(`[TEAMS INGRESS CONFIGURATION FAILED]: ${name} is required.`);
  }
  return value;
};

export const teamsIngressConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): TeamsIngressConfiguration => ({
  appId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
  appPassword: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
  tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
});

export const createTeamsIngressApplication = (): AgentApplication<TurnState> => {
  const application = new AgentApplication({ storage: new MemoryStorage() });
  application.onActivity("message", async (_context: TurnContext) => {
    // Message delivery is intentionally inert until runtime composition supplies
    // the mapped-workspace teams-mention capability.
  });
  return application;
};

export const startTeamsIngress = (): void => {
  teamsIngressConfigurationFromEnvironment();
  startServer(createTeamsIngressApplication());
};

if (import.meta.main) {
  startTeamsIngress();
}
