# Architecture

```
            ┌──────────────── your Mac (127.0.0.1 only) ────────────────┐
 Blackboard │  connectors/            apps/server               apps/web │
  ical  ────┼─▶ blackboard/ical ──┐                                       │
  REST  ────┼─▶ blackboard/rest ──┤   sync loop (30 min)      React UI    │
  session ──┼─▶ blackboard/session┤──▶ saveSync() ─▶ SQLite ─▶ /api/* ──▶  │
 Gradescope─┼─▶ gradescope ───────┤                  │                    │
 Qwickly ───┼─▶ qwickly ──────────┤                  ├─▶ /calendar.ics ─▶ Google/Apple Calendar
 Gmail  ────┼─▶ gmail ────────────┘                  │                    │
 Syllabus ──┼─▶ upload ─▶ syllabus-parser ─▶ review ─┘                    │
            │                  ▲                                          │
            │                  └── ai/ (optional, on click only)          │
            │   Keychain: OAuth refresh tokens, session cookies            │
            └──────────────────────────────────────────────────────────┘
```

## Pieces

**`packages/core`**: the shared data model (`types.ts`) and the pure logic that doesn't care where data came from: `courseGrade`, `requiredOnRemaining` (what-if), `letterFor`, `gpa`, `workloadByDay`, `findConflicts`, `assignmentsToIcs`. No I/O; easy to test.

**`packages/connectors`**: one `Connector` per source with the same shape: `status()`, optional `connect()` (start sign-in), `sync()` returning a partial `SyncResult`, and optional actions (`download`, `submit`, `sendMessage`). Each declares `capabilities` so the UI only shows buttons that will work. Connectors never touch the DB; the server saves what they return.

**`packages/syllabus-parser`**: `extractText` (PDF via unpdf, DOCX via mammoth) → `extractWeights`, `extractDates`, `extractPolicies`. All rule-based. Returns `needsHelp` when it finds nothing, so the UI can *offer* the AI pass.

**`packages/ai`**: `AiProvider` with `summarize` and `extractJson`. `none` (default), `anthropic` (official SDK), `openai-compatible` (Ollama/LM Studio/OpenAI).

**`apps/server`**: Fastify on 127.0.0.1. Opens SQLite (`node:sqlite`), runs migrations, runs connectors on a timer and on demand (`POST /api/sync`), serves `/api/dashboard`, `/api/connectors`, `/api/syllabus`, `/calendar.ics`. Secrets through `secrets/keychain.ts` (macOS `security` CLI).

**`apps/web`**: React + Vite. One shell (top bar, left rail, panel grid). Vite proxies `/api` to the server.

## Merging sources

The same assignment can come from the calendar feed, the REST API and a syllabus. Rules:

1. Record IDs are `<source>:<externalId>`; each source upserts its own rows.
2. Today (v0.2): a syllabus item is hidden when a live source (calendar feed, later the API) has an item for the same course on the same local day with the same kind or a mostly-matching title (`dedupeAssignments`). Planned: full field-level merging by source priority REST > session > Gradescope > calendar feed > syllabus > manual, with your manual edits always winning.
3. Course matching (`matchCourse`): your saved fix-ups first, then the course code in any spelling, then a unique full course name. Unsure → "Unmatched", never a guess.
4. Every record keeps `sources[]`, so the UI can show "from Blackboard · syllabus" and link back.

## Sync etiquette

Every 30 minutes by default, sequential, one request at a time per host, with backoff on errors. Session readers fetch only your own courses.
