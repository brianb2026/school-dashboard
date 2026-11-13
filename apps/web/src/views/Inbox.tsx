import { useState } from "react";
import { api, colorVar, enc } from "../lib/api";
import { courseMap, Feedback, useAction, useDash } from "../lib/dash";
import { relativeDue } from "../lib/format";
import { Panel } from "../panels/Panel";

interface Item {
  id: string;
  kind: "announcement" | "email";
  from: string;
  email?: string;
  subject: string;
  at: string;
  unread: boolean;
  courseId?: string;
  body?: string;
  snippet?: string;
  threadId?: string;
  url?: string;
}

export function Inbox() {
  const { d, reload, compose, go } = useDash();
  const cm = courseMap(d);
  const [openId, setOpenId] = useState<string>();
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [onlyUnread, setOnlyUnread] = useState(false);
  const act = useAction();

  const items: Item[] = [
    ...d.announcements.map((a) => ({
      id: a.id, kind: "announcement" as const, from: cm.get(a.courseId ?? "")?.code ?? "Blackboard", subject: a.title, at: a.postedAt,
      unread: !a.read, courseId: a.courseId, body: a.body, url: a.source.url,
    })),
    ...d.messages.map((m) => ({
      id: m.id, kind: "email" as const, from: m.from.name, email: m.from.email, subject: m.subject, at: m.receivedAt,
      unread: m.unread, courseId: m.courseId, snippet: m.snippet, threadId: m.threadId, url: m.source.url,
    })),
  ]
    .filter((i) => !onlyUnread || i.unread || i.id === openId)
    .sort((a, b) => b.at.localeCompare(a.at));
  const open = items.find((i) => i.id === openId);

  const show = (i: Item) => {
    setOpenId(i.id === openId ? undefined : i.id);
    if (i.id === openId) return;
    if (i.kind === "announcement" && i.unread) {
      void api(`/api/announcements/${enc(i.id)}/read`, { method: "POST", json: { read: true } }).then(reload).catch(() => undefined);
    }
    if (i.kind === "email" && bodies[i.id] === undefined) {
      void act.run(async () => {
        const r = await api<{ body: string }>(`/api/messages/${enc(i.id)}/body`);
        setBodies((b) => ({ ...b, [i.id]: r.body }));
      });
    }
  };

  return (
    <div className="stack wide">
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => compose()}>Write to a professor</button>
        <label className="check"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Unread only</label>
        <span className="spacer" />
        {!d.links.gmail.connected && (
          <span className="faint" style={{ fontSize: 12 }}>
            Announcements come from Blackboard. To see teacher email here too, <button type="button" className="link" onClick={() => go("Settings")}>connect Gmail</button> (optional).
          </span>
        )}
      </div>
      <Panel title="Teachers and announcements" meta={`${items.filter((i) => i.unread).length} unread`}>
        {items.length === 0 && <p className="empty">{onlyUnread ? "Nothing unread." : "No announcements yet. They arrive with the next Blackboard sync."}</p>}
        {items.map((i) => {
          const c = cm.get(i.courseId ?? "");
          const isOpen = i.id === openId;
          const text = i.kind === "announcement" ? i.body : bodies[i.id];
          return (
            <div key={i.id} className={`msg ${isOpen ? "open" : ""}`}>
              <button type="button" className="row inbox-row as-button" onClick={() => show(i)} aria-expanded={isOpen}>
                <div className="subject" style={{ fontWeight: i.unread ? 600 : 400 }}>
                  <span className="chip" style={{ marginRight: 10 }}><span className="swatch" style={{ background: colorVar(c?.color) }} />{i.from}</span>
                  {i.subject}
                </div>
                <span className="chip"><span className="tag">{i.kind}</span><span className="num faint">{relativeDue(i.at)}</span></span>
              </button>
              {isOpen && (
                <div className="msg-body">
                  {summaries[i.id] && <p className="summary"><b>Summary:</b> {summaries[i.id]}</p>}
                  <div className="text">{text ?? (act.busy ? "Loading…" : i.snippet ?? "")}</div>
                  <div className="inline-form" style={{ marginTop: 10 }}>
                    <button type="button" className="btn"
                      onClick={() => compose({ to: i.email ?? c?.instructors.find((p) => p.email)?.email, courseId: i.courseId, subject: `Re: ${i.subject}`, threadId: i.threadId })}>
                      {i.kind === "email" ? "Reply" : "Write to instructor"}
                    </button>
                    {d.ai.provider !== "none" && text && !summaries[i.id] && (
                      <button type="button" className="btn" disabled={act.busy}
                        onClick={() => void act.run(async () => {
                          const r = await api<{ summary: string }>("/api/ai/summarize", { method: "POST", json: { text: `${i.subject}\n\n${text}` } });
                          setSummaries((s) => ({ ...s, [i.id]: r.summary }));
                        })}>
                        Summarize
                      </button>
                    )}
                    {i.kind === "announcement" && (
                      <button type="button" className="btn ghost"
                        onClick={() => void api(`/api/announcements/${enc(i.id)}/read`, { method: "POST", json: { read: false } }).then(reload).then(() => setOpenId(undefined))}>
                        Mark unread
                      </button>
                    )}
                    {i.url && <a className="btn ghost" href={i.url} target="_blank" rel="noreferrer noopener">Open in {i.kind === "email" ? "Gmail" : "Blackboard"}</a>}
                  </div>
                  <Feedback error={act.error} />
                </div>
              )}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
