# Organization Installation And Activation

This guide explains how an organization can introduce Sarathi as a controlled internal pilot, connect configured work systems, install the Microsoft Teams app, and promote capabilities only after real acceptance.

Sarathi is not yet a one-click marketplace installation. Activation currently requires an organizational sponsor, a technical operator, and a Microsoft 365 or Teams administrator.

## 1. Define The Pilot Before Installing Software

Choose:

- one accountable business or delivery sponsor;
- one project, product, client engagement, or operating unit;
- one painful coordination problem to improve;
- the people allowed to review Sarathi's findings;
- the sources Sarathi may read;
- what a successful four-week pilot would change.

Good first pilots include source-linked Teams questions, a weekly delivery health review, or a narrow reminder workflow. Avoid beginning with organization-wide monitoring.

## 2. Decide The Trust Boundary

One Sarathi deployment serves one organization. Inside it, each workspace is an isolated boundary for goals, verification, people, actions, and reports.

Document before activation:

- configured Microsoft Teams teams and standard channels;
- configured Jira projects or filters;
- configured GitHub repositories;
- configured policy or documentation files;
- actor identities and access levels;
- the highest sensitivity allowed in each destination;
- whether model processing is allowed for that workspace;
- retention, correction, disable, and rollback expectations.

Do not enable private or shared Teams channels until their access behavior has its own acceptance test.

## 3. Prepare The Public Runtime And Private Overlay

Clone and verify the public runtime:

```bash
git clone https://github.com/PearlThoughts/Sarathi.git
cd Sarathi
bun install
bun run check
```

Create a separate private repository or approved configuration store for real organization data. Keep workspace IDs, Teams mappings, Jira selectors, repository allowlists, recipients, schedules, templates, and promotion decisions there.

Do not put credentials, raw messages, database files, embeddings, or private generated reports in either Git repository. See [Private Workspace Packs](implementation/private-workspace-packs.md) and [Public And Private Boundary](implementation/public-private-boundary.md).

## 4. Provision The Hosted Environment

Sarathi's hosted Teams path needs:

- a Node 22-compatible application host;
- a Postgres database;
- HTTPS for the public Bot endpoint;
- an approved secret manager;
- health and readiness monitoring;
- a deployment rollback path.

Railway is the current reference host, but the runtime is not intended to depend on one hosting vendor.

Configure the service to run:

```bash
bun run teams:ingress
```

The service exposes:

- `POST /api/messages` for authenticated Microsoft Bot traffic;
- `GET /health` for process liveness;
- `GET /ready` for dependency and capability readiness;
- `POST /internal/finance/reminders/dry-run` for authenticated operator previews.

## 5. Register The Microsoft Application

In the organization's Microsoft tenant:

1. Register or approve an Entra application for Sarathi.
2. Create or bind an Azure Bot resource to that application.
3. Configure the messaging endpoint as `https://<api-host>/api/messages`.
4. Enable the Microsoft Teams channel.
5. Record the tenant ID, application ID, and client credential in the secret manager.
6. Review the requested team-scoped permission with the Teams administrator.

The initial Teams package requests `ChannelMessage.Read.Group` resource-specific consent so Sarathi can read the configured team's channel context. Grant only the permissions required for the selected pilot.

## 6. Prepare And Validate The Teams Package

The repository's `appPackage/manifest.json` is a reference package and currently contains project-specific application and domain values. Before installing it in another organization, replace:

- the Bot/application ID;
- developer, privacy, and terms URLs;
- valid domains;
- icons or branding when required.

Validate the package:

```bash
bun run teams:manifest:validate
```

Package the manifest and icons, upload the package through the Teams admin-approved process, grant the requested resource-specific consent, and install Sarathi only in the selected pilot team.

## 7. Connect Work Systems

Store secret values in the hosting platform. The current hosted Teams composition uses these configuration groups:

### Microsoft and Teams

- `MICROSOFT_APP_ID`
- `MICROSOFT_APP_PASSWORD`
- `MICROSOFT_APP_TENANT_ID`
- `SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON`

### Runtime state

- `SARATHI_STRATEGY_DATABASE_URL`

### Jira

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

### Connected delivery sources

