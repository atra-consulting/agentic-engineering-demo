# Implementation Plan: SMALL-ADMIN-FIXES

## Summary
### Business Summary
Three small fixes to the admin tools. The Kanban ticket board will show each ticket's number on its card, not just inside the ticket. The `/project:write-ticket` automation will link a feedback item and the ticket it creates in both directions, not just one. Agent-task #23 will show its German title, "Chancen verbessern," instead of an English placeholder — and this fix will correct any environment, including production, on its next restart.

### Technical Summary
Frontend: prefix `ticket.title` with `#{{ ticket.id }}` in all 5 `@for` loops of `ticket-board.component.ts`, add a `.ticket-number` SCSS rule (`0.75rem`, `#495057` — a tone already used elsewhere in the file), add a Jasmine assertion that checks for the `#<id>` prefix specifically. Skill: `.claude/skills/write-ticket/SKILL.md` Schritt 4's `/done` comment payload gets the ticket URL (`<APP_FRONTEND_URL>/admin/tickets/<newId>`) alongside the existing ticket-number text, with matching prose; bump `version` and `last-modified` frontmatter. Seed data: `backend/src/seed/agentTaskSeed.ts` id 23's title literal changes to `'Chancen verbessern'`, plus a standing-overwrite `UPDATE agent_task SET title=... WHERE id=23` inside `seedAgentTasks()` — the same pattern already used for the Standard-Szenario row in `szenarioSeed.ts` — so any DB, including Turso production, self-corrects on every startup without `--reset-db`. This also requires updating one existing Playwright assertion in `backend/src/test/agentTaskSeed.spec.ts` that currently expects the old English title.

## Test Command
`cd backend && npx playwright test` (backend)
`cd frontend && npm run test:ci` (frontend)

## Tasks

**Parallelism:** Tasks 1, 3, and 4 run in parallel — different files, different agents, no shared state. Task 2 waits for Task 1 — its test asserts on markup Task 1 adds. Task 5 waits for Task 4 — its test asserts on the title literal and the standing-overwrite Task 4 adds. Task 6 (Verification) waits for all of the above.

### 1. Show ticket number on Kanban ticket cards
**Agent:** fe-coder
**Model:** sonnet — small template change, existing `#<id>` convention already in the same file

- [ ] In `frontend/src/app/features/admin/tickets/ticket-board.component.ts`, find all 5 occurrences of `<div class="ticket-title">{{ ticket.title }}</div>` (DEFINITION line 222, TODO ~line 264, IN_PROGRESS ~line 306, ON_HOLD ~line 348, DONE ~line 390).
- [ ] Change each to show the ticket number, styled distinct from the title, e.g.:
  ```html
  <div class="ticket-title"><span class="ticket-number">#{{ ticket.id }}</span> {{ ticket.title }}</div>
  ```
