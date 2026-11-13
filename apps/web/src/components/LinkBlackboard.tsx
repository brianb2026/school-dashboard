import { useState } from "react";
import type { LinkStatus } from "@sd/core";
import { api } from "../lib/api";
import { useDash } from "../lib/dash";

/** The one thing to do on first run: type the school's Blackboard address once, press the button, sign in. */
export function LinkBlackboard({ compact }: { compact?: boolean }) {
  const { d, link } = useDash();
  const bb = d.links.blackboard;
  const [url, setUrl] = useState(bb.host ?? "");
  const needsAddress = !bb.host;
  return (
    <form
      className={`link-card ${compact ? "compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        void link("blackboard", url.trim() || undefined);
      }}
    >
      {!compact && (
        <>
          <h1>Link Blackboard</h1>
          <p className="lead">
            One sign-in pulls in your classes, due dates, grades, announcements and files, finds each syllabus, reads its grading weights, and
            works out every class grade and your GPA. It keeps itself up to date after that.
          </p>
        </>
      )}
      <div className="inline-form">
        <input
          aria-label="Your school's Blackboard address"
          placeholder="Your school's Blackboard address, e.g. learn.school.edu"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
        <button type="submit" className="btn primary" disabled={needsAddress && !url.trim()}>
          {bb.linked ? (bb.expired ? "Reconnect" : "Sign in again") : "Link Blackboard"}
        </button>
      </div>
      <p className="fine">
        A browser window opens on your school's real sign-in page. You sign in there; this app never sees your password. It keeps only the
        sign-in session (encrypted on this Mac) and only reads; it never submits or changes anything. Some schools' rules don't allow tools that
        read Blackboard for you. That call is yours.
      </p>
    </form>
  );
}

/** Progress of a sign-in in flight. */
export function LinkProgress({ status, onClose }: { status: LinkStatus; onClose: () => void }) {
  if (status.phase === "idle" || status.phase === "done") return null;
  const active = status.phase === "opening" || status.phase === "waiting" || status.phase === "syncing";
  const name = status.target === "gradescope" ? "Gradescope" : "Blackboard";
  return (
    <div className={`notice ${active ? "" : "warn"} link-progress`} role="status">
      {active && <span className="spinner" aria-hidden />}
      <span>
        <b>{name}:</b> {status.message ?? status.phase}
      </span>
      <span className="spacer" />
      {status.phase === "waiting" && (
        <button type="button" className="btn ghost" onClick={() => void api("/api/link/cancel", { method: "POST", json: {} }).then(onClose)}>
          Cancel
        </button>
      )}
      {!active && <button type="button" className="btn ghost" onClick={onClose}>Dismiss</button>}
    </div>
  );
}
