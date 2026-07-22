import type { DeliveryObjectKind, DeliverySourceKind } from "./delivery-model.ts";
import type { DeliveryObjectDraft } from "./delivery-projection.ts";

export type DeliveryEntityAlias = {
  readonly value: string;
  readonly source?: DeliverySourceKind | undefined;
};

export type DeliveryEntityDefinition = {
  readonly kind: DeliveryObjectKind;
  readonly canonicalKey: string;
  readonly title: string;
  readonly aliases: readonly DeliveryEntityAlias[];
};

export type DeliveryEntityCatalog = {
  readonly version: 1;
  readonly entities: readonly DeliveryEntityDefinition[];
};

export type ResolvedDeliveryEntity = {
  readonly canonicalKey: string;
  readonly canonicalTitle: string;
  readonly aliases: readonly string[];
};

const deliveryObjectKinds = new Set<DeliveryObjectKind>([
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

const deliverySourceKinds = new Set<DeliverySourceKind>([
  "jira",
  "vault",
  "github",
  "teams",
  "email",
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeDeliveryEntityAlias = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const attributeAliases = (attributes: Readonly<Record<string, unknown>>): readonly string[] => {
  const value = attributes.aliases;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const canonicalIdentity = (kind: DeliveryObjectKind, key: string): string => {
  const normalized = normalizeDeliveryEntityAlias(key);
  if (normalized === "") throw new Error("Delivery canonical entity key must not be blank.");
  return `${kind}:${normalized.replaceAll(" ", "-")}`;
};

export const validateDeliveryEntityCatalog = (
  catalog: DeliveryEntityCatalog,
): DeliveryEntityCatalog => {
  if (!isRecord(catalog) || catalog.version !== 1 || !Array.isArray(catalog.entities))
    throw new Error("Delivery entity catalog shape or version is unsupported.");
  const canonicalKeys = new Set<string>();
  const aliasOwners = new Map<string, string>();
  for (const entity of catalog.entities) {
    if (
      !isRecord(entity) ||
      typeof entity.kind !== "string" ||
      !deliveryObjectKinds.has(entity.kind as DeliveryObjectKind) ||
      typeof entity.canonicalKey !== "string" ||
      typeof entity.title !== "string" ||
      !Array.isArray(entity.aliases)
    )
      throw new Error("Delivery entity catalog contains an invalid entity definition.");
    const canonicalKey = canonicalIdentity(entity.kind as DeliveryObjectKind, entity.canonicalKey);
    if (canonicalKeys.has(canonicalKey))
      throw new Error("Delivery entity catalog contains a duplicate canonical key.");
    canonicalKeys.add(canonicalKey);
    if (entity.title.trim() === "" || entity.aliases.length === 0)
      throw new Error("Delivery entity catalog entries require a title and aliases.");
    for (const alias of entity.aliases) {
      if (
        !isRecord(alias) ||
        typeof alias.value !== "string" ||
        (alias.source !== undefined &&
          (typeof alias.source !== "string" ||
            !deliverySourceKinds.has(alias.source as DeliverySourceKind)))
      )
        throw new Error("Delivery entity catalog contains an invalid alias definition.");
      const normalized = normalizeDeliveryEntityAlias(alias.value);
      if (normalized === "") throw new Error("Delivery entity aliases must not be blank.");
      const lookupKey = `${entity.kind}\u0000${alias.source ?? "*"}\u0000${normalized}`;
      const overlappingKeys =
        alias.source === undefined
          ? [
              lookupKey,
              ...[...deliverySourceKinds].map(
                (source) => `${entity.kind}\u0000${source}\u0000${normalized}`,
              ),
            ]
          : [lookupKey, `${entity.kind}\u0000*\u0000${normalized}`];
      if (
        overlappingKeys.some((key) => {
          const owner = aliasOwners.get(key);
          return owner !== undefined && owner !== canonicalKey;
        })
      )
        throw new Error("Delivery entity catalog contains an ambiguous alias.");
      aliasOwners.set(lookupKey, canonicalKey);
    }
  }
  return catalog;
};

export const parseDeliveryEntityCatalog = (
  value: string | undefined,
): DeliveryEntityCatalog | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Delivery entity catalog must contain valid JSON.");
  }
  return validateDeliveryEntityCatalog(parsed as DeliveryEntityCatalog);
};

export const resolveDeliveryEntity = (
  catalog: DeliveryEntityCatalog | undefined,
  source: DeliverySourceKind,
  object: DeliveryObjectDraft,
): ResolvedDeliveryEntity => {
  const candidates = [object.externalKey, object.title, ...attributeAliases(object.attributes)];
  const normalizedCandidates = new Set(
    candidates.map(normalizeDeliveryEntityAlias).filter((value) => value !== ""),
  );
  const definitions = (catalog?.entities ?? []).filter(
    (entity) =>
      entity.kind === object.kind &&
      entity.aliases.some(
        (alias) =>
          (alias.source === undefined || alias.source === source) &&
          normalizedCandidates.has(normalizeDeliveryEntityAlias(alias.value)),
      ),
  );
  const canonicalIdentities = new Set(
    definitions.map((definition) => canonicalIdentity(definition.kind, definition.canonicalKey)),
  );
  if (canonicalIdentities.size > 1)
    throw new Error("Delivery object matches multiple canonical entity definitions.");
  const definition = definitions[0];
  const canonicalKey =
    definition === undefined
      ? canonicalIdentity(object.kind, object.externalKey)
      : canonicalIdentity(definition.kind, definition.canonicalKey);
  return {
    canonicalKey,
    canonicalTitle: definition?.title ?? object.title,
    aliases: [
      ...new Set(
        [
          ...candidates,
          ...(definition?.aliases.map(({ value }) => value) ?? []),
          canonicalKey,
        ].filter((value) => value.trim() !== ""),
      ),
    ],
  };
};
