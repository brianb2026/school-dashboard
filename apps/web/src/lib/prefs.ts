import { useSyncExternalStore } from "react";
import type { AssignmentView } from "@sd/core";

/**
 * Small display choices (show readings, tour seen). Kept in this browser
 * only; every part of the page that reads one updates when it changes.
 */
const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(`sd-${key}`) ?? memory.get(key);
  } catch {
    return memory.get(key);
  }
}

export function setPref(key: string, value: string | undefined): void {
  if (value === undefined) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === undefined) localStorage.removeItem(`sd-${key}`);
    else localStorage.setItem(`sd-${key}`, value);
  } catch {
    /* private window: kept for this visit only */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePref(key: string): string | undefined {
  return useSyncExternalStore(subscribe, () => read(key));
}

/**
 * Readings ("read chapter 1 for class") shown or hidden per class: hide them
 * for a class that lists every chapter, keep them for one where the readings
 * are the work. All shown until you switch one off.
 */
export function useReadings(): { shows: (courseId: string) => boolean; set: (courseId: string, on: boolean) => void } {
  const raw = usePref("readings-hidden");
  const hidden = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  return {
    shows: (id) => !hidden.has(id),
    set: (id, on) => {
      const next = new Set(hidden);
      if (on) next.delete(id);
      else next.add(id);
      setPref("readings-hidden", next.size ? JSON.stringify([...next]) : undefined);
    },
  };
}

export const keepReading = (shows: (courseId: string) => boolean) => (a: AssignmentView) => a.kind !== "reading" || shows(a.courseId);
