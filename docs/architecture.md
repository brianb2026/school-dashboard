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

**`packages/core`**: the shared data model and all pure logic: `resolveCourseGrade` (which number is the class grade, with every alternative), `gradeTrend`, `requiredOnRemaining` (what-if), `gpa`, `mergeAssignments` (one row per real item across sources), `matchCourse`, `matchCategory`, `workloadByDay`, `findConflicts`, `assignmentsToIcs`, `htmlToText`. No I/O. The web UI imports the same functions to run what-ifs in the page.

**`packages/connectors`**: one `Connector` per source: `status()`, `sync()` returning a partial `SyncResult` (plus which id prefixes it is authoritative for, so deletions propagate), optional `download()` and `sendMessage()`. Connectors never touch the database. The Blackboard code is split into a read-only HTTP client (`client.ts`), pure mapping (`map.ts`) and the sync pass (`sync.ts`), shared by the session and OAuth connectors.

**`packages/syllabus-parser`**: text extraction (PDF lines rebuilt from positions, DOCX, TXT) and rule-based readers for weights, dated items, letter scale, credits, class times, contact and late policy.

**`apps/server`**: Fastify on 127.0.0.1. `db/` (SQLite via `node:sqlite`, versioned migrations), `secrets/vault.ts` (AES-GCM file, key in Keychain), `signin/` (Chrome window over a private pipe, link state machine, quiet renewal), `sync/` (one sync at a time, auto syllabus pull, back-off), `notify.ts`, `routes/` (one payload for the whole UI at `/api/dashboard`, small mutation routes, OAuth callbacks). In production it also serves the built UI.

**`apps/web`**: React + Vite. One shell, nine views, all rendered from the single dashboard payload.

## Merging sources

The same assignment can come from the calendar feed, the REST API and a syllabus. Rules:

1. Record IDs are `<source>:<externalId>`; each source upserts its own rows.
2. `mergeAssignments` collapses the same item seen by several sources into one row: Blackboard beats Gradescope beats the calendar feed beats the syllabus; items you added are never merged away; two rows from one source are never merged. A grade on a hidden duplicate follows to the row that is shown; a score you typed wins over a synced one.
3. Course matching (`matchCourse`): your saved fix-ups first, then the course code in any spelling, then a unique full course name. Unsure → "Unmatched", never a guess.
4. Every record keeps `sources[]`, so the UI can show "from Blackboard · syllabus" and link back.

## Sync etiquette

Every 30 minutes by default, sequential, one request at a time per host, with backoff on errors. Session readers fetch only your own courses.
