import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import {
  type DeliveryAssistant,
  deliveryTransportTimeoutMs,
  planDeliveryQuestion,
  selectDeliveryResponseProduct,
} from "../../delivery-intelligence/index.ts";
import {
  type TeamsMentionCommand,
  type TeamsMentionOutcome,
  teamsConversationRootActivityId,
  teamsConversationScopeId,
} from "../domain/teams-mention.ts";
import type {
  GroundedAnswerGenerator,
  TeamsMentionAudit,
  TeamsMentionAuthorizer,
  TeamsMentionContextAssembler,
  TeamsMentionDelivery,
  TeamsMentionResolver,
} from "../ports/teams-mention-ports.ts";

export type TeamsMentionDependencies = {
  readonly resolver: TeamsMentionResolver;
  readonly authorizer: TeamsMentionAuthorizer;
  readonly contextAssembler: TeamsMentionContextAssembler;
  readonly answerGenerator: GroundedAnswerGenerator;
  readonly delivery: TeamsMentionDelivery;
  readonly audit: TeamsMentionAudit;
  readonly helloDiagnosticEnabled?: boolean;
  readonly deliveryAssistant?: DeliveryAssistant | undefined;
  readonly deliveryTimeZone?: string | undefined;
  readonly deliveryAnswerTimeoutMs?: number | undefined;
  readonly deliveryFinanceActorIds?: ReadonlySet<string> | undefined;
};

const isHelloDiagnostic = (question: string): boolean => question.trim().toLowerCase() === "hello";

