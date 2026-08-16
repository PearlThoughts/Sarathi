import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type { DeliveryExecutionContext } from "../../delivery-execution-observability/index.ts";
import type { DeliveryProjection } from "../../delivery-intelligence/index.ts";
import type {
  KnowledgeAclRule,
  KnowledgeAudience,
  KnowledgePassageDraft,
  KnowledgeSourceKind,
} from "../domain/knowledge.ts";
import type { SynchronizationTrigger } from "../domain/synchronization.ts";

export type KnowledgeSourceDocument = {
  readonly source: KnowledgeSourceKind;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly externalId: string;
  readonly sourceType: string;
  readonly sourceVersion: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly sourceCreatedAt?: string | undefined;
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
  /** Full inventories retire every previously active item not observed in this read. */
  readonly mode?: "full" | "delta" | undefined;
  /** Delta reads retire only these explicit source identities. */
  readonly retiredExternalIds?: readonly string[] | undefined;
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
  readonly subject?: string | undefined;
  readonly facets?: readonly string[] | undefined;
  readonly audience: KnowledgeAudience;
  readonly sources?: readonly KnowledgeSourceKind[] | undefined;
  readonly topK: number;
  readonly expandParents?: boolean | undefined;
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
  readonly passageKind?: string | undefined;
  readonly parentLocator?: string | undefined;
  readonly hierarchy?: readonly string[] | undefined;
  readonly attributes?: Readonly<Record<string, string | readonly string[]>> | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
};

export type KnowledgeQueryControl = {
  readonly signal?: AbortSignal | undefined;
  readonly execution?: DeliveryExecutionContext | undefined;
};

export type KnowledgeRepository = {
  readonly reconcile: (
    snapshot: KnowledgeSourceSnapshot,
    embeddings: KnowledgeEmbeddingPort,
    trigger: SynchronizationTrigger,
  ) => Effect.Effect<KnowledgeIngestionSummary, RepositoryError>;
  readonly search: (
    query: KnowledgeQuery,
    queryEmbedding: readonly number[],
    control?: KnowledgeQueryControl | undefined,
  ) => Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError>;
  readonly searchLexical: (
    query: KnowledgeQuery,
    control?: KnowledgeQueryControl | undefined,
  ) => Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError>;
};

export type KnowledgeLiveSearch = {
  readonly source: KnowledgeSourceKind;
  readonly search: (
    query: KnowledgeQuery,
  ) => Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError>;
};

export type TeamsThreadContext = {
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
