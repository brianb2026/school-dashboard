# Privacy and security

## What is stored, and where

| What | Where | Protection |
|---|---|---|
| Classes, assignments, grades, announcements, email subjects/snippets | `data/school.sqlite` | Folder and file readable by your user only (0700 / 0600) |
| Saved sign-ins: Blackboard / Gradescope session cookies, OAuth tokens, the calendar link | `data/secrets.enc` | AES-256-GCM; the 32-byte key is in the macOS login Keychain (service `school-dashboard`) |
| The sign-in window's own browser profile (your school's single sign-on cookies) | `data/browser-profile/` | Chrome's own cookie encryption; deleted when you unlink everything or wipe |
| Course files you opened | `data/files/` | Named by hash, readable by you only |
| Passwords | **nowhere** | You type them on the real sign-in page, in a real browser window |

`data/`, `.env` and `config/school.json` are git-ignored.

What the Keychain-held key does and doesn't do: it makes `secrets.enc` useless to anything that copies, backs up or syncs the file. It does not protect against malware already running as your user (nothing on a desktop does).
On systems without a Keychain the key is a file next to the data (`data/.vault-key`, readable by you only), which is weaker.

## What the app does on the network

- **Blackboard:** GET requests only, to the one host you linked, one at a time with a pause between them, at most a few hundred per sync, every 30 minutes (files and people every 6 hours). Credentials are only ever sent to that host; a redirect to another host (e.g. file storage) is followed without them. Nothing is ever submitted, posted or changed.
- **Gradescope (if linked):** two kinds of page, read-only.
- **Gmail (if connected):** list/read messages matching your teachers and course codes; send only when you press Send.
- **AI (if you set `AI_PROVIDER`):** only the one text you clicked *Summarize* on.
- Nothing else. No analytics, no font or script CDNs, no update checks.

## The local server

- Binds to `127.0.0.1` and refuses to start on any other address.
- Every request must carry a `Host` of `127.0.0.1`/`localhost` (stops DNS rebinding).
- API requests must come from the dashboard's own page: a foreign `Origin`, or `Sec-Fetch-Site: cross-site`, is refused, and plain HTML form posts are refused. So a web page you visit can't read your grades or press buttons for you.
- Responses carry `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Cache-Control: no-store` for data.
- Text from Blackboard, Gradescope and email is converted to plain text before storage and is never rendered as HTML. Course files are always served as downloads.
- OAuth sign-ins use a one-time `state` (and PKCE for Google); the one-time code is never logged.
- Notifications pass text to macOS as arguments to a fixed script, so nothing from a course page can run.

## The sign-in window

A real Chrome window with its own profile shows your school's real sign-in page. The app talks to that window over a private pipe (not a network port) and asks it for one thing: the cookie list, to tell when you're signed in. It never reads what you type or what the page shows. When you're in, it keeps the cookies for your Blackboard host only, encrypted, and closes the window.

## Your school's rules

Reading your own Blackboard through your own sign-in is not something Blackboard offers students an official way to do. Some schools' acceptable-use policies don't allow automated tools. The app is read-only and gentle on the server, but whether to use it is your decision. The calendar-link option and manual uploads involve no sign-in at all.

## Removing things

- **Unlink** (Settings): deletes that saved sign-in. When nothing is linked, the sign-in browser profile is deleted too.
- **Delete all my data** (Settings): empties the database, deletes `secrets.enc`, the Keychain key, cached files and the browser profile.
- By hand: stop the app, delete `data/`, and remove the `school-dashboard` item in Keychain Access.
