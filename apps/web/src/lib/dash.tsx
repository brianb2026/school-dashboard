import { createContext, useContext, useState } from "react";
import type { CourseView, DashboardData, LinkTarget, ViewName } from "@sd/core";

export interface ComposeDraft {
  to?: string;
  subject?: string;
  body?: string;
  courseId?: string;
  threadId?: string;
}

/** What Home is showing: everything, one day in focus, or one class. */
export type Focus = { mode: "all" } | { mode: "day"; day: string } | { mode: "class"; courseId: string; itemId?: string };

/** What every view can reach: the data, and the few things that act on it. */
export interface DashCtx {
  d: DashboardData;
  reload: () => Promise<void>;
  /** Show a change at once (before the server answers). */
  patch: (fn: (d: DashboardData) => DashboardData) => void;
  go: (v: ViewName) => void;
  focus: Focus;
  setFocus: (f: Focus) => void;
  /** Open the Classes tab on one class. */
  showClass: (courseId: string) => void;
  /** The class the Grades tab shows, and an assignment in it to point at. */
  classPick?: string;
  classItem?: string;
  /** Start "Link Blackboard" / "Link Gradescope". */
  link: (target: LinkTarget, baseUrl?: string) => Promise<void>;
  compose: (draft?: ComposeDraft) => void;
  /** Open a course file in the in-app viewer. */
  view: (file: { id: string; name: string }) => void;
  /** Open the exam prep pack for an exam. */
  prep: (assignmentId: string) => void;
  /** A short message at the bottom, optionally with Undo. */
  toast: (text: string, undo?: () => void) => void;
}

export const Dash = createContext<DashCtx>(null as never);
export const useDash = (): DashCtx => useContext(Dash);

/** The learning system a class lives in, by its id: "Canvas" or "Blackboard". */
export const lmsOf = (courseId: string | undefined): string => (courseId?.startsWith("canvas:") ? "Canvas" : "Blackboard");
/** The learning system this account uses. */
export const lmsName = (d: DashboardData): string => (d.links.canvas.linked && !d.links.blackboard.linked ? "Canvas" : "Blackboard");

export function courseMap(d: DashboardData): Map<string, CourseView> {
  return new Map(d.courses.map((c) => [c.id, c]));
}

/** Run a change, track busy/error/done for the form that triggered it. */
export function useAction() {
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

export function Feedback({ error, done }: { error?: string; done?: string }) {
  if (error) return <p className="form-msg error" role="alert">{error}</p>;
  if (done) return <p className="form-msg ok">{done}</p>;
  return null;
}
