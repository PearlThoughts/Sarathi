import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "effect";
import type {
  ProductChangePreview,
  ProductCommandResult,
  ProductModelCommand,
} from "../../modules/product-model/application/product-model-commands.ts";
import {
  type ProductRegistryImportCurrentState,
  type ProductRegistryImportPlan,
  parseProductRegistryProposalBatch,
  parseProductRegistryRelationMap,
  planProductRegistryImport,
} from "../../modules/product-model/application/product-registry-import.ts";

type ImportMode = "preview" | "apply";

type ImportCliOptions = {
  readonly mode: ImportMode;
  readonly file: string;
  readonly relationMap: string;
  readonly workspaceId: string;
  readonly validFrom: string;
  readonly justification: string;
  readonly approvalFingerprint?: string | undefined;
};

type ImportEnvironment = Record<string, string | undefined>;

class ProductRegistryImportCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductRegistryImportCliError";
  }
}

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "")
    throw new ProductRegistryImportCliError(`${name} is required.`);
  return value;
};

const parseOptions = (args: readonly string[]): ImportCliOptions => {
  const [modeValue, ...options] = args;
  if (modeValue !== "preview" && modeValue !== "apply")
    throw new ProductRegistryImportCliError("Mode must be preview or apply.");
  const values = new Map<string, string>();
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index];
    const value = options[index + 1];
    if (name === undefined || !name.startsWith("--") || value === undefined)
      throw new ProductRegistryImportCliError("Import options must use --name value pairs.");
    if (values.has(name))
      throw new ProductRegistryImportCliError(`Duplicate import option ${name}.`);
    values.set(name, value);
  }
  const allowed = new Set([
    "--file",
    "--relation-map",
    "--workspace",
    "--valid-from",
    "--justification",
    "--approval-fingerprint",
  ]);
  const unsupported = [...values.keys()].find((name) => !allowed.has(name));
  if (unsupported !== undefined)
    throw new ProductRegistryImportCliError(`Unsupported import option ${unsupported}.`);
  const approvalFingerprint = values.get("--approval-fingerprint");
  if (modeValue === "apply" && approvalFingerprint === undefined)
    throw new ProductRegistryImportCliError(
      "Apply requires the exact --approval-fingerprint emitted by preview.",
    );
  return {
    mode: modeValue,
    file: resolve(required("--file", values.get("--file"))),
    relationMap: resolve(required("--relation-map", values.get("--relation-map"))),
    workspaceId: required("--workspace", values.get("--workspace")),
    validFrom: required("--valid-from", values.get("--valid-from")),
    justification: required("--justification", values.get("--justification")),
    ...(approvalFingerprint === undefined ? {} : { approvalFingerprint }),
  };
};

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new ProductRegistryImportCliError("Unable to read or parse an import JSON document.");
  }
};

const apiError = async (response: Response): Promise<ProductRegistryImportCliError> => {
  let code = `HTTP_${response.status}`;
  try {
    const body = (await response.json()) as { readonly error?: { readonly code?: string } };
    if (body.error?.code !== undefined) code = body.error.code;
  } catch {
    // Keep the status-only code. Response bodies are intentionally not echoed.
  }
  return new ProductRegistryImportCliError(`Sarathi API request failed with ${code}.`);
};

const authorizedFetch = (
  url: string,
  token: string,
  init?: RequestInit | undefined,
): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

