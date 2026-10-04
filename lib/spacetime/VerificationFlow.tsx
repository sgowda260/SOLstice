"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Controls, Handle, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import type { Condition, Evidence as EvidenceRow, UploadedDocument, VerificationCheck } from "./module_bindings/types";
import type { VerificationPlan } from "@/lib/verification-plan";
import { requestRelease, SAFE_RELEASE_ERROR } from "@/lib/spacetime/release-state";

type DemoDeal = { dealId: number; recipient?: string; amountLamports?: number; funded?: boolean; released?: boolean; createSignature?: string };
type GraphKind = "condition" | "plan" | "result" | "resolution" | "settlement";
type GraphData = { kind: GraphKind; eyebrow: string; title: string; detail: string; status: string; tone: string; animate?: boolean; delay?: number };
type GraphNode = Node<GraphData>;

const nodeTypes = { graphCard: GraphCardNode };
const statusTone = (status: string) => status === "passed" || status === "true" || status === "ready" || status === "confirmed" ? "good"
  : status === "failed" || status === "false" || status === "error" || status === "locked" ? "bad"
  : status === "running" || status === "planning" ? "active" : "quiet";

function GraphCardNode({ data, selected }: NodeProps<GraphNode>) {
  const source = data.kind !== "settlement";
  const target = data.kind !== "condition";
  return <div role="button" tabIndex={0} aria-label={`${data.eyebrow}: ${data.title}. Status ${data.status}. Open details.`}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
    style={{ animationDelay: `${data.delay ?? 0}ms` }} className={`graph-node graph-${data.kind} tone-${data.tone}${data.animate ? " node-enter" : ""}${data.status === "running" || data.status === "planning" ? " node-pulse" : ""}${selected ? " node-selected" : ""}`}>
    {target && <Handle type="target" position={Position.Left} />}
    <div className="node-topline"><span className="node-eyebrow">{data.eyebrow}</span><span className="node-state">{data.status}</span></div>
    <div className="node-title">{data.title}</div>
    <div className="node-detail">{data.detail}</div>
    {source && <Handle type="source" position={Position.Right} />}
  </div>;
}

function buildGraph(condition: Condition | undefined, checks: readonly VerificationCheck[], evidence: readonly EvidenceRow[], releaseBusy: boolean): { nodes: GraphNode[]; edges: Edge[] } {
  if (!condition) return { nodes: [], edges: [] };
  const rows = Math.max(1, checks.length);
  const rowGap = 205;
  const firstY = 330 - ((rows - 1) * rowGap) / 2;
  const nodes: GraphNode[] = [{ id: "condition", type: "graphCard", position: { x: 40, y: 330 }, data: {
    kind: "condition", eyebrow: "01 · CONTRACT CONDITION", title: "isConditionSatisfied()", detail: condition.prompt, animate: true,
    status: condition.status === "planning" ? "planning" : "live", tone: condition.status === "planning" ? "active" : "quiet",
  } }];
  const edges: Edge[] = [];
  if (checks.length === 0) return { nodes, edges };
  checks.forEach((check, index) => {
    const y = firstY + index * rowGap;
    const count = evidence.filter((item) => item.checkId === check.id).length;
    const resultStatus = check.status === "running" ? "running" : check.status === "error" ? "error"
      : check.status === "pending" ? "pending" : check.passed === true ? "passed" : check.passed === false ? "failed" : check.status;
    const label = check.kind === "reddit" ? "REDDIT" : check.kind === "web" ? "PUBLIC WEB" : "DOCUMENT";
    const summary = check.summary || (check.status === "running" ? "Collecting source evidence…" : check.status === "error" ? "Search unavailable" : check.passed === true ? "Evidence met this check" : check.passed === false ? "Evidence did not meet this check" : "Waiting for verification to run");
    const planId = `plan-${check.id.toString()}`;
    const resultId = `result-${check.id.toString()}`;
    nodes.push({ id: planId, type: "graphCard", position: { x: 325, y }, data: {
      kind: "plan", eyebrow: `02 · ${label} CHECK`, title: check.label, detail: check.instruction, status: label, tone: "plan", animate: true, delay: index * 130,
    } });
    nodes.push({ id: resultId, type: "graphCard", position: { x: 610, y }, data: {
      kind: "result", eyebrow: `03 · CHECK ${String(index + 1).padStart(2, "0")}`, title: summary,
      detail: `${count} evidence ${count === 1 ? "item" : "items"}`, status: resultStatus, tone: statusTone(resultStatus), animate: true, delay: index * 130 + 90,
    } });
    edges.push({ id: `condition-${planId}`, source: "condition", target: planId, type: "smoothstep", animated: check.status === "running", style: { stroke: check.status === "running" ? "#8b8cf7" : "#49515c", strokeWidth: 1.4 } });
    edges.push({ id: `${planId}-${resultId}`, source: planId, target: resultId, type: "smoothstep", animated: check.status === "running", style: { stroke: check.passed === true ? "#57d7a0" : check.passed === false || check.status === "error" ? "#ef7777" : "#58616d", strokeWidth: 1.4 } });
  });
  const resolved = condition.finalResult === true ? "true" : condition.finalResult === false ? "false" : "pending";
  const passed = checks.filter((check) => check.passed === true).length;
  const required = checks.length;
  const centerY = 330;
  const resolutionY = checks.length ? firstY + ((checks.length - 1) * rowGap) / 2 : centerY;
  const resolutionText = resolved === "true" ? "Condition verified" : resolved === "false" ? "Condition not verified" : checks.some((check) => check.status === "running") ? "Verification in progress" : checks.length ? "Awaiting check results" : "Plan checks will appear here";
  nodes.push({ id: "resolution", type: "graphCard", position: { x: 895, y: resolutionY }, data: {
    kind: "resolution", eyebrow: "04 · FINAL RESOLUTION", title: resolutionText, detail: `${passed} of ${required} required checks passed`,
    status: resolved, tone: statusTone(resolved), animate: true,
  } });
  for (const check of checks) edges.push({ id: `result-${check.id.toString()}-resolution`, source: `result-${check.id.toString()}`, target: "resolution", type: "smoothstep", animated: resolved === "pending" && check.status === "running", style: { stroke: resolved === "true" ? "#57d7a0" : resolved === "false" ? "#e66d72" : "#58616d", strokeWidth: 1.35 } });
  const settlement = condition.settlementStatus === "confirmed" ? "confirmed" : condition.settlementStatus === "submitted" || releaseBusy ? "submitted"
    : condition.settlementStatus === "failed" ? "failed" : condition.finalResult === true && condition.settlementStatus === "ready" ? "ready" : "locked";
  nodes.push({ id: "settlement", type: "graphCard", position: { x: 1180, y: resolutionY }, data: {
    kind: "settlement", eyebrow: "05 · SOLANA DEVNET", title: settlement === "ready" ? "Release available" : settlement === "confirmed" ? "Funds released" : settlement === "submitted" ? "Release submitted" : settlement === "failed" ? "Release failed" : "Settlement locked",
    detail: settlement === "ready" ? "Manual release available" : condition.settlementSignature ? "Transaction signature available" : "Devnet escrow", status: settlement, tone: statusTone(settlement), animate: true,
  } });
  edges.push({ id: "resolution-settlement", source: "resolution", target: "settlement", type: "smoothstep", animated: settlement === "ready", style: { stroke: settlement === "ready" || settlement === "confirmed" ? "#57d7a0" : "#58616d", strokeWidth: 1.7 } });
  return { nodes, edges };
}

