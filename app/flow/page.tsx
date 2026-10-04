"use client";

import { useState } from "react";
import { SpacetimeProvider } from "@/lib/spacetime/Provider";
import { VerificationFlow } from "@/lib/spacetime/VerificationFlow";

type DemoDeal = { dealId: number; recipient?: string; amountLamports?: number; funded?: boolean; released?: boolean; createSignature?: string };

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function FlowPage() {
  const [deal, setDeal] = useState<DemoDeal>();
  const [creatingDeal, setCreatingDeal] = useState(false);
  const createDeal = async () => {
    setCreatingDeal(true);
    try {
      const created = await api("/api/deal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conditionId: "foundation_milestone_complete", amountSol: 0.001 }),
      });
      const state = await api(`/api/deal/${created.dealId}`);
      setDeal({ ...created, ...state });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not create Devnet deal.");
    } finally { setCreatingDeal(false); }
  };
  return <SpacetimeProvider><VerificationFlow demoDeal={deal} onCreateDemoDeal={() => void createDeal()} creatingDeal={creatingDeal} /></SpacetimeProvider>;
}
