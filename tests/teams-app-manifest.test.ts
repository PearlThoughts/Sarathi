import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type TeamsManifest = {
  readonly manifestVersion?: unknown;
  readonly version?: unknown;
  readonly bots?: readonly {
    readonly scopes?: readonly string[];
  }[];
  readonly authorization?: {
    readonly permissions?: {
      readonly resourceSpecific?: readonly {
        readonly name?: unknown;
        readonly type?: unknown;
      }[];
    };
  };
  readonly supportsChannelFeatures?: unknown;
  readonly supportedChannelTypes?: unknown;
};

const readManifest = async (): Promise<TeamsManifest> =>
  JSON.parse(
    await readFile(new URL("../appPackage/manifest.json", import.meta.url), "utf8"),
  ) as TeamsManifest;

describe("Teams app manifest", () => {
  it("requests only the admitted team and chat message and membership RSC", async () => {
    const manifest = await readManifest();
    const resourceSpecific = manifest.authorization?.permissions?.resourceSpecific ?? [];

    expect(manifest.manifestVersion).toBe("1.25");
    expect(manifest.version).toBe("1.0.6");
    expect(manifest.bots).toEqual([expect.objectContaining({ scopes: ["team", "groupChat"] })]);
    expect(resourceSpecific).toEqual([
      { name: "ChannelMessage.Read.Group", type: "Application" },
      { name: "TeamMember.Read.Group", type: "Application" },
      { name: "ChannelMember.Read.Group", type: "Application" },
      { name: "ChatMessage.Read.Chat", type: "Application" },
      { name: "ChatMember.Read.Chat", type: "Application" },
    ]);
    expect(manifest.supportsChannelFeatures).toBe("tier1");
    expect(manifest.supportedChannelTypes).toBeUndefined();
  });
});
