import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AssignmentView, ChangeView, CourseView } from "@sd/core";
import { byDay, Calendar, parseDay } from "../components/Calendar";
import { Icon, type IconName } from "../components/Icon";
import { api, colorVar, enc } from "../lib/api";
import { courseMap, useDash } from "../lib/dash";
import { clock, daysFromNow, hhmm, relativeDue } from "../lib/format";
import { ReadingsMenu } from "../components/ReadingsMenu";
import { keepReading, useReadings } from "../lib/prefs";
import { isExam } from "../lib/prep";


const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

/** The next few things due (Miller: a handful, not a wall). */
function nextUp(list: AssignmentView[], now: number, max = 3): AssignmentView[] {
  return list
    .filter((a) => !a.done && a.dueAt && Date.parse(a.dueAt) >= now)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, max);
}

/** Open work whose due date has passed: folded away on the card until you ask. */
function pastDue(list: AssignmentView[], now: number): AssignmentView[] {
  return list.filter((a) => !a.done && a.score === undefined && a.dueAt && Date.parse(a.dueAt) < now).sort((a, b) => b.dueAt!.localeCompare(a.dueAt!));
}

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Mark done (or not) right away; the server catches up a moment later. */
export function useToggleDone() {
  const { patch, reload, toast } = useDash();
  const set = (a: AssignmentView, done: boolean) => {
    patch((d) => ({ ...d, assignments: d.assignments.map((x) => (x.id === a.id ? { ...x, done, userDone: done } : x)) }));
    void api(`/api/assignments/${enc(a.id)}`, { method: "PATCH", json: { done } })
      .then(reload)
      .catch((e: Error) => {
        toast(e.message);
        void reload();
      });
  };
  return (a: AssignmentView, done: boolean) => {
    set(a, done);
    // Done items leave the list, so say so (with a way back).
    if (done) toast(`Done: ${a.title}`, () => set(a, false));
  };
}

