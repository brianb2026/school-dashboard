# Privacy and security

## What is stored, and where

| What | Where | Protection |
|---|---|---|
| Classes, assignments, grades, announcements, email subjects/snippets | `data/school.sqlite` | Folder and file readable by your user only (0700 / 0600) |
| Saved sign-ins: Blackboard / Gradescope session cookies, OAuth tokens, the calendar link, the Gmail client secret (if entered in Settings) | `data/secrets.enc` | AES-256-GCM; the 32-byte key is in the macOS login Keychain (service `school-dashboard`) |
| The sign-in window's own browser profile (your school's single sign-on cookies) | `data/browser-profile/` | Chrome's own cookie encryption; deleted when you unlink everything or wipe |
| Course files you opened | `data/files/` | Named by hash, readable by you only |
| Passwords | **nowhere** | You type them on the real sign-in page, in a real browser window |

`data/`, `.env` and `config/school.json` are git-ignored.

What the Keychain-held key does and doesn't do: it makes `secrets.enc` useless to anything that copies, backs up or syncs the file. It does not protect against malware already running as your user (nothing on a desktop does).
On systems without a Keychain the key is a file next to the data (`data/.vault-key`, readable by you only), which is weaker.

## What the app does on the network

- **Blackboard:** GET requests only, to the one host you linked, one at a time with a pause between them, at most a few hundred per sync, every 30 minutes (files and people every 6 hours). Credentials are only ever sent to that host; a redirect to another host (e.g. file storage) is followed without them. Nothing is ever submitted, posted or changed.
- **Search inside files:** to make files searchable, the app downloads course files (PDF, PowerPoint, Word, text; up to 25 MB each) a few at a time after each sync, with a pause between them, and reads their words on this Mac into a local index. Turning it off in Settings → Display stops it and deletes the index.
- **Canvas (if linked):** GET requests only to the Canvas host you linked, the same way as Blackboard. File bytes come from Canvas's storage host without your credentials.
- **SIS (if linked):** GET requests only for two of your own pages (Student Center, My Course History), a few times a day. Nothing is ever enrolled, dropped, paid or changed.
- **Gradescope (if linked):** two kinds of page, read-only.
- **Gmail (if connected):** list/read messages matching your teachers and course codes; send only when you press Send.
- **AI (if you set `AI_PROVIDER`):** only the one text you clicked *Summarize* on.
- Nothing else. No analytics, no font or script CDNs, no update checks.

## The menu bar app

*Semester Bar* is built on your Mac from `apps/menubar/SemesterBar.swift` (`npm run menubar`). Once a minute it asks the dashboard on `127.0.0.1` for a short summary (next deadlines, today's classes, counts). It sends nothing anywhere else and stores nothing.

## Profiles

Each profile is its own folder (the first is `data/` itself, others are `data/profiles/<id>/`) with its own database, cached files, sign-in browser profile and `secrets.enc`, encrypted with its own Keychain entry (`school-dashboard` / `vault-key:<id>`). Deleting one profile's data never touches another's. Only one profile is open at a time; switching closes it (and any sign-in window) before opening the next.

## The local server

- Binds to `127.0.0.1` and refuses to start on any other address.
- Every request must carry a `Host` of `127.0.0.1`/`localhost` (stops DNS rebinding).
- API requests must come from the dashboard's own page: a foreign `Origin`, or `Sec-Fetch-Site: cross-site`, is refused, and plain HTML form posts are refused. So a web page you visit can't read your grades or press buttons for you.
- Responses carry `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Cache-Control: no-store` for data.
- Text from Blackboard, Gradescope and email is converted to plain text before storage and is never rendered as HTML. Course files are served as downloads; only files whose first bytes prove them a PDF or PNG/JPEG/GIF are shown inside the dashboard, framed only by the dashboard itself, under a policy that allows no script. Word and text files are shown as plain text.
- OAuth sign-ins use a one-time `state` (and PKCE for Google); the one-time code is never logged.
- Notifications pass text to macOS as arguments to a fixed script, so nothing from a course page can run.

## The sign-in window

A real Chrome window with its own profile shows your school's real sign-in page. The app talks to that window over a private pipe (not a network port) and asks it for one thing: the cookie list, to tell when you're signed in. It never reads what you type or what the page shows. When you're in, it keeps the cookies for that one site (Blackboard, Canvas or the SIS) only, encrypted, and closes the window. For the SIS it also reads the window's address (not the page) to learn where your school's PeopleSoft pages live.

## Your school's rules

Reading your own Blackboard, Canvas or SIS through your own sign-in is not something those systems offer students an official way to do (Canvas access tokens are the exception, where a school allows them). Some schools' acceptable-use policies don't allow automated tools. The app is read-only and gentle on the server, but whether to use it is your decision. The calendar-link option and manual uploads involve no sign-in at all.

## Removing things

- **Unlink** (Settings): deletes that saved sign-in. When nothing is linked, the sign-in browser profile is deleted too.
- **Delete all my data** (Settings): empties the database, deletes `secrets.enc`, the Keychain key, cached files and the browser profile.
- By hand: stop the app, delete `data/`, and remove the `school-dashboard` item in Keychain Access.
