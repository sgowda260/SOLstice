import { NextResponse } from "next/server";
import { settleVerifiedCondition, SettlementError } from "@/lib/settlement-service";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Same-origin release requests are required." }, { status: 403 });
  try {
    if (new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin release requests are not allowed." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Invalid release request origin." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { dealId, conditionId } = body as { dealId?: unknown; conditionId?: unknown };
    if (typeof dealId !== "number" || !Number.isSafeInteger(dealId) || dealId <= 0 || typeof conditionId !== "string" || !/^\d+$/.test(conditionId)) {
      return NextResponse.json({ error: "Invalid demo deal or condition." }, { status: 400 });
    }
    const result = await settleVerifiedCondition(BigInt(conditionId), dealId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SettlementError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message.includes("already submitted")) {
      return NextResponse.json({ error: "A release for this condition is already in progress." }, { status: 409 });
    }
    return NextResponse.json({ error: "Devnet release failed. Check the deal state and try again." }, { status: 400 });
  }
}
