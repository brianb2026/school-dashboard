# school-dashboard

A personal, local-only "command center" for school. One screen for what's due, your grades and GPA, messages from teachers, announcements, your schedule, and attendance. It pulls from Blackboard, Gradescope, Qwickly, Gmail, and the syllabi you upload.

It runs on your own Mac. Your school data stays in a SQLite file on your machine, sign-in tokens go in the macOS Keychain, and the app never sees or stores your passwords.

> Status: **v0.2, real data in**. You can paste your Blackboard calendar link, add courses, place calendar items that didn't match a course, and upload a syllabus to review and save its grading weights and due dates. The Today view shows your real data once any of that exists (sample data until then). Gmail, grades from Blackboard, and the other connectors are still stubs with notes on how they'll work. See the [roadmap](#roadmap).

## What it shows

| Area | Where it comes from |
|---|---|
| Upcoming assignments and due dates | Blackboard calendar feed, Blackboard API/session, Gradescope, parsed syllabi |
| Grades, class grade, GPA | Blackboard gradebook (Gradescope scores often sync there), category weights from the syllabus |
| Messages from teachers | Gmail (school Google Workspace) |
| Announcements | Blackboard |
| Courses and class schedule | Blackboard + syllabus |
| Attendance | Qwickly (via its Blackboard gradebook column) or your own check-in log |
| Course files | Blackboard content, cached for offline use |

## v1 features

- **Today view**: what's due next, unread teacher mail and announcements, grades at a glance.
- **Syllabus upload (PDF/DOCX)**: pulls out grading weights, the dated schedule, instructor email, office hours and late policy. It uses plain rules, no AI, and you confirm everything in a review screen before it's saved.
- **Automatic class grade and GPA**: weighted categories, drop-lowest, re-normalized "current" grade. GPA scale is configurable: college 4.0 or high-school weighted (honors/AP/IB bonus).
- **What-if grades and trends**: "what do I need on the final for an A-?", plus grade-over-time lines and warnings when a category is dragging you down.
- **Workload heatmap and conflict alerts**: hours of work due per day, flags days with two big items (exam + paper) or too many deadlines.
- **Calendar export and alerts**: subscribe to `http://127.0.0.1:5179/calendar.ics` from Google or Apple Calendar, plus desktop notifications at 72 h / 24 h / 3 h before a deadline.
- **Message professors**: compose and send from the dashboard through Gmail, with templates (extension request, office hours, absence).
- **Download / submit**: download course files; submit through the official Blackboard API where the assignment allows it, otherwise deep-link to the right page.
- **Optional AI** (off by default): summarize long announcements, help when the rule-based syllabus parser can't read a file. Pick Claude (API key) or a local model through any OpenAI-compatible server such as Ollama. Only the text you click on is sent.

## How it reaches your school data

Blackboard has three ways in, and the app is built to use whichever you have:

1. **Calendar feed** (default, no admin needed). Learn Ultra: Calendar → settings → *Share calendar* → copy the link into `.env`. Gives due dates for every course.
2. **Official REST API** (best). Needs an app registered at developer.anthology.com (formerly developer.blackboard.com) **and** school IT enabling it for your Blackboard. Students can't do the second part, so you'd ask IT.
3. **Signed-in session reader** (opt-in, off by default). You sign in yourself in a real browser window; the app reads the same data the Blackboard page loads. It reaches more, but it may conflict with your school's acceptable-use rules and can break when Blackboard changes. Read-only.

Gradescope has no public student API. Scores usually sync into Blackboard; an opt-in session reader is planned. Qwickly runs inside Blackboard and can write attendance into the gradebook. Gmail uses your own Google Cloud OAuth client. Details: [docs/connectors.md](docs/connectors.md).

## Stack

TypeScript everywhere, one `npm` workspace:

```
apps/
  server/            Fastify API on 127.0.0.1:5179, SQLite (node:sqlite), Keychain secrets, sync loop
  web/               React + Vite UI on 127.0.0.1:5173
packages/
  core/              data model, grade / GPA / what-if math, workload + conflicts, .ics export
  connectors/        blackboard (ical | rest | session), gradescope, qwickly, gmail, manual
  syllabus-parser/   PDF/DOCX → text → weights, dates, policies (rule-based)
  ai/                optional providers: none | anthropic | openai-compatible (Ollama)
config/              school.example.json: GPA scale, letter cutoffs, term dates
docs/                architecture, connectors, data model, design, privacy
data/                your local database and cached files (git-ignored)
```

Why this stack: one language from parser to UI; `node:sqlite` is built into Node 22.13+, so there are no native builds; Fastify and Vite start fast; `unpdf` and `mammoth` read PDFs and Word files locally in JS.

## Getting started

Requires Node 22.13 or newer.

```bash
npm install
cp .env.example .env                        # fill in what you have; leave the rest blank
cp config/school.example.json config/school.json
npm run dev                                 # server on :5179, UI on http://127.0.0.1:5173
npm test                                    # unit + API tests
npm run typecheck
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the typecheck, tests and UI build on Node 22 and 24 for every pull request and push to `main`.

### First run

1. **Settings → Blackboard calendar link**: paste the link from Blackboard (Calendar → settings → Share calendar), then **Sync now**.
2. **Settings → Courses**: add your classes (code, name, credits, level, color). Calendar items move into them automatically.
3. **Settings → Unmatched items**: anything left over, pick its course once and it's remembered.
4. **Syllabi**: drop in each syllabus, check the weights and dates, save. Class grades and GPA use those weights once grades arrive.

## Roadmap

**v0.1, skeleton (this commit)**
- [x] Monorepo, data model, SQLite schema, Keychain secret store
- [x] Grade math (weighted categories, drop lowest, what-if), GPA (credit-weighted, level bonus)
- [x] Workload by day, due-date conflict detection, `.ics` export
- [x] Rule-based syllabus parser (weights, dates, policies) with tests
- [x] Blackboard calendar-feed connector with tests
- [x] UI shell and design tokens, Today view with sample data

**v0.2, real data in**
- [x] Settings: calendar link (kept in the Keychain, never shown back), courses, connector status + Sync now, opt-in readers behind a warning
- [x] Syllabus upload + review (edit weights, dates, times, course; confirm; re-edit; delete undoes it)
- [x] `/api/dashboard` wired into the Today view; sample data only until you have a course or an assignment
- [x] Course matching: code in any spelling (`CHEM-101-002`, `chem101`), unique course name, then your saved fix-ups ("Unmatched items")
- [x] Syllabus items hide when Blackboard has the same item that day; items map to grading categories

**v0.3, grades and inbox**
- [ ] Gmail OAuth (loopback), teacher-mail filter, read + send, reply templates
- [ ] Grades view: per-category breakdown, what-if sliders, trend lines
- [ ] Blackboard REST connector (if IT approves) or session reader (if you opt in)
- [ ] Qwickly attendance from the gradebook column + check-in log

**v0.4, planning**
- [ ] Desktop notifications for due-soon and new teacher mail
- [ ] Assignments view: filters, effort estimates, mark done, download files, offline cache
- [ ] ⌘K search across assignments, messages, files
- [ ] Gradescope session reader (opt-in)

**Later**
- [ ] Optional AI: announcement summaries, "action required" detection, help for messy syllabi
- [ ] Study planner that schedules work blocks before deadlines
- [ ] OCR for scanned syllabi
- [ ] Package as a Mac app (Tauri) once the web version settles

## Privacy

- Binds to `127.0.0.1` only. Nothing listens on your network.
- No passwords stored, ever. You type them on the real sign-in page.
- OAuth tokens and session cookies live in the macOS Keychain; `.env` holds only app config.
- Your data (`data/`, `config/school.json`, `.env`) is git-ignored.
- AI is off by default and never runs automatically.

More: [docs/privacy.md](docs/privacy.md).
