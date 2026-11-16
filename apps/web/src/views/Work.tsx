import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AssignmentKind, AssignmentView, CategoryResult, CourseView } from "@sd/core";
import { Icon } from "../components/Icon";
import { api, colorVar, enc } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { hhmm, localDate, relativeDue, WEEKDAYS } from "../lib/format";
import { useTween } from "../lib/motion";
import { keepReading, useReadings } from "../lib/prefs";
import { project, readScore, type Trial } from "../lib/whatif";
import { useToggleDone } from "./Home";

const KINDS: AssignmentKind[] = ["homework", "reading", "quiz", "exam", "project", "paper", "lab", "discussion", "other"];

const fmt = (n: number | undefined, digits = 1) => (n === undefined ? "–" : n.toFixed(digits));

/**
 * "Syllabus weights" opens a small list: each category, how much of the
 * grade it is, how you're doing in it, and any drop-lowest rule.
 */
function WeightsButton({ c, cats }: { c: CourseView; cats: CategoryResult[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const drop = new Map((c.scheme ?? []).map((x) => [x.name, x.dropLowest]));
  const total = cats.reduce((n, x) => n + x.weight, 0);
  return (
    <span className="weights-wrap" ref={box}>
      <button type="button" className="weights-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {c.grade.basis === "syllabus" ? "Syllabus weights" : c.grade.label}
        <span className={`chev ${open ? "open" : ""}`} aria-hidden>
          <Icon name="next" size={12} />
        </span>
      </button>
      {open && (
        <span className="weights-pop" role="dialog" aria-label="Grade weights">
          <span className="wp-head">
            <span>Category</span>
            <span>Weight</span>
            <span>You</span>
          </span>
          {cats.map((x) => (
            <span key={x.name} className="wp-row">
              <span className="wp-name">
                {x.name}
                {drop.get(x.name) ? <span className="faint"> · drops lowest {drop.get(x.name)}</span> : null}
              </span>
              <span className="num">{x.weight}%</span>
              <span className="num">{x.percent === undefined ? "–" : `${x.percent.toFixed(1)}%`}</span>
              <span className="wp-bar" aria-hidden>
                <span style={{ width: `${Math.min(100, x.percent ?? 0)}%` }} />
              </span>
            </span>
          ))}
          <span className="wp-foot faint">
            {Math.round(total) === 100 ? "Adds up to 100%." : `Adds up to ${total}%.`} {c.schemeFrom === "syllabus" ? "Read from the syllabus." : c.schemeFrom ? "Set by you." : ""}
          </span>
        </span>
      )}
    </span>
  );
}

export function GradeCard({ c, p, tried, onReset, extra }: { c: CourseView; p: ReturnType<typeof project>; tried: number; onReset: () => void; extra?: ReactNode }) {
  const shown = tried ? p.next.percent : c.grade.percent;
  const value = useTween(shown ?? 0);
  const delta = tried && p.next.percent !== undefined && p.now.percent !== undefined ? p.next.percent - p.now.percent : 0;
  return (
    <section className={`grade-card ${tried ? "trying" : ""}`} aria-live="polite">
      <div>
        <p className="label">{tried ? "What-if grade" : "Class grade"}</p>
        <p className="grade-big">
          <span className="num">{shown === undefined ? "–" : `${value.toFixed(1)}%`}</span>
          <span className="letter">{tried ? p.next.letter : c.grade.letter}</span>
        </p>
        <p className="label">
          {tried ? (
            <>
              <span className={delta >= 0 ? "ok-text" : "danger-text"}>
                {delta >= 0 ? "+" : "−"}
                {Math.abs(delta).toFixed(1)}
              </span>{" "}
              from {fmt(p.now.percent)}% {p.now.letter} with {tried} tried score{tried === 1 ? "" : "s"}
              {p.gpaNext !== undefined && p.gpaNow !== undefined && (
                <> · GPA {p.gpaNow.toFixed(2)} → {p.gpaNext.toFixed(2)}</>
              )}
            </>
          ) : c.grade.basis === "none" ? (
            "No graded work yet"
          ) : (
            <>
              {c.grade.categories.length > 0 ? <WeightsButton c={c} cats={c.grade.categories} /> : c.grade.label}
              {c.grade.basis === "syllabus" && ` · ${c.grade.weightGraded}% of the grade is in`}
            </>
          )}
        </p>
      </div>
      {extra}
      {tried > 0 && (
        <button type="button" className="btn" onClick={onReset}>
          Back to real grades
        </button>
      )}
    </section>
  );
}

const KIND_LABEL: Record<string, string> = {
  homework: "Homework", quiz: "Quizzes", exam: "Exams", lab: "Labs", project: "Projects", paper: "Papers", discussion: "Discussions", reading: "Readings", other: "Other",
};

/** The group an item is filed under: its grade category (from the syllabus), else its kind. */
function groupOf(c: CourseView, a: AssignmentView): string {
  if (c.scheme?.length) return a.categoryResolved && c.scheme.some((x) => x.name === a.categoryResolved) ? a.categoryResolved : "Other";
  return KIND_LABEL[a.kind] ?? "Other";
}

/**
 * A class's work: what's coming, what's graded. Filter by type (homework,
 * exams, participation…); anything past due or waiting for a grade is folded
 * away until you open it. Readings follow the show/hide switch.
 */
export function Work(props: { c: CourseView; items: AssignmentView[]; cats: CategoryResult[]; trials: Record<string, Trial>; setTrial: (id: string, t: Trial | undefined) => void; focusId?: string }) {
  const { c } = props;
  const readings = useReadings();
  const [only, setOnly] = useState<string>();
  useEffect(() => setOnly(undefined), [c.id]);
  const now = Date.now();
  const shown = props.items.filter(keepReading(readings.shows));
  const present = new Set(shown.map((a) => groupOf(c, a)));
  const groups = (c.scheme?.length ? [...c.scheme.map((x) => x.name), "Other"] : Object.values(KIND_LABEL)).filter((g, i, all) => present.has(g) && all.indexOf(g) === i);
  const list = only ? shown.filter((a) => groupOf(c, a) === only) : shown;
  const byDateDesc = (a: AssignmentView, b: AssignmentView) => (b.dueAt ?? "").localeCompare(a.dueAt ?? "");
  const graded = list.filter((a) => a.score !== undefined).sort(byDateDesc);
  const open = list.filter((a) => a.score === undefined && !a.done);
  const isPast = (a: AssignmentView) => Boolean(a.dueAt) && Date.parse(a.dueAt!) < now;
  const pastDue = open.filter(isPast).sort(byDateDesc);
  const coming = open.filter((a) => !isPast(a)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  const waiting = list.filter((a) => a.score === undefined && a.done).sort(byDateDesc);
  const common = { c, trials: props.trials, setTrial: props.setTrial, focusId: props.focusId };

  return (
    <>
      {groups.length > 1 && (
        <div className="filter-chips" role="group" aria-label="Show only one type">
          <button type="button" aria-pressed={!only} onClick={() => setOnly(undefined)}>
            All
          </button>
          {groups.map((g) => {
            const cat = props.cats.find((x) => x.name === g);
            return (
              <button key={g} type="button" aria-pressed={only === g} onClick={() => setOnly(only === g ? undefined : g)} title={cat ? `${cat.weight}% of the grade` : undefined}>
                {g}
                {cat?.percent !== undefined && <span className="num">{cat.percent.toFixed(0)}%</span>}
              </button>
            );
          })}
        </div>
      )}
      <List title="Coming up" items={coming} empty={only ? `No ${only.toLowerCase()} coming up.` : "Nothing left to do. Nice."} {...common} />
      <List title="Past due" items={pastDue} folded {...common} />
      <List title="Graded" items={graded} empty={only ? undefined : "No graded work yet."} {...common} />
      <List title="Done, waiting for a grade" items={waiting} folded {...common} />
    </>
  );
}

function List(props: {
  title: string;
  items: AssignmentView[];
  c: CourseView;
  trials: Record<string, Trial>;
  setTrial: (id: string, t: Trial | undefined) => void;
  focusId?: string;
  empty?: string;
  /** Starts closed; the header opens it. */
  folded?: boolean;
}) {
  const holdsFocus = props.items.some((a) => a.id === props.focusId);
  const [open, setOpen] = useState(!props.folded || holdsFocus);
  useEffect(() => {
    if (holdsFocus) setOpen(true);
  }, [holdsFocus]);
  if (props.items.length === 0 && !props.empty) return null;
  return (
    <section className={`class-list ${props.folded ? "foldable" : ""}`}>
      {props.folded ? (
        <h2>
          <button type="button" className="fold-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className={`chev ${open ? "open" : ""}`} aria-hidden>
              <Icon name="next" size={14} />
            </span>
            {props.title} <span className="faint num">{props.items.length}</span>
          </button>
        </h2>
      ) : (
        <h2>
          {props.title} <span className="faint num">{props.items.length}</span>
        </h2>
      )}
      {!open ? null : props.items.length === 0 ? (
        <p className="none">{props.empty}</p>
      ) : (
        <ul>
          {props.items.map((a) => (
            <DetailRow key={a.id} a={a} c={props.c} trial={props.trials[a.id]} onTry={(t) => props.setTrial(a.id, t)} focused={a.id === props.focusId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DetailRow({ a, c, trial, onTry, focused }: { a: AssignmentView; c: CourseView; trial?: Trial; onTry: (t: Trial | undefined) => void; focused: boolean }) {
  const { view, reload, toast } = useDash();
  const toggle = useToggleDone();
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLLIElement>(null);
  const act = useAction();
  useEffect(() => {
    if (focused) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focused]);
  const sourceDone = a.done && !a.userDone;
  const patch = (body: object, msg?: string) =>
    act.run(async () => {
      await api(`/api/assignments/${enc(a.id)}`, { method: "PATCH", json: body });
      await reload();
      if (msg) toast(msg);
    });

  return (
    <li ref={ref} className={`drow ${a.done && a.score === undefined ? "is-done" : ""} ${focused ? "flash" : ""} ${open ? "open" : ""}`}>
      <label className="done-box" title={sourceDone ? `Done in ${a.origin}` : a.done ? "Mark not done" : "Mark done"}>
        <input type="checkbox" checked={a.done} disabled={sourceDone} onChange={(e) => toggle(a, e.target.checked)} aria-label={`${a.title}: done`} />
        <span className="box" aria-hidden>
          <Icon name="check" size={12} />
        </span>
      </label>
      <button type="button" className="drow-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="item-title">
          {(a.kind === "exam" || a.kind === "quiz") && <span className="kind">{a.kind === "exam" ? "Exam" : "Quiz"}</span>}
          {a.title}
        </span>
        <span className="item-sub">
          {a.late && <span className="danger-text">late · </span>}
          {a.kind === "reading" && a.dueAt ? `for class ${relativeDue(a.dueAt)}` : a.dueAt ? relativeDue(a.dueAt) : "no date"}
          {a.categoryResolved ? ` · ${a.categoryResolved}` : ""}
        </span>
        {a.scoresDiffer && a.scores && (
          <span className="differ">
            {a.scores.filter((x) => x.from !== "You").map((x) => `${x.from} ${x.score}/${x.possible}`).join(" · ")} · using {a.scoreFrom}
          </span>
        )}
      </button>
      <ScoreCell a={a} trial={trial} onTry={onTry} />
      {open && (
        <div className="drow-more">
          {a.materials?.map((m) => (
            <button key={m.id} type="button" className="chip-btn" onClick={() => view(m)}>
              <Icon name="file" size={14} /> {m.name.replace(/\.[a-z0-9]{2,5}$/i, "")}
            </button>
          ))}
          {a.url && (
            <a className="chip-btn" href={a.url} target="_blank" rel="noreferrer noopener">
              <Icon name="external" size={14} /> Open in Blackboard
            </a>
          )}
          {a.scoresDiffer && a.scoreFrom !== "You" && (
            <button type="button" className="chip-btn" disabled={act.busy} onClick={() => void patch({ gradeFrom: a.scoreFrom === "Gradescope" ? "blackboard" : "gradescope" }, "Switched.")}>
              Count the {a.scoreFrom === "Gradescope" ? (a.scores?.some((x) => x.from === "Canvas") ? "Canvas" : "Blackboard") : "Gradescope"} score instead
            </button>
          )}
          {trial && (
            <button
              type="button"
              className="chip-btn"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  await api(`/api/grades/${enc(a.id)}`, { method: "PUT", json: { score: Math.round(trial.score * 100) / 100, pointsPossible: trial.possible } });
                  onTry(undefined);
                  await reload();
                  toast("Saved as your score.");
                })
              }
            >
              Keep {fmt(trial.score, 2).replace(/\.?0+$/, "")}/{trial.possible} as my real score
            </button>
          )}
          {a.scoreIsYours && (
            <button type="button" className="chip-btn" disabled={act.busy} onClick={() => void act.run(async () => { await api(`/api/grades/${enc(a.id)}`, { method: "DELETE" }); await reload(); })}>
              Remove my score
            </button>
          )}
          {c.scheme && (
            <label className="chip-btn plain">
              Counts toward
              <select
                value={a.categoryResolved && c.scheme.some((x) => x.name === a.categoryResolved) ? a.categoryResolved : ""}
                onChange={(e) => void patch({ category: e.target.value || null }, "Category changed.")}
                aria-label={`${a.title} category`}
              >
                <option value="">no category</option>
                {c.scheme.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
          )}
          <span className="spacer" />
          {a.manual ? (
            <button type="button" className="chip-btn danger" onClick={() => confirm(`Delete “${a.title}”?`) && void act.run(async () => { await api(`/api/assignments/${enc(a.id)}`, { method: "DELETE" }); await reload(); })}>
              Delete
            </button>
          ) : (
            <button type="button" className="chip-btn" onClick={() => void patch({ hidden: true }, "Hidden. It stays in Blackboard.")}>
              Hide
            </button>
          )}
          <Feedback error={act.error} />
        </div>
      )}
    </li>
  );
}

/**
 * The score, or a box to try one. Type it any way: 42, 42/50, 84%.
 * Enter or leaving the box tries it; Esc puts it back; an empty box clears it.
 */
function ScoreCell({ a, trial, onTry }: { a: AssignmentView; trial?: Trial; onTry: (t: Trial | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const possible = a.possible ?? a.pointsPossible;
  const countsNot = a.countsTowardGrade === false || a.status === "excused";
  if (countsNot) return <span className="score faint">not counted</span>;
  // Readings aren't graded unless a source gave them points.
  if (a.kind === "reading" && a.score === undefined && !possible && !trial) return <span className="score" aria-hidden />;

  const begin = () => {
    setText(trial ? String(Math.round(trial.score * 100) / 100) : a.score !== undefined ? String(a.score) : "");
    setBad(false);
    setEditing(true);
  };
  const commit = () => {
    if (!text.trim()) {
      onTry(undefined);
      setEditing(false);
      return;
    }
    const t = readScore(text, possible);
    if (!t) {
      setBad(true);
      return;
    }
    // Trying the real score is the same as not trying anything.
    onTry(a.score !== undefined && t.score === a.score && t.possible === a.possible ? undefined : t);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className={`score editing ${bad ? "bad" : ""}`}>
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          aria-label={`Try a score for ${a.title}`}
          aria-invalid={bad}
          placeholder={possible ? `of ${possible}` : "%"}
          inputMode="decimal"
        />
        {possible && !/[/%]/.test(text) ? <span className="of num">/{possible}</span> : null}
      </span>
    );
  }

  const pct = (s: number, p: number) => (p > 0 ? `${Math.round((s / p) * 100)}%` : "");
  return (
    <button type="button" className={`score ${trial ? "tried" : ""}`} onClick={begin} title="Try a different score (not saved)">
      {trial ? (
        <>
          {a.score !== undefined && <s className="was num">{a.score}</s>}
          <b className="num">{Math.round(trial.score * 100) / 100}/{trial.possible}</b>
          <span className="pct num">{pct(trial.score, trial.possible)}</span>
        </>
      ) : a.score !== undefined ? (
        <>
          <b className="num">
            {a.score}/{a.possible}
            {a.scoreIsYours ? "*" : ""}
          </b>
          <span className="pct num">{pct(a.score, a.possible ?? 0)}</span>
        </>
      ) : (
        <span className="try">try a score</span>
      )}
    </button>
  );
}

export function AddItem({ c, onDone }: { c: CourseView; onDone: () => void }) {
  const { reload, toast } = useDash();
  const [f, setF] = useState({ title: "", kind: "homework" as AssignmentKind, date: localDate(), time: "", points: "" });
  const a = useAction();
  return (
    <form
      className="add-item"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          await api("/api/assignments", {
            method: "POST",
            json: { courseId: c.id, title: f.title, kind: f.kind, date: f.date, time: f.time || undefined, pointsPossible: f.points ? Number(f.points) : undefined },
          });
          await reload();
          toast(`Added to ${c.code}.`);
          onDone();
        });
      }}
    >
      <input placeholder="What is it?" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" autoFocus />
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AssignmentKind })} aria-label="Type">
        {KINDS.map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Due date" />
      <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} aria-label="Due time (optional)" />
      <input type="number" min={0} step="any" placeholder="points" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} aria-label="Points (optional)" className="pts" />
      <button type="submit" className="btn primary" disabled={a.busy || !f.title.trim()}>
        Add
      </button>
      <button type="button" className="btn ghost" onClick={onDone}>
        Cancel
      </button>
      <Feedback error={a.error} />
    </form>
  );
}
