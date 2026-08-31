# Implementation Plan: TICKET-UI-LINK-FIXES

## Summary

### Business Summary
Three small, unrelated improvements to the internal workshop tools. Staff on the ticket board will see each ticket's number right on the card, so they can name a ticket without opening it. A piece of app feedback and the ticket it created will point at each other, so anyone jumps between the two in one click. And one German feedback item that still shows an English headline gets corrected everywhere, including systems already running.

### Technical Summary
Fix 1 is template-only: print `ticket.id` inside the existing `.ticket-body-click` region in all five card blocks of `ticket-board.component.ts`. Fix 2 adds a nullable `ticket.agentTaskId` column with an FK to `agent_task`, a guarded `ALTER` plus an index created **after** that ALTER (never in the shared index batch at `migrate.ts` lines ~260–282), an optional create field, a derived `ticketId` on agent-task reads, cross-links on both admin detail pages, a `write-ticket` skill bump, and three spec updates. Fix 3 changes the seed title for `agent_task` id 23 and adds a guarded corrective `UPDATE`, because `INSERT OR IGNORE` never updates an existing row. Two ordering traps drive the sequencing: the index-after-ALTER rule (a wrong order kills backend startup on every existing database) and the zod-strip rule (the skill must not send `agentTaskId` before the API declares it).

## Test Command
`cd backend && npm test  &&  cd frontend && npx ng test --watch=false`

## Parallelism

