import type { ProductRelationType } from "./product-model.ts";

export type ProductRelationFamily =
  | "product"
  | "delivery"
  | "realization"
  | "assurance"
  | "variation";

export type ProductRelationLens =
  | "constellation"
  | "dependencies"
  | "relationships"
  | "delivery"
  | "realization"
  | "variants"
  | "assurance"
  | "coverage"
  | "history";

export type ProductRelationSemantics = {
  readonly type: ProductRelationType;
  readonly label: string;
  readonly reverseLabel: string;
  readonly family: ProductRelationFamily;
  readonly definition: string;
  readonly directional: true;
  readonly lenses: readonly ProductRelationLens[];
};

export const productRelationTypes = [
  "depends_on",
  "enables",
  "conflicts_with",
  "alternative_to",
  "supersedes",
  "implements",
  "contributes_to",
  "governed_by",
  "affected_by",
  "realized_by",
  "exposed_by",
  "configured_by",
  "deployed_as",
  "observed_by",
  "verified_by",
  "constrained_by",
  "available_to",
  "variant_of",
] as const satisfies readonly ProductRelationType[];

const semantics = (
  type: ProductRelationType,
  label: string,
  reverseLabel: string,
  family: ProductRelationFamily,
  definition: string,
  lenses: readonly ProductRelationLens[],
): ProductRelationSemantics => ({
  type,
  label,
  reverseLabel,
  family,
  definition: `${definition}.`,
  directional: true,
  lenses: ["relationships", ...lenses.filter((lens) => lens !== "relationships")],
});

export const productRelationSemantics: Readonly<
  Record<ProductRelationType, ProductRelationSemantics>
> = {
  depends_on: semantics(
    "depends_on",
    "depends on",
    "is depended on by",
    "product",
    "The source requires the target to provide its governed behavior",
    ["constellation", "dependencies", "assurance"],
  ),
  enables: semantics(
    "enables",
    "enables",
    "is enabled by",
    "product",
    "The source makes the target behavior possible without making it mandatory",
    ["constellation", "dependencies"],
  ),
  conflicts_with: semantics(
    "conflicts_with",
    "conflicts with",
    "conflicts with",
    "product",
    "The source and target cannot safely apply together under their governed conditions",
    ["dependencies", "assurance"],
  ),
  alternative_to: semantics(
    "alternative_to",
    "is an alternative to",
    "is an alternative to",
    "product",
    "The source can satisfy a governed need in place of the target",
    ["constellation", "variants"],
  ),
  supersedes: semantics(
    "supersedes",
    "supersedes",
    "is superseded by",
    "product",
    "The source replaces the target for the relation validity interval",
    ["history"],
  ),
  implements: semantics(
    "implements",
    "implements",
    "is implemented by",
    "delivery",
    "The source delivery record implements the target product behavior",
    ["delivery", "realization"],
  ),
  contributes_to: semantics(
    "contributes_to",
    "contributes to",
    "receives a contribution from",
    "delivery",
    "The source advances part of the target outcome without claiming completion",
    ["delivery"],
  ),
  governed_by: semantics(
    "governed_by",
    "is governed by",
    "governs",
    "delivery",
    "The target policy or intent constrains decisions about the source",
    ["delivery", "assurance"],
  ),
  affected_by: semantics(
    "affected_by",
    "is affected by",
    "affects",
    "delivery",
    "The target delivery change can alter the source behavior or availability",
    ["delivery", "history"],
  ),
  realized_by: semantics(
    "realized_by",
    "is realized by",
    "realizes",
    "realization",
    "The target technical component materially realizes the source behavior",
    ["realization"],
  ),
  exposed_by: semantics(
    "exposed_by",
    "is exposed by",
    "exposes",
    "realization",
    "The target interface exposes the source behavior to an authorized consumer",
    ["realization"],
  ),
  configured_by: semantics(
    "configured_by",
    "is configured by",
    "configures",
    "realization",
    "The target configuration controls an allowed aspect of the source behavior",
    ["realization", "variants"],
  ),
  deployed_as: semantics(
    "deployed_as",
    "is deployed as",
    "deploys",
    "realization",
    "The source is delivered through the target runtime or deployment form",
    ["delivery", "realization"],
  ),
  observed_by: semantics(
    "observed_by",
    "is observed by",
    "observes",
    "realization",
    "The target telemetry or operational source observes the source behavior",
    ["realization", "assurance", "coverage"],
  ),
  verified_by: semantics(
    "verified_by",
    "is verified by",
    "verifies",
    "assurance",
    "The target evidence verifies a stated property of the source without implying acceptance",
    ["delivery", "assurance", "coverage"],
  ),
  constrained_by: semantics(
    "constrained_by",
    "is constrained by",
    "constrains",
    "assurance",
    "The target invariant or policy limits valid behavior of the source",
    ["dependencies", "assurance"],
  ),
  available_to: semantics(
    "available_to",
    "is available to",
    "can access",
    "assurance",
    "The source is available to the target audience under governed conditions",
    ["variants", "assurance"],
  ),
  variant_of: semantics(
    "variant_of",
    "is a variant of",
    "has variant",
    "variation",
    "The source specializes the target base behavior for explicit qualifiers",
    ["variants", "history"],
  ),
};

export const relationStatement = (
  sourceName: string,
  type: ProductRelationType,
  targetName: string,
  direction: "forward" | "reverse" = "forward",
): string => {
  const relation = productRelationSemantics[type];
  return direction === "forward"
    ? `${sourceName} ${relation.label} ${targetName}.`
    : `${targetName} ${relation.reverseLabel} ${sourceName}.`;
};
