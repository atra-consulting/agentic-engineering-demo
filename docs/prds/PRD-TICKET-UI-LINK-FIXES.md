# PRD: TICKET-UI-LINK-FIXES

## Summary

### Business Summary
Three small, unrelated improvements to the internal workshop tools. Staff on the ticket board will see each ticket's number right on the card, so they can name a ticket without opening it. A piece of app feedback and the ticket it created will point at each other, so anyone can jump between the two in one click. And one German-language feedback item that still shows an English headline gets corrected — everywhere, including systems already running.

### Technical Summary
Fix 1 is template-only: render `ticket.id` inside the existing `.ticket-body-click` region on the Kanban card in `ticket-board.component.ts` (the card block repeats once per status column). Fix 2 adds a nullable `ticket.agentTaskId` column with a foreign key to `agent_task`, a guarded `ALTER TABLE` migration plus an index created *after* that ALTER, an optional field on `POST /api/tickets`, a derived `ticketId` on agent-task responses, cross-links on both admin detail pages, and a `write-ticket` skill change that fills the link at creation time. Fix 3 changes the seed title for `agent_task` id 23 and adds an idempotent corrective `UPDATE` in the seed path, because `INSERT OR IGNORE` never updates rows in an already-seeded database.

## Source

User request, task key **TICKET-UI-LINK-FIXES**. Three independent fixes bundled into one document.

Verified against the current code:
- `frontend/src/app/features/admin/tickets/ticket-board.component.ts` (inline template; the `.ticket-body-click` card region at lines 221, 263, 305, 347, 389 — one per column)
- `frontend/src/app/features/admin/tickets/ticket-detail.component.ts` (right-sidebar "Info" `dl` block, lines ~239–252), `frontend/src/app/features/admin/agent-tasks/agent-task-detail.component.ts`, `.../agent-task-list.component.ts`
- `backend/src/config/migrate.ts` (`agent_task` DDL lines 194–206, `ticket` DDL lines 208–224, shared index batch lines 260–282, guarded-ALTER precedent lines 52–93, call order lines 288–292)
- `backend/src/services/ticketService.ts`, `backend/src/routes/tickets.ts`, `backend/src/services/agentTaskService.ts`, `backend/src/routes/agentTasks.ts`
- `backend/src/seed/agentTaskSeed.ts` (row id 23 at lines 305–317, `INSERT OR IGNORE` at lines 320–333)
- `backend/src/test/agentTaskSeed.spec.ts` (line 201 asserts the old English title), `backend/src/test/ticketFullyReadyMigration.spec.ts`, `backend/src/test/helpers.ts` (`resetDatabase()`)
- `.claude/skills/write-ticket/SKILL.md` v1.5.0 (source line in Schritt 3, create call at lines 167–173)
- `docs/specs/SPEC-API-TICKETS.md`, `docs/specs/SPEC-API-TASKS.md`, `docs/specs/SPECS-database.md`, `docs/specs/SPECS-ui.md`

## Problem Statement

**Problem 1 — the board card hides the ticket number.** At `/admin/tickets` a card shows title, type badge, owner badge, and a comment count. No number. The id is bound to the card already (drag data, click navigation) but never printed. So people say "the CSV one" instead of "#7". The detail page shows "Ticket #7" — the board does not.

**Problem 2 — feedback and ticket are not linked.** The `write-ticket` skill claims an `agent_task` row and files a Kanban ticket from it. The only trace is a markdown line in the ticket body (`Quelle: …/admin/agent-tasks/<id>`). That is prose, not data. Nothing links the other way: open `/admin/agent-tasks/23` and there is no way to learn which ticket it produced. Neither table has a reference column. Reporting, navigation, and any future automation all have to parse text.

**Problem 3 — agent-task 23 has an English title on a German item.** `/admin/agent-tasks/23` shows "Improve chances". The body and the mail subject are German. The seed file is easy to change, but `seedAgentTasks()` uses `INSERT OR IGNORE` with fixed ids 1–23. It runs on every startup, yet it never updates a row that already exists. So a seed-only change fixes brand-new databases and leaves every developer laptop and every deployed Turso database stale.

## Requirements

### Group 1 — Ticket number on the Kanban card

