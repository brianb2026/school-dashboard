import { useState } from "react";
import type { ConnectorInfo, CourseLevel, CourseView, SettingsInfo, SyncReport, UnmatchedItem } from "@sd/core";
import { LinkBlackboard } from "../components/LinkBlackboard";
import { api, COLOR_NAMES, COURSE_COLORS, colorVar, enc, useApi } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { ago, relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];
const LEVEL_LABEL: Record<CourseLevel, string> = { regular: "Regular", honors: "Honors", ap: "AP", ib: "IB", de: "Dual enrollment" };

export function Settings() {
  const { d, reload } = useDash();
  const settings = useApi<SettingsInfo>("/api/settings");
  const unmatched = useApi<UnmatchedItem[]>("/api/unmatched");
  const connectors = useApi<ConnectorInfo[]>("/api/connectors");
  const refresh = async () => {
    await Promise.all([settings.reload(), unmatched.reload(), connectors.reload(), reload()]);
  };

  if (settings.error) return <div className="notice warn">{settings.error}</div>;
  if (!settings.data) return <p className="muted">Loading…</p>;
  const s = settings.data;

  return (
    <div className="stack">
      <Blackboard info={s} onChanged={refresh} />
      {(unmatched.data?.length ?? 0) > 0 && <Unmatched items={unmatched.data ?? []} courses={d.courses} onChanged={refresh} />}
      <Courses onChanged={refresh} />
      <Extras info={s} onChanged={refresh} />
      <Connections connectors={connectors.data ?? []} onSynced={refresh} />
      <About info={s} onChanged={refresh} />
    </div>
  );
}

function Blackboard({ info, onChanged }: { info: SettingsInfo; onChanged: () => Promise<void> }) {
  const { d } = useDash();
  const bb = d.links.blackboard;
  const a = useAction();
  return (
    <Panel
      title="Blackboard"
      meta={bb.linked ? (bb.expired ? <span className="warn-text">sign-in expired</span> : `linked · ${bb.host}${bb.via === "api" ? " · official API" : ""}`) : "not linked"}
    >
      <div className="pad">
        {bb.linked && !bb.expired && (
          <p className="help">
            Linked. Courses, grades, announcements and due dates refresh every 30 minutes; files and syllabi every few hours. If the sign-in ever lapses you'll see a
            Reconnect button, and it often renews by itself.
          </p>
        )}
        {!info.chromeFound && !bb.linked && (
          <p className="form-msg error">Google Chrome wasn't found. The sign-in window needs Chrome (or Edge/Brave). Install it, then come back.</p>
        )}
        <LinkBlackboard compact />
        {bb.linked && (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <button type="button" className="btn" disabled={a.busy}
              onClick={() => confirm("Unlink Blackboard? The saved sign-in is deleted. What was already pulled in stays until you wipe it.") &&
                void a.run(async () => { await api("/api/link/blackboard", { method: "DELETE" }); await onChanged(); return "Unlinked. The saved sign-in was deleted."; })}>
              Unlink
            </button>
          </div>
        )}
        <Feedback error={a.error} done={a.done} />
      </div>
    </Panel>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <span className="colors" role="radiogroup" aria-label="Course color">
      {COURSE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]}
          className={`color ${value === c ? "on" : ""}`} style={{ background: colorVar(c) }} onClick={() => onChange(c)} />
      ))}
    </span>
  );
}

