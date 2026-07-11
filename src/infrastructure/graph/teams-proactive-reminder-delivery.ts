import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { ComplianceReminderDelivery } from "../../modules/compliance-reminders/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

type TeamsProactiveReminderDeliveryConfiguration = {
  readonly chatId: string;
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly fetcher?: typeof fetch | undefined;
};

export const createTeamsProactiveReminderDelivery = (
  configuration: TeamsProactiveReminderDeliveryConfiguration,
): ComplianceReminderDelivery => ({
  provider: "compliance-reminder-delivery",
  deliver: ({ digest }) =>
    Effect.tryPromise({
      try: async () => {
        const accessToken = await configuration.tokenProvider.getAccessToken();
        const response = await (configuration.fetcher ?? fetch)(
          `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(configuration.chatId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ body: { contentType: "text", content: digest.text } }),
          },
        );
        if (!response.ok)
          throw new Error(`Teams proactive reminder delivery failed with HTTP ${response.status}.`);
        const payload = (await response.json()) as { readonly id?: string };
        if (payload.id === undefined || payload.id.trim() === "") {
          throw new Error("Teams proactive reminder delivery returned no message identifier.");
        }
        return { externalId: payload.id };
      },
      catch: () =>
        new RepositoryError({ message: "Teams proactive reminder delivery is unavailable." }),
    }),
});