**[REQ-101] Every board card shows its ticket number.**
Priority: High.
Reason: The number is the shared handle for a ticket. Today it is only on the detail page.
Acceptance:
- Each card in all five columns (`DEFINITION`, `TODO`, `IN_PROGRESS`, `ON_HOLD`, `DONE`) shows the ticket's numeric id.
- Format is `#<id>`, matching "Ticket #7" on the detail page and "App-Feedback #23" on the agent-task detail page.
- The number is plain text inside the card, readable by a screen reader. It is not an image, not an icon-only cue.
- The number renders **inside the card's existing clickable region** — the `.ticket-body-click` div that already carries `role="button"`, `tabindex="0"`, and the click/Enter/Space handlers. Not a sibling outside it. It does **not** become its own focusable element: no new `tabindex`, no nested button, no anchor.
- DOM order matches visual reading order. No CSS-only reordering (no flex `order`, no absolute positioning that moves the number past other content). A screen reader must read the card in the same sequence a sighted user sees it.
- The card block appears five times in the template. All five carry the change; none is missed.

**[REQ-102] The card change breaks nothing else.**
Priority: High.
Reason: The card carries drag-and-drop, click-to-detail, and keyboard handlers.
Acceptance:
- Drag handle, drag-disabled state under the "Kürzlich geändert" filter, click and Enter/Space navigation all work exactly as before.
- The two-line title clamp still works. The number does not push the title, the badges, or the comment count out of the card.
- At the 600 px single-column breakpoint the card still fits without horizontal scroll.
- The number's colour meets 4.5:1 contrast against the card's white background. Use the app's existing muted tone `#6c757d` or something darker. Anything lighter is not allowed — in particular **not** `#adb5bd`, already used elsewhere in this same component (lines ~574, ~597); it reaches only about 2.07:1 and fails.
- No backend change, no API change, no model change. `ticket.id` is already on the bound object.

### Group 2 — Link app feedback and the ticket it spawns

**[REQ-201] The ticket stores the feedback it came from.**
Priority: High.
Reason: The link must be data, not a markdown line in a text body.
Acceptance:
- New nullable integer column on the `ticket` table holding the `agent_task` id.
- Foreign key to `agent_task(id)` with `ON DELETE SET NULL`. Default `NULL`. Every existing ticket reads `null`.
- One index on the new column, matching the project's existing FK-index habit. Name it `idx_ticket_agentTaskId`, following the `idx_<table>_<column>` pattern already in `migrate.ts`. **Where** it is created matters — see REQ-202.
- The Drizzle table definition in `backend/src/db/schema/schema.ts` gains the same column.
- The column is the single stored source of truth for the link. No second stored column on `agent_task`.

#### Data Model (final — not a proposal)

These names are decided. Backend and frontend both use exactly these. No further confirmation needed.

| Where | Name | Type | Notes |
|---|---|---|---|
| `ticket` table column | `agentTaskId` | INTEGER, nullable | FK → `agent_task(id)` `ON DELETE SET NULL`, default `NULL` |
| `POST /api/tickets` request field | `agentTaskId` | integer or `null`, optional | REQ-203 |
| Every ticket response field (full DTO + list DTO) | `agentTaskId` | `number \| null` | REQ-204 |
| Every agent-task response field | `ticketId` | `number \| null` | **Derived**, not stored — REQ-205 |
| Frontend `Ticket` model | `agentTaskId` | `number \| null` | REQ-209 |
| Frontend `AgentTask` model | `ticketId` | `number \| null` | REQ-209 |

**[REQ-202] A guarded migration adds the column to databases that already exist — and the index runs after it.**
Priority: High.
Reason: `CREATE TABLE IF NOT EXISTS` never touches an existing `ticket` table. Local SQLite files and Turso production already have that table. Get the ordering wrong and the backend does not start at all.
Acceptance:
- The column is in the `CREATE TABLE IF NOT EXISTS ticket` statement, so a fresh database gets it directly.
- Startup also adds the column to a pre-existing `ticket` table, following the precedent already in `backend/src/config/migrate.ts`: PRAGMA `table_info` check, then `ALTER TABLE … ADD COLUMN`. Call the ensure helper from `runMigrations()` beside the existing `ensureTicketFullyReadyColumn()` call (currently line 289).
- **The new index must NOT go into the shared index batch** at `migrate.ts` lines ~260–282. That `executeMultiple` block runs *before* the guarded ALTER helpers. On every database that already has a `ticket` table — every existing local SQLite file, every deployed Turso database, i.e. everywhere except a brand-new `--reset-db` — the column does not exist yet at that point. `CREATE INDEX … ON ticket(agentTaskId)` would throw `no such column: agentTaskId`. That is **not** a "duplicate column" error, so no existing guard swallows it: `runMigrations()` throws, `main().catch()` calls `process.exit(1)`, and the whole backend fails to start.
- **The index is created after the guarded ALTER has run** — inside the same ensure helper, right after the column is guaranteed present, or as a separate statement placed after that helper call in `runMigrations()`. Statement style stays `CREATE INDEX IF NOT EXISTS`. Only the position in the sequence changes.
- After startup, both a fresh database and an upgraded database have the column *and* the index.
- Running the migration twice in a row does not throw.
- Two concurrent cold-starts against the same Turso database do not crash. Only the "duplicate column" error is swallowed. Every other error still throws.
- No `--reset-db` is needed to pick the column up.

