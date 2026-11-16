import { useMemo, useState, type CSSProperties } from "react";
import { gpa, gradeTrend, requiredOnRemaining, type AssignmentView, type CourseView, type GradingCategory } from "@sd/core";
import { Icon } from "../components/Icon";
import { canPreview } from "../components/Viewer";
import { api, colorVar, enc } from "../lib/api";
import { courseMap, Feedback, lmsOf, useAction, useDash } from "../lib/dash";
import { hhmm, pct, WEEKDAYS } from "../lib/format";
import { setPref, usePref } from "../lib/prefs";
import { isExam } from "../lib/prep";
import { project, type Trial } from "../lib/whatif";
import { CourseContent } from "./CourseContent";
import { AddItem, GradeCard, Work } from "./Work";
import { countdown } from "./Home";

const LEVEL: Record<string, string> = { regular: "", honors: "Honors", ap: "AP", ib: "IB", de: "Dual enrollment" };
const ROLE: Record<string, string> = { instructor: "Instructor", ta: "Teaching assistant", staff: "Staff", student: "Student" };
const dateParts = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

/** Midterms, finals, quizzes, projects and papers: the dates worth knowing ahead. */
function isKeyDate(a: AssignmentView): boolean {
  return ["exam", "project", "paper", "quiz"].includes(a.kind) || /\b(midterm|final|exam|test)\b/i.test(a.title);
}

/** Every class's grade (with what-if), plus its teacher, syllabus and important dates. */
export function Grades() {
  const { d, classPick, classItem, showClass } = useDash();
  if (d.courses.length === 0) return <p className="empty-lg">No classes yet. They show up after the first sync with your school.</p>;
  const c = courseMap(d).get(classPick ?? "") ?? d.courses[0]!;
  return (
    <div className="classes-page">
      <header className="page-head">
        <h1>Grades</h1>
        <GpaStrip />
      </header>
      <nav className="class-switch" aria-label="Classes">
        {d.courses.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`pill ${x.id === c.id ? "on" : ""}`}
            style={{ "--c": colorVar(x.color) } as CSSProperties}
            aria-current={x.id === c.id ? "true" : undefined}
            onClick={() => showClass(x.id)}
          >
            {x.code}
          </button>
        ))}
      </nav>
      {d.sis && d.sis.terms.length > 0 && <Record />}
      <Profile key={c.id} c={c} focusId={c.id === classPick ? classItem : undefined} />
    </div>
  );
}

