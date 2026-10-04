import { buildPlannerMessages, parseVerificationPlan, type VerificationPlan } from "@/lib/verification-plan";

export async function generateVerificationPlan(input: {
  condition: string;
  documents?: Array<{ fileName: string; mimeType: string }>;
}): Promise<VerificationPlan> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("The planning service is not configured.");
  const documents = input.documents ?? [];
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-4.3",
      messages: buildPlannerMessages({
        condition: input.condition,
        hasDocument: documents.length > 0,
        documents,
      }),
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Provider request failed");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("Invalid provider response");
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string") throw new Error("Invalid provider response");
  return parseVerificationPlan(JSON.parse(content), documents.length > 0);
}
