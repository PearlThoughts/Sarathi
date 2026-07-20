import type { DeliveryAnswerComposer } from "../../modules/delivery-intelligence/index.ts";
import type { GroundedAnswerGenerator } from "../../modules/teams-mention/index.ts";

export const createAiSdkDeliveryAnswerComposer = (
  generator: GroundedAnswerGenerator,
): DeliveryAnswerComposer => ({
  compose: (input) => {
    const itemInformation = input.items.map((item) => ({
      source: item.source,
      sourceId: item.id,
      sourceUrl: item.citationUrl,
      title: `${item.intent.replaceAll("_", " ")}: ${item.title}`,
      excerpt: item.summary,
      occurredAt: item.observedAt ?? input.requestedAt,
      updatedAt: item.observedAt ?? input.requestedAt,
      sensitivity: item.sensitivity,
      freshness: "current" as const,
    }));
    const conflictInformation = input.conflicts.flatMap((conflict) =>
      conflict.claims.slice(0, 2).map((claim) => ({
        source: claim.source.source,
        sourceId: claim.id,
        sourceUrl: claim.source.citationUrl,
        title: `Conflict: ${conflict.subjectKey} ${conflict.predicate}`,
        excerpt: `${conflict.subjectKey} ${conflict.predicate}: ${String(claim.value)} (attributed to ${claim.assertedBy ?? claim.source.source})`,
        occurredAt: claim.observedAt,
        updatedAt: claim.observedAt,
        sensitivity: claim.sensitivity,
        freshness: "current" as const,
      })),
    );
    return generator.generate({
      workspaceId: input.workspaceId,
      question: input.question,
      evidence: [...itemInformation, ...conflictInformation],
    });
  },
});
