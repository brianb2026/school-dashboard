# school-dashboard

A personal, local-only command center for school. Link Blackboard or Canvas once (and, at schools like UVA, the student information system) and it pulls in your classes, due dates, grades, announcements and course files, finds each syllabus, reads its grading weights and letter scale, and works out every class grade and your GPA. Then it keeps itself current.

It runs on your own Mac. Your school data stays in a file on your machine, saved sign-ins are encrypted, and the app never sees or stores your passwords.

> **What has and hasn't been tested.** Everything below is covered by automated tests against a pretend Blackboard, Gradescope, Canvas and PeopleSoft SIS that ship with the repo. Blackboard (Ultra), Gradescope opened through Blackboard, syllabus finding and reading, and the in-app file viewer have also been checked against one real school's Blackboard. **Canvas and the SIS reader are built from Canvas's public API documentation and PeopleSoft's standard student pages, and have not yet been tried against a real Canvas or UVA's SIS.** Gmail has not been tried against a real account either. Schools differ: Settings → What's connected lists exactly what came through and what didn't.

## Start it

Requires Node 22.13 or newer and Google Chrome (for the sign-in window).

- **Easiest:** double-click `start.command`. It installs on first run, starts the dashboard and opens it in your browser.
- **Or:** `npm install` once, then `npm start`.

Then, on the sign-in screen, either pick your school (**University of Virginia** is set up: Canvas plus SIS) or type your school's Blackboard or Canvas address (for example `learn.school.edu` or `canvas.school.edu`; which one it is gets worked out for you), and sign in in the window that opens. That's it. At UVA the SIS links right after Canvas, usually without a second sign-in, because NetBadge already knows you.

**Profiles:** more than one person (or school) can use the dashboard on the same Mac. On the sign-in screen, *Switch profile* lists everyone set up here and *New profile* adds one; the round button at the top right gets you back there. Each profile has its own data, its own encrypted sign-ins (with its own Keychain key) and its own sign-in browser, so nothing is shared. Your existing data is the first profile.

The first time, a short tour shows how it works (replay it from Settings → Display). Each time you open the dashboard it shows a sign-in screen. Your school sign-in is saved on this Mac, so it's one click (or Return): **Continue** checks the saved sign-in, quietly renews it if it ran out, and only if that fails opens your school's own sign-in page. Your password is only ever typed there. You can also look at saved data without signing in.

Want to see it work first without your account? `npm run demo` starts a pretend Blackboard with made-up classes; use `http://127.0.0.1:5999` as the address. Demo data goes in `.demo-data/`, is erased each time the demo starts, and never touches your real data or Keychain. The demo refuses to link anything but its own pretend Blackboard, so a real sign-in can't end up there by mistake.

## What you get

