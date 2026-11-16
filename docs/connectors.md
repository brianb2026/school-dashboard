# Connectors: what a student can actually reach

Tested against the pretend Blackboard and Gradescope in `packages/connectors/test/fake-blackboard.ts` (shapes follow a real Ultra course) and against one real school's Blackboard. Settings → *What's connected* lists every piece a school refused.

## Blackboard Learn

| Path | Needs | Gets | Notes |
|---|---|---|---|
| **Your own sign-in** (default) | Chrome; you sign in once in a window | Courses, gradebook columns and your grades, course totals, letter schema, announcements, files (plain and embedded in documents), links into Gradescope, instructors | Read-only GETs on `/learn/api/public/…` with your session. May conflict with school rules; your call. |
| **Official API (OAuth)** | An app registered at developer.anthology.com **and** school IT adding its Application ID (REST API Integrations, End User Access on) | The same data, sanctioned | Put `BLACKBOARD_APP_KEY` / `BLACKBOARD_APP_SECRET` in `.env`; *Link Blackboard* then uses it automatically. A student can't do the IT step. |
| **Calendar link** | Nothing: copy your private calendar link | Due dates only | Treated as a secret; stored encrypted. |

What is read, per current course, every sync: `contents?recursive=true` (files, where the syllabus is, which items are Gradescope links), `gradebook/columns`, `gradebook/users/{you}`, `gradebook/categories`, `announcements`; and every 6 hours `gradebook/schemas` (letter scale) and `users` (instructors). A file's bytes are fetched when you open it, when it is a syllabus/schedule, or (with search inside files on, the default) a few at a time after each sync to make it searchable. Each optional piece may be refused by a school; that piece is skipped and noted, the rest continues.

"Current course" = inside its term's dates (or its own date range), else opened in the last 120 days. If nothing qualifies, the most recently opened classes are used and you can hide extras in Settings.

Session upkeep: Blackboard re-issues its session cookie on every response and the app keeps the newest one. If the session still lapses (e.g. the Mac slept all night), the app tries a hidden renewal using the sign-in browser's profile (after 1 h, 2 h, 4 h … or at once on *Sync now*); if the school asks for a real sign-in again you get a Reconnect button.

## Canvas

| Path | Needs | Gets | Notes |
|---|---|---|---|
| **Your own sign-in** (default) | Chrome; you sign in once in a window (SSO and 2FA happen there) | Courses (current term only), assignment groups with their assignments and your submissions, group weights (when the course weights by group), Canvas's own current score and letter, announcements, modules, files and folders, the Syllabus page | Read-only GETs on `/api/v1/…` with your session. Canvas puts `while(1);` in front of JSON for browser sessions; it is stripped. Pages follow the `Link: rel="next"` header. |
| **Access token** | A school that lets students make one (Account → Settings → New access token) | The same | Pasted in Settings → Canvas, checked once, stored encrypted. |

Per current course, every sync: `assignment_groups?include[]=assignments&include[]=submission`; every 6 hours also `modules?include[]=items`, `files` and `folders` (often hidden from students; then files come from the modules instead). Announcements for all classes in one call. The Syllabus page's text is read like a syllabus file.

## Student information system (PeopleSoft)

UVA's SIS (and many others) is Oracle PeopleSoft Campus Solutions. Its student pages keep the same delivered names everywhere:

| Page | Address under `/psc/<site>/<portal>/<node>/c/` | Read for |
|---|---|---|
| Student Center | `SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL` | This week's schedule (class, days, times, room), Holds, To Do List, Enrollment Dates |
| My Course History | `SA_LEARNER_SERVICES.SSS_MY_CRSEHIST.GBL` | Course, description, term, grade, units, status |

At UVA the sign-in window starts at the SIS's own front door (`/ihprd/signon.html`, which forwards to PeopleSoft's sign-in and NetBadge); the bare address shows an "access interrupted" page instead. UVA's Canvas itself is `canvas.its.virginia.edu` (`canvas.virginia.edu` is a page about it, and typing it leads to the right place). The site/portal/node part is learned from the address the sign-in window lands on (never from page content); the usual student node names are tried if the first doesn't answer. Grids are read by their column headings, not by position or element ids. GET requests only, one at a time, a few times a day. GPAs are worked out from letter grades and units with the school's scale (`config/school.json`); pass/fail, withdrawn and in-progress rows don't count. This reader is built from PeopleSoft's standard pages and has not been tried against UVA's real SIS yet; anything it couldn't read is listed in Settings → What's connected.

## Syllabi

Found automatically: files named like a syllabus, any readable file inside a folder named like one (Ultra keeps it as a file embedded in a document under *Course Overview → Syllabus*), and pages typed into Blackboard titled syllabus, schedule or calendar. Up to six per course are downloaded through the same sign-in and parsed locally, once, and again when the file changes or the reader improves.

- **Dates** (exams, things due, readings, videos to watch) are added straight away. Readings come from weekly rows ("Week 3 (9/14 - 9/16) Chapter 1.4"), "Week of …" lines, and Word schedule tables with a date column and a homework/reading column; links in those tables are kept.
- **Weights** that add up to 100% are applied automatically, including drops ("lowest 2 dropped") and weights written as a sentence. Anything else waits in *Syllabi*. Weights you typed or confirmed yourself are never overwritten.

## Gradescope

No student API. The reader reads two pages: your course list and each course's assignment table.

**Getting in.** Many schools open Gradescope from Blackboard (an assignment that "is a link to a Gradescope assignment"). A Gradescope login made directly on gradescope.com often lands in a different, empty account, so the app doesn't rely on it: after a Blackboard sync that found such a link, it opens that Blackboard link with the saved Blackboard sign-in (first with no window at all, then in a window that closes by itself), which lands in the Gradescope account your classes are in. Only the Gradescope cookies are kept. If you unlink Gradescope it stays unlinked until you press *Link* again.

**Matching.** A Blackboard item that links to Gradescope carries the Gradescope assignment number, so the two are merged exactly, whatever their names. Gradescope-only work (labs, say) shows up on its own. Where the two scores differ, both are shown; Gradescope's is used by default and one click switches it. Your own typed score beats both.

If Gradescope changes its pages it reports "no courses found" rather than guessing.

## Gmail (optional)

Google only lets an app read your mail after a one-time setup in a Google Cloud project that you own; there is no shared key this app could ship with that wouldn't put a third party's server in the middle. Settings → Gmail shows these steps with links:

1. Create a project in Google Cloud and turn on the **Gmail API**.
2. On the Google Auth page, fill in the app name and your email. *Internal* if your school account offers it; otherwise *External* and add yourself as a test user.
3. Create a client of type **Desktop app**, and paste its client ID and secret into Settings → Gmail. (Or put them in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.) The secret is stored in the encrypted vault, never in the database.
4. Press *Save and connect*. Sign-in happens on Google's page; the refresh token is stored encrypted.

Scopes: `gmail.readonly` and `gmail.send`. If your school's admin blocks unverified apps, Google refuses the sign-in; writing to professors still works through the filled-in Gmail window.

## Adding a connector

Implement `Connector` from `packages/connectors/src/types.ts`, add it to `ALL_CONNECTORS`, declare which id prefixes its results are authoritative for, and add a test with a made-up response.
