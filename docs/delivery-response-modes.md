# Delivery Response Modes

Sarathi selects a declared response mode before retrieval. A caller may set `responseMode`, the delivery CLI may use `--response-mode`, and ordinary Teams questions are classified from their wording. Explicit caller selection always wins.

## Fast

Fast mode is the default for operational status, ownership, blocker, same-day activity, and next-action questions. A delivered-period question such as “what did we deliver yesterday?” is a report product and does not use fast mode.

- Source timeout: 15 seconds.
- Total application budget: 30 seconds.
- No user-facing line-count or latency acceptance target.
- Format: topic headings, one work item per bullet, and a compact references footer.
- Retrieval stays bounded by the requested project and intent, not by a presentation-length cap.

## Structured brief

Comparison, risk-report, and explicit structured-brief wording selects structured mode unless the caller chooses another mode. Delivered-period questions use deep-dive synthesis even when the period is only a day or week.

- Source timeout: 30 seconds.
- Total application budget: 60 seconds.
- No user-facing line-count or latency acceptance target.
- Format: topic headings, one work item per bullet, and a compact references footer.
- Each bounded query operation may return up to 15 records so requested report fields are not displaced by the fast-answer cap.

## Deep dive

Deep-dive, comprehensive, investigation, root-cause, history, trend, and delivered-period wording selects deep-dive mode.

- Source safety timeout: 90 seconds.
- Composition safety timeout: 120 seconds.
- Total safety budget: 240 seconds.
- No latency acceptance target or fixed line/item presentation cap.
- Format: the structure required by the question, with the requested features and capabilities first and references at the bottom.
- Each bounded query operation may return up to 50 records. Exhaustive period-census retrieval is configured separately and cannot silently collapse into the fast format.

Period-report products use model composition over the reconstructed change capsules plus retrieved project context. They are published only after the composed response passes the complete report-quality contract. Provider failure, timeout, malformed output, invalid citations, or failed quality validation produces only the short safe composition-failure notice; deterministic report content and partial envelopes are never published.

### Sub-30-day delivery reports

Questions about delivery yesterday, last week, this week, or during a requested lookback such as the last 30 days use the same synthesis path as longer leadership reports.

- The period is resolved in workspace-local calendar time; “yesterday” is the preceding closed calendar day, not a rolling 24-hour approximation.
- Jira, Git, Teams, Vault, and repository knowledge contribute the available delivery and project context.
- After the change census is grouped by capability, Sarathi performs capability-specific knowledge retrieval using the reconstructed initiative titles. This second pass makes project ontology and master context available even when the original question contains only a generic phrase such as “last 30 days.”
- The delivery-manager composition has no fast-answer line limit, forced numbered action, or 10-second acceptance target. It consolidates related records into capability headings and concise feature bullets.
- Jira, GitHub, Vault, Teams, and email links are grouped in a compact references footer instead of interrupting the feature list.

### Leadership period reports

Questions such as “what did we deliver in the previous quarter?” are deep-dive leadership reports, not fast status answers. They require an exhaustive authorized period census and a configured capability ledger before retrieval starts.

- The report is organized into numbered capability themes with descriptive feature bullets and a bottom references section.
- Relevant initiatives are not reduced to a fixed top-three list. Rendering uses only the Microsoft Teams platform-size ceiling.
- Incomplete census or required-source unavailability prevents report publication. The operation fails rather than emitting a partial report.
- A failed report emits only the short safe notice and a privacy-safe correlation code. Detailed failure classification remains in operator diagnostics and never includes prompts, source bodies, credentials, or private identifiers.
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
