export type SettlementStatus = "idle" | "ready" | "submitted" | "confirmed" | "failed" | string;

export function canRelease(finalResult: boolean | undefined, status: SettlementStatus, hasDeal: boolean, submitting: boolean) {
  return finalResult === true && (status === "ready" || status === "failed") && hasDeal && !submitting;
}

export function releaseLabel(finalResult: boolean | undefined, status: SettlementStatus) {
  if (finalResult === false) return "Settlement locked";
  if (status === "confirmed") return "Funds released on Devnet";
  if (status === "submitted") return "Releasing…";
  if (status === "failed") return "Release failed";
  if (finalResult === true && status === "ready") return "Verification complete · Settlement ready";
  return "Settlement locked";
}

export const SAFE_RELEASE_ERROR = "Release failed. Check the deal state and retry.";

export async function requestRelease(dealId: number, conditionId: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/deal/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dealId, conditionId }),
  });
  const result = await response.json().catch(() => ({})) as { signature?: unknown };
  if (!response.ok || typeof result.signature !== "string") throw new Error(SAFE_RELEASE_ERROR);
  return result.signature;
}
