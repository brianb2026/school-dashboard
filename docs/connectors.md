# Connectors: what a student can actually reach

## Blackboard Learn

| Path | Needs | Gets | Risk |
|---|---|---|---|
| **Calendar feed (iCal)** | Nothing: copy your private calendar link | Due dates (all courses), some course events | None. Treat the link like a password. |
| **REST API, 3-legged OAuth** | App registered at developer.anthology.com (formerly developer.blackboard.com) **plus** school IT adding its Application ID to your Learn site (REST API Integrations, End User Access on) | Courses, gradebook columns + your grades, announcements, content + attachments, calendar, attendance (Learn's own tool), submissions where allowed | None; it's the sanctioned way |
| **Signed-in session reader** | You sign in in a visible browser window | Roughly what the web UI shows you | May conflict with acceptable-use policy; breaks on UI changes. Opt-in, read-only. |
| **Manual / uploads** | Nothing | Whatever you add | None |

Notes:
- A student **cannot** register a REST app for their school; the admin step is required even for 3LO. If you want the API, email IT with: app name, Application ID, scopes (`read`, plus `write` only if you want submissions), and that it's for personal use on your own account.
- Endpoint list is in `packages/connectors/src/blackboard/rest.ts`.

## Gradescope

No public API for students. Plan: (1) rely on instructors syncing scores into Blackboard; (2) opt-in session reader for your course list and assignment tables; (3) manual entry. Submissions stay on Gradescope (deep links).

## Qwickly Attendance

Runs inside Blackboard as an LTI tool, so no separate login. Instructors can push attendance into the Blackboard gradebook as a column ("Qwickly Attendance" / "Attendance"); the qwickly module turns that column into per-course attendance. Fallback: a one-tap "checked in" log after each class.

## Gmail (Google Workspace)

1. console.cloud.google.com → new project → enable **Gmail API**.
2. OAuth consent screen: External, *Testing*, add your school address as a test user.
3. Credentials → OAuth client ID → **Desktop app** → put ID/secret in `.env`.
4. Sign in from Settings; the refresh token goes to the Keychain.

Scopes: `gmail.readonly`, `gmail.send`. If your school's admin blocks unverified third-party apps, Google will refuse the sign-in; then the fallbacks are IMAP (if allowed) or "open in Gmail" links.

## Adding a connector

Implement `Connector` from `packages/connectors/src/types.ts`, add it to `ALL_CONNECTORS` (order = priority for course discovery), and add a test with a recorded, anonymized sample response.
