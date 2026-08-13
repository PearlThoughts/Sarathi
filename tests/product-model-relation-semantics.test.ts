import { describe, expect, it } from "vitest";
import {
  type ProductRelationType,
  productRelationSemantics,
  productRelationTypes,
  relationStatement,
} from "../src/modules/product-model/index.ts";

describe("product relation semantics", () => {
  it("defines presentation-safe semantics for every governed relation type", () => {
    expect(Object.keys(productRelationSemantics).toSorted()).toEqual(
      [...productRelationTypes].toSorted(),
    );

    for (const relationType of productRelationTypes) {
      const semantics = productRelationSemantics[relationType];
      expect(semantics.type).toBe(relationType);
      expect(semantics.label.length).toBeGreaterThan(2);
      expect(semantics.reverseLabel.length).toBeGreaterThan(2);
      expect(semantics.definition.endsWith(".")).toBe(true);
      expect(semantics.lenses).toContain("relationships");
      expect(new Set(semantics.lenses).size).toBe(semantics.lenses.length);
    }
  });

  it.each<readonly [ProductRelationType, string, string, string]>([
    ["depends_on", "depends on", "is depended on by", "dependencies"],
    ["enables", "enables", "is enabled by", "dependencies"],
    ["deployed_as", "is deployed as", "deploys", "realization"],
    ["verified_by", "is verified by", "verifies", "assurance"],
    ["variant_of", "is a variant of", "has variant", "variants"],
  ])("describes %s with direction and lens membership", (type, label, reverseLabel, lens) => {
    expect(productRelationSemantics[type]).toMatchObject({ label, reverseLabel });
    expect(productRelationSemantics[type].lenses).toContain(lens);
  });

  it("derives forward and reverse statements without duplicating stored edges", () => {
    expect(relationStatement("Capability A", "depends_on", "Capability B", "forward")).toBe(
      "Capability A depends on Capability B.",
    );
    expect(relationStatement("Capability A", "depends_on", "Capability B", "reverse")).toBe(
      "Capability B is depended on by Capability A.",
    );
  });
});
