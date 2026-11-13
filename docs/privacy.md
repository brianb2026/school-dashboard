# Privacy and security

- **Local only.** Server and UI bind to 127.0.0.1. Don't change `HOST` to `0.0.0.0`.
- **No passwords.** Sign-in always happens on the real Blackboard / Google / school SSO page, in a real browser window. The app keeps only the resulting token or session cookie.
- **Secrets in the Keychain.** Service name `school-dashboard`. View or delete them in Keychain Access.
- **What's in git:** code, docs, `.env.example`, `config/school.example.json`. **Not in git:** `.env`, `config/school.json`, `data/` (database, cached files, uploads).
- **AI is opt-in.** `AI_PROVIDER=none` by default. When enabled it runs only when you click (summarize this, help parse this), and only that text is sent. Local models via Ollama keep it on your machine.
- **Wipe:** stop the server, delete `data/`, and remove `school-dashboard` items from the Keychain.
- **Calendar link:** your Blackboard iCal URL is a bearer link. Keep it in `.env`, never in a commit or screenshot.
