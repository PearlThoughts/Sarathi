import { describe, expect, it } from "vitest";
import {
  type EvidenceConsent,
  type EvidenceConsentStatus,
  type EvidenceImportRepository,
  type EvidenceImportSummary,
  type EvidenceSourceReader,
  type EvidenceSourceReadRequest,
  type EvidenceSourceReadResult,
  importEvidenceRecords,
  type NormalizedEvidenceRecord,
  parseLocalEvidenceExport,
} from "../src/modules/evidence-import/index.ts";
import type { EvidenceItem } from "../src/modules/strategy-kernel/index.ts";

const occurredAt = "2026-07-10T00:00:00.000Z";

const consentStatus: EvidenceConsentStatus = "granted";
const consent: EvidenceConsent = {
  status: consentStatus,
  scope: "delivery-channel",
  recordedAt: occurredAt,
  recordedBy: "actor-synthetic-owner",
};

const record: NormalizedEvidenceRecord = {
  sourceSystem: "teams",
  sourceType: "message",
  externalId: "message-001",
  occurredAt,
  title: "Synthetic delivery update",
  body: "The synthetic delivery owner committed to a verification check.",
  externalUrl: "https://example.invalid/messages/001",
  actorId: "actor-synthetic-owner",
  sensitivity: "internal",
  consent,
};

const memoryRepository = () => {
  const evidence = new Map<string, EvidenceItem>();
  const watermarks = new Map<
    string,
    { readonly contentHash: string; readonly lastCursor: string }
  >();

  const repository: EvidenceImportRepository = {
    withTransaction: async (operation) => operation(repository),
    saveEvidenceItem: async (item) => {
      evidence.set(`${item.workspaceId}:${item.sourceSystem}:${item.externalId}`, item);
    },
    saveEvidenceImportWatermark: async (watermark) => {
      watermarks.set(`${watermark.workspaceId}:${watermark.sourceKey}`, watermark);
    },
  };

  return { evidence, repository, watermarks };
};

describe("evidence import contract", () => {
  it("normalizes consent metadata and gives absent legacy consent a safe explicit value", () => {
    const [normalized] = parseLocalEvidenceExport(JSON.stringify([record]));
    const [legacy] = parseLocalEvidenceExport(
      JSON.stringify([{ ...record, externalId: "message-legacy", consent: undefined }]),
    );

    expect(normalized).toMatchObject({
      externalId: "message-001",
      consent: { status: "granted", scope: "delivery-channel", recordedAt: occurredAt },
    });
    expect(legacy?.consent).toEqual({
      status: "unknown",
      scope: "source-export",
      recordedAt: occurredAt,
    });
  });

  it("persists a stable watermark and idempotently upserts the same source record", async () => {
    const memory = memoryRepository();

    const first: EvidenceImportSummary = await importEvidenceRecords(
      memory.repository,
      [record],
      "workspace-synthetic",
      "teams:delivery-channel",
      occurredAt,
    );
    const second = await importEvidenceRecords(
      memory.repository,
      [record],
      "workspace-synthetic",
      "teams:delivery-channel",
      "2026-07-10T00:01:00.000Z",
    );

    const saved = memory.evidence.get("workspace-synthetic:teams:message-001");
    expect(memory.evidence).toHaveLength(1);
    expect(saved).toMatchObject({
      contentHash: expect.stringMatching(/^sha256-/),
      consentStatus: "granted",
      consentScope: "delivery-channel",
    });
    expect(first.watermark.contentHash).toBe(second.watermark.contentHash);
    expect(memory.watermarks.get("workspace-synthetic:teams:delivery-channel")).toMatchObject({
      contentHash: first.watermark.contentHash,
      lastCursor: occurredAt,
    });
  });

  it("exposes a source-reader contract with no mutation capability", async () => {
    const request: EvidenceSourceReadRequest = {
      workspaceId: "workspace-synthetic",
      sourceKey: "teams:delivery-channel",
    };
    const expected: EvidenceSourceReadResult = { records: [record], nextCursor: occurredAt };
    const reader: EvidenceSourceReader = {
      readEvidence: async () => expected,
    };

    const result = await reader.readEvidence(request);

    expect(Object.keys(reader)).toEqual(["readEvidence"]);
    expect(result).toEqual({ records: [record], nextCursor: occurredAt });
  });
});
