import type { Course } from "@sd/core";
import { NotImplementedYet, type Connector } from "../types.js";

/**
 * Gmail (school Google Workspace account) via the Gmail REST API.
 *
 * Setup (once, by you): create a Google Cloud project, enable the Gmail API,
 * make an OAuth client of type "Desktop app", leave the consent screen in
 * "Testing" with your own address as a test user, and put the client ID and
 * secret in .env. Sign-in happens in your browser via a loopback redirect to
 * 127.0.0.1; the refresh token goes to the Keychain.
 *
 * Scopes: gmail.readonly (inbox) + gmail.send (message professors).
 * If your school's Workspace admin blocks unverified apps, sign-in will be
 * refused; fallback is IMAP with an app password if the school allows it,
 * or "open in Gmail" deep links.
 *
 * Endpoints:
 *   GET  gmail/v1/users/me/messages?q=…           list (query below)
 *   GET  gmail/v1/users/me/messages/{id}?format=metadata
 *   POST gmail/v1/users/me/messages/send          RFC 2822, base64url
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

/** Gmail search query for "messages from my teachers or about my courses". */
export function teacherQuery(courses: Course[], newerThanDays = 30): string {
  const emails = courses.flatMap((c) => c.instructors.map((i) => i.email).filter(Boolean));
  const codes = courses.map((c) => `"${c.code}"`);
  const parts = [...emails.map((e) => `from:${e}`), ...codes];
  return parts.length ? `(${parts.join(" OR ")}) newer_than:${newerThanDays}d` : `newer_than:${newerThanDays}d`;
}

export const gmail: Connector = {
  id: "gmail",
  label: "Gmail",
  capabilities: ["messages", "send-message"],
  async status(ctx) {
    if (!ctx.env.GOOGLE_CLIENT_ID) return { state: "not-configured", detail: "Set GOOGLE_CLIENT_ID / SECRET" };
    return (await ctx.secrets.get("gmail.refresh_token")) ? { state: "ready" } : { state: "needs-sign-in" };
  },
  async connect() {
    throw new NotImplementedYet("Gmail OAuth sign-in");
  },
  async sync() {
    throw new NotImplementedYet("Gmail sync");
  },
  async sendMessage() {
    throw new NotImplementedYet("Gmail send");
  },
};
