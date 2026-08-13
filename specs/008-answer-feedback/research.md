# Research: Response-Level Human Feedback

## Microsoft Teams Action Contract

The installed `@microsoft/agents-hosting` 1.6.1 package exposes `AgentApplication.adaptiveCards.actionExecute`. Microsoft documents `Action.Execute` as an invoke route whose handler may return a replacement Adaptive Card. This satisfies the quiet confirmation requirement without posting another channel activity.

`Action.ShowCard` remains client-side progressive disclosure for the partial and negative forms. Their nested submit action uses `Action.Execute` with `associatedInputs: auto` so the server receives selected reasons and correction text only after Submit.

References:

- [AgentApplication](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/agent-application)
- [AdaptiveCardsActions](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/agents-hosting/adaptivecardsactions)
- [Universal Action Model](https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model)

## Boundary Alternatives

Embedding ratings in the Teams adapter was rejected because it would make a transport own domain semantics and prevent reuse by other channels. Embedding revisions in the governed delivery-evaluation runner was rejected because ordinary product feedback must not become the 1-5 acceptance rubric. A standalone datastore was rejected because Sarathi already owns PostgreSQL, Drizzle, migration, lifecycle, and operator patterns.

The selected design is a public `answer-feedback` bounded context implemented by PostgreSQL and presented through Teams. Delivery intelligence contributes query-family metadata but does not own feedback state.
