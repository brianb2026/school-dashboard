import { useState } from "react";
import type { ConnectorInfo, Course, CourseLevel, SettingsInfo, SyncReport, ToggleKey, UnmatchedItem } from "@sd/core";
import { api, COLOR_NAMES, COURSE_COLORS, colorVar, useApi } from "../lib/api";
import { relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];
const LEVEL_LABEL: Record<CourseLevel, string> = { regular: "Regular", honors: "Honors", ap: "AP", ib: "IB", de: "Dual enrollment" };

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    try {
      const msg = await fn();
      if (msg) setDone(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, run };
}

function Feedback({ error, done }: { error?: string; done?: string }) {
  if (error) return <p className="form-msg error" role="alert">{error}</p>;
  if (done) return <p className="form-msg ok">{done}</p>;
  return null;
}

export function Settings({ onChanged }: { onChanged: () => void }) {
  const settings = useApi<SettingsInfo>("/api/settings");
  const courses = useApi<Course[]>("/api/courses");
  const unmatched = useApi<UnmatchedItem[]>("/api/unmatched");
  const connectors = useApi<ConnectorInfo[]>("/api/connectors");

  async function refreshAll() {
    await Promise.all([settings.reload(), courses.reload(), unmatched.reload(), connectors.reload()]);
    onChanged();
  }

  if (settings.error) return <div className="notice warn">{settings.error}</div>;
  if (!settings.data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <CalendarLink info={settings.data} onSaved={refreshAll} />
      <Courses courses={courses.data ?? []} onChanged={refreshAll} />
      <Unmatched items={unmatched.data ?? []} courses={courses.data ?? []} onChanged={refreshAll} />
      <Connections connectors={connectors.data ?? []} onSynced={refreshAll} />
      <OptIns info={settings.data} onChanged={refreshAll} />
      <About info={settings.data} />
    </div>
  );
}

function CalendarLink({ info, onSaved }: { info: SettingsInfo; onSaved: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const a = useAction();
  const link = info.calendarLink;
  return (
    <Panel title="Blackboard calendar link" meta={link.set ? `connected · ${link.host}` : "not set"}>
      <div className="pad">
        <p className="help">
          Gives the dashboard every due date from Blackboard, with no school IT approval needed. In Blackboard: <b>Calendar</b> → settings (gear) →{" "}
          <b>Share calendar</b> → copy the link. The link works like a password, so it's kept in your Mac's Keychain and never shown again.
        </p>
        {link.fromEnv && <p className="help">Currently read from <code>.env</code>. Saving here overrides it.</p>}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/settings/calendar-link", { method: "PUT", json: { url } });
              setUrl("");
              await onSaved();
              return "Saved. Press Sync now (below) to pull your due dates.";
            });
          }}
        >
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={link.set ? "Paste a new link to replace it" : "https://…/learn.ics or webcal://…"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Blackboard calendar link"
          />
          <button type="submit" className="btn primary" disabled={a.busy || !url.trim()}>Save</button>
          {link.set && !link.fromEnv && (
            <button
              type="button"
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  await api("/api/settings/calendar-link", { method: "DELETE" });
                  await onSaved();
                  return "Removed from the Keychain.";
                })
              }
            >
              Remove
            </button>
          )}
        </form>
        <Feedback error={a.error} done={a.done} />
      </div>
    </Panel>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <span className="colors" role="radiogroup" aria-label="Course color">
      {COURSE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]}
          className={`color ${value === c ? "on" : ""}`}
          style={{ background: colorVar(c) }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  );
}