function Courses({ onChanged }: { onChanged: () => Promise<void> }) {
  const { d } = useDash();
  const free = COURSE_COLORS.find((c) => !d.courses.some((x) => x.color === c)) ?? "c1";
  const [form, setForm] = useState({ code: "", name: "", credits: "3", level: "regular" as CourseLevel, color: free as string });
  const a = useAction();
  const edit = useAction();
  const patch = (id: string, body: object) =>
    edit.run(async () => {
      await api(`/api/courses/${enc(id)}`, { method: "PATCH", json: body });
      await onChanged();
    });
  const remove = (c: CourseView) => {
    const fromBb = c.sources.some((x) => x.source.startsWith("blackboard-") && x.source !== "blackboard-ical");
    const msg = fromBb
      ? `Hide ${c.code}? It stops showing and syncing. You can bring it back below.`
      : `Remove ${c.code}? Its syllabus items and grading weights are removed too.`;
    if (!confirm(msg)) return;
    void edit.run(async () => {
      await api(`/api/courses/${enc(c.id)}`, { method: "DELETE" });
      await onChanged();
    });
  };

  return (
    <Panel title="Classes" meta={`${d.courses.length} this term`}>
      {d.courses.length === 0 && <p className="empty">Classes come in from Blackboard. You can also add one by hand below.</p>}
      {d.courses.map((c) => (
        <div key={c.id} className="row course-row">
          <ColorPicker value={c.color} onChange={(color) => void patch(c.id, { color })} />
          <span className="num">{c.code}</span>
          <span>{c.name}</span>
          <label className="mini" title="Credit hours, used for GPA">
            <input type="number" min={0} max={12} step={0.5} defaultValue={c.credits} key={c.credits} aria-label={`${c.code} credits`}
              onBlur={(e) => Number(e.target.value) !== c.credits && void patch(c.id, { credits: Number(e.target.value) })} />
            cr
          </label>
          <select value={c.level} aria-label={`${c.code} level`} onChange={(e) => void patch(c.id, { level: e.target.value })}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          <button type="button" className="btn ghost" onClick={() => remove(c)}>Remove</button>
        </div>
      ))}
      {d.hiddenCourses.length > 0 && (
        <div className="pad-x hidden-list">
          <span className="faint">Hidden:</span>
          {d.hiddenCourses.map((c) => (
            <button key={c.id} type="button" className="tag as-button" title={`Show ${c.name} again`} onClick={() => void patch(c.id, { hidden: false })}>
              {c.code} · show again
            </button>
          ))}
        </div>
      )}
      <details className="pad adv">
        <summary>Add a class by hand</summary>
        <form
          className="inline-form"
          style={{ marginTop: 8 }}
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
          <input placeholder="Code, e.g. CHEM 101" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-label="Course code" style={{ flex: "0 1 170px" }} />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Course name" />
          <input type="number" min={0} max={12} step={0.5} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} aria-label="Credits" style={{ width: 70 }} />
          <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as CourseLevel })} aria-label="Level">
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
          <button type="submit" className="btn primary" disabled={a.busy || !form.code.trim() || !form.name.trim()}>Add class</button>
        </form>
        <Feedback error={a.error} done={a.done} />
      </details>
      <div className="pad-x"><Feedback error={edit.error} /></div>
    </Panel>
  );
}

function Unmatched({ items, courses, onChanged }: { items: UnmatchedItem[]; courses: CourseView[]; onChanged: () => Promise<void> }) {
  return (
    <Panel title="Unmatched items" meta={`${items.length} to place`}>
      <p className="help pad-x">
        These calendar items don't carry a course code the dashboard recognizes. Pick the class once; items containing the same text go there automatically from now on.
      </p>
      {items.map((it) => <UnmatchedRow key={it.id} item={it} courses={courses} onChanged={onChanged} />)}
    </Panel>
  );
}

function UnmatchedRow({ item, courses, onChanged }: { item: UnmatchedItem; courses: CourseView[]; onChanged: () => Promise<void> }) {
  const [courseId, setCourseId] = useState("");
  const [pattern, setPattern] = useState(item.suggestedPattern);
  const a = useAction();
  return (
    <div className="row unmatched-row">
      <div>
        <div>{item.title}</div>
        <div className="faint" style={{ fontSize: 12 }}>{item.dueAt ? relativeDue(item.dueAt) : "no date"}</div>
      </div>
      <label className="mini">match text<input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Text to remember" /></label>
      <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Class">
        <option value="">Choose class…</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
      </select>
      <button type="button" className="btn" disabled={!courseId || pattern.trim().length < 2 || a.busy}
        onClick={() => void a.run(async () => { await api("/api/aliases", { method: "POST", json: { pattern, courseId } }); await onChanged(); })}>
        Place
      </button>
      {a.error && <p className="form-msg error" style={{ gridColumn: "1 / -1" }}>{a.error}</p>}
    </div>
  );
}

