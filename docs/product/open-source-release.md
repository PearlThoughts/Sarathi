# Open Source Release Model

Sarathi is intended to be open source and self-hostable. The goal is to earn useful critique before the implementation hardens, while keeping the product direction inspectable by delivery managers, software services teams, and AI-agent builders.

## License

Sarathi uses the [Apache License 2.0](../../LICENSE).

Apache-2.0 is a permissive open-source license. It allows use, modification, redistribution, commercial use, and hosted services, subject to its notice and license-preservation requirements. It also includes an explicit patent grant, which is useful for enterprise and vendor-review contexts.

This is not legal advice. Organizations should review the license with their own counsel before using Sarathi in production or offering commercial services around it.

## Why Apache-2.0

Sarathi's target users are teams that may self-host inside their own cloud or network. They need a license that is easy to scan, easy to approve, and compatible with commercial use.

Apache-2.0 fits the current intent:

- permissive enough for community adoption,
- familiar to enterprise compliance scanners,
- clearer than MIT on patent grants,
- compatible with future paid hosting, support, templates, and enterprise modules,
- simple enough for an early work-in-progress project.

Apache-2.0 does not prevent another person or company from hosting a fork. That is a deliberate tradeoff. Sarathi should build trust through openness, product judgment, deployment quality, docs, community, and optional commercial services, not through hiding the core idea.

## Can Others Host It?

Yes. A permissive license means another person or organization can run Sarathi, modify it, and provide hosting or consulting services around it, as long as they comply with the license.

The business defense should come from:

- the Sarathi name and reputation,
- official docs and examples,
- quality of hosted operations,
- support and implementation expertise,
- enterprise connectors and compliance packaging,
- delivery playbooks and templates,
- managed upgrades and migrations,
- trust from building the project in public.

If hosted-fork risk becomes material later, the project can still keep the core Apache-2.0 and add separate paid modules or services around it. That is a product-packaging decision, not a reason to overcomplicate the first license.

## Commercial Model

The likely commercial path is open core plus services:

- free self-hosted core,
- paid managed cloud,
- paid enterprise support,
- paid implementation and migration help,
- paid compliance/audit packaging,
- paid advanced connectors,
- paid organization templates and delivery playbooks,
- paid multi-workspace administration when the product grows beyond small teams.

For Sarathi, commercial value should not come from locking the team out of its own delivery memory. The core trust story is that project intent, policy, and learned delivery protocol remain inspectable and portable.

## YC And Open-Source SaaS Patterns

Recent YC-backed or YC-adjacent open-source SaaS companies do not all choose Apache-2.0.

Common patterns:

- **Apache-2.0 core:** Supabase, Trigger.dev, Medplum, and Firezone use Apache-2.0 or Apache-heavy licensing for their open-source core.
- **MIT core with enterprise folders or commercial licensing:** PostHog, Infisical, Langfuse, and Activepieces use permissive MIT-style core licensing while reserving some enterprise code or packages separately.
- **AGPL or mixed licensing:** Some open-source commercial products use AGPL or mixed licenses when they want stronger hosted-fork pressure.

The lesson is not "all serious open-source SaaS uses Apache." The lesson is narrower:

- permissive licensing is normal for open-source SaaS,
- Apache-2.0 is credible and enterprise-friendly,
- MIT plus separate enterprise modules is also common,
- license choice alone does not create a business,
- the business comes from cloud hosting, support, trust, distribution, operations, and product judgment.

## Public Release Checklist

Before making the repository public, the owner should verify:

- Apache-2.0 license file is present.
- `package.json` declares `Apache-2.0`.
- README explains that Sarathi is work in progress.
- Docs explain why, what, how, roles, market positioning, and roadmap.
- Secret scans pass on current files and git history.
- No private customer, employee, internal incident, credential, or proprietary client data is committed.
- GitHub secret scanning and push protection are enabled after public release where available.

Repository visibility is an owner decision. Agents should prepare and verify readiness, then ask the owner to change visibility manually in GitHub.

## Sources

- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [GitHub Docs: Licensing a repository](https://docs.github.com/articles/licensing-a-repository)
- [Supabase license](https://github.com/supabase/supabase/blob/master/LICENSE)
- [Trigger.dev homepage](https://trigger.dev/)
- [Medplum YC OSS FAQ](https://www.medplum.com/blog/yc-oss-faq)
- [Medplum GitHub repository](https://github.com/medplum/medplum)
- [Firezone GitHub repository](https://github.com/firezone/firezone)
- [PostHog GitHub repository](https://github.com/posthog/posthog)
- [Infisical license](https://github.com/Infisical/infisical/blob/main/LICENSE)
- [Langfuse open-source handbook](https://langfuse.com/handbook/chapters/open-source)
- [Langfuse story: Doubling Down on Open Source](https://langfuse.com/handbook/chapters/story)
- [Activepieces GitHub repository](https://github.com/activepieces/activepieces)
