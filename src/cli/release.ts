import { existsSync } from "node:fs";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CliOptions = {
  readonly args: readonly string[];
  readonly env?: Record<string, string | undefined> | undefined;
  readonly fetcher?: Fetcher | undefined;
};

type CliResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type EndpointCheck = {
  readonly endpoint: string;
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
};

type RuntimeSmokeReport = {
  readonly baseUrl: string;
  readonly checks: readonly EndpointCheck[];
  readonly ok: boolean;
};

const defaultBaseUrl = "http://localhost:3000";
const previewOverlayBody = {
  version: 1,
  organizationId: "acme",
  teams: [
    {
      teamId: "engineering",
      sensitivity: "confidential",
      minimumTrustTier: "trusted",
      modelEgress: "approval-required",
    },
  ],
} as const;

const normalizeBaseUrl = (value: string | undefined): string =>
  (value ?? defaultBaseUrl).replace(/\/+$/, "");

const baseUrlFromEnv = (env: Record<string, string | undefined>): string => {
  if (env.SARATHI_PUBLIC_BASE_URL !== undefined && env.SARATHI_PUBLIC_BASE_URL !== "") {
    return normalizeBaseUrl(env.SARATHI_PUBLIC_BASE_URL);
  }

  if (env.RAILWAY_PUBLIC_DOMAIN !== undefined && env.RAILWAY_PUBLIC_DOMAIN !== "") {
    return normalizeBaseUrl(`https://${env.RAILWAY_PUBLIC_DOMAIN}`);
  }

  return defaultBaseUrl;
};

const readEndpoint = async (
  baseUrl: string,
  endpoint: string,
  fetcher: Fetcher,
  init?: RequestInit,
): Promise<EndpointCheck> => {
  const response = await fetcher(`${baseUrl}${endpoint}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    endpoint,
    ok: response.ok,
    status: response.status,
    body,
  };
};

export const checkRuntimeHealth = async (
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<EndpointCheck> => readEndpoint(normalizeBaseUrl(baseUrl), "/health", fetcher);

export const checkRuntimeSmoke = async (
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<RuntimeSmokeReport> => {
  const normalized = normalizeBaseUrl(baseUrl);
  const checks = await Promise.all([
    readEndpoint(normalized, "/health", fetcher),
    readEndpoint(normalized, "/platform/foundation", fetcher),
    readEndpoint(normalized, "/workspace-model", fetcher),
    readEndpoint(normalized, "/workspace-model/preview", fetcher, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(previewOverlayBody),
    }),
  ]);

  return {
    baseUrl: normalized,
    checks,
    ok: checks.every((check) => check.ok),
  };
};

const verifyRailwayRuntime = (): CliResult => {
  const missing = [
    existsSync("package.json") ? undefined : "package.json",
    existsSync("bun.lock") ? undefined : "bun.lock",
  ].filter((value): value is string => value !== undefined);

  if (missing.length > 0) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        missing,
      },
    };
  }

  return {
    exitCode: 0,
    output: {
      ok: true,
      runtime: "bun",
      startCommand: "bun run start",
      healthEndpoint: "/health",
      smokeCommand: "bun run runtime:smoke",
    },
  };
};

const railwayDeployStatus = (env: Record<string, string | undefined>): CliResult => {
  const hasRailwayProject =
    env.RAILWAY_PROJECT_ID !== undefined &&
    env.RAILWAY_PROJECT_ID !== "" &&
    env.RAILWAY_SERVICE_ID !== undefined &&
    env.RAILWAY_SERVICE_ID !== "";

  return {
    exitCode: 2,
    output: {
      ok: false,
      provider: "railway",
      configured: hasRailwayProject,
      message:
        "Railway deploy is intentionally not wired yet. Link the GitHub repo to a Railway service, set RAILWAY_PROJECT_ID and RAILWAY_SERVICE_ID, then replace this guard with the project release CLI.",
    },
  };
};

const isJsonMode = (args: readonly string[]): boolean => args.includes("--json");

export const runReleaseCli = async (options: CliOptions): Promise<CliResult> => {
  const args = options.args.filter((arg) => arg !== "--ci" && arg !== "--json");
  const env = options.env ?? Bun.env;
  const fetcher = options.fetcher ?? fetch;

  if (args[0] === "runtime" && args[1] === "health") {
    const baseUrl = baseUrlFromEnv(env);
    const health = await checkRuntimeHealth(baseUrl, fetcher);

    return {
      exitCode: health.ok ? 0 : 1,
      output: {
        baseUrl,
        check: health,
      },
    };
  }

  if (args[0] === "runtime" && args[1] === "smoke") {
    const smoke = await checkRuntimeSmoke(baseUrlFromEnv(env), fetcher);

    return {
      exitCode: smoke.ok ? 0 : 1,
      output: smoke,
    };
  }

  if (args[0] === "runtime" && args[1] === "verify-railpack") {
    return verifyRailwayRuntime();
  }

  if (args[0] === "railway" || args.length === 0) {
    return railwayDeployStatus(env);
  }

  return {
    exitCode: 2,
    output: {
      ok: false,
      message: `Unknown command: ${args.join(" ")}`,
    },
  };
};

const printResult = (result: CliResult, jsonMode: boolean): void => {
  if (jsonMode) {
    console.log(JSON.stringify(result.output, null, 2));
    return;
  }

  console.log(JSON.stringify(result.output, null, 2));
};

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const result = await runReleaseCli({ args });
  printResult(result, isJsonMode(args));
  process.exit(result.exitCode);
}
