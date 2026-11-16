import { useCallback, useEffect, useRef, useState } from "react";
import { API_VERSION, type LinkStatus, type ProfileInfo, type SessionInfo, type SignInResult } from "@sd/core";
import { api, ApiError } from "../lib/api";
import { Icon } from "./Icon";

type Phase = "idle" | "checking" | "window" | "error";

const RESTART =
  "The dashboard was updated, but the old version is still running. Restart it to finish: in its Terminal window press Ctrl-C, then run npm start (or double-click start.command).";

/**
 * The sign-in screen, shown each time the dashboard opens. Your school
 * sign-in is saved on this Mac after the first time, so this is one click
 * (or Return). Only when the saved sign-in has run out does the school's own
 * page open, and your password is typed there, never here.
 */
export function SignIn({ onIn, showProfiles = false }: { onIn: () => void; showProfiles?: boolean }) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  // The server running behind this page may be older than the page (updated but not restarted yet).
  const [stale, setStale] = useState(false);
  useEffect(() => {
    void api<{ api?: number }>("/api/health")
      .then((h) => setStale(h.api !== API_VERSION))
      .catch(() => undefined);
  }, []);
  const [listOpen, setListOpen] = useState(showProfiles);
  const [switching, setSwitching] = useState<string>();
  const [switchError, setSwitchError] = useState<string>();
  useEffect(() => {
    void api<{ profiles: ProfileInfo[] }>("/api/profiles")
      .then((r) => setProfiles(r.profiles))
      .catch(() => undefined);
  }, []);

  /** Ask the server to open another profile, wait until it has, then start over on it. */
  const switchTo = async (go: () => Promise<{ id: string }>, label: string) => {
    setSwitching(label);
    setSwitchError(undefined);
    try {
      const { id } = await go();
      for (const end = Date.now() + 20_000; Date.now() < end; ) {
        await new Promise((r) => setTimeout(r, 400));
        const now = await api<{ active: string }>("/api/profiles").catch(() => undefined);
        if (now?.active === id) {
          window.location.reload();
          return;
        }
      }
      throw new Error("The other profile didn't open. Try again.");
    } catch (e) {
      setSwitching(undefined);
      setSwitchError(e instanceof ApiError && e.status === 404 ? RESTART : (e as Error).message);
    }
  };
  const [s, setS] = useState<SessionInfo>();
  const [offline, setOffline] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string>();
  const [slow, setSlow] = useState(false);
  const [url, setUrl] = useState("");
  const [schools, setSchools] = useState<{ id: string; name: string; lms: string }[]>([]);
  const live = useRef(true);

  const load = useCallback(() => {
    setOffline(false);
    api<SessionInfo>("/api/session")
      .then((x) => {
        setS(x);
        setUrl(x.host ?? "");
      })
      .catch(() => setOffline(true));
  }, []);
  useEffect(() => {
    void api<{ id: string; name: string; lms: string }[]>("/api/schools")
      .then(setSchools)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  // Follow the school's sign-in window until it closes by itself.
  useEffect(() => {
    if (phase !== "window") return;
    const t = setInterval(() => {
      void api<LinkStatus>("/api/link/status")
        .then((st) => {
          if (!live.current) return;
          if (st.phase === "done") onIn();
          else if (st.phase === "syncing") setMsg("You're in. Getting your latest grades…");
          else if (st.phase === "error" || st.phase === "cancelled") {
            setPhase("error");
            setMsg(st.message ?? "The sign-in didn't finish.");
          } else if (st.message) setMsg(st.message);
        })
        .catch(() => undefined);
    }, 800);
    return () => clearInterval(t);
  }, [phase, onIn]);

  // A quiet renew can take a few seconds; say so instead of looking stuck.
  useEffect(() => {
    if (phase !== "checking") return setSlow(false);
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, [phase]);

  const go = async () => {
    setPhase("checking");
    setMsg(undefined);
    try {
      const r = await api<SignInResult>("/api/signin", { method: "POST", json: {} });
      if (r.state === "in") return onIn();
      if (r.state === "link") {
        setS((x) => (x ? { ...x, linked: false } : x));
        return setPhase("idle");
      }
      setPhase(r.state === "window" ? "window" : "error");
      setMsg(r.message);
    } catch (e) {
      setPhase("error");
      setMsg((e as Error).message);
    }
  };

  /** Link by a school preset, or by an address (Blackboard or Canvas is found out on the server). */
  const linkNew = async (school?: string) => {
    setPhase("checking");
    setMsg(undefined);
    try {
      const r = await api<LinkStatus | { openUrl: string }>("/api/link/auto", { method: "POST", json: school ? { school } : { baseUrl: url.trim() } });
      if ("openUrl" in r) {
        window.open(r.openUrl, "_blank", "noopener");
        setPhase("error");
        setMsg("Approve access in the tab that just opened, then come back and press Continue.");
        return;
      }
      if (r.phase === "error") {
        setPhase("error");
        setMsg(r.message);
      } else {
        setPhase("window");
        setMsg(r.message);
      }
    } catch (e) {
      setPhase("error");
      setMsg((e as Error).message);
    }
  };

  const cancel = () => void api("/api/link/cancel", { method: "POST", json: {} }).then(() => setPhase("idle"));
  const busy = phase === "checking" || phase === "window";

  if (offline) {
    return (
      <div className="signin">
        <div className="signin-card">
          <Brand />
          <h1>Can't reach the dashboard</h1>
          <p className="lede">Start it with <code>npm start</code> in the school-dashboard folder (or double-click start.command), then try again.</p>
          <button type="button" className="btn primary wide" onClick={load} autoFocus>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="signin">
        <div className="signin-card skeleton" aria-busy="true" aria-label="Loading">
          <Brand />
          <span className="sk sk-h" />
          <span className="sk sk-row" />
          <span className="sk sk-btn" />
        </div>
      </div>
    );
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <Brand />
        {s.linked ? (
          <>
            <h1>{s.name ? `Welcome back, ${s.name}` : "Welcome back"}</h1>
            <div className="account">
              <span className="avatar" aria-hidden>
                {(s.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="who">
                <b>{s.name ?? `Your ${s.lms === "canvas" ? "Canvas" : "Blackboard"} account`}</b>
                <span className="muted">
                  {s.lms === "canvas" ? "Canvas" : "Blackboard"}
                  {s.sis ? " + SIS" : ""} · {s.host} · saved on this Mac
                </span>
              </span>
            </div>
            <button type="button" className={`btn primary wide ${busy ? "busy" : ""}`} onClick={() => void go()} disabled={busy} autoFocus>
              {phase === "checking" ? <><span className="spinner" aria-hidden /> Signing in…</> : phase === "window" ? <><span className="spinner" aria-hidden /> Waiting for your school…</> : "Continue"}
            </button>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p className="lede">Link your school once. After that, signing in here is one click.</p>
            {schools.length > 0 && (
              <div className="school-picks">
                {schools.map((x) => (
                  <button key={x.id} type="button" className="school-btn" disabled={busy} onClick={() => void linkNew(x.id)}>
                    <b>{x.name}</b>
                    <span className="muted">{x.lms === "canvas" ? "Canvas" : "Blackboard"} + SIS</span>
                  </button>
                ))}
                <p className="or">or any school</p>
              </div>
            )}
            <form
              className="stack-sm full"
              onSubmit={(e) => {
                e.preventDefault();
                void linkNew();
              }}
            >
              <label className="field">
                <span>Your school's Blackboard or Canvas address</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="learn.school.edu or canvas.school.edu" autoComplete="off" spellCheck={false} inputMode="url" autoFocus={schools.length === 0} />
              </label>
              <button type="submit" className={`btn ${schools.length ? "" : "primary"} wide`} disabled={busy || !url.trim()}>
                {busy ? <><span className="spinner" aria-hidden /> Waiting for your school…</> : "Sign in"}
              </button>
            </form>
          </>
        )}

        <p className={`status-line ${phase === "error" ? "error" : ""}`} role="status" aria-live="polite">
          {phase === "checking" && (slow ? "Your saved sign-in ran out. Renewing it quietly…" : "Checking your saved sign-in…")}
          {phase === "window" && (msg ?? "Finish signing in on your school's page in the window that opened.")}
          {phase === "error" && msg}
        </p>
        {phase === "window" && (
          <button type="button" className="link quiet" onClick={cancel}>
            Cancel
          </button>
        )}

        {stale && <p className="status-line error">{RESTART}</p>}
        {profiles.length > 0 && <Profiles
          profiles={profiles}
          open={listOpen}
          onToggle={() => setListOpen(!listOpen)}
          disabled={busy || switching !== undefined}
          onPick={(p) => void switchTo(() => api<{ id: string }>(`/api/profiles/${encodeURIComponent(p.id)}/switch`, { method: "POST", json: {} }), p.name ?? "that profile")}
          onNew={() => void switchTo(() => api<{ id: string }>("/api/profiles", { method: "POST", json: {} }), "a new profile")}
        />}
        {switching && (
          <p className="status-line" role="status">
            <span className="spinner" aria-hidden /> Opening {switching}…
          </p>
        )}
        {switchError && <p className="status-line error">{switchError}</p>}

        <p className="fine">
          Your password is only ever typed on your school's own page. This Mac keeps the sign-in, encrypted with your Keychain.
          {s.hasData && !busy && (
            <>
              {" "}
              <button type="button" className="link quiet" onClick={onIn}>
                Look at saved data without signing in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * "Switch profile": everyone (or every school) set up on this Mac, each with
 * its own data and sign-ins, plus a fresh one.
 */
function Profiles(props: { profiles: ProfileInfo[]; open: boolean; onToggle: () => void; disabled: boolean; onPick: (p: ProfileInfo) => void; onNew: () => void }) {
  return (
    <div className="profiles">
      <button type="button" className="link quiet profiles-toggle" onClick={props.onToggle} aria-expanded={props.open}>
        <span className={`chev ${props.open ? "open" : ""}`} aria-hidden>
          <Icon name="next" size={12} />
        </span>
        Switch profile
      </button>
      {props.open && (
        <ul className="profile-list">
          {props.profiles.map((p) => (
            <li key={p.id}>
              <button type="button" className={`profile-row ${p.active ? "on" : ""}`} disabled={props.disabled || p.active} onClick={() => props.onPick(p)}>
                <span className="avatar sm" aria-hidden>
                  {(p.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="who">
                  <b>{p.name ?? (p.host ? "Unnamed profile" : "New profile")}</b>
                  <span className="muted">{p.host ? `${p.lms === "canvas" ? "Canvas" : "Blackboard"} · ${p.host}` : "not linked yet"}</span>
                </span>
                {p.active && <span className="faint here">this one</span>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="profile-row new" disabled={props.disabled} onClick={props.onNew}>
              <span className="avatar sm" aria-hidden>
                <Icon name="plus" size={14} />
              </span>
              <span className="who">
                <b>New profile</b>
                <span className="muted">for someone else, or another school</span>
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand-mark">
      <span className="mark" aria-hidden />
      Semester
    </div>
  );
}
