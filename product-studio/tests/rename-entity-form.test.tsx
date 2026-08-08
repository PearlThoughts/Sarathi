import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenameEntityForm } from "../src/views/RenameEntityForm";

describe("Product Studio governed rename form", () => {
  it("renders labeled preview controls and a polite workflow status region", () => {
    const markup = renderToStaticMarkup(
      <RenameEntityForm
        canonicalAliasId="alias-synthetic-command"
        canonicalName="Synthetic Capability"
        entityId="00000000-0000-4000-8000-000000000201"
        revision={4}
      />,
    );

    expect(markup).toContain('id="rename-entity-title"');
    expect(markup).toContain('for="canonical-name"');
    expect(markup).toContain('for="rename-justification"');
    expect(markup).toContain('name="canonicalName"');
    expect(markup).toContain('name="justification"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Preview Rename");
    expect(markup).not.toContain("Confirm Rename");
  });
});
