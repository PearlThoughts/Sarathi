"use client";

import { type FormEvent, useState } from "react";

type RenameCommand = {
  readonly type: "RenameEntity";
  readonly workspaceId: string;
  readonly targetId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly justification: string;
  readonly validFrom: string;
  readonly previewToken: string;
  readonly payload: {
    readonly canonicalName: string;
    readonly canonicalAliasId: string;
  };
};

type Preview = {
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly expiresAt: string;
  readonly impact: {
    readonly changedEntityIds: readonly string[];
    readonly hiddenEntityImpactCount: number;
    readonly changedCollections: Readonly<Record<string, number>>;
  };
};

type WorkflowState =
  | { readonly kind: "editing" }
  | { readonly kind: "pending"; readonly operation: "preview" | "execute" }
  | { readonly kind: "previewed"; readonly preview: Preview; readonly command: RenameCommand }
  | { readonly kind: "committed"; readonly revision: number; readonly replayed: boolean }
  | { readonly kind: "failed"; readonly code: string; readonly message: string };

type ChangeEnvelope = {
  readonly data?: {
    readonly preview?: Preview;
    readonly command?: RenameCommand;
    readonly result?: { readonly revision: number; readonly replayed: boolean };
  };
  readonly error?: { readonly code?: string; readonly message?: string };
};

const readEnvelope = async (response: Response): Promise<ChangeEnvelope> => {
  try {
    return (await response.json()) as ChangeEnvelope;
  } catch {
    return {};
  }
};

