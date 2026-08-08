import { stableSha256 } from "../../../domain/hash.ts";
import type {
  ProductPreviewTokenClaims,
  ProductPreviewTokenCodec,
} from "../application/product-model-commands.ts";

export const createInMemoryProductPreviewTokenCodec = (): ProductPreviewTokenCodec => {
  const tokens = new Map<string, ProductPreviewTokenClaims>();
  return {
    issue: (claims) => {
      const token = stableSha256(JSON.stringify(claims));
      tokens.set(token, structuredClone(claims));
      return token;
    },
    verify: (token, claims) => {
      const issued = tokens.get(token);
      return (
        issued !== undefined &&
        issued.commandHash === claims.commandHash &&
        issued.actorId === claims.actorId &&
        issued.workspaceId === claims.workspaceId &&
        issued.policyVersion === claims.policyVersion &&
        issued.expectedRevision === claims.expectedRevision &&
        Date.parse(issued.expiresAt) > Date.parse(claims.now)
      );
    },
  };
};