**[REQ-203] `POST /api/tickets` accepts an optional `agentTaskId`.**
Priority: High.
Reason: The skill files the ticket. It must set the link in the same request. The create schema uses zod without `.strict()`, so an undeclared field is stripped in silence.
Acceptance:
- The request body accepts `agentTaskId` as an optional nullable integer, mirroring the existing optional-field pattern (`fullyReady`).
- Omitted **or** `null` → the ticket stores `null`. Same behaviour as today. Both forms are valid; neither is an error.
- A valid, existing `agent_task` id → the ticket stores it, and the `201` response body shows it.
- An id that does not exist → `400` with a field error, and **no** ticket is created. The API must not let the foreign key fail through to a `500`.
- A non-integer value → `400` with a field error.
- Existence is the only check for now. See Open Question 3 for anything beyond it.
- Auth is unchanged: agent token, loopback bypass, or admin session.

**[REQ-204] Every ticket response carries `agentTaskId`.**
Priority: High.
Reason: Services use raw `client.execute()`. A new column is invisible unless the mappers add it.
Acceptance:
- The field appears on `GET /api/tickets/:id`, `GET /api/tickets` (page), `GET /api/tickets/board`, `GET /api/tickets/next`, and the responses of `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `POST /:id/comments`, and create.
- `/wont-do` and `/hand-to-ai` return a full ticket through the same DTO mapper as every other ticket endpoint. They are not special cases — they get the field automatically once the mapper carries it, and the tests must prove it.
- Type is number or `null`. Never a string, never absent.
- Both DTO mappers (full ticket and list item) include it.

**[REQ-205] Every agent-task response carries the ticket it spawned.**
Priority: High.
Reason: The reverse direction is the half that is missing today.
Acceptance:
- Agent-task responses gain a derived field `ticketId`, of type number or `null`.
- It is resolved from the `ticket` table, not stored on `agent_task`. So it can never drift out of sync with REQ-201.
- Present on `GET /api/agent-tasks/:id`, `GET /api/agent-tasks` (page), `GET /api/agent-tasks/next`, and the responses of `/start`, `/reject`, `/done`.
- `GET /api/agent-tasks/summary` is unchanged. It returns counts only.
- If more than one ticket points at the same feedback (possible after `POST /api/agent-tasks/reset` re-arms a task and the skill runs again), the **newest ticket wins** — highest `createdAt`, tie-broken by highest id. This is the final behaviour, not a placeholder. The rule is documented, not accidental.
- No task has a ticket → the field is `null`, not an error.

**[REQ-206] Both admin detail pages link to the other side, in one shared visual pattern.**
Priority: High.
Reason: This is the point of the whole fix — one click either way. A symmetric feature should look symmetric.
Acceptance:
- `/admin/tickets/:id` shows a clickable link to `/admin/agent-tasks/<agentTaskId>` when the ticket has a reference. Label names the target in German, in line with the existing page title wording ("App-Feedback #23").
- On the ticket page the link goes into the **existing right-sidebar "Info" `dl` block** (lines ~239–252), alongside ID / Status / Eigentümer / Typ. That block already holds exactly this kind of key-value metadata. No new panel, no new card.
- `/admin/agent-tasks/:id` shows a clickable link to `/admin/tickets/<ticketId>` when a ticket exists. Label follows the existing wording ("Ticket #7").
- **Both sides use the same visual pattern.** Pick one treatment — inline text link, outline button, or a `dl` row — and use it on both pages. Not one style here and another style there. The exact treatment is Open Question 2; the "must match" rule is not open.
- No reference → nothing is rendered. No empty link, no dash-only row that reads like a broken link.
- Links use Angular `routerLink`, not `href` and not a raw anchor that triggers a full page reload.
- If the referenced record no longer exists, the target page's existing not-found / error state handles it. No new dedicated UI state, no pre-flight existence check, no extra request. (REQ-207 already keeps the agent-task derived field `null` after `POST /api/tickets/reset`, so that path does not produce a stale link. This bullet covers any other future path.)
- Both admin routes keep their `roleGuard('ROLE_ADMIN')`. No new route, no new guard.

**[REQ-207] No other path writes or clears the link.**
Priority: Medium.
Reason: One write point keeps the surface small and predictable.
Acceptance:
- Create is the only write. `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `POST /:id/comments` leave the reference untouched. `GET /api/tickets/next` only reads it.
- The human "Neues Ticket" modal on the board does not offer the field. A hand-made ticket has no feedback source.
- `POST /api/tickets/reset` still works: it deletes all tickets and re-seeds. Afterwards the linked agent tasks report `null`. The foreign key points from `ticket` to `agent_task`, so the delete hits no constraint.
- `POST /api/agent-tasks/reset` only re-arms status. Existing links survive it.
- Seeded tickets (ids 1–12) keep `null`.

