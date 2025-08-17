import React, { useEffect, useMemo, useRef, useState } from "react";
import bugsData from "../bugs.json"; // Auto-synced source file

// Exotics Café Bugs Board: front‑end only issue board that ingests JSON, edits it in place, and lets you export.
// No backend. Uses Tailwind. Works entirely in browser with localStorage persistence.
// Key features:
// - Import JSON (file, paste, or URL)
// - Auto-normalize to an Issue[] shape
// - Kanban board with drag-and-drop across columns (HTML5 DnD)
// - Inline edit via side panel modal
// - Search, filter by status, sort, add/remove issues
// - Raw JSON editor kept in sync
// - Export JSON (download)

// ---- Types (for clarity) ----
// Issue shape we normalize to:
// {
//   id: string,
//   title: string,
//   description?: string,
//   status: string,          // e.g., Backlog, Todo, In Progress, Done, Archived
//   priority?: "P0"|"P1"|"P2"|"P3",
//   assignee?: string,
//   tags?: string[],
//   createdAt?: string,      // ISO
//   updatedAt?: string,      // ISO
//   comments?: { id: string, author?: string, body: string, createdAt: string }[]
// }

const LS_KEY = "exotics-bugs-issues-v1";
// Removed THEME_LS_KEY (theme toggle eliminated)
const ROLE_LS_KEY = 'exotics-bugs-role';
const MAINTAINER_KEY = 'changeme'; // TODO: set this to a non-obvious phrase before deploying

const DEFAULT_STATUSES = ["Backlog", "Todo", "In Progress", "Done", "Archived"]; // canonical ordering

const SAMPLE_ISSUES = [
  {
    id: "ISSUE-1",
    title: "Price formatting unclear",
    description: "Show K/M/B for large numbers and thousands separators.",
    status: "Todo",
    priority: "P1",
    tags: ["UX"],
    assignee: "nago",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: []
  },
  {
    id: "ISSUE-2",
    title: "Start time defaults to now",
    description: "Auto-set start time to now; make end time optional.",
    status: "In Progress",
    priority: "P1",
    tags: ["Forms", "Listings"],
    assignee: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: []
  },
  {
    id: "ISSUE-3",
    title: "Mobile layout pass",
    description: "Clean spacing, responsive cards, improve header nav.",
    status: "Backlog",
    priority: "P2",
    tags: ["Responsive"],
    assignee: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: []
  },
  {
    id: "ISSUE-4",
    title: "Login: passwordless via Discord code",
    description: "Replace password field with one-time code bot flow. Add trust copy.",
    status: "Backlog",
    priority: "P0",
    tags: ["Auth", "Trust"],
    assignee: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: []
  }
];

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeIncomingJSON(input) {
  try {
    let data = input;
    if (typeof input === "string") data = JSON.parse(input);

    // Accept: Issue[], { issues: Issue[] }, or anything with an array at a known key
    let issues = [];
    if (Array.isArray(data)) issues = data;
    else if (data && Array.isArray(data.issues)) issues = data.issues;
    else if (data && Array.isArray(data.items)) issues = data.items;
    else if (data && Array.isArray(data.bugs)) issues = data.bugs;

    issues = issues.map((raw, idx) => {
      const id = `${raw.id ?? raw.key ?? `ISSUE-${idx + 1}`}`;
      const title = `${raw.title ?? raw.summary ?? raw.name ?? "Untitled"}`;
      const status = `${raw.status ?? raw.state ?? "Backlog"}`;
      const priority = raw.priority ?? raw.severity ?? undefined;
      const tags = raw.tags ?? raw.labels ?? [];
      const createdAt = raw.createdAt ?? raw.created ?? new Date().toISOString();
      const updatedAt = raw.updatedAt ?? raw.updated ?? createdAt;
      const comments = raw.comments ?? [];
      return {
        id,
        title,
        description: raw.description ?? "",
        status,
        priority,
        assignee: raw.assignee ?? raw.owner ?? "",
        tags: Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",").map(s=>s.trim()).filter(Boolean) : []),
        createdAt,
        updatedAt,
        comments: Array.isArray(comments) ? comments.map((c, i) => ({
          id: c.id ?? uid(`c${i}`),
          author: c.author ?? c.user ?? "",
          body: c.body ?? c.text ?? String(c ?? ""),
          createdAt: c.createdAt ?? c.created ?? new Date().toISOString()
        })) : []
      };
    });

    return issues;
  } catch (e) {
    console.error("Failed to parse/normalize JSON", e);
    throw e;
  }
}