| View | What it does |
|---|---|
| **Home** | Your classes on the left, your workload on the right. Each class shows its grade and the next few things due (with the reading or handout one click away: **Open** shows it right there); anything past due is folded into one line you can open. **Readings** (top right) hides or shows "read chapter 3 for class" items class by class. The right side is a calendar shaded by how busy each day is, **Up next** (today's classes with the one on now or next marked, and a countdown to each deadline in the next two weeks), and the latest announcements (✕ dismisses one for good, with Undo). **Click a day** and what's due that day pops forward while everything else fades; Esc or *Show everything* lets go. **Click a class** (or any assignment) to open it on the Grades tab. |
| **Grades** | One class at a time (switch with the pills at the top), with your GPA and a letter what-if above. Each class shows its grade with a trend line, its work filtered by type (each type with its average), the same click-a-score what-if as Home, "what do I need for an A−?", which number to show, and its grade weights (edit them here). Under its work, **Course content** (folded until you open it) is the class's Blackboard page: every folder, page, file, link, assignment and tool (Gradescope, Qwickly attendance, …) in Blackboard's order, plus a **From the syllabus** folder with the readings and dates only the syllabus lists. Beside it: **teacher** contact (email with Copy and Write, office hours, TAs), **important dates** (midterms, finals, quizzes, projects, papers, with a countdown, and when the term ends), the **syllabus** (open it in the dashboard or download it), and when the class meets (under its name). |
| **Inbox** | Announcements (and teacher email if Gmail is connected); dismiss the ones you are done with. Write to a professor with templates; it sends through Gmail, or opens Gmail with the message filled in. |
| **Files** | Course files from Blackboard, one folding section per class (remembered; typing a name opens the matches), with filters by kind taken from the class's own folders (Labs, Workshops, Exam material, Readings, …), including ones embedded in Ultra documents. PDFs and images open inside the dashboard, Word files as text; anything you open is kept for offline use. |
| **Syllabi** | Syllabi and schedule pages found in each course (most schools keep them under *Course Overview → Syllabus*) are fetched and read by themselves; you can also upload one (PDF, DOCX, TXT). Weights, drops, dates, readings, letter scale, credits, class times, instructor contact and late policy are read by plain rules, no AI. |
| **What changed** | On Home: new grades, deadlines the school moved (old date → new date, plus a Mac notification), new assignments, new files and announcements since you last looked. *Got it* clears it. A moved assignment is tagged "moved" for a week. |
| **Morning brief** | One Mac notification a day (8:00 unless you change it in Settings → Display): today's classes and rooms, what's due today, and what changed overnight. If the Mac was asleep, it comes when it wakes. |
| **Exam prep** | A **Prep** button on every upcoming exam gathers the class's practice exams and review sheets, the lecture files posted since the last exam, your work from that stretch (weakest scores first) and its readings, with a checklist. |
| **Search (⌘K)** | Find any assignment, class, announcement, email or file, and words **inside** course files (PDFs by page, PowerPoint by slide, Word, text). A PDF match opens at its page. Files are read on this Mac a few at a time after each sync (Settings → Display turns it off). |
| **Menu bar** | `npm run menubar` builds and opens *Semester Bar*: your next deadline in the Mac menu bar ("HW2 · 2d"), and a menu with what's due next, today's classes and what's new. It only talks to the dashboard on this Mac. To keep it, drag `apps/menubar/build/Semester Bar.app` to Applications and add it in System Settings → General → Login Items. |
| **Themes** | Six looks from the top bar or Settings → Display: Light (pastel), Paper, Sage, Dark, Midnight and Mocha, or match your Mac. |
| **Settings** | What's linked, your classes (colors, credits, class times), Gmail, and a deadlines calendar file (.ics) for Google or Apple Calendar. |
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
- **Canvas.** Same idea as Blackboard: you sign in yourself (at UVA, NetBadge and Duo) in the sign-in window, and the app reads Canvas's documented API (`/api/v1/…`), GET requests only: your classes, assignments with your scores, assignment-group weights, the total Canvas shows you, announcements, modules (shown as the class's course content) and files. Schools that allow it can use a personal access token instead (Settings → Canvas).
- **Student information system (SIS).** For PeopleSoft SIS sites such as UVA's (`sisuva.admin.virginia.edu`). After your sign-in, the app reads two of your own pages, GET only: the **Student Center** (when and where each class meets, holds, to-do list, enrollment appointment) and **My Course History** (every course with its official grade). From those it fills in class times, rooms and units, shows your **official GPA** and record by term on the Grades tab, warns about holds, and counts down to registration. It never enrolls, drops or pays anything. The SIS signs you out after a short idle time, so it's read when you sign in and a few times a day.
- **Blackboard calendar link.** A no-sign-in fallback that gives due dates only (Settings → More sources).
- **Gradescope.** At schools that open Gradescope from Blackboard, it links by itself right after Blackboard: the app opens one of those Blackboard links with your Blackboard sign-in, which lands in your Gradescope account. Nothing to type. Scores that exist only in Gradescope show up, and items Blackboard links to Gradescope are matched exactly, so a score that differs between the two is shown side by side. Elsewhere, *Link Gradescope* opens a sign-in window like Blackboard's.
- **Gmail.** Optional. Google only lets an app read mail after a one-time setup that you own (about five minutes); Settings → Gmail walks you through it and takes the client ID and secret right there. Without it, writing to a professor still works through a filled-in Gmail window.

Syncing is automatic: right after you link anything, every 30 minutes, and when you press the sync button.

Details and limits: [docs/connectors.md](docs/connectors.md).

## Privacy and security

- Listens on `127.0.0.1` only and refuses to start on any other address.
- The API accepts requests only from the dashboard's own page (checks `Host`, `Origin` and `Sec-Fetch-Site`), so other websites and DNS tricks can't reach it.
- Saved sign-ins live in `data/secrets.enc`, encrypted with AES-256-GCM; the key is in the macOS Keychain. No passwords are stored anywhere.
- Everything from Blackboard, Gradescope and email is stored and shown as plain text, never as HTML. Files are sent as downloads; only real PDFs and images (checked by their first bytes) are ever shown inside the dashboard.
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
  connectors/        blackboard (session | official API | calendar feed), gradescope, gmail
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

- Canvas and the SIS reader are not yet tried against a real Canvas or UVA's SIS (see the note at the top). The SIS reader finds columns by their headings on PeopleSoft's standard Student Center and My Course History pages; a school that has replaced those pages gets a note in Settings saying what couldn't be read.
- Gmail is not yet tried against a real account. Schools differ in what they share with students; anything not shared shows up as a note in Settings → What's connected, and the rest still works.
- Gradescope has no API; its reader depends on Gradescope's page layout and will report "no courses found" if that changes.
- Readings are matched to course files by name and author. A reading with no file in Blackboard (a library link, a video) shows without an Open button; one whose file is named very differently may not be matched.
- Submitting work from the dashboard is not supported (it links to the item in Blackboard instead).
- Scanned (image-only) syllabi have no text to read; type the weights in or upload a text PDF/Word version.
- macOS is the tested platform. Other systems fall back to a key file instead of the Keychain and have no desktop alerts.
- Subscribing to the deadlines calendar works from Apple Calendar on the same Mac; Google Calendar needs the downloaded file.
