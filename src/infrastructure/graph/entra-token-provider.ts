export type GraphAccessTokenProvider = {
  readonly getAccessToken: () => Promise<string>;
};

type EntraClientCredentialsTokenProviderConfiguration = {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetcher?: typeof fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly refreshSkewSeconds?: number | undefined;
};

type TokenResponse = {
  readonly access_token?: string;
  readonly expires_in?: number;
};

const required = (name: string, value: string): string => {
  if (value.trim() === "") throw new Error(`Entra token configuration requires ${name}.`);
  return value;
};

export const createEntraClientCredentialsTokenProvider = (
  configuration: EntraClientCredentialsTokenProviderConfiguration,
): GraphAccessTokenProvider => {
  const tenantId = required("tenantId", configuration.tenantId);
  const clientId = required("clientId", configuration.clientId);
  const clientSecret = required("clientSecret", configuration.clientSecret);
  const fetcher = configuration.fetcher ?? fetch;
  const now = configuration.now ?? Date.now;
  const refreshSkewMilliseconds = (configuration.refreshSkewSeconds ?? 60) * 1000;
  let cached: { readonly accessToken: string; readonly expiresAt: number } | undefined;

  return {
    getAccessToken: async () => {
      if (cached !== undefined && cached.expiresAt - refreshSkewMilliseconds > now()) {
        return cached.accessToken;
      }

      const response = await fetcher(
        `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
            scope: "https://graph.microsoft.com/.default",
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Entra token acquisition failed with HTTP ${response.status}.`);
      const payload = (await response.json()) as TokenResponse;
      if (payload.access_token === undefined || payload.access_token.trim() === "") {
        throw new Error("Entra token acquisition returned no access token.");
      }
      if (payload.expires_in === undefined || !Number.isFinite(payload.expires_in)) {
        throw new Error("Entra token acquisition returned no valid expiry.");
      }
      cached = { accessToken: payload.access_token, expiresAt: now() + payload.expires_in * 1000 };
      return cached.accessToken;
    },
  };
};
