# Feature Specification: Compliance Reminders Contract

**Branch**: `feat/sarathi-compliance-contract`
**Created**: 2026-07-11

## Purpose

Add a public, reusable Sarathi capability for workspace-scoped compliance reminders. The capability defines scheduling intent, dry-run planning, delivery idempotency, durable audit, and retry contracts without knowing an organization's source selector, targets, schedules, or templates.

## Requirements

- Reminder plans MUST be bound to one workspace and reject a mismatched source item.
- Dry runs MUST return a plan without writing audit or delivery state.
- The audit adapter MUST atomically reserve an idempotency key; a repeated reservation MUST suppress duplicate delivery.
- A failed delivery MUST create an auditable retryable result without losing the planned digest.
- Source, delivery, and audit adapters MUST be ports; no provider SDK or configuration value may enter the domain/application layer.

## Non-Goals

- Finance source mappings, Jira queries, Teams recipients, schedule values, message templates, cron setup, or deployment changes.
- Any source-system write other than the future authorized reminder delivery adapter.

## Success Criteria

- Deterministic unit tests cover dry run, workspace isolation, duplicate suppression, successful delivery audit, and retryable failure.
- `bun run check` and the public privacy scan pass without organization-specific data.