function GraphCanvas({ graph, selectedNode, onSelect, conditionId }: { graph: { nodes: GraphNode[]; edges: Edge[] }; selectedNode: string | undefined; onSelect: (id: string) => void; conditionId?: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const { fitView } = useReactFlow();
  const didFit = useRef<string>();
  const layoutKey = graph.nodes.map((node) => node.id).join("|");
  const fitKey = `${conditionId ?? ""}:${graph.nodes.some((node) => node.id.startsWith("plan-")) ? "planned" : "empty"}`;
  useEffect(() => {
    setNodes((current) => graph.nodes.map((next) => {
      const old = current.find((node) => node.id === next.id);
      return old ? { ...next, position: old.position, selected: old.selected } : next;
    }));
  }, [graph.nodes, setNodes]);
  useEffect(() => setEdges(graph.edges), [graph.edges, setEdges]);
  useEffect(() => {
    if (!conditionId || didFit.current === fitKey || !graph.nodes.length) return;
    didFit.current = fitKey;
    const timer = window.setTimeout(() => fitView({ padding: 0.18, duration: 700 }), 120);
    return () => window.clearTimeout(timer);
  }, [conditionId, fitKey, layoutKey, fitView, graph.nodes.length]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
    onNodeClick={(_, node) => onSelect(node.id)} fitViewOptions={{ padding: 0.18 }} minZoom={0.25} maxZoom={1.5} nodesDraggable nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }}>
    <Controls showInteractive={false} position="bottom-left" />
  </ReactFlow>;
}

function displayTime(value: { microsSinceUnixEpoch: bigint }) { return new Date(Number(value.microsSinceUnixEpoch / 1000n)).toLocaleString(); }
function newestFirst<T extends { createdAt: { microsSinceUnixEpoch: bigint } }>(a: T, b: T) {
  return a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? -1 : a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : 0;
}
function conditionHistoryState(condition: Condition) {
  return condition.status === "executed" || condition.settlementStatus === "confirmed" ? "EXECUTED"
    : condition.status === "verifying" ? "VERIFYING" : condition.status === "triggered" ? "TRIGGERED" : condition.status === "enabled" ? "ENABLED"
    : condition.status === "failed" ? "FAILED" : condition.finalResult !== undefined ? "RESOLVED" : "DESIGNING";
}

