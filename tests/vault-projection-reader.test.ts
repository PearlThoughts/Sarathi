import { describe, expect, it } from "vitest";
import {
  createVaultProjectionReader,
  vaultProjectionFromEnvironment,
} from "../src/infrastructure/vault/index.ts";

describe("vault projection reader", () => {
  it("returns only exact workspace and source-key records", async () => {
    const projection = vaultProjectionFromEnvironment({
      SARATHI_VAULT_PROJECTION_JSON: JSON.stringify({
        records: [
          {
            workspaceId: "workspace",
            sourceKey: "vault:delivery",
            externalId: "note",
            occurredAt: "2026-07-11T00:00:00.000Z",
            title: "Approved",
            externalUrl: "https://vault.example.test/note",
            sensitivity: "internal",
            consent: {
              status: "granted",
              scope: "delivery",
              recordedAt: "2026-07-11T00:00:00.000Z",
            },
          },
          {
            workspaceId: "other",
            sourceKey: "vault:delivery",
            externalId: "other",
            occurredAt: "2026-07-11T00:00:00.000Z",
            title: "Excluded",
            consent: {
              status: "granted",
              scope: "delivery",
              recordedAt: "2026-07-11T00:00:00.000Z",
            },
          },
        ],
      }),
    });
    await expect(
      createVaultProjectionReader(projection).readEvidence({
        workspaceId: "workspace",
        sourceKey: "vault:delivery",
      }),
    ).resolves.toMatchObject({ records: [{ sourceSystem: "vault", externalId: "note" }] });
  });

  it("rejects an absent private projection", () => {
    expect(() => vaultProjectionFromEnvironment({})).toThrow(
      "SARATHI_VAULT_PROJECTION_JSON is required",
    );
  });
});
