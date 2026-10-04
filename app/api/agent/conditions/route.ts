import { NextResponse } from "next/server";
import { isAuthorizedAgentRequest } from "@/lib/agent/auth";
import { createAgentCondition, listAgentConditions } from "@/lib/agent/condition-service";
import { VerificationPlanError } from "@/lib/verification-plan-service";

export const runtime = "nodejs";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "Agent API authorization failed." }, { status: process.env.AGENT_API_TOKEN ? 401 : 503 });
}

export async function GET(request: Request) {
  if (!isAuthorizedAgentRequest(request)) return unauthorized();
  try { return NextResponse.json({ conditions: await listAgentConditions() }); }
  catch { return NextResponse.json({ error: "Could not read condition state." }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isAuthorizedAgentRequest(request)) return unauthorized();
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid condition request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.condition !== "string" || !input.condition.trim() || input.condition.length > 2000) {
    return NextResponse.json({ error: "Condition must be between 1 and 2,000 characters." }, { status: 400 });
  }
  try {
    const condition = await createAgentCondition(input.condition.trim());
    return NextResponse.json(condition, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the verification plan.";
    const status = error instanceof VerificationPlanError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
