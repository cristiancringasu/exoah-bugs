import { useCallback, useEffect, useMemo, useRef, useState } from "react";
const API = (
  import.meta.env.VITE_BUGS_API_BASE ||
  (import.meta.env.DEV ? "http://127.0.0.1:33123" : "https://api.exotics.cafe")
).replace(/\/$/, "");
const statuses = ["Backlog", "Todo", "In Progress", "Done", "Archived"];
const priorities = ["P0", "P1", "P2", "P3"];
const tokenKey = "exoah-board-session";
const button =
  "rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:opacity-50";
const input =
  "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:outline-2 focus:outline-cyan-400 disabled:opacity-60";
async function api(path, options = {}) {
  const token = sessionStorage.getItem(tokenKey);
  const response = await fetch(`${API}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({
    error: "The server returned an unexpected response. Please try again.",
  }));
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem(tokenKey);
      window.dispatchEvent(new Event("board-session-expired"));
    }
    const messages = {
      invalid_credentials: "The account or password is incorrect.",
      otp_service_unavailable: "Discord sign-in is temporarily unavailable.",
      invalid_or_expired_session: "Your session expired. Sign in again.",
    };
    throw new Error(
      messages[data.error] ||
        data.error ||
        "The request could not be completed.",
    );
  }
  return data;
}
function download(issues) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ issues }, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "exoah-issues.json";
  link.click();
  URL.revokeObjectURL(url);
}
function normalize(value) {
  const list = Array.isArray(value)
    ? value
    : value.issues || value.items || value.bugs;
  if (!Array.isArray(list) || list.length > 500)
    throw new Error("Provide a JSON list of up to 500 issues.");
  return list.map((issue, index) => ({
    id: String(issue.id || `ISSUE-${index + 1}`),
    title: String(issue.title || issue.summary || "Untitled"),
    description: String(issue.description || ""),
    status: String(issue.status || "Backlog"),
    priority: priorities.includes(issue.priority) ? issue.priority : "P2",
    assignee: String(issue.assignee || ""),
    tags: Array.isArray(issue.tags) ? issue.tags.map(String) : [],
    comments: Array.isArray(issue.comments) ? issue.comments : [],
    createdAt: issue.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByVisitor: issue.createdByVisitor === true,
  }));
}
function Modal({ open, title, onClose, children, error }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[88vh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl backdrop:bg-black/70"
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          className={button}
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-700 p-3 text-red-200"
        >
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-300">
      {label}
      {children}
    </label>
  );
}
export default function App() {
  const [issues, setIssues] = useState([]);
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("priority");
  const [rawOpen, setRawOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [importURL, setImportURL] = useState("");
  const [comment, setComment] = useState("");
  const importRef = useRef(null);
  const admin = Boolean(account?.admin);
  useEffect(() => {
    const expire = () => setAccount(null);
    window.addEventListener("board-session-expired", expire);
    return () => window.removeEventListener("board-session-expired", expire);
  }, []);
  const load = useCallback(async (visible = true) => {
    if (visible) setLoading(true);
    try {
      const data = await api("/bugsapi");
      setIssues(data.issues);
      setRevision(data.revision);
      setError("");
    } catch (failure) {
      setError(
        failure.message || "The board could not be reached. Please try again.",
      );
    } finally {
      if (visible) setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    if (sessionStorage.getItem(tokenKey))
      api("/auth/validate")
        .then((user) => {
          if (user.admin) setAccount(user);
          else sessionStorage.removeItem(tokenKey);
        })
        .catch(() => sessionStorage.removeItem(tokenKey));
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!selected && !rawOpen && !saving) load(false);
    }, 30000);
    return () => clearInterval(timer);
  }, [load, selected, rawOpen, saving]);
  async function save(next) {
    if (!admin || saving) return false;
    setSaving(true);
    setError("");
    try {
      const result = await api("/bugsapi", {
        method: "PUT",
        headers: { "If-Match": revision },
        body: JSON.stringify({ issues: next }),
      });
      setIssues(result.issues);
      setRevision(result.revision);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const tagQuery = tag.trim().toLowerCase();
    return issues
      .filter(
        (issue) =>
          (!query ||
            `${issue.title} ${issue.description} ${issue.priority || ""}`
              .toLowerCase()
              .includes(query)) &&
          (!tagQuery ||
            issue.tags?.some((value) =>
              value.toLowerCase().includes(tagQuery),
            )),
      )
      .sort((a, b) =>
        sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "createdAt"
            ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
            : (priorities.indexOf(a.priority) < 0
                ? 99
                : priorities.indexOf(a.priority)) -
              (priorities.indexOf(b.priority) < 0
                ? 99
                : priorities.indexOf(b.priority)),
      );
  }, [issues, search, tag, sort]);
  const columns = [
    ...new Set([...statuses, ...issues.map((issue) => issue.status)]),
  ];
  function edit(patch) {
    setSelected((previous) => ({
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  }
  function newIssue() {
    setIsNew(true);
    setComment("");
    setSelected({
      id: `ISSUE-${crypto.randomUUID()}`,
      title: "",
      description: "",
      status: "Backlog",
      priority: "P2",
      assignee: "",
      tags: [],
      comments: [],
      createdAt: new Date().toISOString(),
      createdByVisitor: !admin,
    });
  }
  async function saveIssue(event) {
    event.preventDefault();
    if (!selected.title.trim() || saving) return;
    if (admin) {
      const next = isNew
        ? [selected, ...issues]
        : issues.map((issue) => (issue.id === selected.id ? selected : issue));
      if (await save(next)) setSelected(null);
    } else if (isNew) {
      setSaving(true);
      setError("");
      try {
        await api("/bugsapi", {
          method: "POST",
          body: JSON.stringify({
            title: selected.title,
            description: selected.description,
          }),
        });
        setSelected(null);
        await load(false);
      } catch (failure) {
        setError(failure.message);
      } finally {
        setSaving(false);
      }
    }
  }
  async function signIn(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      if (!result.admin)
        throw new Error(
          "This account does not have board administration access.",
        );
      sessionStorage.setItem(tokenKey, result.token);
      setAccount(result);
      setLoginOpen(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  async function importJSON(text) {
    try {
      if (text.length > 1000000)
        throw new Error("The import must be smaller than 1 MB.");
      const incoming = normalize(JSON.parse(text));
      const ids = new Set(issues.map((issue) => issue.id));
      await save([
        ...issues,
        ...incoming.filter((issue) => !ids.has(issue.id)),
      ]);
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function importFromURL() {
    try {
      const url = new URL(importURL);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Enter a public HTTP or HTTPS JSON URL.");
      const response = await fetch(url, {
        credentials: "omit",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("That URL could not be loaded.");
      await importJSON(await response.text());
    } catch (failure) {
      setError(failure.message);
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6">
          <div>
            <h1 className="text-3xl font-bold">Exotics Café Bugs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Track and review website issues.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={newIssue}
              disabled={loading || saving}
            >
              New report
            </button>
            <button className={button} onClick={() => download(issues)}>
              Export JSON
            </button>
            {admin ? (
              <>
                <button
                  className={button}
                  onClick={() => {
                    setRaw(JSON.stringify({ issues }, null, 2));
                    setRawOpen(true);
                  }}
                >
                  Import / edit JSON
                </button>
                <button
                  className={button}
                  onClick={() => {
                    sessionStorage.removeItem(tokenKey);
                    setAccount(null);
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button className={button} onClick={() => setLoginOpen(true)}>
                Maintainer sign in
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-700 bg-red-950/40 p-4"
          >
            <span>{error}</span>
            <button className={button} onClick={() => load()}>
              Refresh board
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search issues">
            <input
              className={input}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Filter tags">
            <input
              className={input}
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            />
          </Field>
          <Field label="Sort">
            <select
              className={input}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="priority">Priority</option>
              <option value="createdAt">Newest first</option>
              <option value="title">Title</option>
            </select>
          </Field>
          <p role="status" className="pb-2 text-sm text-slate-400">
            {loading
              ? "Loading reports…"
              : saving
                ? "Saving…"
                : `${visible.length} reports`}
          </p>
        </div>
        {!loading && !issues.length && !error && (
          <p className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">
            No reports yet. Use New report to add one.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {columns.map((status) => (
            <section
              key={status}
              aria-label={status}
              onDragOver={(event) => {
                if (admin) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!admin || saving) return;
                const id = event.dataTransfer.getData("text/issue-id");
                if (id)
                  save(
                    issues.map((issue) =>
                      issue.id === id ? { ...issue, status } : issue,
                    ),
                  );
              }}
              className="min-h-40 rounded-xl border border-slate-800 bg-slate-900/50 p-3"
            >
              <h2 className="mb-4 flex justify-between gap-2 font-semibold">
                {status}
                <span className="text-slate-400">
                  {visible.filter((issue) => issue.status === status).length}
                </span>
              </h2>
              <div className="space-y-3">
                {visible
                  .filter((issue) => issue.status === status)
                  .map((issue) => (
                    <button
                      key={issue.id}
                      draggable={admin && !saving}
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/issue-id", issue.id)
                      }
                      onClick={() => {
                        setIsNew(false);
                        setComment("");
                        setSelected(structuredClone(issue));
                      }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-left hover:border-cyan-500 focus-visible:outline-2 focus-visible:outline-cyan-400"
                    >
                      <span className="flex items-start justify-between gap-2 font-semibold">
                        <span className="break-words">{issue.title}</span>
                        <span className="text-xs text-cyan-300">
                          {issue.priority}
                        </span>
                      </span>
                      <span className="mt-2 block line-clamp-3 text-sm text-slate-300">
                        {issue.description}
                      </span>
                      <span className="mt-3 flex flex-wrap gap-1">
                        {issue.tags?.map((value) => (
                          <span
                            key={value}
                            className="rounded bg-slate-700 px-1.5 py-0.5 text-xs"
                          >
                            {value}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <Modal
        error={error}
        open={Boolean(selected)}
        title={
          isNew ? "New issue report" : admin ? "Edit issue" : "Issue details"
        }
        onClose={() => {
          if (!saving) setSelected(null);
        }}
      >
        {selected && (
          <form onSubmit={saveIssue} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title">
                <input
                  className={input}
                  required
                  maxLength={200}
                  disabled={!admin && !isNew}
                  value={selected.title}
                  onChange={(event) => edit({ title: event.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  className={input}
                  rows={5}
                  maxLength={10000}
                  disabled={!admin && !isNew}
                  value={selected.description}
                  onChange={(event) =>
                    edit({ description: event.target.value })
                  }
                />
              </Field>
            </div>
            {admin && (
              <>
                <Field label="Status">
                  <select
                    className={input}
                    value={selected.status}
                    onChange={(event) => edit({ status: event.target.value })}
                  >
                    {columns.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    className={input}
                    value={selected.priority || "P2"}
                    onChange={(event) => edit({ priority: event.target.value })}
                  >
                    {priorities.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Assignee">
                  <input
                    className={input}
                    maxLength={100}
                    value={selected.assignee}
                    onChange={(event) => edit({ assignee: event.target.value })}
                  />
                </Field>
                <Field label="Tags, separated by commas">
                  <input
                    className={input}
                    value={selected.tagsRaw ?? selected.tags.join(", ")}
                    onChange={(event) =>
                      edit({
                        tagsRaw: event.target.value,
                        tags: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
              </>
            )}
            <div className="space-y-2 sm:col-span-2">
              <h3 className="font-semibold">Comments</h3>
              {selected.comments?.map((value) => (
                <div key={value.id} className="rounded-lg bg-slate-800 p-3">
                  <p className="text-xs text-slate-400">
                    {value.author || "Maintainer"} ·{" "}
                    {new Date(value.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {value.body}
                  </p>
                </div>
              ))}
              {admin && (
                <div className="flex gap-2">
                  <input
                    aria-label="New comment"
                    className={input}
                    value={comment}
                    maxLength={5000}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      if (comment.trim()) {
                        edit({
                          comments: [
                            ...selected.comments,
                            {
                              id: crypto.randomUUID(),
                              author: account.name || "Maintainer",
                              body: comment.trim(),
                              createdAt: new Date().toISOString(),
                            },
                          ],
                        });
                        setComment("");
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-400 sm:col-span-2">
              Reports appear on the shared board.
            </p>
            {(admin || isNew) && (
              <div className="flex gap-2 sm:col-span-2">
                <button className={button} disabled={saving}>
                  {saving ? "Saving…" : "Save report"}
                </button>
                {admin && !isNew && (
                  <button
                    type="button"
                    className={button}
                    disabled={saving}
                    onClick={async () => {
                      if (
                        confirm("Delete this issue from the shared board?") &&
                        (await save(
                          issues.filter((issue) => issue.id !== selected.id),
                        ))
                      )
                        setSelected(null);
                    }}
                  >
                    Delete issue
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </Modal>
      <Modal
        error={error}
        open={loginOpen}
        title="Maintainer sign in"
        onClose={() => setLoginOpen(false)}
      >
        <form onSubmit={signIn} className="space-y-4">
          <Field label="Administrator username">
            <input
              name="username"
              className={input}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password or Discord code">
            <input
              name="password"
              className={input}
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <button className={button} disabled={saving}>
            Sign in
          </button>
        </form>
      </Modal>
      <Modal
        error={error}
        open={rawOpen && admin}
        title="Import or edit issue JSON"
        onClose={() => {
          if (!saving) setRawOpen(false);
        }}
      >
        <div className="space-y-4">
          <Field label="Issue JSON">
            <textarea
              className={`${input} font-mono text-xs`}
              rows={14}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={saving}
              onClick={async () => {
                try {
                  if (await save(normalize(JSON.parse(raw)))) setRawOpen(false);
                } catch (failure) {
                  setError(failure.message);
                }
              }}
            >
              Apply JSON
            </button>
            <button
              className={button}
              onClick={() => {
                try {
                  setRaw(JSON.stringify(JSON.parse(raw), null, 2));
                } catch {
                  setError("The JSON is not valid.");
                }
              }}
            >
              Format JSON
            </button>
            <button
              className={button}
              onClick={() => importRef.current.click()}
            >
              Import file
            </button>
            <input
              type="file"
              aria-label="Import JSON file"
              accept="application/json"
              hidden
              ref={importRef}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) await importJSON(await file.text());
                event.target.value = "";
              }}
            />
          </div>
          <Field label="Import from a public JSON URL">
            <input
              className={input}
              type="url"
              value={importURL}
              onChange={(event) => setImportURL(event.target.value)}
            />
          </Field>
          <button className={button} disabled={saving} onClick={importFromURL}>
            Import URL
          </button>
        </div>
      </Modal>
    </div>
  );
}