export function VerificationFlow({ demoDeal, onCreateDemoDeal, creatingDeal = false }: { demoDeal?: DemoDeal; onCreateDemoDeal?: () => void; creatingDeal?: boolean }) {
  const { isActive, connectionError, getConnection } = useSpacetimeDB();
  const [conditionRows, conditionsLoading] = useTable(tables.condition);
  const [checkRows, checksLoading] = useTable(tables.verificationCheck);
  const [evidenceRows, evidenceLoading] = useTable(tables.evidence);
  const [documentRows, documentsLoading] = useTable(tables.uploadedDocument);
  const conditions = conditionRows as readonly Condition[];
  const checks = checkRows as readonly VerificationCheck[];
  const evidence = evidenceRows as readonly EvidenceRow[];
  const documents = documentRows as readonly UploadedDocument[];
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [planSummaries, setPlanSummaries] = useState<Record<string, string>>({});
  const [submittedFingerprint, setSubmittedFingerprint] = useState("");
  const [selectedId, setSelectedId] = useState<bigint>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(true);
  const [triggerToast, setTriggerToast] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Describe what must be true, then build a live verification graph.");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [associatedDeal, setAssociatedDeal] = useState<DemoDeal>();
  const submitting = useRef(false);
  const automaticRuns = useRef(new Set<string>());
  const createCondition = useReducer(reducers.createCondition);
  const enableCondition = useReducer(reducers.enableCondition);
  const triggerCondition = useReducer(reducers.triggerCondition);
  const setConditionStatus = useReducer(reducers.setConditionStatus);
  const addVerificationCheck = useReducer(reducers.addVerificationCheck);
  const recordUploadedDocument = useReducer(reducers.recordUploadedDocument);
  const setCheckRunning = useReducer(reducers.setCheckRunning);
  const completeCheck = useReducer(reducers.completeCheck);
  const setCheckError = useReducer(reducers.setCheckError);
  const addEvidence = useReducer(reducers.addEvidence);
  const resolveCondition = useReducer(reducers.resolveCondition);
  const associateDemoDeal = useReducer(reducers.associateDemoDeal);
  const updateConditionPrompt = useReducer(reducers.updateConditionPrompt);
  const updateVerificationCheck = useReducer(reducers.updateVerificationCheck);
  const selectedCondition = draftMode ? undefined : conditions.find((row) => row.id === selectedId);
  const flowChecks = useMemo(() => checks.filter((row) => row.conditionId === selectedCondition?.id).sort((a, b) => a.sequence - b.sequence), [checks, selectedCondition?.id]);
  const flowEvidence = useMemo(() => evidence.filter((row) => row.conditionId === selectedCondition?.id), [evidence, selectedCondition?.id]);
  const flowDocuments = documents.filter((row) => row.conditionId === selectedCondition?.id);
  const loading = conditionsLoading || checksLoading || evidenceLoading || documentsLoading;
  const formFingerprint = JSON.stringify({ condition: prompt.trim(), documents: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
  const dealId = selectedCondition?.dealId;
  const settlementDeal = demoDeal && BigInt(demoDeal.dealId) === dealId ? demoDeal : associatedDeal && BigInt(associatedDeal.dealId) === dealId ? associatedDeal : undefined;
  const selectedCheck = flowChecks.find((check) => selectedNode === `plan-${check.id.toString()}` || selectedNode === `result-${check.id.toString()}`);
  const selectedEvidence = selectedCheck ? flowEvidence.filter((item) => item.checkId === selectedCheck.id).sort((a, b) => a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? -1 : a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : 0) : [];
  const graph = useMemo(() => buildGraph(selectedCondition, flowChecks, flowEvidence, releaseBusy), [selectedCondition, flowChecks, flowEvidence, releaseBusy]);

  useEffect(() => {
    if (!dealId || (demoDeal && BigInt(demoDeal.dealId) === dealId) || (associatedDeal && BigInt(associatedDeal.dealId) === dealId)) return;
    let active = true;
    fetch(`/api/deal/${dealId.toString()}`).then(async (response) => {
      if (!response.ok) throw new Error("Deal unavailable");
      const details = await response.json();
      if (active) setAssociatedDeal(details);
    }).catch(() => { if (active) setAssociatedDeal(undefined); });
    return () => { active = false; };
  }, [dealId, demoDeal, associatedDeal]);

  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } catch (error) { setNotice(error instanceof Error ? error.message : "SpacetimeDB request failed."); } finally { setBusy(false); } };
  const createPlan = () => run(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      if (!prompt.trim()) throw new Error("Enter a condition first.");
      const connection = getConnection();
      if (!connection) throw new Error("SpacetimeDB is not connected yet.");
      setNotice("Grok is designing a verification plan…");
      const response = await fetch("/api/verification-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ condition: prompt.trim(), ...(files.length ? { documents: files.map((file) => ({ fileName: file.name, mimeType: file.type || "application/octet-stream", byteCount: file.size })) } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not generate a plan.");
      const plan = result as VerificationPlan;
      const priorIds = new Set((Array.from(connection.db.condition.iter()) as Condition[]).map((row) => row.id.toString()));
      await createCondition({ prompt: prompt.trim() });
      let inserted: Condition | undefined;
      for (let attempt = 0; attempt < 30 && !inserted; attempt++) {
        inserted = (Array.from(connection.db.condition.iter()) as Condition[]).find((row) => !priorIds.has(row.id.toString()));
        if (!inserted) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!inserted) throw new Error("The condition was written, but its subscribed row has not arrived yet.");
      setSelectedId(inserted.id); setSelectedNode("condition");
      setDraftMode(false);
      const priorCheckIds = new Set((Array.from(connection.db.verificationCheck.iter()) as VerificationCheck[]).map((row) => row.id.toString()));
      await setConditionStatus({ conditionId: inserted.id, status: "planning" });
      for (const file of files) await recordUploadedDocument({ conditionId: inserted.id, fileName: file.name, mimeType: file.type || "application/octet-stream", byteCount: BigInt(file.size), contentHash: "metadata-only", storageReference: "metadata-only" });
      for (const [index, check] of plan.checks.entries()) await addVerificationCheck({ conditionId: inserted.id, sequence: index + 1, kind: check.kind, label: check.label, instruction: check.instruction });
      const expected = new Set(plan.checks.map((_, index) => index + 1));
      let createdChecks: VerificationCheck[] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        createdChecks = (Array.from(connection.db.verificationCheck.iter()) as VerificationCheck[]).filter((row) => row.conditionId === inserted!.id && expected.has(row.sequence) && !priorCheckIds.has(row.id.toString()));
        if (createdChecks.length === plan.checks.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (createdChecks.length !== plan.checks.length) throw new Error("The plan was saved; waiting for its subscribed checks.");
      setPlanSummaries((current) => ({ ...current, [inserted!.id.toString()]: plan.summary })); setSubmittedFingerprint(formFingerprint); setNotice("Plan saved to SpacetimeDB. External evidence collection has not started.");
    } finally { submitting.current = false; }
  });
  const runVerification = () => run(async () => {
    if (!selectedCondition || flowChecks.length === 0) return;
    setNotice("Running public source checks…");
    for (const check of flowChecks) await setCheckRunning({ checkId: check.id });
    const response = await fetch("/api/verification/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ condition: selectedCondition.prompt, hasDocument: flowDocuments.length > 0, checks: flowChecks.map(({ sequence, kind, instruction }) => ({ sequence, kind, instruction, required: true })) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Verification could not run.");
    for (const checkResult of result.results as Array<{ sequence: number; status: "passed" | "failed" | "error"; summary: string; evidence: Array<{ sourceType: string; title: string; url?: string; snippet: string; authorOrSource?: string; publishedAt?: string }> }>) {
      const check = flowChecks.find((item) => item.sequence === checkResult.sequence);
      if (!check) continue;
      for (const item of checkResult.evidence) await addEvidence({ conditionId: selectedCondition.id, checkId: check.id, sourceType: item.sourceType, title: item.title, url: item.url, snippet: item.snippet, authorOrSource: item.authorOrSource, sourcePublishedAt: item.publishedAt, relevanceScore: undefined });
      if (checkResult.status === "error") await setCheckError({ checkId: check.id, summary: checkResult.summary });
      else await completeCheck({ checkId: check.id, passed: checkResult.status === "passed", summary: checkResult.summary });
    }
    await resolveCondition({ conditionId: selectedCondition.id, result: result.result === true });
    setNotice(result.result ? "Verification complete. Review and confirm a Devnet release when you are ready." : "Verification finished. The condition did not pass all checks.");
    if (result.result === true) {
      if (!selectedCondition.dealId && demoDeal?.funded) await associateDemoDeal({ conditionId: selectedCondition.id, dealId: BigInt(demoDeal.dealId) });
    }
  });
  const runVerificationRef = useRef(runVerification);
  runVerificationRef.current = runVerification;
  useEffect(() => {
    if (!selectedCondition || selectedCondition.status !== "enabled") return;
    const condition = selectedCondition;
    const id = condition.id.toString();
    const timer = window.setTimeout(() => {
      if (automaticRuns.current.has(id)) return;
      automaticRuns.current.add(id);
      setTriggerToast(true);
      window.setTimeout(() => setTriggerToast(false), 3600);
      void (async () => {
        try {
          await triggerCondition({ conditionId: condition.id });
          setNotice("Condition triggered. Verification started automatically.");
          await runVerificationRef.current();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Condition trigger could not start.");
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [selectedCondition?.id, selectedCondition?.status, triggerCondition]);
  const releaseForCondition = async (condition: Condition, targetDealId: bigint) => {
    if (condition.finalResult !== true || condition.settlementStatus !== "ready" || condition.settlementSignature || releaseBusy) return;
    setReleaseBusy(true);
    try {
      await requestRelease(Number(targetDealId), condition.id.toString());
      setNotice("Settlement confirmed on Solana Devnet.");
    } catch {
      setNotice(SAFE_RELEASE_ERROR);
    } finally { setReleaseBusy(false); }
  };
  const enableAutomation = () => run(async () => {
    if (!selectedCondition || !flowChecks.length || selectedCondition.status !== "planning") return;
    await enableCondition({ conditionId: selectedCondition.id });
    setNotice("Automation enabled. Waiting for a condition trigger…");
  });
  const linkDeal = () => run(async () => {
    if (!selectedCondition || !demoDeal?.funded) throw new Error("Create and fund a Devnet deal first.");
    await associateDemoDeal({ conditionId: selectedCondition.id, dealId: BigInt(demoDeal.dealId) });
    setAssociatedDeal(demoDeal); setNotice("Funded Devnet deal linked to this condition.");
  });
  const editAsNew = () => { if (selectedCondition) { setPrompt(selectedCondition.prompt); setFiles([]); setSubmittedFingerprint(""); setDraftMode(true); setSelectedId(undefined); setSelectedNode(undefined); setNotice("Draft copied. Generate a plan to create a new condition."); } };
  const startNew = () => { setDraftMode(true); setSelectedId(undefined); setSelectedNode(undefined); setPrompt(""); setFiles([]); setNotice("Describe what must become true before settlement executes."); setHistoryOpen(false); };
  const openCondition = (condition: Condition) => { setDraftMode(false); setSelectedId(condition.id); setSelectedNode("condition"); setPrompt(""); setHistoryOpen(false); };
  const saveConditionPrompt = (value: string) => run(async () => { if (!selectedCondition) return; await updateConditionPrompt({ conditionId: selectedCondition.id, prompt: value }); setNotice("Condition updated."); });
  const saveCheck = (check: VerificationCheck, label: string, instruction: string) => run(async () => { await updateVerificationCheck({ checkId: check.id, label, instruction }); setNotice("Verification check updated."); });
  const explain = () => {
    if (!selectedCondition) return setNotice("Create a condition first to see its decision path.");
    const passed = flowChecks.filter((check) => check.passed === true).length;
    const failed = flowChecks.filter((check) => check.passed === false).length;
    const errors = flowChecks.filter((check) => check.status === "error").length;
    setNotice(`Current rows: ${passed} passed, ${failed} failed, ${errors} errored, ${flowChecks.length - passed - failed - errors} pending. ${selectedCondition.finalResult === true ? "The required checks resolved true." : selectedCondition.finalResult === false ? "At least one required check did not pass." : "No final result has been recorded yet."}`);
  };
  const selectedNodeKind = selectedNode === "condition" ? "condition" : selectedNode === "resolution" ? "resolution" : selectedNode === "settlement" ? "settlement" : selectedNode?.startsWith("plan-") ? "plan" : selectedNode?.startsWith("result-") ? "result" : undefined;

  const executionView = selectedCondition?.finalResult === true;
  if (executionView && selectedCondition) return <ExecutionView condition={selectedCondition} checks={flowChecks} deal={settlementDeal} fundedDemoDeal={demoDeal} conditions={conditions} releaseBusy={releaseBusy} onNew={startNew} onOpenCondition={openCondition} onCreateDeal={onCreateDemoDeal} creatingDeal={creatingDeal} onLinkDeal={linkDeal} onRelease={() => {
    if (!settlementDeal?.funded) return;
    const amountSol = settlementDeal.amountLamports === undefined ? "the escrowed amount" : `${(settlementDeal.amountLamports / 1_000_000_000).toFixed(3)} SOL`;
    const recipient = settlementDeal.recipient ? ` to ${settlementDeal.recipient}` : "";
    if (window.confirm(`Release ${amountSol}${recipient} from this escrow on Solana Devnet? This sends an on-chain transaction.`)) {
      void releaseForCondition(selectedCondition, BigInt(settlementDeal.dealId));
    }
  }} />;
  return <main className="decision-app">
    <header className="decision-header"><button className="brand-mark" aria-label="New condition" onClick={startNew}>CS</button><div className="brand-copy"><strong>PROGRAMMABLE SETTLEMENT</strong><span>REAL-WORLD CONDITIONS, EXECUTED ON-CHAIN</span></div><div className="history-actions"><Link href="/" className="flow-agent-link">Agent console ↗</Link><button className="history-button" onClick={startNew}>＋ New condition</button><button className="history-button" onClick={() => setHistoryOpen(true)}>History <span>{conditions.length}</span></button></div><div className="connection-badge"><span className={`live-dot ${isActive ? "is-live" : ""}`} />{connectionError ? "OFFLINE" : isActive ? "DEVNET · LIVE" : "CONNECTING"}</div>
      <button className="deal-button" disabled={creatingDeal || Boolean(demoDeal?.funded && !demoDeal.released)} onClick={onCreateDemoDeal}>{creatingDeal ? "Creating deal…" : demoDeal?.funded && !demoDeal.released ? "Devnet deal funded" : "Create funded Devnet deal"}</button>
    </header>
    <section className="canvas-shell" aria-label="Interactive verification decision graph">
      <div className="canvas-legend"><span>DECISION GRAPH</span><i />{flowChecks.length} CHECK{flowChecks.length === 1 ? "" : "S"}<span className="legend-divider" />DRAG TO EXPLORE</div>
      <CanvasProvider graph={graph} selectedNode={selectedNode} onSelect={(id) => setSelectedNode(id)} conditionId={selectedCondition?.id.toString()} />
      {!selectedCondition && <div className="empty-canvas"><div className="empty-orbit">↳</div><span>CONDITION DESIGN</span><h1>Create a contract condition</h1><p>Describe what must become true before settlement executes.</p></div>}
      {selectedCondition && !flowChecks.length && <div className="empty-canvas plan-empty"><span>PLAN NOT GENERATED</span><p>Saved check branches will appear here.<br />Build a verification plan below to continue.</p></div>}
      {loading && !selectedCondition && <div className="sync-note">Connecting to SpacetimeDB…</div>}
      {triggerToast && <div className="trigger-toast">● CONDITION TRIGGERED <span>Verification started automatically.</span></div>}
      <div className="composer-wrap">{files.map((file, index) => <div className="attachment-card" key={`${file.name}-${file.size}-${index}`}><span className="file-type">{file.name.split(".").pop()?.toUpperCase().slice(0, 5) || "FILE"}</span><strong>{file.name}</strong><span>ATTACHED TO CONDITION · metadata only</span><button aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}
        <div className="composer"><span className="composer-glyph">⌘</span><textarea aria-label="Condition prompt" rows={2} maxLength={2000} placeholder="e.g. Release escrow when a whistleblower claim is independently corroborated." value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createPlan(); }} />
          <label className="attach-button" title="Attach document metadata"><input type="file" hidden multiple disabled={busy} onChange={(event) => { const incoming = Array.from(event.target.files ?? []); setFiles((current) => [...current, ...incoming].slice(0, 10)); event.target.value = ""; }} />＋</label><button className="composer-submit" disabled={busy || !isActive || !prompt.trim() || submittedFingerprint === formFingerprint} onClick={createPlan}>{busy ? "Planning…" : "Generate plan ↗"}</button>
        </div><div className="composer-foot"><span>Documents are attached as metadata; they are not deeply parsed.</span><span>{notice}</span></div>
      </div>
    </section>
    {selectedNodeKind && <><button className="drawer-scrim" aria-label="Close details" onClick={() => setSelectedNode(undefined)} /><aside className="detail-drawer" aria-label={`${selectedNodeKind} details`}>
      <div className="drawer-heading"><div><span>NODE DETAILS</span><h2>{selectedNodeKind === "condition" ? "Condition" : selectedNodeKind === "plan" ? "Check plan" : selectedNodeKind === "result" ? "Evidence & evaluation" : selectedNodeKind === "resolution" ? "Final resolution" : "Solana settlement"}</h2></div><button aria-label="Close details" className="drawer-close" onClick={() => setSelectedNode(undefined)}>×</button></div>
      {selectedNodeKind === "condition" && selectedCondition && <div className="drawer-content">{selectedCondition.status !== "planning" && <StatePill tone="active">{selectedCondition.status === "enabled" ? "ENABLED" : selectedCondition.status === "triggered" ? "TRIGGERED" : selectedCondition.status === "verifying" ? "VERIFYING" : selectedCondition.status === "executed" ? "EXECUTED" : selectedCondition.status.toUpperCase()}</StatePill>}<label className="edit-label">CONTRACT CONDITION<textarea className="drawer-editor" key={`${selectedCondition.id}-prompt`} defaultValue={selectedCondition.prompt} disabled={selectedCondition.status !== "planning"} onBlur={(event) => { if (event.target.value !== selectedCondition.prompt) void saveConditionPrompt(event.target.value); }} /></label><DetailRow label="Created" value={displayTime(selectedCondition.createdAt)} /><DetailRow label="Condition ID" value={selectedCondition.id.toString()} /><DetailRow label="Plan summary" value={planSummaries[selectedCondition.id.toString()] || `${flowChecks.length} proposed checks`} />{flowDocuments.length > 0 && <DetailRow label="Documents" value={flowDocuments.map((doc) => doc.fileName).join(", ")} />}
        {flowChecks.length > 0 && selectedCondition.status === "planning" && <button className="drawer-primary-button" disabled={busy} onClick={enableAutomation}>{busy ? "Saving…" : "ENABLE AUTOMATION"}</button>}{selectedCondition.status === "enabled" && <div className="drawer-hint">✓ AUTOMATION ENABLED<br />Waiting for a condition trigger…</div>}{!flowChecks.length && <div className="drawer-hint">Generate a verification plan before enabling.</div>}</div>}
      {(selectedNodeKind === "plan" || selectedNodeKind === "result") && selectedCheck && <div className="drawer-content"><StatePill tone={selectedNodeKind === "plan" ? "active" : statusTone(selectedCheck.status === "pending" ? "pending" : selectedCheck.status === "complete" ? selectedCheck.passed ? "passed" : "failed" : selectedCheck.status)}>{selectedNodeKind === "plan" ? selectedCheck.kind : selectedCheck.status === "complete" ? selectedCheck.passed ? "passed" : "failed" : selectedCheck.status}</StatePill>{selectedNodeKind === "plan" && selectedCondition?.status === "planning" ? <><label className="edit-label">PROPOSED CHECK<input className="drawer-editor" key={`${selectedCheck.id}-label`} defaultValue={selectedCheck.label} onBlur={(event) => { if (event.target.value !== selectedCheck.label) void saveCheck(selectedCheck, event.target.value, selectedCheck.instruction); }} /></label><label className="edit-label">INSTRUCTION<textarea className="drawer-editor" key={`${selectedCheck.id}-instruction`} defaultValue={selectedCheck.instruction} onBlur={(event) => { if (event.target.value !== selectedCheck.instruction) void saveCheck(selectedCheck, selectedCheck.label, event.target.value); }} /></label></> : <><h3 className="drawer-primary">{selectedCheck.label}</h3><DetailRow label="Instruction" value={selectedCheck.instruction} /></>}<DetailRow label="Check type" value={selectedCheck.kind} /><DetailRow label="Current status" value={selectedCheck.status === "complete" ? selectedCheck.passed ? "Passed" : "Failed" : selectedCheck.status} /><DetailRow label="Required" value="Yes" />{selectedCheck.summary && <DetailRow label="Evaluation" value={selectedCheck.summary} />}
        {selectedNodeKind === "result" && <><div className="drawer-section-title">EVIDENCE · {selectedEvidence.length}</div>{selectedEvidence.length ? selectedEvidence.map((item) => <article key={item.id.toString()} className="evidence-item"><div className="evidence-meta">{item.sourceType}{item.authorOrSource ? ` · ${item.authorOrSource}` : ""}</div><strong>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.title}</strong><p>{item.snippet || "No snippet provided."}</p><time>{displayTime(item.createdAt)}</time></article>) : <div className="drawer-hint">No evidence rows are attached to this check yet. Evidence appears here when the live verification runner records it.</div>}</>}</div>}
      {selectedNodeKind === "resolution" && selectedCondition && <div className="drawer-content"><StatePill tone={statusTone(selectedCondition.finalResult === true ? "true" : selectedCondition.finalResult === false ? "false" : "pending")}>{selectedCondition.finalResult === true ? "TRUE" : selectedCondition.finalResult === false ? "FALSE" : "PENDING"}</StatePill><h3 className="drawer-primary">{selectedCondition.finalResult === true ? "Condition verified" : selectedCondition.finalResult === false ? "Condition not verified" : "Verification in progress"}</h3><DetailRow label="Required checks passed" value={`${flowChecks.filter((check) => check.passed === true).length} / ${flowChecks.length}`} />{flowChecks.map((check) => <div className="outcome-row" key={check.id.toString()}><span className={`outcome-dot ${statusTone(check.status === "complete" ? check.passed ? "passed" : "failed" : check.status)}`} /><span>{check.label}</span><b>{check.status === "complete" ? check.passed ? "PASS" : "FAIL" : check.status.toUpperCase()}</b></div>)}<div className="drawer-hint">{selectedCondition.finalResult === false ? "One or more required checks did not pass, so settlement remains locked." : "The final result comes from the live verification runner."}</div></div>}
      {selectedNodeKind === "settlement" && selectedCondition && <div className="drawer-content"><StatePill tone={statusTone(selectedCondition.settlementStatus === "ready" ? "ready" : selectedCondition.settlementStatus)}>{selectedCondition.settlementStatus === "ready" ? "READY" : selectedCondition.settlementStatus.toUpperCase()}</StatePill><h3 className="drawer-primary">{selectedCondition.settlementStatus === "ready" ? "Manual Devnet release available" : selectedCondition.settlementStatus === "confirmed" ? "Funds released on Devnet" : "Escrow settlement"}</h3><DetailRow label="Network" value="Solana Devnet" /><DetailRow label="Deal ID" value={dealId?.toString() ?? "Not linked"} />{settlementDeal?.amountLamports !== undefined && <DetailRow label="Amount" value={`${settlementDeal.amountLamports / 1_000_000_000} SOL`} />}{settlementDeal?.recipient && <DetailRow label="Recipient" value={settlementDeal.recipient} />}{selectedCondition.settlementSignature && <DetailRow label="Transaction" value={<a href={`https://explorer.solana.com/tx/${selectedCondition.settlementSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View on Solana Explorer ↗</a>} />}
        {!dealId && demoDeal?.funded && <button className="drawer-primary-button" onClick={linkDeal}>Link current funded Devnet deal</button>}{selectedCondition.finalResult === true && !dealId && <div className="drawer-hint">Condition verified. No funded Devnet escrow is linked, so no funds have moved.</div>}{selectedCondition.settlementStatus === "submitted" && <div className="drawer-hint">TRANSACTION SUBMITTED · awaiting confirmation</div>}{selectedCondition.settlementStatus === "failed" && <div className="drawer-hint">Devnet settlement failed. No automatic retry was started.</div>}
      </div>}
      {selectedNodeKind === "condition" && selectedCondition && <button className="drawer-secondary-button" onClick={editAsNew}>Use this as a new draft</button>}
    </aside></>}
    {historyOpen && <><button className="history-scrim" aria-label="Close condition history" onClick={() => setHistoryOpen(false)} /><aside className="history-drawer"><div className="drawer-heading"><div><span>PROGRAM HISTORY</span><h2>Conditions</h2></div><button aria-label="Close history" className="drawer-close" onClick={() => setHistoryOpen(false)}>×</button></div>{[...conditions].sort(newestFirst).map((condition) => <button className="history-item" key={condition.id.toString()} onClick={() => openCondition(condition)}><span className="history-state">{conditionHistoryState(condition)}</span><strong>{condition.prompt}</strong><span>{displayTime(condition.updatedAt)}{condition.finalResult === true ? " · TRUE" : condition.finalResult === false ? " · FALSE" : ""}</span></button>)}{!conditions.length && <p className="history-empty">Your programmed conditions will appear here.</p>}</aside></>}
  </main>;
}

function CanvasProvider(props: { graph: { nodes: GraphNode[]; edges: Edge[] }; selectedNode?: string; onSelect: (id: string) => void; conditionId?: string }) {
  return <div className="flow-layer"><ReactFlowProvider><GraphCanvas graph={props.graph} selectedNode={props.selectedNode} onSelect={props.onSelect} conditionId={props.conditionId} /></ReactFlowProvider></div>;
}
function StatePill({ children, tone }: { children: React.ReactNode; tone: string }) { return <span className={`state-pill state-${tone}`}>{children}</span>; }
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) { return <div className="detail-row"><span>{label}</span><div>{value}</div></div>; }

function ExecutionView({ condition, checks, deal, fundedDemoDeal, conditions, releaseBusy, onNew, onOpenCondition, onCreateDeal, creatingDeal, onLinkDeal, onRelease }: { condition: Condition; checks: readonly VerificationCheck[]; deal?: DemoDeal; fundedDemoDeal?: DemoDeal; conditions: readonly Condition[]; releaseBusy: boolean; onNew: () => void; onOpenCondition: (condition: Condition) => void; onCreateDeal?: () => void; creatingDeal: boolean; onLinkDeal: () => void; onRelease: () => void }) {
  const confirmed = condition.settlementStatus === "confirmed" || deal?.released === true;
  const submitted = condition.settlementStatus === "submitted" || releaseBusy;
  const [historyOpen, setHistoryOpen] = useState(false);
  const programLines = [
    "require!(deal.funded, EscrowError::NotFunded);",
    "require!(deal.has_result, EscrowError::MissingConditionResult);",
    "require!(deal.condition_result, EscrowError::ConditionFalse);",
    "require!(!deal.released, EscrowError::AlreadyReleased);",
    "invoke_signed(&ix, &[ctx.accounts.escrow.to_account_info(), ctx.accounts.recipient.to_account_info(), ctx.accounts.system_program.to_account_info()], &[seeds])?;",
    "deal.released = true;",
  ];
  return <main className="execution-app">
    <header className="execution-header"><button className="brand-mark" onClick={onNew} aria-label="Create new condition">CS</button><div className="brand-copy"><strong>CONDITION EXECUTION</strong><span>REAL-WORLD VERIFICATION → SOLANA SETTLEMENT</span></div><Link href="/" className="flow-agent-link">Agent console ↗</Link><button className="history-button" onClick={() => setHistoryOpen(true)}>History</button><span className="execution-network">SOLANA DEVNET</span></header>
    <div className="execution-content">
      <div className="execution-title"><span>PROGRAMMABLE CONDITION · {condition.id.toString()}</span><h1>{confirmed ? "Settlement executed." : submitted ? "Transaction submitted." : "Condition verified."}</h1><p>Off-chain checks passed. Review the recipient and amount before confirming any Devnet release.</p></div>
      <div className="execution-chain">
        <article className="execution-step is-complete"><span>01 / RESULT</span><h2>✓ CONDITION VERIFIED</h2><code>condition_{condition.id.toString()} → true</code><div className="abstraction-code"><small>DEVELOPER ABSTRACTION · NOT A SOLANA FUNCTION</small><pre>if isConditionSatisfied() &#123;{"\n"}    releaseEscrow();{"\n"}&#125;</pre></div></article>
        <div className={`execution-signal ${confirmed || submitted ? "signal-lit" : ""}`} />
        <article className={`execution-step ${confirmed || submitted ? "is-complete" : "is-active"}`}><span>02 / TRUST BOUNDARY</span><h2>VERIFIER BRIDGE</h2><p>Verified result submitted by the configured verifier identity.</p></article>
        <div className={`execution-signal ${confirmed ? "signal-lit" : ""}`} />
        <article className={`execution-step program-step ${confirmed ? "is-complete" : "is-active"}`}><span>03 / ON-CHAIN ENFORCEMENT · programs/conditional_escrow/src/lib.rs:32</span><h2>SOLANA PROGRAM</h2><pre>{programLines.map((line, index) => <code key={line} className={index === 2 ? "source-highlight" : ""}><i>32</i>{line}{"\n"}</code>)}</pre></article>
        <div className={`execution-signal ${confirmed ? "signal-lit" : ""}`} />
        <article className={`execution-step ${confirmed ? "is-complete" : "is-active"}`}><span>04 / SETTLEMENT</span><h2>{confirmed ? "✓ SETTLEMENT EXECUTED" : !deal?.funded ? "NO FUNDED ESCROW LINKED" : submitted ? "TRANSACTION SUBMITTED" : "AWAITING YOUR CONFIRMATION"}</h2>{confirmed && deal?.amountLamports !== undefined ? <strong className="released-amount">{(deal.amountLamports / 1_000_000_000).toFixed(3)} DEVNET SOL RELEASED</strong> : !deal?.funded ? <><p>No funded Devnet escrow is linked. No funds have moved.</p>{fundedDemoDeal?.funded ? <button className="drawer-primary-button" disabled={releaseBusy} onClick={onLinkDeal}>Link funded Devnet escrow</button> : onCreateDeal && <button className="drawer-primary-button" disabled={creatingDeal} onClick={onCreateDeal}>{creatingDeal ? "Creating Devnet escrow…" : "Create funded Devnet escrow"}</button>}</> : <><p>{deal.amountLamports === undefined ? "Review the funded Devnet escrow before release." : `${(deal.amountLamports / 1_000_000_000).toFixed(3)} SOL`} {deal.recipient ? `to ${deal.recipient}` : ""}</p>{!submitted && condition.settlementStatus === "ready" && <button className="drawer-primary-button" disabled={releaseBusy} onClick={onRelease}>{releaseBusy ? "Submitting release…" : "Confirm Devnet release"}</button>}</>}{condition.settlementSignature && <a href={`https://explorer.solana.com/tx/${condition.settlementSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View on Solana Explorer ↗</a>}</article>
      </div>
      <div className="execution-footer"><span>{checks.length} live checks · {checks.filter((check) => check.passed === true).length} passed · {condition.settlementStatus.toUpperCase()}</span><button className="history-button" onClick={onNew}>＋ New condition</button></div>
    </div>
    {historyOpen && <><button className="history-scrim" aria-label="Close condition history" onClick={() => setHistoryOpen(false)} /><aside className="history-drawer"><div className="drawer-heading"><div><span>PROGRAM HISTORY</span><h2>Conditions</h2></div><button aria-label="Close history" className="drawer-close" onClick={() => setHistoryOpen(false)}>×</button></div>{[...conditions].sort(newestFirst).map((item) => <button className="history-item" key={item.id.toString()} onClick={() => { setHistoryOpen(false); onOpenCondition(item); }}><span className="history-state">{conditionHistoryState(item)}</span><strong>{item.prompt}</strong><span>{displayTime(item.updatedAt)}{item.finalResult === true ? " · TRUE" : item.finalResult === false ? " · FALSE" : ""}</span></button>)}</aside></>}
  </main>;
}