function Courses({ courses, onChanged }: { courses: Course[]; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ code: "", name: "", credits: "3", level: "regular" as CourseLevel, color: "c1" });
  const a = useAction();
  const edit = useAction();
  const patch = (id: string, body: Partial<Course>) =>
    edit.run(async () => {
      await api(`/api/courses/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
      await onChanged();
    });

  return (
    <Panel title="Courses" meta={`${courses.length} this term`}>
      {courses.length === 0 && <p className="empty">No courses yet. Add them here, or create one while reviewing a syllabus.</p>}
      {courses.map((c) => (
        <div key={c.id} className="row course-row">
          <ColorPicker value={c.color} onChange={(color) => void patch(c.id, { color })} />
          <span className="num">{c.code}</span>
          <span>{c.name}</span>
          <label className="mini">
            <input
              type="number"
              min={0}
              max={12}
              step={0.5}
              defaultValue={c.credits}
              aria-label={`${c.code} credits`}
              onBlur={(e) => Number(e.target.value) !== c.credits && void patch(c.id, { credits: Number(e.target.value) })}
            />
            cr
          </label>
          <select value={c.level} aria-label={`${c.code} level`} onChange={(e) => void patch(c.id, { level: e.target.value as CourseLevel })}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (confirm(`Remove ${c.code}? Its syllabus items and grading weights are removed too; Blackboard items go back to Unmatched.`)) {
                void edit.run(async () => {
                  await api(`/api/courses/${encodeURIComponent(c.id)}`, { method: "DELETE" });
                  await onChanged();
                });
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="pad">
        <Feedback error={edit.error} />
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              const r = await api<{ matched: number }>("/api/courses", { method: "POST", json: { ...form, credits: Number(form.credits) } });
              setForm({ ...form, code: "", name: "" });
              await onChanged();
              return r.matched ? `Added. ${r.matched} unmatched item${r.matched === 1 ? "" : "s"} moved into it.` : "Added.";
            });
          }}
        >
          <input placeholder="Code, e.g. CHEM 101" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-label="Course code" style={{ width: 160 }} />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Course name" />
          <input type="number" min={0} max={12} step={0.5} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} aria-label="Credits" style={{ width: 70 }} />
          <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as CourseLevel })} aria-label="Level">
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
          <button type="submit" className="btn primary" disabled={a.busy || !form.code.trim() || !form.name.trim()}>Add course</button>
        </form>
        <Feedback error={a.error} done={a.done} />
      </div>
    </Panel>
  );
}

function Unmatched({ items, courses, onChanged }: { items: UnmatchedItem[]; courses: Course[]; onChanged: () => Promise<void> }) {
  return (
    <Panel title="Unmatched items" meta={items.length ? `${items.length} to place` : "all placed"}>
      {items.length === 0 ? (
        <p className="empty">Every calendar item belongs to a course.</p>
      ) : (
        <>
          <p className="help pad-x">
            These came from Blackboard without a course code the dashboard recognizes. Pick the course once; items containing the same text
            go there automatically from now on.
          </p>
          {items.map((it) => <UnmatchedRow key={it.id} item={it} courses={courses} onChanged={onChanged} />)}
        </>
      )}
    </Panel>
  );
}

function UnmatchedRow({ item, courses, onChanged }: { item: UnmatchedItem; courses: Course[]; onChanged: () => Promise<void> }) {
  const [courseId, setCourseId] = useState("");
  const [pattern, setPattern] = useState(item.suggestedPattern);
  const a = useAction();
  return (
    <div className="row unmatched-row">
      <div>
        <div>{item.title}</div>
        <div className="faint" style={{ fontSize: 12 }}>{item.dueAt ? relativeDue(item.dueAt) : "no date"}</div>
      </div>
      <label className="mini">
        match text
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Text to remember" />
      </label>
      <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
        <option value="">Choose course…</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
      </select>
      <button
        type="button"
        className="btn"
        disabled={!courseId || pattern.trim().length < 2 || a.busy}
        onClick={() =>
          void a.run(async () => {
            await api("/api/aliases", { method: "POST", json: { pattern, courseId } });
            await onChanged();
          })
        }
      >
        Place
      </button>
      {a.error && <p className="form-msg error" style={{ gridColumn: "1 / -1" }}>{a.error}</p>}
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  ready: "ready",
  "not-configured": "not set up",
  "needs-sign-in": "needs sign-in",
  error: "error",
};

function Connections({ connectors, onSynced }: { connectors: ConnectorInfo[]; onSynced: () => Promise<void> }) {
  const [report, setReport] = useState<SyncReport[]>();
  const a = useAction();
  const byId = new Map(report?.map((r) => [r.connector, r]));
  return (
    <Panel
      title="Connections"
      meta={
        <button
          type="button"
          className="btn primary"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              setReport(await api<SyncReport[]>("/api/sync", { method: "POST" }));
              await onSynced();
            })
          }
        >
          {a.busy ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      {connectors.map((c) => {
        const r = byId.get(c.id);
        const tone = c.status.state === "ready" ? "ok" : c.status.state === "error" ? "danger" : "";
        return (
          <div key={c.id} className="row conn-row">
            <span>{c.label}</span>
            <span className="faint" style={{ fontSize: 12 }}>{c.status.detail ?? c.capabilities.join(", ")}</span>
            <span className={`tag ${tone}`}>{STATE_LABEL[c.status.state] ?? c.status.state}</span>
            <span className="faint num" style={{ fontSize: 12, minWidth: 64, textAlign: "right" }}>
              {r ? (r.ok ? "synced" : c.status.state === "ready" ? "failed" : "skipped") : ""}
            </span>
            {r && !r.ok && c.status.state === "ready" && <p className="form-msg error" style={{ gridColumn: "1 / -1" }}>{r.detail}</p>}
          </div>
        );
      })}
      <div className="pad"><Feedback error={a.error} /></div>
    </Panel>
  );
}

const WARNINGS: Record<ToggleKey, { title: string; body: string }> = {
  blackboardSessionReader: {
    title: "Blackboard session reader",
    body:
      "Opens a real browser window where you sign in to Blackboard yourself; the dashboard then reads the same pages you see (grades, announcements, files). " +
      "Your password is never seen or stored. This may go against your school's acceptable-use rules, and it can break when Blackboard changes. Read-only.",
  },
  gradescopeSessionReader: {
    title: "Gradescope session reader",
    body:
      "Same idea for Gradescope, which has no student API. Many instructors already sync Gradescope scores into Blackboard, so you may not need this. " +
      "Same caveats: possible acceptable-use conflict, can break, read-only.",
  },
};

function OptIns({ info, onChanged }: { info: SettingsInfo; onChanged: () => Promise<void> }) {
  return (
    <Panel title="Optional readers" meta="off unless you turn them on">
      <p className="help pad-x">Sign-in windows for these arrive in v0.3. Turning one on now just marks it as wanted.</p>
      {(Object.keys(WARNINGS) as ToggleKey[]).map((k) => (
        <OptIn key={k} k={k} on={info.toggles[k]} onChanged={onChanged} />
      ))}
    </Panel>
  );
}

function OptIn({ k, on, onChanged }: { k: ToggleKey; on: boolean; onChanged: () => Promise<void> }) {
  const [ack, setAck] = useState(false);
  const a = useAction();
  const w = WARNINGS[k];
  const set = (enabled: boolean) =>
    a.run(async () => {
      await api("/api/settings/toggles", { method: "PUT", json: { key: k, enabled, acknowledged: enabled ? ack : undefined } });
      setAck(false);
      await onChanged();
    });
  return (
    <div className="optin">
      <div className="optin-head">
        <b>{w.title}</b>
        <span className={`tag ${on ? "warn" : ""}`}>{on ? "on" : "off"}</span>
      </div>
      <p className="help">{w.body}</p>
      {on ? (
        <button type="button" className="btn" disabled={a.busy} onClick={() => void set(false)}>Turn off</button>
      ) : (
        <div className="inline-form">
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the risks above
          </label>
          <button type="button" className="btn" disabled={!ack || a.busy} onClick={() => void set(true)}>Turn on</button>
        </div>
      )}
      <Feedback error={a.error} />
    </div>
  );
}

function About({ info }: { info: SettingsInfo }) {
  return (
    <Panel title="School settings" meta="edit config/school.json to change">
      <dl className="facts">
        <dt>Term</dt><dd>{info.term.name} <span className="faint num">{info.term.start} → {info.term.end}</span></dd>
        <dt>Time zone</dt><dd className="num">{info.timezone}</dd>
        <dt>GPA scale</dt><dd className="num">{info.gpaScale}</dd>
        <dt>AI</dt><dd>{info.ai.provider === "none" ? "off (AI_PROVIDER=none)" : info.ai.provider}</dd>
      </dl>
    </Panel>
  );
}