**[REQ-208] `write-ticket` sets the link at creation time.**
Priority: High.
Reason: The skill is the only producer of feedback-born tickets.
Acceptance:
- **Depends on REQ-203.** The skill change ships together with the API change, or after it — never before. zod has no `.strict()` here, so a skill that sends `agentTaskId` against an API that does not declare it gets the field stripped in silence, with a `201` and no link. Sequence these two correctly.
- Schritt 3's create call carries `agentTaskId` in the JSON payload, in **all four** input modes. The value is conditional, the key is not.
- Queue mode, task-ID mode, task-URL mode → the claimed `agent_task` id.
- Free-text mode → `null`. The key stays present. Do **not** omit it — REQ-203 treats `null` and omitted the same, and a conditional value is far simpler than a conditional key.
- Use the exact same placeholder-substitution pattern the payload already uses for `fullyReady`: a plain JSON value swapped per run, no quotes, not escaped as a string. `fullyReady` is the proven precedent in this same inline template; follow it.
- Key off the condition the skill already uses in Schritt 3 for the `Quelle:` line — "was an agent task claimed?". Task-backed modes emit the `Quelle:` line and the id; free-text mode emits neither and sends `null`. One condition, two effects.
- The existing `Quelle: <APP_FRONTEND_URL>/admin/agent-tasks/<id>` line in the ticket body stays. The body is also read outside the app (CI logs, plain markdown), so the human-readable trace keeps its value.
- Everything else in the skill is unchanged: same four body sections, same `fullyReady` logic, same comment branch, same task close, same final print.
- Front matter: `version` goes from `1.5.0` to exactly **`1.6.0`**, and `last-modified` gets the change date. The repo's own history sets the precedent — adding `fullyReady` to this very same create call was a minor bump, 1.4.0 → 1.5.0. Same class of change, same size of bump.
- `docs/specs/SPEC-API-TICKETS.md` is the API reference this skill cites. It must show the new field before the skill relies on it — see REQ-210.

**[REQ-209] Models and services on the frontend carry both fields.**
Priority: High.
Reason: Templates cannot bind to fields the TypeScript model does not declare.
Acceptance:
- `Ticket` gains `agentTaskId`. `AgentTask` gains `ticketId`.
- Both are typed `number | null`.
- No service method signature changes. Both fields ride along on existing responses.

**[REQ-210] The specs describe the link.**
Priority: High.
Reason: `SPEC-API-TICKETS.md` and `SPEC-API-TASKS.md` are the contracts skill authors read. The `write-ticket` skill (REQ-208) cites `SPEC-API-TICKETS.md` by name as its own reference — a stale spec is a stale contract for real, running automation, not just documentation debt.
Acceptance:
- `SPEC-API-TICKETS.md`: the ticket object, the ticket list item, the create endpoint, and the "For skill authors" table show `agentTaskId`.
- `SPEC-API-TICKETS.md`, create endpoint: the **example request payload** shown for `POST /api/tickets` includes `agentTaskId` — not just a prose mention in the field table. The `write-ticket` skill's own payload mirrors that example, so the example is the contract.
- `SPEC-API-TASKS.md`: the task object shows `ticketId`, with the "newest ticket wins" rule stated.
- `SPECS-database.md`: the `ticket` table listing gains the column and the index. The line "No FKs." under the ticket table becomes wrong and must be corrected.

### Group 3 — Agent-task 23 gets its German title

**[REQ-301] The seed carries the German title.**
Priority: High.
Reason: New databases must be right from the first startup.
Acceptance:
- Row id 23 in `backend/src/seed/agentTaskSeed.ts` reads "Chancen verbessern".
- `source`, `body`, `metadata`, `status`, and both timestamps stay byte-identical. Only the title changes.
- A fresh database (`./start.sh --reset-db`) shows the German title at `/admin/agent-tasks/23`.

**[REQ-302] Already-seeded databases get corrected on the next startup.**
Priority: High.
Reason: `INSERT OR IGNORE` leaves existing rows alone forever. A seed-only change would leave every local and deployed database stale, and there is no way to know which ones.
Acceptance:
- The seed path runs a corrective `UPDATE` after the `INSERT OR IGNORE` batch, on every startup.
- It targets id 23 only, and only when the title is still exactly the old English value. A row already carrying the German title is untouched.
- A row a human renamed to something else is untouched.
- Only `title` changes. `status`, `comment`, `pickedUpAt`, `resolvedAt`, `createdAt`, and `updatedAt` stay as they are — the correction is a data fix, not a lifecycle event, and must not disturb a task that is `DONE` or `REJECTED`.
- Running startup twice changes nothing the second time. Zero rows affected, no error.
- No `--reset-db` is required. No manual SQL step is documented as the fix.

