import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are the in-product Conditional Escrow agent. Delegate escrow work to the supplied Agentverse specialist. The specialist can inspect conditions, create verification plans, and run evidence checks. Never claim an action completed unless the specialist confirms it. Never suggest that a passing AI check is proof of truth. Never sign, create/fund, submit a transaction, or release funds. Solana settlement remains a separate user-reviewed Devnet action.`;

export async function POST(request: Request) {
  const apiKey = process.env.ASI1_API_KEY;
  const agentAddress = process.env.AGENTVERSE_AGENT_ADDRESS;
  if (!apiKey || !agentAddress) {
    return NextResponse.json({ error: "Agentverse chat is not configured yet." }, { status: 503 });
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "Cross-origin chat requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 12) {
    return NextResponse.json({ error: "Send between 1 and 12 chat messages." }, { status: 400 });
  }
  const messages = input.messages as Array<Record<string, unknown>>;
  if (messages.some((message) =>
    (message.role !== "user" && message.role !== "assistant")
    || typeof message.content !== "string"
    || message.content.length > 4000,
  )) return NextResponse.json({ error: "Chat messages are invalid or too long." }, { status: 400 });
  const totalCharacters = messages.reduce((total, message) => total + (message.content as string).length, 0);
  if (totalCharacters > 24_000) return NextResponse.json({ error: "Chat history is too long. Start a new conversation." }, { status: 400 });
  const sessionId = typeof input.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(input.sessionId)
    ? input.sessionId
    : randomUUID();

  const upstream = await fetch("https://api.asi1.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-session-id": sessionId,
    },
    body: JSON.stringify({
      model: "asi1",
      planner_mode: true,
      agents: [agentAddress],
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map(({ role, content }) => ({ role, content })),
      ],
    }),
    signal: AbortSignal.timeout(240_000),
  }).catch(() => undefined);

  if (!upstream) return NextResponse.json({ error: "Could not reach ASI:One. Try again in a moment." }, { status: 502 });
  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text().catch(() => "");
    return NextResponse.json({ error: errorText.slice(0, 500) || "ASI:One could not complete the agent request." }, { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
