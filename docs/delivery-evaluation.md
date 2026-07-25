# Delivery Evaluation

`delivery evaluate` runs a bounded, versioned question set through the same authorized answer path used by `delivery query` and Teams. It does not use mocked retrieval or a parallel scoring implementation.

The evaluation set is supplied with `--set-json` or `SARATHI_DELIVERY_EVALUATION_SET_JSON`. Production question wording, expected terms, and human ratings belong in the private deployment overlay. The public repository contains only the contract and workspace-neutral examples.

```bash
bun run delivery evaluate \
  --actor-id <mapped-actor-id> \
  --time-zone <iana-zone> \
  --set-json '<versioned-json>'
```

The runner evaluates expected outcome, intent, status, citation count and source mix, required or forbidden answer terms, the answer acceptance envelope, and optional human-usefulness ratings. A denial case must name the exact privacy-safe failure operation so an unrelated outage cannot pass an authorization test.

Output deliberately excludes questions, answer text, citation URLs, required/forbidden terms, and source bodies. Each answered case includes only a SHA-256 answer fingerprint, aggregate acceptance metadata, intent/status, citation count, failure codes, and optional human rating. Quality cases report completeness, citation, grounding, freshness, format, and latency rates. Expected denials and expected fail-closed empty answers are measured separately as authorization checks so safe exclusions do not dilute answer-quality rates.

When `minimumHumanUsefulnessAverage` is declared, every answered case must carry a 1–5 human rating bound to the SHA-256 fingerprint of the exact reviewed answer, and the average must meet the threshold. The first run exposes the fingerprint without the answer body. A reviewer inspects that answer through the normal Teams or single-query surface, records its fingerprint and rating in the private set, and reruns the evaluation. An unrated or changed answer therefore blocks acceptance instead of inheriting a stale usefulness score.

The command exits zero only when the declared case pass rate and human-usefulness threshold pass. A nonzero result is production evidence of an unmet acceptance gate, not a reason to weaken the set.
