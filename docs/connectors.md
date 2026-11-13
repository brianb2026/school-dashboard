# Connectors: what a student can actually reach

Tested so far only against the pretend Blackboard in `packages/connectors/test/fake-blackboard.ts` (shapes follow the public API docs). The first sync against a real school shows what that school shares; Settings → *What's connected* lists every piece that was refused.

## Blackboard Learn

| Path | Needs | Gets | Notes |
|---|---|---|---|
| **Your own sign-in** (default) | Chrome; you sign in once in a window | Courses, gradebook columns and your grades, course totals, letter schema, announcements, files and attachments, instructors, attendance | Read-only GETs on `/learn/api/public/…` with your session. May conflict with school rules; your call. |
| **Official API (OAuth)** | An app registered at developer.anthology.com **and** school IT adding its Application ID (REST API Integrations, End User Access on) | The same data, sanctioned | Put `BLACKBOARD_APP_KEY` / `BLACKBOARD_APP_SECRET` in `.env`; *Link Blackboard* then uses it automatically. A student can't do the IT step. |
| **Calendar link** | Nothing: copy your private calendar link | Due dates only | Treated as a secret; stored encrypted. |

What is read, per current course: `gradebook/columns`, `gradebook/users/{you}`, `gradebook/categories`, `announcements`; and every 6 hours `gradebook/schemas` (letter scale), `users` (instructors), `meetings/users/{you}` (attendance), `contents` + `attachments` (files). Each optional piece may be refused by a school; that piece is skipped and noted, the rest continues.

"Current course" = inside its term's dates (or its own date range), else opened in the last 120 days. If nothing qualifies, the most recently opened classes are used and you can hide extras in Settings.

Session upkeep: Blackboard re-issues its session cookie on every response and the app keeps the newest one. If the session still lapses (e.g. the Mac slept all night), the app tries a hidden renewal using the sign-in browser's profile (after 1 h, 2 h, 4 h … or at once on *Sync now*); if the school asks for a real sign-in again you get a Reconnect button.

## Syllabi

Files or pages in a course whose name contains "syllabus" (PDF, DOCX, TXT, or a page typed into Blackboard) are downloaded once through the same sign-in and parsed locally. Weights that add up to 100% are applied automatically; anything else waits in *Syllabi*. Weights you typed or confirmed yourself are never overwritten.

## Gradescope

No student API. The optional reader signs in the same way and reads two pages: your course list and each course's assignment table. Its scores merge with the matching Blackboard item when there is one. If Gradescope changes its pages it reports "no courses found" rather than guessing.

## Qwickly Attendance

Runs inside Blackboard; no separate link. When the instructor syncs it to the gradebook it appears as a column ("Qwickly Attendance" / "Attendance") and becomes your attendance percentage. Otherwise use the check-in log in *Attendance*.

## Gmail (optional)

1. console.cloud.google.com → new project → enable **Gmail API**.
2. OAuth consent screen: External, *Testing*, add your school address as a test user.
3. Credentials → OAuth client ID → **Desktop app** → put the ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Settings → *Connect Gmail*. Sign-in happens on Google's page; the refresh token is stored encrypted.

Scopes: `gmail.readonly` and `gmail.send`. If your school's admin blocks unverified apps, Google refuses the sign-in; writing to professors still works through the filled-in Gmail window.

## Adding a connector

Implement `Connector` from `packages/connectors/src/types.ts`, add it to `ALL_CONNECTORS`, declare which id prefixes its results are authoritative for, and add a test with a made-up response.
