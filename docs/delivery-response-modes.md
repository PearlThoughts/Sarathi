# Delivery Response Modes

Sarathi selects a declared response mode before retrieval. A caller may set `responseMode`, the delivery CLI may use `--response-mode`, and ordinary Teams questions are classified from their wording. Explicit caller selection always wins.

## Fast

Fast mode is the default for operational status, ownership, blocker, same-day activity, and next-action questions. A delivered-period question such as “what did we deliver yesterday?” is a report product and does not use fast mode.

- Source timeout: 4.5 seconds.
- Total application budget: 6.5 seconds.
- Acceptance latency target: 10 seconds through the caller-facing transport.
- Format: one short opening, compact cited bullets, and a cited action only when source evidence supports it.
- Retrieval remains intentionally small and model composition may run only inside the remaining bounded budget.

## Structured brief

Comparison, risk-report, and explicit structured-brief wording selects structured mode unless the caller chooses another mode. Delivered-period questions use deep-dive synthesis even when the period is only a day or week.

- Source timeout: 8 seconds.
- Total application budget: 12 seconds.
- Acceptance latency target: 15 seconds.
- Format: explicit Delivery brief and Evidence sections, with an Action section only when supported.
- Each bounded query operation may return up to 15 records so requested report fields are not displaced by the fast-answer cap.

## Deep dive

Deep-dive, comprehensive, investigation, root-cause, history, trend, and delivered-period wording selects deep-dive mode.

- Source safety timeout: 90 seconds.
- Composition safety timeout: 120 seconds.
- Total safety budget: 240 seconds.
- No latency acceptance target or fixed line/item presentation cap.
- Format: the structure required by the question and evidence. Ordinary investigations retain explicit scope, sources, evidence, gaps, and inference boundaries.
- Each bounded query operation may return up to 50 records. Exhaustive period-census retrieval is configured separately and cannot silently collapse into the fast format.

Period-report products use model composition over the reconstructed change capsules plus retrieved project context. The deterministic renderer remains the fallback when composition is unavailable or invalid.

### Sub-30-day delivery reports

Questions about delivery yesterday, last week, this week, or during a requested lookback such as the last 30 days use the same synthesis path as longer leadership reports.

- The period is resolved in workspace-local calendar time; “yesterday” is the preceding closed calendar day, not a rolling 24-hour approximation.
- Jira and Git evidence establish the delivered-change census. Teams observations and indexed Vault or repository knowledge enrich the business rationale, decisions, launch context, and outcomes without being misclassified as completion proof.
- After the change census is grouped by capability, Sarathi performs capability-specific knowledge retrieval using the reconstructed initiative titles. This second pass makes project ontology and master context available even when the original question contains only a generic phrase such as “last 30 days.”
- The delivery-manager composition has no fast-answer line limit, forced numbered action, or 10-second acceptance target. It consolidates related records into an executive summary, capability narrative, outcomes and business context, and explicit gaps.
- Report claims may cite only records in the supplied authorized envelope. Missing measured outcomes remain unknown instead of being inferred from technical activity.

### Leadership period reports

Questions such as “what did we deliver in the previous quarter?” are deep-dive leadership reports, not fast status answers. They require an exhaustive authorized period census and a configured capability ledger before retrieval starts.

- The report is organized into numbered capability themes with descriptive initiative bullets, delivery stage, and source citations.
- Relevant initiatives are not reduced to a fixed top-three list. Rendering uses only the Microsoft Teams platform-size ceiling.
- Incomplete census or unavailable-source conditions make the result partial and must be stated in the report. Unmapped corpus records are disclosed as a coverage gap but do not suppress source-supported capability sections; governed reconstruction recall decides whether the resulting report is fit for acceptance.
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
