# Enterprise RAG relevance research

## Scope and evidence boundary

This slice improves relevance on the existing indexed snapshot. It does not add a storage platform,
continuous-ingestion path, webhook, event processor, history expansion, or live-source scope. Private
workspace ontology, questions, reports, aliases, and acceptance policy remain in the private overlay.

## CodeCompass comparison

CodeCompass indexes parser-backed symbols with stable symbol identity, containing-symbol metadata,
exact line ranges, content hashes, and incremental refresh. Its current implementation supports
Tree-sitter language adapters for several languages and retrieves dense symbol units. Older design
material discusses hybrid retrieval, hierarchy, and reranking, but those surfaces are not all present
as equivalent production behavior and were treated as patterns, not reusable code.

Sarathi adapts the techniques that fit its existing boundaries:

- parser-backed TypeScript and JavaScript declaration units through the already-installed TypeScript
  compiler API;
- exact line ranges, module identity, parent symbols, and incremental content hashes;
- child retrieval with authorized same-version parent context;
- hybrid exact, PostgreSQL full-text, and pgvector retrieval;
- deterministic domain reranking after reciprocal-rank fusion;
- explicit question facets and materiality-aware context allocation.

Sarathi does not copy CodeCompass code, introduce Tree-sitter native binaries, replace PostgreSQL, or
adopt a separate code-search/RAG service. Unsupported code languages retain a bounded-file fallback;
adding a parser requires measured corpus value and an operations/maintenance review.

## RAG literature findings

The indexed books consistently separate retrieval evaluation from generation evaluation and recommend
production-representative questions rather than generic benchmarks. Their common pipeline is
pre-retrieval interpretation/decomposition, hybrid sparse/dense candidate retrieval, post-retrieval
reranking, and hierarchical parent context. Candidate recall and ranking must be measured before final
answer quality so a better-sounding answer is not misattributed to retrieval.

GraphRAG is applicable as a technique when relationships and multi-hop evidence materially help a
question. Sarathi already has typed delivery objects, relations, capabilities, and episodes in
PostgreSQL. A graph database is therefore unnecessary; relationship distance and episode membership
can be deterministic reranking features over the existing model.

## Decisions

- Keep Jira typed fields, comments, changelog, sprint state, and relations distinct.
- Keep Vault heading-aware parsing and add section parents plus paragraph/list children.
- Preserve Teams atomic messages and add coherent conversation-span parents using replies, quoted
  references, shared identifiers, participants, time gaps, topic boundaries, and delivery-language
  roles.
- Use semantic AST declarations for TypeScript/JavaScript and bounded files elsewhere.
- Keep hard character limits only as overflow protection for one semantic unit.
- Add the reranker as a pure domain function behind the existing retrieval port.
- Deduplicate and authorize before parent context is exposed.
- Select envelope evidence by question facet and episode materiality, preserve several useful episode
  citations, and represent missing facets as missing rather than filling space with unrelated sources.

## Frozen-snapshot ablations

`SARATHI_RELEVANCE_PROFILE` provides four typed read-only profiles for the governed evaluator:

- `legacy`: lexical retrieval and the existing source-balanced/first-citation envelope;
- `semantic`: existing exact/full-text/vector hybrid retrieval without reranking;
- `reranked`: hybrid retrieval plus deterministic domain reranking;
- `expanded`: reranking, authorized parent context, and facet/materiality envelope selection.

Production configuration is governed as `expanded`. The profile does not mutate indexed content and
can be overridden only for an isolated CLI evaluation process. Because the snapshot is not re-ingested,
new chunk-boundary behavior cannot affect its stored rows; that limitation must be reported separately
from hybrid-retrieval effects.

## Fine-tuning

Fine-tuning remains out of scope. Reconsider it only after retrieval, entity resolution, episode
construction, and parent expansion pass component evaluation and Sol still makes repeatable errors on a
complete oracle envelope with stable labels and a sufficiently large reviewed training/held-out set.
Potential later targets are narrow classifiers, not factual answer generation.
