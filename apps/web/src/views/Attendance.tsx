import { useState } from "react";
import type { AttendanceStatus, CourseView } from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { localDate, pct } from "../lib/format";
import { Panel } from "../panels/Panel";

const MARKS: AttendanceStatus[] = ["present", "late", "absent", "excused"];
const SOURCE: Record<string, string> = { qwickly: "from Qwickly, via the Blackboard gradebook", manual: "from your own log", "blackboard-session": "from Blackboard", "blackboard-rest": "from Blackboard" };

export function Attendance() {
  const { d } = useDash();
  const [date, setDate] = useState(localDate());
  if (d.courses.length === 0) return <p className="empty">No classes yet.</p>;
  return (
    <div className="stack wide">
      <div className="toolbar">
        <label className="mini">Log for <input type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} aria-label="Date to log" style={{ width: 150 }} /></label>
        <span className="faint" style={{ fontSize: 12 }}>
          Attendance your instructor records in Qwickly shows up by itself when it's synced to Blackboard grades. For other classes, tap once after class.
        </span>
      </div>
      <Panel title="Attendance" meta={d.term.name}>
        {d.courses.map((c) => <Row key={c.id} c={c} date={date} />)}
      </Panel>
    </div>
  );
}

function Row({ c, date }: { c: CourseView; date: string }) {
  const { d, reload } = useDash();
  const a = useAction();
  const mine = d.attendance.filter((r) => r.courseId === c.id && r.source.source === "manual");
  const marked = mine.find((r) => r.date === date)?.status;
  const att = c.attendance;
  const mark = (status: AttendanceStatus) =>
    a.run(async () => {
      if (marked === status) await api(`/api/attendance?courseId=${enc(c.id)}&date=${enc(date)}`, { method: "DELETE" });
      else await api("/api/attendance", { method: "POST", json: { courseId: c.id, date, status } });
      await reload();
    });
  return (
    <div className="row att-row">
      <span className="chip" style={{ color: "var(--text)", fontSize: 14 }}>
        <span className="swatch" style={{ background: colorVar(c.color) }} />
        {c.code} <span className="faint">{c.name}</span>
      </span>
      <span className="num big-ish">{att?.percent !== undefined ? pct(att.percent, 0) : "–"}</span>
      <span className="faint" style={{ fontSize: 12 }}>{att ? `${att.label} · ${SOURCE[att.source.source] ?? ""}` : "nothing recorded yet"}</span>
      <span className="marks" role="group" aria-label={`${c.code} on ${date}`}>
        {MARKS.map((m) => (
          <button key={m} type="button" className={`btn ${marked === m ? "primary" : ""}`} aria-pressed={marked === m} disabled={a.busy} onClick={() => void mark(m)}>
            {m}
          </button>
        ))}
      </span>
      {mine.length > 0 && (
        <span className="faint att-log">
          your log: {mine.slice(0, 8).map((r) => `${r.date.slice(5)} ${r.status}`).join(" · ")}
          {mine.length > 8 ? ` · +${mine.length - 8} more` : ""}
        </span>
      )}
      <Feedback error={a.error} />
    </div>
  );
}
