import { getDeal, releaseDeal, submitCondition } from "@/lib/solana";
import { getServerSpacetimeConnection } from "@/lib/spacetime/server";

// This demo program currently uses one fixed condition hash for funded deals.
const DEMO_ESCROW_CONDITION = "foundation_milestone_complete";

export class SettlementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SettlementError";
  }
}

/** Validate the saved result and linked funded deal before attempting settlement. */
export async function settleVerifiedCondition(conditionId: bigint, dealId: number) {
  const db = await getServerSpacetimeConnection();
  const condition = [...db.db.condition.iter()].find((row) => row.id === conditionId);
  if (!condition) throw new SettlementError("Condition not found.", 404);
  if (condition.dealId !== BigInt(dealId)) throw new SettlementError("This deal is not linked to that condition.", 409);

  const checks = [...db.db.verificationCheck.iter()].filter((row) => row.conditionId === conditionId);
  if (condition.finalResult !== true || !["ready", "failed"].includes(condition.settlementStatus) || !checks.length || checks.some((check) => check.passed !== true || check.status !== "passed")) {
    throw new SettlementError("The saved verification result is not ready for settlement.", 409);
  }

  const deal = await getDeal(dealId);
  if (!deal.funded) throw new SettlementError("This deal is not funded.", 409);
  if (deal.released) throw new SettlementError("This deal has already been released.", 409);

  // Claim the one-time settlement transition before making either chain call.
  await db.reducers.recordSettlementStatus({ conditionId, status: "submitted", signature: undefined });
  let result: Awaited<ReturnType<typeof releaseDeal>>;
  try {
    await submitCondition(dealId, DEMO_ESCROW_CONDITION, true);
    result = await releaseDeal(dealId);
  } catch (error) {
    await db.reducers.recordSettlementStatus({ conditionId, status: "failed", signature: undefined }).catch(() => undefined);
    throw error;
  }

  await db.reducers.recordSettlementStatus({ conditionId, status: "confirmed", signature: result.signature }).catch(() => undefined);
  await db.reducers.setConditionStatus({ conditionId, status: "executed" }).catch(() => undefined);
  return { ...result, status: "confirmed", dealStatus: "released" };
}
