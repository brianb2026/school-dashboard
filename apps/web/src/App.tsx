import type { DashboardData } from "@sd/core";
import { useMemo, useState } from "react";
import { colorVar, useApi } from "./lib/api";
import { liveToday } from "./lib/live";
import { sampleToday } from "./lib/sample";
import { Settings } from "./views/Settings";
import { Syllabi } from "./views/Syllabi";
import { Today } from "./views/Today";

const VIEWS = ["Today", "Assignments", "Grades", "Inbox", "Schedule", "Attendance", "Files", "Syllabi", "Settings"] as const;
type View = (typeof VIEWS)[number];
const BUILT: View[] = ["Today", "Syllabi", "Settings"];

function syncedAgo(iso?: string): string {
  if (!iso) return "not synced yet";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "synced just now";
  if (min < 60) return `synced ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `synced ${h} h ago` : `synced ${new Date(iso).toLocaleDateString()}`;
}

export function App() {
  const [view, setView] = useState<View>("Today");
  const dash = useApi<DashboardData>("/api/dashboard");
  const live = Boolean(dash.data?.hasData);
  const model = useMemo(() => (dash.data?.hasData ? liveToday(dash.data) : sampleToday()), [dash.data]);
  const offline = Boolean(dash.error);

  return (
    <div className="shell">
      <div className="topbar">
        <span className="brand">Semester</span>
        <span className="term">{dash.data?.term.name ?? ""}</span>
        <span className="spacer" />
        <button className="search" type="button" disabled title="Search arrives in v0.4">Search assignments, people, files <span className="kbd">⌘K</span></button>
        <span className="sync">
          <span className="dot" style={{ background: offline ? "var(--danger)" : live ? "var(--ok)" : "var(--text-faint)" }} />
          {offline ? "server offline" : syncedAgo(dash.data?.lastSyncAt)}
        </span>
      </div>

      <nav className="rail" aria-label="Sections">
        {VIEWS.map((v) => (
          <button key={v} type="button" aria-current={v === view ? "page" : undefined} onClick={() => setView(v)} className={BUILT.includes(v) ? "" : "soon"}>
            {v}
            {v === "Assignments" && live && model.due.length > 0 && <span className="count">{model.due.length}</span>}
            {v === "Settings" && live && (dash.data?.unmatchedCount ?? 0) > 0 && <span className="count warn-text">{dash.data!.unmatchedCount}</span>}
          </button>
        ))}
        <h3>Courses</h3>
        {/* Sample courses only ever appear inside the Today view's sample panels, never here. */}
        {!live && <div className="course-link faint">none yet</div>}
        {live && model.rail.map((c) => (
          <div key={c.id} className="course-link">
            <span className="swatch" style={{ background: colorVar(c.color) }} /> {c.code}
          </div>
        ))}
      </nav>

      <main>
        {view === "Today" && !dash.data && !dash.error && <p className="muted">Loading…</p>}
        {view === "Today" && (dash.data || dash.error) && (
          <>
            {offline ? (
              <div className="notice warn">{dash.error} Showing sample data.</div>
            ) : (
              !live && (
                <div className="banner">
                  Sample data. Paste your Blackboard calendar link in{" "}
                  <button type="button" className="link" onClick={() => setView("Settings")}>Settings</button> or{" "}
                  <button type="button" className="link" onClick={() => setView("Syllabi")}>upload a syllabus</button> to see your own.
                </div>
              )
            )}
            <Today model={model} live={live} unmatched={dash.data?.unmatchedCount ?? 0} goTo={setView} />
          </>
        )}
        {view === "Settings" && <Settings onChanged={() => void dash.reload()} />}
        {view === "Syllabi" && <Syllabi onChanged={() => void dash.reload()} />}
        {!BUILT.includes(view) && <p className="muted">{view}: coming in a later version (see the roadmap in README.md).</p>}
      </main>
    </div>
  );
}