**[REQ-303] The stale test assertion is corrected.**
Priority: High.
Reason: `backend/src/test/agentTaskSeed.spec.ts` line 201 asserts the old English string. It will fail the moment REQ-301 lands.
Acceptance:
- The assertion expects "Chancen verbessern".
- The suite's existing comment block, which explains why row 23 is asserted against the exported constant rather than the live database, is updated to match the new corrective-update behavior.

## Out of Scope

Explicitly excluded from this work. Not oversights.

- **No board-card badge or icon marking feedback-origin tickets.** The card stays compact. The link is visible on the detail page only.
- **No "Ticket" column on the `/admin/agent-tasks` list view.** The derived field ships on the API, but the list table does not render it.
- **No way to set or clear the link outside create.** REQ-207 locks this: create is the only write path. No PATCH, no admin form field, no "link an existing ticket" action.
- **No frontend `fullyReady` field on the `Ticket` model.** The backend returns it, the model does not declare it. Pre-existing gap, unrelated to this work.
- **No `/admin/tickets` route entries in `SPECS-frontend.md`.** Also pre-existing.
- **No extraction of the repeated card block into a shared component.** All five copies get edited in place. An extraction is a bigger, riskier refactor.

## Special Instructions

- **Three independent fixes.** No shared code, no shared migration, no shared test. Each can ship on its own. Do not merge them into one change set for convenience.
- **The card block repeats five times.** The board template duplicates the card markup per column (lines 221, 263, 305, 347, 389). Change all five.
- **Follow the guarded-ALTER precedent exactly.** `ensureTicketFullyReadyColumn()` / `alterTicketAddFullyReadyColumn()` in `backend/src/config/migrate.ts` is the model. Split the ALTER into its own exported function so a test can fire it directly.
- **The new index runs after the ALTER, never in the shared index batch.** See REQ-202. Getting this backwards stops the backend from starting on every existing database. This is the single highest-risk line of the whole PRD.
- **The new column must default to `NULL`.** SQLite refuses an `ALTER TABLE … ADD COLUMN` that carries a `REFERENCES` clause unless its default is `NULL`. This is a hard constraint, not a preference.
- **Raw SQL, not the Drizzle query builder.** Services call `client.execute()`. Nothing maps a new column automatically. Add it to the row types and to both mappers by hand.
- **zod has no `.strict()` here.** An undeclared request field is stripped without an error. Declare the create field or the skill will send it forever with no effect. Ship REQ-203 before or with REQ-208.
- **Validate the foreign key in the service, not in SQLite.** `PRAGMA foreign_keys` is `ON`. An unknown id would surface as a raw SQLite error and a `500`. Return a `400` instead.
- **Never say "run `--reset-db`" as the fix for REQ-302.** Production runs on Turso. There is no reset there.
- **Do not rewrite the ticket body format.** The `Quelle:` line stays exactly as it is.

## Implementation Approach (high-level, no code)

**Fix 1 — board card (frontend only)**
- `frontend/src/app/features/admin/tickets/ticket-board.component.ts`: render the id inside the existing `.ticket-body-click` div, in all five `@for` blocks. Place it in DOM reading order — no CSS `order`. Add a small style rule in the component `styles` array if the placement needs one; colour `#6c757d` or darker.

**Fix 2 — the link**
- `backend/src/config/migrate.ts`, in this order:
  1. Add `agentTaskId INTEGER REFERENCES agent_task(id) ON DELETE SET NULL` to the `CREATE TABLE IF NOT EXISTS ticket` statement (fresh databases).
  2. Add a guarded ensure/alter helper pair for the column, modelled on `ensureTicketFullyReadyColumn()` / `alterTicketAddFullyReadyColumn()`.
  3. Call that helper from `runMigrations()` beside the existing `ensureTicketFullyReadyColumn()` call (~line 289).
  4. Create `idx_ticket_agentTaskId` **after** that helper has run — inside the helper's tail or as a statement placed after the call. **Do not touch the shared index batch at lines ~260–282.** It executes before the guarded ALTERs and would throw `no such column: agentTaskId` on every already-existing database, killing startup.
