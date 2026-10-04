import { getDeal } from "@/lib/solana";
import type { Condition, Evidence, UploadedDocument, VerificationCheck } from "@/lib/spacetime/module_bindings/types";
import { getServerSpacetimeConnection } from "@/lib/spacetime/server";
import { runVerificationChecks } from "@/lib/verification-service";
import { generateVerificationPlan } from "@/lib/verification-plan-service";

function iso(timestamp: { microsSinceUnixEpoch: bigint }) {
  return new Date(Number(timestamp.microsSinceUnixEpoch / 1_000n)).toISOString();
}

function newestFirst(a: { updatedAt: { microsSinceUnixEpoch: bigint } }, b: { updatedAt: { microsSinceUnixEpoch: bigint } }) {
  return a.updatedAt.microsSinceUnixEpoch > b.updatedAt.microsSinceUnixEpoch ? -1
    : a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? 1 : 0;
}

function oldestFirst(a: { createdAt: { microsSinceUnixEpoch: bigint } }, b: { createdAt: { microsSinceUnixEpoch: bigint } }) {
  return a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1
    : a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? 1 : 0;
}

function serializeCondition(row: Condition) {
  return {
    id: row.id.toString(),
    prompt: row.prompt,
    status: row.status,
    finalResult: row.finalResult ?? null,
    settlementStatus: row.settlementStatus,
    settlementSignature: row.settlementSignature ?? null,
    dealId: row.dealId?.toString() ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function serializeCheck(row: VerificationCheck) {
  return {
    id: row.id.toString(),
    sequence: row.sequence,
    kind: row.kind,
    label: row.label,
    instruction: row.instruction,
    status: row.status,
    passed: row.passed ?? null,
    summary: row.summary ?? null,
    evidenceCount: row.evidenceCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function serializeEvidence(row: Evidence) {
  return {
    id: row.id.toString(),
    checkId: row.checkId.toString(),
    sourceType: row.sourceType,
    title: row.title,
    url: row.url ?? null,
    snippet: row.snippet,
    authorOrSource: row.authorOrSource ?? null,
    publishedAt: row.sourcePublishedAt ?? null,
    createdAt: iso(row.createdAt),
  };
}

function serializeDocument(row: UploadedDocument) {
  return {
    id: row.id.toString(),
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteCount: row.byteCount.toString(),
    extractionStatus: row.extractionStatus,
    // The current app stores metadata only; it does not read document contents.
    contentAvailable: false,
    createdAt: iso(row.createdAt),
  };
}

export async function listAgentConditions() {
  const connection = await getServerSpacetimeConnection();
  return [...connection.db.condition.iter()]
    .sort(newestFirst)
    .slice(0, 30)
    .map(serializeCondition);
}

export async function getAgentCondition(conditionId: bigint) {
  const connection = await getServerSpacetimeConnection();
  const condition = [...connection.db.condition.iter()].find((row) => row.id === conditionId);
  if (!condition) return undefined;
  const checks = [...connection.db.verificationCheck.iter()]
    .filter((row) => row.conditionId === conditionId)
    .sort((a, b) => a.sequence - b.sequence);
  const checkIds = new Set(checks.map((row) => row.id));
  const evidence = [...connection.db.evidence.iter()]
    .filter((row) => row.conditionId === conditionId && checkIds.has(row.checkId))
    .sort(oldestFirst);
  const documents = [...connection.db.uploadedDocument.iter()]
    .filter((row) => row.conditionId === conditionId);

  let deal: Awaited<ReturnType<typeof getDeal>> | null = null;
  if (condition.dealId !== undefined) {
    const dealId = Number(condition.dealId);
    if (Number.isSafeInteger(dealId)) {
      try { deal = await getDeal(dealId); } catch { deal = null; }
    }
  }

  return {
    condition: serializeCondition(condition),
    checks: checks.map(serializeCheck),
    evidence: evidence.map(serializeEvidence),
    documents: documents.map(serializeDocument),
    deal,
  };
}

export async function createAgentCondition(prompt: string) {
  const plan = await generateVerificationPlan({ condition: prompt });
  const connection = await getServerSpacetimeConnection();
  const priorIds = new Set([...connection.db.condition.iter()].map((row) => row.id.toString()));
  await connection.reducers.createCondition({ prompt });
  const condition = await waitFor(() => [...connection.db.condition.iter()]
    .find((row) => !priorIds.has(row.id.toString())));
  if (!condition) throw new Error("The condition was created, but its database row did not arrive.");

  await connection.reducers.setConditionStatus({ conditionId: condition.id, status: "planning" });
  for (const [index, check] of plan.checks.entries()) {
    await connection.reducers.addVerificationCheck({
      conditionId: condition.id,
      sequence: index + 1,
      kind: check.kind,
      label: check.label,
      instruction: check.instruction,
    });
  }

  return { ...(await getAgentCondition(condition.id)), planSummary: plan.summary };
}

export async function runAgentVerification(conditionId: bigint) {
  const connection = await getServerSpacetimeConnection();
  const condition = [...connection.db.condition.iter()].find((row) => row.id === conditionId);
  if (!condition) return undefined;
  const checks = [...connection.db.verificationCheck.iter()]
    .filter((row) => row.conditionId === conditionId)
    .sort((a, b) => a.sequence - b.sequence);
  if (!checks.length) throw new Error("This condition has no verification checks.");
  if (checks.some((row) => row.status !== "pending")) throw new Error("This condition has already been checked. Create a new condition to run a fresh verification.");

  for (const check of checks) await connection.reducers.setCheckRunning({ checkId: check.id });
  const documents = [...connection.db.uploadedDocument.iter()].filter((row) => row.conditionId === conditionId);
  const outcome = await runVerificationChecks({
    condition: condition.prompt,
    hasDocument: documents.length > 0,
    checks: checks.map((row) => ({
      sequence: row.sequence,
      kind: row.kind as "document" | "reddit" | "web",
      instruction: row.instruction,
      required: true,
    })),
  });

  for (const result of outcome.results) {
    const check = checks.find((row) => row.sequence === result.sequence);
    if (!check) continue;
    for (const item of result.evidence) {
      await connection.reducers.addEvidence({
        conditionId,
        checkId: check.id,
        sourceType: item.sourceType,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        authorOrSource: item.authorOrSource,
        sourcePublishedAt: item.publishedAt,
        relevanceScore: undefined,
      });
    }
    if (result.status === "error") {
      await connection.reducers.setCheckError({ checkId: check.id, summary: result.summary });
    } else {
      await connection.reducers.completeCheck({ checkId: check.id, passed: result.status === "passed", summary: result.summary });
    }
  }
  await connection.reducers.resolveCondition({ conditionId, result: outcome.result });
  return getAgentCondition(conditionId);
}

async function waitFor<T>(read: () => T | undefined, attempts = 30): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}
