import { useState, useRef, useEffect } from "react";
import {
  Database, Bot, Send, LayoutDashboard, Terminal,
  Layers, Settings, ChevronRight, Loader2, AlertTriangle,
  CheckCircle2, Code2, FileBarChart2, Sparkles, X, Plus,
  RefreshCw, Download, Activity
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie,
  Legend, AreaChart, Area
} from "recharts";

// ── API ───────────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8080';

let _token = null;

async function ensureToken() {
  if (_token) return _token;
  const res = await fetch(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "dev-user", email: "dev@example.com" }),
  });
  if (!res.ok) throw new Error("Failed to get auth token");
  const data = await res.json();
  _token = data.token;
  return _token;
}

async function callAnalyze({ userQuery, s3Uri, conversationHistory }) {
  const token = await ensulicereToken();
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,   // ← this was missing
    },
    body: JSON.stringify({
      user_query: userQuery,
      s3_uri: s3Uri,
      conversation_history: conversationHistory,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) _token = null; // force re-auth on expiry
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Chart auto-detection from text output ─────────────────────────────────────
function parseChartData(text) {
  if (!text) return null;
  const lines = text.split("\n").filter(Boolean);
  const rows = [];
  for (const line of lines) {
    // Patterns: "Label: 123", "Label  123", "Label - 123"
    const m = line.match(/^(.+?)[\s:\-–]+(\d[\d,\.]*)\s*(%|units|items|pcs|k|m)?$/i);
    if (m) {
      const val = parseFloat(m[2].replace(/,/g, ""));
      if (!isNaN(val)) rows.push({ name: m[1].trim().slice(0, 22), value: val });
    }
  }
  return rows.length >= 2 ? rows : null;
}

// ── Trace steps ───────────────────────────────────────────────────────────────
const TRACE_STEPS = [
  { id: "analyst",  label: "Analyst Agent — planning code",   color: "text-blue-400" },
  { id: "executor", label: "Executor — running analysis",      color: "text-purple-400" },
  { id: "critic",   label: "Critic — validating output",       color: "text-amber-400" },
  { id: "done",     label: "Summary generated",                color: "text-emerald-400" },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [s3Uri, setS3Uri] = useState("");
  const [s3Input, setS3Input] = useState("");
  const [datasources, setDatasources] = useState([]);

  const [messages, setMessages] = useState([]);          // { role, content }
  const [canvasItems, setCanvasItems] = useState([]);    // { type, data, query, retries, code }
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [traceStep, setTraceStep] = useState(null);      // 0..3
  const [activeTab, setActiveTab] = useState("insights");

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
//following is runs whenever messages are changed, it scrolls to the end of the chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Simulate trace progress while loading
  useEffect(() => {
    if (!loading) { setTraceStep(null); return; }
    setTraceStep(0);
    const timings = [800, 2000, 3500];
    const timers = timings.map((t, i) => setTimeout(() => setTraceStep(i + 1), t));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  function addDatasource() {
    const uri = s3Input.trim();
    if (!uri.startsWith("s3://")) return;
    if (!datasources.find(d => d.uri === uri)) {
      setDatasources(prev => [...prev, { uri, name: uri.split("/").pop() }]);
    }
    setS3Uri(uri);
    setS3Input("");
  }

  async function handleSubmit() {
    const q = query.trim();
    if (!q || !s3Uri || loading) return;

    const userMsg = { role: "user", content: q };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setQuery("");
    setLoading(true);

    // Build history for backend
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await callAnalyze({ userQuery: q, s3Uri, conversationHistory: history });
      setTraceStep(3);

      const assistantMsg = {
        role: "assistant",
        content: result.final_recommendation,
        meta: {
          analysis_output: result.analysis_output,
          generated_code: result.generated_code,
          retry_count: result.retry_count,
        },
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Build canvas card
      const chartData = parseChartData(result.analysis_output);
      setCanvasItems(prev => [
        {
          id: Date.now(),
          query: q,
          summary: result.final_recommendation,
          analysis: result.analysis_output,
          code: result.generated_code,
          retries: result.retry_count,
          chartData,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      setActiveTab("insights");
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { role: "error", content: `Request failed: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }

  const isReady = s3Uri && !loading;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#020617] font-sans">

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-slate-800/80 flex flex-col bg-[#0a1628]/80 backdrop-blur">

        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800/80">
          <div className="p-1.5 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/30">
            <Activity className="text-white" size={20} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-white leading-none">AI Analytics</p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">Platform v2.0</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">

          {/* Nav */}
          <nav className="space-y-1">
            <SideLabel>Workspace</SideLabel>
            <NavItem icon={<LayoutDashboard size={16}/>} label="Insights Canvas"
              active={activeTab === "insights"} onClick={() => setActiveTab("insights")} />
            <NavItem icon={<Code2 size={16}/>} label="Generated Code"
              active={activeTab === "code"} onClick={() => setActiveTab("code")} />
            <NavItem icon={<FileBarChart2 size={16}/>} label="Raw Analysis"
              active={activeTab === "raw"} onClick={() => setActiveTab("raw")} />
          </nav>

          {/* Data Sources */}
          <div>
            <SideLabel>Data Sources</SideLabel>
            <div className="flex gap-2 mb-3">
              <input
                value={s3Input}
                onChange={e => setS3Input(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addDatasource()}
                placeholder="s3://bucket/file.csv"
                className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-[11px] text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500/60 focus:bg-slate-800 transition"
              />
              <button onClick={addDatasource}
                className="p-2 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 hover:bg-blue-600/30 transition">
                <Plus size={14} />
              </button>
            </div>

            {datasources.length === 0 ? (
              <p className="text-[11px] text-slate-600 italic px-1">No sources added yet</p>
            ) : (
              <div className="space-y-2">
                {datasources.map(d => (
                  <DatasetItem
                    key={d.uri} name={d.name} uri={d.uri}
                    active={d.uri === s3Uri}
                    onClick={() => setS3Uri(d.uri)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Agent Status */}
          <div>
            <SideLabel>Agent Status</SideLabel>
            <div className="p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl space-y-2">
              <StatusRow label="Analyst Agent" ok />
              <StatusRow label="Executor Engine" ok />
              <StatusRow label="Critic Agent" ok />
              <StatusRow label="AWS Bedrock" ok />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800/80">
          <NavItem icon={<Settings size={16}/>} label="Settings" />
        </div>
      </aside>

      {/* ── CENTER: CHAT ──────────────────────────────────────────────────── */}
      <section className="w-[400px] shrink-0 border-r border-slate-800/80 flex flex-col bg-[#020617]">
        <header className="h-16 flex items-center px-5 border-b border-slate-800/80 justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full ${s3Uri ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            <span className="text-[11px] font-mono text-slate-400">
              {s3Uri ? s3Uri.split("/").pop() : "NO SOURCE SELECTED"}
            </span>
          </div>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])}
              className="text-slate-600 hover:text-slate-400 transition">
              <RefreshCw size={14} />
            </button>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 pb-10">
              <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                <Sparkles className="text-blue-400" size={24} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300">Ready to analyse</p>
                <p className="text-xs text-slate-600 mt-1 max-w-[220px]">
                  Add an S3 data source, then ask a question about your data.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full max-w-[260px]">
                {["Show top 10 products by revenue", "Find anomalies in sales data", "Compare Q1 vs Q2 performance"].map(s => (
                  <button key={s} onClick={() => { setQuery(s); inputRef.current?.focus(); }}
                    className="text-left px-3 py-2.5 bg-slate-800/40 border border-slate-700/50 rounded-xl text-[11px] text-slate-400 hover:border-blue-500/40 hover:text-slate-300 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          {/* Live trace */}
          {loading && (
            <div className="p-3.5 bg-black/40 border border-slate-800 rounded-2xl font-mono text-[11px] space-y-1.5">
              <div className="flex items-center gap-2 mb-2 text-slate-500">
                <Terminal size={11} /> <span>AGENT TRACE</span>
              </div>
              {TRACE_STEPS.map((step, i) => (
                <TraceRow key={step.id} step={step} state={
                  traceStep > i ? "done" : traceStep === i ? "active" : "pending"
                } />
              ))}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-800/80 shrink-0">
          {!s3Uri && (
            <p className="text-[10px] text-amber-500/80 flex items-center gap-1.5 mb-2 px-1">
              <AlertTriangle size={11} /> Add an S3 source to enable analysis
            </p>
          )}
          <div className={`flex items-end gap-2 bg-slate-800/60 border rounded-2xl p-2 px-3 transition ${isReady ? "border-slate-700 focus-within:border-blue-500/60" : "border-slate-800 opacity-60"}`}>
            <textarea
              ref={inputRef}
              rows={1}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isReady}
              placeholder={isReady ? "Ask your data agent…" : "Select a data source first"}
              className="bg-transparent flex-1 outline-none text-sm text-slate-200 placeholder-slate-600 resize-none py-1.5 max-h-28 leading-relaxed"
              style={{ field_sizing: "content" }}
            />
            <button onClick={handleSubmit} disabled={!isReady || !query.trim()}
              className="shrink-0 p-2 bg-blue-600 rounded-xl text-white disabled:opacity-30 hover:bg-blue-500 active:scale-95 transition">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </section>

      {/* ── RIGHT: CANVAS ─────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col overflow-hidden bg-[#020617]">
        <header className="h-16 flex items-center px-6 border-b border-slate-800/80 justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Insight Canvas</h2>
            <p className="text-[11px] text-slate-500">
              {canvasItems.length} result{canvasItems.length !== 1 ? "s" : ""} · automated visual reporting
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab pills */}
            {[
              { id: "insights", label: "Insights" },
              { id: "code",     label: "Code" },
              { id: "raw",      label: "Raw Output" },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition ${activeTab === t.id ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "text-slate-500 hover:text-slate-300"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {canvasItems.length === 0 ? (
            <EmptyCanvas />
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {canvasItems.map(item => (
                <CanvasCard key={item.id} item={item} tab={activeTab} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Chat Bubble ───────────────────────────────────────────────────────────────
function ChatBubble({ msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-blue-600/15 border border-blue-500/20 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-slate-200 leading-relaxed">{msg.content}</p>
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 shrink-0 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mt-0.5">
          <AlertTriangle size={13} className="text-red-400" />
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="text-sm text-red-400">{msg.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 shrink-0 rounded-xl bg-blue-600/15 border border-blue-500/20 flex items-center justify-center mt-0.5">
        <Bot size={13} className="text-blue-400" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="text-sm text-slate-200 leading-relaxed">{msg.content}</p>
        </div>
        {msg.meta?.retry_count > 0 && (
          <p className="text-[10px] text-amber-500/70 px-1 flex items-center gap-1">
            <RefreshCw size={9}/> {msg.meta.retry_count} retry{msg.meta.retry_count > 1 ? "ies" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Trace Row ─────────────────────────────────────────────────────────────────
function TraceRow({ step, state }) {
  return (
    <div className={`flex items-center gap-2 transition-opacity ${state === "pending" ? "opacity-25" : "opacity-100"}`}>
      {state === "done" && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
      {state === "active" && <Loader2 size={11} className="text-blue-400 animate-spin shrink-0" />}
      {state === "pending" && <div className="w-[11px] h-[11px] rounded-full border border-slate-700 shrink-0" />}
      <span className={state === "active" ? step.color : state === "done" ? "text-slate-400" : "text-slate-600"}>
        {step.label}
      </span>
    </div>
  );
}

// ── Canvas Card ───────────────────────────────────────────────────────────────
const CHART_COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#f97316"];

function CanvasCard({ item, tab }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden backdrop-blur">
      {/* Card header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-slate-800/60">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono text-slate-500 mb-1">{item.timestamp}</p>
          <p className="text-sm font-semibold text-slate-200 truncate">{item.query}</p>
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {item.retries > 0 && (
            <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
              {item.retries} retry
            </span>
          )}
          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 size={9} /> PASS
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-5">

        {/* INSIGHTS TAB */}
        {tab === "insights" && (
          <>
            {/* Summary */}
            <div className="p-4 bg-blue-600/5 border border-blue-500/15 rounded-xl">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-2">Executive Summary</p>
              <p className="text-sm text-slate-300 leading-relaxed">{item.summary}</p>
            </div>

            {/* Auto chart */}
            {item.chartData && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Analysis Chart</p>
                <SmartChart data={item.chartData} />
              </div>
            )}

            {/* Raw output preview (collapsed) */}
            <div>
              <button onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition">
                <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                Raw output {expanded ? "▲" : "▼"}
              </button>
              {expanded && (
                <pre className="mt-2 p-3 bg-black/40 border border-slate-800 rounded-xl text-[11px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
                  {item.analysis || "(empty)"}
                </pre>
              )}
            </div>
          </>
        )}

        {/* CODE TAB */}
        {tab === "code" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Generated Python</p>
              <button onClick={() => navigator.clipboard?.writeText(item.code)}
                className="text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition">
                <Download size={10}/> Copy
              </button>
            </div>
            <pre className="p-4 bg-black/50 border border-slate-800 rounded-xl text-[11px] text-emerald-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {item.code || "(no code)"}
            </pre>
          </div>
        )}

        {/* RAW TAB */}
        {tab === "raw" && (
          <pre className="p-4 bg-black/50 border border-slate-800 rounded-xl text-[11px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96">
            {item.analysis || "(empty)"}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Smart Chart ───────────────────────────────────────────────────────────────
function SmartChart({ data }) {
  const isMany = data.length > 6;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {isMany ? (
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 24, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false}
              tick={{ fill: "#64748b", fontSize: 10 }} angle={-30} textAnchor="end" dy={8} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "#1e293b" }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={24}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "#1e293b" }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12 }} />
            <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#cg)" dot={{ fill: "#3b82f6", r: 4 }} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ── Empty Canvas ──────────────────────────────────────────────────────────────
function EmptyCanvas() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 pb-20">
      <div className="w-20 h-20 rounded-3xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-center">
        <FileBarChart2 className="text-slate-600" size={36} />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-400">Canvas is empty</p>
        <p className="text-sm text-slate-600 mt-1 max-w-xs">
          Analysis results, charts, and executive summaries will appear here automatically.
        </p>
      </div>
    </div>
  );
}

// ── Sidebar helpers ───────────────────────────────────────────────────────────
function SideLabel({ children }) {
  return <p className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-2 px-1">{children}</p>;
}

function NavItem({ icon, label, active = false, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${active ? "bg-blue-600/15 text-blue-400 border border-blue-500/20" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"}`}>
      {icon} {label}
    </button>
  );
}

function DatasetItem({ name, uri, active, onClick }) {
  const ext = name.split(".").pop()?.toUpperCase() || "S3";
  return (
    <button onClick={onClick}
      className={`w-full p-3 border rounded-xl text-left transition ${active ? "bg-blue-600/10 border-blue-500/30" : "bg-slate-800/30 border-slate-700/50 hover:border-slate-600"}`}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold text-slate-300 truncate w-36">{name}</span>
        <span className="text-[9px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-500 uppercase shrink-0">{ext}</span>
      </div>
      <span className={`text-[10px] flex items-center gap-1 font-medium ${active ? "text-blue-400" : "text-emerald-400"}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${active ? "bg-blue-400" : "bg-emerald-400"}`} />
        {active ? "Active" : "Ready"}
      </span>
    </button>
  );
}

function StatusRow({ label, ok }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[10px] font-mono ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {ok ? "● online" : "● offline"}
      </span>
    </div>
  );
}
