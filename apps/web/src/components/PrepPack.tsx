import { useEffect, type CSSProperties } from "react";
import type { AssignmentView, CourseFile } from "@sd/core";
import { colorVar, enc } from "../lib/api";
import { useDash } from "../lib/dash";
import { relativeDue } from "../lib/format";
import { prepPack } from "../lib/prep";
import { setPref, usePref } from "../lib/prefs";
import { Icon } from "./Icon";
import { canPreview } from "./Viewer";

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Everything to study for one exam, gathered from the class's own files and
 * your own work, with a checklist that's remembered in this browser.
 */
export function PrepPack({ examId, onClose }: { examId: string; onClose: () => void }) {
  const { d, view, setFocus } = useDash();
  const p = prepPack(d, examId);
  const key = `prep-${examId}`;
  const saved = usePref(key);
  const done = new Set<string>(saved ? (JSON.parse(saved) as string[]) : []);
  const tick = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPref(key, next.size ? JSON.stringify([...next]) : undefined);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!p) return null;
  const all = [...p.review, ...p.lectures].map((f) => f.id).concat([...p.work, ...p.readings].map((a) => a.id));
  const doneCount = all.filter((id) => done.has(id)).length;
  const days = Math.ceil((Date.parse(p.to) - Date.now()) / 86_400_000);

  const fileRow = (f: CourseFile) => (
    <li key={f.id} className={done.has(f.id) ? "ticked" : ""}>
      <Check on={done.has(f.id)} onChange={() => tick(f.id)} label={f.name} />
      <span className="prep-name">
        <span className="item-title">{f.name.replace(/\.[a-z0-9]{2,5}$/i, "")}</span>
        <span className="item-sub">{f.folder.join(" / ") || "Course files"}</span>
      </span>
      {canPreview(f.name) ? (
        <button type="button" className="chip-btn" onClick={() => view(f)}>
          Open
        </button>
      ) : (
        <a className="chip-btn" href={`/api/files/${enc(f.id)}/download`} download={f.name}>
          <Icon name="download" size={14} />
        </a>
      )}
    </li>
  );
  const workRow = (a: AssignmentView) => (
    <li key={a.id} className={done.has(a.id) ? "ticked" : ""}>
      <Check on={done.has(a.id)} onChange={() => tick(a.id)} label={a.title} />
      <span className="prep-name">
        <span className="item-title">{a.title}</span>
        <span className="item-sub">
          {a.score !== undefined && a.possible ? `${a.score}/${a.possible} · ${Math.round((a.score / a.possible) * 100)}%` : a.dueAt ? relativeDue(a.dueAt) : ""}
        </span>
      </span>
      {a.materials?.[0] ? (
        <button type="button" className="chip-btn" onClick={() => view(a.materials![0]!)}>
          Open
        </button>
      ) : (
        <button
          type="button"
          className="chip-btn"
          onClick={() => {
            onClose();
            setFocus({ mode: "class", courseId: a.courseId, itemId: a.id });
          }}
        >
          View
        </button>
      )}
    </li>
  );
  const section = (title: string, hint: string, rows: React.ReactNode[]) =>
    rows.length > 0 && (
      <section className="prep-section">
        <h3>
          {title} <span className="faint num">{rows.length}</span>
        </h3>
        <p className="hint">{hint}</p>
        <ul>{rows}</ul>
      </section>
    );

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal prep" role="dialog" aria-modal="true" aria-label={`Exam prep: ${p.exam.title}`} style={{ "--c": colorVar(p.course?.color) } as CSSProperties}>
        <header>
          <div>
            <p className="prep-kicker">
              Exam prep · {p.course?.code} · {days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : "today"}
            </p>
            <h2>{p.exam.title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="prep-progress" aria-label={`${doneCount} of ${all.length} done`}>
          <span className="bar">
            <span style={{ width: `${all.length ? (doneCount / all.length) * 100 : 0}%` }} />
          </span>
          <span className="faint num">
            {doneCount} of {all.length} done
          </span>
        </div>
        <div className="prep-body">
          {all.length === 0 && <p className="none">Nothing to gather yet: no files or work from {day.format(new Date(p.from))} on. Check the syllabus for what it covers.</p>}
          {section("Practice and review", "Practice exams, study guides and review sheets from this class.", p.review.map(fileRow))}
          {section("Your work since the last exam", "Weakest scores first: the likeliest gaps.", p.work.map(workRow))}
          {section("Lecture material", `Posted between ${day.format(new Date(p.from))} and ${day.format(new Date(p.to))}.`, p.lectures.map(fileRow))}
          {section("Readings", "Assigned in the same stretch.", p.readings.map(workRow))}
        </div>
      </div>
    </div>
  );
}

function Check({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <label className="done-box">
      <input type="checkbox" checked={on} onChange={onChange} aria-label={`${label}: studied`} />
      <span className="box" aria-hidden>
        <Icon name="check" size={12} />
      </span>
    </label>
  );
}
