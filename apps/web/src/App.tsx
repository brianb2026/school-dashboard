import type { DashboardData, LinkStatus, LinkTarget, ViewName } from "@sd/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Compose } from "./components/Compose";
import { LinkProgress } from "./components/LinkBlackboard";
import { Search } from "./components/Search";
import { api, colorVar, useApi } from "./lib/api";
import { Dash, type ComposeDraft, type DashCtx } from "./lib/dash";
import { ago } from "./lib/format";
import { Assignments } from "./views/Assignments";
import { Attendance } from "./views/Attendance";
import { Files } from "./views/Files";
import { Grades } from "./views/Grades";
import { Inbox } from "./views/Inbox";
import { Schedule } from "./views/Schedule";
import { Settings } from "./views/Settings";
import { Syllabi } from "./views/Syllabi";
import { Today } from "./views/Today";

const VIEWS: ViewName[] = ["Today", "Assignments", "Grades", "Inbox", "Schedule", "Attendance", "Files", "Syllabi", "Settings"];
const ACTIVE = new Set(["opening", "waiting", "syncing"]);

export function App() {
  const [view, setView] = useState<ViewName>("Today");
  const dash = useApi<DashboardData>("/api/dashboard");
  const [linkState, setLinkState] = useState<LinkStatus>({ phase: "idle" });
  const [draft, setDraft] = useState<ComposeDraft>();
  const [searching, setSearching] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const d = dash.data;
  const { reload } = dash;

  // Stay current: every minute, when the tab regains focus, and quickly while a sync runs.
  useEffect(() => {
    const t = setInterval(() => void reload(), d?.syncing ? 2000 : 60_000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, d?.syncing]);

  // Follow a sign-in in progress.
  const linking = ACTIVE.has(linkState.phase);
  useEffect(() => {
    if (!linking) return;
    const t = setInterval(() => {
      void api<LinkStatus>("/api/link/status")
        .then(async (s) => {
          setLinkState(s);
          if (s.phase === "syncing") void reload();
          if (s.phase === "done") {
            await reload();
            setView("Today");
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [linking, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const link = useCallback(async (target: LinkTarget, baseUrl?: string) => {
    setLinkState({ target, phase: "opening", message: "Opening the sign-in window…" });
    try {
      const r = await api<LinkStatus | { openUrl: string }>(`/api/link/${target}`, { method: "POST", json: baseUrl ? { baseUrl } : {} });
      if ("openUrl" in r) {
        // Official API: approval happens on the school's page in a new tab.
        window.open(r.openUrl, "_blank", "noopener");
        setLinkState({ target, phase: "error", message: "Approve access in the tab that just opened, then come back here." });
      } else setLinkState(r);
    } catch (e) {
      setLinkState({ target, phase: "error", message: (e as Error).message });
    }
  }, []);

  const ctx = useMemo<DashCtx | undefined>(
    () => (d ? { d, reload, go: setView, link, compose: (x) => setDraft(x ?? {}) } : undefined),
    [d, reload, link],
  );

  const syncNow = async () => {
    setSyncBusy(true);
    try {
      await api("/api/sync", { method: "POST", json: {} });
    } catch {
      /* shown as "server offline" below */
    }
    await reload();
    setSyncBusy(false);
  };

  if (!d || !ctx) {
    return (
      <div className="boot">
        {dash.error ? (
          <>
            <b>Can't reach the dashboard server.</b>
            <span className="muted">Start it with <code>npm start</code> (or double-click start.command), then reload this page.</span>
          </>
        ) : (
          <span className="muted">Loading…</span>
        )}
      </div>
    );
  }

  const unread = d.announcements.filter((a) => !a.read).length + d.messages.filter((m) => m.unread).length;
  const open = d.assignments.filter((a) => !a.done && a.dueAt && Date.parse(a.dueAt) - Date.now() < 7 * 86_400_000 && Date.parse(a.dueAt) > Date.now() - 14 * 86_400_000).length;
  const review = d.notices.some((n) => n.id === "syllabus-review");
  const counts: Partial<Record<ViewName, number>> = { Assignments: open, Inbox: unread, Settings: d.unmatchedCount };
  const busy = d.syncing || syncBusy;

  return (
    <Dash.Provider value={ctx}>
      <div className="shell">
        <div className="topbar">
          <span className="brand">Semester</span>
          <span className="term">{d.term.name}</span>
          <span className="spacer" />
          <button className="search" type="button" onClick={() => setSearching(true)}>
            Search assignments, people, files <span className="kbd">⌘K</span>
          </button>
          <button type="button" className="sync" onClick={() => void syncNow()} disabled={busy} title="Sync now">
            {busy ? <span className="spinner" aria-hidden /> : <span className="dot" style={{ background: dash.error ? "var(--danger)" : d.lastSyncAt ? "var(--ok)" : "var(--text-faint)" }} />}
            {dash.error ? "server offline" : busy ? "syncing…" : d.lastSyncAt ? `synced ${ago(d.lastSyncAt)}` : "not synced yet"}
          </button>
        </div>

        <nav className="rail" aria-label="Sections">
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-current={v === view ? "page" : undefined} onClick={() => setView(v)}>
              {v}
              {(counts[v] ?? 0) > 0 && <span className={`count ${v === "Settings" ? "warn-text" : ""}`}>{counts[v]}</span>}
              {v === "Syllabi" && review && <span className="count warn-text">!</span>}
            </button>
          ))}
          <h3>Courses</h3>
          {d.courses.length === 0 && <div className="course-link faint">none yet</div>}
          {d.courses.map((c) => (
            <button key={c.id} type="button" className="course-link" onClick={() => setView("Grades")} title={c.name}>
              <span className="swatch" style={{ background: colorVar(c.color) }} /> {c.code}
              {c.grade.letter && <span className="count">{c.grade.letter}</span>}
            </button>
          ))}
        </nav>

        <main>
          <LinkProgress status={linkState} onClose={() => setLinkState({ phase: "idle" })} />
          {d.notices.map((n) => (
            <div key={n.id} className={`notice ${n.level === "warn" ? "warn" : ""}`}>
              {n.text}{" "}
              {n.action ? (
                <button type="button" className="link" onClick={() => void link(n.action === "link-gradescope" ? "gradescope" : "blackboard")}>Reconnect</button>
              ) : (
                n.view && n.view !== view && <button type="button" className="link" onClick={() => setView(n.view!)}>Open {n.view}</button>
              )}
            </div>
          ))}
          {view === "Today" && <Today />}
          {view === "Assignments" && <Assignments />}
          {view === "Grades" && <Grades />}
          {view === "Inbox" && <Inbox />}
          {view === "Schedule" && <Schedule />}
          {view === "Attendance" && <Attendance />}
          {view === "Files" && <Files />}
          {view === "Syllabi" && <Syllabi onChanged={() => void reload()} />}
          {view === "Settings" && <Settings />}
        </main>
      </div>
      {draft && <Compose draft={draft} onClose={() => setDraft(undefined)} />}
      {searching && <Search onClose={() => setSearching(false)} />}
    </Dash.Provider>
  );
}
