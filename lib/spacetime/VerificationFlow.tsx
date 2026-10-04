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
    detail: settlement === "ready" ? "Automatic release queued" : condition.settlementSignature ? "Transaction signature available" : "Devnet escrow", status: settlement, tone: statusTone(settlement), animate: true,
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
      setNotice("Asking the planning model to design verification checks…");
      const response = await fetch("/api/verification-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ condition: prompt.trim(), ...(files.length ? { documents: files.map((file) => ({ fileName: file.name, mimeType: file.type || "application/octet-stream", byteCount: file.size })) } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not generate a plan.");
      const plan = result as VerificationPlan;
      setNotice("Plan designed. Saving the condition to SpacetimeDB…");
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
      setNotice("Condition saved. Writing its verification checks…");
      const priorCheckIds = new Set((Array.from(connection.db.verificationCheck.iter()) as VerificationCheck[]).map((row) => row.id.toString()));
      await setConditionStatus({ conditionId: inserted.id, status: "planning" });
      for (const file of files) await recordUploadedDocument({ conditionId: inserted.id, fileName: file.name, mimeType: file.type || "application/octet-stream", byteCount: BigInt(file.size), contentHash: "metadata-only", storageReference: "metadata-only" });
      for (const [index, check] of plan.checks.entries()) await addVerificationCheck({ conditionId: inserted.id, sequence: index + 1, kind: check.kind, label: check.label, instruction: check.instruction });
      setNotice("Checks saved. Waiting for SpacetimeDB to sync the plan…");
      const expected = new Set(plan.checks.map((_, index) => index + 1));
      let createdChecks: VerificationCheck[] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        createdChecks = (Array.from(connection.db.verificationCheck.iter()) as VerificationCheck[]).filter((row) => row.conditionId === inserted!.id && expected.has(row.sequence) && !priorCheckIds.has(row.id.toString()));
        if (createdChecks.length === plan.checks.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (createdChecks.length !== plan.checks.length) throw new Error("The plan was saved; waiting for its subscribed checks.");
      setPlanSummaries((current) => ({ ...current, [inserted!.id.toString()]: plan.summary })); setSubmittedFingerprint(formFingerprint); setNotice("Plan saved. Nothing is live yet, and verification has not started.");
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
    setNotice(result.result ? "Condition verified. Continuing to the Solana Devnet settlement." : "Verification finished. The condition did not pass all checks.");
    if (result.result === true) {
      const currentDeal = selectedCondition.dealId ? settlementDeal : demoDeal;
      const currentDealId = selectedCondition.dealId ?? (demoDeal?.funded ? BigInt(demoDeal.dealId) : undefined);
      if (!selectedCondition.dealId && demoDeal?.funded) await associateDemoDeal({ conditionId: selectedCondition.id, dealId: BigInt(demoDeal.dealId) });
      if (currentDealId && currentDeal?.funded && selectedCondition.settlementStatus !== "confirmed" && selectedCondition.settlementStatus !== "submitted") await releaseForCondition(selectedCondition, currentDealId);
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
    if (condition.finalResult === false || condition.settlementStatus === "confirmed" || condition.settlementStatus === "submitted" || releaseBusy) return;
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
    try {
      await enableCondition({ conditionId: selectedCondition.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown SpacetimeDB error.";
      throw new Error(`Could not enable this condition. ${detail} If the local database was restarted, publish the current module with npm run spacetime:publish.`);
    }
    setNotice("Condition enabled. The demo trigger starts verification in about 1.5 seconds.");
  });
  const linkDeal = () => run(async () => {
    if (!selectedCondition || !demoDeal?.funded) throw new Error("Create and fund a Devnet deal first.");
    await associateDemoDeal({ conditionId: selectedCondition.id, dealId: BigInt(demoDeal.dealId) });
    setAssociatedDeal(demoDeal); setNotice("Funded Devnet deal linked to this condition.");
    if (selectedCondition.finalResult === true) await releaseForCondition(selectedCondition, BigInt(demoDeal.dealId));
  });
  const editAsNew = () => { if (selectedCondition) { setPrompt(selectedCondition.prompt); setFiles([]); setSubmittedFingerprint(""); setDraftMode(true); setSelectedId(undefined); setSelectedNode(undefined); setNotice("Draft copied. Orchestrate it to create a new verification plan."); } };
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
  if (executionView && selectedCondition) return <ExecutionView key={selectedCondition.id.toString()} condition={selectedCondition} checks={flowChecks} deal={settlementDeal} fundedDemoDeal={demoDeal} conditions={conditions} releaseBusy={releaseBusy} onNew={startNew} onOpenCondition={openCondition} onCreateDeal={onCreateDemoDeal} creatingDeal={creatingDeal} onLinkDeal={linkDeal} />;
  return <main className="decision-app">
    <header className="decision-header"><button className="brand-mark" aria-label="New condition" onClick={startNew}>CS</button><div className="brand-copy"><strong>PROGRAMMABLE SETTLEMENT</strong><span>REAL-WORLD CONDITIONS, EXECUTED ON-CHAIN</span></div><div className="history-actions"><Link href="/" className="flow-agent-link">Agent console ↗</Link><button className="history-button" onClick={startNew}>＋ New condition</button><button className="history-button" onClick={() => setHistoryOpen(true)}>History <span>{conditions.length}</span></button></div><div className="connection-badge"><span className={`live-dot ${isActive ? "is-live" : ""}`} />{connectionError ? "OFFLINE" : isActive ? "DEVNET · LIVE" : "CONNECTING"}</div>
      <button className="deal-button" disabled={creatingDeal || Boolean(demoDeal?.funded && !demoDeal.released)} onClick={onCreateDemoDeal}>{creatingDeal ? "Creating deal…" : demoDeal?.funded && !demoDeal.released ? "Devnet deal funded" : "Create funded Devnet deal"}</button>
    </header>
    <section className="canvas-shell" aria-label="Interactive verification decision graph">
      <div className="canvas-legend"><span>DECISION GRAPH</span><i />{flowChecks.length} CHECK{flowChecks.length === 1 ? "" : "S"}<span className="legend-divider" />DRAG TO EXPLORE</div>
      <CanvasProvider graph={graph} selectedNode={selectedNode} onSelect={(id) => setSelectedNode(id)} conditionId={selectedCondition?.id.toString()} />
      {!selectedCondition && <div className="empty-canvas"><div className="empty-orbit">IF → THEN</div><span>INTELLIGENT EXTERNAL FUNCTIONS · SOLANA</span><h1>Give your Solana smart contracts intelligent functions for the real world.</h1><p>Describe a real-world condition in plain language. Verify it off-chain, then let your Solana program act on the result.</p><div className="compiler-path"><span>PLAIN LANGUAGE</span><i>→</i><span>VERIFIED RESULT</span><i>→</i><span>SOLANA PROGRAM</span></div></div>}
      {selectedCondition && !flowChecks.length && <div className="empty-canvas plan-empty"><span>PLAN NOT GENERATED</span><p>Saved check branches will appear here.<br />Build a verification plan below to continue.</p></div>}
      {loading && !selectedCondition && <div className="sync-note">Connecting to SpacetimeDB…</div>}
      {triggerToast && <div className="trigger-toast">● CONDITION TRIGGERED <span>Verification started automatically.</span></div>}
      {!selectedCondition && <div className="rule-editor-dock">
        <div className="rule-editor-heading"><span>RULE EDITOR <i>·</i> DRAFT 01</span><span>NO TRANSACTION UNTIL CONDITION IS ENABLED</span></div>
        <div className="rule-equation">
          <label className="rule-when"><span><b>IF</b> REAL-WORLD CONDITION</span><textarea aria-label="Condition prompt" rows={2} maxLength={2000} placeholder="A whistleblower claim is independently corroborated…" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createPlan(); }} /></label>
          <div className="rule-arrow" aria-hidden="true">→</div>
          <div className="rule-then"><span><b>THEN</b> ON-CHAIN ACTION</span><code>release_payment()</code><small>Anchor · conditional_escrow · funded Devnet deal</small></div>
        </div>
        {files.length > 0 && <div className="attachment-stack">{files.map((file, index) => <div className="attachment-card" key={`${file.name}-${file.size}-${index}`}><span className="file-type">{file.name.split(".").pop()?.toUpperCase().slice(0, 5) || "FILE"}</span><strong>{file.name}</strong><span>METADATA ONLY</span><button aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div>}
        <div className="rule-editor-footer"><label className="attach-button" title="Attach document metadata"><input type="file" hidden multiple disabled={busy} onChange={(event) => { const incoming = Array.from(event.target.files ?? []); setFiles((current) => [...current, ...incoming].slice(0, 10)); event.target.value = ""; }} />＋ <span>Attach evidence metadata</span></label><span className="metadata-note">Files are not uploaded or parsed.</span><button className="composer-submit" disabled={busy || !isActive || !prompt.trim() || submittedFingerprint === formFingerprint} onClick={createPlan}>{busy ? "Orchestrating…" : "ORCHESTRATE CONDITION ↗"}</button></div>
        <div className="rule-editor-status" role="status" aria-live="polite">{notice}</div>
      </div>}
    </section>
    {selectedNodeKind && <><button className="drawer-scrim" aria-label="Close details" onClick={() => setSelectedNode(undefined)} /><aside className="detail-drawer" aria-label={`${selectedNodeKind} details`}>
      <div className="drawer-heading"><div><span>NODE DETAILS</span><h2>{selectedNodeKind === "condition" ? "Condition" : selectedNodeKind === "plan" ? "Check plan" : selectedNodeKind === "result" ? "Evidence & evaluation" : selectedNodeKind === "resolution" ? "Final resolution" : "Solana settlement"}</h2></div><button aria-label="Close details" className="drawer-close" onClick={() => setSelectedNode(undefined)}>×</button></div>
      {selectedNodeKind === "condition" && selectedCondition && <div className="drawer-content">{selectedCondition.status !== "planning" && <StatePill tone="active">{selectedCondition.status === "enabled" ? "ENABLED" : selectedCondition.status === "triggered" ? "TRIGGERED" : selectedCondition.status === "verifying" ? "VERIFYING" : selectedCondition.status === "executed" ? "EXECUTED" : selectedCondition.status.toUpperCase()}</StatePill>}<label className="edit-label">CONTRACT CONDITION<textarea className="drawer-editor" key={`${selectedCondition.id}-prompt`} defaultValue={selectedCondition.prompt} disabled={selectedCondition.status !== "planning"} onBlur={(event) => { if (event.target.value !== selectedCondition.prompt) void saveConditionPrompt(event.target.value); }} /></label><DetailRow label="Created" value={displayTime(selectedCondition.createdAt)} /><DetailRow label="Condition ID" value={selectedCondition.id.toString()} /><DetailRow label="Plan summary" value={planSummaries[selectedCondition.id.toString()] || `${flowChecks.length} proposed checks`} />{flowDocuments.length > 0 && <DetailRow label="Documents" value={flowDocuments.map((doc) => doc.fileName).join(", ")} />}
        {flowChecks.length > 0 && selectedCondition.status === "planning" && <><div className="activation-card"><span>PLAN SAVED · NOT LIVE</span><p>Enabling starts checks after the 1.5 second demo trigger. If they all pass and a funded Devnet deal is linked, the app automatically submits the release.</p><button className="drawer-primary-button" disabled={busy} onClick={enableAutomation}>{busy ? "Enabling…" : "ENABLE CONDITION"}</button></div><div className="action-feedback" role="status" aria-live="polite">{notice}</div></>}{selectedCondition.status === "enabled" && <div className="drawer-hint">✓ CONDITION ENABLED<br />Waiting for the demo trigger…</div>}{!flowChecks.length && <div className="drawer-hint">Orchestrate a verification plan before enabling this condition.</div>}</div>}
      {(selectedNodeKind === "plan" || selectedNodeKind === "result") && selectedCheck && <div className="drawer-content"><StatePill tone={selectedNodeKind === "plan" ? "active" : statusTone(selectedCheck.status === "pending" ? "pending" : selectedCheck.status === "complete" ? selectedCheck.passed ? "passed" : "failed" : selectedCheck.status)}>{selectedNodeKind === "plan" ? selectedCheck.kind : selectedCheck.status === "complete" ? selectedCheck.passed ? "passed" : "failed" : selectedCheck.status}</StatePill>{selectedNodeKind === "plan" && selectedCondition?.status === "planning" ? <><label className="edit-label">PROPOSED CHECK<input className="drawer-editor" key={`${selectedCheck.id}-label`} defaultValue={selectedCheck.label} onBlur={(event) => { if (event.target.value !== selectedCheck.label) void saveCheck(selectedCheck, event.target.value, selectedCheck.instruction); }} /></label><label className="edit-label">INSTRUCTION<textarea className="drawer-editor" key={`${selectedCheck.id}-instruction`} defaultValue={selectedCheck.instruction} onBlur={(event) => { if (event.target.value !== selectedCheck.instruction) void saveCheck(selectedCheck, selectedCheck.label, event.target.value); }} /></label></> : <><h3 className="drawer-primary">{selectedCheck.label}</h3><DetailRow label="Instruction" value={selectedCheck.instruction} /></>}<DetailRow label="Check type" value={selectedCheck.kind} /><DetailRow label="Current status" value={selectedCheck.status === "complete" ? selectedCheck.passed ? "Passed" : "Failed" : selectedCheck.status} /><DetailRow label="Required" value="Yes" />{selectedCheck.summary && <DetailRow label="Evaluation" value={selectedCheck.summary} />}
        {selectedNodeKind === "result" && <><div className="drawer-section-title">EVIDENCE · {selectedEvidence.length}</div>{selectedEvidence.length ? selectedEvidence.map((item) => <article key={item.id.toString()} className="evidence-item"><div className="evidence-meta">{item.sourceType}{item.authorOrSource ? ` · ${item.authorOrSource}` : ""}</div><strong>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.title}</strong><p>{item.snippet || "No snippet provided."}</p><time>{displayTime(item.createdAt)}</time></article>) : <div className="drawer-hint">No evidence rows are attached to this check yet. Evidence appears here when the live verification runner records it.</div>}</>}</div>}
      {selectedNodeKind === "resolution" && selectedCondition && <div className="drawer-content"><StatePill tone={statusTone(selectedCondition.finalResult === true ? "true" : selectedCondition.finalResult === false ? "false" : "pending")}>{selectedCondition.finalResult === true ? "TRUE" : selectedCondition.finalResult === false ? "FALSE" : "PENDING"}</StatePill><h3 className="drawer-primary">{selectedCondition.finalResult === true ? "Condition verified" : selectedCondition.finalResult === false ? "Condition not verified" : "Verification in progress"}</h3><DetailRow label="Required checks passed" value={`${flowChecks.filter((check) => check.passed === true).length} / ${flowChecks.length}`} />{flowChecks.map((check) => <div className="outcome-row" key={check.id.toString()}><span className={`outcome-dot ${statusTone(check.status === "complete" ? check.passed ? "passed" : "failed" : check.status)}`} /><span>{check.label}</span><b>{check.status === "complete" ? check.passed ? "PASS" : "FAIL" : check.status.toUpperCase()}</b></div>)}<div className="drawer-hint">{selectedCondition.finalResult === false ? "One or more required checks did not pass, so settlement remains locked." : "The final result comes from the live verification runner."}</div></div>}
      {selectedNodeKind === "settlement" && selectedCondition && <div className="drawer-content"><StatePill tone={statusTone(selectedCondition.settlementStatus === "ready" ? "ready" : selectedCondition.settlementStatus)}>{selectedCondition.settlementStatus === "ready" ? "READY" : selectedCondition.settlementStatus.toUpperCase()}</StatePill><h3 className="drawer-primary">{selectedCondition.settlementStatus === "ready" ? "Automatic Devnet release queued" : selectedCondition.settlementStatus === "confirmed" ? "Funds released on Devnet" : "Escrow settlement"}</h3><DetailRow label="Network" value="Solana Devnet" /><DetailRow label="Deal ID" value={dealId?.toString() ?? "Not linked"} />{settlementDeal?.amountLamports !== undefined && <DetailRow label="Amount" value={`${settlementDeal.amountLamports / 1_000_000_000} SOL`} />}{settlementDeal?.recipient && <DetailRow label="Recipient" value={settlementDeal.recipient} />}{selectedCondition.settlementSignature && <DetailRow label="Transaction" value={<a href={`https://explorer.solana.com/tx/${selectedCondition.settlementSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View on Solana Explorer ↗</a>} />}
        {!dealId && demoDeal?.funded && selectedCondition.finalResult === true && <div className="drawer-hint">Linking a funded deal to this passing condition automatically attempts Devnet settlement.</div>}{!dealId && demoDeal?.funded && <button className="drawer-primary-button" onClick={linkDeal}>Link current funded Devnet deal</button>}{selectedCondition.finalResult === true && !dealId && <div className="drawer-hint">Condition verified. No funded Devnet escrow is linked, so no funds have moved.</div>}{selectedCondition.settlementStatus === "submitted" && <div className="drawer-hint">TRANSACTION SUBMITTED · awaiting confirmation</div>}{selectedCondition.settlementStatus === "failed" && <div className="drawer-hint">Devnet settlement failed. No automatic retry was started.</div>}
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

function ExecutionView({ condition, checks, deal, fundedDemoDeal, conditions, releaseBusy, onNew, onOpenCondition, onCreateDeal, creatingDeal, onLinkDeal }: { condition: Condition; checks: readonly VerificationCheck[]; deal?: DemoDeal; fundedDemoDeal?: DemoDeal; conditions: readonly Condition[]; releaseBusy: boolean; onNew: () => void; onOpenCondition: (condition: Condition) => void; onCreateDeal?: () => void; creatingDeal: boolean; onLinkDeal: () => void }) {
  const confirmed = condition.settlementStatus === "confirmed" || deal?.released === true;
  const submitted = condition.settlementStatus === "submitted" || releaseBusy;
  const failed = condition.settlementStatus === "failed";
  const hasFundedDeal = deal?.funded === true;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revealedStep, setRevealedStep] = useState(0);
  const steps = [
    { label: "REAL-WORLD RESULT", title: "Condition verified", detail: `${checks.filter((check) => check.passed === true).length} of ${checks.length} required checks passed` },
    { label: "VERIFIER", title: "Attesting the result", detail: "Configured verifier signs the condition result" },
    { label: "ANCHOR PROGRAM", title: "Checking the rule", detail: "The program enforces the verified result" },
    { label: "ESCROW", title: "Releasing payment", detail: "SOL moves only after every guard passes" },
  ];
  useEffect(() => {
    setRevealedStep(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealedStep(hasFundedDeal ? 3 : 0);
      return;
    }
    if (!hasFundedDeal) return;
    const timer = window.setInterval(() => setRevealedStep((step) => {
      if (step >= 3) { window.clearInterval(timer); return step; }
      return step + 1;
    }), 1200);
    return () => window.clearInterval(timer);
  }, [condition.id, hasFundedDeal]);
  const presentationStep = hasFundedDeal ? revealedStep : 0;
  const shownConfirmed = confirmed && presentationStep >= 3;
  const shownFailed = failed && presentationStep >= 3;
  const activeLabel = shownConfirmed ? "SETTLEMENT CONFIRMED" : shownFailed ? "RELEASE FAILED" : confirmed ? "REPLAYING EXECUTION TRACE" : submitted ? "WAITING FOR DEVNET" : hasFundedDeal ? "PREPARING SETTLEMENT" : "VERIFICATION COMPLETE";
  const programLines = [
    { number: 32, text: "require!(deal.condition_result, EscrowError::ConditionFalse);", step: 2 },
    { number: 35, text: "invoke_signed(&ix, &[ctx.accounts.escrow.to_account_info(), ctx.accounts.recipient.to_account_info(), ctx.accounts.system_program.to_account_info()], &[seeds])?;", step: 3 },
    { number: 36, text: "deal.released = true;", step: 3 },
  ];
  return <main className="execution-app">
    <header className="execution-header"><button className="brand-mark" onClick={onNew} aria-label="Create new condition">CS</button><div className="brand-copy"><strong>CONDITION / EXECUTION</strong><span>INTELLIGENT FUNCTIONS FOR SOLANA SMART CONTRACTS</span></div><Link href="/" className="flow-agent-link">Agent console ↗</Link><button className="history-button" onClick={() => setHistoryOpen(true)}>History</button><span className="execution-network">DEVNET <i /></span></header>
    <div className="execution-story">
      <section className="execution-hero"><div><span className="execution-kicker">CONDITION {condition.id.toString()} <i>·</i> LIVE EXECUTION TRACE</span><h1>{shownConfirmed ? "Payment released." : confirmed ? "Replay the settlement." : submitted ? "Your condition is moving on-chain." : "Condition satisfied."}</h1><p className="execution-condition-label">REAL-WORLD CONDITION</p><blockquote>{condition.prompt}</blockquote></div><div className={`execution-state state-${shownConfirmed ? "confirmed" : shownFailed ? "failed" : submitted ? "pending" : "verified"}`}><span className="state-orbit" />{activeLabel}</div></section>
      <section className="execution-timeline" aria-label="Condition execution progress" aria-live="polite">
        <div className="stage-window"><div className="stage-track" style={{ transform: `translate3d(-${Math.max(0, presentationStep) * 25}%, 0, 0)` }}>
        {steps.map((step, index) => {
          const isComplete = (confirmed && presentationStep >= index) || index < presentationStep || (index === 0 && !hasFundedDeal);
          const isActive = hasFundedDeal && index === presentationStep && !shownConfirmed && !shownFailed;
          const state = isComplete ? "complete" : isActive ? "active" : index === 3 && shownFailed ? "failed" : "waiting";
          const title = index === 3 && shownConfirmed ? "Payment released" : index === 3 && shownFailed ? "Release failed" : step.title;
          return <article className="trace-step" data-state={state} aria-current={isActive ? "step" : undefined} aria-hidden={index !== Math.max(0, presentationStep)} key={step.label}>
            <div className="trace-number">0{index + 1}<i> / 04</i></div>
            <div className="trace-symbol" aria-hidden="true"><span>{isComplete ? "✓" : `0${index + 1}`}</span><i /></div>
            <div className="trace-copy"><span>{step.label}</span><strong>{title}</strong><small>{step.detail}</small></div>
            <div className="trace-direction" aria-hidden="true">{index < steps.length - 1 ? "→" : "✓"}</div>
          </article>;
        })}
        </div></div>
        <div className="trace-progress" aria-hidden="true"><div className="trace-progress-line"><i style={{ transform: `scaleX(${Math.max(0, presentationStep) / (steps.length - 1)})` }} /></div>{steps.map((step, index) => <span key={step.label} data-state={index < presentationStep || (index === 0 && !hasFundedDeal) ? "complete" : index === presentationStep && hasFundedDeal ? "active" : "waiting"} />)}</div>
        <div className="trace-progress-caption"><span>EXECUTION SEQUENCE</span><strong>0{Math.max(0, presentationStep) + 1} <i>/</i> 04</strong></div>
      </section>
      <section className="execution-panels">
        <article className="program-panel">
          <header><div><span>ON-CHAIN ENFORCEMENT</span><h2>Anchor program</h2></div><code>conditional_escrow</code></header>
          <div className="program-function"><span>pub fn</span> release_payment() <span>→ Result&lt;()&gt;</span></div>
          <pre className="program-trace">{programLines.map((line) => <code key={line.number} className={presentationStep >= line.step ? "line-lit" : ""}><i>{line.number}</i>{line.text}{"\n"}</code>)}</pre>
          <footer>{presentationStep >= 2 ? "Condition guard passed" : "Waiting for verifier result"}<span className={presentationStep >= 2 ? "guard-pass" : "guard-wait"}>{presentationStep >= 2 ? "PASS" : "WAIT"}</span></footer>
        </article>
        <article className="settlement-panel">
          <div className="settlement-panel-top"><span>SETTLEMENT</span><b className={`settlement-status status-${shownConfirmed ? "confirmed" : shownFailed ? "failed" : submitted || confirmed ? "pending" : hasFundedDeal ? "preparing" : "locked"}`}><i />{shownConfirmed ? "CONFIRMED" : shownFailed ? "FAILED" : confirmed ? "REPLAYING TRACE" : submitted ? "CONFIRMING" : hasFundedDeal ? "IN PROGRESS" : "LOCKED"}</b></div>
          {shownConfirmed && deal?.amountLamports !== undefined ? <><strong className="settlement-amount">{(deal.amountLamports / 1_000_000_000).toFixed(3)} <small>SOL</small></strong><p>Released to the escrow recipient on Devnet.</p></> : shownFailed ? <><h2>Funds remain in escrow.</h2><p>The Devnet release did not complete. Review the deal state before retrying.</p></> : confirmed ? <><h2>Replaying the recorded settlement.</h2><p>Stepping through the confirmed Devnet execution.</p></> : submitted ? <><h2>Waiting for the network.</h2><p>The verifier result and escrow instruction are being confirmed on Solana Devnet.</p></> : hasFundedDeal ? <><h2>Preparing the transfer.</h2><p>The condition passed. The program checks the escrow before release.</p></> : <><h2>No escrow linked.</h2><p>The condition passed, but no funds moved. Link a funded Devnet escrow to continue.</p>{fundedDemoDeal?.funded ? <button className="drawer-primary-button" onClick={onLinkDeal}>Link funded escrow <span>↗</span></button> : onCreateDeal && <button className="drawer-primary-button" disabled={creatingDeal} onClick={onCreateDeal}>{creatingDeal ? "Creating escrow…" : "Create funded escrow"}<span>↗</span></button>}</>}
          {condition.settlementSignature && shownConfirmed && <a className="explorer-link" href={`https://explorer.solana.com/tx/${condition.settlementSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View transaction on Solana Explorer ↗</a>}
        </article>
      </section>
      <footer className="execution-story-footer"><span>{checks.length} verification checks <i>·</i> {checks.filter((check) => check.passed === true).length} passed <i>·</i> Solana Devnet</span><button className="history-button" onClick={onNew}>＋ New condition</button></footer>
    </div>
    {historyOpen && <><button className="history-scrim" aria-label="Close condition history" onClick={() => setHistoryOpen(false)} /><aside className="history-drawer"><div className="drawer-heading"><div><span>PROGRAM HISTORY</span><h2>Conditions</h2></div><button aria-label="Close history" className="drawer-close" onClick={() => setHistoryOpen(false)}>×</button></div>{[...conditions].sort(newestFirst).map((item) => <button className="history-item" key={item.id.toString()} onClick={() => { setHistoryOpen(false); onOpenCondition(item); }}><span className="history-state">{conditionHistoryState(item)}</span><strong>{item.prompt}</strong><span>{displayTime(item.updatedAt)}{item.finalResult === true ? " · TRUE" : item.finalResult === false ? " · FALSE" : ""}</span></button>)}</aside></>}
  </main>;
}
