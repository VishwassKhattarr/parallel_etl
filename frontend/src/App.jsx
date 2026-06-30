import { useEffect, useState, useRef } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const PG_BLUE = "#336791";
const PG_LIGHT = "#E8F0F7";
const AMBER = "#E8A838";
const SLATE = "#1a2332";
const MUTED = "#64748b";
const BORDER = "#dde3ea";
const BG = "#f4f6f9";
const WHITE = "#ffffff";

const DEPT_COLORS = ["#336791", "#2d9cdb", "#56aedd", "#8ec8e8"];
const CAT_COLORS  = { high: "#336791", mid: "#E8A838", low: "#94a3b8" };

export default function App() {
  // DB & Pipeline Config States (with LocalStorage persistence)
  const [dbUrl, setDbUrl] = useState("");
  const [threads, setThreads] = useState(() => {
    return Number(localStorage.getItem("threads")) || 4;
  });
  const [batchSize, setBatchSize] = useState(() => {
    return Number(localStorage.getItem("batchSize")) || 30;
  });

  // DB Diagnostic & Execution States
  const [testingConnection, setTestingConnection] = useState(false);
  const [initializingDb, setInitializingDb] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [connStatus, setConnStatus] = useState("idle"); // idle, success, error
  const [connMessage, setConnMessage] = useState("");
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [runTime, setRunTime] = useState(0);

  // Data States
  const [stats, setStats]           = useState(null);
  const [byDept, setByDept]         = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const logsEndRef = useRef(null);
  const timerRef = useRef(null);

  // Auto scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLogs]);

  // Persist config state (dbUrl intentionally NOT persisted — credentials should not be stored in localStorage)
  useEffect(() => {
    localStorage.removeItem("dbUrl"); // clear any previously cached credentials
  }, []);

  useEffect(() => {
    localStorage.setItem("threads", threads);
  }, [threads]);

  useEffect(() => {
    localStorage.setItem("batchSize", batchSize);
  }, [batchSize]);

  // Fetch metrics helper
  const fetchStatsAndData = () => {
    setLoading(true);
    const headers = {};
    if (dbUrl.trim()) {
      headers['x-db-url'] = dbUrl.trim();
    }

    Promise.all([
      axios.get(`${API}/api/stats`, { headers }),
      axios.get(`${API}/api/by-department`, { headers }),
      axios.get(`${API}/api/by-category`, { headers }),
    ]).then(([s, d, c]) => {
      setStats(s.data);
      setByDept(d.data);
      setByCategory(c.data);
      setError(null);
      setLoading(false);
    }).catch(e => {
      // Don't display full screen error to prevent locking user out of config panel
      setError(e.response?.data?.error || e.message || "Failed to fetch stats from DB");
      setStats(null);
      setByDept([]);
      setByCategory([]);
      setLoading(false);
    });
  };

  // Initial fetch — only runs if a dbUrl is already configured
  useEffect(() => {
    if (dbUrl.trim()) {
      fetchStatsAndData();
    } else {
      // No URL configured yet — skip the fetch and show the empty/config state
      setLoading(false);
    }
  }, []);

  // Action handlers
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnStatus("idle");
    setConnMessage("");
    try {
      const res = await axios.get(`${API}/api/test-connection`, {
        headers: { 'x-db-url': dbUrl }
      });
      if (res.data.success) {
        setConnStatus("success");
        setConnMessage(res.data.message);
      } else {
        setConnStatus("error");
        setConnMessage(res.data.error || "Connection failed.");
      }
    } catch (e) {
      setConnStatus("error");
      setConnMessage(e.response?.data?.error || e.message || "Connection failed.");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleInitializeDb = async () => {
    const confirmText = "WARNING: This will DROP existing 'source_data' and 'processed_data' tables in your database and re-create them. It will seed 1,000 new raw records into 'source_data' to prepare for the C++ ETL run.\n\nDo you want to proceed?";
    if (!window.confirm(confirmText)) {
      return;
    }

    setInitializingDb(true);
    try {
      const res = await axios.post(`${API}/api/initialize-db`, { dbUrl });
      alert(res.data.message);
      setConnStatus("success");
      setConnMessage("DB Re-initialized and seeded successfully!");
      fetchStatsAndData();
    } catch (e) {
      alert("Failed to initialize database: " + (e.response?.data?.error || e.message));
    } finally {
      setInitializingDb(false);
    }
  };

  const handleRunPipeline = async () => {
    setTerminalLogs([{ text: "[SYSTEM] Requesting pipeline session token...", type: "system" }]);
    setIsRunning(true);
    setRunTime(0);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRunTime(prev => Number((prev + 0.1).toFixed(1)));
    }, 100);

    let token;
    try {
      const res = await axios.post(`${API}/api/pipeline-token`, {
        dbUrl,
        numTransformers: threads,
        batchSize
      });
      token = res.data.token;
    } catch (e) {
      setTerminalLogs(prev => [...prev, { text: `[SYSTEM ERROR] Failed to obtain pipeline token: ${e.response?.data?.error || e.message}`, type: "stderr" }]);
      setIsRunning(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }

    const sseUrl = `${API}/api/run-pipeline?token=${token}`;
    const eventSource = new EventSource(sseUrl);

    setTerminalLogs(prev => [...prev, { text: "[SYSTEM] Connecting to backend pipeline worker...", type: "system" }]);

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setTerminalLogs(prev => [...prev, { text: `[SYSTEM] ${data.message}`, type: "system" }]);
      if (data.status === 'success' || data.status === 'error') {
        setIsRunning(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        eventSource.close();
        if (data.status === 'success') {
          fetchStatsAndData();
        }
      }
    });

    eventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      setTerminalLogs(prev => [...prev, { text: data.text, type: data.stream }]);
    });

    eventSource.onerror = () => {
      setTerminalLogs(prev => [...prev, { text: `[SYSTEM ERROR] SSE Connection failed or terminated.`, type: "stderr" }]);
      setIsRunning(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      eventSource.close();
    };
  };

  const clearTerminal = () => {
    setTerminalLogs([]);
  };

  const catData = byCategory.map(r => ({
    ...r,
    count: Number(r.count),
    fill: CAT_COLORS[r.salary_category] || "#aaa"
  }));

  const hasData = stats && Number(stats.total_employees) > 0;

  return (
    <div style={s.page}>
      {/* Top bar */}
      <div style={s.topbar}>
        <div style={s.topbarLeft}>
          <div style={s.pgLogo}>PG</div>
          <div>
            <h1 style={s.title}>parallel_etl_engine</h1>
            <p style={s.titleSub}>C++ Parallel Pipelines &amp; Dashboard Wrapper</p>
          </div>
        </div>
        <div style={s.topbarRight}>
          {hasData && (
            <div style={s.badge}>
              <span style={s.dot} /> {stats.total_employees} rows in processed_data
            </div>
          )}
        </div>
      </div>

      {/* Database Control Deck */}
      <div style={s.controlDeck}>
        {/* Left panel: DB Config & Commands */}
        <div style={s.controlCard}>
          <h2 style={s.controlTitle}>Database Control Center</h2>

          <div style={s.formGroup}>
            <label style={s.label}>PostgreSQL / Neon Connection URL</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type={showPassword ? "text" : "password"}
                style={{ ...s.input, flexGrow: 1 }}
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                placeholder="postgresql://user:pass@host:port/dbname?sslmode=require"
              />
              <button
                type="button"
                style={s.toggleBtn}
                onClick={() => setShowPassword(!showPassword)}
                title="Toggle URL visibility"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ ...s.formGroup, flex: 1 }}>
              <label style={s.label}>Threads: {threads}</label>
              <div style={s.sliderContainer}>
                <input
                  type="range"
                  min="1"
                  max="16"
                  style={s.slider}
                  value={threads}
                  onChange={(e) => setThreads(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ ...s.formGroup, flex: 1 }}>
              <label style={s.label}>Batch Size: {batchSize}</label>
              <input
                type="number"
                min="10"
                max="500"
                style={s.input}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
              />
            </div>
          </div>

          <div style={s.btnRow}>
            <button
              onClick={handleTestConnection}
              disabled={testingConnection || isRunning}
              style={{
                ...s.btn,
                ...s.btnSecondary,
                ...((testingConnection || isRunning) ? s.btnDisabled : {})
              }}
            >
              {testingConnection ? "Testing..." : "Test Connection"}
            </button>

            <button
              onClick={handleInitializeDb}
              disabled={initializingDb || isRunning}
              style={{
                ...s.btn,
                ...s.btnDanger,
                ...((initializingDb || isRunning) ? s.btnDisabled : {})
              }}
              title="Re-creates source and processed tables, and seeds 1,000 raw employee entries."
            >
              {initializingDb ? "Seeding DB..." : "Init & Seed DB"}
            </button>
          </div>

          <button
            onClick={handleRunPipeline}
            disabled={isRunning || initializingDb}
            style={{
              ...s.btn,
              ...s.btnPrimary,
              ...((isRunning || initializingDb) ? s.btnDisabled : {})
            }}
          >
            {isRunning ? `Running Pipeline... (${runTime}s)` : "Run ETL Pipeline"}
          </button>

          {connStatus !== "idle" && (
            <div style={{
              ...s.statusMsg,
              ...(connStatus === "success" ? s.statusSuccess : s.statusError)
            }}>
              {connStatus === "success" ? "[OK]" : "[ERR]"} {connMessage}
            </div>
          )}
        </div>

        {/* Right panel: Live Exec Output Terminal */}
        <div style={s.terminalCard}>
          <div style={s.terminalTitleRow}>
            <div style={s.terminalTitle}>
              <span style={{
                ...s.terminalDot,
                ...(isRunning ? s.terminalDotRunning : {})
              }} />
              <span>C++ ETL ENGINE TERMINAL OUTPUT</span>
              {isRunning && <span style={s.terminalTimer}>· {runTime}s elapsed</span>}
            </div>
            <button onClick={clearTerminal} style={s.terminalClear}>
              Clear
            </button>
          </div>

          <div style={s.terminalLogs}>
            {terminalLogs.length === 0 ? (
              <div style={s.terminalPlaceholder}>
                Terminal idle. Click "Run ETL Pipeline" above to view live execution logs from C++ etl_engine.exe.
              </div>
            ) : (
              terminalLogs.map((log, index) => (
                <div
                  key={index}
                  style={{
                    ...s.logRow,
                    ...(log.type === "stdout" ? s.logStdout : log.type === "stderr" ? s.logStderr : s.logSystem)
                  }}
                >
                  {log.text}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Error strip — only show if a URL is set and we got a real connection/query error */}
      {error && dbUrl.trim() && (
        <div style={s.errorStrip}>
          <strong>Connection Error:</strong> {error}
          <div style={{ fontSize: "11px", marginTop: "4px", color: "#9c4221" }}>
            Check your connection URL. If the tables don't exist yet, click <strong>Init &amp; Seed DB</strong> above.
          </div>
        </div>
      )}


      {/* Main dashboard stats/charts */}
      {hasData ? (
        <>
          {/* Stat cards — styled like query result cells */}
          <div style={s.cardRow}>
            {[
              { label: "COUNT(*)", value: stats.total_employees, sub: "total_employees in processed_data" },
              { label: "AVG(total_compensation)", value: `$${Number(stats.avg_compensation).toLocaleString()}`, sub: "across all departments" },
              { label: "MAX(total_compensation)", value: `$${Number(stats.max_compensation).toLocaleString()}`, sub: "top employee comp" },
              { label: "AVG(experience_years)", value: `${stats.avg_experience} yrs`, sub: "average tenure calculated" },
            ].map((c, i) => (
              <div key={i} style={s.card}>
                <p style={s.cardLabel}>{c.label}</p>
                <p style={s.cardValue}>{c.value}</p>
                <p style={s.cardSub}>{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div style={s.chartRow}>
            <div style={s.chartBox}>
              <div style={s.chartHeader}>
                <span style={s.chartTitle}>AVG(total_compensation) GROUP BY department</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byDept} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                  <XAxis dataKey="department" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false}
                    tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12 }}
                    formatter={v => [`$${Number(v).toLocaleString()}`, "avg_compensation"]}
                  />
                  <Bar dataKey="avg_compensation" radius={[3,3,0,0]}>
                    {byDept.map((_, i) => (
                      <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={s.chartBox}>
              <div style={s.chartHeader}>
                <span style={s.chartTitle}>COUNT(*) GROUP BY salary_category</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={catData}
                    dataKey="count"
                    nameKey="salary_category"
                    cx="50%" cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    paddingAngle={3}
                  >
                    {catData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend
                    formatter={v => <span style={{ fontSize: 12, color: SLATE }}>{v}</span>}
                  />
                  <Tooltip
                    contentStyle={{ border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12 }}
                    formatter={(v, name) => [v, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table */}
          <div style={s.tableWrap}>
            <div style={s.chartHeader}>
              <span style={s.chartTitle}>result set · {byDept.length} rows returned</span>
            </div>
            <table style={s.table}>
              <thead>
                <tr style={s.theadRow}>
                  {["department","count","avg_compensation","avg_experience_years"].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byDept.map((row, i) => (
                  <tr key={i} style={i % 2 === 0 ? s.trEven : s.trOdd}>
                    <td style={s.td}><span style={s.strVal}>'{row.department}'</span></td>
                    <td style={s.td}><span style={s.numVal}>{row.count}</span></td>
                    <td style={s.td}><span style={s.numVal}>${Number(row.avg_compensation).toLocaleString()}</span></td>
                    <td style={s.td}><span style={s.numVal}>{row.avg_experience}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={s.emptyDashboard}>
          <h3 style={{ marginTop: 0 }}>No Processed Data Found</h3>
          <p style={{ color: MUTED, maxWidth: 500, margin: "8px auto 0", fontSize: 13 }}>
            This database either has no tables or the C++ ETL pipeline has not loaded data yet.
          </p>
          <p style={{ color: MUTED, maxWidth: 500, margin: "4px auto 16px", fontSize: 13 }}>
            Use the <strong>Database Control Center</strong> above to configure your connection, initialize tables, and then run the C++ ETL pipeline.
          </p>
        </div>
      )}

      <div style={s.footer}>
        <span>C++17 Parallel Pipeline · libpq · Producer-Transformer-Loader Thread Model · Neon PostgreSQL</span>
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: "100vh", background: BG, fontFamily: "'Inter', system-ui, sans-serif", color: SLATE },
  topbar: { background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  topbarLeft: { display: "flex", alignItems: "center", gap: 12 },
  topbarRight: { display: "flex", alignItems: "center", gap: 12 },
  pgLogo: { fontSize: 11, fontWeight: 800, color: WHITE, background: PG_BLUE, borderRadius: 5, padding: "4px 7px", letterSpacing: "0.5px", fontFamily: "monospace" },
  title: { margin: 0, fontSize: 17, fontWeight: 700, color: SLATE, letterSpacing: "-0.3px" },
  titleSub: { margin: 0, fontSize: 11, color: MUTED, fontFamily: "monospace", marginTop: 2 },
  badge: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED, background: PG_LIGHT, padding: "4px 12px", borderRadius: 20, border: `1px solid ${BORDER}` },
  dot: { width: 7, height: 7, borderRadius: "50%", background: "#38a169", display: "inline-block" },

  controlDeck: { display: "flex", gap: 16, padding: "20px 32px 0", flexWrap: "wrap" },
  controlCard: { flex: "1 1 350px", background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 },
  controlTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: SLATE, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${BORDER}`, paddingBottom: 10, marginBottom: 4 },
  formGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px" },
  input: { padding: "8px 12px", borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: "monospace", background: BG, color: SLATE, outline: "none" },
  toggleBtn: { background: "#e2e8f0", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 10px", cursor: "pointer", fontSize: 13 },
  sliderContainer: { display: "flex", alignItems: "center", gap: 12, height: "35px" },
  slider: { flexGrow: 1, cursor: "pointer" },
  btnRow: { display: "flex", gap: 10, marginTop: 4 },
  btn: { padding: "9px 16px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  btnPrimary: { background: PG_BLUE, color: WHITE, boxShadow: "0 2px 4px rgba(51, 103, 145, 0.2)" },
  btnSecondary: { background: "#e2e8f0", color: SLATE },
  btnDanger: { background: "#fed7d7", border: "1px solid #feb2b2", color: "#9b2c2c" },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed", boxShadow: "none" },
  statusMsg: { fontSize: 11, padding: "8px 12px", borderRadius: 6, marginTop: 4, fontFamily: "monospace" },
  statusSuccess: { background: "#f0fff4", border: "1px solid #c6f6d5", color: "#22543d" },
  statusError: { background: "#fff5f5", border: "1px solid #fed7d7", color: "#742a2a" },

  terminalCard: { flex: "2 1 500px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "20px 24px", display: "flex", flexDirection: "column", height: 260, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" },
  terminalTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", paddingBottom: 8, marginBottom: 10 },
  terminalTitle: { margin: 0, fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8 },
  terminalTimer: { color: "#e2e8f0", fontWeight: 400 },
  terminalDot: { width: 8, height: 8, borderRadius: "50%", background: "#475569", display: "inline-block" },
  terminalDotRunning: { background: "#10b981" },
  terminalLogs: { flexGrow: 1, overflowY: "auto", fontFamily: "monospace", fontSize: 11, color: "#cbd5e1", display: "flex", flexDirection: "column", gap: 3 },
  logRow: { whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.4 },
  logStdout: { color: "#38bdf8" },
  logStderr: { color: "#f87171" },
  logSystem: { color: "#10b981", fontWeight: 600 },
  terminalPlaceholder: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#475569", fontStyle: "italic", fontSize: 12, textAlign: "center" },
  terminalClear: { background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11, fontFamily: "monospace" },

  queryStrip: { background: "#1a2332", padding: "10px 32px", fontSize: 13, fontFamily: "monospace", letterSpacing: 0.2, overflowX: "auto", whiteSpace: "nowrap" },
  keyword: { color: "#336791", fontWeight: 700, fontFamily: "monospace" },
  col:     { color: "#2d6a4f", fontFamily: "monospace" },
  fn:      { color: "#9c4221", fontFamily: "monospace", fontWeight: 600 },
  tbl:     { color: "#744210", fontFamily: "monospace", fontStyle: "italic" },
  semi:    { color: MUTED, fontFamily: "monospace" },

  errorStrip: { background: "#fffaf0", borderLeft: "4px solid #dd6b20", margin: "20px 32px 0", padding: "12px 18px", borderRadius: 4, fontSize: 13, color: "#7b341e" },

  cardRow: { display: "flex", gap: 16, padding: "24px 32px 0", flexWrap: "wrap" },
  card: { flex: 1, minWidth: 160, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "16px 20px", borderTop: `3px solid ${PG_BLUE}` },
  cardLabel: { margin: 0, fontSize: 10, fontFamily: "monospace", color: PG_BLUE, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
  cardValue: { margin: "8px 0 2px", fontSize: 24, fontWeight: 700, color: SLATE, fontFamily: "monospace" },
  cardSub: { margin: 0, fontSize: 11, color: MUTED },

  chartRow: { display: "flex", gap: 16, padding: "20px 32px 0", flexWrap: "wrap" },
  chartBox: { flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "20px 24px" },
  chartHeader: { marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` },
  chartTitle: { fontSize: 11, fontFamily: "monospace", color: MUTED, fontWeight: 500 },

  tableWrap: { margin: "20px 32px 0", background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "20px 24px", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 13 },
  theadRow: { borderBottom: `2px solid ${BORDER}` },
  th: { textAlign: "left", padding: "8px 16px", fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "lowercase" },
  trEven: { background: WHITE },
  trOdd: { background: PG_LIGHT },
  td: { padding: "10px 16px", borderBottom: `1px solid ${BORDER}` },
  strVal: { color: "#2d6a4f" },
  numVal: { color: "#336791" },

  emptyDashboard: { margin: "20px 32px 0", background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "48px 24px", textAlign: "center" },

  footer: { textAlign: "center", padding: "32px 32px 24px", fontSize: 11, color: MUTED, fontFamily: "monospace" },
};