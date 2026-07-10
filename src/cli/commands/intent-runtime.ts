import { Effect } from "effect";
import { acceptClaimAsIntent, rejectClaim } from "../../modules/intent-inbox/index.ts";
import type { ExtractedClaim } from "../../modules/strategy-kernel/index.ts";
import {
  type DurableOperatorRuntimeSelection,
  openSqliteOperatorRuntime,
} from "./operator-runtime.ts";

type IntentRuntimeResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type IntentRuntimeClock = () => string;

const failure = (message: string): IntentRuntimeResult => ({
  exitCode: 2,
  output: { ok: false, message },
});

const optionValues = (args: readonly string[], option: string): readonly string[] => {
  const values: string[] = [];

  for (const [index, argument] of args.entries()) {
    if (argument === option) {
      const value = args[index + 1];
      values.push(value === undefined || value.startsWith("--") ? "" : value);
      continue;
    }

    const prefix = `${option}=`;
    if (argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length));
    }
  }

  return values;
};

const optionalValue = (
  args: readonly string[],
  option: string,
): { readonly value?: string | undefined; readonly error?: IntentRuntimeResult | undefined } => {
  const values = optionValues(args, option);

  if (values.length > 1) {
    return { error: failure(`Ambiguous ${option} value. Provide ${option} at most once.`) };
  }

  const value = values[0]?.trim();
  if (value === "") {
    return { error: failure(`${option} requires a non-empty value.`) };
  }

  return { value };
};

const claimIdFromArgs = (args: readonly string[]): string | undefined => {
  const claimId = args[2]?.trim();
  return claimId === undefined || claimId === "" || claimId.startsWith("--") ? undefined : claimId;
};

const selectedWorkspaceClaim = async (
  claimId: string,
  workspaceId: string,
  getClaim: (id: string) => Promise<ExtractedClaim | undefined>,
): Promise<ExtractedClaim | undefined> => {
  const claim = await getClaim(claimId);
  return claim?.workspaceId === workspaceId ? claim : undefined;
};

export const runDurableIntentCommand = async (
  args: readonly string[],
  selection: DurableOperatorRuntimeSelection,
  clock: IntentRuntimeClock = () => new Date().toISOString(),
): Promise<IntentRuntimeResult> => {
  const runtime = await Effect.runPromise(openSqliteOperatorRuntime(selection));

  try {
    const workspaceId = runtime.workspace.id;

    if (args[1] === "inbox") {
      return {
        exitCode: 0,
        output: {
          ok: true,
          mode: "file-backed",
          workspaceId,
          pendingClaims: await runtime.repository.listPendingClaims(workspaceId),
        },
      };
    }

    const action = args[1];
    if (action !== "accept" && action !== "reject") {
      return failure(
        "Unknown durable intent command. Use intent inbox, intent accept, or intent reject.",
      );
    }

    const claimId = claimIdFromArgs(args);
    if (claimId === undefined) {
      return failure(`Intent ${action} requires a claim ID.`);
    }

    const claim = await selectedWorkspaceClaim(
      claimId,
      workspaceId,
      runtime.repository.getExtractedClaim,
    );
    if (claim === undefined) {
      return failure("Claim was not found in the selected workspace.");
    }
    if (claim.state !== "pending" && claim.state !== "edited") {
      return failure("Claim is no longer pending in the selected workspace.");
    }

    const actor = optionalValue(args, "--actor");
    if (actor.error !== undefined) {
      return actor.error;
    }

    if (action === "accept") {
      const result = await acceptClaimAsIntent({
        repository: runtime.repository,
        claim,
        actorId: actor.value,
        occurredAt: clock(),
      });

      return {
        exitCode: 0,
        output: {
          ok: true,
          mode: "file-backed",
          workspaceId,
          claim: result.claim,
          intent: result.intent,
          event: result.event,
        },
      };
    }

    const reason = optionalValue(args, "--reason");
    if (reason.error !== undefined) {
      return reason.error;
    }
    if (reason.value === undefined) {
      return failure("Intent reject requires --reason so the human decision remains auditable.");
    }

    const result = await rejectClaim({
      repository: runtime.repository,
      claim,
      actorId: actor.value,
      reason: reason.value,
      occurredAt: clock(),
    });

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "file-backed",
        workspaceId,
        claim: result.claim,
        event: result.event,
      },
    };
  } finally {
    runtime.close();
  }
};