const currentState = async (
  apiBaseUrl: string,
  workspaceId: string,
  token: string,
): Promise<ProductRegistryImportCurrentState> => {
  const response = await authorizedFetch(
    `${apiBaseUrl}/v1/workspaces/${encodeURIComponent(
      workspaceId,
    )}/product-model/map?maximumDepth=8&maximumNodes=500&maximumRelations=500`,
    token,
  );
  if (response.status === 404)
    return { revision: 0, entities: [], relations: [], aliasesByEntityId: {} };
  if (!response.ok) throw await apiError(response);
  const body = (await response.json()) as {
    readonly data?: ProductRegistryImportCurrentState;
  };
  if (
    body.data === undefined ||
    !Number.isSafeInteger(body.data.revision) ||
    !Array.isArray(body.data.entities) ||
    !Array.isArray(body.data.relations)
  )
    throw new ProductRegistryImportCliError("Sarathi returned an invalid product-map envelope.");
  const aliasesByEntityId: Record<string, readonly string[]> = {};
  for (let offset = 0; offset < body.data.entities.length; offset += 8) {
    const page = body.data.entities.slice(offset, offset + 8);
    const dossiers = await Promise.all(
      page.map(async ({ entityId }) => {
        const dossierResponse = await authorizedFetch(
          `${apiBaseUrl}/v1/workspaces/${encodeURIComponent(
            workspaceId,
          )}/product-model/entities/${encodeURIComponent(entityId)}`,
          token,
        );
        if (!dossierResponse.ok) throw await apiError(dossierResponse);
        const dossierBody = (await dossierResponse.json()) as {
          readonly data?: {
            readonly aliases?: readonly { readonly value?: string }[];
          };
        };
        if (dossierBody.data === undefined || !Array.isArray(dossierBody.data.aliases))
          throw new ProductRegistryImportCliError("Sarathi returned an invalid product dossier.");
        const aliases = dossierBody.data.aliases.map(({ value }) => {
          if (typeof value !== "string")
            throw new ProductRegistryImportCliError("Sarathi returned an invalid product alias.");
          return value;
        });
        return { entityId, aliases };
      }),
    );
    for (const dossier of dossiers) aliasesByEntityId[dossier.entityId] = dossier.aliases;
  }
  return { ...body.data, aliasesByEntityId };
};

const postCommand = async <Value>(
  apiBaseUrl: string,
  workspaceId: string,
  token: string,
  operation: "changes/preview" | "commands",
  command: ProductModelCommand,
): Promise<Value> => {
  const response = await authorizedFetch(
    `${apiBaseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/product-model/${operation}`,
    token,
    { method: "POST", body: JSON.stringify(command) },
  );
  if (!response.ok) throw await apiError(response);
  const body = (await response.json()) as { readonly data?: Value };
  if (body.data === undefined)
    throw new ProductRegistryImportCliError("Sarathi returned an invalid command envelope.");
  return body.data;
};

const previewCommand = (
  apiBaseUrl: string,
  workspaceId: string,
  token: string,
  command: ProductModelCommand,
): Promise<ProductChangePreview> =>
  postCommand(apiBaseUrl, workspaceId, token, "changes/preview", command);

const executeCommand = (
  apiBaseUrl: string,
  workspaceId: string,
  token: string,
  command: ProductModelCommand,
  previewToken: string,
): Promise<ProductCommandResult> =>
  postCommand(apiBaseUrl, workspaceId, token, "commands", { ...command, previewToken });

const planSummary = (
  plan: ProductRegistryImportPlan,
  firstServerPreview?: ProductChangePreview | undefined,
) => ({
  ok: true,
  operation: "product-registry-import-preview",
  plan: {
    sourceWorkspaceKey: plan.sourceWorkspaceKey,
    targetWorkspaceId: plan.targetWorkspaceId,
    expectedRevision: plan.expectedRevision,
    resultingRevision: plan.resultingRevision,
    planFingerprint: plan.planFingerprint,
    impact: plan.impact,
    commandTypes: Object.fromEntries(
      [...new Set(plan.commands.map(({ command }) => command.type))]
        .sort()
        .map((type) => [type, plan.commands.filter(({ command }) => command.type === type).length]),
    ),
    dispositions: plan.dispositions,
    serverValidation:
      firstServerPreview === undefined
        ? { status: "not-required", reason: "plan-has-no-commands" }
        : {
            status: "first-command-previewed",
            policyVersion: firstServerPreview.policyVersion,
            impact: firstServerPreview.impact,
            invariantResults: firstServerPreview.invariantResults,
          },
  },
});

