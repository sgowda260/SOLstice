import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const missing = [
    !process.env.ASI1_API_KEY && "ASI1_API_KEY",
    !process.env.AGENTVERSE_AGENT_ADDRESS && "AGENTVERSE_AGENT_ADDRESS",
    !process.env.AGENT_API_TOKEN && "AGENT_API_TOKEN",
  ].filter((value): value is string => typeof value === "string");
  const verificationSetupMissing = [
    !process.env.XAI_API_KEY && "XAI_API_KEY",
    !process.env.FIRECRAWL_API_KEY && "FIRECRAWL_API_KEY",
  ].filter((value): value is string => typeof value === "string");
  return NextResponse.json({
    ready: missing.length === 0,
    missing,
    verificationSetupMissing,
    agentAddress: process.env.AGENTVERSE_AGENT_ADDRESS ?? null,
  });
}
