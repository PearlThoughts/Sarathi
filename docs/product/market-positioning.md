# Market Positioning

This note explains how Sarathi compares to nearby AI work products and what it is trying to own. It is intentionally community-safe: competitors are described by their public product shape, and Sarathi's claims are framed as design intent until the implementation catches up.

## Positioning Sentence

Sarathi is an open-source, self-hosted AI Delivery Assistant for software teams that helps a PM or delivery manager keep work aligned, followed up, and explainable across Teams, Jira, GitHub, docs, and coding agents.

The wedge is not generic search or generic task delegation. The wedge is delivery coordination under PM supervision:

- capture project intent and delivery rhythm,
- answer team process questions from ratified knowledge,
- chase missing updates and evidence without spending PM time,
- surface drift, blockers, risks, and weak handoffs,
- draft PM-reviewed weekly or monthly status,
- preserve delivery memory as readable policy files,
- later, give coding agents the same delivery context developers already shared in Teams, Jira, PRs, docs, and email.

## What Exists Nearby

### Claude Tag And Chat-Native AI Teammates

[Claude Tag](https://www.anthropic.com/news/introducing-claude-tag) is the closest user-experience reference: a simple `@Claude` style teammate in shared conversations. Its public materials describe task delegation from Slack, connected tools, and ambient behavior that can follow up on quiet threads or unresolved work.

That simplicity is valuable. Sarathi should learn from it.

Sarathi's intended difference is not "chat bot versus chat bot." Sarathi is designed around delivery operations:

- customer-managed evidence and policy plane rather than a single vendor's assistant runtime,
- Teams/Jira/GitHub as the first operating surface for software delivery teams,
- PM-ratified project intent, process FAQ, escalation rules, and learned preferences,
- per-workspace boundaries for client/project/team isolation,
- source links and receipts on substantive answers,
- configurable model egress, including BYOM or local/in-tenant models where practical,
- delivery loops that ask, chase, escalate, and report under PM oversight.

Claude Tag validates the shared-channel interaction pattern. Sarathi's bet is that delivery teams also need an inspectable operating layer behind the mention.

This is a product-shape critique, not a claim that Claude lacks serious admin or security controls. The difference Sarathi is aiming for is customer-managed delivery memory, workspace policy, and model-egress choice as the foundation of the product.

### Claude Code, Codex, OpenCode, And Coding Agents

[Claude Code](https://claude.com/product/claude-code), Codex, OpenCode, and similar tools are execution agents. They read code, edit files, run commands, and can use MCP tools.

Sarathi should not compete with them as a coder. It should become a delivery-context plane for them:

- a terminal agent asks Sarathi for current project intent, open decisions, owners, risks, and relevant Teams/Jira/GitHub history;
- Sarathi filters that context through the developer's identity and workspace boundary;
- the coding agent reports useful work signals back, such as "tests failed repeatedly," "blocked on credentials," or "PR opened for SAR-42";
- the PM sees better delivery telemetry without asking the developer to re-explain every session.

The current assumption is terminal-based agents run by humans. The same contract can later support cloud coding agents, as long as identity, source boundaries, model egress, prompt-injection defenses, and session disclosure are explicit.

### Glean, Copilot, And Enterprise AI Assistants

[Glean](https://www.glean.com/) and Microsoft Copilot are stronger incumbents for enterprise search, assistant workflows, permissions, connectors, and general workplace AI. Glean's public materials emphasize enterprise-grade security, permission-aware answers, connected knowledge, agents, and context across systems. Microsoft also offers Copilot connectors, including synced and federated patterns for external data.

If a team mainly wants "ask any company question," Sarathi should not position itself against those platforms.

Sarathi's intended difference is narrower:

- small-team self-hosting instead of enterprise platform rollout,
- delivery-specific ontology instead of generic company knowledge,
- PM-guided loops rather than only pull-based lookup,
- readable policy repo for project intent and learned delivery protocol,
- client/project/workspace isolation as a product primitive,
- coding-agent bridge that is independent of one assistant vendor.

### Atlassian Rovo And Linear Agents

[Rovo Agents](https://support.atlassian.com/rovo/docs/agents/) and [Linear Agent](https://linear.app/docs/linear-agent) are strong platform-native work agents. They understand the platform they live in, can answer questions, update work items, and help move work forward inside Jira/Confluence or Linear.

Sarathi should not out-platform Jira or Linear. Its intended difference is cross-surface delivery assistance:

- Teams conversations are first-class delivery evidence, not only comments mirrored into a tracker;
- Jira, GitHub, docs, and future helpdesk/CRM data can be bound into one workspace;
- the PM can codify local delivery behavior that may not match any one tool's hierarchy;
- services teams can isolate client workspaces even when the same humans work across clients;
- the same context can serve both the team channel and the coding agent at the terminal.

### Productboard, Jira Product Discovery, And Product-Management AI

[Productboard](https://www.productboard.com/) and Jira Product Discovery focus on product strategy, feedback, discovery, roadmaps, and prioritization. Their AI features help summarize feedback, brainstorm ideas, and improve product documents.

Sarathi is adjacent but different. It starts after there is work to deliver:

- Are the team, tickets, PRs, risks, and status aligned with the PM-approved plan?
- Are interns and engineers blocked on process questions?
- Did "done" include QA, deployment, and evidence?
- What drift should the PM see before the review meeting?

Sarathi may read roadmap or product intent as an input, but it is not primarily a product-discovery tool.

### Plandek, LinearB, Jellyfish, And Delivery Analytics

Delivery-intelligence products help leaders measure flow, engineering productivity, DORA-style metrics, delivery risk, and forecast trends. [Plandek](https://plandek.com/) publicly describes an AI delivery assistant and engineering/productivity analytics. [LinearB](https://linearb.io/) and [Jellyfish](https://jellyfish.co/) position around engineering intelligence and AI-era engineering productivity.

Sarathi should respect this category. Dashboards and analytics are useful.

Sarathi's product thesis is more operational and channel-native:

- not only "show the metric," but "ask for the missing update";
- not only "detect the risk," but "route the next question to the PM or owner";
- not only "report status," but "draft the PM-approved message where the team already works";
- not only "measure engineering," but "teach the local definition of done and process FAQ."

### Standup Bots And Async Update Tools

[Geekbot](https://geekbot.com/), [DailyBot](https://www.dailybot.com/), [Standuply](https://standuply.com/), and similar tools automate recurring updates in Slack or Teams. Some now add AI summaries, blocker detection, and workflow automation.

Sarathi overlaps on status collection, but the intended center is different:

- observe Jira/GitHub/CI evidence before asking humans,
- ask specific delivery questions instead of generic "what did you do?",
- preserve PM-approved answers and rules in a readable policy repo,
- escalate unresolved delivery loops deterministically,
- serve team FAQ, PM reports, and coding-agent context from the same workspace.

### AI SRE Products

AI SRE products such as [Resolve AI](https://resolve.ai/product/ai-sre), [Cleric](https://cleric.ai/), [Datadog Bits AI SRE](https://www.datadoghq.com/product/ai/bits-investigation/), and [incident.io's AI SRE writing](https://incident.io/blog/what-is-ai-sre-complete-guide-2026) show a useful pattern: the agent investigates live signals, forms hypotheses, links conclusions to evidence, recommends action, and keeps humans in the decision loop.

That category is a good analogy, not a direct competitor.

AI SRE works because infrastructure emits telemetry automatically. Delivery coordination is harder because human collaboration emits messy, incomplete signals across chat, tickets, code, docs, meetings, and memory. Sarathi applies a similar loop to the socio-technical system:

- sense work signals,
- identify missing context,
- ask or chase where needed,
- draft the delivery conclusion,
- let a human PM ratify,
- remember the approved rule or outcome.

This also exposes a critique of Sarathi: delivery management is less standardized than SRE. Sarathi must adapt through workspaces, policy files, team profiles, and PM mentoring rather than assuming one universal process.

## Sarathi's Unique Bet

Sarathi is worth building only if these bets hold:

1. Small software teams will self-host an agent if it saves PM coordination time.
2. Delivery managers need an assistant more than they need another dashboard.
3. Team process knowledge should be readable, versioned, and ratified instead of hidden in opaque model memory.
4. Work context should stay in the customer's chosen systems where possible; Sarathi should store only the configured evidence/cache/policy it needs.
5. Model calls should be configurable and visible, not silently tied to one provider.
6. Proactive help can be useful without becoming invasive when it is scoped, disclosed, PM-guided, and evidence-linked.
7. Coding agents become more useful when they inherit rich delivery context instead of asking developers to paste the same Teams/Jira/PR history every session.

## The Coding-Agent Bridge Thesis

Sarathi's future MCP or agent-bridge surface should make delivery context portable to coding agents:

- `get_work_context(issue_or_branch)` returns PM-approved intent, relevant decisions, current risks, owners, and source links.
- `current_intent(workspace)` returns the ratified project mission, milestone, budget or delivery target when configured.
- `search_delivery_memory(query)` searches policy, decisions, retros, and scoped evidence.
- `report_work_event(event)` lets coding agents deposit useful session signals back into the evidence plane.

The bridge should start with human-run terminal agents. Later it can support cloud coding runs if the deployment has stronger controls for service identity, audit, code access, prompt injection, and disclosure.

Session instrumentation is powerful but sensitive. Sarathi should instrument work state, not hidden people scoring:

- good: repeated test failure, blocked dependency, missing credential, unlinked PR, drift from milestone;
- not good: private productivity ranking, covert sentiment scoring, or silent surveillance.

The product rule is simple: Sarathi helps colleagues and PMs see delivery reality earlier; it does not become a hidden performance monitor.

## Critiques And Risks

### The Product Can Become Too Broad

"AI Delivery Assistant" touches status, chase, FAQ, coaching, risks, retros, budget, and coding agents. That can become a feature factory.

The guardrail is PM-supervised delivery coordination. A feature belongs only if it helps a PM or delivery manager keep the team aligned, followed up, and able to deliver.

### Proactive Can Become Annoying

Proactive help is useful only when it is earned:

- answer FAQ first,
- observe before asking,
- chase only on PM-approved rules,
- prefer DMs for sensitive nudges,
- post in channels when the outcome belongs to the group,
- show the source or reason for every substantive prompt.

### Self-Hosted Does Not Eliminate Risk

Self-hosting keeps more control with the customer, but it does not make data risk disappear. Sarathi still needs:

- least-privilege source access,
- clear workspace boundaries,
- model-egress configuration,
- audit logs and receipts,
- prompt-injection defenses,
- visible data-use policy for the team.

### Delivery Process Is Not Universal

SRE has more common operational patterns than delivery management. Sarathi must avoid pretending every org uses the same rituals. The onboarding loop should infer a draft from Jira, Teams, GitHub, docs, and history, then ask the PM to correct and ratify it.

## Sources Checked

Research date: 2026-07-06.

Primary and near-primary sources reviewed:

- [Anthropic: Introducing Claude Tag](https://www.anthropic.com/news/introducing-claude-tag)
- [Claude Code product page](https://claude.com/product/claude-code)
- [Claude Code memory documentation](https://code.claude.com/docs/en/memory)
- [Model Context Protocol introduction](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Glean homepage](https://www.glean.com/)
- [Glean Agent Development Lifecycle press release](https://www.glean.com/press/glean-introduces-the-enterprise-agent-development-lifecycle-codifying-how-enterprises-build-govern-and-measure-ai-agents)
- [Microsoft Copilot connector overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-copilot-connector)
- [Atlassian Rovo Agents](https://support.atlassian.com/rovo/docs/agents/)
- [Rovo in Jira AI](https://www.atlassian.com/software/jira/ai)
- [Linear Agent](https://linear.app/docs/linear-agent)
- [Linear Agents in Linear](https://linear.app/docs/agents-in-linear)
- [Productboard](https://www.productboard.com/)
- [Productboard AI for product management](https://www.productboard.com/product/ai-for-product-management/)
- [Jira Product Discovery AI docs](https://support.atlassian.com/jira-product-discovery/docs/explore-atlassian-intelligence-in-jira-product-discovery/)
- [Plandek](https://plandek.com/)
- [LinearB](https://linearb.io/)
- [Jellyfish](https://jellyfish.co/)
- [Geekbot](https://geekbot.com/)
- [DailyBot](https://www.dailybot.com/)
- [Standuply](https://standuply.com/)
- [Resolve AI SRE](https://resolve.ai/product/ai-sre)
- [Cleric](https://cleric.ai/)
- [Datadog Bits AI SRE / Investigation](https://www.datadoghq.com/product/ai/bits-investigation/)
- [Datadog Bits AI SRE engineering write-up](https://www.datadoghq.com/blog/bits-ai-sre-deeper-reasoning/)
- [incident.io: What is AI SRE?](https://incident.io/blog/what-is-ai-sre-complete-guide-2026)
- [Surfing Complexity: Lots of AI SRE, no AI incident management](https://surfingcomplexity.blog/2026/02/14/lots-of-ai-sre-no-ai-incident-management/)
