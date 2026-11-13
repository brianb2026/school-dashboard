import { useState } from "react";
import type { AssignmentKind, AssignmentView } from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { courseMap, Feedback, useAction, useDash } from "../lib/dash";
import { daysFromNow, localDate, relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

const KINDS: AssignmentKind[] = ["homework", "quiz", "exam", "project", "paper", "lab", "discussion", "reading", "other"];

function group(a: AssignmentView): string {
  if (a.done) return "Done";
  if (a.late) return "Overdue";
  if (!a.dueAt) return "No date";
  const days = daysFromNow(a.dueAt);
  if (days < 0) return "Past";
  if (days === 0) return "Today";
  if (days <= 7) return "Next 7 days";
  return "Later";
}
const ORDER = ["Overdue", "Today", "Next 7 days", "Later", "No date", "Past", "Done"];

export function Assignments() {
  const { d, reload } = useDash();
  const cm = courseMap(d);
  const [course, setCourse] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = d.assignments.filter((a) => !course || a.courseId === course);
  const groups = new Map<string, AssignmentView[]>();
  for (const a of list) groups.set(group(a), [...(groups.get(group(a)) ?? []), a]);
  const doneCount = groups.get("Done")?.length ?? 0;

  return (
    <div className="stack wide">
      <div className="toolbar">
        <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {d.courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done ({doneCount})</label>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setAdding((x) => !x)} disabled={d.courses.length === 0}>{adding ? "Close" : "+ Add assignment"}</button>
      </div>
      {adding && <AddForm onDone={() => setAdding(false)} defaultCourse={course || d.courses[0]?.id || ""} />}
      {list.length === 0 && <p className="empty">Nothing here yet. Link Blackboard or upload a syllabus and assignments appear by themselves.</p>}
      {ORDER.filter((g) => groups.has(g) && (g !== "Done" || showDone)).map((g) => (
        <Panel key={g} title={g} meta={`${groups.get(g)!.length}`}>
          {(g === "Done" || g === "Past" ? [...groups.get(g)!].reverse() : groups.get(g)!).map((a) => (
            <Row key={a.id} a={a} code={cm.get(a.courseId)?.code} color={cm.get(a.courseId)?.color} onChanged={reload} />
          ))}
        </Panel>
      ))}
    </div>
  );
}

function Row({ a, code, color, onChanged }: { a: AssignmentView; code?: string; color?: string; onChanged: () => Promise<void> }) {
  const [scoring, setScoring] = useState(false);
  const [score, setScore] = useState("");
  const [possible, setPossible] = useState(a.pointsPossible ? String(a.pointsPossible) : "");
  const act = useAction();
  const patch = (body: object) =>
    act.run(async () => {
      await api(`/api/assignments/${enc(a.id)}`, { method: "PATCH", json: body });
      await onChanged();
    });
  const sourceDone = a.done && !a.userDone;
  return (
    <div className={`row asg-row ${a.done ? "is-done" : ""}`}>
      <input
        type="checkbox"
        checked={a.done}
        disabled={sourceDone || act.busy}
        onChange={(e) => void patch({ done: e.target.checked })}
        aria-label={`${a.title} done`}
        title={sourceDone ? `Marked done by ${a.origin}` : "Mark done"}
      />
      <div className="asg-main">
        {a.url ? <a href={a.url} target="_blank" rel="noreferrer noopener">{a.title}</a> : <span>{a.title}</span>}
        <span className="faint asg-sub">
          {a.dueAt ? relativeDue(a.dueAt) : "no due date"} · {a.origin}
          {a.categoryResolved ? ` · ${a.categoryResolved}` : ""}
        </span>
      </div>
      <span className="chip"><span className="swatch" style={{ background: colorVar(color) }} />{code ?? "Unmatched"}</span>
      {a.late ? <span className="tag danger">late</span> : <span className="tag">{a.kind}</span>}
      <span className="asg-score num">
        {a.score !== undefined ? (
          <button type="button" className="link plain" onClick={() => setScoring((x) => !x)} title={a.scoreIsYours ? "Your own entry. Click to change." : "Click to enter your own score"}>
            {a.score}/{a.possible}{a.scoreIsYours ? "*" : ""}
          </button>
        ) : (
          <button type="button" className="link faint-link" onClick={() => setScoring((x) => !x)}>+ score</button>
        )}
      </span>
      <span className="asg-menu">
        {a.manual ? (
          <button type="button" className="btn ghost" title="Delete" aria-label={`Delete ${a.title}`}
            onClick={() => confirm(`Delete “${a.title}”?`) && void act.run(async () => { await api(`/api/assignments/${enc(a.id)}`, { method: "DELETE" }); await onChanged(); })}>✕</button>
        ) : (
          <button type="button" className="btn ghost" title="Hide this item" aria-label={`Hide ${a.title}`}
            onClick={() => confirm(`Hide “${a.title}”? It stays in Blackboard; it just won't show here.`) && void patch({ hidden: true })}>✕</button>
        )}
      </span>
      {scoring && (
        <form
          className="inline-form asg-extra"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(async () => {
              await api(`/api/grades/${enc(a.id)}`, { method: "PUT", json: { score: Number(score), pointsPossible: Number(possible) } });
              setScoring(false);
              await onChanged();
            });
          }}
        >
          <input type="number" step="any" min={0} placeholder="score" value={score} onChange={(e) => setScore(e.target.value)} aria-label="Score" style={{ width: 90 }} autoFocus />
          <span className="faint">out of</span>
          <input type="number" step="any" min={0} placeholder="points" value={possible} onChange={(e) => setPossible(e.target.value)} aria-label="Out of" style={{ width: 90 }} />
          <button type="submit" className="btn primary" disabled={act.busy || score === "" || possible === ""}>Save score</button>
          {a.scoreIsYours && (
            <button type="button" className="btn" onClick={() => void act.run(async () => { await api(`/api/grades/${enc(a.id)}`, { method: "DELETE" }); setScoring(false); await onChanged(); })}>
              Remove my score
            </button>
          )}
          <label className="mini" title="Your guess, used by the workload heatmap">
            effort
            <input type="number" min={0} max={100} step={0.5} defaultValue={a.effortHours ?? ""} placeholder="h" style={{ width: 60 }}
              onBlur={(e) => e.target.value !== String(a.effortHours ?? "") && void patch({ effortHours: e.target.value === "" ? null : Number(e.target.value) })} />
            h
          </label>
        </form>
      )}
      {act.error && <p className="form-msg error asg-extra">{act.error}</p>}
    </div>
  );
}

function AddForm({ onDone, defaultCourse }: { onDone: () => void; defaultCourse: string }) {
  const { d, reload } = useDash();
  const [f, setF] = useState({ courseId: defaultCourse, title: "", kind: "homework" as AssignmentKind, date: localDate(), time: "", points: "" });
  const a = useAction();
  return (
    <Panel title="Add an assignment" meta="for things Blackboard doesn't list">
      <form
        className="inline-form pad"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api("/api/assignments", {
              method: "POST",
              json: { courseId: f.courseId, title: f.title, kind: f.kind, date: f.date, time: f.time || undefined, pointsPossible: f.points ? Number(f.points) : undefined },
            });
            await reload();
            onDone();
          });
        }}
      >
        <select value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })} aria-label="Class">
          {d.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <input placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" autoFocus />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AssignmentKind })} aria-label="Type">
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Due date" />
        <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} aria-label="Due time (optional)" />
        <input type="number" min={0} step="any" placeholder="points" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} aria-label="Points (optional)" style={{ width: 90 }} />
        <button type="submit" className="btn primary" disabled={a.busy || !f.title.trim() || !f.courseId}>Add</button>
      </form>
      <div className="pad-x"><Feedback error={a.error} /></div>
    </Panel>
  );
}
