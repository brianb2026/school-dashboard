import { useState } from "react";
import type { CourseView, Meeting } from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { hhmm, localDate, WEEKDAYS } from "../lib/format";
import { Panel } from "../panels/Panel";

const dayHead = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function Schedule() {
  const { d } = useDash();
  const [offset, setOffset] = useState(0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7); // Monday of the shown week
  const days = Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return x;
  });
  const hasWeekend = d.courses.some((c) => c.meetings.some((m) => m.weekday === 0 || m.weekday === 6));
  const shown = days.filter((x) => hasWeekend || (x.getDay() !== 0 && x.getDay() !== 6) || d.assignments.some((a) => a.dueAt && localDate(new Date(a.dueAt)) === localDate(x) && !a.done));
  const today = localDate();
  const anyTimes = d.courses.some((c) => c.meetings.length > 0);

  return (
    <div className="stack wide">
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => setOffset(offset - 1)} aria-label="Previous week">←</button>
        <button type="button" className="btn" onClick={() => setOffset(0)} disabled={offset === 0}>This week</button>
        <button type="button" className="btn" onClick={() => setOffset(offset + 1)} aria-label="Next week">→</button>
        <span className="muted">{dayHead.format(days[0])} – {dayHead.format(days[6])}</span>
        <span className="spacer" />
        <a className="btn" href="/calendar.ics" download="school-deadlines.ics" title="Import this file into Google Calendar, or open it in Apple Calendar">Download deadlines (.ics)</a>
      </div>

      <div className="week" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((day) => {
          const key = localDate(day);
          const classes = d.courses
            .flatMap((c) => c.meetings.filter((m) => m.weekday === day.getDay()).map((m) => ({ c, m })))
            .sort((a, b) => a.m.start.localeCompare(b.m.start));
          const due = d.assignments.filter((a) => a.dueAt && localDate(new Date(a.dueAt)) === key).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
          return (
            <section key={key} className={`day-col ${key === today ? "today" : ""}`}>
              <h3>{dayHead.format(day)}</h3>
              {classes.map(({ c, m }) => (
                <div key={`${c.id}${m.start}`} className="slot" style={{ borderLeftColor: colorVar(c.color) }}>
                  <b>{c.code}</b>
                  <span className="num">{hhmm(m.start)}–{hhmm(m.end)}</span>
                  {m.location && <span className="faint">{m.location}</span>}
                </div>
              ))}
              {due.map((a) => {
                const c = d.courses.find((x) => x.id === a.courseId);
                return (
                  <div key={a.id} className={`slot due ${a.done ? "is-done" : ""}`} style={{ borderLeftColor: colorVar(c?.color) }}>
                    <span>{a.title}</span>
                    <span className="faint num">{c?.code ?? ""} · due {timeFmt.format(new Date(a.dueAt!))}</span>
                  </div>
                );
              })}
              {classes.length === 0 && due.length === 0 && <span className="faint nothing">–</span>}
            </section>
          );
        })}
      </div>

      <Panel title="Class times" meta={anyTimes ? "read from your syllabi; change them here" : "add when each class meets"}>
        {d.courses.length === 0 && <p className="empty">No classes yet.</p>}
        {d.courses.map((c) => <Times key={c.id} c={c} />)}
        <p className="help pad-x" style={{ marginTop: 8 }}>
          Apple Calendar on this Mac can also subscribe to <code>{window.location.origin}/calendar.ics</code> while the dashboard is running.
        </p>
      </Panel>
    </div>
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
