import { NextResponse } from "next/server";
import { runVerificationChecks, type VerificationCheckInput } from "@/lib/verification-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.condition !== "string" || !input.condition.trim() || !Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 12) return NextResponse.json({ error: "Condition and 1–12 checks are required." }, { status: 400 });
  const checks = input.checks as Array<Record<string, unknown>>;
  if (checks.some((c) => !Number.isInteger(c.sequence) || typeof c.kind !== "string" || !["reddit", "web", "document"].includes(c.kind) || typeof c.instruction !== "string" || typeof c.required !== "boolean")) return NextResponse.json({ error: "Invalid check data." }, { status: 400 });
  const normalized: VerificationCheckInput[] = checks.map((check) => ({
    sequence: check.sequence as number,
    kind: check.kind as VerificationCheckInput["kind"],
    instruction: check.instruction as string,
    required: check.required as boolean,
  }));
  const result = await runVerificationChecks({
    condition: input.condition as string,
    hasDocument: input.hasDocument === true,
    checks: normalized,
  });
  return NextResponse.json(result);
}