- `backend/src/db/schema/schema.ts`: add the column with its reference to the `ticket` table definition.
- `backend/src/services/ticketService.ts`: extend the row type, both DTOs, both mappers, and `create()`. Add the existence check before insert.
- `backend/src/routes/tickets.ts`: add the optional nullable integer to the create zod schema and pass it through. No auth or route change.
- `backend/src/services/agentTaskService.ts`: extend the DTO and add the derived `ticketId` lookup to `findById`, `findNext`, `start`, `reject`, `done`, and `findAll`. A correlated subquery on the existing select is enough — no second round trip per row. Order by `createdAt DESC, id DESC`, limit 1.
- `frontend/src/app/core/models/ticket.model.ts` and `agent-task.model.ts`: add the two fields.
- `frontend/src/app/features/admin/tickets/ticket-detail.component.ts`: render the conditional cross-link inside the right-sidebar "Info" `dl`. `.../agent-tasks/agent-task-detail.component.ts`: render the matching cross-link in the same visual pattern.
- `.claude/skills/write-ticket/SKILL.md`: Schritt 3 create payload always carries the `agentTaskId` key; value is the claimed id in the three task-backed modes and `null` in free-text mode, keyed off the same condition as the `Quelle:` line. Version → 1.6.0, date bump.
- Docs: `docs/specs/SPEC-API-TICKETS.md` (including the create example payload), `docs/specs/SPEC-API-TASKS.md`, `docs/specs/SPECS-database.md`.

**Fix 3 — the title**
- `backend/src/seed/agentTaskSeed.ts`: change the id-23 title; add the guarded corrective `UPDATE` at the end of `seedAgentTasks()`, so it runs everywhere the seed runs — local startup, Vercel cold start, and the test suites that call the seeder directly.
- `backend/src/test/agentTaskSeed.spec.ts`: fix the assertion and the header comment.

## Test Strategy

**Fix 1 — frontend, Jasmine/Karma in `ticket-board.component.spec.ts`**
- Each column renders its ticket's number as text. Cover at least one card per column.
- The number sits inside the `.ticket-body-click` element, not as a sibling.
- The number element carries no `tabindex` and is not a button or anchor.
- Title, type badge, owner badge, and comment count still render.
- The existing drag-and-drop, rollback, and recent-filter tests stay green untouched.

**Fix 2 — frontend, Jasmine/Karma**
- `ticket-detail.component.spec.ts`: with `agentTaskId` set → the cross-link renders and points at `/admin/agent-tasks/<id>`; with `agentTaskId` `null` → nothing renders; the link uses `routerLink` (assert the router-link directive / navigation, not a plain `href`).
- `agent-task-detail.component.spec.ts`: same three cases for `ticketId` → `/admin/tickets/<id>`.

