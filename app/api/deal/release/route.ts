import { NextResponse } from "next/server";
import { getDeal, releaseDeal, submitCondition } from "@/lib/solana";
import { getAgentCondition } from "@/lib/agent/condition-service";
import { getServerSpacetimeConnection } from "@/lib/spacetime/server";

// This demo program currently uses one fixed condition hash for funded deals.
const DEMO_ESCROW_CONDITION = "foundation_milestone_complete";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin release requests are not allowed." }, { status: 403 });

  try {
    const body = await request.json();
    const { dealId: requestedDealId, conditionId, confirmed } = body as { dealId?: unknown; conditionId?: unknown; confirmed?: unknown };
    if (typeof requestedDealId !== "number" || !Number.isSafeInteger(requestedDealId) || requestedDealId <= 0 || typeof conditionId !== "string" || !/^\d+$/.test(conditionId)) return NextResponse.json({ error: "Invalid demo deal or condition." }, { status: 400 });
    const dealId = requestedDealId;
    if (confirmed !== true) return NextResponse.json({ error: "Confirm the Devnet release in the application first." }, { status: 400 });

    const condition = await getAgentCondition(BigInt(conditionId));
    if (!condition) return NextResponse.json({ error: "Condition not found." }, { status: 404 });
    if (condition.condition.dealId !== String(dealId)) return NextResponse.json({ error: "This deal is not linked to that condition." }, { status: 409 });
    if (condition.condition.finalResult !== true || condition.condition.settlementStatus !== "ready" || !condition.checks.length || condition.checks.some((check) => check.passed !== true || check.status !== "passed")) {
      return NextResponse.json({ error: "The saved verification result is not ready for settlement." }, { status: 409 });
    }

    const db = await getServerSpacetimeConnection();
    const deal = await getDeal(dealId);
    if (!deal.funded) return NextResponse.json({ error: "This deal is not funded." }, { status: 409 });
    if (deal.released) return NextResponse.json({ error: "This deal has already been released." }, { status: 409 });

    // Claim the one-time settlement transition before making either chain call.
    await db.reducers.recordSettlementStatus({ conditionId: BigInt(conditionId), status: "submitted", signature: undefined });
    let result: Awaited<ReturnType<typeof releaseDeal>>;
    try {
      await submitCondition(dealId, DEMO_ESCROW_CONDITION, true);
      result = await releaseDeal(dealId);
    } catch (error) {
      await db.reducers.recordSettlementStatus({ conditionId: BigInt(conditionId), status: "failed", signature: undefined }).catch(() => undefined);
      throw error;
    }

    await db.reducers.recordSettlementStatus({ conditionId: BigInt(conditionId), status: "confirmed", signature: result.signature }).catch(() => undefined);
    await db.reducers.setConditionStatus({ conditionId: BigInt(conditionId), status: "executed" }).catch(() => undefined);
    return NextResponse.json({ ...result, status: "confirmed", dealStatus: "released" });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already submitted")) return NextResponse.json({ error: "A release for this condition is already in progress." }, { status: 409 });
    return NextResponse.json({ error: "Devnet release failed. Check the deal state and try again." }, { status: 400 });
  }
}
