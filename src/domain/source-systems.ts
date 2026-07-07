export type SourceSystem = "microsoft-teams" | "linear" | "github" | "jira" | "manual-yaml";

export type SourceConfidence = "observed" | "inferred" | "declared";

export type SourceReference = {
  readonly system: SourceSystem;
  readonly externalId: string;
  readonly url?: string | undefined;
  readonly confidence: SourceConfidence;
};

export type CommunicationSurface = {
  readonly system: Extract<SourceSystem, "microsoft-teams" | "linear" | "github" | "jira">;
  readonly externalId: string;
  readonly purpose: "discussion" | "execution" | "review" | "incident" | "planning";
  readonly sourceConfidence: SourceConfidence;
};
