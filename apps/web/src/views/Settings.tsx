import { useState } from "react";
import type { ConnectorInfo, CourseLevel, CourseView, SettingsInfo, SyncReport, UnmatchedItem } from "@sd/core";
import { ClassTimes } from "../components/ClassTimes";
import { pickTheme, ThemePicker } from "../components/ThemeMenu";
import { ReadingsList } from "../components/ReadingsMenu";
import { Switch } from "../components/Switch";
import { setPref } from "../lib/prefs";
import { savedTheme, type Theme } from "../lib/theme";
import { LinkBlackboard } from "../components/LinkBlackboard";
import { api, COLOR_NAMES, COURSE_COLORS, colorVar, enc, useApi } from "../lib/api";
import { Feedback, useAction, useDash } from "../lib/dash";
import { ago, relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];
const LEVEL_LABEL: Record<CourseLevel, string> = { regular: "Regular", honors: "Honors", ap: "AP", ib: "IB", de: "Dual enrollment" };

/** Search inside course files: the app reads them a few at a time to build a search index on this Mac. */
function FileSearch() {
  const s = useApi<{ indexed: number; readable: number; on: boolean }>("/api/search/status");
  const a = useAction();
  if (!s.data) return null;
  return (
    <div className="brief-set">
      <p className="menu-note">Search inside files (⌘K)</p>
      <Switch
        on={s.data.on}
        onChange={(on) =>
          void a.run(async () => {
            await api("/api/search", { method: "PUT", json: { on } });
            await s.reload();
          })
        }
        label={s.data.on ? `on · ${s.data.indexed} of ${s.data.readable} files read` : "off"}
      />
      <p className="faint" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: "46ch" }}>
        PDFs, slides, Word and text files are read on this Mac, a few after each sync. Turning it off forgets what was read.
      </p>
      <Feedback error={a.error} />
    </div>
  );
}

/** The morning brief: one notification a day with today's classes, what's due, and what changed. */
function Brief() {
  const b = useApi<{ time: string; lines: string[] }>("/api/brief");
  const [time, setTime] = useState<string>();
  const a = useAction();
  if (!b.data) return null;
  const on = b.data.time !== "off";
  const shown = time ?? (on ? b.data.time : "08:00");
  const save = (t: string) =>
    a.run(async () => {
      await api("/api/brief", { method: "PUT", json: { time: t } });
      await b.reload();
    });
  return (
    <div className="brief-set">
      <p className="menu-note">Morning brief (a Mac notification)</p>
      <div className="inline-form">
        <Switch on={on} onChange={(v) => void save(v ? shown : "off")} label={on ? "at" : "off"} />
        <input
          type="time"
          value={shown}
          disabled={!on}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => time && time !== b.data!.time && void save(time)}
          aria-label="Morning brief time"
        />
        <button type="button" className="btn ghost sm" disabled={a.busy} onClick={() => void a.run(async () => { await api("/api/brief/send", { method: "POST", json: {} }); return "Sent."; })}>
          Send one now
        </button>
      </div>
      <ul className="brief-preview">
        {b.data.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <Feedback error={a.error} done={a.done} />
    </div>
  );
}

/** How the dashboard looks: theme, readings, the tour. */
function Display() {
  const { d, go } = useDash();
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <Panel title="Display" meta="saved in this browser">
      <div className="display pad">
        <ThemePicker
          value={theme}
          onPick={(t) => {
            setTheme(t);
            pickTheme(t);
          }}
        />
        <div className="display-side">
          <div>
            <p className="menu-note">Readings (“read chapter 3 for class”)</p>
            <ReadingsList courses={d.courses} />
          </div>
          <Brief />
          <FileSearch />
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPref("tour", undefined);
              go("Home");
            }}
          >
            Show the tour again
          </button>
        </div>
      </div>
    </Panel>
  );
}

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
      {s.demo && (
        <div className="notice warn">
          This is the <b>demo</b>, with made-up classes. It only links to its own pretend Blackboard and is erased each time it starts. For your real classes, run <code>npm start</code> (or double-click start.command).
        </div>
      )}
      {(d.links.blackboard.linked || !d.links.canvas.linked) && <Blackboard info={s} onChanged={refresh} />}
      {(d.links.canvas.linked || !d.links.blackboard.linked) && <Canvas onChanged={refresh} />}
      <Sis onChanged={refresh} />
      <Display />
      {(unmatched.data?.length ?? 0) > 0 && <Unmatched items={unmatched.data ?? []} courses={d.courses} onChanged={refresh} />}
      <Courses onChanged={refresh} />
      <ClassTimes />
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
            Linked. Courses, grades, announcements, due dates, files and syllabi refresh by themselves every 30 minutes, and right after you link anything. If the
            sign-in ever lapses you'll see a Reconnect button, and it often renews by itself.
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

