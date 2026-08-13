# Enterprise RAG relevance plan

## Architecture

The existing capability model and delivery episodes remain the aggregate boundaries. Knowledge
passages gain optional semantic hierarchy metadata. Retrieval proceeds through question facets,
authorized exact/full-text/vector candidates, RRF, deterministic domain reranking, optional
same-version parent expansion, and the existing delivery-answer envelope. The model only verbalizes an
accepted envelope and retains composed-or-safe-failure publication.

## Verification

- Permanent tests cover source-aware chunks, exact code lines, question facets, hybrid retrieval,
  reranking penalties, parent metadata, multi-citation episodes, typed ablation profiles, and provider
  request shape.
- Run the full public and private CI-equivalent suites and privacy gates on exact PR branches.
- Apply the additive migration before deploying code that reads the optional columns.
- Run all relevance profiles against the same production snapshot and keep retrieval fingerprints,
  envelope fingerprints, final acceptance, latency, and token cost separate.
- Treat automated evaluation, deployment health, production CLI behavior, and human acceptance as
  independent claims.
