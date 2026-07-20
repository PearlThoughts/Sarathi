export {
  fuseKnowledgeResults,
  ingestKnowledgeSource,
  queryKnowledge,
  queryKnowledgeAcrossSources,
} from "./application/knowledge-service.ts";
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
  ApprovedThreadEvidence,
  KnowledgeEmbeddingPort,
  KnowledgeIngestionSummary,
  KnowledgeLiveSearch,
  KnowledgeQuery,
  KnowledgeRepository,
  KnowledgeSearchResult,
  KnowledgeSourceDocument,
  KnowledgeSourceReader,
  KnowledgeSourceSnapshot,
} from "./ports/knowledge-ports.ts";