/** Canvas: the sign-in window (any school), or a personal access token where a school allows it. */
function Canvas({ onChanged }: { onChanged: () => Promise<void> }) {
  const { d, link } = useDash();
  const cv = d.links.canvas;
  const [url, setUrl] = useState(cv.host ?? "");
  const [token, setToken] = useState("");
  const a = useAction();
  return (
    <Panel title="Canvas" meta={cv.linked ? (cv.expired ? <span className="warn-text">sign-in expired</span> : `linked · ${cv.host}${cv.via === "token" ? " · access token" : ""}`) : "not linked"}>
      <div className="pad">
        <p className="help">
          For schools on Canvas (UVA's is canvas.its.virginia.edu). Classes, assignments with your scores, group weights, Canvas's own total, announcements,
          modules and files come in, read-only.
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void link("canvas", url.trim() || undefined);
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="canvas.school.edu" aria-label="Your school's Canvas address" autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn primary" disabled={!url.trim() && !cv.host}>
            {cv.linked ? "Sign in again" : "Link Canvas"}
          </button>
        </form>
        <details className="adv" style={{ marginTop: 10 }}>
          <summary>Use an access token instead</summary>
          <p className="help" style={{ marginTop: 8 }}>
            Some schools let you make one in Canvas: Account → Settings → New access token. Paste it here. It's checked once, then kept encrypted on this Mac.
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api("/api/link/canvas-token", { method: "PUT", json: { baseUrl: url.trim() || cv.host, token } });
                setToken("");
                await onChanged();
                return "Linked with your token. Syncing now.";
              });
            }}
          >
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" aria-label="Canvas access token" autoComplete="off" />
            <button type="submit" className="btn" disabled={a.busy || !token.trim() || (!url.trim() && !cv.host)}>
              Save token
            </button>
          </form>
        </details>
        {cv.linked && (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={a.busy}
              onClick={() =>
                confirm("Unlink Canvas? The saved sign-in (or token) is deleted, and what Canvas added is removed.") &&
                void a.run(async () => {
                  await api("/api/link/canvas", { method: "DELETE" });
                  await onChanged();
                  return "Unlinked.";
                })
              }
            >
              Unlink
            </button>
          </div>
        )}
        <Feedback error={a.error} done={a.done} />
      </div>
    </Panel>
  );
}

