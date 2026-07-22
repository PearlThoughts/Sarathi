export {
  fuseKnowledgeResults,
  ingestKnowledgeSource,
  queryKnowledge,
  queryKnowledgeAcrossSources,
  queryKnowledgeLexically,
} from "./application/knowledge-service.ts";
export type { SynchronizationSource } from "./application/synchronization-service.ts";
export {
  readSynchronizationSourceStatus,
  synchronizeKnowledgeSource,
} from "./application/synchronization-service.ts";
export type {
  FusedKnowledgeCandidate,
  KnowledgeAclEffect,
  KnowledgeAclRule,
  KnowledgeAclSubjectType,
  KnowledgeAudience,
  KnowledgeCandidateMetadata,
  KnowledgePassageDraft,
  KnowledgeSourceKind,
  RankedKnowledgeCandidate,
} from "./domain/knowledge.ts";
export {
  chunkVaultMarkdown,
  createTypedPassage,
  isKnowledgeCandidateAuthorized,
  reciprocalRankFusion,
} from "./domain/knowledge.ts";
export type {
  SynchronizationCheckpoint,
  SynchronizationDeliveryStatus,
  SynchronizationEventDelivery,
  SynchronizationEventIdentity,
  SynchronizationFailureClass,
  SynchronizationFreshness,
  SynchronizationLease,
  SynchronizationLeaseOperation,
  SynchronizationRetryPolicy,
  SynchronizationRunStatus,
  SynchronizationSubscription,
  SynchronizationSubscriptionStatus,
  SynchronizationTrigger,
} from "./domain/synchronization.ts";
export {
  synchronizationEventDeliveryId,
  synchronizationFreshness,
  synchronizationLeaseAvailable,
  synchronizationRetryAt,
} from "./domain/synchronization.ts";
export type {
  KnowledgeEmbeddingPort,
  KnowledgeIngestionSummary,
  KnowledgeLiveSearch,
  KnowledgeQuery,
  KnowledgeRepository,
  KnowledgeSearchResult,
  KnowledgeSourceDocument,
  KnowledgeSourceReader,
  KnowledgeSourceSnapshot,
  TeamsThreadContext,
} from "./ports/knowledge-ports.ts";
export type {
  SynchronizationControlRepository,
  SynchronizationEventRegistration,
  SynchronizationRun,
  SynchronizationStatus,
} from "./ports/synchronization-ports.ts";
