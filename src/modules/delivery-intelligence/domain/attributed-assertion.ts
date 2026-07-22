import type { DeliveryObjectKind } from "./delivery-model.ts";

export type AttributedDeliveryAssertionEnvelope = {
  readonly schemaVersion: 1;
  readonly assertionId: string;
  readonly subject: {
    readonly kind: DeliveryObjectKind;
    readonly key: string;
    readonly title: string;
    readonly aliases: readonly string[];
  };
  readonly author: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly assertedAt: string;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | undefined;
  readonly confidence: number;
  readonly supersedes: readonly string[];
};

const objectKinds = new Set<DeliveryObjectKind>([
  "project",
  "goal",
  "commitment",
  "action",
  "assumption",
  "policy",
  "person",
  "team",
  "module",
  "requirement",
  "milestone",
  "sprint",
  "work_item",
  "deliverable",
  "risk",
  "decision",
  "extension",
]);

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const identifier = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:/-]{1,159}$/i.test(value.trim()))
    throw new Error(`${name} must be a stable identifier.`);
  return value.trim();
};

const label = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > 160)
    throw new Error(`${name} must be a non-blank label of at most 160 characters.`);
  return value.trim();
};

const timestamp = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`${name} must be an ISO timestamp.`);
  return new Date(value).toISOString();
};

const identifiers = (value: unknown, name: string): readonly string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50)
    throw new Error(`${name} must be a bounded identifier list.`);
  const values = value.map((entry) => identifier(entry, name));
  if (new Set(values).size !== values.length)
    throw new Error(`${name} must not contain duplicates.`);
  return values;
};

export const parseAttributedDeliveryAssertion = (
  value: unknown,
): AttributedDeliveryAssertionEnvelope => {
  const input = record(value);
  if (input === undefined)
    throw new Error("Attributed delivery assertion schema_version must be 1.");
  const subject = record(input.subject);
  const author = record(input.author);
  const schemaVersion = input.schema_version;
  const kind = subject?.kind;
  const confidence = input.confidence;
  if (schemaVersion !== 1)
    throw new Error("Attributed delivery assertion schema_version must be 1.");
  if (typeof kind !== "string" || !objectKinds.has(kind as DeliveryObjectKind))
    throw new Error("Attributed delivery assertion subject kind is invalid.");
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  )
    throw new Error("Attributed delivery assertion confidence must be between zero and one.");
  const assertedAt = timestamp(input.asserted_at, "asserted_at");
  if (assertedAt === undefined)
    throw new Error("Attributed delivery assertion asserted_at is required.");
  const effectiveFrom = timestamp(input.effective_from, "effective_from");
  const effectiveTo = timestamp(input.effective_to, "effective_to");
  if (
    effectiveFrom !== undefined &&
    effectiveTo !== undefined &&
    Date.parse(effectiveFrom) >= Date.parse(effectiveTo)
  )
    throw new Error("Attributed delivery assertion effective dates are invalid.");

  return {
    schemaVersion,
    assertionId: identifier(input.assertion_id, "assertion_id"),
    subject: {
      kind: kind as DeliveryObjectKind,
      key: identifier(subject?.key, "subject.key"),
      title: label(subject?.title, "subject.title"),
      aliases: identifiers(subject?.aliases, "subject.aliases"),
    },
    author: {
      id: identifier(author?.id, "author.id"),
      displayName: label(author?.display_name, "author.display_name"),
    },
    assertedAt,
    ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
    confidence,
    supersedes: identifiers(input.supersedes, "supersedes"),
  };
};
