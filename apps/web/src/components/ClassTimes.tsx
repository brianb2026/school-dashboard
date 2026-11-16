import { useState } from "react";
import type { CourseView, Meeting } from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { hhmm, WEEKDAYS } from "../lib/format";
import { Panel } from "../panels/Panel";

/** When each class meets (read from syllabi; change them here), plus the deadline calendar file. */
export function ClassTimes() {
  const { d } = useDash();
  const anyTimes = d.courses.some((c) => c.meetings.length > 0);
  return (
    <Panel title="Class times" meta={anyTimes ? "read from your syllabi; change them here" : "add when each class meets"}>
      {d.courses.length === 0 && <p className="empty">No classes yet.</p>}
      {d.courses.map((c) => <Times key={c.id} c={c} />)}
      <p className="help pad-x" style={{ marginTop: 8 }}>
        Deadlines as a calendar: <a href="/calendar.ics" download="school-deadlines.ics">download the .ics file</a> for Google Calendar, or subscribe Apple Calendar on this Mac to{" "}
        <code>{window.location.origin}/calendar.ics</code> while the dashboard is running.
      </p>
    </Panel>
  );
}

function Times({ c }: { c: CourseView }) {
  const { reload } = useDash();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ days: [] as number[], start: "10:00", end: "10:50", location: "" });
  const a = useAction();
  const save = (meetings: Meeting[]) =>
    a.run(async () => {
      await api(`/api/courses/${enc(c.id)}`, { method: "PATCH", json: { meetings } });
      await reload();
    });
  return (
    <div className="row times-row">
      <span className="chip" style={{ color: "var(--text)" }}><span className="swatch" style={{ background: colorVar(c.color) }} />{c.code}</span>
      <div className="times">
        {c.meetings.length === 0 && !adding && <span className="faint">no times yet</span>}
        {c.meetings.map((m, i) => (
          <span key={i} className="tag time-tag">
            {WEEKDAYS[m.weekday]?.slice(0, 3)} {hhmm(m.start)}–{hhmm(m.end)}{m.location ? ` · ${m.location}` : ""}
            <button type="button" aria-label="Remove this time" onClick={() => void save(c.meetings.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
        {adding && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save([...c.meetings, ...f.days.map((weekday) => ({ weekday, start: f.start, end: f.end, location: f.location || undefined }))]).then(() => setAdding(false));
            }}
          >
            <span className="daypick" role="group" aria-label="Days">
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                <button key={wd} type="button" className={`btn ${f.days.includes(wd) ? "primary" : ""}`} aria-pressed={f.days.includes(wd)}
                  onClick={() => setF({ ...f, days: f.days.includes(wd) ? f.days.filter((x) => x !== wd) : [...f.days, wd] })}>
                  {WEEKDAYS[wd]!.slice(0, 2)}
                </button>
              ))}
            </span>
            <input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} aria-label="Starts" />
            <input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} aria-label="Ends" />
            <input placeholder="Room (optional)" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} aria-label="Room" style={{ width: 150, flex: "0 1 150px" }} />
            <button type="submit" className="btn primary" disabled={a.busy || f.days.length === 0}>Add</button>
          </form>
        )}
        <Feedback error={a.error} />
      </div>
      <button type="button" className="btn ghost" onClick={() => setAdding((x) => !x)}>{adding ? "Close" : "+ time"}</button>
    </div>
  );
}
