import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleOff, Copy, Download, Pause, Play, RotateCcw, Zap } from "lucide-react";
import {
  calculateAverage,
  enqueueRequest,
  getNextActiveNode,
  getSkippedFailedNodes,
  getTokenLossTimeout,
  removeRequest,
  selectHighestSequenceToken,
} from "./ring";

const BASE_PASS_INTERVAL = 2000;

const NODES = [
  { id: 0, name: "Node 1", position: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" },
  { id: 1, name: "Node 2", position: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2" },
  { id: 2, name: "Node 3", position: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" },
  { id: 3, name: "Node 4", position: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2" },
];

const TOKEN_POSITIONS = [
  { top: "0%", left: "50%" },
  { top: "50%", left: "100%" },
  { top: "100%", left: "50%" },
  { top: "50%", left: "0%" },
];

const NODE_COORDINATES = [
  { x: 215, y: 0 },
  { x: 430, y: 215 },
  { x: 215, y: 430 },
  { x: 0, y: 215 },
];

const RING_CONNECTIONS = NODES.map((node) => ({
  from: node.id,
  to: (node.id + 1) % NODES.length,
}));

const getConnectionPath = (fromNodeId, toNodeId) => {
  const fromNode = NODE_COORDINATES[fromNodeId];
  const toNode = NODE_COORDINATES[toNodeId];
  const horizontalDistance = toNode.x - fromNode.x;
  const verticalDistance = toNode.y - fromNode.y;
  const distance = Math.hypot(horizontalDistance, verticalDistance);
  if (distance === 0) return "";
  const nodeClearance = 48;
  const startX = fromNode.x + (horizontalDistance / distance) * nodeClearance;
  const startY = fromNode.y + (verticalDistance / distance) * nodeClearance;
  const endX = toNode.x - (horizontalDistance / distance) * nodeClearance;
  const endY = toNode.y - (verticalDistance / distance) * nodeClearance;
  return `M ${startX} ${startY} L ${endX} ${endY}`;
};

const getFormattedTime = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const formatDuration = (duration) => {
  if (duration < 1000) return `${Math.round(duration)} ms`;
  return `${(duration / 1000).toFixed(1)} s`;
};

const createInitialEventLog = () => [
  { id: Date.now() + 2, time: getFormattedTime(), text: "Token created at Node 1", type: "info" },
  { id: Date.now() + 1, time: getFormattedTime(), text: "System initialized...", type: "system" },
];

const createNodeMetricValues = () => NODES.map(() => 0);

function App() {
  const [running, setRunning] = useState(false);
  const [currentNode, setCurrentNode] = useState(0);
  const [tokenAvailable, setTokenAvailable] = useState(true);
  const [tokenSequence, setTokenSequence] = useState(1);
  const [tokenPasses, setTokenPasses] = useState(0);
  const [criticalSections, setCriticalSections] = useState(0);
  const [failedNodeIds, setFailedNodeIds] = useState([]);
  const [requestQueue, setRequestQueue] = useState([]);
  const [criticalNode, setCriticalNode] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [autoRandomRequests, setAutoRandomRequests] = useState(false);
  const [averageWaitingTimes, setAverageWaitingTimes] = useState(createNodeMetricValues);
  const [averageRotationTime, setAverageRotationTime] = useState(0);
  const [csEntriesByNode, setCsEntriesByNode] = useState(createNodeMetricValues);
  const [throughput, setThroughput] = useState(0);
  const [tokenLosses, setTokenLosses] = useState(0);
  const [tokenRegenerations, setTokenRegenerations] = useState(0);
  const [tokenAlert, setTokenAlert] = useState(null);
  const [duplicateToken, setDuplicateToken] = useState(null);
  const [eventLog, setEventLog] = useState(createInitialEventLog);

  const passInterval = Math.round(BASE_PASS_INTERVAL / speed);

  const timerRef = useRef(null);
  const criticalTimeoutRef = useRef(null);
  const runningRef = useRef(false);
  const currentNodeRef = useRef(0);
  const tokenAvailableRef = useRef(true);
  const tokenSequenceRef = useRef(1);
  const tokenPassesRef = useRef(0);
  const criticalSectionsRef = useRef(0);
  const failedNodeIdsRef = useRef([]);
  const requestQueueRef = useRef([]);
  const criticalNodeRef = useRef(null);
  const autoRandomRequestsRef = useRef(false);
  const requestStartedAtRef = useRef(new Map());
  const waitingTimeTotalsRef = useRef(createNodeMetricValues());
  const waitingTimeCountsRef = useRef(createNodeMetricValues());
  const csEntriesByNodeRef = useRef(createNodeMetricValues());
  const rotationStartedAtRef = useRef(Date.now());
  const passesInRotationRef = useRef(0);
  const rotationDurationTotalRef = useRef(0);
  const rotationCountRef = useRef(0);
  const elapsedRunDurationRef = useRef(0);
  const runStartedAtRef = useRef(null);
  const tokenLossStartedAtRef = useRef(null);
  const lostTokenOriginRef = useRef(null);
  const tokenLossesRef = useRef(0);
  const tokenRegenerationsRef = useRef(0);
  const tokenLossMonitorRef = useRef(null);
  const duplicateResolveTimeoutRef = useRef(null);
  const alertTimeoutRef = useRef(null);
  const tokenRef = useRef(null);
  const tokenAnimationRef = useRef(null);
  const visualTokenNodeRef = useRef(null);

  /* ── Utility callbacks ─────────────────────────────────────── */

  const resetRotationMeasurement = useCallback(() => {
    rotationStartedAtRef.current = Date.now();
    passesInRotationRef.current = 0;
  }, []);

  const markTokenSeen = useCallback(() => {
    tokenLossStartedAtRef.current = null;
    lostTokenOriginRef.current = null;
  }, []);

  const addLog = useCallback((text, type = "info") => {
    const entry = { id: Date.now() + Math.random(), time: getFormattedTime(), text, type };
    setEventLog((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  const showTokenAlert = useCallback((message) => {
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    setTokenAlert(message);
    alertTimeoutRef.current = setTimeout(() => {
      setTokenAlert(null);
      alertTimeoutRef.current = null;
    }, 3500);
  }, []);

  const setSimulationRunning = useCallback((next) => {
    const now = Date.now();
    if (next && !runningRef.current) runStartedAtRef.current = now;
    if (!next && runningRef.current && runStartedAtRef.current !== null) {
      elapsedRunDurationRef.current += now - runStartedAtRef.current;
      runStartedAtRef.current = null;
    }
    runningRef.current = next;
    setRunning(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const stopTokenLossMonitor = useCallback(() => {
    if (tokenLossMonitorRef.current) { clearTimeout(tokenLossMonitorRef.current); tokenLossMonitorRef.current = null; }
  }, []);

  const clearCriticalSection = useCallback(() => {
    if (criticalTimeoutRef.current) { clearTimeout(criticalTimeoutRef.current); criticalTimeoutRef.current = null; }
    criticalNodeRef.current = null;
    setCriticalNode(null);
  }, []);

  const removePendingRequest = useCallback((nodeId) => {
    const updated = removeRequest(requestQueueRef.current, nodeId);
    if (updated.length === requestQueueRef.current.length) return false;
    requestQueueRef.current = updated;
    setRequestQueue(updated);
    return true;
  }, []);

  /* ── Metrics helpers ───────────────────────────────────────── */

  const recordTokenPass = useCallback(() => {
    const count = tokenPassesRef.current + 1;
    tokenPassesRef.current = count;
    setTokenPasses(count);
    // Rotation tracking
    passesInRotationRef.current += 1;
    const active = NODES.length - failedNodeIdsRef.current.length;
    if (active > 0 && passesInRotationRef.current >= active) {
      const dur = Date.now() - rotationStartedAtRef.current;
      rotationDurationTotalRef.current += dur;
      rotationCountRef.current += 1;
      setAverageRotationTime(calculateAverage(rotationDurationTotalRef.current, rotationCountRef.current));
      rotationStartedAtRef.current = Date.now();
      passesInRotationRef.current = 0;
    }
  }, []);

  const updateThroughput = useCallback(() => {
    let elapsed = elapsedRunDurationRef.current;
    if (runningRef.current && runStartedAtRef.current !== null) elapsed += Date.now() - runStartedAtRef.current;
    const mins = elapsed / 60000;
    if (mins > 0) setThroughput(parseFloat((criticalSectionsRef.current / mins).toFixed(1)));
  }, []);

  /* ── Critical section ──────────────────────────────────────── */

  const startCriticalSection = useCallback((nodeId) => {
    if (criticalNodeRef.current !== null || currentNodeRef.current !== nodeId || failedNodeIdsRef.current.includes(nodeId)) return false;

    removePendingRequest(nodeId);
    criticalNodeRef.current = nodeId;
    setCriticalNode(nodeId);
    criticalSectionsRef.current += 1;
    setCriticalSections(criticalSectionsRef.current);

    // CS entries per node (fairness)
    csEntriesByNodeRef.current[nodeId] += 1;
    setCsEntriesByNode([...csEntriesByNodeRef.current]);

    // Waiting time
    const reqAt = requestStartedAtRef.current.get(nodeId);
    if (reqAt) {
      const wait = Date.now() - reqAt;
      waitingTimeTotalsRef.current[nodeId] += wait;
      waitingTimeCountsRef.current[nodeId] += 1;
      setAverageWaitingTimes(waitingTimeTotalsRef.current.map((t, i) => calculateAverage(t, waitingTimeCountsRef.current[i])));
      requestStartedAtRef.current.delete(nodeId);
    }

    updateThroughput();
    addLog(`${NODES[nodeId].name} entered Critical Section`, "critical");

    criticalTimeoutRef.current = setTimeout(() => {
      if (criticalNodeRef.current !== nodeId) return;
      criticalNodeRef.current = null;
      criticalTimeoutRef.current = null;
      setCriticalNode(null);
      addLog(`${NODES[nodeId].name} released Critical Section`, "info");
    }, 2000);
    return true;
  }, [addLog, removePendingRequest, updateThroughput]);

  const handleTokenArrival = useCallback((nodeId) => {
    if (!requestQueueRef.current.includes(nodeId) || criticalNodeRef.current !== null) return;
    addLog(`Token reached ${NODES[nodeId].name}`, "info");
    startCriticalSection(nodeId);
  }, [addLog, startCriticalSection]);

  /* ── Token loss & regeneration ─────────────────────────────── */

  const markTokenLost = useCallback((failedNodeId) => {
    if (!tokenAvailableRef.current) return;
    tokenAvailableRef.current = false;
    tokenLossStartedAtRef.current = Date.now();
    lostTokenOriginRef.current = failedNodeId;
    tokenLossesRef.current += 1;
    setTokenAvailable(false);
    setTokenLosses(tokenLossesRef.current);
    setDuplicateToken(null);
    resetRotationMeasurement();
    if (duplicateResolveTimeoutRef.current) { clearTimeout(duplicateResolveTimeoutRef.current); duplicateResolveTimeoutRef.current = null; }
    stopTimer();
    addLog(`Token lost after ${NODES[failedNodeId].name} failed`, "failure");
    showTokenAlert("⚠ Token lost — regenerating...");
  }, [addLog, resetRotationMeasurement, showTokenAlert, stopTimer]);

  const regenerateToken = useCallback(() => {
    if (tokenAvailableRef.current) return false;
    const failures = failedNodeIdsRef.current;
    const origin = lostTokenOriginRef.current ?? currentNodeRef.current;
    const next = getNextActiveNode(origin, failures, NODES.length);
    if (next === null) {
      stopTokenLossMonitor(); setSimulationRunning(false);
      addLog("No active nodes available", "system");
      return false;
    }
    tokenSequenceRef.current += 1;
    tokenRegenerationsRef.current += 1;
    tokenAvailableRef.current = true;
    tokenLossStartedAtRef.current = null;
    lostTokenOriginRef.current = null;
    currentNodeRef.current = next;
    setTokenSequence(tokenSequenceRef.current);
    setTokenRegenerations(tokenRegenerationsRef.current);
    setTokenAvailable(true);
    setCurrentNode(next);
    markTokenSeen();
    resetRotationMeasurement();
    stopTokenLossMonitor();
    addLog(`Token lost! Regenerating at ${NODES[next].name}`, "warning");
    addLog(`Token #${tokenSequenceRef.current} regenerated`, "system");
    showTokenAlert(`Token #${tokenSequenceRef.current} regenerated at ${NODES[next].name}`);
    handleTokenArrival(next);
    return true;
  }, [addLog, handleTokenArrival, markTokenSeen, resetRotationMeasurement, setSimulationRunning, showTokenAlert, stopTokenLossMonitor]);

  const startTokenLossMonitor = useCallback(() => {
    stopTokenLossMonitor();
    const activeCount = NODES.length - failedNodeIdsRef.current.length;
    const timeout = getTokenLossTimeout(activeCount, passInterval);
    tokenLossMonitorRef.current = setTimeout(() => {
      if (!tokenAvailableRef.current) regenerateToken();
    }, timeout);
  }, [passInterval, regenerateToken, stopTokenLossMonitor]);

  /* ── Token movement ────────────────────────────────────────── */

  const moveTokenForward = useCallback(() => {
    if (criticalNodeRef.current !== null || !tokenAvailableRef.current) return;
    const prev = currentNodeRef.current;
    const failures = failedNodeIdsRef.current;
    const next = getNextActiveNode(prev, failures, NODES.length);
    if (next === null) { stopTimer(); setSimulationRunning(false); addLog("No active nodes available", "system"); return; }
    if (failures.includes(prev)) addLog(`Token skipped failed ${NODES[prev].name}`, "failure");
    getSkippedFailedNodes(prev, next, failures, NODES.length).forEach((id) => addLog(`Token skipped failed ${NODES[id].name}`, "failure"));
    currentNodeRef.current = next;
    setCurrentNode(next);
    addLog(`Token passed: ${NODES[prev].name} → ${NODES[next].name}`, "pass");
    recordTokenPass();
    handleTokenArrival(next);
  }, [addLog, handleTokenArrival, recordTokenPass, setSimulationRunning, stopTimer]);

  /* ── Simulation controls ───────────────────────────────────── */

  const handleStart = () => {
    if (running) return;
    const failures = failedNodeIdsRef.current;
    const prev = currentNodeRef.current;
    const next = failures.includes(prev) ? getNextActiveNode(prev, failures, NODES.length) : prev;
    if (next === null) { addLog("No active nodes available", "system"); return; }
    if (next !== prev) { currentNodeRef.current = next; setCurrentNode(next); addLog(`Token resumed at ${NODES[next].name}`, "info"); handleTokenArrival(next); }
    setSimulationRunning(true);
    addLog("Simulation started", "system");
  };

  const handlePause = () => { if (running) { setSimulationRunning(false); addLog("Simulation paused", "system"); } };

  const handleReset = () => {
    stopTimer(); stopTokenLossMonitor(); clearCriticalSection(); setSimulationRunning(false);
    if (duplicateResolveTimeoutRef.current) { clearTimeout(duplicateResolveTimeoutRef.current); duplicateResolveTimeoutRef.current = null; }
    if (alertTimeoutRef.current) { clearTimeout(alertTimeoutRef.current); alertTimeoutRef.current = null; }
    currentNodeRef.current = 0; tokenPassesRef.current = 0; criticalSectionsRef.current = 0;
    failedNodeIdsRef.current = []; requestQueueRef.current = [];
    tokenAvailableRef.current = true; tokenSequenceRef.current = 1;
    setCurrentNode(0); setTokenPasses(0); setCriticalSections(0); setFailedNodeIds([]); setRequestQueue([]); setTokenAvailable(true); setTokenSequence(1);
    // Metrics
    requestStartedAtRef.current = new Map();
    waitingTimeTotalsRef.current = createNodeMetricValues(); waitingTimeCountsRef.current = createNodeMetricValues();
    csEntriesByNodeRef.current = createNodeMetricValues();
    rotationStartedAtRef.current = Date.now(); passesInRotationRef.current = 0;
    rotationDurationTotalRef.current = 0; rotationCountRef.current = 0;
    elapsedRunDurationRef.current = 0; runStartedAtRef.current = null;
    tokenLossStartedAtRef.current = null; lostTokenOriginRef.current = null;
    tokenLossesRef.current = 0; tokenRegenerationsRef.current = 0;
    setAverageWaitingTimes(createNodeMetricValues()); setAverageRotationTime(0);
    setCsEntriesByNode(createNodeMetricValues()); setThroughput(0);
    setTokenLosses(0); setTokenRegenerations(0);
    setTokenAlert(null); setDuplicateToken(null);
    autoRandomRequestsRef.current = false; setAutoRandomRequests(false);
    setEventLog(createInitialEventLog());
  };

  /* ── Node interactions ─────────────────────────────────────── */

  const handleRequestAccess = (nodeId) => {
    if (failedNodeIdsRef.current.includes(nodeId) || criticalNodeRef.current === nodeId || requestQueueRef.current.includes(nodeId)) return;
    const updated = enqueueRequest(requestQueueRef.current, nodeId);
    requestQueueRef.current = updated;
    setRequestQueue(updated);
    requestStartedAtRef.current.set(nodeId, Date.now());
    addLog(`${NODES[nodeId].name} requested Critical Section`, "info");
    if (currentNodeRef.current === nodeId && criticalNodeRef.current === null) { addLog(`Token reached ${NODES[nodeId].name}`, "info"); startCriticalSection(nodeId); return; }
    addLog(`${NODES[nodeId].name} waiting for Token`, "info");
  };

  const handleNodeFailure = (nodeId) => {
    const failures = failedNodeIdsRef.current;
    if (failures.includes(nodeId)) return;
    const removed = removePendingRequest(nodeId);
    const updated = [...failures, nodeId];
    failedNodeIdsRef.current = updated;
    setFailedNodeIds(updated);
    addLog(`${NODES[nodeId].name} failed`, "failure");
    if (removed) addLog(`${NODES[nodeId].name} failed and its request was removed`, "failure");
    if (criticalNodeRef.current === nodeId) clearCriticalSection();
    const prev = currentNodeRef.current;
    const next = getNextActiveNode(prev, updated, NODES.length);
    if (next === null) { stopTimer(); setSimulationRunning(false); addLog("No active nodes available", "system"); return; }
    if (nodeId !== prev) return;
    // Token holder failed → token is LOST
    markTokenLost(nodeId);
    startTokenLossMonitor();
  };

  const handleNodeRecovery = (nodeId) => {
    const failures = failedNodeIdsRef.current;
    if (!failures.includes(nodeId)) return;
    const updated = failures.filter((id) => id !== nodeId);
    failedNodeIdsRef.current = updated;
    setFailedNodeIds(updated);
    addLog(`${NODES[nodeId].name} recovered`, "info");
  };

  /* ── Duplicate token handling ──────────────────────────────── */

  const handleInjectDuplicate = () => {
    if (!tokenAvailableRef.current || !runningRef.current) { addLog("Cannot inject duplicate — token unavailable or sim stopped", "system"); return; }
    const dupSeq = tokenSequenceRef.current - 1;
    const dupNode = (currentNodeRef.current + 2) % NODES.length;
    setDuplicateToken({ id: dupSeq, nodeId: dupNode });
    addLog(`⚠ Duplicate token #${dupSeq} injected at ${NODES[dupNode].name}`, "warning");
    showTokenAlert("⚠ Duplicate token detected! Resolving...");
    if (duplicateResolveTimeoutRef.current) clearTimeout(duplicateResolveTimeoutRef.current);
    duplicateResolveTimeoutRef.current = setTimeout(() => {
      const tokens = [{ id: tokenSequenceRef.current, nodeId: currentNodeRef.current }, { id: dupSeq, nodeId: dupNode }];
      const winner = selectHighestSequenceToken(tokens);
      const loser = tokens.find((t) => t !== winner);
      setDuplicateToken(null); duplicateResolveTimeoutRef.current = null;
      addLog(`Duplicate resolved: kept token #${winner.id}, discarded token #${loser.id}`, "system");
      showTokenAlert(`Duplicate resolved — token #${winner.id} retained`);
    }, 2500);
  };

  /* ── Export log ────────────────────────────────────────────── */

  const handleExportLog = () => {
    const lines = eventLog.slice().reverse().map((l) => `[${l.time}] ${l.text}`).join("\n");
    const header = `Token Ring Simulator — Event Log\nExported: ${new Date().toLocaleString()}\n${"─".repeat(50)}\n`;
    const blob = new Blob([header + lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `token-ring-log-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
    addLog("Event log exported", "system");
  };

  /* ── Derived values ────────────────────────────────────────── */

  const failedNodes = failedNodeIds.length;
  const hasActiveNodes = failedNodes < NODES.length;
  const hasActiveTokenHolder = hasActiveNodes && !failedNodeIds.includes(currentNode);
  const currentHolderName = hasActiveTokenHolder ? NODES[currentNode].name : "No active node";
  const isCurrentCritical = hasActiveTokenHolder && criticalNode === currentNode;
  const bypassConnections = NODES.filter((n) => !failedNodeIds.includes(n.id))
    .map((n) => ({ from: n.id, to: getNextActiveNode(n.id, failedNodeIds, NODES.length) }))
    .filter((c) => c.to !== null && c.to !== c.from && c.to !== (c.from + 1) % NODES.length);

  const globalAvgWait = (() => {
    const totalW = waitingTimeTotalsRef.current.reduce((s, v) => s + v, 0);
    const totalC = waitingTimeCountsRef.current.reduce((s, v) => s + v, 0);
    return totalC > 0 ? totalW / totalC : 0;
  })();
  const maxCsEntries = Math.max(...csEntriesByNode, 1);

  /* ── Effects ───────────────────────────────────────────────── */

  // Main token-passing timer
  useEffect(() => {
    if (!running || criticalNode !== null || !tokenAvailable) { stopTimer(); return undefined; }
    stopTimer();
    timerRef.current = setInterval(moveTokenForward, passInterval);
    return stopTimer;
  }, [criticalNode, moveTokenForward, passInterval, running, stopTimer, tokenAvailable]);

  // Token position animation
  useEffect(() => {
    const el = tokenRef.current;
    if (!hasActiveTokenHolder || !el) { tokenAnimationRef.current?.cancel(); tokenAnimationRef.current = null; visualTokenNodeRef.current = null; return; }
    const prev = visualTokenNodeRef.current;
    const pos = TOKEN_POSITIONS[currentNode];
    if (prev === null) { el.style.top = pos.top; el.style.left = pos.left; visualTokenNodeRef.current = currentNode; return; }
    if (prev === currentNode) return;
    tokenAnimationRef.current?.cancel();
    if (!running) { el.style.top = pos.top; el.style.left = pos.left; visualTokenNodeRef.current = currentNode; return; }
    const prevPos = TOKEN_POSITIONS[prev];
    const anim = el.animate([{ top: prevPos.top, left: prevPos.left }, { top: pos.top, left: pos.left }], { duration: Math.min(700, passInterval * 0.35), easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
    tokenAnimationRef.current = anim; visualTokenNodeRef.current = currentNode;
    anim.finished.then(() => { if (tokenAnimationRef.current !== anim) return; el.style.top = pos.top; el.style.left = pos.left; }).catch(() => {});
  }, [currentNode, hasActiveTokenHolder, passInterval, running]);

  useEffect(() => { if (!tokenAnimationRef.current) return; running ? tokenAnimationRef.current.play() : tokenAnimationRef.current.pause(); }, [running]);

  // Auto random requests
  useEffect(() => {
    autoRandomRequestsRef.current = autoRandomRequests;
    if (!autoRandomRequests || !running) return undefined;
    const id = setInterval(() => {
      if (!autoRandomRequestsRef.current || !runningRef.current) return;
      const alive = NODES.filter((n) => !failedNodeIdsRef.current.includes(n.id) && !requestQueueRef.current.includes(n.id) && criticalNodeRef.current !== n.id);
      if (!alive.length) return;
      const pick = alive[Math.floor(Math.random() * alive.length)];
      const q = enqueueRequest(requestQueueRef.current, pick.id);
      requestQueueRef.current = q; setRequestQueue([...q]);
      requestStartedAtRef.current.set(pick.id, Date.now());
      setEventLog((p) => [{ id: Date.now() + Math.random(), time: getFormattedTime(), text: `${pick.name} requested CS (auto)`, type: "info" }, ...p].slice(0, 50));
    }, Math.max(1500, passInterval * 1.5));
    return () => clearInterval(id);
  }, [autoRandomRequests, passInterval, running]);

  // Throughput updater
  useEffect(() => { if (!running) return undefined; const id = setInterval(updateThroughput, 3000); return () => clearInterval(id); }, [running, updateThroughput]);

  // Cleanup
  useEffect(() => () => {
    stopTimer(); stopTokenLossMonitor(); clearCriticalSection(); tokenAnimationRef.current?.cancel();
    if (duplicateResolveTimeoutRef.current) clearTimeout(duplicateResolveTimeoutRef.current);
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
  }, [clearCriticalSection, stopTimer, stopTokenLossMonitor]);

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-2 border border-emerald-500/20"><Zap className="h-6 w-6 text-emerald-400" /></div>
            <div>
              <h1 className="text-xl font-bold">Distributed Token Ring</h1>
              <p className="text-sm text-slate-400">Distributed Computing Simulator</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {running ? "Running" : "Stopped"}
          </div>
        </div>
      </header>

      {/* Token Alert Banner */}
      {tokenAlert && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-5 py-3 text-sm font-medium text-red-200 shadow-lg shadow-red-500/10 animate-pulse">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
            {tokenAlert}
          </div>
        </div>
      )}

      {/* Duplicate Token Alert */}
      {duplicateToken && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-3">
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-950/60 px-5 py-3 text-sm font-medium text-amber-200 shadow-lg shadow-amber-500/10">
            <Copy className="h-5 w-5 text-amber-400 shrink-0" />
            Duplicate token #{duplicateToken.id} at {NODES[duplicateToken.nodeId].name} — resolving...
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Simulation Control */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Simulation Control</h2>
              <p className="text-sm text-slate-400">Control the token circulation and parameters</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleStart} disabled={running} className={`flex items-center gap-2 rounded-xl px-5 py-2.5 font-medium transition cursor-pointer ${running ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20"}`}><Play size={17} />Start</button>
              <button onClick={handlePause} disabled={!running} className={`flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-2.5 font-medium transition cursor-pointer ${!running ? "bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed" : "bg-slate-800 hover:bg-slate-700 text-white"}`}><Pause size={17} />Pause</button>
              <button onClick={handleReset} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white cursor-pointer"><RotateCcw size={17} />Reset</button>
              <div className="hidden sm:block w-px h-8 bg-slate-700" />
              <button onClick={handleInjectDuplicate} disabled={!running || !tokenAvailable} className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition cursor-pointer ${!running || !tokenAvailable ? "border-slate-800 bg-slate-900/50 text-slate-600 cursor-not-allowed" : "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"}`}><Copy size={15} />Inject Duplicate</button>
              <button onClick={handleExportLog} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white cursor-pointer"><Download size={15} />Export Log</button>
            </div>
          </div>

          {/* Speed slider + Auto random toggle */}
          <div className="flex flex-wrap items-center gap-6 border-t border-slate-800 pt-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-400 whitespace-nowrap">Speed: {speed.toFixed(1)}×</label>
              <input type="range" min="0.5" max="3" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-28 accent-emerald-400 cursor-pointer" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoRandomRequests} onChange={(e) => { setAutoRandomRequests(e.target.checked); autoRandomRequestsRef.current = e.target.checked; }} className="accent-emerald-400 cursor-pointer" />
              Auto Random Requests
            </label>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_350px]">
          {/* Ring visualization */}
          <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-0 shadow-inner sm:min-h-[600px] sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.06),transparent_60%)]" />

            <div className="relative h-[min(430px,calc(100vw-9rem))] w-[min(430px,calc(100vw-9rem))]">
              <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" viewBox="0 0 430 430" aria-hidden="true">
                <defs>
                  <marker id="ring-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M 0 0 L 8 4.5 L 0 9 z" fill="#64748b" />
                  </marker>
                </defs>
                {RING_CONNECTIONS.map((c) => {
                  const bad = failedNodeIds.includes(c.from) || failedNodeIds.includes(c.to);
                  return (<path key={`${c.from}-${c.to}`} d={getConnectionPath(c.from, c.to)} markerEnd="url(#ring-arrow)" className={`network-connection ${bad ? "network-connection--failed" : "network-connection--active"} ${running && !bad ? "network-connection--flowing" : ""}`} />);
                })}
                {bypassConnections.map((c) => (<path key={`bypass-${c.from}-${c.to}`} d={getConnectionPath(c.from, c.to)} markerEnd="url(#ring-arrow)" className={`network-connection network-connection--bypass ${running ? "network-connection--flowing" : ""}`} />))}
              </svg>

              <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-36 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700/80 bg-slate-950/85 px-3 py-2.5 text-center shadow-lg backdrop-blur-sm">
                <p className="text-[10px] font-black tracking-[0.2em] text-emerald-300">TOKEN RING</p>
                <p className="mt-1 text-[9px] text-slate-500">Logical Ring Network</p>
              </div>

              {hasActiveTokenHolder && (
                <div ref={tokenRef} className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ top: "50%", left: "50%" }}>
                  <div className={`flex h-20 w-20 items-center justify-center rounded-full border-2 border-yellow-400 bg-yellow-400/20 shadow-[0_0_35px_rgba(250,204,21,0.6)] backdrop-blur-sm ${running ? "animate-pulse" : ""}`}>
                    <div className="text-center">
                      <div className="text-2xl leading-none">🟡</div>
                      <div className="mt-1 text-[10px] font-black text-yellow-300 tracking-wider">TOKEN</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Duplicate token visual */}
              {duplicateToken && !failedNodeIds.includes(duplicateToken.nodeId) && (
                <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 animate-pulse" style={{ top: TOKEN_POSITIONS[duplicateToken.nodeId].top, left: TOKEN_POSITIONS[duplicateToken.nodeId].left }}>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-400 bg-red-400/20 shadow-[0_0_30px_rgba(248,113,113,0.5)] backdrop-blur-sm">
                    <div className="text-center">
                      <div className="text-lg leading-none">🔴</div>
                      <div className="mt-0.5 text-[8px] font-black text-red-300 tracking-wider">DUP</div>
                    </div>
                  </div>
                </div>
              )}

              {NODES.map((node) => (
                <Node key={node.id} name={node.name} position={node.position} isFailed={failedNodeIds.includes(node.id)} isWaiting={requestQueue.includes(node.id)} isHolder={hasActiveTokenHolder && currentNode === node.id} isCritical={criticalNode === node.id} onRequest={() => handleRequestAccess(node.id)} onFailure={() => handleNodeFailure(node.id)} onRecovery={() => handleNodeRecovery(node.id)} />
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {/* Token Holder */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-md">
              <p className="text-sm font-medium text-slate-400">Current Token Holder</p>
              <h3 className="mt-2 text-3xl font-extrabold text-yellow-300 tracking-tight">{currentHolderName}</h3>
              <p className="mt-1 text-[11px] text-slate-500">Seq #{tokenSequence}</p>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                {!hasActiveNodes ? "No active nodes available" : !hasActiveTokenHolder ? "The token is waiting to rejoin an active node." : isCurrentCritical ? "⚡ Executing inside the Critical Section." : "This node currently owns the token."}
              </p>
            </div>

            {/* Statistics */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-md">
              <h3 className="mb-4 font-semibold text-slate-200">Simulation Statistics</h3>
              <div className="space-y-3">
                <Stat label="Total Nodes" value="4" />
                <Stat label="Token Passes" value={tokenPasses} />
                <Stat label="Critical Sections" value={criticalSections} />
                <Stat label="Pending Requests" value={requestQueue.length} />
                <Stat label="Failed Nodes" value={failedNodes} />
                <Stat label="Avg Wait Time" value={formatDuration(globalAvgWait)} />
                <Stat label="Avg Rotation" value={formatDuration(averageRotationTime)} />
                <Stat label="Throughput" value={`${throughput} CS/min`} />
                <Stat label="Token Losses" value={tokenLosses} />
                <Stat label="Regenerations" value={tokenRegenerations} />
              </div>
            </div>

            {/* CS Entries Bar Chart */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-md">
              <h3 className="mb-3 font-semibold text-slate-200">CS Entries per Node</h3>
              <div className="space-y-2">
                {NODES.map((node) => (
                  <div key={node.id} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-14 shrink-0">{node.name}</span>
                    <div className="flex-1 h-5 rounded-md bg-slate-800/80 overflow-hidden">
                      <div className="h-full rounded-md bg-emerald-500/70 transition-all duration-500" style={{ width: `${(csEntriesByNode[node.id] / maxCsEntries) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono text-slate-300 w-6 text-right">{csEntriesByNode[node.id]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Request Queue */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-md">
              <h3 className="mb-3 font-semibold text-slate-200">Request Queue</h3>
              {requestQueue.length === 0 ? (
                <p className="text-sm text-slate-500">No pending requests</p>
              ) : (
                <ol className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950 p-3 text-sm">
                  {requestQueue.map((nodeId, index) => (
                    <li key={nodeId} className="flex items-center gap-2 text-slate-300">
                      <span className="text-emerald-400 font-mono">{index + 1}.</span>
                      {NODES[nodeId].name}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Event Log */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-md">
              <h3 className="mb-4 font-semibold text-slate-200">Event Log</h3>
              <div className="h-[220px] overflow-y-auto rounded-xl bg-slate-950 p-3.5 font-mono text-xs space-y-2 border border-slate-800/80 custom-scrollbar">
                {eventLog.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start leading-tight">
                    <span className="text-slate-500 shrink-0">[{log.time}]</span>
                    <span className={
                      log.type === "pass" ? "text-emerald-400"
                        : log.type === "critical" ? "text-rose-400 font-bold"
                          : log.type === "failure" ? "text-rose-300 font-medium"
                            : log.type === "warning" ? "text-amber-400 font-medium"
                              : log.type === "system" ? "text-amber-400"
                                : "text-slate-300"
                    }>{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function Node({ name, position, isFailed, isWaiting, isHolder, isCritical, onRequest, onFailure, onRecovery }) {
  let cardStyle = "border-slate-700 bg-slate-800/90";
  let statusText = "READY";
  let statusStyle = "text-slate-400";
  if (isFailed) { cardStyle = "border-slate-700/70 bg-slate-900/80 opacity-60 grayscale"; statusText = "FAILED"; statusStyle = "text-slate-500 font-bold"; }
  else if (isCritical) { cardStyle = "border-rose-500 bg-rose-950/80 shadow-[0_0_30px_rgba(244,63,94,0.5)] scale-105 z-10"; statusText = "CRITICAL SECTION"; statusStyle = "text-rose-400 font-bold animate-pulse"; }
  else if (isHolder) { cardStyle = "border-amber-400 bg-amber-950/70 shadow-[0_0_25px_rgba(251,191,36,0.35)] scale-105 z-10"; statusText = "TOKEN HOLDER"; statusStyle = "text-amber-300 font-bold"; }
  else if (isWaiting) { cardStyle = "border-sky-500/70 bg-sky-950/40 shadow-[0_0_20px_rgba(14,165,233,0.18)]"; statusText = "WAITING FOR TOKEN"; statusStyle = "text-sky-300 font-bold"; }
  const requestDisabled = isFailed || isWaiting || isCritical;
  const requestLabel = isFailed ? "Failed" : isCritical ? "Using Resource" : isWaiting ? "Waiting..." : "Request Access";

  return (
    <div className={`absolute w-28 ${position} transition-all duration-300`}>
      <div className={`mx-auto flex h-20 w-24 flex-col items-center justify-center rounded-2xl border ${cardStyle} transition-all duration-300`}>
        <div className="text-center px-1">
          <div className={`text-sm font-bold tracking-wide ${isFailed ? "text-slate-400" : "text-white"}`}>{name}</div>
          <div className={`mt-1 text-[9px] tracking-wider ${statusStyle}`}>{statusText}</div>
        </div>
      </div>
      <div className="relative z-30 mt-2 flex items-center justify-center gap-1">
        <button type="button" onClick={onRequest} disabled={requestDisabled} className={`rounded-lg border px-1.5 py-1 text-[9px] font-semibold whitespace-nowrap transition ${requestDisabled ? "cursor-not-allowed border-slate-800 bg-slate-900/70 text-slate-600" : "cursor-pointer border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"}`} aria-label={`${requestLabel} for ${name}`}>{requestLabel}</button>
        <button type="button" onClick={isFailed ? onRecovery : onFailure} className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[9px] font-semibold transition cursor-pointer ${isFailed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "border-slate-600 bg-slate-900 text-slate-300 hover:border-rose-500/50 hover:text-rose-300"}`} aria-label={`${isFailed ? "Recover" : "Fail"} ${name}`}>
          {isFailed ? <RotateCcw size={10} /> : <CircleOff size={10} />}
          {isFailed ? "Recover" : "Fail"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 last:border-0 last:pb-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="font-semibold text-slate-100">{value}</span>
    </div>
  );
}

export default App;
