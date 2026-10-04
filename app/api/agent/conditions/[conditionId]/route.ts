import { NextResponse } from "next/server";
import { isAuthorizedAgentRequest } from "@/lib/agent/auth";
import { enableAgentCondition, getAgentCondition, linkAgentFundedDeal } from "@/lib/agent/condition-service";

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
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid agent action." }, { status: 400 });
  const input = body as Record<string, unknown>;
  try {
    if (input.action === "enable_condition") {
      const result = await enableAgentCondition(conditionId);
      return result ? NextResponse.json(result) : NextResponse.json({ error: "Condition not found." }, { status: 404 });
    } else if (input.action === "link_funded_deal") {
      const dealId = typeof input.dealId === "string" && /^\d+$/.test(input.dealId) ? Number(input.dealId) : input.dealId;
      if (typeof dealId !== "number" || !Number.isSafeInteger(dealId) || dealId <= 0) return NextResponse.json({ error: "Devnet deal ID must be a positive safe integer." }, { status: 400 });
      const result = await linkAgentFundedDeal(conditionId, dealId);
      return result ? NextResponse.json(result) : NextResponse.json({ error: "Condition not found." }, { status: 404 });
    } else {
      return NextResponse.json({ error: "Use action=enable_condition or action=link_funded_deal." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification could not run.";
    const status = message.includes("already") || message.includes("Only a planned") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
