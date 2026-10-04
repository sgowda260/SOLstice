import { NextResponse } from "next/server";
import { isAuthorizedAgentRequest } from "@/lib/agent/auth";
import { getAgentCondition, runAgentVerification } from "@/lib/agent/condition-service";

export const runtime = "nodejs";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ error: "Agent API authorization failed." }, { status: process.env.AGENT_API_TOKEN ? 401 : 503 });
}

function parseId(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

export async function GET(request: Request, { params }: { params: { conditionId: string } }) {
  if (!isAuthorizedAgentRequest(request)) return unauthorized();
  const conditionId = parseId(params.conditionId);
  if (conditionId === undefined) return NextResponse.json({ error: "Condition ID is invalid." }, { status: 400 });
  try {
    const condition = await getAgentCondition(conditionId);
    return condition ? NextResponse.json(condition) : NextResponse.json({ error: "Condition not found." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not read condition state." }, { status: 503 }); }
}

export async function POST(request: Request, { params }: { params: { conditionId: string } }) {
  if (!isAuthorizedAgentRequest(request)) return unauthorized();
  const conditionId = parseId(params.conditionId);
  if (conditionId === undefined) return NextResponse.json({ error: "Condition ID is invalid." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).action !== "run_verification") {
    return NextResponse.json({ error: "Explicitly request action=run_verification to start evidence checks." }, { status: 400 });
  }
  try {
    const result = await runAgentVerification(conditionId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Condition not found." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification could not run.";
    const status = message.includes("already been checked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
