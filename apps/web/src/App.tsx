import { gpa } from "@sd/core";
import { useState } from "react";
import { DueNext } from "./panels/DueNext";
import { GpaCard, Grades } from "./panels/Grades";
import { Inbox } from "./panels/Inbox";
import { Workload } from "./panels/Workload";
import * as sample from "./lib/sample";

const VIEWS = ["Today", "Assignments", "Grades", "Inbox", "Schedule", "Attendance", "Files", "Syllabi", "Settings"] as const;
type View = (typeof VIEWS)[number];

export function App() {
  const [view, setView] = useState<View>("Today");
  // TODO: fetch /api/dashboard; fall back to sample data until a source is connected.
  const g = gpa(
    sample.courses.map((c) => ({ letter: c.letter, credits: 3, level: "regular" as const })),
    { weightByCredits: true, points: { A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7 }, levelBonus: {} },
  )!;

  return (
    <div className="shell">
      <div className="topbar">
        <span className="brand">Semester</span>
        <span className="term">Spring 2027</span>
        <span className="spacer" />
        <button className="search" type="button">Search assignments, people, files <span className="kbd">⌘K</span></button>
        <span className="sync"><span className="dot" /> synced 4 min ago</span>
      </div>

      <nav className="rail" aria-label="Sections">
        {VIEWS.map((v) => (
          <button key={v} type="button" aria-current={v === view ? "page" : undefined} onClick={() => setView(v)}>
            {v}
            {v === "Inbox" && <span className="count">2</span>}
            {v === "Assignments" && <span className="count">7</span>}
          </button>
        ))}
        <h3>Courses</h3>
        {sample.courses.map((c) => (
          <div key={c.id} className="course-link">
            <span className="swatch" style={{ background: c.color }} /> {c.code}
          </div>
        ))}
      </nav>

      <main>
        <div className="banner">Sample data. Connect Blackboard or upload a syllabus in Settings to see your own.</div>
        {view === "Today" ? (
          <div className="grid">
            <DueNext due={sample.due} courses={sample.courses} />
            <Workload hours={sample.heat} conflicts={sample.conflictDays} />
            <Grades courses={sample.courses} />
            <GpaCard weighted={g.gpa} unweighted={g.unweighted} credits={g.credits} />
            <Inbox items={sample.inbox} courses={sample.courses} />
          </div>
        ) : (
          <p className="muted">{view} view: not built yet (see the roadmap in README.md).</p>
        )}
      </main>
    </div>
  );
}