function downloadJSON(filename, json) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function useLocalStorageState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

function classNames(...xs) { return xs.filter(Boolean).join(" "); }

const PriorityBadge = ({ p }) => {
  if (!p) return null;
  const map = {
    P0: "bg-red-600/20 text-red-400 ring-red-500/30",
    P1: "bg-orange-600/20 text-orange-400 ring-orange-500/30",
    P2: "bg-yellow-600/20 text-yellow-300 ring-yellow-500/30",
    P3: "bg-slate-600/20 text-slate-300 ring-slate-500/30"
  };
  return (
    <span className={classNames("px-2 py-0.5 text-xs rounded-full ring-1", map[p] ?? map.P3)}>{p}</span>
  );
};

const Tag = ({ t }) => (
  <span className="px-2 py-0.5 text-xs rounded bg-slate-300 text-slate-700 ring-1 ring-slate-400 dark:bg-slate-700/50 dark:text-slate-200 dark:ring-slate-600 transition-colors">{t}</span>
);

const IconButton = ({ title, onClick, children }) => (
  <button title={title} onClick={onClick}
    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-slate-200 text-slate-900 hover:bg-slate-300 active:bg-slate-400 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:active:bg-slate-600 dark:ring-slate-700 transition-colors">
    {children}
  </button>
);

const Modal = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl rounded-2xl bg-white text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 p-6 shadow-xl overflow-hidden transition-colors">
          {children}
        </div>
      </div>
    </div>
  );
};

const TextInput = (props) => (
  <input {...props} className={classNames(
    "w-full rounded-lg px-3 py-2 ring-1 focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white text-slate-900 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700",
    props.className)} />
);

const TextArea = (props) => (
  <textarea {...props} className={classNames(
    "w-full rounded-lg px-3 py-2 ring-1 focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white text-slate-900 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700",
    props.className)} />
);

const Select = ({ value, onChange, options, className }) => (
  <select value={value} onChange={onChange} className={classNames(
    "w-full rounded-lg px-3 py-2 ring-1 focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white text-slate-900 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700",
    className)}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

function IssueCard({ issue, onOpen, onDragStart }) {
  return (
    <div draggable onDragStart={(e)=>onDragStart(e, issue)}
      onDoubleClick={onOpen}
      className="group cursor-grab active:cursor-grabbing rounded-xl bg-white ring-1 ring-slate-300 p-3 shadow hover:shadow-lg hover:ring-cyan-600 transition dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm line-clamp-2">{issue.title}</h4>
        <PriorityBadge p={issue.priority} />
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-3">{issue.description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {issue.tags?.slice(0,4).map(t=> <Tag key={t} t={t} />)}
      </div>
      <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>#{issue.id}</span>
        {issue.assignee ? <span>@{issue.assignee}</span> : <span className="opacity-60">unassigned</span>}
      </div>
    </div>
  );
}

function Column({ name, issues, onDropIssue, onOpenIssue }) {
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/issue-id");
    if (id) onDropIssue(id, name);
  };
  return (
    <div onDragOver={onDragOver} onDrop={onDrop}
      className="flex flex-col gap-3 rounded-2xl bg-white ring-1 ring-slate-200 p-3 min-h-[60vh] dark:bg-slate-900/60 dark:ring-slate-800 transition-colors">
      <div className="flex items-center justify-between">
        <h3 className="text-slate-800 dark:text-slate-200 font-semibold">{name}</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-3">
        {issues.map((it)=> (
          <IssueCard key={it.id} issue={it} onOpen={()=>onOpenIssue(it)}
            onDragStart={(e)=>{ e.dataTransfer.setData("text/issue-id", it.id); }} />
        ))}
      </div>
    </div>
  );
}

// Merge helper: keep local edits, add new file issues
function mergeFileIntoLocal(localIssues, fileIssues) {
  const localMap = new Map(localIssues.map(i => [i.id, i]));
  const merged = [...localIssues];
  for (const f of fileIssues) {
    if (localMap.has(f.id)) {
      const existing = localMap.get(f.id);
      const idx = merged.findIndex(i => i.id === f.id);
      merged[idx] = { ...f, ...existing }; // local changes win
    } else {
      merged.push(f);
    }
  }
  return merged;
}

