import { matchCourse, type Course, type Message, type OutgoingMessage, type Person } from "@sd/core";
import { readCapped } from "../net.js";
import { AuthExpiredError, HttpError, type Connector, type ConnectorContext, type SyncResult } from "../types.js";

/**
 * Gmail (school Google Workspace account) through the Gmail REST API.
 *
 * One-time setup, by you: a Google Cloud project with the Gmail API on and an
 * OAuth client of type "Desktop app"; its ID and secret go in .env. Sign-in
 * happens on Google's own page and comes back to 127.0.0.1; the refresh token
 * is kept encrypted. Without this setup the dashboard still lets you write to
 * a professor: it opens a filled-in Gmail compose window instead.
 *
 * Scopes: gmail.readonly (teacher mail) and gmail.send (messages you send).
 */
export const GMAIL_TOKEN = "gmail.refresh_token";
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function gmailConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(env: NodeJS.ProcessEnv): string {
  return env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${env.PORT || 5179}/auth/google/callback`;
}

/** Google's consent page (PKCE: `challenge` is the S256 hash of a secret kept on the server). */
export function gmailAuthUrl(env: NodeJS.ProcessEnv, state: string, challenge: string): string {
  if (!gmailConfigured(env)) throw new Error("Google client ID is not set");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri(env));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function token(ctx: ConnectorContext, params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string }> {
  const res = await ctx.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ctx.env.GOOGLE_CLIENT_ID ?? "", client_secret: ctx.env.GOOGLE_CLIENT_SECRET ?? "", ...params }).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = new TextDecoder().decode(await readCapped(res, 1024 * 1024));
  if (res.status === 400 || res.status === 401) throw new AuthExpiredError("Google refused the sign-in. Connect Gmail again.");
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  return JSON.parse(body) as { access_token?: string; refresh_token?: string };
}

/** Finish sign-in: trade the one-time code for a refresh token and store it. */
export async function gmailExchangeCode(ctx: ConnectorContext, code: string, verifier: string): Promise<void> {
  const t = await token(ctx, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri(ctx.env) });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  await ctx.secrets.set(GMAIL_TOKEN, t.refresh_token);
}

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const refresh = await ctx.secrets.get(GMAIL_TOKEN);
  if (!refresh) throw new AuthExpiredError("Gmail is not connected");
  const t = await token(ctx, { grant_type: "refresh_token", refresh_token: refresh });
  if (!t.access_token) throw new AuthExpiredError("Gmail sign-in expired");
  return t.access_token;
}

async function api<T>(ctx: ConnectorContext, access: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await ctx.fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${access}`, accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const bytes = await readCapped(res, 8 * 1024 * 1024);
  if (res.status === 401) throw new AuthExpiredError("Gmail sign-in expired");
  if (!res.ok) throw new HttpError(res.status, `Gmail request failed (${res.status})`);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Gmail search query for "messages from my teachers or about my courses". */
export function teacherQuery(courses: Course[], newerThanDays = 30): string {
  const emails = [...new Set(courses.flatMap((c) => c.instructors.map((i) => i.email).filter((e): e is string => Boolean(e) && EMAIL.test(e!))))];
  const codes = courses.map((c) => `"${c.code.replace(/"/g, "")}"`);
  const parts = [...emails.map((e) => `from:${e}`), ...codes];
  return parts.length ? `(${parts.join(" OR ")}) newer_than:${newerThanDays}d` : `newer_than:${newerThanDays}d`;
}

/** "Ada Lin <ada@x.edu>" → { name, email }. */
export function parseAddress(v: string): Person {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(v);
  const email = (m ? m[2]! : v).trim();
  const name = (m ? m[1]! : "").trim() || email.split("@")[0] || email;
  return { name, email, role: "staff" };
}

interface GmMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmPart;
}
interface GmPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmPart[];
}

