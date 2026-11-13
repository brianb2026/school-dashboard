# school-dashboard

A personal, local-only command center for school. Link Blackboard once and it pulls in your classes, due dates, grades, announcements and course files, finds each syllabus, reads its grading weights and letter scale, and works out every class grade and your GPA. Then it keeps itself current.

It runs on your own Mac. Your school data stays in a file on your machine, saved sign-ins are encrypted, and the app never sees or stores your passwords.

> **What has and hasn't been tested.** Everything below works end to end against a pretend Blackboard that ships with the repo (`npm run demo`), including the real Chrome sign-in window, and is covered by 72 automated tests. It has **not** yet been run against a real school's Blackboard, Gradescope or Gmail: those need your own sign-in. The first real link will show what your school shares with students; the Settings page lists exactly what came through and what didn't.

## Start it

Requires Node 22.13 or newer and Google Chrome (for the sign-in window).

- **Easiest:** double-click `start.command`. It installs on first run, starts the dashboard and opens it in your browser.
- **Or:** `npm install` once, then `npm start`.

Then press **Link Blackboard**, type your school's Blackboard address (for example `learn.school.edu`), and sign in in the window that opens. That's it.

Want to see it work first without your account? `npm run demo` starts a pretend Blackboard with made-up classes; use `http://127.0.0.1:5999` as the address. Demo data goes in `.demo-data/` and never touches your real data or Keychain.

## What you get

| View | What it does |
|---|---|
| **Today** | What's due next, a 14-day workload heatmap with deadline pile-up warnings, every class grade, GPA, newest announcements. |
| **Assignments** | Everything from every source in one list (overdue, today, this week, later). Tick things off, add your own, type in a score, set an effort estimate, open the item in Blackboard. |
| **Grades** | Class grade with where it came from, per-category breakdown, a trend line, "what do I need for an A-?", try-out scores for what's left, and a GPA what-if. Edit weights or pick which number to show per class. |
| **Inbox** | Announcements (and teacher email if Gmail is connected). Write to a professor with templates; it sends through Gmail, or opens Gmail with the message filled in. |
| **Schedule** | Your week: class meetings (read from syllabi, editable) and what's due each day. Download deadlines as a calendar file. |
| **Attendance** | Qwickly attendance when it's synced to the Blackboard gradebook; a one-tap check-in log for classes that don't. |
| **Files** | Course files from Blackboard; anything you open is kept for offline use. |
| **Syllabi** | Syllabi pulled from Blackboard or uploaded (PDF, DOCX, TXT). Weights, dates, letter scale, credits, class times, instructor contact and late policy are read by plain rules, no AI. |
| **Search (⌘K)** | Find any assignment, class, announcement, email or file. |
| **Alerts** | A Mac notification when a grade is posted, an announcement arrives, or something is due in 3 days / 1 day / 3 hours. |

### How the class grade is worked out

In order, using the first that exists (you can switch per class in Grades):

1. **Blackboard's own weighted/overall grade**: the instructor's number.
2. **Syllabus weights** applied to your graded work. Syllabi found in the course are read automatically; if the weights add up to 100% they're used right away, otherwise the syllabus waits in *Syllabi* for a quick check.
3. Blackboard's plain "Total".
4. Points earned out of points possible.

Letters use the course's own scale when Blackboard or the syllabus gives one, else the school default in `config/school.example.json`. GPA is credit-weighted; credits come from the syllabus when it states them (otherwise 3, editable in Settings → Classes).

When Blackboard and the syllabus disagree by 2 points or more, the Grades view shows both and says why that can happen.

## How it reaches your school data

- **Blackboard (default: your own sign-in).** A real Chrome window opens on your school's sign-in page. You sign in there (password, SSO, 2FA); the app only watches for the sign-in to finish, keeps the session cookies encrypted, and closes the window. It then reads the same public REST paths the Blackboard site itself uses, GET requests only, one at a time, only for your own classes. It never submits or changes anything. If the session lapses it tries to renew quietly; if it can't, you get a Reconnect button.
  Some schools' acceptable-use rules don't allow tools that read Blackboard on your behalf. Whether to use it is your call.
