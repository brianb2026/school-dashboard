import { useMemo, useState } from "react";
import {
  gpa,
  gradeTrend,
  requiredOnRemaining,
  resolveCourseGrade,
  type AssignmentView,
  type CourseView,
  type GradeEntry,
  type GradeSourcePref,
  type GradingCategory,
  type ResolveInput,
} from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { pct } from "../lib/format";
import { Panel } from "../panels/Panel";

const FROM: Record<string, string> = { blackboard: "Blackboard's letter scale", syllabus: "the syllabus", manual: "your own scale", school: "the school default" };

export function Grades() {
  const { d, go } = useDash();
  if (d.courses.length === 0) {
    return <p className="empty">No classes yet. <button type="button" className="link" onClick={() => go("Today")}>Link Blackboard</button> and grades fill in by themselves.</p>;
  }
  return (
    <div className="stack wide">
      <GpaWhatIf />
      {d.courses.map((c) => <CourseCard key={c.id} c={c} />)}
    </div>
  );
}

/** "What if I end with these letters?" Runs on this page; nothing is saved. */
function GpaWhatIf() {
  const { d } = useDash();
  const [pick, setPick] = useState<Record<string, string>>({});
  const scale = d.gpaScale;
  const letters = scale ? Object.keys(scale.points) : [];
  const rows = d.courses.map((c) => ({ c, letter: pick[c.id] ?? c.grade.letter ?? "" }));
  const result = scale ? gpa(rows.filter((r) => r.letter).map((r) => ({ letter: r.letter, credits: r.c.credits, level: r.c.level })), scale) : undefined;
  const changed = Object.keys(pick).length > 0;
  return (
    <Panel title="GPA" meta={changed ? <button type="button" className="link" onClick={() => setPick({})}>back to actual</button> : "pick letters to try a what-if"}>
      <div className="gpa-row">
        <div className="gpa">
          <div><div className="big">{result ? result.gpa.toFixed(2) : "–"}</div><div className="label">{changed ? "what-if GPA" : "GPA so far"}</div></div>
          {result && result.gpa !== result.unweighted && <div><div className="big muted">{result.unweighted.toFixed(2)}</div><div className="label">unweighted</div></div>}
          {changed && d.gpa && <div><div className="big muted">{d.gpa.gpa.toFixed(2)}</div><div className="label">actual</div></div>}
        </div>
        <div className="gpa-picks">
          {rows.map(({ c, letter }) => (
            <label key={c.id} className="mini">
              <span className="swatch" style={{ background: colorVar(c.color) }} /> {c.code}
              <select value={letter} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })} aria-label={`${c.code} letter`}>
                <option value="">–</option>
                {letters.map((l) => <option key={l}>{l}</option>)}
              </select>
              <span className="faint">{c.credits} cr</span>
            </label>
          ))}
        </div>
      </div>
    </Panel>
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

