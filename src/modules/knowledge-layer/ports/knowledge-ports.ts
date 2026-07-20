import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type { DeliveryProjection } from "../../delivery-intelligence/index.ts";
import type {
  KnowledgeAclRule,
  KnowledgeAudience,
  KnowledgePassageDraft,
  KnowledgeSourceKind,
} from "../domain/knowledge.ts";

export type KnowledgeSourceDocument = {
  readonly source: KnowledgeSourceKind;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly externalId: string;
  readonly sourceType: string;
  readonly sourceVersion: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly sourceUpdatedAt: string;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
  readonly provenance: Readonly<Record<string, string>>;
  readonly acl: readonly KnowledgeAclRule[];
  readonly passages: readonly KnowledgePassageDraft[];
  readonly deliveryProjection?: DeliveryProjection | undefined;
};

export type KnowledgeSourceSnapshot = {
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly workspaceId: string;
  readonly cursor: string;
  readonly scopeHash: string;
  readonly documents: readonly KnowledgeSourceDocument[];
};

export type KnowledgeSourceReader = {
  readonly readSnapshot: (
    workspaceId: string,
    previousCursor?: string | undefined,
  ) => Effect.Effect<KnowledgeSourceSnapshot, RepositoryError>;
};

export type KnowledgeEmbeddingPort = {
  readonly model: string;
  readonly dimensions: number;
  readonly embed: (
    values: readonly string[],
  ) => Effect.Effect<readonly (readonly number[])[], RepositoryError>;
};

export type KnowledgeQuery = {
  readonly question: string;
  readonly audience: KnowledgeAudience;
  readonly topK: number;
};

export type KnowledgeSearchResult = {
  readonly id: string;
  readonly source: KnowledgeSourceKind;
  readonly sourceId: string;
  readonly title: string;
  readonly excerpt: string;
  readonly citationUrl: string;
  readonly sourceUpdatedAt: string;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
  readonly freshness: number;
  readonly componentRanks: Readonly<Record<string, number>>;
  readonly score: number;
};

export type KnowledgeRepository = {
  readonly reconcile: (
    snapshot: KnowledgeSourceSnapshot,
    embeddings: KnowledgeEmbeddingPort,
  ) => Effect.Effect<KnowledgeIngestionSummary, RepositoryError>;
  readonly search: (
    query: KnowledgeQuery,
    queryEmbedding: readonly number[],
  ) => Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError>;
};

export type KnowledgeLiveSearch = {
  readonly source: KnowledgeSourceKind;
  readonly search: (
    query: KnowledgeQuery,
  ) => Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError>;
};

export type ApprovedThreadEvidence = {
  readonly sourceId: string;
  readonly title: string;
  readonly excerpt: string;
  readonly citationUrl: string;
  readonly sourceUpdatedAt: string;
  readonly sensitivity: SensitivityTier;
};

export type KnowledgeIngestionSummary = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly cursor: string;
  readonly scopeHash: string;
  readonly documentsObserved: number;
  readonly versionsCreated: number;
  readonly passagesActive: number;
  readonly itemsDeleted: number;
  readonly checksum: string;
};