/** The optional add-ons: Gradescope, Gmail, the calendar-link fallback, alerts. */
function Extras({ info, onChanged }: { info: SettingsInfo; onChanged: () => Promise<void> }) {
  const { d, link } = useDash();
  const gs = d.links.gradescope;
  const gm = d.links.gmail;
  const a = useAction();
  const [url, setUrl] = useState("");
  const cal = info.calendarLink;
  return (
    <Panel title="More sources" meta="all optional">
      <div className="optin">
        <div className="optin-head"><b>Gradescope</b><span className={`tag ${gs.linked ? (gs.expired ? "warn" : "ok") : ""}`}>{gs.linked ? (gs.expired ? "expired" : "linked") : "off"}</span></div>
        <p className="help">
          Scores that live only in Gradescope. Same idea as Blackboard: you sign in yourself in a window, the app only reads. Often not needed, because instructors usually
          send Gradescope scores to Blackboard.
        </p>
        <div className="inline-form">
          <button type="button" className="btn" onClick={() => void link("gradescope")}>{gs.linked ? "Sign in again" : "Link Gradescope"}</button>
          {gs.linked && <button type="button" className="btn ghost" onClick={() => void a.run(async () => { await api("/api/link/gradescope", { method: "DELETE" }); await onChanged(); })}>Unlink</button>}
        </div>
      </div>

      <div className="optin">
        <div className="optin-head"><b>Gmail</b><span className={`tag ${gm.connected ? "ok" : ""}`}>{gm.connected ? "connected" : "off"}</span></div>
        <p className="help">
          Shows email from your teachers in the Inbox and sends your messages straight from the dashboard. Writing to a professor already works without this (it opens
          Gmail with the message filled in).
          {!gm.configured && <> Needs a one-time Google setup first: see <code>docs/connectors.md</code>, then put the client ID and secret in <code>.env</code>.</>}
        </p>
        <div className="inline-form">
          <button type="button" className="btn" disabled={!gm.configured || a.busy}
            onClick={() => void a.run(async () => {
              const r = await api<{ openUrl: string }>("/api/link/gmail", { method: "POST", json: {} });
              window.open(r.openUrl, "_blank", "noopener");
              return "Finish signing in on Google's page, then come back here.";
            })}>
            {gm.connected ? "Connect again" : "Connect Gmail"}
          </button>
          {gm.connected && <button type="button" className="btn ghost" onClick={() => void a.run(async () => { await api("/api/link/gmail", { method: "DELETE" }); await onChanged(); })}>Disconnect</button>}
        </div>
      </div>

      <div className="optin">
        <div className="optin-head"><b>Desktop alerts</b><span className={`tag ${info.notifications ? "ok" : ""}`}>{info.notifications ? "on" : "off"}</span></div>
        <p className="help">A Mac notification when a grade is posted, an announcement arrives, or something is due in 3 days, 1 day and 3 hours.</p>
        <button type="button" className="btn"
          onClick={() => void a.run(async () => { await api("/api/settings/notifications", { method: "PUT", json: { enabled: !info.notifications } }); await onChanged(); })}>
          Turn {info.notifications ? "off" : "on"}
        </button>
      </div>

      <details className="optin adv">
        <summary>Blackboard calendar link <span className="faint">(fallback if you'd rather not link: due dates only){cal.set ? ` · set · ${cal.host}` : ""}</span></summary>
        <p className="help" style={{ marginTop: 8 }}>
          In Blackboard: <b>Calendar</b> → settings (gear) → <b>Share calendar</b> → copy the link. It works like a password, so it's stored encrypted and never shown again.
          {cal.fromEnv && <> Currently read from <code>.env</code>.</>}
        </p>
        <form className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/settings/calendar-link", { method: "PUT", json: { url } });
              setUrl("");
              await api("/api/sync", { method: "POST", json: { deep: false } });
              await onChanged();
              return "Saved and synced.";
            });
          }}>
          <input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder={cal.set ? "Paste a new link to replace it" : "https://…/learn.ics or webcal://…"}
            value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Blackboard calendar link" />
          <button type="submit" className="btn primary" disabled={a.busy || !url.trim()}>Save</button>
          {cal.set && !cal.fromEnv && (
            <button type="button" className="btn" disabled={a.busy}
              onClick={() => void a.run(async () => { await api("/api/settings/calendar-link", { method: "DELETE" }); await onChanged(); return "Removed."; })}>
              Remove
            </button>
          )}
        </form>
      </details>
      <div className="pad-x"><Feedback error={a.error} done={a.done} /></div>
    </Panel>
  );
}