- `GITHUB_TOKEN`
- `SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON` (optional exact repositories)
- `SARATHI_GITHUB_REPOSITORY_SCOPES_JSON` (bounded owner and repository-name scopes)
- `SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON`
- `SARATHI_KNOWLEDGE_VAULT_SOURCE_ID`
- `SARATHI_KNOWLEDGE_VAULT_ROOTS_JSON`
- `SARATHI_TEAMS_DELIVERY_CHANNELS_JSON` (optional explicit 1–32 channel allowlist; each entry declares `graphTeamId`, `channelId`, `workspaceId`, `scope`, and `sensitivity`; current ingress mappings remain the fallback)
- `SARATHI_PROJECT_MAIL_SCOPES_JSON` (empty until a project-mail boundary is configured)

### Delivery intelligence

- `SARATHI_KNOWLEDGE_ENABLED`
- `SARATHI_KNOWLEDGE_WORKSPACE_ID`
- `SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON`
- `SARATHI_WORKSPACE_TIMEZONE`
- `SARATHI_EMBEDDING_PROVIDER` (`openrouter`)
- `SARATHI_EMBEDDING_MODEL`
- `SARATHI_EMBEDDING_API_KEY`

### AI model

Configure OpenRouter as Sarathi's sole model and embedding provider. Sarathi uses
the Vercel AI SDK provider abstraction in process and fails closed for every
other provider value.

- `SARATHI_MODEL_PROVIDER` (`openrouter`)
- `SARATHI_MODEL_API_KEY`
- `SARATHI_MODEL_NAME`
- optional `SARATHI_MODEL_BASE_URL`
- optional `SARATHI_MODEL_TIMEOUT_MS`

No fallback provider is configured. Provider diagnostics contain only the
OpenRouter provider name and outcome; prompts, answers, identifiers, and
credentials are excluded. SDK-internal retries remain disabled so the runtime
stays inside the Teams response budget.

The workspace projection must map only configured standard channels and known actors. The repository fails closed when required mappings or credentials are unavailable.

Additional reminder configuration is needed only when that capability is part of the pilot. Keep it disabled otherwise.

## 8. Verify Before Inviting The Team

Confirm:

1. The intended merged version is deployed.
2. `/health` returns success.
3. `/ready` returns success for the enabled capability.
4. Unmapped channels and users are denied.
5. Finance, restricted, or cross-workspace data cannot appear.
6. Logs contain no source content or credentials.
7. Duplicate message delivery does not produce duplicate answers.
8. The disable and rollback paths work.

Run the repository verification commands as applicable:

```bash
bun run check
bun run runtime:health
bun run runtime:smoke
```

## 9. Start In Shadow Mode

Before proactive messages or broad team use:

- review proposed findings privately with the sponsor;
- correct workspace boundaries and source mappings;
- record false positives and missing validation;
- agree which actions Sarathi may request;
- explain to pilot participants what is and is not tracked;
- keep human review for external/customer-visible outputs and mutating actions; internal delivery reports do not require per-report approval.

For proactive capabilities, use the progression `disabled -> shadow -> live`. Adding a mapping or credential must not silently activate delivery.

## 10. Run A Real Acceptance Test

For a Teams delivery-assistant pilot, acceptance should include:

- a mapped workspace member mentions `@Sarathi` in a configured standard channel;
- Sarathi resolves the correct workspace, person, channel, and thread;
- the answer uses only connected, authorized workspace context;
- citation links are valid;
- the response appears in the originating conversation;
- duplicate delivery does not produce another answer;
- restricted and cross-workspace verification remain excluded;
- the pilot sponsor accepts or corrects the result.

For a reminder pilot, first approve a dry-run preview, then perform one controlled delivery and verify idempotency, audit, retry, disable, and rollback behavior.

## 11. Expand Deliberately

After the first pilot proves value:

- add one workspace or capability at a time;
- keep raw source data isolated;
- share only explicitly configured policies, templates, or portfolio summaries across workspaces;
- measure coordination time saved, drift closure time, source-backed completion, and stakeholder surprises;
- periodically review whether Sarathi is helping decisions or merely creating more notifications.

## Current Limitation

Sarathi provides production-shaped components, not a turnkey enterprise installer. Tenant registration, private configuration, consent, hosting, observability, and real acceptance remain operator responsibilities. Do not describe a deployment as production-ready solely because the service is reachable.