/** The student information system (PeopleSoft, as at UVA): the official record, schedule, holds. */
function Sis({ onChanged }: { onChanged: () => Promise<void> }) {
  const { d, link } = useDash();
  const s = d.links.sis;
  const [url, setUrl] = useState(s.host ?? "");
  const a = useAction();
  const v = d.sis;
  return (
    <Panel title="Student information system (SIS)" meta={s.linked ? (s.expired ? <span className="warn-text">sign-in expired</span> : `linked · ${s.host}`) : "not linked"}>
      <div className="pad">
        <p className="help">
          Reads your Student Center and course history: when and where each class meets, holds, enrollment dates, and your official grades (the GPA is
          worked out from them). Works with PeopleSoft SIS sites, like UVA's (sisuva.admin.virginia.edu). It only reads; it never enrolls, drops or pays
          anything. It's read when you sign in and a few times a day, because the SIS signs you out quickly.
        </p>
        {v && (
          <p className="help">
            Last read {ago(v.fetchedAt)}: {v.terms.reduce((n, t) => n + t.courses.length, 0)} courses on record
            {v.gpa !== undefined ? `, GPA ${v.gpa.toFixed(2)}` : ""}, {v.holds.length} hold{v.holds.length === 1 ? "" : "s"}.
          </p>
        )}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void link("sis", url.trim() || undefined);
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="sis.school.edu" aria-label="Your school's SIS address" autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn primary" disabled={!url.trim() && !s.host}>
            {s.linked ? "Sign in again" : "Link SIS"}
          </button>
        </form>
        {s.linked && (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={a.busy}
              onClick={() =>
                confirm("Unlink the SIS? The saved sign-in and the record read from it are deleted.") &&
                void a.run(async () => {
                  await api("/api/link/sis", { method: "DELETE" });
                  await onChanged();
                  return "Unlinked.";
                })
              }
            >
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
  const a = useAction();
  const [url, setUrl] = useState("");
  const cal = info.calendarLink;
  return (
    <Panel title="More sources" meta="all optional">
      <div className="optin">
        <div className="optin-head"><b>Gradescope</b><span className={`tag ${gs.linked ? (gs.expired ? "warn" : "ok") : ""}`}>{gs.linked ? (gs.expired ? "expired" : "linked") : "off"}</span></div>
        <p className="help">
          Scores that live in Gradescope, including ones your instructor never sends to Blackboard.{" "}
          {gs.viaBlackboard
            ? "Your school opens Gradescope through Blackboard, so there is nothing to type: it links by itself right after Blackboard, using the same sign-in."
            : "You sign in yourself in a window; the app only reads."}
        </p>
        <div className="inline-form">
          <button type="button" className="btn" onClick={() => void link("gradescope")}>
            {gs.linked ? (gs.viaBlackboard ? "Link again" : "Sign in again") : gs.viaBlackboard ? "Link through Blackboard" : "Link Gradescope"}
          </button>
          {gs.linked && <button type="button" className="btn ghost" onClick={() => void a.run(async () => { await api("/api/link/gradescope", { method: "DELETE" }); await onChanged(); })}>Unlink</button>}
        </div>
      </div>

      <Gmail info={info} onChanged={onChanged} />

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

/** Gmail: a one-time Google setup (done here, not in a file), then one click to connect. */
function Gmail({ info, onChanged }: { info: SettingsInfo; onChanged: () => Promise<void> }) {
  const { d } = useDash();
  const gm = d.links.gmail;
  const a = useAction();
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [setup, setSetup] = useState(false);
  const connect = () =>
    a.run(async () => {
      const r = await api<{ openUrl: string }>("/api/link/gmail", { method: "POST", json: {} });
      window.open(r.openUrl, "_blank", "noopener");
      return "Finish signing in on Google's page, then come back here. Mail syncs by itself once you do.";
    });
  const showSetup = !info.demo && (!gm.configured || setup);
  return (
    <div className="optin">
      <div className="optin-head"><b>Gmail</b><span className={`tag ${gm.connected ? "ok" : ""}`}>{gm.connected ? "connected" : gm.configured ? "ready to connect" : "off"}</span></div>
      <p className="help">
        Shows email from your teachers in the Inbox and sends your messages straight from the dashboard. Writing to a professor already works without this (it opens
        Gmail with the message filled in).
      </p>
      {info.demo && <p className="help">This is the demo. Start the real app (<code>npm start</code>) to connect Gmail.</p>}
      {showSetup && (
        <div className="setup">
          <p className="help">
            Google only lets an app read mail after a one-time setup that <b>you</b> own, so no one else's server ever sits between you and your mail. It takes about
            five minutes and is free:
          </p>
          <ol className="steps">
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer noopener">Google Cloud: new project</a> and create one (any name).</li>
            <li>Turn on the <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer noopener">Gmail API</a> for it.</li>
            <li>
              On the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer noopener">Google Auth page</a>, fill in the app name and your
              email. Pick <b>Internal</b> if your school account offers it; otherwise <b>External</b>, and add yourself under <b>Test users</b>.
            </li>
            <li>
              <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noreferrer noopener">Create a client</a> of type <b>Desktop app</b>. Google
              shows a client ID and a client secret: paste both below.
            </li>
          </ol>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api("/api/settings/gmail", { method: "PUT", json: { clientId: id, clientSecret: secret } });
                setId("");
                setSecret("");
                setSetup(false);
                await onChanged();
                await connect();
                return "Saved. Finish signing in on Google's page, then come back here.";
              });
            }}
          >
            <input placeholder="Client ID (ends with .apps.googleusercontent.com)" value={id} onChange={(e) => setId(e.target.value)} aria-label="Google client ID" autoComplete="off" spellCheck={false} />
            <input type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Google client secret" autoComplete="off" style={{ flex: "0 1 220px" }} />
            <button type="submit" className="btn primary" disabled={a.busy || !id.trim() || !secret.trim()}>Save and connect</button>
          </form>
          <p className="help faint">
            The secret is stored encrypted on this Mac. Sign-in comes back to <code>{info.gmailRedirectUri}</code>, which a Desktop app client allows by itself.
          </p>
        </div>
      )}
      {!info.demo && gm.configured && (
        <div className="inline-form">
          <button type="button" className="btn" disabled={a.busy} onClick={() => void connect()}>{gm.connected ? "Connect again" : "Connect Gmail"}</button>
          {gm.connected && <button type="button" className="btn ghost" onClick={() => void a.run(async () => { await api("/api/link/gmail", { method: "DELETE" }); await onChanged(); })}>Disconnect</button>}
          {!setup && <button type="button" className="link faint-link" onClick={() => setSetup(true)}>change Google setup</button>}
        </div>
      )}
      <Feedback error={a.error} done={a.done} />
    </div>
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