function CourseCard({ c }: { c: CourseView }) {
  const { d, reload, go } = useDash();
  const [hyp, setHyp] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState(false);
  const act = useAction();

  const mine = useMemo(() => d.assignments.filter((a) => a.courseId === c.id), [d.assignments, c.id]);
  const grades = useMemo(() => d.grades.filter((g) => mine.some((a) => a.id === g.assignmentId)), [d.grades, mine]);
  const input: ResolveInput = useMemo(
    () => ({
      scheme: c.scheme ? { categories: c.scheme } : undefined,
      assignments: mine,
      grades,
      overall: d.overall.filter((o) => o.courseId === c.id),
      cutoffs: c.cutoffs,
      prefer: c.gradeSource,
      categoryOf: (a) => (a as AssignmentView).categoryResolved,
    }),
    [c, mine, grades, d.overall],
  );
  const trend = useMemo(() => gradeTrend(input), [input]);
  const own: GradeSourcePref = c.scheme ? "syllabus" : "points";
  // Your own work only (no Blackboard snapshot): the base for every what-if.
  const base = useMemo(() => resolveCourseGrade({ ...input, overall: [], prefer: own }), [input, own]);

  const graded = mine.filter((a) => a.score !== undefined);
  const upcoming = mine.filter((a) => a.score === undefined && a.countsTowardGrade !== false && a.status !== "excused");
  const tries = Object.entries(hyp).filter(([, v]) => v !== "" && Number.isFinite(Number(v)));
  const projected = useMemo(() => {
    if (!tries.length) return undefined;
    const extra: GradeEntry[] = tries.map(([id, v]) => {
      const possible = mine.find((a) => a.id === id)?.pointsPossible || 100;
      return { assignmentId: id, courseId: c.id, score: (Number(v) / 100) * possible, pointsPossible: possible, source: { source: "manual", fetchedAt: "" } };
    });
    return resolveCourseGrade({ ...input, overall: [], prefer: own, grades: [...grades, ...extra] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tries), input, own]);

  const targetPct = target ? Number(target) : undefined;
  const need = targetPct !== undefined && base.percent !== undefined ? requiredOnRemaining(base.percent, base.weightGraded, targetPct) : undefined;
  const bbOpt = c.grade.options.find((o) => o.basis === "blackboard");
  const sylOpt = c.grade.options.find((o) => o.basis === "syllabus");
  const g = c.grade;

  const patchCourse = (body: object) =>
    act.run(async () => {
      await api(`/api/courses/${enc(c.id)}`, { method: "PATCH", json: body });
      await reload();
    });
  const setCategory = (a: AssignmentView, category: string) =>
    act.run(async () => {
      await api(`/api/assignments/${enc(a.id)}`, { method: "PATCH", json: { category: category || null } });
      await reload();
    });

  return (
    <Panel
      title={`${c.code} · ${c.name}`}
      meta={
        <span className="chip">
          <span className="swatch" style={{ background: colorVar(c.color) }} />
          {c.credits} credits
        </span>
      }
    >
      <div className="grade-head">
        <div>
          <div className="big num">{pct(g.percent)} <span className="letter">{g.letter ?? ""}</span></div>
          <div className="label">
            {g.basis === "none" ? "No graded work yet" : g.label}
            {g.basis === "syllabus" && ` · ${g.weightGraded}% of the grade is in`}
          </div>
        </div>
        <Spark points={trend} />
        <span className="spacer" />
        {g.options.length > 0 && (
          <label className="mini">
            show
            <select value={c.gradeSource ?? "auto"} onChange={(e) => void patchCourse({ gradeSource: e.target.value })} aria-label={`${c.code} grade source`}>
              <option value="auto">Best available</option>
              {g.options.map((o) => <option key={o.basis} value={o.basis}>{o.label} · {pct(o.percent)}</option>)}
            </select>
          </label>
        )}
      </div>
      {bbOpt && sylOpt && Math.abs(bbOpt.percent - sylOpt.percent) >= 2 && (
        <p className="help pad-x">
          Blackboard says {pct(bbOpt.percent)}; your syllabus weights give {pct(sylOpt.percent)}. They differ when the instructor's gradebook counts things
          differently from the syllabus, or when some items below aren't in a category yet.
        </p>
      )}

      {c.scheme && !editing && (
        <div className="cats">
          {g.categories.map((cat) => (
            <div key={cat.name} className="row cat-row">
              <span>{cat.name}</span>
              <span className="num muted">{cat.weight}%</span>
              <span className="num">{pct(cat.percent)}</span>
              <span className="bar"><span style={{ width: `${Math.min(100, cat.percent ?? 0)}%`, background: colorVar(c.color) }} /></span>
              <span className="faint num" style={{ fontSize: 12 }}>{cat.count} graded</span>
            </div>
          ))}
        </div>
      )}
      {editing && <SchemeEditor c={c} onDone={() => setEditing(false)} />}
      {!editing && (
        <div className="pad-x toolbar thin">
          {c.scheme ? (
            <span className="faint" style={{ fontSize: 12 }}>Weights from {c.schemeFrom === "syllabus" ? "the syllabus" : "you"}.</span>
          ) : (
            <span className="faint" style={{ fontSize: 12 }}>
              No grading weights yet{c.syllabus === "review" ? ": a syllabus is waiting for a quick check." : "."}
            </span>
          )}
          <button type="button" className="link" onClick={() => setEditing(true)}>{c.scheme ? "edit weights" : "enter weights"}</button>
          {!c.scheme && <button type="button" className="link" onClick={() => go("Syllabi")}>{c.syllabus === "review" ? "review syllabus" : "upload syllabus"}</button>}
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12 }} title={c.cutoffs.map((x) => `${x.letter} ≥ ${x.min}`).join("   ")}>
            Letters use {FROM[c.cutoffsFrom]} (A ≥ {c.cutoffs.find((x) => x.letter === "A")?.min ?? "?"})
          </span>
        </div>
      )}

      {base.percent !== undefined && (
        <div className="whatif pad-x">
          <label className="mini">
            What do I need for
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`${c.code} target grade`}>
              <option value="">a target…</option>
              {c.cutoffs.filter((x) => x.min > 0).map((x) => <option key={x.letter} value={x.min}>{x.letter} ({x.min}%)</option>)}
            </select>
          </label>
          {need !== undefined && targetPct !== undefined && (
            <span className={need > 100 ? "warn-text" : ""}>
              {need > 100
                ? `Out of reach: it would take ${need.toFixed(1)}% on everything left.`
                : need <= 0
                  ? "Already secured, even with zeros on what's left."
                  : `Average ${need.toFixed(1)}% on the remaining ${(100 - base.weightGraded).toFixed(0)}% of the grade.`}
            </span>
          )}
          {target && need === undefined && <span className="faint">Everything is graded already.</span>}
        </div>
      )}

      <details className="items">
        <summary>
          {graded.length} graded, {upcoming.length} to go
          {g.uncategorized > 0 && c.scheme ? <span className="warn-text"> · {g.uncategorized} not in a category</span> : ""}
          {projected?.percent !== undefined && (
            <span className="proj"> · what-if: <b className="num">{pct(projected.percent)} {projected.letter}</b></span>
          )}
        </summary>
        {graded.map((a) => (
          <div key={a.id} className="row item-grade-row">
            <span>{a.title}{a.countsTowardGrade === false && <span className="faint"> (not counted)</span>}</span>
            <span className="num">{a.score}/{a.possible}{a.scoreIsYours ? "*" : ""}</span>
            <span className="num muted">{a.possible ? pct((a.score! / a.possible) * 100, 0) : ""}</span>
            {c.scheme ? (
              <select value={a.categoryResolved && c.scheme.some((x) => x.name === a.categoryResolved) ? a.categoryResolved : ""} onChange={(e) => void setCategory(a, e.target.value)} aria-label={`${a.title} category`}>
                <option value="">no category</option>
                {c.scheme.map((x) => <option key={x.name}>{x.name}</option>)}
              </select>
            ) : (
              <span className="faint">{a.category ?? ""}</span>
            )}
          </div>
        ))}
        {upcoming.length > 0 && <p className="help pad-x" style={{ marginTop: 8 }}>Try scores for what's left (as a percent) to see where the grade would land:</p>}
        {upcoming.map((a) => (
          <div key={a.id} className="row item-grade-row">
            <span>{a.title}</span>
            <label className="mini">
              <input type="number" min={0} max={150} step={1} placeholder="%" value={hyp[a.id] ?? ""} onChange={(e) => setHyp({ ...hyp, [a.id]: e.target.value })} aria-label={`What-if score for ${a.title}`} />
              %
            </label>
            <span className="faint num">{a.pointsPossible ? `${a.pointsPossible} pts` : ""}</span>
            <span className="faint">{a.categoryResolved ?? ""}</span>
          </div>
        ))}
        {tries.length > 0 && <div className="pad-x"><button type="button" className="link" onClick={() => setHyp({})}>clear what-if scores</button></div>}
      </details>
      <div className="pad-x"><Feedback error={act.error} /></div>
    </Panel>
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
