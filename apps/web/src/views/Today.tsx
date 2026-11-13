import { LinkBlackboard } from "../components/LinkBlackboard";
import { colorVar } from "../lib/api";
import { courseMap, useDash } from "../lib/dash";
import { hhmm, pct, relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const BASIS: Record<string, string> = { blackboard: "Blackboard", syllabus: "syllabus weights", points: "points so far", none: "" };

function step(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 7) return 3;
  return 4;
}

export function Today() {
  const { d, go } = useDash();
  if (!d.hasData && !d.links.blackboard.linked) return <Welcome />;

  const cm = courseMap(d);
  const now = Date.now();
  const due = d.assignments
    .filter((a) => !a.done && a.dueAt && (Date.parse(a.dueAt) >= now || a.late))
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 10);
  const conflicts = d.workload.filter((w) => w.conflict).length;
  const today = new Date().getDay();
  const classes = d.courses
    .flatMap((c) => c.meetings.filter((m) => m.weekday === today).map((m) => ({ c, m })))
    .sort((a, b) => a.m.start.localeCompare(b.m.start));
  const news = [
    ...d.announcements.map((a) => ({ id: a.id, from: cm.get(a.courseId ?? "")?.code ?? "Blackboard", subject: a.title, at: a.postedAt, kind: "announcement", unread: !a.read, color: cm.get(a.courseId ?? "")?.color })),
    ...d.messages.map((m) => ({ id: m.id, from: m.from.name, subject: m.subject, at: m.receivedAt, kind: "email", unread: m.unread, color: cm.get(m.courseId ?? "")?.color })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <div className="grid">
      <Panel title="Due next" meta={<button type="button" className="link" onClick={() => go("Assignments")}>all assignments</button>} className="span-7">
        {due.length === 0 && <p className="empty">Nothing due. Enjoy it.</p>}
        {due.map((a) => (
          <div key={a.id} className="row due-row">
            <span className="num muted" style={{ fontSize: 12 }}>{relativeDue(a.dueAt!)}</span>
            <span>{a.title}</span>
            <span className="chip">
              <span className="swatch" style={{ background: colorVar(cm.get(a.courseId)?.color) }} />
              {cm.get(a.courseId)?.code ?? "Unmatched"}
            </span>
            {a.late ? <span className="tag danger">late</span> : <span className="tag">{a.kind}</span>}
          </div>
        ))}
      </Panel>

      <Panel title="Workload, next 14 days" meta={`${conflicts} conflict${conflicts === 1 ? "" : "s"}`} className="span-5">
        <div className="heat">
          {d.workload.map((w) => (
            <div
              key={w.day}
              className={`cell ${w.conflict ? "conflict" : ""}`}
              style={{ background: `var(--heat-${step(w.hours)})` }}
              title={`${longDay.format(new Date(`${w.day}T12:00:00Z`))}: ${w.count} item${w.count === 1 ? "" : "s"}, about ${w.hours} h`}
            />
          ))}
          {d.workload.map((w) => <span key={`l${w.day}`} className="day">{weekday.format(new Date(`${w.day}T12:00:00Z`))}</span>)}
        </div>
        <div className="legend">
          less {[0, 1, 2, 3, 4].map((s) => <span key={s} className="cell" style={{ background: `var(--heat-${s})` }} />)} more
          <span style={{ marginLeft: "auto" }}>outlined = deadline pile-up</span>
        </div>
        {classes.length > 0 && (
          <div className="today-classes">
            {classes.map(({ c, m }) => (
              <span key={`${c.id}${m.start}`} className="chip">
                <span className="swatch" style={{ background: colorVar(c.color) }} />
                {c.code} <span className="num faint">{hhmm(m.start)}</span> {m.location && <span className="faint">{m.location}</span>}
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Grades" meta={<button type="button" className="link" onClick={() => go("Grades")}>details and what-if</button>} className="span-7">
        {d.courses.length === 0 && <p className="empty">Your classes show up here once Blackboard is linked.</p>}
        {d.courses.map((c) => (
          <div key={c.id} className="row grade-row">
            <span className="chip" style={{ color: "var(--text)", fontSize: 14 }}>
              <span className="swatch" style={{ background: colorVar(c.color) }} />
              {c.name} <span className="faint">{c.code}</span>
            </span>
            {c.grade.percent !== undefined ? (
              <>
                <span className="num">{pct(c.grade.percent)}</span>
                <span className="num" style={{ fontWeight: 500 }}>{c.grade.letter}</span>
                <span className="faint" style={{ fontSize: 12, textAlign: "right" }}>{BASIS[c.grade.basis]}</span>
              </>
            ) : (
              <span className="faint" style={{ gridColumn: "span 3", fontSize: 12, textAlign: "right" }}>no graded work yet</span>
            )}
          </div>
        ))}
      </Panel>

      <Panel title="GPA" meta="this term, so far" className="span-5">
        {d.gpa ? (
          <div className="gpa">
            <div><div className="big">{d.gpa.gpa.toFixed(2)}</div><div className="label">{d.gpa.gpa !== d.gpa.unweighted ? "weighted" : "GPA"}</div></div>
            {d.gpa.gpa !== d.gpa.unweighted && <div><div className="big muted">{d.gpa.unweighted.toFixed(2)}</div><div className="label">unweighted</div></div>}
            <div><div className="big muted">{d.gpa.credits}</div><div className="label">credits graded</div></div>
          </div>
        ) : (
          <p className="empty">Shows up once a class has a grade.</p>
        )}
      </Panel>

      <Panel title="Teachers and announcements" meta={<button type="button" className="link" onClick={() => go("Inbox")}>open inbox</button>} className="span-12">
        {news.length === 0 && <p className="empty">No announcements yet.</p>}
        {news.map((m) => (
          <button key={m.id} type="button" className="row inbox-row as-button" onClick={() => go("Inbox")}>
            <div className="subject" style={{ fontWeight: m.unread ? 500 : 400 }}>
              <span className="chip" style={{ marginRight: 10 }}>
                <span className="swatch" style={{ background: colorVar(m.color) }} />
                {m.from}
              </span>
              {m.subject}
            </div>
            <span className="chip">
              <span className="tag">{m.kind}</span>
              <span className="num faint">{relativeDue(m.at)}</span>
            </span>
          </button>
        ))}
      </Panel>
    </div>
  );
}

function Welcome() {
  const { go } = useDash();
  return (
    <div className="welcome">
      <LinkBlackboard />
      <p className="muted alt">
        Not ready to link? You can still{" "}
        <button type="button" className="link" onClick={() => go("Syllabi")}>upload a syllabus</button>,{" "}
        <button type="button" className="link" onClick={() => go("Settings")}>add a class by hand</button>, or paste your Blackboard calendar link in Settings.
      </p>
    </div>
  );
}
