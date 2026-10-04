import { searchReddit } from "@/lib/verification-tools/reddit";
import { searchWeb } from "@/lib/verification-tools/web";
import type { CheckResult, SourceEvidence } from "@/lib/verification-tools/types";

export type VerificationCheckInput = {
  sequence: number;
  kind: "reddit" | "web" | "document";
  instruction: string;
  required: boolean;
};

export async function runVerificationChecks(input: {
  condition: string;
  hasDocument: boolean;
  checks: VerificationCheckInput[];
}) {
  const results: CheckResult[] = await Promise.all(input.checks.map(async (check) => {
    if (check.kind === "document") {
      return {
        sequence: check.sequence,
        status: input.hasDocument ? "passed" as const : "failed" as const,
        summary: input.hasDocument ? "Document metadata is attached." : "No document metadata is attached.",
        evidence: [],
      };
    }

    try {
      const evidence = check.kind === "reddit"
        ? await searchReddit(check.instruction)
        : await searchWeb(check.instruction);
      if (!evidence.length) {
        return { sequence: check.sequence, status: "failed" as const, summary: "No matching public source results were found.", evidence };
      }

      const judged = await judgeRelevance(input.condition, check.instruction, evidence);
      const selectedEvidence = judged.indices.map((index) => evidence[index]);
      return {
        sequence: check.sequence,
        status: judged.passed && selectedEvidence.length ? "passed" as const : "failed" as const,
        summary: judged.summary,
        evidence: selectedEvidence,
      };
    } catch (error) {
      return {
        sequence: check.sequence,
        status: "error" as const,
        summary: error instanceof Error ? error.message : "Source check failed.",
        evidence: [],
      };
    }
  }));

  const result = results.every((row, index) => !input.checks[index].required || row.status === "passed")
    && results.every((row) => row.status !== "error");
  return { results, result };
}

async function judgeRelevance(condition: string, instruction: string, evidence: SourceEvidence[]) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("Relevance review is not configured (set XAI_API_KEY).");
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-4.3",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: 'Judge whether the supplied snippets support this check instruction in the context of the condition. This check only needs to support its own part of the condition; other planned checks cover other parts. Return strict JSON: {"passed":boolean,"summary":"short explanation","supportingEvidenceIndexes":[number]}. Use only supplied evidence; never invent sources or facts.',
        },
        {
          role: "user",
          content: JSON.stringify({
            condition,
            instruction,
            evidence: evidence.map(({ title, snippet, url, authorOrSource, publishedAt }) => ({ title, snippet, url, authorOrSource, publishedAt })),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Relevance review returned ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const value = JSON.parse(payload.choices?.[0]?.message?.content || "") as Record<string, unknown>;
  if (typeof value.passed !== "boolean" || typeof value.summary !== "string" || !Array.isArray(value.supportingEvidenceIndexes)) {
    throw new Error("Relevance review returned an invalid result.");
  }
  const indices = value.supportingEvidenceIndexes.filter((index): index is number =>
    Number.isInteger(index) && (index as number) >= 0 && (index as number) < evidence.length,
  );
  return { passed: value.passed && indices.length > 0, summary: value.summary.slice(0, 500), indices };
}