export function Home() {
  const { d, focus, setFocus } = useDash();
  const cm = courseMap(d);
  const now = Date.now();
  const classes = useRef<HTMLElement>(null);

  // Esc lets go of a focused day or class (unless a window on top has it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || focus.mode === "all" || document.querySelector(".modal-back")) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      setFocus({ mode: "all" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus.mode, setFocus]);

  const day = focus.mode === "day" ? focus.day : undefined;

  // Bring the first highlighted item into view when a day is picked.
  useEffect(() => {
    if (!day) return;
    classes.current?.querySelector(".item.lit")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [day]);

  const readings = useReadings();
  const visible = d.assignments.filter((a) => a.courseId !== "unassigned" && keepReading(readings.shows)(a));
  const calItems = visible;
  const due = byDay(visible);
  const dayItems = day ? (due.get(day) ?? []) : [];
  const dayIds = new Set(dayItems.map((a) => a.id));

  return (
    <div className={`home mode-${focus.mode}`}>
      <section
        ref={classes}
        className="classes"
        aria-label="Classes"
        onClick={(e) => {
          // Clicking empty space lets go of the day in focus.
          if (day && (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("course-stack"))) setFocus({ mode: "all" });
        }}
      >
        {day ? <DayHead day={day} count={dayItems.length} /> : <Greeting />}
        {d.courses.length === 0 ? (
          <p className="empty-lg">No classes yet. They show up after the first sync with your school.</p>
        ) : (
          <div className="course-stack">
            {d.courses.map((c, i) => {
              const mine = visible.filter((a) => a.courseId === c.id);
              const lit = mine.filter((a) => dayIds.has(a.id));
              const items = day
                ? [...new Map([...lit, ...nextUp(mine, now, 2)].map((a) => [a.id, a])).values()].sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
                : nextUp(mine, now);
              return <CourseCard key={c.id} c={c} i={i} items={items} late={day ? [] : pastDue(mine, now)} lit={dayIds} dim={Boolean(day) && lit.length === 0} />;
            })}
          </div>
        )}
      </section>

      <aside className="workload" aria-label="Workload">
        <Calendar items={calItems} courses={cm} selected={day} onPick={(k) => setFocus(k ? { mode: "day", day: k } : { mode: "all" })} />
        {!day && <Changes />}
        {day ? <DayDetail day={day} items={dayItems} /> : <UpNext items={calItems} />}
        <News />
      </aside>
    </div>
  );
}

function Greeting() {
  const { d, setFocus } = useDash();
  const cm = courseMap(d);
  const now = Date.now();
  const readings = useReadings();
  const open = d.assignments.filter((a) => !a.done && a.dueAt && a.courseId !== "unassigned" && keepReading(readings.shows)(a));
  const week = open.filter((a) => Date.parse(a.dueAt!) >= now && daysFromNow(a.dueAt!) < 7).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const next = week.find((a) => a.kind !== "reading") ?? week[0];
  return (
    <header className="home-head">
      <ReadingsMenu courses={d.courses} />
      <h1>
        {greeting(new Date().getHours())}
        {d.studentName ? `, ${d.studentName}` : ""}
      </h1>
      <p className="lede">
        {week.length === 0 ? "Nothing due this week." : `${week.length} due this week`}
        {next && (
          <>
            {" · next: "}
            <button type="button" className="link plain" onClick={() => setFocus({ mode: "class", courseId: next.courseId, itemId: next.id })}>
              {next.title}
            </button>
            <span className="muted">
              {" "}
              ({cm.get(next.courseId)?.code}, {relativeDue(next.dueAt!)})
            </span>
          </>
        )}
      </p>
    </header>
  );
}

function DayHead({ day, count }: { day: string; count: number }) {
  const { setFocus } = useDash();
  return (
    <header className="home-head day-head">
      <h1>{dayTitle.format(parseDay(day))}</h1>
      <p className="lede">{count === 0 ? "Nothing due this day." : `${count} due this day. Everything else is faded.`}</p>
      <button type="button" className="btn ghost back-all" onClick={() => setFocus({ mode: "all" })}>
        <Icon name="x" /> Show everything <span className="kbd">esc</span>
      </button>
    </header>
  );
}

function CourseCard({ c, i, items, late, lit, dim }: { c: CourseView; i: number; items: AssignmentView[]; late: AssignmentView[]; lit: Set<string>; dim: boolean }) {
  const { setFocus, focus } = useDash();
  const [showLate, setShowLate] = useState(false);
  const style = { "--c": colorVar(c.color), "--i": i, viewTransitionName: `course-${c.id.replace(/[^a-zA-Z0-9_-]/g, "")}` } as CSSProperties;
  return (
    <article className={`course ${dim ? "dim" : ""}`} style={style}>
      <button type="button" className="course-head" onClick={() => setFocus({ mode: "class", courseId: c.id })} aria-label={`Open ${c.code}, ${c.name}`}>
        <span className="course-id">
          <span className="code">{c.code}</span>
          <span className="name">{c.name}</span>
        </span>
        <span className="course-grade">
          {c.grade.percent !== undefined ? (
            <>
              <b className="num">{c.grade.percent.toFixed(1)}%</b>
              <span className="letter">{c.grade.letter}</span>
            </>
          ) : (
            <span className="faint">no grades yet</span>
          )}
        </span>
      </button>
      <ul className="items">
        {items.length === 0 && late.length === 0 && <li className="none">Nothing due soon.</li>}
        {items.map((a) => (
          <ItemRow key={a.id} a={a} state={focus.mode === "day" ? (lit.has(a.id) ? "lit" : "dim") : undefined} />
        ))}
        {late.length > 0 && (
          <li className="late-fold">
            <button type="button" className="fold-btn" onClick={() => setShowLate(!showLate)} aria-expanded={showLate}>
              <span className={`chev ${showLate ? "open" : ""}`} aria-hidden>
                <Icon name="next" size={14} />
              </span>
              {late.length} past due
            </button>
          </li>
        )}
        {showLate && late.map((a) => <ItemRow key={a.id} a={a} />)}
      </ul>
    </article>
  );
}

/** One assignment, compact: done box, title, when, and the one-click things (open the reading, open in Blackboard). */
export function ItemRow({ a, state, showCourse }: { a: AssignmentView; state?: "lit" | "dim"; showCourse?: CourseView }) {
  const { view, setFocus, prep } = useDash();
  const toggle = useToggleDone();
  const sourceDone = a.done && !a.userDone;
  const mat = a.materials?.[0];
  return (
    <li className={`item ${state ?? ""} ${a.done ? "is-done" : ""}`} style={showCourse ? ({ "--c": colorVar(showCourse.color) } as CSSProperties) : undefined}>
      <label className="done-box" title={sourceDone ? `Done in ${a.origin}` : a.done ? "Mark not done" : "Mark done"}>
        <input type="checkbox" checked={a.done} disabled={sourceDone} onChange={(e) => toggle(a, e.target.checked)} aria-label={`${a.title}: done`} />
        <span className="box" aria-hidden>
          <Icon name="check" size={12} />
        </span>
      </label>
      <button type="button" className="item-main" onClick={() => setFocus({ mode: "class", courseId: a.courseId, itemId: a.id })}>
        <span className="item-title">
          {(a.kind === "exam" || a.kind === "quiz") && <span className="kind">{a.kind === "exam" ? "Exam" : "Quiz"}</span>}
          {a.title}
        </span>
        <span className="item-sub">
          {showCourse && <span className="item-course">{showCourse.code} · </span>}
          {a.late ? <span className="danger-text">late · </span> : null}
          {a.movedFrom && !a.done ? <span className="moved" title={`Was due ${relativeDue(a.movedFrom)}`}>moved · </span> : null}
          {a.kind === "reading" ? (showCourse || !a.dueAt ? "for class" : `for class ${relativeDue(a.dueAt)}`) : a.dueAt ? (showCourse ? clock(a.dueAt) : relativeDue(a.dueAt)) : "no date"}
        </span>
      </button>
      <span className="item-act">
        {isExam(a) && !a.done && a.dueAt && Date.parse(a.dueAt) > Date.now() && (
          <button type="button" className="chip-btn prep-btn" onClick={() => prep(a.id)} title="Exam prep: what to study">
            <Icon name="book" size={14} /> Prep
          </button>
        )}
        {mat && (
          <button type="button" className="chip-btn" onClick={() => view(mat)} title={`Open ${mat.name}`}>
            <Icon name="file" size={14} /> Open
          </button>
        )}
      </span>
    </li>
  );
}

/** "in 40 min", "in 5 h", "in 3 days": how long is left, at a glance. */
export function countdown(iso: string, now: number): string {
  const min = Math.round((Date.parse(iso) - now) / 60_000);
  if (min < 0) return "past due";
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h} h`;
  const days = daysFromNow(iso);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const untilStart = (min: number) => (min < 60 ? `in ${Math.max(1, min)} min` : `in ${Math.round(min / 60)} h`);

const minutes = (hhmmText: string) => {
  const [h, m] = hhmmText.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * What's next, right now: today's classes (with the one on now or next
 * marked) and a countdown to each upcoming deadline. Click one to open it.
 */
function UpNext({ items, only }: { items: AssignmentView[]; only?: CourseView }) {
  const { d, setFocus } = useDash();
  const cm = courseMap(d);
  const now = useNow();
  const t = new Date(now);
  const nowMin = t.getHours() * 60 + t.getMinutes();
  const classes = (only ? [only] : d.courses)
    .flatMap((c) => c.meetings.filter((m) => m.weekday === t.getDay()).map((m) => ({ c, m })))
    .sort((a, b) => a.m.start.localeCompare(b.m.start));
  const nextIdx = classes.findIndex(({ m }) => minutes(m.end) > nowMin);
  const due = items
    .filter((a) => !a.done && a.dueAt && a.kind !== "reading" && Date.parse(a.dueAt) >= now && daysFromNow(a.dueAt) <= 14)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 5);
  // From the SIS: your enrollment appointment, once it's within a month.
  const regs = (d.sis?.enrollment ?? []).filter((e) => e.at && Date.parse(e.at) > now && Date.parse(e.at) - now < 31 * 86_400_000);

  return (
    <section className="side-block upnext">
      <h2>Up next</h2>
      {classes.length > 0 && (
        <ul className="today-classes" aria-label="Today's classes">
          {classes.map(({ c, m }, i) => {
            const state = minutes(m.end) <= nowMin ? "past" : minutes(m.start) <= nowMin ? "now" : i === nextIdx ? "next" : "";
            return (
              <li key={`${c.id}${m.start}`} className={state} style={{ "--c": colorVar(c.color) } as CSSProperties}>
                <span className="when num">{hhmm(m.start)}</span>
                <span className="what">
                  {c.code}
                  {m.location && <span className="faint"> · {m.location}</span>}
                </span>
                <span className="tagline">{state === "now" ? "now" : state === "next" ? untilStart(minutes(m.start) - nowMin) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
      {regs.map((e) => (
        <p key={e.text} className="reg-row">
          <span className="item-title">Registration opens</span>
          <span className="item-sub">{e.term}</span>
          <span className="left near">{countdown(e.at!, now)}</span>
        </p>
      ))}
      {due.length === 0 ? (
        <p className="none">Nothing due in the next two weeks.</p>
      ) : (
        <ul className="due-soon">
          {due.map((a) => {
            const hours = (Date.parse(a.dueAt!) - now) / 3_600_000;
            return (
              <li key={a.id}>
                <button type="button" className="due-btn" onClick={() => setFocus({ mode: "class", courseId: a.courseId, itemId: a.id })} style={{ "--c": colorVar(cm.get(a.courseId)?.color) } as CSSProperties}>
                  <i className="swatch" />
                  <span className="due-text">
                    <span className="item-title">{a.title}</span>
                    <span className="item-sub">
                      {cm.get(a.courseId)?.code} · {relativeDue(a.dueAt!)}
                    </span>
                  </span>
                  <span className={`left ${hours < 24 ? "soon" : hours < 72 ? "near" : ""}`}>{countdown(a.dueAt!, now)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Everything due on the day in focus, with its class. */
function DayDetail({ day, items }: { day: string; items: AssignmentView[] }) {
  const { d } = useDash();
  const cm = courseMap(d);
  const weekday = parseDay(day).getDay();
  const meets = d.courses
    .flatMap((c) => c.meetings.filter((m) => m.weekday === weekday).map((m) => ({ c, m })))
    .sort((a, b) => a.m.start.localeCompare(b.m.start));
  return (
    <section className="side-block day-detail" key={day}>
      <h2>
        Due {dayTitle.format(parseDay(day))} <span className="faint num">{items.length}</span>
      </h2>
      {items.length === 0 ? <p className="none">Nothing due. A good day to get ahead.</p> : (
        <ul className="items">
          {items.map((a) => (
            <ItemRow key={a.id} a={a} showCourse={cm.get(a.courseId)} />
          ))}
        </ul>
      )}
      {meets.length > 0 && (
        <p className="meets">
          {meets.map(({ c, m }) => (
            <span key={`${c.id}${m.start}`}>
              <i className="swatch" style={{ background: colorVar(c.color) }} /> {c.code} <span className="num">{hhmm(m.start)}</span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

const CHANGE_ICON: Record<ChangeView["kind"], IconName> = { grade: "check", "due-moved": "clock", "new-assignment": "plus", file: "file", announcement: "mail" };
const shortWhen = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One line saying what happened. */
function changeText(c: ChangeView): string {
  if (c.kind === "grade") return c.was !== undefined ? `Grade changed: ${c.was} → ${c.score}/${c.possible}` : `Graded: ${c.score}/${c.possible}`;
  if (c.kind === "due-moved") return `Due date moved: ${c.from ? shortWhen.format(new Date(c.from)) : "?"} → ${c.to ? shortWhen.format(new Date(c.to)) : "?"}`;
  if (c.kind === "new-assignment") return "New assignment";
  if (c.kind === "file") return "New file";
  return "New announcement";
}

/**
 * Since you last looked: new grades, deadlines the school moved, new work,
 * files and announcements. "Got it" clears the list until something else happens.
 */
function Changes() {
  const { d, view, go, setFocus, patch, reload } = useDash();
  const cm = courseMap(d);
  const [all, setAll] = useState(false);
  const fresh = d.changes.filter((c) => !c.seen);
  if (fresh.length === 0) return null;
  const shown = all ? fresh : fresh.slice(0, 5);
  const open = (c: ChangeView) => {
    if (c.assignmentId && c.courseId) setFocus({ mode: "class", courseId: c.courseId, itemId: c.assignmentId });
    else if (c.fileId) {
      const f = d.files.find((x) => x.id === c.fileId);
      if (f) view(f);
    } else go("Inbox");
  };
  const gotIt = () => {
    const upTo = Math.max(...d.changes.map((c) => c.id));
    patch((x) => ({ ...x, changes: x.changes.map((c) => ({ ...c, seen: true })) }));
    void api("/api/changes/seen", { method: "POST", json: { upTo } }).then(reload).catch(() => undefined);
  };
  return (
    <section className="side-block changes">
      <h2>
        What changed <span className="count-pill num">{fresh.length}</span>
        <button type="button" className="link quiet" onClick={gotIt}>
          Got it
        </button>
      </h2>
      <ul>
        {shown.map((c) => (
          <li key={c.id} className={`ch k-${c.kind}`} style={{ "--c": colorVar(cm.get(c.courseId ?? "")?.color) } as CSSProperties}>
            <button type="button" className="ch-btn" onClick={() => open(c)}>
              <span className="ch-icon" aria-hidden>
                <Icon name={CHANGE_ICON[c.kind]} size={14} />
              </span>
              <span className="ch-text">
                <span className="item-title">{c.title}</span>
                <span className="item-sub">
                  {cm.get(c.courseId ?? "")?.code ? `${cm.get(c.courseId ?? "")!.code} · ` : ""}
                  {changeText(c)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {fresh.length > 5 && (
        <button type="button" className="link quiet" onClick={() => setAll(!all)}>
          {all ? "Fewer" : `${fresh.length - 5} more`}
        </button>
      )}
    </section>
  );
}

/** Latest announcements; ✕ hides one for good (Undo for a few seconds). */
function News() {
  const { d, go, patch, reload, toast } = useDash();
  const cm = courseMap(d);
  const list = d.announcements.slice(0, 4);
  if (list.length === 0) return null;
  const dismiss = (id: string) => {
    const gone = d.announcements.find((a) => a.id === id);
    patch((x) => ({ ...x, announcements: x.announcements.filter((a) => a.id !== id) }));
    const call = (dismissed: boolean) => api(`/api/announcements/${enc(id)}/dismiss`, { method: "POST", json: { dismissed } });
    void call(true).catch((e: Error) => {
      toast(e.message);
      void reload();
    });
    toast("Announcement dismissed.", () => {
      if (gone) patch((x) => ({ ...x, announcements: [gone, ...x.announcements].sort((a, b) => b.postedAt.localeCompare(a.postedAt)) }));
      void call(false).then(reload);
    });
  };
  return (
    <section className="side-block">
      <h2>
        Announcements
        <button type="button" className="link quiet" onClick={() => go("Inbox")}>
          Inbox
        </button>
      </h2>
      <ul className="news">
        {list.map((a) => (
          <li key={a.id} className={a.read ? "" : "unread"}>
            <button type="button" className="news-main" onClick={() => go("Inbox")}>
              <span className="news-title">{a.title}</span>
              <span className="item-sub">
                <i className="swatch" style={{ background: colorVar(cm.get(a.courseId ?? "")?.color) }} /> {cm.get(a.courseId ?? "")?.code ?? "School"} · {relativeDue(a.postedAt)}
              </span>
            </button>
            <button type="button" className="icon-btn" onClick={() => dismiss(a.id)} aria-label={`Dismiss “${a.title}”`} title="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