function header(m: GmMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function mapGmailMessage(m: GmMessage, courses: Course[], now: Date): Message {
  const from = parseAddress(header(m, "From"));
  const subject = header(m, "Subject") || "(no subject)";
  const byTeacher = courses.find((c) => c.instructors.some((i) => i.email && i.email.toLowerCase() === from.email?.toLowerCase()));
  return {
    id: `gmail:${m.id}`,
    threadId: m.threadId,
    courseId: byTeacher?.id ?? matchCourse(subject, courses),
    from: { ...from, role: byTeacher ? "instructor" : "staff" },
    to: header(m, "To")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(parseAddress),
    subject,
    snippet: m.snippet ?? "",
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : now.toISOString(),
    unread: (m.labelIds ?? []).includes("UNREAD"),
    source: { source: "gmail", externalId: m.id, url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`, fetchedAt: now.toISOString() },
  };
}

function plainText(p: GmPart | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const child of p.parts ?? []) {
    const t = plainText(child);
    if (t) return t;
  }
  return "";
}

/** The plain-text body of one message, fetched only when you open it. */
export async function gmailBody(ctx: ConnectorContext, messageId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(messageId)) throw new Error("Bad message id");
  const m = await api<GmMessage>(ctx, await accessToken(ctx), `/messages/${messageId}?format=full`);
  return plainText(m.payload) || m.snippet || "";
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** RFC 2822 message. Header values are stripped of line breaks so nothing can inject extra headers. */
export function buildMime(msg: OutgoingMessage): string {
  const to = msg.to.map((t) => t.trim());
  if (!to.length || !to.every((t) => EMAIL.test(t))) throw new Error("Check the email address.");
  const subject = msg.subject.replace(/[\r\n]+/g, " ").trim();
  if (!subject) throw new Error("Add a subject.");
  if (!msg.body.trim()) throw new Error("Write a message first.");
  const wrapped = b64(msg.body.replace(/\r?\n/g, "\r\n")).replace(/(.{76})/g, "$1\r\n");
  return [
    `To: ${to.join(", ")}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
  ].join("\r\n");
}

/** A Gmail compose window, filled in. Used when Gmail isn't connected: zero setup. */
export function composeLink(msg: Partial<OutgoingMessage>): string {
  const u = new URL("https://mail.google.com/mail/");
  u.searchParams.set("view", "cm");
  u.searchParams.set("fs", "1");
  if (msg.to?.length) u.searchParams.set("to", msg.to.join(","));
  if (msg.subject) u.searchParams.set("su", msg.subject);
  if (msg.body) u.searchParams.set("body", msg.body);
  return u.toString();
}

export const gmail: Connector = {
  id: "gmail",
  label: "Gmail",
  capabilities: ["messages", "send-message"],
  async status(ctx) {
    if (!gmailConfigured(ctx.env)) return { state: "not-configured", detail: "Optional. Writing to professors works without it." };
    if (!(await ctx.secrets.get(GMAIL_TOKEN))) return { state: "needs-sign-in", detail: "Connect Gmail to see teacher mail here" };
    if (ctx.env.GMAIL_EXPIRED === "true") return { state: "needs-sign-in", detail: "Sign-in expired. Connect again." };
    return { state: "ready" };
  },
  async sync(ctx): Promise<SyncResult> {
    const access = await accessToken(ctx);
    const courses = ctx.knownCourses.filter((c) => !c.hidden);
    const q = encodeURIComponent(teacherQuery(courses));
    const list = await api<{ messages?: { id: string }[] }>(ctx, access, `/messages?maxResults=30&q=${q}`);
    const messages: Message[] = [];
    for (const { id } of list.messages ?? []) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
      const m = await api<GmMessage>(ctx, access, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
      messages.push(mapGmailMessage(m, courses, ctx.now));
    }
    return { messages, authoritative: { messages: true }, notes: [`${messages.length} messages from teachers or about your courses`] };
  },
  async sendMessage(ctx, msg) {
    const raw = Buffer.from(buildMime(msg), "utf8").toString("base64url");
    const threadId = msg.threadId && /^[A-Za-z0-9_-]+$/.test(msg.threadId) ? msg.threadId : undefined;
    await api(ctx, await accessToken(ctx), "/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw, threadId }),
    });
  },
};
