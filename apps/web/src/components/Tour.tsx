import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { setPref } from "../lib/prefs";

interface Step {
  /** What to point at; none = a card in the middle. */
  target?: string;
  title: string;
  text: string;
}

const STEPS = (name?: string): Step[] => [
  {
    title: name ? `Welcome, ${name}` : "Welcome",
    text: "Your whole semester in one place. Classes, grades, due dates and files come in from Blackboard and Gradescope by themselves and stay up to date. Here's the 30-second tour.",
  },
  { target: ".course-stack .course", title: "Your classes", text: "Each card shows the class grade and what's due next. Click a class to see its grades, teacher, important dates and Blackboard folders." },
  { target: ".cal", title: "Your workload", text: "Darker days are busier. Click a day and what's due then comes forward while the rest fades. Esc goes back." },
  { target: ".upnext", title: "Up next", text: "Today's classes, and a countdown to each deadline." },
  { target: ".readings-btn", title: "Readings", text: "Don't want “read chapter 3 for class” items for a class? Switch them off here, class by class." },
  { target: ".tabs button:nth-child(2)", title: "Grades", text: "Every class's grade, teacher, syllabus and important dates. Click any score to see how a different one would change your grade." },
  { target: ".theme-btn", title: "Make it yours", text: "Six themes to pick from, light and dark." },
];

/** A short walk through Home, shown once after you first sign in (replay it from Settings). */
export function Tour({ name, onDone }: { name?: string; onDone: () => void }) {
  const steps = STEPS(name);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect>();
  const step = steps[i]!;
  const last = i === steps.length - 1;

  const finish = useCallback(() => {
    setPref("tour", "done");
    onDone();
  }, [onDone]);

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector(step.target) : null;
    if (el) el.scrollIntoView({ block: "nearest" });
    setRect(el?.getBoundingClientRect());
  }, [step.target]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") (last ? finish() : setI(i + 1), e.preventDefault());
      else if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, finish]);

  // The card sits below the thing it points at, or above when there's no room.
  const pad = 8;
  const W = 320;
  let cardStyle: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const below = rect.bottom + 190 < window.innerHeight;
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 16);
    cardStyle = below ? { left, top: rect.bottom + pad + 10 } : { left, top: Math.max(16, rect.top - pad - 10), transform: "translateY(-100%)" };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tour">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={cardStyle} key={i}>
        <p className="tour-step faint num">
          {i + 1} of {steps.length}
        </p>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="link quiet" onClick={finish}>
            {last ? "" : "Skip"}
          </button>
          <span className="spacer" />
          {i > 0 && (
            <button type="button" className="btn ghost" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => (last ? finish() : setI(i + 1))} autoFocus>
            {last ? "Let's go" : i === 0 ? "Show me" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
