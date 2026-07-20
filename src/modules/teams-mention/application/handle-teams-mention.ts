import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { type DeliveryAssistant, planDeliveryQuestion } from "../../delivery-intelligence/index.ts";
import type { TeamsMentionCommand, TeamsMentionOutcome } from "../domain/teams-mention.ts";
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

    const resolvedResult = yield* Effect.either(dependencies.resolver.resolve(command));
    if (resolvedResult._tag === "Left") {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-retryable")
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi cannot resolve the connected workspace right now.",
      } as const;
    }
    const resolved = resolvedResult.right;
    if (resolved === undefined) {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-terminal")
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi is not available for this caller or channel.",
      } as const;
    }

    const deliveryQuestionPlan = planDeliveryQuestion(command.question);
    const authorizationResult = yield* Effect.either(
      deliveryQuestionPlan === undefined
        ? dependencies.authorizer.authorizeContext(command, resolved)
        : Effect.succeed({ allowed: true }),
    );
    if (authorizationResult._tag === "Left") {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return { kind: "denied", reason: "Sarathi cannot evaluate access right now." } as const;
    }
    const authorization = authorizationResult.right;
    if (!authorization.allowed) {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-terminal", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return { kind: "denied", reason: "Sarathi cannot use this thread's context." } as const;
    }

    if (isHelloDiagnostic(command.question)) {
      if (dependencies.helloDiagnosticEnabled !== true) {
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-terminal", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return { kind: "denied", reason: "Sarathi diagnostics are not enabled here." } as const;
      }
      const answer = {
        text: "Hello from Sarathi.",
        citations: [],
        unavailableSources: [],
      } as const;
      const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
      if (deliveryResult._tag === "Left") {
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return {
          kind: "denied",
          reason: "Sarathi could not deliver the response; retry safely.",
        } as const;
      }
      yield* dependencies.audit
        .markDelivered(command.activityId, resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return { kind: "answered", answer } as const;
    }

    if (deliveryQuestionPlan !== undefined) {
      if (
        dependencies.deliveryAssistant === undefined ||
        dependencies.deliveryTimeZone === undefined
      ) {
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-terminal", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return {
          kind: "denied",
          reason: "Sarathi's delivery intelligence is not configured here.",
        } as const;
      }
      const financeAccess = dependencies.deliveryFinanceActorIds?.has(resolved.callerId) === true;
      if (deliveryQuestionPlan.requiresFinance && !financeAccess) {
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-terminal", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return {
          kind: "denied",
          reason: "Finance delivery information is confidential.",
        } as const;
      }
      const reportResult = yield* Effect.either(
        dependencies.deliveryAssistant
          .answer({
            workspaceId: resolved.workspaceId,
            actorId: resolved.callerId,
            maximumSensitivity: resolved.channelSensitivity,
            financeAccess,
            requestedAt: command.receivedAt,
            timeZone: dependencies.deliveryTimeZone,
            question: command.question,
            plan: deliveryQuestionPlan,
          })
          .pipe(
            Effect.timeoutFail({
              duration: Math.max(
                100,
                Math.min(dependencies.deliveryAnswerTimeoutMs ?? 7_000, 8_000),
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
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return {
          kind: "denied",
          reason: "Sarathi could not answer this delivery question within 10 seconds.",
        } as const;
      }
      const answer = reportResult.right;
      const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
      if (deliveryResult._tag === "Left") {
        yield* dependencies.audit
          .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
          .pipe(Effect.orElseSucceed(() => undefined));
        return {
          kind: "denied",
          reason: "Sarathi could not deliver the response; retry safely.",
        } as const;
      }
      yield* dependencies.audit
        .markDelivered(command.activityId, resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return { kind: "answered", answer } as const;
    }

    const envelopeResult = yield* Effect.either(
      dependencies.contextAssembler.assemble(command, resolved),
    );
    if (envelopeResult._tag === "Left") {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi cannot retrieve the connected context right now.",
      } as const;
    }
    const answerResult = yield* Effect.either(
      dependencies.answerGenerator.generate(envelopeResult.right),
    );
    if (answerResult._tag === "Left") {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi's approved answer service is unavailable.",
      } as const;
    }
    const answer = answerResult.right;
    const deliveryResult = yield* Effect.either(dependencies.delivery.reply(command, answer));
    if (deliveryResult._tag === "Left") {
      yield* dependencies.audit
        .markFailed(command.activityId, "failed-retryable", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi could not deliver the response; retry safely.",
      } as const;
    }
    yield* dependencies.audit
      .markDelivered(command.activityId, resolved.workspaceId)
      .pipe(Effect.orElseSucceed(() => undefined));
    return { kind: "answered", answer } as const;
  });
};
