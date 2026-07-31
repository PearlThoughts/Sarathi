import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { parseDeclaredInitiativeSnapshot } from "../../modules/strategy-kernel/index.ts";

type DeclaredInitiativeRuntimeEnvironment = Record<string, string | undefined>;

type DeclaredInitiativeCliResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type DeclaredInitiativeCliDependencies = {
  readonly fetcher?: Fetcher | undefined;
  readonly readFile?: ((path: string) => string) | undefined;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value.trim();
};

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const baseUrl = (environment: DeclaredInitiativeRuntimeEnvironment): string => {
  const configured = environment.SARATHI_PUBLIC_BASE_URL?.trim();
  if (configured !== undefined && configured !== "") return configured.replace(/\/+$/, "");
  const railwayDomain = environment.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain !== undefined && railwayDomain !== "")
    return `https://${railwayDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  throw new Error("SARATHI_PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN is required.");
};

const responseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return { ok: false, error: "invalid_runtime_response" };
  }
};

export const runDeclaredInitiativeCommand = async (
  args: readonly string[],
  environment: DeclaredInitiativeRuntimeEnvironment = process.env,
  dependencies: DeclaredInitiativeCliDependencies = {},
): Promise<DeclaredInitiativeCliResult> => {
  try {
    const fetcher = dependencies.fetcher ?? fetch;
    const token = required("SARATHI_ADMIN_TOKEN", environment.SARATHI_ADMIN_TOKEN);
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    if (args[0] === "import") {
      const path = required("--file", option(args, "--file"));
      const contents = (dependencies.readFile ?? ((selected) => readFileSync(selected, "utf8")))(
        path,
      );
      const snapshot = parseDeclaredInitiativeSnapshot(parse(contents));
      const response = await fetcher(`${baseUrl(environment)}/internal/delivery/intent/import`, {
        method: "POST",
        headers,
        body: JSON.stringify(snapshot),
      });
      return {
        exitCode: response.ok ? 0 : 1,
        output: await responseBody(response),
      };
    }
    if (args[0] === "status") {
      const response = await fetcher(`${baseUrl(environment)}/internal/delivery/intent/status`, {
        headers,
      });
      return {
        exitCode: response.ok ? 0 : 1,
        output: await responseBody(response),
      };
    }
    return {
      exitCode: 2,
      output: {
        ok: false,
        message: "Use delivery intent import --file <snapshot.yaml> or delivery intent status.",
      },
    };
  } catch (error) {
    return {
      exitCode: 2,
      output: {
        ok: false,
        message: error instanceof Error ? error.message : "Declared initiative command failed.",
      },
    };
  }
};
