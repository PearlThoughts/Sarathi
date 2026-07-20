import { and, cosineDistance, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type KnowledgeAclRule,
  type KnowledgeEmbeddingPort,
  type KnowledgeRepository,
  type KnowledgeSearchResult,
  type KnowledgeSourceDocument,
  type KnowledgeSourceKind,
  type KnowledgeSourceSnapshot,
  type RankedKnowledgeCandidate,
  reciprocalRankFusion,
} from "../../modules/knowledge-layer/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  knowledgeAclBindingTable,
  knowledgeItemTable,
  knowledgePassageTable,
  knowledgeProjectionTable,
  knowledgeSourceTable,
  knowledgeSyncCheckpointTable,
  knowledgeVersionTable,
} from "./knowledge-schema.ts";

type SearchRow = {
  readonly id: string;
  readonly source: KnowledgeSourceKind;
  readonly source_id: string;
  readonly external_id: string;
  readonly title: string;
  readonly body: string;
  readonly canonical_url: string;
  readonly source_updated_at: string | Date;
  readonly sensitivity: SensitivityTier;
  readonly authority: number;
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const itemId = (document: KnowledgeSourceDocument): string =>
  `knowledge-item:${stableSha256(`${document.workspaceId}:${document.sourceId}:${document.externalId}`)}`;

const effectiveVersion = (document: KnowledgeSourceDocument): string =>
  stableSha256(
    canonicalize({
      sourceVersion: document.sourceVersion,
      title: document.title,
      sensitivity: document.sensitivity,
      authority: document.authority,
      acl: document.acl,
      passages: document.passages,
      provenance: document.provenance,
    }),
  );

const citationUrl = (document: KnowledgeSourceDocument, locator: string): string => {
  const url = new URL(document.canonicalUrl);
  url.hash = locator.replace(/^#/, "");
  return url.toString();
};

const freshness = (sourceUpdatedAt: string | Date): number => {
  const time = new Date(sourceUpdatedAt).getTime();
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  return Math.max(0, 1 - ageDays / 90);
};

const rankCandidate = (row: SearchRow): RankedKnowledgeCandidate => ({
  id: row.id,
  source: row.source,
  authority: Number(row.authority),
  freshness: freshness(row.source_updated_at),
});

const valuesFromResult = (result: unknown): readonly SearchRow[] => {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  return (result as { readonly rows: readonly SearchRow[] }).rows;
};

const authorizedPassages = (
  workspaceId: string,
  maximumSensitivity: SensitivityTier,
  audienceIds: readonly string[],
  actorId: string | undefined,
) => {
  const maximumSensitivityRank = {
    public: 0,
    internal: 1,
    confidential: 2,
    restricted: 3,
  }[maximumSensitivity];
  const audiencePredicate =
    audienceIds.length === 0
      ? sql`false`
      : sql`allow_acl.subject_id in (${sql.join(
          audienceIds.map((audienceId) => sql`${audienceId}`),
          sql`, `,
        )})`;
  const deniedAudiencePredicate =
    audienceIds.length === 0
      ? sql`false`
      : sql`deny_acl.subject_id in (${sql.join(
          audienceIds.map((audienceId) => sql`${audienceId}`),
          sql`, `,
        )})`;
  return sql`
    select
      p.id,
      s.kind as source,
      s.id as source_id,
      p.title,
      p.canonical_url,
      p.source_updated_at,
      p.sensitivity,
      i.authority,
      i.external_id,
      p.locator
    from ${knowledgePassageTable} p
    join ${knowledgeItemTable} i on i.id = p.item_id
    join ${knowledgeVersionTable} v on v.id = p.version_id
    join ${knowledgeSourceTable} s on s.id = i.source_id
    where p.workspace_id = ${workspaceId}
      and i.workspace_id = ${workspaceId}
      and v.workspace_id = ${workspaceId}
      and s.workspace_id = ${workspaceId}
      and p.active = true
      and v.active = true
      and v.tombstone = false
      and i.deleted_at is null
      and s.active = true
      and case p.sensitivity
        when 'public' then 0
        when 'internal' then 1
        when 'confidential' then 2
        when 'restricted' then 3
        else 99
      end <= ${maximumSensitivityRank}
      and exists (
        select 1 from ${knowledgeAclBindingTable} allow_acl
        where allow_acl.passage_id = p.id
          and allow_acl.workspace_id = ${workspaceId}
          and allow_acl.effect = 'allow'
          and (
            (allow_acl.subject_type = 'workspace' and allow_acl.subject_id = ${workspaceId})
            or (allow_acl.subject_type = 'audience' and ${audiencePredicate})
            or (allow_acl.subject_type = 'actor' and allow_acl.subject_id = ${actorId ?? ""})
          )
      )
      and not exists (
        select 1 from ${knowledgeAclBindingTable} deny_acl
        where deny_acl.passage_id = p.id
          and deny_acl.workspace_id = ${workspaceId}
          and deny_acl.effect = 'deny'
          and (
            (deny_acl.subject_type = 'workspace' and deny_acl.subject_id = ${workspaceId})
            or (deny_acl.subject_type = 'audience' and ${deniedAudiencePredicate})
            or (deny_acl.subject_type = 'actor' and deny_acl.subject_id = ${actorId ?? ""})
          )
      )`;
};

const syncAcl = async (
  database: KnowledgePostgresDatabase,
  passageIds: readonly string[],
  workspaceId: string,
  rules: readonly KnowledgeAclRule[],
  now: string,
): Promise<void> => {
  if (passageIds.length === 0) return;
  await database
    .delete(knowledgeAclBindingTable)
    .where(inArray(knowledgeAclBindingTable.passageId, passageIds));
  const rows = passageIds.flatMap((passageId) =>
    rules.map((rule) => ({
      id: `knowledge-acl:${stableSha256(`${passageId}:${rule.subjectType}:${rule.subjectId}:${rule.effect}`)}`,
      workspaceId,
      passageId,
      subjectType: rule.subjectType,
      subjectId: rule.subjectId,
      effect: rule.effect,
      createdAt: now,
    })),
  );
  if (rows.length > 0) await database.insert(knowledgeAclBindingTable).values(rows);
};

const reconcileSnapshot = async (
  database: KnowledgePostgresDatabase,
  snapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
  vectors: readonly (readonly number[])[],
) =>
  database.transaction(async (transaction) => {
    const now = new Date().toISOString();
    const firstDocument = snapshot.documents[0];
    await transaction
      .insert(knowledgeSourceTable)
      .values({
        id: snapshot.sourceId,
        workspaceId: snapshot.workspaceId,
        kind: snapshot.source,
        authority: firstDocument?.authority ?? 0,
        scopeHash: snapshot.scopeHash,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: knowledgeSourceTable.id,
        set: {
          scopeHash: snapshot.scopeHash,
          authority: firstDocument?.authority ?? 0,
          active: true,
          updatedAt: now,
        },
      });

    const existingItems = await transaction
      .select({ id: knowledgeItemTable.id, externalId: knowledgeItemTable.externalId })
      .from(knowledgeItemTable)
      .where(
        and(
          eq(knowledgeItemTable.sourceId, snapshot.sourceId),
          eq(knowledgeItemTable.workspaceId, snapshot.workspaceId),
          isNull(knowledgeItemTable.deletedAt),
        ),
      );
    const observedExternalIds = snapshot.documents.map(({ externalId }) => externalId);
    const deletedItems = existingItems.filter(
      ({ externalId }) => !observedExternalIds.includes(externalId),
    );
    if (deletedItems.length > 0) {
      const deletedIds = deletedItems.map(({ id }) => id);
      await transaction
        .update(knowledgeItemTable)
        .set({ deletedAt: now, observedAt: now })
        .where(inArray(knowledgeItemTable.id, deletedIds));
      await transaction
        .update(knowledgeVersionTable)
        .set({ active: false, tombstone: true, observedAt: now })
        .where(inArray(knowledgeVersionTable.itemId, deletedIds));
      await transaction
        .update(knowledgePassageTable)
        .set({ active: false })
        .where(inArray(knowledgePassageTable.itemId, deletedIds));
    }

    let vectorOffset = 0;
    let versionsCreated = 0;
    let passagesActive = 0;
    for (const document of snapshot.documents) {
      const documentItemId = itemId(document);
      const versionHash = effectiveVersion(document);
      const versionId = `knowledge-version:${stableSha256(`${documentItemId}:${versionHash}`)}`;
      const passageVectors = vectors.slice(vectorOffset, vectorOffset + document.passages.length);
      vectorOffset += document.passages.length;
      await transaction
        .insert(knowledgeItemTable)
        .values({
          id: documentItemId,
          sourceId: document.sourceId,
          workspaceId: document.workspaceId,
          externalId: document.externalId,
          sourceType: document.sourceType,
          canonicalUrl: document.canonicalUrl,
          title: document.title,
          sensitivity: document.sensitivity,
          authority: document.authority,
          sourceUpdatedAt: document.sourceUpdatedAt,
          observedAt: now,
        })
        .onConflictDoUpdate({
          target: knowledgeItemTable.id,
          set: {
            canonicalUrl: document.canonicalUrl,
            title: document.title,
            sensitivity: document.sensitivity,
            authority: document.authority,
            sourceUpdatedAt: document.sourceUpdatedAt,
            observedAt: now,
            deletedAt: null,
          },
        });

      const existingVersion = await transaction
        .select({ id: knowledgeVersionTable.id })
        .from(knowledgeVersionTable)
        .where(eq(knowledgeVersionTable.id, versionId))
        .limit(1);
      if (existingVersion.length === 0) {
        versionsCreated += 1;
        await transaction
          .update(knowledgeVersionTable)
          .set({ active: false })
          .where(eq(knowledgeVersionTable.itemId, documentItemId));
        await transaction
          .update(knowledgePassageTable)
          .set({ active: false })
          .where(eq(knowledgePassageTable.itemId, documentItemId));
        await transaction.insert(knowledgeVersionTable).values({
          id: versionId,
          itemId: documentItemId,
          workspaceId: document.workspaceId,
          sourceVersion: versionHash,
          contentHash: versionHash,
          sourceUpdatedAt: document.sourceUpdatedAt,
          observedAt: now,
          active: true,
          tombstone: false,
          provenance: { ...document.provenance, sourceVersion: document.sourceVersion },
        });
        for (const [passageIndex, passage] of document.passages.entries()) {
          const vector = passageVectors[passageIndex];
          if (vector === undefined || vector.length !== embeddings.dimensions)
            throw new Error("Embedding result count or dimensions did not match passages.");
          const passageId = `knowledge-passage:${stableSha256(`${versionId}:${passage.locator}`)}`;
          await transaction.insert(knowledgePassageTable).values({
            id: passageId,
            itemId: documentItemId,
            versionId,
            workspaceId: document.workspaceId,
            kind: passage.kind,
            locator: passage.locator,
            ordinal: passage.ordinal,
            title: passage.title,
            body: passage.body,
            contentHash: passage.contentHash,
            canonicalUrl: citationUrl(document, passage.locator),
            sensitivity: document.sensitivity,
            sourceUpdatedAt: document.sourceUpdatedAt,
            active: true,
          });
          await transaction.insert(knowledgeProjectionTable).values({
            passageId,
            workspaceId: document.workspaceId,
            embeddingModel: embeddings.model,
            embeddingDimensions: embeddings.dimensions,
            embedding: [...vector],
            contentHash: passage.contentHash,
            createdAt: now,
          });
        }
      } else {
        await transaction
          .update(knowledgeVersionTable)
          .set({ active: false })
          .where(
            and(
              eq(knowledgeVersionTable.itemId, documentItemId),
              ne(knowledgeVersionTable.id, versionId),
            ),
          );
        await transaction
          .update(knowledgePassageTable)
          .set({ active: false })
          .where(eq(knowledgePassageTable.itemId, documentItemId));
        await transaction
          .update(knowledgeVersionTable)
          .set({ active: true, tombstone: false, observedAt: now })
          .where(eq(knowledgeVersionTable.id, versionId));
        await transaction
          .update(knowledgePassageTable)
          .set({ active: true })
          .where(eq(knowledgePassageTable.versionId, versionId));
        const restoredPassages = await transaction
          .select({
            id: knowledgePassageTable.id,
            ordinal: knowledgePassageTable.ordinal,
            contentHash: knowledgePassageTable.contentHash,
          })
          .from(knowledgePassageTable)
          .where(eq(knowledgePassageTable.versionId, versionId));
        for (const passage of restoredPassages) {
          const vector = passageVectors[passage.ordinal];
          if (vector === undefined || vector.length !== embeddings.dimensions)
            throw new Error("Embedding result count or dimensions did not match passages.");
          await transaction
            .insert(knowledgeProjectionTable)
            .values({
              passageId: passage.id,
              workspaceId: document.workspaceId,
              embeddingModel: embeddings.model,
              embeddingDimensions: embeddings.dimensions,
              embedding: [...vector],
              contentHash: passage.contentHash,
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: knowledgeProjectionTable.passageId,
              set: {
                embeddingModel: embeddings.model,
                embeddingDimensions: embeddings.dimensions,
                embedding: [...vector],
                contentHash: passage.contentHash,
                createdAt: now,
              },
            });
        }
      }
      const activePassages = await transaction
        .select({ id: knowledgePassageTable.id })
        .from(knowledgePassageTable)
        .where(
          and(
            eq(knowledgePassageTable.versionId, versionId),
            eq(knowledgePassageTable.active, true),
          ),
        );
      passagesActive += activePassages.length;
      await syncAcl(
        transaction,
        activePassages.map(({ id }) => id),
        document.workspaceId,
        document.acl,
        now,
      );
    }

    const checksum = stableSha256(
      canonicalize({
        sourceId: snapshot.sourceId,
        cursor: snapshot.cursor,
        scopeHash: snapshot.scopeHash,
        documents: snapshot.documents.map(({ externalId, sourceVersion, passages, acl }) => ({
          externalId,
          sourceVersion,
          passages: passages.map(({ locator, contentHash }) => ({ locator, contentHash })),
          acl,
        })),
      }),
    );
    const summary = {
      sourceId: snapshot.sourceId,
      workspaceId: snapshot.workspaceId,
      cursor: snapshot.cursor,
      scopeHash: snapshot.scopeHash,
      documentsObserved: snapshot.documents.length,
      versionsCreated,
      passagesActive,
      itemsDeleted: deletedItems.length,
      checksum,
    } as const;
    await transaction
      .insert(knowledgeSyncCheckpointTable)
      .values({ ...summary, status: "succeeded", errorCode: null, syncedAt: now })
      .onConflictDoUpdate({
        target: [knowledgeSyncCheckpointTable.sourceId, knowledgeSyncCheckpointTable.workspaceId],
        set: { ...summary, status: "succeeded", errorCode: null, syncedAt: now },
      });
    return summary;
  });

export const createPostgresKnowledgeRepository = (
  database: KnowledgePostgresDatabase,
): KnowledgeRepository => ({
  reconcile: (snapshot, embeddings) => {
    if (embeddings.dimensions !== 1536) {
      return Effect.fail(
        new RepositoryError({
          message: "Knowledge embedding dimensions must be 1536 for the active projection schema.",
          operation: "knowledge-reconcile",
        }),
      );
    }
    const passageBodies = snapshot.documents.flatMap((document) =>
      document.passages.map(({ body }) => body),
    );
    const embedded =
      passageBodies.length === 0
        ? Effect.succeed([] as readonly number[][])
        : embeddings.embed(passageBodies);
    return embedded.pipe(
      Effect.flatMap((vectors) =>
        Effect.tryPromise({
          try: () => reconcileSnapshot(database, snapshot, embeddings, vectors),
          catch: () =>
            new RepositoryError({
              message:
                "Knowledge reconciliation failed; the previous checkpoint remains authoritative.",
              operation: "knowledge-reconcile",
            }),
        }),
      ),
    );
  },
  search: (query, queryEmbedding) =>
    Effect.tryPromise({
      try: async () => {
        if (queryEmbedding.length !== 1536)
          throw new Error("Query embedding dimensions do not match the active projection schema.");
        const authorized = authorizedPassages(
          query.audience.workspaceId,
          query.audience.maximumSensitivity,
          query.audience.audienceIds,
          query.audience.actorId,
        );
        const limit = Math.max(1, Math.min(query.topK, 50));
        const [exactResult, keywordResult, vectorResult] = await Promise.all([
          database.execute(sql`
            with authorized as materialized (${authorized})
            select authorized.*, content.body from authorized
            join ${knowledgePassageTable} content on content.id = authorized.id
            where position(lower(authorized.external_id) in lower(${query.question})) > 0
               or position(lower(replace(authorized.locator, '#', '')) in lower(${query.question})) > 0
            order by length(authorized.external_id) desc, authorized.source_updated_at desc
            limit ${limit}`),
          database.execute(sql`
            with authorized as materialized (${authorized}), query as (
              select websearch_to_tsquery('english', ${query.question}) as value
            )
            select authorized.*, content.body from authorized
            join ${knowledgePassageTable} content on content.id = authorized.id
            cross join query
            where to_tsvector('english', authorized.title || ' ' || content.body) @@ query.value
            order by ts_rank_cd(to_tsvector('english', authorized.title || ' ' || content.body), query.value) desc,
                     authorized.source_updated_at desc
            limit ${limit}`),
          database.execute(sql`
            with authorized as materialized (${authorized})
            select authorized.*, content.body from authorized
            join ${knowledgeProjectionTable} projection on projection.passage_id = authorized.id
            join ${knowledgePassageTable} content on content.id = authorized.id
            order by ${cosineDistance(sql`projection.embedding`, [...queryEmbedding])}
            limit ${limit}`),
        ]);
        const rowsById = new Map<string, SearchRow>();
        const lists = {
          exact: valuesFromResult(exactResult),
          keyword: valuesFromResult(keywordResult),
          vector: valuesFromResult(vectorResult),
        };
        for (const row of [...lists.exact, ...lists.keyword, ...lists.vector])
          rowsById.set(row.id, row);
        return reciprocalRankFusion({
          exact: lists.exact.map(rankCandidate),
          keyword: lists.keyword.map(rankCandidate),
          vector: lists.vector.map(rankCandidate),
        })
          .slice(0, limit)
          .flatMap((candidate): readonly KnowledgeSearchResult[] => {
            const row = rowsById.get(candidate.id);
            return row === undefined
              ? []
              : [
                  {
                    id: row.id,
                    source: row.source,
                    sourceId: row.external_id,
                    title: row.title,
                    excerpt: row.body.replace(/\s+/g, " ").trim().slice(0, 1200),
                    citationUrl: row.canonical_url,
                    sourceUpdatedAt: new Date(row.source_updated_at).toISOString(),
                    sensitivity: row.sensitivity,
                    authority: Number(row.authority),
                    freshness: freshness(row.source_updated_at),
                    componentRanks: candidate.componentRanks,
                    score: candidate.fusedScore,
                  },
                ];
          });
      },
      catch: () =>
        new RepositoryError({
          message: "Authorized hybrid knowledge retrieval failed.",
          operation: "knowledge-query",
        }),
    }),
});