- [ ] Apply the identical change to all 5 columns — no column left with the old markup.
- [ ] Add a `.ticket-number` SCSS rule directly after the existing `.ticket-title` block (line 646–656):
  ```scss
  .ticket-number {
    font-size: 0.75rem;
    font-weight: 400;
    color: #495057;
    margin-right: 0.25rem;
  }
  ```
  `0.75rem` / `400` weight is deliberately smaller and lighter than `.ticket-title`'s `0.88rem` / `600`, so the two are unmistakably distinct at a glance. `#495057` is not a new color — it's already used in this same file (line 554) for a muted label on a light background, so it carries an established, sufficient-contrast precedent (roughly 5:1 against white/light card backgrounds, comfortably passing WCAG AA for normal text — better than `#6c757d`'s ~4.5:1 borderline). `margin-right: 0.25rem` visually separates the number from the title instead of leaving them touching.
- [ ] This is an inline prefix on the existing title line, not a new badge — kept deliberately simple for a small fix. The `.ticket-badges` row (line 658) stays reserved for type/owner badges, unchanged.
- [ ] Do not change `ticket-detail.component.ts` — its `#{{ ticket.id }}` usage (lines 34, 243) is the existing pattern being followed, not a file to modify.

**Acceptance criteria:**
- Every ticket card in every column shows `#<id>` before the title text, separated by visible spacing.
- The number renders at `0.75rem` / weight `400` / color `#495057` — visibly smaller and lighter than `.ticket-title`.
- `ng build` succeeds with no template errors.

---

### 2. Test Implementation — ticket number on cards
**Agent:** fe-test-coder
**Model:** sonnet — one Jasmine assertion, existing spec conventions in the same file

- [ ] In `frontend/src/app/features/admin/tickets/ticket-board.component.spec.ts`, add a test that asserts a ticket number renders on a card. Use the existing `makeTicket(id, overrides)` helper and the existing substring-check style (`.toContain(...)`), matching tests like "renders a DEFINITION ticket title in the Definition column" (line 184).
- [ ] Assert on `#list-DEFINITION` (the same element the existing test at line 184–187 queries) that its `textContent` contains `'#0'` — the literal `#` prefix plus the id from `makeTicket(0, { status: 'DEFINITION' })` (line 37). Do **not** reuse a bare title-substring check like `.toContain('Ticket 0')` for this assertion — that string is already present in the unmodified template and would pass even without Task 1's fix, so the new test would never fail against the old markup.
- [ ] Do not weaken or remove existing title-substring assertions — they still pass unchanged since the title text is only prefixed, not replaced.

**Acceptance criteria:**
- New test fails against the old template (no `#<id>` prefix) and passes only after Task 1's fix lands.
- No existing test in `ticket-board.component.spec.ts` needs modification.

---

### 3. Two-way link between agent-task feedback and the ticket it creates
**Agent:** skill-coder
**Model:** sonnet — spelled-out wording/payload change to one skill step, no new logic

- [ ] In `.claude/skills/write-ticket/SKILL.md`, Schritt 4 ("Feedback-Task schließen"), change the `/done` comment payload (line 219):
  - From: `"comment": "Triagiert in Ticket #<newId> (Definition, Mensch). <Zusatz je nach Zweig>"`
  - To: include the ticket URL using the same `APP_FRONTEND_URL` base and the same URL shape Schritt 5 already prints (`<APP_FRONTEND_URL>/admin/tickets/<newId>`), e.g.: `"comment": "Triagiert in Ticket #<newId> (Definition, Mensch): <APP_FRONTEND_URL>/admin/tickets/<newId>. <Zusatz je nach Zweig>"`
- [ ] Update Schritt 4's prose paragraph above the curl block (line 213: "Eine übernommene Agent-Task soll immer geschlossen werden ... In BEIDEN Zweigen (3a und 3b) die ursprüngliche Feedback-Aufgabe abschließen."). Today this paragraph says nothing about what the comment contains — add a sentence naming that the comment now carries both the ticket number **and** its URL. Do not leave the reader to infer the new content only from the curl `-d` payload.
- [ ] Do not change: the `<Zusatz je nach Zweig>` logic (lines 223–226), the condition for when Schritt 4 runs (still skipped in Freitext mode, still runs in both 3a/3b), the error-handling branch (lines 228–233), or Schritt 3's `Quelle:` line (line 157) — that direction of the link already works.
- [ ] Bump the frontmatter `version:` field (line 5) from `1.5.0` to `1.5.1` (patch bump — this is a payload/prose fix, not a new capability).
- [ ] Update `last-modified:` (line 6) from `2026-08-02` to today's date, `2026-08-18`, in `YYYY-MM-DD` format (matches the existing convention on that same line).

**Acceptance criteria:**
- Schritt 4's example curl payload contains both the ticket number (`#<newId>`) and the full URL (`<APP_FRONTEND_URL>/admin/tickets/<newId>`).
- Schritt 4's prose paragraph above the curl block now names the URL as part of the comment content — not just the payload example itself.
- Schritt 3's `Quelle:` line and Schritt 5's final print block are unchanged.
- Frontmatter shows `version: 1.5.1` and `last-modified: 2026-08-18`.
- No other Schritt (0, 1, 2, 3, 3a, 3b, 5) is touched.

---

### 4. Fix agent-task #23 title to German — standing overwrite, self-heals every DB
**Agent:** db-coder
**Model:** sonnet — small standing-overwrite seed fix, following an existing precedent in the same codebase

- [ ] In `backend/src/seed/agentTaskSeed.ts`, find the entry with `id: 23` (source `EMAIL`, line 306–317).
- [ ] Change `title: 'Improve chances'` (line 308) to `title: 'Chancen verbessern'` in the `AGENT_TASK_SEED` array — exact string, nothing else on that row changes (`body`, `metadata`, `createdAt`, etc. stay as-is). This alone is enough for a fresh DB (no prior row 23) to seed the correct title straight from `INSERT OR IGNORE`.
- [ ] In the same file, inside `seedAgentTasks()` (after the `await client.batch(stmts, 'write');` call at line 330, before the closing `console.log`), add a standing-overwrite `UPDATE` scoped only to id=23's `title` column. Follow the exact precedent in `backend/src/seed/szenarioSeed.ts` (`seedSzenario()`, lines 40–57): a comment marking it "permanent, standing overwrite — NOT a one-shot migration," and an unconditional statement:
  ```ts
  await client.execute({
    sql: `UPDATE agent_task SET title=@title WHERE id=23`,
    args: { title: 'Chancen verbessern' },
  });
  ```
  This runs on every startup (every call to `runMigrations()`), so it self-heals any DB that already seeded row 23 with the old English title — including Turso production — with no manual `--reset-db` step required, since `INSERT OR IGNORE` alone never touches an existing row.
- [ ] Scope the `UPDATE` to id=23's `title` field only. Do not build a general-purpose update mechanism for other `agent_task` rows — this is a targeted, one-row, one-column fix, not a new seeding pattern.
- [ ] Update the `console.log` message at the end of `seedAgentTasks()` (line 332) to mention the correction, mirroring `seedSzenario()`'s own log message style (`'=== Seeder: szenario ensured (1 row, INSERT OR IGNORE + defaults overwrite) ==='`) — e.g. `` `=== Seeder: agent_task ensured (${AGENT_TASK_SEED.length} rows, INSERT OR IGNORE + #23 title correction) ===` ``.
- [ ] Update the comment above `await seedAgentTasks();` in `backend/src/config/migrate.ts` (lines 284–287) — it currently states "Existing rows ... are never overwritten." Add one clause noting that task #23's title is the sole exception, corrected on every startup, matching the exception style already used in `seedSzenario()`'s own comment.
- [ ] Do not touch `ensureTicketFullyReadyColumn()` or `ensureSzenarioAgileKiColumn()` in `migrate.ts` — those are schema-column migrations, unrelated to this data fix.

**Acceptance criteria:**
- `AGENT_TASK_SEED[22].title === 'Chancen verbessern'`.
- `seedAgentTasks()` contains an unconditional `UPDATE agent_task SET title=... WHERE id=23` that runs on every call, with a comment explaining it is a standing overwrite, not a one-shot migration.
- A **fresh** DB (`--reset-db`, or any first-ever startup) shows the German title at `/admin/agent-tasks/23` — from the `INSERT` alone.
- An **existing** DB that already seeded row 23 with the old English title also shows the German title after a plain server restart (no source-code touch beyond this task, no `--reset-db`). `--reset-db` still works too, since it re-seeds from scratch.
- No other `agent_task` row's title is touched by the new `UPDATE`.

---

### 5. Test Implementation — agent-task #23 title standing-overwrite
**Agent:** be-test-coder
**Model:** sonnet — one assertion update plus one new test case, following an established pattern already in the same file

- [ ] In `backend/src/test/agentTaskSeed.spec.ts`, update the existing assertion in the `AGENT_TASK_SEED source data — row id 23` suite (line 201): change `expect(row23.title).toBe('Improve chances');` to `expect(row23.title).toBe('Chancen verbessern');`. Without this change, the suite fails as soon as Task 4's title literal changes.
- [ ] Add one new test case to the `seedAgentTasks — idempotent seeder` serial suite (`test.describe.serial`, near the existing "preserves modified rows" case at line 114), verifying Task 4's standing-overwrite: mutate id=23's `title` directly in the DB to some other string, call `seedAgentTasks()` again, and assert the title is back to `'Chancen verbessern'`. This is the mirror image of the existing "preserves modified rows" test (id=1's `status`, line 114–144), which proves normal rows are **not** reset — the new test proves id=23's `title` specifically **is** reset on every seed call.
- [ ] Update the file's top doc comment (lines 13–19) — it currently says a live-DB assertion on row 23's title "would be flaky" because `INSERT OR IGNORE` never updates existing rows. That reasoning still holds for `body`/`metadata`, but no longer for `title` once Task 4's standing-overwrite lands. Add one sentence noting the exception and pointing to the new test.
- [ ] Do not touch the other 3 idempotency test cases (rows 1, all-sources, and the non-empty-firma case) or `szenario.spec.ts` — out of scope.

**Acceptance criteria:**
- `cd backend && npx playwright test src/test/agentTaskSeed.spec.ts` passes — the `AGENT_TASK_SEED source data` suite asserts the new German title.
- The new standing-overwrite test proves: mutate id=23's title in the DB → call `seedAgentTasks()` → title reverts to `'Chancen verbessern'`.
- The existing "preserves modified rows" test (id=1, `status`) still passes unchanged — proves the standing-overwrite is scoped to id=23's `title` only, not a general behavior.

---

### 6. Verification
**Agent:** direct
**Model:** n/a

- [ ] Run `cd frontend && npm run test:ci` — confirm the new ticket-number test (Task 2) passes and no existing test broke.
- [ ] Run `cd frontend && npx ng build` — confirm no template errors from Task 1's markup change.
- [ ] Run `cd backend && npx playwright test` — confirm the updated and new `agentTaskSeed.spec.ts` assertions (Task 5) pass, and no other backend test broke.
- [ ] Open `http://localhost:7200/admin/tickets` — confirm every ticket card in every column (Definition, Bereit, In Arbeit, Wartet, Erledigt) shows `#<id>` next to its title, visibly smaller/lighter than the title text.
- [ ] Without running `--reset-db`, restart the backend (or let `tsx --watch` reload it after saving `agentTaskSeed.ts`) and open `http://localhost:7200/admin/agent-tasks/23` — confirm the page shows the German title "Chancen verbessern" on the **existing** dev DB. This confirms the standing-overwrite self-heals an already-seeded row, matching Task 4's acceptance criteria — not merely a fresh DB from `--reset-db`.
- [ ] Read through `.claude/skills/write-ticket/SKILL.md` Schritt 4 — manually trace: does the `/done` comment payload now build a real `<APP_FRONTEND_URL>/admin/tickets/<newId>` URL alongside the ticket number? Does the prose paragraph above the curl block (line 213) now say the comment includes the URL, not just the number? Does Schritt 3's `Quelle:` line still read as before? Is `version: 1.5.1` / `last-modified: 2026-08-18` present in frontmatter?

**Acceptance criteria:**
- All three fixes visible/traceable exactly as specified above.
- Both test suites green.
- Agent-task #23's title is corrected on the existing dev DB with no `--reset-db` needed.
- No unrelated file changed.

## Tests
### Frontend (Jasmine/Karma)
- [ ] `ticket-board.component.spec.ts` — new test asserts `#<id>` renders on a ticket card, failing against the old markup (Task 2).
- [ ] `ticket-board.component.spec.ts` — all pre-existing tests still pass unchanged (title-substring checks tolerate the `#<id>` prefix).

### Backend (Playwright)
- [ ] `agentTaskSeed.spec.ts` — updated assertion (Task 5) confirms `AGENT_TASK_SEED[22].title === 'Chancen verbessern'`.
- [ ] `agentTaskSeed.spec.ts` — new test (Task 5) confirms the standing-overwrite `UPDATE` self-heals an already-seeded id=23 row back to the German title, without affecting other rows (e.g. id=1's mutated `status`).
- [ ] Full suite (`cd backend && npx playwright test`) run in Verification (Task 6) to confirm no other regression from Tasks 4/5.

### Not covered by automated tests (explicitly out of scope)
- [ ] `.claude/skills/write-ticket/SKILL.md` (Task 3) — no test framework in this repo covers `.claude/skills/**`. Correctness confirmed via manual trace in Verification (Task 6).

## Open Questions
- None. All four reviewer findings were investigated directly against the codebase — `szenarioSeed.ts`, `migrate.ts`, `agentTaskSeed.ts`, `agentTaskSeed.spec.ts`, `ticket-board.component.ts/.spec.ts`, and `SKILL.md` — before writing this plan.

## Technical Notes
- `backend/src/test/agentTaskSeed.spec.ts` was not flagged by any reviewer but would have broken silently under the original Task 4 wording: it asserts `row23.title === 'Improve chances'` directly against the exported `AGENT_TASK_SEED` constant (its own doc comment explains why — a live-DB assertion was, until now, considered flaky given `INSERT OR IGNORE`'s never-overwrite behavior). Task 5 was added specifically to keep the backend Playwright suite green after Task 4 and to give the new standing-overwrite behavior its own automated regression test, rather than relying solely on a manual UI check.