**Fix 2 — backend, Playwright in `backend/src/test/tickets.spec.ts` and `agentTasks.spec.ts`**
- **Isolation first.** The shared helper `resetDatabase()` clears `agent_task` (re-seeded with fixed ids 1–23) but does **not** clear `ticket` or `ticket_comment`. The whole backend suite runs serially against one shared database (`workers: 1`). A ticket left behind by an earlier spec file, linked to a fixed agent-task id, makes any "this task has no ticket → `null`" assertion order-dependent and flaky. So: link and derived-field tests must call `POST /api/tickets/reset` (or delete their own rows explicitly) before asserting, **or** use agent-task ids no other suite links a ticket to. State the chosen approach in the spec file's header comment.
- Create without the field → `agentTaskId` is `null`.
- Create with `agentTaskId: null` → `201`, stored `null`. Same as omitted.
- Create with a valid agent-task id → `201`, field set, and the ticket still lands `status=DEFINITION`, `owner=HUMAN`.
- Create with an unknown id → `400`, and no ticket row is created (assert the count).
- Create with a non-integer → `400`.
- The field reads back through `GET /:id`, the page list, `/board`, and `/next`.
- `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `/comments` all return the field and leave it unchanged. `GET /api/tickets/next` returns it unchanged too.
- Agent-task read paths report `ticketId`, and `null` when there is none.
- Two tickets pointing at one task → the agent task reports the newest (`createdAt` desc, then id desc).
- `POST /api/tickets/reset` with a linked ticket present → `200`, and the agent task then reports `null`.

**Fix 2 — migration, a new Playwright spec beside `ticketFullyReadyMigration.spec.ts`**
- The ensure helper is safely callable twice.
- The ALTER fired directly against a table that already has the column swallows "duplicate column" and resolves.
- A genuinely different SQL error still throws.
- **Ordering regression guard:** against a `ticket` table that exists *without* the column, a full `runMigrations()` completes without throwing, and afterwards both the column and `idx_ticket_agentTaskId` exist. This is the test that catches the index-before-ALTER bug.
- On a fresh test database the column arrives from `CREATE TABLE`, is nullable, and every seeded ticket reads `null`.

**Fix 3 — backend, Playwright in `agentTaskSeed.spec.ts`**
- The exported seed constant carries the German title (updated existing assertion).
- Insert a row with id 23 carrying the old English title, run the seeder, then read the title → German.
- Run the seeder again → still German, no error.
- Set id 23 to a custom title, run the seeder → the custom title survives.
- A `DONE` row with id 23 keeps `status`, `resolvedAt`, and `comment` after the correction.

**Manual**
- Open `/admin/tickets` and read a number off a card in every column.
- Resize the browser to 600 px width. Confirm the board is single-column, no horizontal scroll appears, the title still clamps to two lines, and the badges and comment count stay inside the card. (REQ-102 layout check — visual, not unit-testable.)
- At 600 px, tab to a card. Focus lands on the card region once, not twice. Enter opens the detail page.
- Check the number's colour against the white card with a contrast checker — 4.5:1 or better.
- Run `/project:write-ticket` against an open feedback item, then walk ticket → feedback → ticket in the browser. Confirm both links look the same.
- Run `/project:write-ticket` in free-text mode. Confirm the ticket is created and `agentTaskId` is `null`.
- Start the backend against an **already-seeded** local database (no `--reset-db`). Confirm it starts without error, `/admin/agent-tasks/23` reads "Chancen verbessern", and the new column and index exist.

## Non-Functional Requirements

- **Backward compatible.** Both new API fields are additive on responses and optional on requests. Every existing client keeps working.
- **Idempotent startup.** The new migration and the corrective update are safe on repeat startups and on concurrent Vercel cold-starts against one Turso database.
- **Startup must not break.** A migration-ordering mistake is a hard outage, not a degraded feature. See REQ-202.
- **No new auth surface.** No new endpoint, no new role, no new guard, no new token.
- **Negligible cost.** One indexed nullable column, one correlated subquery on agent-task reads (page size 20), one guarded single-row update per startup.
- **Accessible.** The card number is text, not colour or an icon, inside the existing focusable region, in DOM reading order, at 4.5:1 contrast or better. The cross-links are real router links with visible text.
- **German UI.** All new user-facing labels are German, matching the existing admin pages.
- **No data loss.** The title correction never touches lifecycle columns. The link column never overwrites anything.

## Success Criteria

- [x] Every card in all five board columns shows its ticket number, and drag, click, and keyboard navigation still work. Verified in-browser: `#1`–`#12` visible on every card in all five columns; Tab focuses the card region once; Enter and Space both open the detail page without a page scroll.
- [x] The number sits inside the existing clickable card region, in DOM reading order, at 4.5:1 contrast or better. `#6c757d` on white computes to ≈4.6:1; confirmed by ui-reviewer during plan review.
- [x] `ticket` has a nullable, indexed `agentTaskId` column with a foreign key to `agent_task`. Commit `8f9c582`.
- [x] An existing local database and Turso pick the column up on a plain restart — the backend starts, no `--reset-db`, no `no such column` error. Verified live: killed and restarted the dev backend against the existing (non-reset) local SQLite file; it started cleanly and migrated in place.
- [x] `POST /api/tickets` accepts `agentTaskId`, rejects an unknown id with `400`, and creates no orphan ticket on that path. Commit `e81d97a`; covered by automated tests in `5aa2981`.
- [x] Every ticket response returns `agentTaskId` — including `/wont-do` and `/hand-to-ai`. Every agent-task response returns the derived `ticketId`. Verified live via the real `POST /api/tickets` and `GET /api/agent-tasks/:id` calls made during manual acceptance (ticket #13 ↔ agent-task #1).
- [x] Two tickets on one task → the agent task reports the newest. Covered by an automated test in `5aa2981` (newest-wins, `createdAt DESC, id DESC`).
- [x] `/admin/tickets/:id` links to its feedback from the Info sidebar, and `/admin/agent-tasks/:id` links to its ticket. Same visual pattern both sides. Both hide the link when there is none. Both use `routerLink`. Verified in-browser both directions (ticket #13 → App-Feedback #1 → Ticket #13), and the negative case (seeded ticket #1 and agent-task #23, both unlinked, show no extra row).
- [x] `write-ticket` sends the claimed id in queue, id, and URL modes, and `null` in free-text mode. Version reads 1.6.0. Verified by running the skill live in queue mode (created ticket #13 with `agentTaskId: 1`) and in free-text mode (created a ticket with `agentTaskId: null`, then removed via reset). Commit `3ffe48c`.
- [x] `/admin/agent-tasks/23` reads "Chancen verbessern" on a fresh database and on an already-seeded one. Verified in-browser on the existing (already-seeded) local database, without `--reset-db`. Commit `076332d`.
- [x] Re-running startup twice changes no agent-task data. Covered by an automated test in `5aa2981`.
- [x] `SPEC-API-TICKETS.md` (field tables *and* the create example payload), `SPEC-API-TASKS.md`, and `SPECS-database.md` describe the link. Commits `3087b60`, `8278f89`.
- [x] Full backend Playwright suite and full frontend Karma suite green. 385/385 backend, 535/535 frontend, both confirmed with a live run after all implementation and review rounds.

## Open Questions

1. ~~Exact placement of the ticket number on the card~~ **Resolved during implementation:** its own small muted line directly above the title, inside the existing clickable region, colour `#6c757d`. See `PLAN-TICKET-UI-LINK-FIXES.md` task group 1.
2. Exact visual treatment of the two cross-links — inline text link, outline button, or a row in the existing `dl` block? Whatever wins must be used on **both** pages (REQ-206), and on the ticket page it lives in the right-sidebar "Info" block either way. **Resolved during implementation:** a `dl` row holding an inline text link, used identically on both the ticket and agent-task detail pages.
3. Should `POST /api/tickets` validate anything beyond "the agent-task id exists"? For example: reject an id already linked to another ticket, or reject one whose status is terminal (`DONE` / `REJECTED`). REQ-203 ships existence-only, which is a reasonable default — but nobody has decided this on purpose until now, so it needs a product answer rather than an assumption. Note REQ-205 already tolerates duplicates by design ("newest wins"). **Still open** — shipped as existence-only per REQ-203; a future ticket can revisit this if it becomes a real problem.

## Implementierung

Branch: `ticket-ui-link-fixes`.

Commits:
- `3d6ea0c` docs: Initialize state tracking
- `9434462` docs: Add specifications (PRD)
- `0db84ed` docs: Document backend and frontend test commands in AGENTS.md
- `bf1d89f` docs: Add detailed plan
- `076332d` fix: Correct agent-task 23 title to German, with idempotent update for existing databases
- `8f9c582` feat: Add ticket.agentTaskId column with guarded migration
- `ee2bc11` feat: Show ticket number on Kanban board card
- `8278f89` docs: Document ticket.agentTaskId column and index in SPECS-database.md
- `e81d97a` feat: Add agentTaskId/ticketId to ticket and agent-task API responses
- `83c24d3` feat: Add agentTaskId/ticketId to frontend models and render cross-links
- `3087b60` docs: Document agentTaskId/ticketId fields in ticket and agent-task API specs
- `946c542` test: Add frontend tests for card number and cross-links
- `5aa2981` test: Add backend tests for ticket-agentTask link and migration ordering
- `e530573` fix: Assert fieldErrors.agentTaskId on non-integer validation tests
- `3ffe48c` feat: Have write-ticket skill send agentTaskId when creating a linked ticket

PR: see the pull request opened from `ticket-ui-link-fixes` against `main`.

## Technical Notes

*Technical readers only.*

- The index-ordering trap in REQ-202 is the one bug in this PRD that takes the whole service down. `migrate.ts` runs table DDL (lines 109–258), then the shared index batch (260–282), then seeds and guarded ALTERs (288–292). Any index touching a guarded-ALTER column must live after step three, never in step two. `CREATE INDEX IF NOT EXISTS` protects against a duplicate index, not against a missing column.
- SQLite allows `ALTER TABLE … ADD COLUMN` with a `REFERENCES` clause only when the column's default is `NULL`. That fits REQ-201 as written, but it rules out ever making the column `NOT NULL` in a later in-place migration.
- SQLite does not enforce a FK added this way retroactively on existing rows — they are all `NULL` anyway, so this is moot here.
- `PRAGMA foreign_keys = ON` is set once in `runMigrations()`. So the FK is enforced at runtime, and an unvalidated create would produce a `500`. Hence the explicit existence check in REQ-203.
- Tests delete `agent_task` rows directly (`agentTaskSeed.spec.ts` lines 71, 99, 151, 179). With `ON DELETE SET NULL` that nulls any ticket link instead of failing the delete. Without the clause it would fail. The clause is load-bearing for the existing suite.
- `resetDatabase()` in `backend/src/test/helpers.ts` does not clear `ticket` / `ticket_comment`. Combined with `workers: 1` and one shared database, ticket rows leak across spec files. That is why the Test Strategy pins an isolation approach for the link tests.
- The frontend `Ticket` model does not currently declare `fullyReady`, although the backend returns it. Pre-existing gap, listed under Out of Scope.
- `SPECS-frontend.md` does not list the `/admin/tickets` routes at all. Also pre-existing, also Out of Scope — noted so nobody treats it as a regression from this work.
- Project convention (`AGENTS.md`): a commit that implements a PRD carries a `PRD: docs/prds/<name>.md` footer, and the PRD gains an `## Implementierung` section linking the commits and PRs. Add that section to this document at commit time.
