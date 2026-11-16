import { useState } from "react";
import type { AssignmentView, CourseView } from "@sd/core";
import { colorVar } from "../lib/api";
import { localDate } from "../lib/format";
import { Icon } from "./Icon";

/** Rough hours when you haven't given your own estimate. Readings and quizzes are light; projects and exams are not. */
const HOURS: Record<string, number> = { exam: 3, project: 4, paper: 3, lab: 2, homework: 2, quiz: 1, reading: 1, discussion: 0.5, other: 1 };
export const hoursFor = (a: AssignmentView) => a.effortHours ?? HOURS[a.kind] ?? 1;

/** 0 (free) … 4 (heavy): one hue, five steps. */
export function loadStep(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 7) return 3;
  return 4;
}

/** Assignments grouped by the local day they are due. */
export function byDay(items: AssignmentView[]): Map<string, AssignmentView[]> {
  const m = new Map<string, AssignmentView[]>();
  for (const a of items) {
    if (!a.dueAt) continue;
    const k = localDate(new Date(a.dueAt));
    m.set(k, [...(m.get(k) ?? []), a]);
  }
  for (const list of m.values()) list.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  return m;
}

export function parseDay(day: string): Date {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y!, mo! - 1, d!);
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const labelFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const HEAD = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Five weeks from this one, Monday first. Each day is shaded by how much is
 * due and dotted with the colors of the classes it's for. Click a day to put
 * it in focus; click it again (or press Esc) to let go.
 */
export function Calendar(props: {
  items: AssignmentView[];
  courses: Map<string, CourseView>;
  selected?: string;
  onPick: (day: string | undefined) => void;
}) {
  const [offset, setOffset] = useState(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) + offset * 28);
  const days = Array.from({ length: 35 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return x;
  });
  const due = byDay(props.items);
  const todayKey = localDate(today);
  const mid = days[17]!;

  return (
    <div className="cal">
      <div className="cal-head">
        <h2>{monthFmt.format(mid)}</h2>
        <span className="spacer" />
        {offset !== 0 && (
          <button type="button" className="btn ghost sm" onClick={() => setOffset(0)}>
            Today
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Earlier weeks">
          <Icon name="back" />
        </button>
        <button type="button" className="icon-btn" onClick={() => setOffset(offset + 1)} aria-label="Later weeks">
          <Icon name="next" />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label="Due dates">
        {HEAD.map((h, i) => (
          <span key={i} className="cal-dow" aria-hidden>
            {h}
          </span>
        ))}
        {days.map((day) => {
          const key = localDate(day);
          const list = due.get(key) ?? [];
          const open = list.filter((a) => !a.done);
          const hours = open.reduce((s, a) => s + hoursFor(a), 0);
          const colors = [...new Set(list.map((a) => props.courses.get(a.courseId)?.color))].slice(0, 3);
          const on = props.selected === key;
          return (
            <button
              key={key}
              type="button"
              className={`cal-day ${key === todayKey ? "today" : ""} ${on ? "on" : ""} ${day < today ? "past" : ""} ${day.getMonth() !== mid.getMonth() ? "other" : ""}`}
              style={{ background: on ? undefined : `var(--heat-${loadStep(hours)})` }}
              aria-pressed={on}
              aria-label={`${labelFmt.format(day)}: ${list.length ? `${list.length} due` : "nothing due"}`}
              onClick={() => props.onPick(on ? undefined : key)}
            >
              <span className="n">{day.getDate()}</span>
              <span className="dots" aria-hidden>
                {colors.map((c, i) => (
                  <i key={i} style={{ background: colorVar(c) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