// Helper to append only new issues by id
function appendNewIssues(prev, incoming) {
  const existingIds = new Set(prev.map(i => i.id));
  const additions = incoming.filter(i => !existingIds.has(i.id)).map(i => ({ ...i, createdByVisitor: i.createdByVisitor ?? false }));
  if (additions.length === 0) return prev;
  return [...prev, ...additions];
}

export default function App() {
  // Force dark mode once on mount
  useEffect(()=>{ document.documentElement.classList.add('dark'); }, []);

  const [issues, setIssues] = useLocalStorageState(LS_KEY, (() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return bugsData.issues || SAMPLE_ISSUES;
  })());
  const [fileVersion, setFileVersion] = useState(Date.now());

  // Hot Module Replacement: merge instead of overwrite
  if (import.meta.hot) {
    import.meta.hot.accept("../bugs.json", (mod) => {
      const fresh = mod.default?.issues || [];
      setIssues(prev => mergeFileIntoLocal(prev, fresh));
      setFileVersion(Date.now());
    });
  }

  // Re-seed ONLY if nothing stored (e.g., localStorage cleared)
  useEffect(() => {
    if (!issues || issues.length === 0) {
      setIssues(bugsData.issues || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileVersion]);

  const [selected, setSelected] = useState(null);
  // replaced generic query with focused search term
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("priority"); // priority | createdAt | title
  const [showJSON, setShowJSON] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const urlInputRef = useRef(null);

  const [role, setRole] = useLocalStorageState(ROLE_LS_KEY, 'guest');
  const [maintainerInput, setMaintainerInput] = useState('');
  // New draft state for unsaved issue
  const [draft, setDraft] = useState(null);
  // Tag filter state
  const [tagFilter, setTagFilter] = useState("");

  const allStatuses = useMemo(() => {
    const found = Array.from(new Set(issues.map(i => i.status))).filter(Boolean);
    const merged = [...DEFAULT_STATUSES];
    for (const s of found) if (!merged.includes(s)) merged.splice(merged.length - 1, 0, s); // insert before Archived
    return merged;
  }, [issues]);

  const filtered = useMemo(() => {
    const searchQ = search.trim().toLowerCase();
    const tagQ = tagFilter.trim().toLowerCase();
    let list = [...issues];
    if (searchQ) {
      list = list.filter(i =>
        i.title?.toLowerCase().includes(searchQ) ||
        (i.priority && i.priority.toLowerCase() === searchQ) ||
        (searchQ.startsWith('p') && i.priority?.toLowerCase() === searchQ)
      );
    }
    if (tagQ) {
      list = list.filter(i => i.tags?.some(t => t.toLowerCase().includes(tagQ)));
    }
    const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    list.sort((a,b) => {
      if (sortKey === "priority") return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
      if (sortKey === "createdAt") return new Date(a.createdAt||0) - new Date(b.createdAt||0);
      if (sortKey === "title") return (a.title||"").localeCompare(b.title||"");
      return 0;
    });
    return list;
  }, [issues, search, sortKey, tagFilter]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(allStatuses.map(s => [s, []]));
    for (const it of filtered) {
      const s = it.status && map[it.status] ? it.status : "Backlog";
      map[s].push(it);
    }
    return map;
  }, [filtered, allStatuses]);

  const updateIssue = (id, patch) => {
    // If editing an unsaved draft, mutate draft instead of persisted issues
    if (draft && draft.id === id) {
      setDraft(d => d ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d);
      return;
    }
    setIssues(prev => prev.map(i => i.id === id ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i));
  };

  const moveIssueTo = (id, status) => {
    // Prevent moving unsaved draft via DnD
    if (draft && draft.id === id) return;
    const issue = issues.find(i => i.id === id);
    const canEdit = role === 'maintainer' || issue?.createdByVisitor;
    if (!canEdit) return; // block unauthorized move
    updateIssue(id, { status });
  };

  const addIssue = () => {
    // If a draft already exists, confirm discard
    if (draft && !confirm('Discard current unsaved issue?')) return;
    const id = `ISSUE-${Math.max(0, ...issues.map(i => Number(String(i.id).split("-").pop()) || 0)) + 1}`;
    const createdByVisitor = role !== 'maintainer';
    const newDraft = {
      id,
      title: "New issue",
      description: "",
      status: "Backlog",
      priority: "P2",
      assignee: "",
      tags: ["Discord Bugs"], // default tag
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
      createdByVisitor,
    };
    setDraft(newDraft); // Do NOT add to issues yet
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.title.trim()) { alert('Title is required'); return; }
    setIssues(prev => [draft, ...prev]);
    setSelected(draft); // convert to persisted selection
    setDraft(null);
  };

  const deleteIssue = (id) => {
    if (draft && draft.id === id) { // deleting an unsaved draft
      setDraft(null);
      return;
    }
    const issue = issues.find(i => i.id === id);
    const canDelete = role === 'maintainer' || issue?.createdByVisitor;
    if (!canDelete) return alert('Only maintainers can delete existing issues.');
    setIssues(prev => prev.filter(i => i.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleImportFile = async (file) => {
    try {
      const text = await file.text();
      const incoming = normalizeIncomingJSON(text);
      setIssues(prev => appendNewIssues(prev, incoming));
    } catch (e) {
      alert("Failed to import JSON: " + e.message);
    }
  };

  const handlePasteJSON = (text) => {
    try {
      const incoming = normalizeIncomingJSON(text);
      setIssues(prev => appendNewIssues(prev, incoming));
      setPasteOpen(false);
    } catch (e) {
      alert("Invalid JSON");
    }
  };

  const handleFetchURL = async () => {
    try {
      const url = urlInputRef.current?.value?.trim();
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const incoming = normalizeIncomingJSON(data);
      setIssues(prev => appendNewIssues(prev, incoming));
      setUrlOpen(false);
    } catch (e) {
      alert("Failed to fetch JSON: " + e.message);
    }
  };

  const [rawJSON, setRawJSON] = useState("");
  useEffect(() => { setRawJSON(JSON.stringify(issues, null, 2)); }, [issues]);
  const applyRawJSON = () => {
    try {
      const parsed = JSON.parse(rawJSON);
      const incoming = normalizeIncomingJSON(parsed);
      setIssues(prev => appendNewIssues(prev, incoming));
    } catch (e) { alert("Invalid JSON: " + e.message); }
  };

  const resetToFile = () => {
    if (confirm('Reset board to bugs.json? This discards local changes.')) {
      setIssues(bugsData.issues || []);
    }
  };

  const handleMaintainerLogin = (e) => {
    e.preventDefault();
    if (maintainerInput === MAINTAINER_KEY) {
      setRole('maintainer');
      setMaintainerInput('');
    } else {
      alert('Invalid key');
    }
  };
  const logoutMaintainer = () => setRole('guest');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      <header className="border-b border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold">Exotics Café Bugs</h1>
              <p className="text-sm text-slate-400">Track & triage website issues</p>
            </div>
            {/* Maintainer auth panel moved right to reduce left clutter */}
            <div className="flex flex-wrap gap-4 items-center justify-end">
              {role === 'maintainer' ? (
                <div className="flex items-center gap-2 text-xs bg-emerald-600/10 text-emerald-300 px-3 py-1 rounded-lg ring-1 ring-emerald-500/30">
                  <span>Maintainer</span>
                  <button onClick={logoutMaintainer} className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30">Sign out</button>
                </div>
              ) : (
                <form onSubmit={handleMaintainerLogin} className="flex items-center gap-2 text-xs">
                  <input type="password" placeholder="Maintainer key" value={maintainerInput} onChange={e=>setMaintainerInput(e.target.value)}
                         className="px-2 py-1 rounded bg-slate-800 text-slate-200 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                  <button type="submit" className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white">Enter</button>
                </form>
              )}
            </div>
          </div>

          {/* Filters row */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={sortKey} onChange={(e)=>setSortKey(e.target.value)} options={["priority","createdAt","title"]} className="w-28 md:w-32" />
              <input
                type="text"
                placeholder="Search (title / P0)"
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
                className="w-40 md:w-52 rounded-lg bg-white text-slate-900 ring-1 ring-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
              />
              <input
                type="text"
                placeholder="Tag filter"
                value={tagFilter}
                onChange={(e)=>setTagFilter(e.target.value)}
                className="w-36 md:w-40 rounded-lg bg-white text-slate-900 ring-1 ring-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
              />
            </div>
            {/* Actions row */}
            <div className="flex flex-wrap gap-2 items-center w-full lg:w-auto [&>*]:shrink-0">
              <IconButton title="Add issue" onClick={addIssue}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                <span>New</span>
              </IconButton>
              {role === 'maintainer' && (
                <IconButton title="Reset to bugs.json" onClick={resetToFile}>♻️<span>Reset</span></IconButton>
              )}
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) handleImportFile(f); e.target.value=''; }} />
                <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-slate-200 text-slate-900 hover:bg-slate-300 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:ring-slate-700">📁 Import</span>
              </label>
              <IconButton title="Paste JSON" onClick={()=>setPasteOpen(true)}>📋<span>Paste</span></IconButton>
              <IconButton title="Load from URL" onClick={()=>setUrlOpen(true)}>🔗<span>From URL</span></IconButton>
              <IconButton title="Download JSON" onClick={()=>downloadJSON("issues.json", issues)}>💾<span>Export</span></IconButton>
              <IconButton title="Raw JSON" onClick={()=>setShowJSON(v=>!v)}>{showJSON?"❎":"{}"}<span>Raw</span></IconButton>
              {/* Theme toggle removed */}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Board */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {allStatuses.map((s) => (
            <Column key={s} name={s} issues={byStatus[s] ?? []}
                    onDropIssue={(id, status)=> moveIssueTo(id, status)} onOpenIssue={setSelected} />
          ))}
        </div>

        {/* Empty state helper */}
        {issues.length === 0 && (
          <div className="mt-10 mx-auto max-w-xl text-center text-slate-300">
            <p className="text-lg">No issues loaded.</p>
            <p className="mt-2">Use <strong>Import</strong> / <strong>Paste</strong> / <strong>From URL</strong> or click <strong>New</strong> to start.</p>
          </div>
        )}

        {/* Raw JSON panel */}
        {showJSON && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl ring-1 ring-slate-800 bg-slate-900 p-4">
              <h3 className="font-semibold text-slate-200 mb-2">Raw JSON (editable)</h3>
              <TextArea rows={18} value={rawJSON} onChange={(e)=>setRawJSON(e.target.value)} />
              <div className="mt-3 flex gap-2">
                <IconButton title="Apply JSON" onClick={applyRawJSON}>✅<span>Apply</span></IconButton>
                <IconButton title="Pretty print" onClick={()=>setRawJSON(JSON.stringify(JSON.parse(rawJSON), null, 2))}>✨<span>Format</span></IconButton>
              </div>
            </div>
            <div className="rounded-2xl ring-1 ring-slate-800 bg-slate-900 p-4">
              <h3 className="font-semibold text-slate-200 mb-2">Schema hints</h3>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap">{`Accepts one of:
- Issue[]
- { issues: Issue[] }
- { items: Issue[] }
- { bugs: Issue[] }

Issue fields: {
  id: string,
  title: string,
  description?: string,
  status: string,
  priority?: "P0"|"P1"|"P2"|"P3",
  assignee?: string,
  tags?: string[],
  createdAt?: ISO string,
  updatedAt?: ISO string,
  comments?: { id: string, author?: string, body: string, createdAt: ISO }[]
}`}</pre>
            </div>
          </div>
        )}
      </main>

      {/* Edit modal */}
      <Modal open={!!draft || !!selected} onClose={() => { if (draft) setDraft(null); else setSelected(null); }}>
        {(draft || selected) && (() => { const current = draft || selected; const canEdit = draft ? true : (role==='maintainer' || current.createdByVisitor); return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{draft ? 'New issue (unsaved)' : (canEdit ? 'Edit' : 'View') } #{current.id}</h2>
              <div className="flex gap-2">
                {draft ? (
                  <>
                    <IconButton title="Save" onClick={saveDraft}>💾<span>Save</span></IconButton>
                    <IconButton title="Discard" onClick={() => setDraft(null)}>🗑️<span>Discard</span></IconButton>
                    <IconButton title="Close" onClick={() => setDraft(null)}>✖️<span>Close</span></IconButton>
                  </>
                ) : (
                  <>
                    {(role==='maintainer' || current.createdByVisitor) && (
                      <IconButton title="Delete" onClick={()=>deleteIssue(current.id)}>🗑️<span>Delete</span></IconButton>
                    )}
                    <IconButton title="Close" onClick={()=>setSelected(null)}>✖️<span>Close</span></IconButton>
                  </>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Title</label>
              <TextInput disabled={!canEdit} value={current.title} onChange={(e)=>updateIssue(current.id, { title: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Assignee</label>
              <TextInput disabled={!canEdit} value={current.assignee||""} onChange={(e)=>updateIssue(current.id, { assignee: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">Description</label>
              <TextArea disabled={!canEdit} rows={4} value={current.description||""} onChange={(e)=>updateIssue(current.id, { description: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Status</label>
              <Select value={current.status} onChange={(e)=>{ if(canEdit) updateIssue(current.id, { status: e.target.value }); }} options={allStatuses} className={!canEdit?'pointer-events-none opacity-60':''} />
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Priority</label>
              <Select value={current.priority||"P2"} onChange={(e)=>{ if(canEdit) updateIssue(current.id, { priority: e.target.value }); }} options={["P0","P1","P2","P3"]} className={!canEdit?'pointer-events-none opacity-60':''} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">Tags (comma separated)</label>
              <TextInput disabled={!canEdit} value={(current.tags||[]).join(", ")} onChange={(e)=>updateIssue(current.id, { tags: e.target.value.split(",").map(s=>s.trim()).filter(Boolean) })} />
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Created</label>
              <TextInput value={current.createdAt||""} onChange={(e)=>updateIssue(current.id, { createdAt: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Updated</label>
              <TextInput value={current.updatedAt||""} onChange={(e)=>updateIssue(current.id, { updatedAt: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">Comments</label>
              <div className="space-y-2 max-h-40 overflow-auto pr-1">
                {(current.comments||[]).map(c => (
                  <div key={c.id} className="rounded-lg bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-300 dark:ring-slate-700 p-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{c.author || "anon"} · {new Date(c.createdAt).toLocaleString()}</div>
                    <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{c.body}</div>
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  <TextInput placeholder="Add a comment…" onKeyDown={(e)=>{
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      const body = e.currentTarget.value.trim();
                      const c = { id: uid("c"), author: role==='maintainer'? 'maintainer':'' , body, createdAt: new Date().toISOString() };
                      updateIssue(current.id, { comments: [...(current.comments||[]), c] });
                      e.currentTarget.value = "";
                    }
                  }} />
                  <span className="text-xs text-slate-400 self-center">Press Enter</span>
                </div>
              )}
            </div>
          </div>
        ); })()}
      </Modal>
      {/* Paste JSON modal */}
      <Modal open={pasteOpen} onClose={()=>setPasteOpen(false)}>
        <h3 className="text-lg font-semibold text-slate-100 mb-3">Paste JSON</h3>
        <TextArea rows={12} placeholder="Paste Issue[] or { issues: Issue[] } here…" id="paste-area" />
        <div className="mt-3 flex gap-2">
          <IconButton title="Load" onClick={()=>{
            const ta = document.getElementById("paste-area");
            if (ta && "value" in ta) handlePasteJSON(ta.value);
          }}>✅<span>Load</span></IconButton>
          <IconButton title="Cancel" onClick={()=>setPasteOpen(false)}>✖️<span>Cancel</span></IconButton>
        </div>
      </Modal>

      {/* URL modal */}
      <Modal open={urlOpen} onClose={()=>setUrlOpen(false)}>
        <h3 className="text-lg font-semibold text-slate-100 mb-3">Load JSON from URL</h3>
        <TextInput ref={urlInputRef} placeholder="https://example.com/issues.json" />
        <div className="mt-3 flex gap-2">
          <IconButton title="Fetch" onClick={handleFetchURL}>🔗<span>Fetch</span></IconButton>
          <IconButton title="Cancel" onClick={()=>setUrlOpen(false)}>✖️<span>Cancel</span></IconButton>
        </div>
      </Modal>

      <footer className="mt-10 pb-10 text-center text-xs text-slate-500">
        Built with ❤️ — everything stays in your browser.
      </footer>
    </div>
  );
}
