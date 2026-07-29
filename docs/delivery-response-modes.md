# Delivery Response Modes

Sarathi selects a declared response mode before retrieval. A caller may set `responseMode`, the delivery CLI may use `--response-mode`, and ordinary Teams questions are classified from their wording. Explicit caller selection always wins.

## Fast

Fast mode is the default for operational status, ownership, blocker, today, yesterday, and next-action questions.

- Source timeout: 4.5 seconds.
- Total application budget: 6.5 seconds.
- Acceptance latency target: 10 seconds through the caller-facing transport.
- Format: one short opening, compact cited bullets, and a cited action only when source evidence supports it.
- Retrieval remains intentionally small and model composition may run only inside the remaining bounded budget.

## Structured brief

Weekly, sprint, release, comparison, risk-report, and executive-brief wording selects structured mode unless the caller chooses another mode.

- Source timeout: 8 seconds.
- Total application budget: 12 seconds.
- Acceptance latency target: 15 seconds.
- Format: explicit Delivery brief and Evidence sections, with an Action section only when supported.
- Each bounded query operation may return up to 15 records so requested report fields are not displaced by the fast-answer cap.

## Deep dive

Deep-dive, comprehensive, investigation, root-cause, history, and trend wording selects deep-dive mode.

- Source safety timeout: 90 seconds.
- Composition safety timeout: 60 seconds.
- Total safety budget: 150 seconds.
- No latency acceptance target or fixed line/item presentation cap.
- Format: the structure required by the question and evidence. Ordinary investigations retain explicit scope, sources, evidence, gaps, and inference boundaries.
- Each bounded query operation may return up to 50 records. Exhaustive period-census retrieval is configured separately and cannot silently collapse into the fast format.

Non-fast modes currently use deterministic rendering over the authorized result envelope. This preserves every required disclosure even when optional model composition is unavailable or still optimized for the fast Teams shape.

### Leadership period reports

Questions such as “what did we deliver in the previous quarter?” are deep-dive leadership reports, not fast status answers. They require an exhaustive authorized period census and a configured capability ledger before retrieval starts.

- The report is organized into numbered capability themes with descriptive initiative bullets, delivery stage, and source citations.
- Relevant initiatives are not reduced to a fixed top-three list. Rendering uses only the Microsoft Teams platform-size ceiling.
- The report fails closed when the census is incomplete, a required source is unavailable, or no qualifying delivery exists. Unmapped corpus records are disclosed as a coverage gap but do not suppress source-supported capability sections; governed reconstruction recall decides whether the resulting report is fit for acceptance.
- A failed report states privacy-safe reasons and does not substitute unrelated generic evidence.
- Replay checksums, internal execution timing, and diagnostic census prose are excluded from the user-facing leadership narrative.

## Acceptance envelope

Every delivery answer returns aggregate, privacy-safe acceptance metadata. It contains no source body or credential.

- Completeness passes only when every requested intent and explicitly required source is represented.
- Citation coverage passes only when every material bullet or action has a resolvable citation.
- Grounding passes only when every emitted citation belongs to the authorized result envelope.
- Freshness passes when at least 95 percent of cited synchronized evidence was indexed within a two-hour window, allowing one hourly repair interval plus bounded execution delay. Evidence read live during the request has no projection index timestamp and is treated as current.
- Formatting is validated independently for the selected mode.
- Latency is measured against the selected mode’s caller-facing target when that mode declares one. Deep-dive latency is governed by safety deadlines, not by an artificial quality acceptance target.
- Overall acceptance passes only when completeness, citation, grounding, freshness, formatting, and latency all pass.

An answer may still be useful while its acceptance is false. For example, a cited partial answer remains visible, while the failed completeness or freshness measurement prevents evaluation from counting it as a pass.
