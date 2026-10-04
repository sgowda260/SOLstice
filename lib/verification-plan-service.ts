import { buildPlannerMessages, parseVerificationPlan, type VerificationPlan } from "@/lib/verification-plan";

export class VerificationPlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "VerificationPlanError";
  }
}

export async function generateVerificationPlan(input: {
  condition: string;
  documents?: Array<{ fileName: string; mimeType: string }>;
}): Promise<VerificationPlan> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new VerificationPlanError("The planning service is not configured.", 503);
  const documents = input.documents ?? [];
  try {
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
    if (response.status === 401 || response.status === 403) {
      throw new VerificationPlanError("The planning service rejected XAI_API_KEY. Check the key in .env.local, then restart Next.js.", 502);
    }
    if (response.status === 429) {
      throw new VerificationPlanError("The planning service is rate-limiting requests. Wait a moment, then try again.", 503);
    }
    if (response.status === 400) {
      throw new VerificationPlanError("The planning provider rejected its model request. Check XAI_MODEL in .env.local, then restart Next.js.", 502);
    }
    if (!response.ok) throw new VerificationPlanError("Could not generate a valid verification plan. Please try again.", 502);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new VerificationPlanError("Could not generate a valid verification plan. Please try again.", 502);
    const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") throw new VerificationPlanError("Could not generate a valid verification plan. Please try again.", 502);
    try {
      return parseVerificationPlan(JSON.parse(content), documents.length > 0);
    } catch {
      throw new VerificationPlanError("Could not generate a valid verification plan. Please try again.", 502);
    }
  } catch (error) {
    if (error instanceof VerificationPlanError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new VerificationPlanError("The planning service took longer than 30 seconds. Check your connection and try again.", 504);
    }
    if (error instanceof TypeError) {
      throw new VerificationPlanError("Could not reach the planning service. Check your internet connection and try again.", 502);
    }
    throw new VerificationPlanError("Could not generate a valid verification plan. Please try again.", 502);
  }
}
