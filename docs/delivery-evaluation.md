# Delivery Evaluation

`delivery evaluate` runs a bounded, versioned question set through the same authorized answer path used by `delivery query` and Teams. It does not use mocked retrieval or a parallel scoring implementation.

The evaluation set is supplied with `--set-json` or `SARATHI_DELIVERY_EVALUATION_SET_JSON`. Production question wording, expected terms, and human ratings belong in the private deployment overlay. The public repository contains only the contract and workspace-neutral examples.

```bash
bun run delivery evaluate \
  --actor-id <mapped-actor-id> \
  --time-zone <iana-zone> \
  --source-scopes-json '["jira","github","vault","strategy"]' \
  --set-json '<versioned-json>'
```

`--source-scopes-json` (or `SARATHI_DELIVERY_PERMITTED_SOURCE_SCOPES_JSON`) narrows both `delivery query` and every case in `delivery evaluate` to an explicit subset of `jira`, `vault`, `github`, `teams`, `email`, and `strategy`. Adapters outside the validated grant are not executed. Empty, duplicate, unknown, or malformed scopes fail before the answer path runs. Omitting the option preserves the caller's existing authorized source behavior.

The runner evaluates expected outcome, intent, status, citation count and source mix, required or forbidden answer terms, the answer acceptance envelope, optional human-usefulness ratings, and optional reconstruction recall. A denial case must name the exact privacy-safe failure operation so an unrelated outage cannot pass an authorization test.

Reconstruction recall is intended for governed leadership-report benchmarks. The private evaluation overlay may declare theme and initiative terms plus minimum recall rates. Scoring checks the exact authorized answer produced by the normal application path, but emits only matched counts, totals, rates, and pass/fail codes. Benchmark wording and the answer body never enter public logs or evaluation output.

Output deliberately excludes questions, answer text, citation URLs, required/forbidden terms, reconstruction terms, and source bodies. Each answered case includes only a SHA-256 answer fingerprint, aggregate acceptance metadata, intent/status, citation count, failure codes, privacy-safe reconstruction counts/rates, and optional human rating. Quality cases report completeness, citation, grounding, freshness, format, and latency rates. Expected denials and expected fail-closed empty answers are measured separately as authorization checks so safe exclusions do not dilute answer-quality rates.

When `minimumHumanUsefulnessAverage` is declared, every answered case must carry a 1–5 human rating bound to the SHA-256 fingerprint of the exact reviewed answer, and the average must meet the threshold. The first run exposes the fingerprint without the answer body. A reviewer inspects that answer through the normal Teams or single-query surface, records its fingerprint and rating in the private set, and reruns the evaluation. An unrated or changed answer therefore blocks acceptance instead of inheriting a stale usefulness score.

The command exits zero only when the declared case pass rate and human-usefulness threshold pass. A nonzero result is production evidence of an unmet acceptance gate, not a reason to weaken the set.

Evaluation evidence is reported at three distinct levels:

- **Case pass:** one exact governed question passed its declared automated checks on a named runtime revision.
- **Suite pass:** every case and aggregate threshold in the versioned set passed together on the intended revision.
- **Human acceptance:** the required usefulness ratings were recorded against the exact answer fingerprints and the human threshold passed.

A set of individually successful production cases is not automatically an accepted governed evaluation. Deployment liveness/readiness, automated evaluation, and human acceptance must be recorded separately. Deployment-specific questions, terms, ratings, fingerprints, and current pass status remain in the private overlay or live evidence system, never in this public repository.
