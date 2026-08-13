import { RepositoryError } from "../../../domain/errors.ts";

export type DeliveryRelevanceProfile = "legacy" | "semantic" | "reranked" | "expanded";

export const deliveryRelevanceProfileFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): DeliveryRelevanceProfile => {
  const value = environment.SARATHI_RELEVANCE_PROFILE ?? "expanded";
  if (value === "legacy" || value === "semantic" || value === "reranked" || value === "expanded")
    return value;
  throw new RepositoryError({
    message: "SARATHI_RELEVANCE_PROFILE must be legacy, semantic, reranked, or expanded.",
    operation: "delivery-relevance-profile",
  });
};
