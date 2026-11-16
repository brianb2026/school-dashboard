import { API_VERSION, type DashboardData, type LinkStatus, type LinkTarget, type ViewName } from "@sd/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compose } from "./components/Compose";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon } from "./components/Icon";
import { LinkProgress } from "./components/LinkBlackboard";
import { PrepPack } from "./components/PrepPack";
import { Search } from "./components/Search";
import { SignIn } from "./components/SignIn";
import { ThemeMenu } from "./components/ThemeMenu";
import { Tour } from "./components/Tour";
import { usePref } from "./lib/prefs";
import { Viewer, type ViewFile } from "./components/Viewer";
import { api, useApi } from "./lib/api";
import { Dash, type ComposeDraft, type DashCtx, type Focus } from "./lib/dash";
import { ago } from "./lib/format";
import { Files } from "./views/Files";
import { Grades } from "./views/Grades";
import { Home } from "./views/Home";
import { Inbox } from "./views/Inbox";
import { Settings } from "./views/Settings";
import { Syllabi } from "./views/Syllabi";

const NOT_LINKED = { linked: false, expired: false };
/** Fill in link info an older server doesn't send (Canvas, SIS), and lists it may lack. */
function withLinkDefaults(d: DashboardData): DashboardData {
  const links = d.links ?? ({} as DashboardData["links"]);
  return {
    ...d,
    links: {
      ...links,
      blackboard: links.blackboard ?? NOT_LINKED,
      gradescope: links.gradescope ?? { ...NOT_LINKED, viaBlackboard: false },
      canvas: links.canvas ?? NOT_LINKED,
      sis: links.sis ?? NOT_LINKED,
      gmail: links.gmail ?? { connected: false, configured: false },
      calendar: links.calendar ?? { set: false },
    },
    notices: d.notices ?? [],
    changes: d.changes ?? [],
    files: d.files ?? [],
    announcements: d.announcements ?? [],
  };
}

/** Few tabs, most used first (Home is where nearly everything happens). */
const TABS: ViewName[] = ["Home", "Grades", "Inbox", "Files", "Settings"];
const ACTIVE = new Set(["opening", "waiting", "syncing"]);

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