const requestChange = async (
  body: unknown,
): Promise<{ response: Response; envelope: ChangeEnvelope } | undefined> => {
  try {
    const response = await fetch("/studio-api/product-model-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, envelope: await readEnvelope(response) };
  } catch {
    return undefined;
  }
};

export const RenameEntityForm = ({
  entityId,
  canonicalName: initialCanonicalName,
  canonicalAliasId,
  revision,
}: {
  readonly entityId: string;
  readonly canonicalName: string;
  readonly canonicalAliasId: string;
  readonly revision: number;
}) => {
  const [canonicalName, setCanonicalName] = useState(initialCanonicalName);
  const [justification, setJustification] = useState("");
  const [state, setState] = useState<WorkflowState>({ kind: "editing" });

  const preview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: "pending", operation: "preview" });
    const result = await requestChange({
      action: "preview-rename",
      entityId,
      expectedRevision: revision,
      canonicalName,
      canonicalAliasId,
      justification,
    });
    const response = result?.response;
    const envelope = result?.envelope ?? {};
    if (
      response?.ok === true &&
      envelope.data?.preview !== undefined &&
      envelope.data.command !== undefined
    ) {
      setState({
        kind: "previewed",
        preview: envelope.data.preview,
        command: envelope.data.command,
      });
      return;
    }
    setState({
      kind: "failed",
      code: envelope.error?.code ?? "PRODUCT_MODEL_UNAVAILABLE",
      message: envelope.error?.message ?? "The product change service is unavailable.",
    });
  };

  const execute = async () => {
    if (state.kind !== "previewed" || state.preview.impact.hiddenEntityImpactCount > 0) return;
    const command = state.command;
    setState({ kind: "pending", operation: "execute" });
    const result = await requestChange({ action: "execute-rename", command });
    const response = result?.response;
    const envelope = result?.envelope ?? {};
    if (response?.ok === true && envelope.data?.result !== undefined) {
      setState({
        kind: "committed",
        revision: envelope.data.result.revision,
        replayed: envelope.data.result.replayed,
      });
      return;
    }
    setState({
      kind: "failed",
      code: envelope.error?.code ?? "PRODUCT_MODEL_UNAVAILABLE",
      message: envelope.error?.message ?? "The product change service is unavailable.",
    });
  };

  const reset = () => setState({ kind: "editing" });
  const pending = state.kind === "pending";

  return (
    <section aria-labelledby="rename-entity-title" className="mt-8 border-t border-stone-700 pt-6">
      <h3 className="text-balance font-semibold" id="rename-entity-title">
        Governed Rename
      </h3>
      <p className="mt-2 text-pretty text-sm text-stone-300">
        Preview identity impact before confirming. The current registry revision is {revision}.
      </p>

      <form className="mt-5 grid gap-4" onSubmit={preview}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="canonical-name">
          Canonical Name
          <input
            autoComplete="off"
            className="rounded-md border border-stone-600 bg-stone-900 px-3 py-2 text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            disabled={pending}
            id="canonical-name"
            maxLength={240}
            name="canonicalName"
            onChange={(event) => setCanonicalName(event.currentTarget.value)}
            required
            type="text"
            value={canonicalName}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="rename-justification">
          Justification
          <textarea
            autoComplete="off"
            className="min-h-28 rounded-md border border-stone-600 bg-stone-900 px-3 py-2 text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            disabled={pending}
            id="rename-justification"
            maxLength={4000}
            minLength={8}
            name="justification"
            onChange={(event) => setJustification(event.currentTarget.value)}
            required
            value={justification}
          />
        </label>
        <button
          className="w-fit rounded-md bg-teal-600 px-4 py-2 font-semibold text-stone-950 hover:bg-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:bg-stone-600 disabled:text-stone-300"
          disabled={pending}
          type="submit"
        >
          {state.kind === "pending" && state.operation === "preview"
            ? "Previewing…"
            : "Preview Rename"}
        </button>
      </form>

      <div aria-live="polite" className="mt-5 text-sm">
        {state.kind === "previewed" ? (
          <div className="rounded-md border border-teal-700 bg-stone-900 p-4">
            <h4 className="font-semibold">Preview Passed</h4>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-stone-400">Resulting Revision</dt>
                <dd className="font-mono tabular-nums">{state.preview.resultingRevision}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Changed Entities</dt>
                <dd className="font-mono tabular-nums">
                  {state.preview.impact.changedEntityIds.length}
                </dd>
              </div>
              <div>
                <dt className="text-stone-400">Hidden Impacts</dt>
                <dd className="font-mono tabular-nums">
                  {state.preview.impact.hiddenEntityImpactCount}
                </dd>
              </div>
            </dl>
            {state.preview.impact.hiddenEntityImpactCount > 0 ? (
              <p className="mt-4 text-pretty text-amber-200" role="alert">
                Additional approval is required. Confirmation is disabled because the preview
                contains impacts outside your visible product scope.
              </p>
            ) : (
              <button
                className="mt-4 rounded-md bg-teal-600 px-4 py-2 font-semibold text-stone-950 hover:bg-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                onClick={execute}
                type="button"
              >
                Confirm Rename
              </button>
            )}
            <button
              className="ml-3 mt-4 rounded-md px-4 py-2 font-semibold text-stone-200 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              onClick={reset}
              type="button"
            >
              Discard Preview
            </button>
          </div>
        ) : null}
        {state.kind === "pending" && state.operation === "execute" ? (
          <p>Committing governed change…</p>
        ) : null}
        {state.kind === "committed" ? (
          <div className="rounded-md border border-teal-700 bg-stone-900 p-4" role="status">
            Rename committed at revision {state.revision}. Reload the dossier to view ratified
            identity.
          </div>
        ) : null}
        {state.kind === "failed" ? (
          <div className="rounded-md border border-red-400 bg-stone-900 p-4" role="alert">
            <p>{state.message}</p>
            {state.code === "stale_revision" ? (
              <p className="mt-2 text-pretty">
                The registry changed after preview. Reload the current dossier, inspect the new
                revision, then deliberately reapply or discard this rename.
              </p>
            ) : null}
            <a
              className="mt-3 inline-block font-semibold underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              href={`/admin/product-map?entity=${encodeURIComponent(entityId)}`}
            >
              Reload Current Dossier
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
};
