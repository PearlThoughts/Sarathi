export const collaborationSourceScopes = [
  "jira",
  "vault",
  "github",
  "teams",
  "email",
  "strategy",
] as const;

export type CollaborationSourceScope = (typeof collaborationSourceScopes)[number];

const collaborationSourceScopeSet = new Set<string>(collaborationSourceScopes);

export const isCollaborationSourceScope = (value: unknown): value is CollaborationSourceScope =>
  typeof value === "string" && collaborationSourceScopeSet.has(value);
