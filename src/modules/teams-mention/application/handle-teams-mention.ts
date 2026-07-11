import { Effect } from "effect";
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
};

export const handleTeamsMention = (
  command: TeamsMentionCommand | undefined,
  dependencies: TeamsMentionDependencies,
): Effect.Effect<TeamsMentionOutcome, never> => {
  if (command === undefined || command.question === "") {
    return Effect.succeed({ kind: "ignored", reason: "not-a-direct-mention" });
  }

  return Effect.gen(function* () {
    const reserved = yield* dependencies.audit
      .reserveActivity(command.activityId)
      .pipe(Effect.orElseSucceed(() => false));
    if (!reserved) return { kind: "ignored", reason: "duplicate" } as const;

    const resolved = yield* dependencies.resolver
      .resolve(command)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (resolved === undefined) {
      yield* dependencies.audit
        .record(command.activityId, "denied")
        .pipe(Effect.orElseSucceed(() => undefined));
      return {
        kind: "denied",
        reason: "Sarathi is not available for this caller or channel.",
      } as const;
    }

    const authorization = yield* dependencies.authorizer
      .authorizeContext(command, resolved)
      .pipe(Effect.orElseSucceed(() => ({ allowed: false })));
    if (!authorization.allowed) {
      yield* dependencies.audit
        .record(command.activityId, "denied", resolved.workspaceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      return { kind: "denied", reason: "Sarathi cannot use this thread's context." } as const;
    }

    const envelope = yield* dependencies.contextAssembler
      .assemble(command, resolved)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (envelope === undefined) {
      return {
        kind: "denied",
        reason: "Sarathi cannot retrieve the approved context right now.",
      } as const;
    }
    const answer = yield* dependencies.answerGenerator
      .generate(envelope)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (answer === undefined) {
      return {
        kind: "denied",
        reason: "Sarathi's approved answer service is unavailable.",
      } as const;
    }
    yield* dependencies.delivery.reply(command, answer).pipe(Effect.orElseSucceed(() => undefined));
    yield* dependencies.audit
      .record(command.activityId, "answered", resolved.workspaceId)
      .pipe(Effect.orElseSucceed(() => undefined));
    return { kind: "answered", answer } as const;
  });
};