const STATE_LABEL: Record<string, string> = { ready: "ready", "not-configured": "off", "needs-sign-in": "needs sign-in", error: "error" };

function Connections({ connectors, onSynced }: { connectors: ConnectorInfo[]; onSynced: () => Promise<void> }) {
  const [report, setReport] = useState<SyncReport[]>();
  const a = useAction();
  const byId = new Map(report?.map((r) => [r.connector, r]));
  return (
    <Panel
      title="What's connected"
      meta={
        <button type="button" className="btn primary" disabled={a.busy}
          onClick={() => void a.run(async () => { setReport(await api<SyncReport[]>("/api/sync", { method: "POST", json: {} })); await onSynced(); })}>
          {a.busy ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      {connectors.filter((c) => c.id !== "manual").map((c) => {
        const r = byId.get(c.id);
        const tone = c.status.state === "ready" ? "ok" : c.status.state === "error" || c.status.state === "needs-sign-in" ? "warn" : "";
        const notes = r?.ok ? r.notes : (c.notes ?? (c.status.detail ? [c.status.detail] : []));
        return (
          <div key={c.id} className="row conn-row">
            <span>{c.label}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {(notes?.length ? notes : [c.status.detail ?? ""]).map((n, i) => <span key={i} className="note">{n}</span>)}
            </span>
            <span className={`tag ${tone}`}>{STATE_LABEL[c.status.state] ?? c.status.state}</span>
            <span className="faint num" style={{ fontSize: 12, minWidth: 80, textAlign: "right" }}>
              {r ? (r.ok ? "synced" : c.status.state === "ready" ? "failed" : "") : c.status.lastSyncAt ? ago(c.status.lastSyncAt) : ""}
            </span>
            {r && !r.ok && c.status.state === "ready" && <p className="form-msg error" style={{ gridColumn: "1 / -1" }}>{r.detail}</p>}
          </div>
        );
      })}
      <div className="pad-x"><Feedback error={a.error} /></div>
    </Panel>
  );
}

function About({ info, onChanged }: { info: SettingsInfo; onChanged: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const a = useAction();
  return (
    <Panel title="School settings and your data" meta="everything stays on this Mac">
      <dl className="facts">
        <dt>Term</dt><dd>{info.term.name} <span className="faint num">{info.term.start} → {info.term.end}</span></dd>
        <dt>Time zone</dt><dd className="num">{info.timezone}</dd>
        <dt>GPA scale</dt><dd className="num">{info.gpaScale} <span className="faint">(edit config/school.json to change these)</span></dd>
        <dt>AI</dt><dd>{info.ai.provider === "none" ? "off: nothing is sent to any AI service" : info.ai.provider}</dd>
      </dl>
      <details className="pad adv">
        <summary>Delete all my data</summary>
        <p className="help" style={{ marginTop: 8 }}>
          Removes every class, grade, file and message from this Mac, plus the saved sign-ins and the sign-in browser's profile. Nothing in Blackboard changes. This can't be undone.
        </p>
        <div className="inline-form">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type WIPE to confirm" aria-label="Type WIPE to confirm" style={{ flex: "0 1 220px" }} />
          <button type="button" className="btn danger" disabled={typed !== "WIPE" || a.busy}
            onClick={() => void a.run(async () => { await api("/api/wipe", { method: "POST", json: { confirm: "WIPE" } }); setTyped(""); await onChanged(); return "Everything was deleted."; })}>
            Delete everything
          </button>
        </div>
        <Feedback error={a.error} done={a.done} />
      </details>
    </Panel>
  );
}
