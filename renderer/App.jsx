import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Square, Trash2, X } from "lucide-react";

function getApi() {
  return window.ramCleaner;
}

function formatMb(mb) {
  const n = Number(mb ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
}

export default function App() {
  const api = useMemo(() => getApi(), []);
  const windowControls = useMemo(() => window.windowControls, []);
  const [isMaximized, setIsMaximized] = useState(false);

  const [ram, setRam] = useState({
    totalMb: 0,
    usedMb: 0,
    freeMb: 0,
    cacheMb: 0,
    usedPercent: 0,
  });
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");

  const [advanced, setAdvanced] = useState(false);
  const [processes, setProcesses] = useState([]);
  const [procError, setProcError] = useState("");
  const [procQuery, setProcQuery] = useState("");
  const [procPage, setProcPage] = useState(1);
  const [selectedPid, setSelectedPid] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, pid }
  const [confirm, setConfirm] = useState(null); // { pid }
  const contextMenuRef = useRef(null);

  const [settings, setSettings] = useState({
    autoClearEnabled: false,
    autoClearThresholdGb: 8,
    openAtLogin: false,
  });
  const [autoClearLastTs, setAutoClearLastTs] = useState(0);

  const pageSize = 50;

  const filteredProcesses = useMemo(() => {
    const q = procQuery.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter((p) => {
      const name = String(p?.name ?? "").toLowerCase();
      const pid = String(p?.pid ?? "");
      return name.includes(q) || pid.includes(q);
    });
  }, [procQuery, processes]);

  const pageCount = Math.max(1, Math.ceil(filteredProcesses.length / pageSize));
  const safePage = Math.min(Math.max(procPage, 1), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = filteredProcesses.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setProcPage(1);
  }, [procQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (!api?.getSettings) return;
      try {
        const s = await api.getSettings();
        if (cancelled) return;
        setSettings((prev) => ({ ...prev, ...(s || {}) }));
      } catch {
        // ignore
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let unsub = null;
    let cancelled = false;

    async function initWindowState() {
      if (!windowControls?.isMaximized) return;
      try {
        const v = await windowControls.isMaximized();
        if (!cancelled) setIsMaximized(Boolean(v));
      } catch {
        // ignore
      }

      if (windowControls?.onMaximizedChanged) {
        unsub = windowControls.onMaximizedChanged((v) => setIsMaximized(Boolean(v)));
      }
    }

    initWindowState();
    return () => {
      cancelled = true;
      if (typeof unsub === "function") unsub();
    };
  }, [windowControls]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!api?.getRam) {
        setError(
          "Missing preload API. Please rebuild/restart the app."
        );
        return;
      }

      try {
        const info = await api.getRam();
        if (cancelled) return;

        setRam({
          totalMb: Math.round(info.totalMemMb ?? 0),
          usedMb: Math.round(info.usedMemMb ?? 0),
          freeMb: Math.round(info.freeMemMb ?? 0),
          cacheMb: Math.round(info.cachedMemMb ?? 0),
          usedPercent: Math.round(Number(info.usedMemPercentage ?? 0)),
        });
        setError("");
      } catch (e) {
        if (cancelled) return;
        setError(e?.message ? String(e.message) : "Unknown error");
      }
    }

    refresh();
    const interval = setInterval(refresh, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api]);

  const clearRamCache = async () => {
    if (!api?.clearRamCache) {
      setStatus("Action not available.");
      return;
    }

    setStatus("Clearing cache...");
    try {
      const result = await api.clearRamCache();
      setStatus(result?.message ? String(result.message) : "Done.");
    } catch (e) {
      setStatus(e?.message ? String(e.message) : "Error.");
    }
  };

  useEffect(() => {
    if (!settings.autoClearEnabled) return;
    const thresholdGb = Number(settings.autoClearThresholdGb ?? 0);
    if (!Number.isFinite(thresholdGb) || thresholdGb <= 0) return;

    const cacheGb = ram.cacheMb / 1024;
    if (cacheGb < thresholdGb) return;

    const now = Date.now();
    if (now - autoClearLastTs < 60_000) return;

    setAutoClearLastTs(now);
    clearRamCache();
  }, [ram.cacheMb, settings.autoClearEnabled, settings.autoClearThresholdGb, autoClearLastTs]);

  useEffect(() => {
    if (!advanced) return;

    let cancelled = false;

    async function refreshProcesses() {
      if (!api?.getProcesses) {
        setProcError("Missing process list API (preload).");
        return;
      }

      try {
        const result = await api.getProcesses();
        if (cancelled) return;

        if (!result?.ok) {
          setProcError(result?.message ? String(result.message) : "Error");
          setProcesses([]);
          return;
        }

        setProcError("");
        setProcesses(Array.isArray(result.data) ? result.data : []);
        setSelectedPid((prev) => {
          if (prev == null) return prev;
          const stillExists = (Array.isArray(result.data) ? result.data : []).some(
            (p) => Number(p?.pid) === Number(prev)
          );
          return stillExists ? prev : null;
        });
      } catch (e) {
        if (cancelled) return;
        setProcError(e?.message ? String(e.message) : "Error");
        setProcesses([]);
      }
    }

    refreshProcesses();
    const interval = setInterval(refreshProcesses, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [advanced, api]);

  useEffect(() => {
    if (!contextMenu) return;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) {
        return;
      }
      setContextMenu(null);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [contextMenu]);

  const openConfirmForPid = (pid) => {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return;
    setConfirm({ pid: n });
    setContextMenu(null);
    setSelectedPid(n);
  };

  const endProcess = async (pid) => {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!api?.endProcess) {
      setStatus("Action not available.");
      return;
    }

    setStatus("Ending task...");
    try {
      const result = await api.endProcess(n);
      setStatus(result?.message ? String(result.message) : "Done.");
    } catch (e) {
      setStatus(e?.message ? String(e.message) : "Error.");
    }
  };

  const endSelectedProcess = async () => {
    openConfirmForPid(selectedPid);
  };

  const saveSettings = async (next) => {
    const merged = { ...settings, ...(next || {}) };
    setSettings(merged);
    if (!api?.setSettings) return;
    try {
      const saved = await api.setSettings(merged);
      setSettings((prev) => ({ ...prev, ...(saved || {}) }));
    } catch {
      // ignore
    }
  };

  return (
    <div className="app">
      <div
        className="titlebar"
        onDoubleClick={() => windowControls?.toggleMaximize?.()}
      >
        <div className="titlebarLeft">
          <div className="appDot" />
          <div className="titlebarTitle">RAM Cleaner</div>
        </div>
        <div className="titlebarButtons">
          <button
            className="winBtn"
            onClick={() => windowControls?.minimize?.()}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="winBtn"
            onClick={() => windowControls?.toggleMaximize?.()}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <Square size={14} />
          </button>
          <button
            className="winBtn winBtnClose"
            onClick={() => windowControls?.close?.()}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <h1 className="title">RAM Cleaner</h1>

      <div className="card">
        <div className="row">
          <div className="label">Usage</div>
          <div className="value">{ram.usedPercent}%</div>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={ram.usedPercent}>
          <div className="barFill" style={{ width: `${ram.usedPercent}%` }} />
        </div>

        <div className="grid">
          <div className="metric">
            <div className="metricLabel">Total</div>
            <div className="metricValue">{formatMb(ram.totalMb)}</div>
          </div>
          <div className="metric">
            <div className="metricLabel">Used</div>
            <div className="metricValue">{formatMb(ram.usedMb)}</div>
          </div>
          <div className="metric">
            <div className="metricLabel">Free</div>
            <div className="metricValue">{formatMb(ram.freeMb)}</div>
          </div>
          <div className="metric">
            <div className="metricLabel">Cached</div>
            <div className="metricValue">{formatMb(ram.cacheMb)}</div>
          </div>
        </div>

        <div className="advancedTitle">Settings</div>
        <div className="grid">
          <div className="metric">
            <div className="metricLabel">Auto-clear when cached &gt;</div>
            <div className="metricValue">
              <div className="inlineRow" style={{ marginTop: 6 }}>
                <input
                  className="input inputSmall"
                  type="number"
                  min="1"
                  step="1"
                  value={Number(settings.autoClearThresholdGb ?? 8)}
                  onChange={(e) =>
                    saveSettings({
                      autoClearThresholdGb: Math.max(1, Number(e.target.value) || 0),
                    })
                  }
                  aria-label="Auto-clear threshold (GB)"
                />
                <div className="suffix">GB</div>
              </div>
            </div>
          </div>
          <div className="metric">
            <div className="metricLabel">Auto-clear</div>
            <div className="metricValue">
              <button
                className="btn btnSecondary"
                onClick={() => saveSettings({ autoClearEnabled: !settings.autoClearEnabled })}
              >
                {settings.autoClearEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
          <div className="metric">
            <div className="metricLabel">Start on boot</div>
            <div className="metricValue">
              <button
                className="btn btnSecondary"
                onClick={() => saveSettings({ openAtLogin: !settings.openAtLogin })}
              >
                {settings.openAtLogin ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="btn" onClick={clearRamCache}>
            <Trash2 size={16} /> Clear cache
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? "Close advanced view" : "Advanced view"}
          </button>
        </div>

        <div className="status">Status: {status}</div>
        {error ? <div className="error">Error: {error}</div> : null}

        {advanced ? (
          <>
            <div className="panel">
              <div className="panelTitle">
                Processes (Top 1000 by RAM / Working Set)
              </div>
              {procError ? <div className="error">Error: {procError}</div> : null}
              <div className="panelRow">
                <input
                  className="input"
                  style={{ marginTop: 0, flex: "1 1 260px" }}
                  value={procQuery}
                  onChange={(e) => setProcQuery(e.target.value)}
                  placeholder="Filter by name or PID…"
                  aria-label="Filter processes"
                />
                <div className="pagerInfo">
                  Showing {filteredProcesses.length === 0 ? 0 : pageStart + 1}–
                  {Math.min(pageStart + pageSize, filteredProcesses.length)} of{" "}
                  {filteredProcesses.length}
                </div>
              </div>
              <div className="panelRow" style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="btn btnSecondary"
                    onClick={() => setProcPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  >
                    Prev
                  </button>
                  <button
                    className="btn btnSecondary"
                    onClick={() => setProcPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage >= pageCount}
                  >
                    Next
                  </button>
                </div>
                <button
                  className="btn"
                  onClick={endSelectedProcess}
                  disabled={selectedPid == null}
                >
                  End task
                </button>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th className="mono">PID</th>
                    <th className="right">RAM (WS)</th>
                    <th className="right">Private (Commit)</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
                    <tr
                      key={`${p.pid}-${p.name}`}
                      className={Number(p.pid) === Number(selectedPid) ? "rowSelected" : ""}
                      onClick={() => setSelectedPid(Number(p.pid))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const pid = Number(p.pid);
                        setSelectedPid(pid);

                        const padding = 8;
                        const menuWidth = 200;
                        const menuHeight = 56;
                        const x = Math.min(
                          e.clientX,
                          window.innerWidth - menuWidth - padding
                        );
                        const y = Math.min(
                          e.clientY,
                          window.innerHeight - menuHeight - padding
                        );

                        setContextMenu({ x, y, pid });
                      }}
                      style={{ cursor: "pointer" }}
                      title="Click to select"
                    >
                      <td>{p.name}</td>
                      <td className="mono">{p.pid}</td>
                      <td className="right">
                        {formatMb(Math.round((p.workingSetBytes ?? 0) / 1024 / 1024))}
                      </td>
                      <td className="right">
                        {formatMb(Math.round((p.privateBytes ?? 0) / 1024 / 1024))}
                      </td>
                    </tr>
                  ))}
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ opacity: 0.7, padding: "10px 12px" }}>
                        No data
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="contextMenu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          ref={contextMenuRef}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="contextItem"
            onClick={() => openConfirmForPid(contextMenu.pid)}
          >
            End task
          </button>
        </div>
      ) : null}

      {confirm ? (
        <div className="modalOverlay" onMouseDown={() => setConfirm(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">End task?</div>
            <div className="modalBody">
              {(() => {
                const target = processes.find(
                  (p) => Number(p.pid) === Number(confirm.pid)
                );
                const name = target?.name ? String(target.name) : "process";
                return (
                  <>
                    This will force close <span className="mono">{name}</span>{" "}
                    (PID <span className="mono">{confirm.pid}</span>).
                  </>
                );
              })()}
            </div>
            <div className="modalActions">
              <button className="btn btnSecondary" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const pid = confirm.pid;
                  setConfirm(null);
                  await endProcess(pid);
                }}
              >
                End task
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
