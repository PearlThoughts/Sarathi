import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ProductPreviewTokenClaims,
  ProductPreviewTokenCodec,
} from "../../modules/product-model/index.ts";

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const signature = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const safeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const decodeClaims = (payload: string): ProductPreviewTokenClaims | undefined => {
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    const claims = value as Partial<ProductPreviewTokenClaims>;
    return typeof claims.commandHash === "string" &&
      typeof claims.actorId === "string" &&
      typeof claims.workspaceId === "string" &&
      typeof claims.policyVersion === "string" &&
      typeof claims.expectedRevision === "number" &&
      typeof claims.expiresAt === "string"
      ? (claims as ProductPreviewTokenClaims)
      : undefined;
  } catch {
    return undefined;
  }
};

export const createHmacProductPreviewTokenCodec = (secret: string): ProductPreviewTokenCodec => {
  if (secret.length < 32)
    throw new Error("Product-model preview secret must be at least 32 bytes.");
  return {
    issue: (claims) => {
      const payload = encode(JSON.stringify(claims));
      return `${payload}.${signature(secret, payload)}`;
    },
    verify: (token, expected) => {
      const [payload, suppliedSignature, extra] = token.split(".");
      if (payload === undefined || suppliedSignature === undefined || extra !== undefined)
        return false;
      if (!safeEqual(suppliedSignature, signature(secret, payload))) return false;
      const claims = decodeClaims(payload);
      return (
        claims !== undefined &&
        claims.commandHash === expected.commandHash &&
        claims.actorId === expected.actorId &&
        claims.workspaceId === expected.workspaceId &&
        claims.policyVersion === expected.policyVersion &&
        claims.expectedRevision === expected.expectedRevision &&
        Number.isFinite(Date.parse(claims.expiresAt)) &&
        Date.parse(claims.expiresAt) > Date.parse(expected.now)
      );
    },
  };
};