export function App() {
  const [signedIn, setSignedIn] = useState(false);
  // Back to the sign-in screen from the top bar, with the profile list open.
  const [pickProfile, setPickProfile] = useState(false);
  const [view, setView] = useState<ViewName>("Home");
  const [focus, setFocusState] = useState<Focus>({ mode: "all" });
  // Loads behind the sign-in screen, so the dashboard is ready the moment you're in.
  const dash = useApi<DashboardData>("/api/dashboard");
  const [linkState, setLinkState] = useState<LinkStatus>({ phase: "idle" });
  const [draft, setDraft] = useState<ComposeDraft>();
  const [searching, setSearching] = useState(false);
  const [viewing, setViewing] = useState<ViewFile>();
  const [prepping, setPrepping] = useState<string>();
  const [syncBusy, setSyncBusy] = useState(false);
  const [toastMsg, setToast] = useState<Toast>();
  const [classPick, setClassPick] = useState<string>();
  const [classItem, setClassItem] = useState<string>();
  const tourDone = usePref("tour") === "done";
  const [touring, setTouring] = useState(false);
  // Link info a server too old to send counts as "not linked", so a page never breaks on it.
  const d = useMemo(() => (dash.data ? withLinkDefaults(dash.data) : undefined), [dash.data]);
  // An old server still running behind a newly built page: ask for a restart.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    void api<{ api?: number }>("/api/health")
      .then((h) => setStale(h.api !== API_VERSION))
      .catch(() => undefined);
  }, []);
  const { reload, mutate } = dash;

  // Stay current: every minute, when the tab regains focus, and quickly while a sync runs.
  useEffect(() => {
    if (!signedIn) return;
    const t = setInterval(() => void reload(), d?.syncing ? 2000 : 60_000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, d?.syncing, signedIn]);

  // The server sometimes starts a link by itself (Gradescope, right after Blackboard): notice it.
  useEffect(() => {
    if (!d || !signedIn || ACTIVE.has(linkState.phase)) return;
    let live = true;
    void api<LinkStatus>("/api/link/status")
      .then((st) => live && ACTIVE.has(st.phase) && setLinkState(st))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Re-check whenever fresh data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, signedIn]);

  // For a while after a link finishes, notice the next one the server starts by itself.
  const [watchUntil, setWatchUntil] = useState(0);
  const lastDone = useRef<string>();
  useEffect(() => {
    if (!signedIn || watchUntil < Date.now() || ACTIVE.has(linkState.phase)) return;
    const t = setInterval(() => {
      if (Date.now() > watchUntil) return clearInterval(t);
      void api<LinkStatus>("/api/link/status")
        .then((st) => {
          if (ACTIVE.has(st.phase)) setLinkState(st);
          // One that started and finished between two looks still brings new data.
          else if (st.phase === "done" && st.target && lastDone.current !== st.target) {
            lastDone.current = st.target;
            void reload();
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [signedIn, watchUntil, linkState.phase, reload]);

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
            // One sign-in can start another (Gradescope after Blackboard, the SIS after Canvas): keep an eye out.
            setWatchUntil(Date.now() + 30_000);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [linking, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && signedIn) {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedIn]);

  useEffect(() => {
    if (signedIn && d && !tourDone && view === "Home" && focus.mode === "all" && d.courses.length > 0) {
      const t = setTimeout(() => setTouring(true), 700);
      return () => clearTimeout(t);
    }
  }, [signedIn, d, tourDone, view, focus.mode]);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, undo });
    toastTimer.current = setTimeout(() => setToast(undefined), undo ? 6000 : 3500);
  }, []);

  // Opening or leaving a class morphs its card; picking a day just fades the rest (plain CSS).
  // A new tab or class starts at the top (unless it was opened to show one item).
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!classItem) mainRef.current?.scrollTo({ top: 0 });
  }, [view, focus.mode, classPick, classItem]);

  // A class (or one of its assignments) opens on the Grades tab; a day stays on Home.
  const setFocus = useCallback((f: Focus) => {
    if (f.mode === "class") {
      setClassPick(f.courseId);
      setClassItem(f.itemId);
      setView("Grades");
      return;
    }
    setFocusState(f);
    setView("Home");
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
    () =>
      d
        ? {
            d,
            reload,
            patch: mutate,
            go: (v) => {
              if (v === "Home") setFocusState({ mode: "all" });
              setView(v);
            },
            focus,
            setFocus,
            classPick,
            classItem,
            showClass: (id) => {
              setClassPick(id);
              setClassItem(undefined);
              setView("Grades");
            },
            link,
            compose: (x) => setDraft(x ?? {}),
            view: setViewing,
            prep: setPrepping,
            toast,
          }
        : undefined,
    [d, reload, mutate, focus, setFocus, classPick, classItem, link, toast],
  );

  const syncNow = async () => {
    setSyncBusy(true);
    try {
      await api("/api/sync", { method: "POST", json: {} });
    } catch {
      /* shown as "offline" below */
    }
    await reload();
    setSyncBusy(false);
  };

  if (!signedIn) return <SignIn showProfiles={pickProfile} onIn={() => {
    setSignedIn(true);
    setWatchUntil(Date.now() + 30_000);
    void reload();
  }} />;

  if (!d || !ctx) {
    return dash.error ? (
      <div className="boot">
        <b>Can't reach the dashboard.</b>
        <span className="muted">Start it with <code>npm start</code> (or double-click start.command), then reload this page.</span>
      </div>
    ) : (
      <HomeSkeleton />
    );
  }

  const unread = d.announcements.filter((a) => !a.read).length + d.messages.filter((m) => m.unread).length;
  const review = d.notices.some((n) => n.id === "syllabus-review");
  const counts: Partial<Record<ViewName, number>> = { Inbox: unread, Settings: d.unmatchedCount };
  const tabs: ViewName[] = view === "Syllabi" || review ? [...TABS.slice(0, 4), "Syllabi", "Settings"] : TABS;
  const busy = d.syncing || syncBusy;
  const firstDiffer = d.assignments.find((a) => a.scoresDiffer);
  // While a class is open, its page already shows what the "scores differ" note points at.
  const notices = d.notices.filter((n) => n.level === "warn");

  return (
    <Dash.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <button type="button" className="brand" onClick={() => ctx.go("Home")}>
            <span className="mark" aria-hidden /> Semester
          </button>
          <nav className="tabs" aria-label="Sections">
            {tabs.map((v) => (
              <button key={v} type="button" aria-current={v === view ? "page" : undefined} onClick={() => ctx.go(v)}>
                {v}
                {(counts[v] ?? 0) > 0 && <span className={`count ${v === "Settings" ? "warn" : ""}`}>{counts[v]}</span>}
                {v === "Syllabi" && review && <span className="count warn">!</span>}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <button className="search" type="button" onClick={() => setSearching(true)}>
            <Icon name="search" size={14} /> Search <span className="kbd">⌘K</span>
          </button>
          <ThemeMenu />
          <button
            type="button"
            className="icon-btn me-btn"
            onClick={() => {
              setPickProfile(true);
              setSignedIn(false);
            }}
            title="Switch profile"
            aria-label="Switch profile"
          >
            <span className="avatar xs" aria-hidden>
              {(d.studentName ?? "?").slice(0, 1).toUpperCase()}
            </span>
          </button>
          <button type="button" className="sync" onClick={() => void syncNow()} disabled={busy} title="Sync now">
            {busy ? <span className="spinner" aria-hidden /> : <span className={`dot ${dash.error ? "bad" : d.lastSyncAt ? "good" : ""}`} />}
            <span className="sync-text">{dash.error ? "offline" : busy ? "syncing…" : d.lastSyncAt ? `synced ${ago(d.lastSyncAt)}` : "not synced yet"}</span>
          </button>
        </header>

        <main ref={mainRef} className={`view-${view.toLowerCase()}`}>
          <LinkProgress status={linkState} onClose={() => setLinkState({ phase: "idle" })} />
          {notices.length > 0 && (
            <div className="notices">
              {notices.map((n) => (
                <div key={n.id} className={`notice ${n.level === "warn" ? "warn" : ""}`}>
                  <span>{n.text}</span>
                  {n.id === "scores-differ" && firstDiffer ? (
                    <button type="button" className="link" onClick={() => setFocus({ mode: "class", courseId: firstDiffer.courseId, itemId: firstDiffer.id })}>
                      Show me
                    </button>
                  ) : n.action ? (
                    n.action === "open-sis" ? (
                      d.links.sis.home && (
                        <a className="link" href={d.links.sis.home} target="_blank" rel="noreferrer noopener">
                          Open SIS
                        </a>
                      )
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={() => void link(n.action === "link-gradescope" ? "gradescope" : n.action === "link-canvas" ? "canvas" : n.action === "link-sis" ? "sis" : "blackboard")}
                      >
                        Reconnect
                      </button>
                    )
                  ) : (
                    n.view && n.view !== view && (
                      <button type="button" className="link" onClick={() => ctx.go(n.view!)}>
                        Open {n.view}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
          {stale && (
            <div className="notices">
              <div className="notice warn" role="status">
                <span>
                  The dashboard was updated, but the old version is still running behind this page. Restart it to finish: in its Terminal window press
                  Ctrl-C, then run <code>npm start</code> (or double-click start.command).
                </span>
              </div>
            </div>
          )}
          <div className="view" key={view}>
            <ErrorBoundary key={view}>
              {view === "Home" && <Home />}
              {view === "Grades" && <Grades />}
              {view === "Inbox" && <Inbox />}
              {view === "Files" && <Files />}
              {view === "Syllabi" && <Syllabi onChanged={() => void reload()} />}
              {view === "Settings" && <Settings />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {draft && <Compose draft={draft} onClose={() => setDraft(undefined)} />}
      {searching && <Search onClose={() => setSearching(false)} />}
      {prepping && <PrepPack examId={prepping} onClose={() => setPrepping(undefined)} />}
      {viewing && <Viewer file={viewing} onClose={() => setViewing(undefined)} />}
      {touring && !tourDone && <Tour name={d.studentName} onDone={() => setTouring(false)} />}
      {toastMsg && (
        <div className="toast" role="status" key={toastMsg.id}>
          <span>{toastMsg.text}</span>
          {toastMsg.undo && (
            <button
              type="button"
              className="link"
              onClick={() => {
                toastMsg.undo!();
                setToast(undefined);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </Dash.Provider>
  );
}

/** Shapes of the page while the first data arrives, so nothing jumps when it does. */
function HomeSkeleton() {
  return (
    <div className="shell" aria-busy="true" aria-label="Loading">
      <header className="topbar">
        <span className="brand">
          <span className="mark" aria-hidden /> Semester
        </span>
      </header>
      <main>
        <div className="home">
          <section className="classes">
            <span className="sk sk-h" />
            {[0, 1, 2].map((i) => (
              <span key={i} className="sk sk-card" />
            ))}
          </section>
          <aside className="workload">
            <span className="sk sk-cal" />
          </aside>
        </div>
      </main>
    </div>
  );
}