export const handleTeamsMention = (
  command: TeamsMentionCommand | undefined,
  dependencies: TeamsMentionDependencies,
): Effect.Effect<TeamsMentionOutcome, never> => {
  if (command === undefined || command.question === "") {
    return Effect.succeed({ kind: "ignored", reason: "not-a-direct-mention" });
  }

  return Effect.gen(function* () {
    const lease = yield* dependencies.audit
      .acquireLease(command.activityId)
      .pipe(Effect.orElseSucceed(() => ({ kind: "in-progress" }) as const));
    if (lease.kind !== "acquired") return { kind: "ignored", reason: "duplicate" } as const;
    const renewLease = () =>
      dependencies.audit
        .renewLease(command.activityId, lease.attempt)
        .pipe(Effect.orElseSucceed(() => false));
    const markFailed = (
      state: "failed-retryable" | "failed-terminal",
      workspaceId?: string | undefined,
    ) =>
      dependencies.audit
        .markFailed(command.activityId, state, lease.attempt, workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
    const markDelivered = (workspaceId: string) =>
      dependencies.audit
        .markDelivered(command.activityId, workspaceId, lease.attempt)
        .pipe(Effect.orElseSucceed(() => undefined));

    const resolvedResult = yield* Effect.either(dependencies.resolver.resolve(command));
    if (resolvedResult._tag === "Left") {
      yield* markFailed("failed-retryable");
      return {
        kind: "denied",
        reason: "Sarathi cannot resolve the connected workspace right now.",
      } as const;
    }
    const resolved = resolvedResult.right;
    if (resolved === undefined) {
      yield* markFailed("failed-terminal");
      return {
        kind: "denied",
        reason: "Sarathi is not available for this caller or channel.",
      } as const;
    }

    const deliveryAssistant = dependencies.deliveryAssistant;
    const deliveryTimeZone = dependencies.deliveryTimeZone;
    const deliveryQuestionPlan =
      deliveryAssistant === undefined || deliveryTimeZone === undefined
        ? undefined
        : planDeliveryQuestion(command.question);
    const responseProduct = selectDeliveryResponseProduct(command.question);
    const authorizationResult = yield* Effect.either(
      dependencies.authorizer.authorizeContext(command, resolved),
    );
    if (authorizationResult._tag === "Left") {
      yield* markFailed("failed-retryable", resolved.workspaceId);
      return { kind: "denied", reason: "Sarathi cannot evaluate access right now." } as const;
    }
    const authorization = authorizationResult.right;
    if (!authorization.allowed) {
      yield* markFailed("failed-terminal", resolved.workspaceId);
      return { kind: "denied", reason: "Sarathi cannot use this thread's context." } as const;
    }

    if (isHelloDiagnostic(command.question)) {
      if (dependencies.helloDiagnosticEnabled !== true) {
        yield* markFailed("failed-terminal", resolved.workspaceId);
        return { kind: "denied", reason: "Sarathi diagnostics are not enabled here." } as const;
      }
      const answer = {
        text: "Hello from Sarathi.",
        citations: [],
        unavailableSources: [],
      } as const;
      if (!(yield* renewLease())) return { kind: "ignored", reason: "duplicate" } as const;
      const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
      if (deliveryResult._tag === "Left") {
        yield* markFailed("failed-retryable", resolved.workspaceId);
        return {
          kind: "denied",
          reason: "Sarathi could not deliver the response; retry safely.",
        } as const;
      }
      yield* markDelivered(resolved.workspaceId);
      return { kind: "answered", answer } as const;
    }

    const financeAccess = dependencies.deliveryFinanceActorIds?.has(resolved.callerId) === true;
    const deliveryConfiguration =
      deliveryAssistant === undefined || deliveryTimeZone === undefined
        ? undefined
        : { assistant: deliveryAssistant, timeZone: deliveryTimeZone };
    if (deliveryQuestionPlan !== undefined && deliveryConfiguration === undefined) {
      yield* markFailed("failed-terminal", resolved.workspaceId);
      return {
        kind: "denied",
        reason: "Sarathi's delivery intelligence is not configured here.",
      } as const;
    }
    if (deliveryQuestionPlan?.requiresFinance === true) {
      if (!financeAccess) {
        yield* markFailed("failed-terminal", resolved.workspaceId);
        return {
          kind: "denied",
          reason: "Finance delivery information is confidential.",
        } as const;
      }
    }

    const topLevelDeliveryQuestion =
      deliveryQuestionPlan !== undefined &&
      teamsConversationRootActivityId(command) === command.activityId;
    const envelopeResult = yield* Effect.either(
      topLevelDeliveryQuestion
        ? Effect.succeed({
            workspaceId: resolved.workspaceId,
            question: command.question,
            evidence: [],
          })
        : dependencies.contextAssembler.assemble(command, resolved),
    );
    if (envelopeResult._tag === "Left") {
      yield* markFailed("failed-retryable", resolved.workspaceId);
      return {
        kind: "denied",
        reason: "Sarathi cannot retrieve the connected context right now.",
      } as const;
    }

    if (deliveryQuestionPlan !== undefined && deliveryConfiguration !== undefined) {
      if (!(yield* renewLease())) return { kind: "ignored", reason: "duplicate" } as const;
      const envelope = envelopeResult.right;
      const boundedCorpus =
        resolved.authorization.effectiveAudience.membership.source === "microsoft_graph_roster"
          ? {
              audienceIds: resolved.authorization.permittedAudienceIds,
              permittedSourceScopes: resolved.authorization.permittedSourceScopes.filter(
                (scope) => scope !== "legacy_workspace",
              ),
            }
          : {};
      const reportResult = yield* Effect.either(
        deliveryConfiguration.assistant
          .answer({
            workspaceId: resolved.workspaceId,
            actorId: resolved.callerId,
            maximumSensitivity: resolved.channelSensitivity,
            financeAccess,
            requestedAt: command.receivedAt,
            timeZone: deliveryConfiguration.timeZone,
            question: command.question,
            ...boundedCorpus,
            plan: deliveryQuestionPlan,
            responseProduct,
            questionContext: {
              channelId: teamsConversationScopeId(command.conversation),
              conversationId: command.replyTarget.conversationId,
              rootMessageId: teamsConversationRootActivityId(command),
              currentMessageId: command.activityId,
              evidence: envelope.evidence
                .filter((record) => record.contextRole === "conversation")
                .map((record) => ({
                  source: record.source,
                  sourceId: record.sourceId,
                  citationUrl: record.sourceUrl,
                  title: record.title,
                  excerpt: record.excerpt,
                  observedAt: record.occurredAt,
                  contextRole: "conversation" as const,
                })),
            },
          })
          .pipe(
            Effect.timeoutFail({
              duration: Math.max(
                100,
                deliveryTransportTimeoutMs(responseProduct, dependencies.deliveryAnswerTimeoutMs),
              ),
              onTimeout: () =>
                new RepositoryError({
                  message: "Delivery answer exceeded its response budget.",
                  operation: "teams-delivery-answer",
                }),
            }),
          ),
      );
      if (reportResult._tag === "Left") {
        yield* markFailed("failed-retryable", resolved.workspaceId);
        return {
          kind: "denied",
          reason:
            responseProduct === "operational_answer"
              ? "Sarathi could not answer this delivery question within 10 seconds."
              : "Sarathi could not complete this report within its declared response budget.",
        } as const;
      }
      const answer = reportResult.right;
      if (!(yield* renewLease())) return { kind: "ignored", reason: "duplicate" } as const;
      const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
      if (deliveryResult._tag === "Left") {
        yield* markFailed("failed-retryable", resolved.workspaceId);
        return {
          kind: "denied",
          reason: "Sarathi could not deliver the response; retry safely.",
        } as const;
      }
      if (answer.status === "failed") {
        yield* markDelivered(resolved.workspaceId);
        return { kind: "answered", answer } as const;
      }
      yield* markDelivered(resolved.workspaceId);
      return { kind: "answered", answer } as const;
    }

    if (!(yield* renewLease())) return { kind: "ignored", reason: "duplicate" } as const;
    const answerResult = yield* Effect.either(
      dependencies.answerGenerator.generate(envelopeResult.right),
    );
    if (answerResult._tag === "Left") {
      yield* markFailed("failed-retryable", resolved.workspaceId);
      return {
        kind: "denied",
        reason: "Sarathi's approved answer service is unavailable.",
      } as const;
    }
    const answer = answerResult.right;
    if (!(yield* renewLease())) return { kind: "ignored", reason: "duplicate" } as const;
    const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
    if (deliveryResult._tag === "Left") {
      yield* markFailed("failed-retryable", resolved.workspaceId);
      return {
        kind: "denied",
        reason: "Sarathi could not deliver the response; retry safely.",
      } as const;
    }
    yield* markDelivered(resolved.workspaceId);
    return { kind: "answered", answer } as const;
  });
};
