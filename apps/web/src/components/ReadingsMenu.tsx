import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CourseView } from "@sd/core";
import { colorVar } from "../lib/api";
import { useReadings } from "../lib/prefs";
import { Switch } from "./Switch";

/** One switch per class: show its readings or not. */
export function ReadingsList({ courses }: { courses: CourseView[] }) {
  const r = useReadings();
  return (
    <div className="readings-list">
      {courses.map((c) => (
        <div key={c.id} className="readings-row" style={{ "--c": colorVar(c.color) } as CSSProperties}>
          <i className="swatch" />
          <span className="code">{c.code}</span>
          <Switch on={r.shows(c.id)} onChange={(on) => r.set(c.id, on)} label={r.shows(c.id) ? "shown" : "hidden"} />
        </div>
      ))}
    </div>
  );
}

/** "Readings" in the Home header: pick which classes show their readings. */
export function ReadingsMenu({ courses }: { courses: CourseView[] }) {
  const [open, setOpen] = useState(false);
  const r = useReadings();
  const box = useRef<HTMLDivElement>(null);
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
  const off = courses.filter((c) => !r.shows(c.id)).length;
  return (
    <div className="menu-wrap readings-btn" ref={box}>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        Readings{off > 0 ? ` · ${off} hidden` : ""}
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Readings">
          <p className="menu-note">Show “read chapter 3 for class” items for</p>
          <ReadingsList courses={courses} />
        </div>
      )}
    </div>
  );
}