- **Blackboard (official API).** If your school's IT registers an app for you, put the key and secret in `.env` and *Link Blackboard* uses OAuth instead. Students can't do the registration themselves.
- **Blackboard calendar link.** A no-sign-in fallback that gives due dates only (Settings → More sources).
- **Gradescope.** Optional, same sign-in-window approach. Usually unnecessary because instructors send Gradescope scores to Blackboard.
- **Qwickly.** Read from the attendance column in the Blackboard gradebook. Nothing extra to link.
- **Gmail.** Optional. Needs a one-time Google Cloud setup ([docs/connectors.md](docs/connectors.md)). Without it, writing to a professor still works through a filled-in Gmail window.

Details and limits: [docs/connectors.md](docs/connectors.md).

## Privacy and security

- Listens on `127.0.0.1` only and refuses to start on any other address.
- The API accepts requests only from the dashboard's own page (checks `Host`, `Origin` and `Sec-Fetch-Site`), so other websites and DNS tricks can't reach it.
- Saved sign-ins live in `data/secrets.enc`, encrypted with AES-256-GCM; the key is in the macOS Keychain. No passwords are stored anywhere.
- Everything from Blackboard, Gradescope and email is stored and shown as plain text, never as HTML. Files are always sent as downloads.
- Read-only toward your school: the only thing the app ever sends on your behalf is an email you write and press Send on.
- AI is off unless you set `AI_PROVIDER`; then it only runs when you click Summarize, on that one text.
- Settings → *Delete all my data* removes the database, saved sign-ins, cached files and the sign-in browser's profile.

More: [docs/privacy.md](docs/privacy.md).

## Stack

TypeScript everywhere, one `npm` workspace:

```
apps/
  server/            Fastify on 127.0.0.1:5179: API, SQLite (node:sqlite), encrypted vault, sign-in window, sync loop, alerts
  web/               React + Vite UI (served by the server in production; Vite on :5173 in dev)
packages/
  core/              data model, grade/GPA/what-if math, merging across sources, workload, .ics export
  connectors/        blackboard (session | official API | calendar feed), gradescope, qwickly, gmail
  syllabus-parser/   PDF/DOCX → text → weights, dates, letter scale, credits, class times, policies
  ai/                optional providers: none | anthropic | openai-compatible (Ollama)
scripts/demo.ts      pretend Blackboard + dashboard on throwaway data
config/              school.example.json: GPA scales, default letter cutoffs, time zone
docs/                architecture, connectors, data model, design, privacy
```

## Development

```bash
npm install
npm run dev          # server on :5179 (watch mode) + Vite on http://127.0.0.1:5173
npm test             # 72 unit + API tests (no network, no Keychain, no browser needed)
npm run typecheck
npm run demo         # full app against the pretend Blackboard
```

Optional settings go in `.env` (see `.env.example`) and `config/school.json` (copy the example). Neither is needed to get started: the term is worked out from today's date.

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the typecheck, tests and UI build on Node 22 and 24 for every pull request and push to `main`.

## Known limits

- Not yet run against a real Blackboard, Gradescope or Gmail (see the note at the top). Schools differ in what they share with students; anything not shared shows up as a note in Settings → What's connected, and the rest still works.
- Gradescope has no API; its reader depends on Gradescope's page layout and will report "no courses found" if that changes.
- Submitting work from the dashboard is not supported (it links to the item in Blackboard instead).
- Scanned (image-only) syllabi have no text to read; type the weights in or upload a text PDF/Word version.
- macOS is the tested platform. Other systems fall back to a key file instead of the Keychain and have no desktop alerts.
- Subscribing to the deadlines calendar works from Apple Calendar on the same Mac; Google Calendar needs the downloaded file.
