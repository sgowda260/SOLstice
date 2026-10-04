"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
type AgentStatus = { ready: boolean; missing: string[]; verificationSetupMissing: string[]; agentAddress: string | null };

const starterMessage: Message = {
  role: "assistant",
  content: "I can draft a condition and plan, inspect saved evidence, link an existing funded Devnet deal, or enable a planned condition. Enabling starts its checks; if they all pass and a funded deal is linked, the app automatically attempts settlement. I only enable or link when you explicitly ask me to.",
};

const suggestions = [
  "List my conditions",
  "Draft a condition for a completed foundation milestone",
  "What happens when I enable a condition?",
];

export function AgentConsole() {
  const [status, setStatus] = useState<AgentStatus>();
  const [messages, setMessages] = useState<Message[]>([starterMessage]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/status")
      .then((response) => response.json())
      .then((value: AgentStatus) => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatus({ ready: false, missing: ["Agentverse connection"], verificationSetupMissing: [], agentAddress: null }); });
    return () => { active = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, activity]);

  async function submit(text: string) {
    const content = text.trim();
    if (!content || busy || !status?.ready) return;
    const context = messages.slice(-11);
    let contextCharacters = context.reduce((total, message) => total + message.content.length, 0);
    while (context.length && contextCharacters + content.length > 20_000) {
      contextCharacters -= context.shift()!.content.length;
    }
    const history: Message[] = [...context, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setActivity("Sending to your Agentverse agent…");
    setError("");

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, sessionId: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || "The Agentverse request failed.");
      }
      if (!response.body) throw new Error("Agentverse returned an empty response stream.");

      setActivity("Agentverse is working through the request…");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      const append = (value: string) => {
        answer += value;
        setMessages([...history, { role: "assistant", content: answer }]);
      };
      const consume = (event: string) => {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let payload: {
            choices?: Array<{ delta?: { content?: unknown } }>;
            metadata?: { type?: string; plan_status?: string };
            error?: { message?: string };
          };
          try {
            payload = JSON.parse(raw) as {
              choices?: Array<{ delta?: { content?: unknown } }>;
              metadata?: { type?: string; plan_status?: string };
              error?: { message?: string };
            };
          } catch { continue; }
          const delta = payload.choices?.[0]?.delta?.content;
          if (typeof delta === "string") append(delta);
          if (payload.metadata?.type === "plan_state") {
            const state = payload.metadata.plan_status;
            setActivity(state === "completed" ? "Preparing the answer…" : "Agentverse is coordinating the escrow specialist…");
          }
          if (payload.error?.message) throw new Error(payload.error.message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        events.forEach(consume);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (!answer.trim()) append("The agent finished without a text response. Please try again.");
      setActivity("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The Agentverse request failed.";
      setMessages((current) => current.slice(0, -1));
      setDraft(content);
      setError(message);
      setActivity("");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(draft);
  }

  const ready = status?.ready === true;
  return <main className="agent-app">
    <aside className="agent-sidebar">
      <Link href="/" className="agent-brand"><span className="agent-brand-mark">CS</span><span><strong>CONDITION<br />ORACLE</strong><small>DEVNET WORKSPACE</small></span></Link>
      <div className="agent-nav-label">WORKSPACE</div>
      <Link className="agent-nav active" href="/">⌘ <span>Agent</span><b>LIVE</b></Link>
      <Link className="agent-nav" href="/flow">⌁ <span>Verification graph</span></Link>
      <div className="agent-sidebar-bottom">
        <div className="agent-network-card"><span className="network-orb" /><div><strong>Solana Devnet</strong><small>TEST SOL ONLY</small></div><span className="agent-status-dot" /></div>
        <p>Agent-assisted verification<br />Automatic settlement on pass</p>
      </div>
    </aside>

    <section className="agent-main">
      <header className="agent-topbar">
        <div><span className={`agent-status-indicator ${ready ? "is-ready" : ""}`} /><strong>ESCROW OPERATIONS AGENT</strong><span className="agent-top-separator">/</span><span>{ready ? "AGENT CONFIGURED" : "SETUP REQUIRED"}</span></div>
        <Link href="/flow" className="agent-top-link">Open verification workspace ↗</Link>
      </header>

      <div className="agent-conversation">
        <div className="agent-intro"><div className="agent-avatar">CS</div><div><span>CONDITIONAL ESCROW SPECIALIST</span><h1>What should we verify?</h1><p>Describe a condition, inspect evidence, or explicitly enable a plan or link an existing funded deal.</p></div></div>

        {!ready && <div className="agent-setup-card"><div className="setup-icon">↗</div><div><strong>Connect your Agentverse agent</strong><p>Deploy the files in <code>agentverse-agent/</code>. Set <code>ASI1_API_KEY</code>, <code>AGENTVERSE_AGENT_ADDRESS</code>, and <code>AGENT_API_TOKEN</code> in the app; set <code>APP_API_BASE_URL</code> and the matching <code>APP_API_TOKEN</code> in Agentverse secrets.</p>{status?.missing?.length ? <small>Missing app settings: {status.missing.join(", ")}</small> : <small>Checking Agentverse configuration…</small>}</div></div>}
        {ready && Boolean(status?.verificationSetupMissing.length) && <div className="agent-setup-card"><div className="setup-icon">!</div><div><strong>Verification services need configuration</strong><p>The agent can chat, but planning and evidence checks need <code>XAI_API_KEY</code> and <code>FIRECRAWL_API_KEY</code> in the app's server environment.</p><small>Missing: {status?.verificationSetupMissing.join(", ")}</small></div></div>}

        <div className="agent-thread" aria-live="polite">
          {messages.map((message, index) => <article className={`agent-message ${message.role === "user" ? "from-user" : "from-agent"}`} key={`${index}-${message.role}`}>
            {message.role === "assistant" && <div className="message-avatar">CS</div>}
            <div className="message-body"><span className="message-role">{message.role === "assistant" ? "ESCROW AGENT" : "YOU"}</span><p>{message.content || (busy ? activity || "Working…" : "")}</p></div>
          </article>)}
          {busy && !messages[messages.length - 1]?.content && <div className="agent-thinking"><span /><span /><span />{activity || "Thinking"}</div>}
          {error && <div className="agent-error" role="alert">{error}</div>}
          <div ref={endRef} />
        </div>

        {messages.length === 1 && <div className="agent-suggestions">{suggestions.map((suggestion) => <button key={suggestion} disabled={!ready || busy} onClick={() => void submit(suggestion)}>{suggestion}<span>↗</span></button>)}</div>}
      </div>

      <footer className="agent-compose-wrap">
        <form className="agent-compose" onSubmit={onSubmit}>
          <span className="compose-sigil">✳</span>
          <textarea value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(draft); } }} placeholder={ready ? "Ask about a condition or describe what needs to be true…" : "Connect Agentverse to start a conversation…"} disabled={!ready || busy} rows={2} aria-label="Message the escrow agent" />
          <button type="submit" disabled={!ready || busy || !draft.trim()} aria-label="Send message">{busy ? "···" : "↑"}</button>
        </form>
        <div className="agent-compose-note"><span>Agentverse + ASI:One · Evidence checks use public sources</span><span>Enable starts checks and may trigger automatic settlement · Devnet</span></div>
      </footer>
    </section>

    <aside className="agent-rightbar">
      <div className="rightbar-heading"><span>APPROVAL BOUNDARIES</span><span className="lock-symbol">⌑</span></div>
      <div className="approval-flow">
        <div className="approval-item is-active"><i>01</i><div><strong>Define condition</strong><small>Agent drafts and saves a plan</small></div><b>AGENT</b></div>
        <div className="approval-track" />
        <div className="approval-item is-active"><i>02</i><div><strong>Enable checks</strong><small>Starts checks when you ask</small></div><b>AGENT</b></div>
        <div className="approval-track" />
        <div className="approval-item"><i>03</i><div><strong>Devnet settlement</strong><small>Automatic on pass with funded deal</small></div><b>APP</b></div>
      </div>
      <div className="agent-right-note"><span>TRUST BOUNDARY</span><p>The agent cannot fund deals or sign transactions. Linking a funded deal to a passing condition can trigger settlement; the app server submits the Devnet transaction.</p></div>
      <div className="agent-right-bottom"><span>RUN HISTORY</span><Link href="/flow">Open condition graph <span>↗</span></Link></div>
    </aside>
  </main>;
}