const applyPlan = async (
  plan: ProductRegistryImportPlan,
  apiBaseUrl: string,
  token: string,
): Promise<unknown> => {
  const changedEntityIds = new Set<string>();
  const changedCollections = new Map<string, number>();
  let hiddenEntityImpactCount = 0;
  const revisions: number[] = [];
  for (const [index, planned] of plan.commands.entries()) {
    let preview: ProductChangePreview;
    try {
      preview = await previewCommand(apiBaseUrl, plan.targetWorkspaceId, token, planned.command);
      const result = await executeCommand(
        apiBaseUrl,
        plan.targetWorkspaceId,
        token,
        planned.command,
        preview.previewToken,
      );
      revisions.push(result.revision);
    } catch {
      throw new ProductRegistryImportCliError(
        `Governed import stopped after ${index} committed commands. Re-preview the unchanged proposal batch to resume safely.`,
      );
    }
    for (const entityId of preview.impact.changedEntityIds) changedEntityIds.add(entityId);
    hiddenEntityImpactCount += preview.impact.hiddenEntityImpactCount;
    for (const [collection, count] of Object.entries(preview.impact.changedCollections))
      changedCollections.set(collection, (changedCollections.get(collection) ?? 0) + count);
  }
  return {
    ok: true,
    operation: "product-registry-import-apply",
    planFingerprint: plan.planFingerprint,
    committedCommandCount: plan.commands.length,
    initialRevision: plan.expectedRevision,
    resultingRevision: revisions.at(-1) ?? plan.expectedRevision,
    impact: {
      changedEntityIds: [...changedEntityIds].sort(),
      visibleEntityImpactCount: changedEntityIds.size,
      hiddenEntityImpactCount,
      changedCollections: Object.fromEntries([...changedCollections.entries()].sort()),
      deferredProposalCount: plan.impact.deferredProposalCount,
    },
    dispositions: plan.dispositions,
  };
};

export const runProductRegistryImport = async (
  args: readonly string[],
  environment: ImportEnvironment = Bun.env,
): Promise<unknown> => {
  const options = parseOptions(args);
  const apiBaseUrl = required("SARATHI_API_BASE_URL", environment.SARATHI_API_BASE_URL).replace(
    /\/$/u,
    "",
  );
  const token = required(
    "SARATHI_PRODUCT_MODEL_ACCESS_TOKEN",
    environment.SARATHI_PRODUCT_MODEL_ACCESS_TOKEN,
  );
  const [batchValue, relationMapValue, current] = await Promise.all([
    readJson(options.file),
    readJson(options.relationMap),
    currentState(apiBaseUrl, options.workspaceId, token),
  ]);
  const plan = planProductRegistryImport({
    batch: parseProductRegistryProposalBatch(batchValue),
    relationMap: parseProductRegistryRelationMap(relationMapValue),
    current,
    targetWorkspaceId: options.workspaceId,
    validFrom: options.validFrom,
    justification: options.justification,
  });
  if (options.mode === "preview") {
    const first = plan.commands[0];
    const firstServerPreview =
      first === undefined
        ? undefined
        : await previewCommand(apiBaseUrl, options.workspaceId, token, first.command);
    return planSummary(plan, firstServerPreview);
  }
  if (options.approvalFingerprint !== plan.planFingerprint)
    throw new ProductRegistryImportCliError(
      "Approval fingerprint does not match the current revision and proposal plan.",
    );
  return applyPlan(plan, apiBaseUrl, token);
};

if (import.meta.main)
  Effect.tryPromise({
    try: () => runProductRegistryImport(Bun.argv.slice(2)),
    catch: (error) =>
      error instanceof ProductRegistryImportCliError
        ? error
        : new ProductRegistryImportCliError("Product-registry import failed validation."),
  }).pipe(
    Effect.tap((output) => Effect.sync(() => console.info(JSON.stringify(output, null, 2)))),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      }),
    ),
    Effect.runPromise,
  );