/** Every term on your official record (from the SIS), newest first; folded until you open it. */
function Record() {
  const { d } = useDash();
  const open = usePref("record-open") === "yes";
  const v = d.sis!;
  const terms = [...v.terms].reverse();
  return (
    <section className="class-list foldable record">
      <h2>
        <button type="button" className="fold-btn" onClick={() => setPref("record-open", open ? undefined : "yes")} aria-expanded={open}>
          <span className={`chev ${open ? "open" : ""}`} aria-hidden>
            <Icon name="next" size={14} />
          </span>
          Official record <span className="faint">{terms.length} term{terms.length === 1 ? "" : "s"} · from the SIS</span>
        </button>
      </h2>
      {open && (
        <div className="record-terms">
          {terms.map((t) => (
            <div key={t.term} className="record-term">
              <h3>
                {t.term}
                <span className="faint num">{t.gpa !== undefined ? `GPA ${t.gpa.toFixed(2)} · ${t.units} units` : "in progress"}</span>
              </h3>
              <ul>
                {t.courses.map((x, i) => (
                  <li key={`${x.code}${i}`}>
                    <span className="code">{x.code}</span>
                    <span className="title">{x.title}</span>
                    <span className="num faint">{x.units !== undefined ? x.units : ""}</span>
                    <b className="num grade">{x.grade || (x.status && /enrol/i.test(x.status) ? "–" : x.status ?? "")}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** GPA in one line; "Try letters" opens a what-if. Nothing is saved. */
function GpaStrip() {
  const { d } = useDash();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const scale = d.gpaScale;
  const letters = scale ? Object.keys(scale.points) : [];
  const rows = d.courses.map((c) => ({ c, letter: pick[c.id] ?? c.grade.letter ?? "" }));
  const tried = Object.keys(pick).length > 0;
  const result = scale ? gpa(rows.filter((r) => r.letter).map((r) => ({ letter: r.letter, credits: r.c.credits, level: r.c.level })), scale) : undefined;
  return (
    <div className="gpa-strip">
      {d.sis?.gpa !== undefined && !tried && (
        <span className="gpa-num official" title={`From your official grades in the SIS: ${d.sis.units} graded units`}>
          <span className="label">Official GPA</span>
          <b className="num">{d.sis.gpa.toFixed(2)}</b>
        </span>
      )}
      <span className="gpa-num">
        <span className="label">{tried ? "What-if GPA" : d.sis?.gpa !== undefined ? "This term so far" : "GPA so far"}</span>
        <b className="num">{result ? result.gpa.toFixed(2) : "–"}</b>
        {tried && d.gpa && <span className="faint num">was {d.gpa.gpa.toFixed(2)}</span>}
        {!tried && result && result.gpa !== result.unweighted && <span className="faint num">{result.unweighted.toFixed(2)} unweighted</span>}
        {d.gpa && <span className="faint num">{d.gpa.credits} credits</span>}
      </span>
      {scale && (
        <button type="button" className="btn ghost sm" onClick={() => (open ? (setOpen(false), setPick({})) : setOpen(true))} aria-expanded={open}>
          {open ? "Done" : "Try letters"}
        </button>
      )}
      {open && (
        <div className="gpa-picks">
          {rows.map(({ c, letter }) => (
            <label key={c.id} className="mini">
              <span className="swatch" style={{ background: colorVar(c.color) }} /> {c.code}
              <select value={letter} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })} aria-label={`${c.code} letter`}>
                <option value="">–</option>
                {letters.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Profile({ c, focusId }: { c: CourseView; focusId?: string }) {
  const { d } = useDash();
  const [trials, setTrials] = useState<Record<string, Trial>>({});
  const [adding, setAdding] = useState(false);
  const p = useMemo(() => project(d, c, trials), [d, c, trials]);
  const mine = useMemo(() => d.assignments.filter((a) => a.courseId === c.id), [d.assignments, c.id]);
  const now = Date.now();
  const tried = Object.keys(trials).length;
  const setTrial = (id: string, t: Trial | undefined) =>
    setTrials((x) => {
      const next = { ...x };
      if (t) next[id] = t;
      else delete next[id];
      return next;
    });
  const trend = useMemo(
    () =>
      gradeTrend({
        scheme: c.scheme ? { categories: c.scheme } : undefined,
        assignments: mine,
        grades: d.grades.filter((g) => mine.some((a) => a.id === g.assignmentId)),
        cutoffs: c.cutoffs,
        categoryOf: (a) => (a as AssignmentView).categoryResolved,
      }),
    [c, mine, d.grades],
  );

  return (
    <div className="profile" style={{ "--c": colorVar(c.color) } as CSSProperties}>
      <div className="profile-main">
        <header className="class-head">
          <p className="code">
            {c.code} · {c.credits} credit{c.credits === 1 ? "" : "s"}
            {LEVEL[c.level] ? ` · ${LEVEL[c.level]}` : ""}
          </p>
          <h1>{c.name}</h1>
          <p className="facts-line">
            {c.meetings.length > 0 && (
              <span>
                {c.meetings.map((m) => `${WEEKDAYS[m.weekday]!.slice(0, 3)} ${hhmm(m.start)}–${hhmm(m.end)}`).join(", ")}
                {c.meetings[0]?.location ? ` · ${c.meetings[0].location}` : ""}
              </span>
            )}
            {c.url && (
              <a className="link quiet" href={c.url} target="_blank" rel="noreferrer noopener">
                {lmsOf(c.id)} <Icon name="external" size={12} />
              </a>
            )}
          </p>
        </header>

        <GradeCard c={c} p={p} tried={tried} onReset={() => setTrials({})} extra={!tried && <Spark points={trend} />} />
        <GradeTools c={c} base={p.now} />
        <Work c={c} items={mine} cats={tried ? p.next.categories : c.grade.categories} trials={trials} setTrial={setTrial} focusId={focusId} />
        <ContentFold c={c} />
        <footer className="class-foot">
          {adding ? (
            <AddItem c={c} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="btn ghost" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Add an assignment
            </button>
          )}
        </footer>
      </div>

      <aside className="profile-side">
        <Teachers c={c} />
        <KeyDates c={c} items={mine} now={now} />
        <Syllabus c={c} />
      </aside>
    </div>
  );
}

/** Blackboard's own folders for this class, folded until you open them (remembered). */
function ContentFold({ c }: { c: CourseView }) {
  const open = usePref("content-open") === "yes";
  return (
    <section className="class-list foldable">
      <h2>
        <button type="button" className="fold-btn" onClick={() => setPref("content-open", open ? undefined : "yes")} aria-expanded={open}>
          <span className={`chev ${open ? "open" : ""}`} aria-hidden>
            <Icon name="next" size={14} />
          </span>
          Course content <span className="faint">as in {lmsOf(c.id)}</span>
        </button>
      </h2>
      {open && <CourseContent c={c} />}
    </section>
  );
}

/** One quiet row: "what do I need for an A−?", which number to show, and the grade weights. */
function GradeTools({ c, base }: { c: CourseView; base: ReturnType<typeof project>["now"] }) {
  const { reload, go } = useDash();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const act = useAction();
  const g = c.grade;
  const goal = target ? Number(target) : undefined;
  const need = goal !== undefined && base.percent !== undefined ? requiredOnRemaining(base.percent, base.weightGraded, goal) : undefined;
  if (editing) return <SchemeEditor c={c} onDone={() => setEditing(false)} />;
  return (
    <section className="grade-tools">
      {base.percent !== undefined && (
        <label className="mini">
          What do I need for
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`${c.code} target grade`}>
            <option value="">a letter…</option>
            {c.cutoffs
              .filter((x) => x.min > 0)
              .map((x) => (
                <option key={x.letter} value={x.min}>
                  {x.letter} ({x.min}%)
                </option>
              ))}
          </select>
        </label>
      )}
      <span className="spacer" />
      {g.options.length > 1 && (
        <label className="mini">
          Show
          <select
            value={c.gradeSource ?? "auto"}
            onChange={(e) =>
              void act.run(async () => {
                await api(`/api/courses/${enc(c.id)}`, { method: "PATCH", json: { gradeSource: e.target.value } });
                await reload();
              })
            }
            aria-label={`${c.code} grade source`}
          >
            <option value="auto">Best available</option>
            {g.options.map((o) => (
              <option key={o.basis} value={o.basis}>
                {o.label} · {pct(o.percent)}
              </option>
            ))}
          </select>
        </label>
      )}
      {c.syllabus === "review" && (
        <button type="button" className="link quiet" onClick={() => go("Syllabi")}>
          Check syllabus
        </button>
      )}
      <button type="button" className="link quiet" onClick={() => setEditing(true)}>
        {c.scheme ? "Edit weights" : "Enter weights"}
      </button>
      {need !== undefined && goal !== undefined && (
        <p className={`need ${need > 100 ? "danger-text" : ""}`}>
          {need > 100
            ? `Out of reach: it would take ${need.toFixed(1)}% on everything left.`
            : need <= 0
              ? "Already locked in, even with zeros on what's left."
              : `You need an average of ${need.toFixed(1)}% on the remaining ${(100 - base.weightGraded).toFixed(0)}% of the grade.`}
        </p>
      )}
      {target && need === undefined && <p className="need faint">Everything is graded already.</p>}
      {(() => {
        const letter = c.cutoffs.find((x) => String(x.min) === target)?.letter;
        if (!letter || !c.cutoffsFilled?.includes(letter)) return null;
        const own = c.cutoffs.filter((x) => !c.cutoffsFilled!.includes(x.letter) && x.min > 0).map((x) => `${x.letter} at ${x.min}%`);
        return (
          <p className="need faint">
            Your syllabus doesn't set {letter}; it only guarantees {own.join(", ")}. {letter} uses the usual cutoff, so treat it as a guide.
          </p>
        );
      })()}
      <Feedback error={act.error} />
    </section>
  );
}

function Teachers({ c }: { c: CourseView }) {
  const { compose, toast } = useDash();
  const people = [...c.instructors].sort((a, b) => (a.role === "instructor" ? 0 : 1) - (b.role === "instructor" ? 0 : 1));
  const copy = (email: string) =>
    void navigator.clipboard
      ?.writeText(email)
      .then(() => toast(`Copied ${email}`))
      .catch(() => toast("Couldn't copy. Select the address instead."));
  return (
    <section className="side-block">
      <h2>{people.length > 1 ? "Teachers" : "Teacher"}</h2>
      {people.length === 0 && <p className="none">{lmsOf(c.id)} doesn't list a teacher for this class.</p>}
      <ul className="people">
        {people.map((x, i) => (
          <li key={`${x.name}${i}`}>
            <span className="avatar sm" aria-hidden>
              {x.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="who">
              <b>{x.name}</b>
              <span className="muted">{ROLE[x.role] ?? x.role}</span>
              {x.email && (
                <span className="email">
                  <a href={`mailto:${x.email}`}>{x.email}</a>
                  <button type="button" className="icon-btn xs" onClick={() => copy(x.email!)} aria-label={`Copy ${x.email}`} title="Copy">
                    <Icon name="copy" size={13} />
                  </button>
                </span>
              )}
              {(x.officeHours || (x.role === "instructor" && i === 0 && c.policies?.officeHours)) && (
                <span className="oh" title={x.officeHours ?? c.policies?.officeHours}>
                  Office hours: {x.officeHours ?? c.policies?.officeHours}
                </span>
              )}
            </span>
            {x.email && (
              <button type="button" className="chip-btn" onClick={() => compose({ to: x.email, courseId: c.id })}>
                <Icon name="mail" size={14} /> Write
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyDates({ c, items, now }: { c: CourseView; items: AssignmentView[]; now: number }) {
  const { d, setFocus, prep } = useDash();
  const list = items.filter((a) => a.dueAt && isKeyDate(a)).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const nextId = list.find((a) => Date.parse(a.dueAt!) >= now)?.id;
  const termEnd = d.term.end;
  return (
    <section className="side-block">
      <h2>Important dates</h2>
      {list.length === 0 && <p className="none">No exams or big deadlines found yet. They come from {lmsOf(c.id)} and the syllabus.</p>}
      <ul className="key-dates">
        {list.map((a) => {
          const at = new Date(a.dueAt!);
          const past = at.getTime() < now;
          return (
            <li key={a.id} className={`${past ? "past" : ""} ${a.id === nextId ? "next" : ""}`}>
              <button type="button" className="kd" onClick={() => setFocus({ mode: "class", courseId: c.id, itemId: a.id })} title={longDate.format(at)}>
                <span className="kd-date">
                  <span className="kd-wd">{weekdayFmt.format(at)}</span>
                  <span className="num">{dateParts.format(at)}</span>
                </span>
                <span className="kd-text">
                  <span className="item-title">{a.title}</span>
                  <span className="item-sub">
                    {a.kind === "exam" ? "Exam" : a.kind === "quiz" ? "Quiz" : a.kind === "project" ? "Project" : a.kind === "paper" ? "Paper" : "Deadline"}
                    {a.score !== undefined && a.possible ? ` · ${Math.round((a.score / a.possible) * 100)}%` : ""}
                  </span>
                </span>
                <span className="left">{past ? (a.score !== undefined ? "graded" : "done") : countdown(a.dueAt!, now)}</span>
              </button>
              {!past && isExam(a) && (
                <button type="button" className="chip-btn prep-btn kd-prep" onClick={() => prep(a.id)} title="Exam prep: what to study">
                  <Icon name="book" size={14} /> Prep
                </button>
              )}
            </li>
          );
        })}
        {termEnd && (
          <li className="term-end">
            <span className="kd">
              <span className="kd-date">
                <span className="kd-wd">{weekdayFmt.format(new Date(`${termEnd}T12:00:00`))}</span>
                <span className="num">{dateParts.format(new Date(`${termEnd}T12:00:00`))}</span>
              </span>
              <span className="kd-text">
                <span className="item-title">Term ends</span>
                <span className="item-sub">{d.term.name}</span>
              </span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

function Syllabus({ c }: { c: CourseView }) {
  const { d, view, go } = useDash();
  const files = d.files.filter((f) => f.courseId === c.id && f.isSyllabus);
  return (
    <section className="side-block">
      <h2>
        Syllabus
        {c.syllabus === "review" && <span className="tag warn">needs a look</span>}
      </h2>
      {files.length === 0 ? (
        <p className="none">
          None found in {lmsOf(c.id)} yet.{" "}
          <button type="button" className="link" onClick={() => go("Syllabi")}>
            Upload one
          </button>
        </p>
      ) : (
        <ul className="syl-files">
          {files.slice(0, 4).map((f) => (
            <li key={f.id}>
              <Icon name="file" size={14} />
              <span className="syl-name" title={f.name}>
                {f.name.replace(/\.[a-z0-9]{2,5}$/i, "")}
              </span>
              {canPreview(f.name) && (
                <button type="button" className="chip-btn" onClick={() => view(f)}>
                  Open
                </button>
              )}
              <a className="icon-btn" href={`/api/files/${enc(f.id)}/download`} download={f.name} aria-label={`Download ${f.name}`} title="Download">
                <Icon name="download" size={14} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="syl-note">
        {c.syllabus === "applied" ? "Grade weights and dates were read from it." : c.syllabus === "review" ? "Weights were found but need a quick check." : "Weights and dates fill in once one is read."}{" "}
        <button type="button" className="link quiet inline" onClick={() => go("Syllabi")}>
          All syllabi
        </button>
      </p>
    </section>
  );
}

function Spark({ points }: { points: { percent: number; title: string }[] }) {
  if (points.length < 2) return null;
  const w = 150;
  const h = 34;
  const vals = points.map((p) => p.percent);
  const lo = Math.min(...vals) - 2;
  const hi = Math.max(...vals) + 2;
  const xy = points.map((p, i) => [4 + (i * (w - 8)) / (points.length - 1), h - 4 - ((p.percent - lo) / (hi - lo || 1)) * (h - 8)] as const);
  const last = xy[xy.length - 1]!;
  const delta = vals[vals.length - 1]! - vals[0]!;
  return (
    <svg className="spark" width={w} height={h} role="img" aria-label={`Grade trend: ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} points over ${points.length} graded items`}>
      <title>{points.map((p) => `${p.title}: ${p.percent.toFixed(1)}%`).join("\n")}</title>
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function SchemeEditor({ c, onDone }: { c: CourseView; onDone: () => void }) {
  const { reload } = useDash();
  const [rows, setRows] = useState<{ name: string; weight: string; drop: string }[]>(
    c.scheme?.map((x: GradingCategory) => ({ name: x.name, weight: String(x.weight), drop: x.dropLowest ? String(x.dropLowest) : "" })) ?? [
      { name: "Homework", weight: "", drop: "" },
      { name: "Exams", weight: "", drop: "" },
    ],
  );
  const a = useAction();
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="pad">
      {rows.map((r, i) => (
        <div key={i} className="inline-form" style={{ marginBottom: 6 }}>
          <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Category" aria-label="Category name" />
          <label className="mini"><input type="number" min={0} max={100} step={0.5} value={r.weight} onChange={(e) => set(i, { weight: e.target.value })} aria-label={`${r.name} weight`} />%</label>
          <label className="mini">drop lowest<input type="number" min={0} max={20} value={r.drop} placeholder="0" onChange={(e) => set(i, { drop: e.target.value })} aria-label={`${r.name} drop lowest`} style={{ width: 52 }} /></label>
          <button type="button" className="btn ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`}>✕</button>
        </div>
      ))}
      <div className="inline-form">
        <button type="button" className="btn" onClick={() => setRows([...rows, { name: "", weight: "", drop: "" }])}>+ Category</button>
        <span className={Math.abs(total - 100) > 0.5 ? "warn-text" : "faint"}>total {total}%</span>
        <span className="spacer" />
        {c.scheme && (
          <button type="button" className="btn ghost" disabled={a.busy}
            onClick={() => confirm("Remove the grading weights for this class?") && void a.run(async () => { await api(`/api/courses/${enc(c.id)}/scheme`, { method: "DELETE" }); await reload(); onDone(); })}>
            Remove weights
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn primary" disabled={a.busy || Math.abs(total - 100) > 0.5}
          onClick={() =>
            void a.run(async () => {
              await api(`/api/courses/${enc(c.id)}/scheme`, {
                method: "PUT",
                json: { categories: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, weight: Number(r.weight), dropLowest: Number(r.drop) || undefined })) },
              });
              await reload();
              onDone();
            })
          }>
          Save weights
        </button>
      </div>
      <Feedback error={a.error} />
    </div>
  );
}
