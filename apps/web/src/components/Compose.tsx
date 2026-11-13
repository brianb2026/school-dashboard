import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Feedback, useAction, useDash, type ComposeDraft } from "../lib/dash";

const TEMPLATES: { name: string; subject: (c: string) => string; body: string }[] = [
  { name: "Blank", subject: () => "", body: "" },
  {
    name: "Extension request",
    subject: (c) => `${c}: extension request`,
    body: "Hello Professor,\n\nI'm writing to ask whether I could have a short extension on [assignment]. [Reason, in one or two sentences.] I could turn it in by [date].\n\nThank you for considering it.\n\nBest,\n",
  },
  {
    name: "Office hours",
    subject: (c) => `${c}: office hours question`,
    body: "Hello Professor,\n\nI'd like to come to office hours to go over [topic]. Would [day/time] work, or is there a better time?\n\nThank you,\n",
  },
  {
    name: "Absence",
    subject: (c) => `${c}: absence on [date]`,
    body: "Hello Professor,\n\nI won't be able to attend class on [date] because [reason]. I'll catch up on what I miss; please let me know if there is anything I should do.\n\nThank you,\n",
  },
  {
    name: "Grade question",
    subject: (c) => `${c}: question about a grade`,
    body: "Hello Professor,\n\nI have a question about my grade on [assignment]. Could we go over it, or could you point me to what I missed?\n\nThank you,\n",
  },
];

/** Write to a professor. Sends through Gmail if connected; otherwise opens a filled-in Gmail window. */
export function Compose({ draft, onClose }: { draft: ComposeDraft; onClose: () => void }) {
  const { d } = useDash();
  const people = useMemo(
    () =>
      d.courses.flatMap((c) =>
        c.instructors.filter((p) => p.email).map((p) => ({ label: `${p.name} · ${c.code}`, email: p.email!, code: c.code, courseId: c.id })),
      ),
    [d.courses],
  );
  const first = draft.to ?? people.find((p) => p.courseId === draft.courseId)?.email ?? "";
  const [to, setTo] = useState(first);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const a = useAction();
  const code = people.find((p) => p.email === to)?.code ?? d.courses.find((c) => c.id === draft.courseId)?.code ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Write a message">
        <header>
          <h2>Write to a professor</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="pad form-grid">
          <label>
            To
            <input list="people" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@school.edu" type="email" autoFocus={!first} />
            <datalist id="people">{people.map((p) => <option key={`${p.email}${p.code}`} value={p.email}>{p.label}</option>)}</datalist>
          </label>
          {people.length === 0 && <span className="faint">Instructor addresses come from Blackboard and your syllabi. None found yet, so type one.</span>}
          <label>
            Start from
            <select
              defaultValue=""
              onChange={(e) => {
                const t = TEMPLATES.find((x) => x.name === e.target.value);
                if (!t) return;
                setSubject(t.subject(code || "[course]"));
                setBody(t.body);
              }}
            >
              <option value="" disabled>Choose a template…</option>
              {TEMPLATES.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label>Message<textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={Boolean(first)} /></label>
        </div>
        <div className="save-bar flat">
          <Feedback error={a.error} done={a.done} />
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12 }}>
            {d.links.gmail.connected ? "Sends from your Gmail" : "Opens in Gmail, filled in. You press Send there."}
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={a.busy || !to.trim() || !subject.trim() || !body.trim()}
            onClick={() =>
              void a.run(async () => {
                const r = await api<{ sent: boolean; composeUrl?: string }>("/api/messages/send", {
                  method: "POST",
                  json: { to: [to.trim()], subject, body, threadId: draft.threadId },
                });
                if (r.sent) return "Sent.";
                if (r.composeUrl) window.open(r.composeUrl, "_blank", "noopener");
                return "Opened in Gmail. Press Send there.";
              })
            }
          >
            {d.links.gmail.connected ? "Send" : "Open in Gmail"}
          </button>
        </div>
      </div>
    </div>
  );
}
