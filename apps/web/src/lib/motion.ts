import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that glides to its new value (ease-out) instead of jumping, so a change is easy to follow. */
export function useTween(target: number, ms = 420): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reducedMotion() || from.current === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = a + (target - a) * (1 - (1 - k) ** 3);
      setValue(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Run a state change as a shared-element transition where the browser has
 * them (a class card grows into the class page and shrinks back). Instant
 * elsewhere, and when you've asked your Mac for less motion.
 */
export function morph(update: () => void): void {
  const doc = document as DocWithVT;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}
