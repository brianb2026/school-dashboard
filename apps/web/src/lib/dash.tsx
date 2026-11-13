import { createContext, useContext, useState } from "react";
import type { CourseView, DashboardData, LinkTarget, ViewName } from "@sd/core";

export interface ComposeDraft {
  to?: string;
  subject?: string;
  body?: string;
  courseId?: string;
  threadId?: string;
}

/** What every view can reach: the data, and the few things that act on it. */
export interface DashCtx {
  d: DashboardData;
  reload: () => Promise<void>;
  go: (v: ViewName) => void;
  /** Start "Link Blackboard" / "Link Gradescope". */
  link: (target: LinkTarget, baseUrl?: string) => Promise<void>;
  compose: (draft?: ComposeDraft) => void;
}

export const Dash = createContext<DashCtx>(null as never);
export const useDash = (): DashCtx => useContext(Dash);

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
