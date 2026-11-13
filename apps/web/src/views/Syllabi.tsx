import { useEffect, useState } from "react";
import type { AssignmentKind, ConfirmSyllabus, Course, CourseLevel, SyllabusRecord } from "@sd/core";
import { api, COLOR_NAMES, COURSE_COLORS, colorVar, uploadFile, useApi } from "../lib/api";
import { Panel } from "../panels/Panel";

const KINDS: AssignmentKind[] = ["exam", "quiz", "homework", "project", "paper", "lab", "discussion", "reading", "other"];
const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];

export function Syllabi({ onChanged }: { onChanged: () => void }) {
  const list = useApi<SyllabusRecord[]>("/api/syllabi");
  const courses = useApi<Course[]>("/api/courses");
  const [open, setOpen] = useState<SyllabusRecord>();
  const [uploadError, setUploadError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(undefined);
    try {
      const rec = await uploadFile<SyllabusRecord>("/api/syllabus", file);
      await list.reload();
      setOpen(rec);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function openRecord(id: string) {
    setOpen(await api<SyllabusRecord>(`/api/syllabus/${id}`));
  }

  if (open) {
    return (
      <Review
        key={open.id}
        rec={open}
        courses={courses.data ?? []}
        onClose={() => setOpen(undefined)}
        onSaved={async () => {
          await Promise.all([list.reload(), courses.reload()]);
          onChanged();
        }}
      />
    );
  }

  const byId = new Map((courses.data ?? []).map((c) => [c.id, c]));
  return (
    <div className="stack">
      <Panel title="Upload a syllabus" meta="PDF, DOCX, TXT or MD">
        <div className="pad">
          <label
            className={`drop ${dragging ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void upload(f);
            }}
          >
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <span>{uploading ? "Reading…" : "Drop a syllabus here, or click to choose a file"}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              Read on your Mac with plain rules (no AI). You check everything before it's saved.
            </span>
          </label>
          {uploadError && <p className="form-msg error" role="alert">{uploadError}</p>}
        </div>
      </Panel>

      <Panel title="Your syllabi" meta={`${list.data?.length ?? 0}`}>
        {list.error && <p className="empty">{list.error}</p>}
        {list.data?.length === 0 && <p className="empty">None yet.</p>}
        {list.data?.map((s) => {
          const c = s.courseId ? byId.get(s.courseId) : undefined;
          return (
            <div key={s.id} className="row syl-row">
              <span>{s.filename}</span>
              <span className="chip">
                {c ? (
                  <>
                    <span className="swatch" style={{ background: colorVar(c.color) }} /> {c.code}
                  </>
                ) : (
                  <span className="tag warn">needs review</span>
                )}
                {c && !s.confirmed && <span className="tag warn">needs review</span>}
              </span>
              <span className="faint num" style={{ fontSize: 12 }}>{new Date(s.uploadedAt).toLocaleDateString()}</span>
              <span className="chip">
                {s.auto && s.confirmed && <span className="tag ok" title="Pulled from Blackboard and applied because its weights added up to 100%">auto</span>}
                <button type="button" className={`btn ${s.confirmed ? "" : "primary"}`} onClick={() => void openRecord(s.id)}>{s.confirmed ? "Edit" : "Review"}</button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    if (confirm(`Delete ${s.filename}? Due dates and grading weights it added are removed too.`)) {
                      void api(`/api/syllabus/${s.id}`, { method: "DELETE" }).then(async () => {
                        await list.reload();
                        onChanged();
                      });
                    }
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

interface ItemDraft {
  include: boolean;
  date: string;
  time: string;
  title: string;
  kind: AssignmentKind;
  line: string;
}

function Review({ rec, courses, onClose, onSaved }: { rec: SyllabusRecord; courses: Course[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const p = rec.parse;
  const initialCourse = rec.courseId ?? rec.suggestedCourseId ?? (courses.length ? "" : "new");
  const [courseChoice, setCourseChoice] = useState<string>(initialCourse || "new");
  const [nc, setNc] = useState({ code: p.course.code ?? "", name: p.course.title ?? "", credits: "3", level: "regular" as CourseLevel, color: "c1" });
  // Start from what you saved last time, if anything; otherwise from what the parser found.
  const ap = rec.applied;
  const lineFor = (name: string) => p.weights.weights.find((w) => w.name === name)?.line ?? "";
  const [weights, setWeights] = useState(
    ap
      ? ap.weights.map((w) => ({ name: w.name, weight: String(w.weight), dropLowest: w.dropLowest ? String(w.dropLowest) : "", line: lineFor(w.name) }))
      : p.weights.weights.map((w) => ({ name: w.name, weight: String(w.weight), dropLowest: "", line: w.line })),
  );
  const [items, setItems] = useState<ItemDraft[]>(() => {
    const parsed = p.dates.map((d) => ({ include: true, date: d.date, time: "", title: d.title, kind: d.kind, line: d.line }));
    if (!ap) return parsed;
    const saved = ap.items.map((i) => ({ include: true, date: i.date, time: i.time ?? "", title: i.title, kind: i.kind, line: "" }));
    const left = parsed.filter((d) => !ap.items.some((i) => i.date === d.date && i.title === d.title)).map((d) => ({ ...d, include: false }));
    return [...saved, ...left].sort((a, b) => a.date.localeCompare(b.date));
  });
  const [emails, setEmails] = useState((ap?.instructorEmails ?? p.policies.instructorEmails).join(", "));
  const [officeHours, setOfficeHours] = useState(ap ? (ap.officeHours ?? "") : (p.policies.officeHours ?? ""));
  const [latePolicy, setLatePolicy] = useState(ap ? (ap.latePolicy ?? "") : (p.policies.latePolicy ?? ""));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Pick the first unused color for a new course.
    const used = new Set(courses.map((c) => c.color));
    const free = COURSE_COLORS.find((c) => !used.has(c));
    if (free) setNc((x) => ({ ...x, color: free }));
  }, [courses]);

  const total = weights.reduce((s, w) => s + (Number(w.weight) || 0), 0);
  const totalOk = weights.length === 0 || Math.abs(total - 100) <= 0.5;

  async function save() {
    setBusy(true);
    setError(undefined);
    const body: ConfirmSyllabus = {
      ...(courseChoice === "new"
        ? { newCourse: { code: nc.code, name: nc.name, credits: Number(nc.credits), level: nc.level, color: nc.color } }
        : { courseId: courseChoice }),
      weights: weights.filter((w) => w.name.trim()).map((w) => ({ name: w.name, weight: Number(w.weight), dropLowest: Number(w.dropLowest) || undefined })),
      items: items.filter((i) => i.include).map((i) => ({ date: i.date, time: i.time || undefined, title: i.title, kind: i.kind })),
      instructorEmails: emails.split(/[,\s]+/).filter(Boolean),
      officeHours,
      latePolicy,
      letterScale: ap?.letterScale ?? p.letterScale,
    };
    try {
      const r = await api<{ courseId: string; items: number; categories: number }>(`/api/syllabus/${rec.id}/confirm`, { method: "POST", json: body });
      setCourseChoice(r.courseId);
      setSaved(`Saved: ${r.categories} grading categor${r.categories === 1 ? "y" : "ies"} and ${r.items} dated item${r.items === 1 ? "" : "s"}.`);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="review-head">
        <button type="button" className="btn ghost" onClick={onClose}>← All syllabi</button>
        <h1>{rec.filename}</h1>
        <span className="faint">
          {rec.confirmed
            ? rec.auto
              ? "Read and applied automatically (the weights added up to 100%). Change anything and save."
              : "Saved. Change anything and save again."
            : "Check what was found. Nothing is applied until you save."}
        </span>
      </div>

      {p.needsHelp && (
        <div className="notice warn">
          Couldn't find grading weights or dates in this file. If it's a scanned PDF there's no text to read; you can type them in below.
        </div>
      )}

      <Panel title="Course">
        <div className="pad stack-sm">
          <select value={courseChoice} onChange={(e) => setCourseChoice(e.target.value)} aria-label="Course">
            {courseChoice === "" && <option value="">Choose…</option>}
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            <option value="new">+ New course</option>
          </select>
          {rec.suggestedCourseId && courseChoice === rec.suggestedCourseId && !rec.confirmed && (
            <span className="faint" style={{ fontSize: 12 }}>Matched from “{[p.course.code, p.course.title].filter(Boolean).join(" ")}” in the header.</span>
          )}
          {courseChoice === "new" && (
            <div className="inline-form">
              <input placeholder="Code, e.g. CHEM 101" value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value })} aria-label="New course code" style={{ width: 160 }} />
              <input placeholder="Name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} aria-label="New course name" />
              <input type="number" min={0} max={12} step={0.5} value={nc.credits} onChange={(e) => setNc({ ...nc, credits: e.target.value })} aria-label="Credits" style={{ width: 70 }} />
              <select value={nc.level} onChange={(e) => setNc({ ...nc, level: e.target.value as CourseLevel })} aria-label="Level">
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="colors">
                {COURSE_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} className={`color ${nc.color === c ? "on" : ""}`} style={{ background: colorVar(c) }} onClick={() => setNc({ ...nc, color: c })} />
                ))}
              </span>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Grading weights" meta={<span className={totalOk ? "" : "warn-text"}>total {total}%</span>}>
        {weights.map((w, i) => (
          <div key={i} className="row weight-row" title={w.line ? `From: ${w.line}` : undefined}>
            <input value={w.name} onChange={(e) => setWeights(weights.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Category" />
            <label className="mini">
              <input type="number" min={0} max={100} step={0.5} value={w.weight} onChange={(e) => setWeights(weights.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} aria-label={`${w.name} weight`} />
              %
            </label>
            <label className="mini">
              drop lowest
              <input type="number" min={0} max={10} value={w.dropLowest} placeholder="0" onChange={(e) => setWeights(weights.map((x, j) => (j === i ? { ...x, dropLowest: e.target.value } : x)))} aria-label={`${w.name} drop lowest`} style={{ width: 52 }} />
            </label>
            <span className="faint source">{w.line}</span>
            <button type="button" className="btn ghost" onClick={() => setWeights(weights.filter((_, j) => j !== i))} aria-label={`Remove ${w.name}`}>✕</button>
          </div>
        ))}
        <div className="pad">
          <button type="button" className="btn" onClick={() => setWeights([...weights, { name: "", weight: "", dropLowest: "", line: "" }])}>+ Add category</button>
          {!totalOk && <span className="warn-text" style={{ marginLeft: 12, fontSize: 13 }}>Weights should add up to 100%.</span>}
        </div>
      </Panel>

      <Panel title="Dated items" meta={`${items.filter((i) => i.include).length} of ${items.length} selected`}>
        {items.length === 0 && <p className="empty">No dated items found. Add them by hand if the schedule is in a table or image.</p>}
        {items.map((it, i) => {
          const set = (patch: Partial<ItemDraft>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className={`row item-row ${it.include ? "" : "off"}`} title={it.line ? `From: ${it.line}` : undefined}>
              <input type="checkbox" checked={it.include} onChange={(e) => set({ include: e.target.checked })} aria-label={`Include ${it.title}`} />
              <input type="date" value={it.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
              <input type="time" value={it.time} onChange={(e) => set({ time: e.target.value })} aria-label="Time (optional, default 11:59 pm)" title="Leave empty for 11:59 pm" />
              <input value={it.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
              <select value={it.kind} onChange={(e) => set({ kind: e.target.value as AssignmentKind })} aria-label="Type">
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          );
        })}
        <div className="pad">
          <button type="button" className="btn" onClick={() => setItems([...items, { include: true, date: "", time: "", title: "", kind: "homework", line: "" }])}>+ Add item</button>
          <span className="faint" style={{ marginLeft: 12, fontSize: 12 }}>No time = due 11:59 pm. If Blackboard lists the same item, the Blackboard copy wins.</span>
        </div>
      </Panel>

      <Panel title="Instructor and policies">
        <div className="pad form-grid">
          <label>Instructor email(s)<input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@school.edu" /></label>
          <label>Office hours<input value={officeHours} onChange={(e) => setOfficeHours(e.target.value)} /></label>
          <label>Late policy<textarea rows={3} value={latePolicy} onChange={(e) => setLatePolicy(e.target.value)} /></label>
        </div>
      </Panel>

      <div className="save-bar">
        {error && <p className="form-msg error" role="alert">{error}</p>}
        {saved && <p className="form-msg ok">{saved}</p>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Back</button>
        <button type="button" className="btn primary" disabled={busy || !totalOk || (courseChoice === "" )} onClick={() => void save()}>
          {busy ? "Saving…" : rec.confirmed || saved ? "Save changes" : "Save to course"}
        </button>
      </div>
    </div>
  );
}