- **Start now, in parallel:** groups 1, 2, 8.
- **Group 3** waits for group 2 (needs the column).
- **Group 4** may start alongside group 3 (the PRD's Data Model table pins the names), but must never merge before group 3.
- **Group 6** waits for group 3. **Group 5** waits for groups 3 and 6 (REQ-208 → REQ-203, and the skill cites `SPEC-API-TICKETS.md`).
- **Group 7** waits for group 2.
- **Group 9** waits for groups 2, 3, 8. **Group 10** waits for groups 1, 4.
- **Group 11** waits for group 9. **Group 12** waits for group 10. **Group 13** waits for everything.

## Tasks

### 1. Fix 1 — Ticket number on the Kanban card
**Agent:** fe-coder
**Model:** sonnet — template edit in an existing component, repeated five times, with a11y and contrast constraints

- [ ] File: `frontend/src/app/features/admin/tickets/ticket-board.component.ts` (inline template).
- [ ] Render `#{{ ticket.id }}` as plain text **inside** the existing `.ticket-body-click` div — the one that already carries `role="button"`, `tabindex="0"`, and the click/Enter/Space handlers (lines ~221, ~263, ~305, ~347, ~389).
- [ ] Default placement: its own small muted line directly **above** `.ticket-title`, in DOM reading order. The placement must stay identical in all five blocks.
- [ ] **This placement choice answers PRD Open Question 1** — it is a decision, not a guess: the number stays inside the clickable region, in DOM order, and `#6c757d` clears 4.5:1 on the white card. Record the decision in `docs/prds/PRD-TICKET-UI-LINK-FIXES.md` → `## Open Questions` at commit time, in the same commit that carries the `PRD: docs/prds/PRD-TICKET-UI-LINK-FIXES.md` footer (see group 13). Change the markup position only if a later UI decision overrides it.
- [ ] Add one style rule to the component `styles` array. Colour `#6c757d` or darker. **Never** `#adb5bd` (used at lines ~574, ~597; ~2.07:1, fails). A bare new line carries no default margin, so add a small `margin-bottom` (~`0.2rem`) — or equivalent spacing — beside the colour rule, so the number reads as its own line instead of sitting flush against `.ticket-title`.
- [ ] No new `tabindex`, no nested `<button>`, no `<a>`. No flex `order`, no absolute positioning.
- [ ] Do not touch the drag handle, `cdkDrag`, `[cdkDragDisabled]`, `navigateToDetail`, the `.ticket-title` clamp, badges, or the comment-count block.
- [ ] No backend, API, or model change.

**Acceptance criteria**
- The new markup appears exactly five times, once per column block; a grep for the new element returns 5 hits.
- Rendered card shows `#0`, `#1`, … as text; the number element has no `tabindex` attribute and is neither a button nor an anchor.
- The number sits on its own line with visible spacing above the title — not flush against it.
- `cd frontend && npx ng build` passes.
- Existing drag-and-drop, rollback, and recent-filter behaviour is untouched.

---

### 2. Fix 2 — DB column and guarded migration
**Agent:** db-coder
**Model:** opus — architecture-sensitive startup migration; wrong index ordering throws `no such column`, `runMigrations()` fails, and the backend does not start on **every** existing local and Turso database

- [ ] `backend/src/config/migrate.ts`, `CREATE TABLE IF NOT EXISTS ticket` (lines 208–224): add `agentTaskId INTEGER REFERENCES agent_task(id) ON DELETE SET NULL`. No `DEFAULT`, no `NOT NULL`.
- [ ] Add an exported `alterTicketAddAgentTaskIdColumn()` — the bare `ALTER TABLE ticket ADD COLUMN …` with the narrow `duplicate column` catch. Model it on `alterTicketAddFullyReadyColumn()` (lines 70–81). Split out so a test can fire it directly.
- [ ] Add an exported `ensureTicketAgentTaskIdColumn()` — `PRAGMA table_info(ticket)` guard, then the ALTER when the column is missing.
- [ ] **Then create the index inside that same helper, after the column is guaranteed present:** `CREATE INDEX IF NOT EXISTS idx_ticket_agentTaskId ON ticket(agentTaskId)`.
- [ ] **Trap — do not copy the early `return` verbatim.** `ensureTicketFullyReadyColumn()` returns early when the column exists. Copying that shape would skip the `CREATE INDEX` on a fresh database, which already has the column. Structure the helper so the index statement runs on **every** call, in both branches.
- [ ] Call `ensureTicketAgentTaskIdColumn()` from `runMigrations()` directly beside the existing `ensureTicketFullyReadyColumn()` call (line 289).
- [ ] **Do not touch the shared index batch at lines ~260–282.** It runs before the guarded ALTERs.
- [ ] `backend/src/db/schema/schema.ts`, `ticket` table (lines 123–136): add `agentTaskId` as a nullable integer referencing `agentTask.id` with `onDelete: 'set null'`. `agentTask` is declared above `ticket`, so the reference resolves.
- [ ] Do not change any seed file. Seeded tickets keep `null`.

**Acceptance criteria**
- `idx_ticket_agentTaskId` appears exactly once in `migrate.ts`, inside or after the ensure helper, at a line number greater than the shared index batch's closing backtick.
- On a database whose `ticket` table lacks the column, `runMigrations()` completes without throwing; afterwards `PRAGMA table_info(ticket)` lists `agentTaskId` and `PRAGMA index_list(ticket)` lists `idx_ticket_agentTaskId`.
- On a fresh database, both the column and the index exist after startup.
- `PRAGMA table_info(ticket)` shows `notnull = 0` and `dflt_value = null` for the new column.
- Two consecutive `runMigrations()` calls do not throw. Only `duplicate column` is swallowed; any other error rethrows.
- No `--reset-db` is needed.

---

### 3. Fix 2 — Backend API
**Agent:** be-coder
**Model:** sonnet — additive DTO/mapper/validation work with clear existing patterns

- [ ] `backend/src/services/ticketService.ts`: add `agentTaskId: number | null` to `TicketRow` (and therefore `TicketListRow`), to `TicketDTO`, and to `TicketListItemDTO`.
- [ ] Map it in **both** mappers — `toDTO()` and `toListItemDTO()`. Null-preserving numeric coercion; never a string, never absent.
- [ ] `create()`: accept `agentTaskId?: number | null`. Add the column to the `INSERT … RETURNING *` statement, arg `data.agentTaskId ?? null`.
- [ ] `create()`: when the value is a number, check existence first — `SELECT id FROM agent_task WHERE id = ?`. No row → throw `ValidationError` with a `fieldErrors.agentTaskId` entry, **before** the insert. Import `ValidationError` from `../utils/errors.js` (only `NotFoundError` and `ConflictError` are imported today).
- [ ] Do **not** add the column to any `UPDATE` statement (REQ-207). `findNext` already uses `RETURNING *`, and `start`/`done`/`ask`/`wontDo`/`handToAi`/`setStatus`/`setOwner`/`addComment` all end in `findById()`, so they inherit the field.
- [ ] `backend/src/routes/tickets.ts`, `CreateBodySchema` (lines 38–43): add `agentTaskId` as an optional, nullable integer, mirroring `fullyReady`. Non-integer and float values must fail validation. `ticketService.create(dto)` needs no other change. No auth or route change.
- [ ] `backend/src/services/agentTaskService.ts`: add `ticketId: number | null` to `AgentTaskDTO` and to `AgentTaskRow`; map it in `toDTO()` with `?? null`.
- [ ] Derive it with a correlated subquery selecting the ticket id where `ticket.agentTaskId = agent_task.id`, ordered `createdAt DESC, id DESC`, `LIMIT 1`, aliased `ticketId`.
- [ ] Add that subquery to `findById()` and to the rows query in `findAll()`. For `findNext()`, the simplest correct route is to keep the `UPDATE … RETURNING *` claim and then return `this.findById(row.id)`; a subquery in `RETURNING` is legal SQLite but the extra read is cheaper to reason about.
- [ ] `start`, `reject`, `done` already return `this.findById(id)` — no change. `getSummary()` stays untouched.

**Acceptance criteria**
- `GET /api/tickets/:id`, `GET /api/tickets`, `/board`, `/next`, and the responses of `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `POST /:id/comments`, and create all carry `agentTaskId` as a number or `null`.
- `POST /api/tickets` with no field, or with `agentTaskId: null`, returns `201` and stores `null`.
- `POST /api/tickets` with a valid agent-task id returns `201` with the field set, `status=DEFINITION`, `owner=HUMAN`.
- `POST /api/tickets` with an unknown id returns `400` with a `fieldErrors.agentTaskId` entry, and no ticket is created.
- `POST /api/tickets` with a non-integer returns `400`.
- `GET /api/agent-tasks/:id`, the page list, `/next`, `/start`, `/reject`, `/done` all carry `ticketId`; `null` when no ticket points at the task. `/summary` is unchanged.

---

### 4. Fix 2 — Frontend models and cross-links
**Agent:** fe-coder
**Model:** sonnet — two model fields, two conditional template rows, plus fixture updates the compiler forces

- [ ] `frontend/src/app/core/models/ticket.model.ts`: `Ticket` gains `agentTaskId: number | null`. Leave `TicketCreate` alone — the "Neues Ticket" modal offers no such field (REQ-207).
- [ ] `frontend/src/app/core/models/agent-task.model.ts`: `AgentTask` gains `ticketId: number | null`.
- [ ] **Compile fix required by the model change.** Six existing literals will stop compiling. Add `agentTaskId: null` to `frontend/src/app/core/services/ticket.service.spec.ts:19`, `features/admin/tickets/ticket-detail.component.spec.ts:25`, `features/admin/tickets/ticket-board.component.spec.ts:15`; add `ticketId: null` to `core/services/agent-task.service.spec.ts:12`, `features/admin/agent-tasks/agent-task-detail.component.spec.ts:10`, `features/admin/agent-tasks/agent-task-list.component.spec.ts:11`. Fix any further site the compiler flags.
- [ ] `features/admin/tickets/ticket-detail.component.ts`: inside the existing right-sidebar "Info" `dl` (lines ~239–255), add a conditional `dt`/`dd` pair when `ticket.agentTaskId` is not null. `dt` label in German, `dd` holds an inline `routerLink` anchor to `/admin/agent-tasks/<agentTaskId>` reading `App-Feedback #<id>`. `RouterLink` is already imported (line 6).
- [ ] `features/admin/agent-tasks/agent-task-detail.component.ts`: add the matching conditional `dt`/`dd` pair inside the existing `dl.row` (lines 25–54) when `task.ticketId` is not null. Anchor reads `Ticket #<id>`, `routerLink` to `/admin/tickets/<ticketId>`. `RouterLink` is already imported (line 2).
- [ ] Same treatment on both pages: a `dl` row holding an inline text link. See Open Question 2.
- [ ] No reference → render nothing. No empty row, no dash placeholder.
- [ ] No service change, no route change, no guard change.

**Acceptance criteria**
- `cd frontend && npx ng build` passes and the existing Karma suite still compiles.
- With a reference set, each detail page renders one anchor with the correct target; with `null`, neither the `dt` nor the `dd` is in the DOM.
- Both anchors use `routerLink`, not a hand-written `href`.
- Labels are German and match the existing page-title wording.

---

### 5. Fix 2 — `write-ticket` skill
**Agent:** skill-coder
**Model:** sonnet — prompt-file edit with an exact precedent, but the payload semantics matter

- [ ] File: `.claude/skills/write-ticket/SKILL.md`. **Only merge after groups 3 and 6.** zod has no `.strict()`; an early ship silently strips the field.
- [ ] Schritt 3 create payload (lines 167–173): add the `agentTaskId` key. The key is always present; only the value is conditional.
- [ ] Queue mode, task-ID mode, task-URL mode → the claimed `agent_task` id. Free-text mode → `null`.
- [ ] Key it off the same condition Schritt 3 already uses for the `Quelle:` line (lines 157–158): one condition, two effects.
- [ ] Use the `fullyReady` placeholder-substitution pattern — a plain JSON value, no quotes, not escaped as a string. Extend the "Wichtig" note (line 175) to say `agentTaskId` is a plain JSON number or `null`.
- [ ] Keep the `Quelle: <APP_FRONTEND_URL>/admin/agent-tasks/<id>` body line exactly as it is.
- [ ] Change nothing else: same four body sections, same `fullyReady` logic, same 3a/3b branches, same Schritt 4 close, same Schritt 5 print.
- [ ] Front matter: `version: 1.5.0` → `1.6.0`; `last-modified` → the implementation date.

**Acceptance criteria**
- The `-d` payload in Schritt 3 contains `agentTaskId` alongside `type`, `title`, `body`, `fullyReady`.
- The skill text states `null` for free-text mode explicitly and forbids omitting the key.
- Front matter reads `version: 1.6.0`.
- No other section of the file changed.

---

### 6. Fix 2 — API spec docs
**Agent:** be-coder
**Model:** sonnet — contract docs a live skill reads; the create example is load-bearing

- [ ] `docs/specs/SPEC-API-TICKETS.md`: add `agentTaskId` to the ticket object JSON example (~line 43–51), to the ticket list-item shape, and to the create endpoint's body line and prose (lines ~301–303).
- [ ] Same file: the **example request payload** shown for `POST /api/tickets` must include `agentTaskId`. Prose alone is not enough — the skill mirrors the example.
- [ ] Same file: the "For skill authors" table (line ~541) shows the field on the Create row.
- [ ] `docs/specs/SPEC-API-TASKS.md`: add `"ticketId"` to the Task object JSON (lines 22–36) and a bullet under it (lines 38–40) stating the field is **derived**, not stored, and that the **newest ticket wins** — highest `createdAt`, tie-broken by highest id. Note `/summary` is unaffected.

**Acceptance criteria**
- Both JSON examples show the new field with a realistic value.
- The `POST /api/tickets` example payload literally contains `agentTaskId`.
- The "newest ticket wins" rule appears in prose in `SPEC-API-TASKS.md`.
- Field names match the PRD's Data Model table exactly.

---

### 7. Fix 2 — Database spec doc
**Agent:** db-coder
**Model:** haiku — three localised, fully specified edits to one markdown file

- [ ] `docs/specs/SPECS-database.md`, ticket table column list (lines ~40–52): add `agentTaskId | integer | nullable, FK → agent_task(id) ON DELETE SET NULL`.
- [ ] Line 53: `"No FKs. Indexes: …"` is now wrong. State the FK to `agent_task(id)` and add `idx_ticket_agentTaskId (agentTaskId)` to the index list.
- [ ] Global index table (lines ~281–283): add a row for `idx_ticket_agentTaskId | ticket | agentTaskId`.

**Acceptance criteria**
- No occurrence of "No FKs." remains under the `ticket` table heading.
- The column and the index appear in both the per-table listing and the global index table.

---

### 8. Fix 3 — Seed title and corrective update
**Agent:** db-coder
**Model:** sonnet — the guarded corrective `UPDATE` needs care about which columns it must not touch

- [ ] `backend/src/seed/agentTaskSeed.ts`, row id 23 (line 308): title → `Chancen verbessern`.
- [ ] Leave `source`, `body`, `metadata`, `status`, `comment`, `pickedUpAt`, `resolvedAt`, `createdAt`, `updatedAt` byte-identical.
- [ ] Add a corrective `UPDATE` at the end of `seedAgentTasks()`, after the `client.batch(stmts, 'write')` call (line 330): set `title` on `id = 23` **only when** `title` still equals the old literal `Improve chances`.
- [ ] Source the new title from the `AGENT_TASK_SEED` row so the two can never drift. Match on the old literal.
- [ ] Update **only** `title`. Do not touch `updatedAt`, `status`, `comment`, `pickedUpAt`, or `resolvedAt`.
- [ ] `backend/src/test/agentTaskSeed.spec.ts` line 201: assert `Chancen verbessern`.
- [ ] Same file: update the header comment block (lines 14–19) and the `AGENT_TASK_SEED source data` suite comment (lines 184–192) — the corrective `UPDATE` now converges the live DB, so explain why the constant assertion still stays the deterministic check.

**Acceptance criteria**
- A row with id 23 carrying the old English title becomes `Chancen verbessern` after one `seedAgentTasks()` call.
- A second call reports zero rows affected and does not throw.
- A row renamed by a human to any third value survives untouched.
- A `DONE` row with id 23 keeps its `status`, `resolvedAt`, and `comment` after the correction.
- No documentation anywhere tells the user to run `--reset-db` as the fix.

---

### 9. Test Implementation — backend Playwright
**Agent:** be-test-coder
**Model:** sonnet — new specs plus a migration regression guard with real DB-state constraints

- [ ] New file `backend/src/test/ticketAgentTaskIdMigration.spec.ts`, beside `ticketFullyReadyMigration.spec.ts`. Use `test.describe.serial`, mirroring that file's structure and comment style.
  - [ ] `ensureTicketAgentTaskIdColumn()` is safely callable twice; the column count stays 1.
  - [ ] `alterTicketAddAgentTaskIdColumn()` fired directly against a table that already has the column swallows `duplicate column` and resolves.
  - [ ] A genuinely different SQL error still throws (rename the table away, restore in `finally`, same pattern as test 3 in the existing file).
  - [ ] **Ordering regression guard.** Drop `idx_ticket_agentTaskId` first, then `ALTER TABLE ticket DROP COLUMN agentTaskId` — SQLite refuses to drop a column that an index still references. Then call the full `runMigrations()`: it must not throw, and afterwards both the column and the index must exist. This is the test that catches the index-before-ALTER bug.
  - [ ] Fresh test DB: the column arrives from `CREATE TABLE`, is nullable, and every seeded ticket reads `null`.
- [ ] Extend `backend/src/test/tickets.spec.ts`: create without the field → `null`; create with `agentTaskId: null` → `201` and `null`; create with a valid id → `201`, field set, `status=DEFINITION`, `owner=HUMAN`; unknown id → `400` **and** the ticket row count is unchanged; non-integer → `400`.
- [ ] Same file: the field reads back through `GET /:id`, the page list, `/board`, and `/next`; `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `/comments` all return it unchanged. `/wont-do` and `/hand-to-ai` are explicitly asserted — they are not special cases.
- [ ] Extend `backend/src/test/agentTasks.spec.ts`: agent-task reads report `ticketId`; `null` when there is none; two tickets pointing at one task → the newest wins (`createdAt DESC`, then id DESC); `POST /api/tickets/reset` with a linked ticket present → `200`, and the task then reports `null`.
- [ ] **Isolation.** `resetDatabase()` in `helpers.ts` clears `agent_task` but **not** `ticket` / `ticket_comment`, and it deletes with `PRAGMA foreign_keys = OFF`, so `ON DELETE SET NULL` never fires there. Pick one approach — call `POST /api/tickets/reset` before asserting, or delete the rows the spec created explicitly — and state it in the spec file's header comment.
- [ ] **Ordering hazard, must be handled.** Playwright runs spec files alphabetically at `workers: 1`. `agentTasks.spec.ts` runs **before** `ticketFullyReadyMigration.spec.ts`, whose test 4 asserts `SELECT COUNT(*) FROM ticket` equals `TICKET_SEED_COUNT`. Any ticket left behind by the new agent-task link tests breaks that assertion. Add an `afterAll` to every spec file that runs before it and creates tickets, restoring the ticket table to exactly the seeded rows.
- [ ] Add Fix 3 cases to `backend/src/test/agentTaskSeed.spec.ts`: insert id 23 with the old English title → seed → German; seed again → still German, no error; set a custom title → seed → custom title survives; a `DONE` row keeps `status`, `resolvedAt`, `comment`.

**Acceptance criteria**
- `cd backend && npm test` is green, including the pre-existing `ticketFullyReadyMigration` test 4 row-count assertion.
- The ordering regression guard fails if the `CREATE INDEX` is moved into the shared index batch — verify by temporarily moving it.
- Each new spec file or suite carries a header comment naming its isolation approach.

---

### 10. Test Implementation — frontend Jasmine
**Agent:** fe-test-coder
**Model:** sonnet — standard component specs against existing TestBed fixtures

- [ ] `ticket-board.component.spec.ts`: each of the five columns renders its ticket's number as text — at least one card per column.
- [ ] Same file: the number sits **inside** the `.ticket-body-click` element, not as a sibling.
- [ ] Same file: the number element carries no `tabindex` and is neither a `<button>` nor an `<a>`.
- [ ] Same file: title, type badge, owner badge, and comment count still render. Existing drag-and-drop, rollback, and recent-filter tests stay green and untouched.
- [ ] `ticket-detail.component.spec.ts`: with `agentTaskId` set → one link renders pointing at `/admin/agent-tasks/<id>`; with `null` → nothing renders; assert the router-link directive or the resolved `href` under `provideRouter`, not a hand-written `href` binding.
- [ ] `agent-task-detail.component.spec.ts`: the same three cases for `ticketId` → `/admin/tickets/<id>`.

**Acceptance criteria**
- `cd frontend && npx ng test --watch=false` is green.
- Board number assertions cover all five columns.
- Both cross-link specs assert render, hide, and routing target.

---

### 11. Verification — backend suite
**Agent:** be-test-runner
**Model:** haiku — run a suite and report pass/fail

- [ ] Run `cd backend && npm test`.
- [ ] Report the failing spec name, file, and message on any failure. Do not edit code.

**Acceptance criteria**
- Full Playwright suite green, zero skipped-by-accident specs.

---

### 12. Verification — frontend suite
**Agent:** fe-test-runner
**Model:** haiku — run a suite and report pass/fail

- [ ] Run `cd frontend && npx ng test --watch=false`.
- [ ] Report the failing spec name, file, and message on any failure. Do not edit code.

**Acceptance criteria**
- Full Karma suite green.

---

### 13. Manual acceptance and PRD sign-off
**Agent:** ui-reviewer
**Model:** sonnet — visual and a11y judgement that no unit test covers

- [ ] `/admin/tickets`: read a number off a card in every one of the five columns.
- [ ] Resize to 600 px: board is single-column, no horizontal scroll, title still clamps to two lines, badges and comment count stay inside the card.
- [ ] At 600 px, tab to a card: focus lands on the card region once, not twice. Enter opens the detail page. **Space also opens the detail page, and does not scroll the page** — `ticket-board.component.ts` wires both `(keydown.enter)` and `(keydown.space)` with `preventDefault()` on the clickable region, and REQ-102 requires both keys keep working.
- [ ] Check the number's colour against the white card with a contrast checker — 4.5:1 or better.
- [ ] **Produce a linked ticket first, then walk it.** Run `/project:write-ticket` in a **task-backed mode** — queue, task-ID, or task-URL, **not** free-text — against an open feedback item, so a ticket with a real `agentTaskId` exists. The 12 seeded tickets never get one (REQ-207), so without this step there is nothing to walk. Then walk ticket → feedback → ticket in the browser. Confirm both links look the same.
- [ ] Run `/project:write-ticket` in free-text mode. Confirm the ticket is created and `agentTaskId` is `null`.
- [ ] **Negative path, visual.** Open a ticket with no cross-link — e.g. one of the seeded tickets 1–12 — and an agent-task with no ticket. Confirm the Info block shows **no extra row and no dash placeholder** (REQ-206). The Jasmine specs in group 10 assert this too; this pass catches what they cannot, such as a stray empty `dt`/`dd` gap.
- [ ] Start the backend against an **already-seeded** local database (no `--reset-db`). Confirm it starts without error, `/admin/agent-tasks/23` reads "Chancen verbessern", and the new column and index exist.
- [ ] Tick every checkbox in the PRD's `## Success Criteria`.
- [ ] Per `AGENTS.md`: add an `## Implementierung` section to `docs/prds/PRD-TICKET-UI-LINK-FIXES.md` linking the commits and PRs, and use the `PRD: docs/prds/PRD-TICKET-UI-LINK-FIXES.md` commit footer. In the same pass, update that PRD's `## Open Questions` to record the resolved card placement from group 1.

**Acceptance criteria**
- Every PRD Success Criteria checkbox is ticked with evidence.
- The cross-link walkthrough uses a ticket created in a task-backed mode, not a seeded one.
- Both keyboard keys — Enter and Space — open the detail page from a focused card.
- The no-reference case renders nothing on both detail pages.
- Any failed manual check is reported as a defect, not waived.

---

## Tests

### Unit Tests (frontend, Jasmine/Karma)
- [ ] Board card renders `#<id>` in all five columns.
- [ ] The number is a descendant of `.ticket-body-click`.
- [ ] The number element has no `tabindex`, is not a button, is not an anchor.
- [ ] Title, type badge, owner badge, comment count still render on the card.
- [ ] Ticket detail: `agentTaskId` set → link to `/admin/agent-tasks/<id>` renders.
- [ ] Ticket detail: `agentTaskId` null → no link, no empty row.
- [ ] Agent-task detail: `ticketId` set → link to `/admin/tickets/<id>` renders; null → nothing.
- [ ] Both links resolve through the router, not a raw `href`.

### Integration Tests (backend, Playwright)
- [ ] Create without `agentTaskId` → `201`, field `null`.
- [ ] Create with `agentTaskId: null` → `201`, field `null`. Same as omitted.
- [ ] Create with a valid agent-task id → `201`, field set, `status=DEFINITION`, `owner=HUMAN`.
- [ ] Field reads back through `GET /:id`, the page list, `/board`, `/next`.
- [ ] `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`, `/comments` all return the field, unchanged.
- [ ] Agent-task reads return `ticketId`, and `null` when no ticket points at the task.
- [ ] `POST /api/tickets/reset` with a linked ticket → `200`, and the agent task then reports `null`.
- [ ] `runMigrations()` twice in a row does not throw.
- [ ] Seeder: old English title on id 23 → German after one seed run; second run is a no-op.

### Edge Cases
- [ ] Create with an unknown agent-task id → `400`, `fieldErrors.agentTaskId` present, ticket row count unchanged.
- [ ] Create with a non-integer (string, float) → `400`.
- [ ] Two tickets on one agent task → the task reports the newest (`createdAt DESC`, then id DESC).
- [ ] **Ordering regression guard:** ticket table without the column → full `runMigrations()` does not throw, and both column and `idx_ticket_agentTaskId` exist afterwards.
- [ ] Direct `alterTicketAddAgentTaskIdColumn()` against a table that already has the column → swallowed, resolves.
- [ ] A genuinely different SQL error from the ALTER → still throws.
- [ ] Fresh test DB: column nullable, every seeded ticket reads `null`.
- [ ] Seeder: id 23 renamed by a human to a third value → survives the corrective update.
- [ ] Seeder: a `DONE` id-23 row keeps `status`, `resolvedAt`, `comment` after correction.
- [ ] After the new link tests, the `ticket` table holds exactly `TICKET_SEED_COUNT` rows before `ticketFullyReadyMigration.spec.ts` runs.

## Open Questions

1. **Carried from PRD OQ1 — card placement.** Muted prefix on the title line, own small line above the title, or a badge beside the type/owner badges? This plan defaults group 1 to a muted line above the title. A different answer changes only the markup position, not the a11y or contrast rules.
2. **Carried from PRD OQ2 — cross-link treatment.** Inline text link, outline button, or a `dl` row? This plan defaults group 4 to a `dl` row holding an inline text link, used identically on both pages. Confirm before group 4 merges.
3. **Carried from PRD OQ3 — extra create validation.** Should `POST /api/tickets` reject an id already linked to another ticket, or one in a terminal status? This plan ships existence-only, per REQ-203. A product answer would add one check in group 3 and one case in group 9.
4. **New — should `resetDatabase()` clear `ticket` and `ticket_comment`?** Group 9 works around the leak per spec file. Fixing the helper would remove the whole class of order-dependency, but touches every backend suite. Out of scope here unless someone decides otherwise.

## Relevant files

- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/docs/prds/PRD-TICKET-UI-LINK-FIXES.md`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/config/migrate.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/db/schema/schema.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/services/ticketService.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/routes/tickets.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/services/agentTaskService.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/seed/agentTaskSeed.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/test/helpers.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/test/ticketFullyReadyMigration.spec.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/backend/src/test/agentTaskSeed.spec.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/frontend/src/app/features/admin/tickets/ticket-board.component.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/frontend/src/app/features/admin/tickets/ticket-detail.component.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/frontend/src/app/features/admin/agent-tasks/agent-task-detail.component.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/frontend/src/app/core/models/ticket.model.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/frontend/src/app/core/models/agent-task.model.ts`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/.claude/skills/write-ticket/SKILL.md`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/docs/specs/SPEC-API-TICKETS.md`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/docs/specs/SPEC-API-TASKS.md`
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/docs/specs/SPECS-database.md`
