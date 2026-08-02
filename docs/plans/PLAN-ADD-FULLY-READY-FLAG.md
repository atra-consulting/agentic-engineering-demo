# Implementation Plan: ADD-FULLY-READY-FLAG

## Test Command
`cd backend && npm test`

## Tasks

### 1. Ticket Schema — Add `fullyReady` Column (REQ-001)
**Agent:** db-coder
**Model:** sonnet — well-specified, single-column addition mirroring an established pattern in the same file; no cross-cutting design, no unresolved cause, no security surface.

- [ ] In `backend/src/db/schema/schema.ts`, add `fullyReady: integer('fullyReady', { mode: 'boolean' }).notNull().default(false),` to the `ticket` table definition. Place it after `solution` and before `pickedUpAt`, matching the DDL column order added in Task 2. This is the schema's first boolean-mode column — no other table has one to copy from, so use Drizzle's `{ mode: 'boolean' }` integer idiom explicitly.
- [ ] In `backend/src/config/migrate.ts`, add `fullyReady   INTEGER NOT NULL DEFAULT 0,` to the `CREATE TABLE IF NOT EXISTS ticket (...)` DDL block (in `runMigrations()`), in the same position (after `solution`, before `pickedUpAt`), so a fresh database (`./start.sh --reset-db`) creates the column with every row reading back `0`.
- [ ] Do **not** add a `CHECK` constraint on `fullyReady` and do not couple it to the existing `status` `CHECK (status IN (...))` constraint. REQ-001 requires the flag to stay independent of `status`, `owner`, `type`, and `solution`.
- [ ] Confirm `backend/src/seed/ticketSeed.ts`'s insert statement needs no change — it uses an explicit column list that omits `fullyReady`, so seeded rows fall through to the new column's `NOT NULL DEFAULT 0`/`false` automatically. Do not add `fullyReady` to the seed rows or the insert statement (per the PRD's "Out of Scope": seeded tickets keep the default `false`).

### 2. Guarded Migration for `fullyReady` on Existing Databases (REQ-002)
**Agent:** db-coder
**Model:** sonnet — precedented, single-column guarded-ALTER, explicitly modeled on `ensureSzenarioAgileKiColumn()`; no architectural or security decision to make.

- [ ] In `backend/src/config/migrate.ts`, add a new function `ensureTicketFullyReadyColumn()`, placed alongside `ensureSzenarioAgileKiColumn()`, following its exact shape: a standalone `await client.execute('PRAGMA table_info(ticket)')`, then `info.rows.some((row) => row.name === 'fullyReady')`. If the column is already present, return immediately — `CREATE TABLE IF NOT EXISTS` never touches an already-existing `ticket` table, so every pre-existing local and Turso database needs this explicit `ALTER TABLE` path.
- [ ] Split the ALTER step into its own exported function, `alterTicketAddFullyReadyColumn()`, containing only the try/catch/ALTER logic:
  ```ts
  export async function alterTicketAddFullyReadyColumn(): Promise<void> {
    try {
      await client.execute(
        'ALTER TABLE ticket ADD COLUMN fullyReady INTEGER NOT NULL DEFAULT 0'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('duplicate column')) {
        return;
      }
      throw err;
    }
  }
  ```
  `ensureTicketFullyReadyColumn()` becomes: run the `table_info` check, early-return if the column exists, otherwise `await alterTicketAddFullyReadyColumn()`. This decomposition is the one deliberate deviation from copying `ensureSzenarioAgileKiColumn()` verbatim: it exists so the migration test (Task 3) can fire the `ALTER` directly against a table that already has the column, without relying on real concurrency timing to hit the catch block.
- [ ] Export both `ensureTicketFullyReadyColumn` and `alterTicketAddFullyReadyColumn` (unlike `ensureSzenarioAgileKiColumn()`, which is module-private) — they must be importable from `backend/src/test/*.spec.ts`.
- [ ] Swallow only `err.message.includes('duplicate column')` — the same narrow check as `ensureSzenarioAgileKiColumn()`: concurrent Vercel/Turso cold-starts can both pass the `table_info` check before either `ALTER` commits, so the loser fails with "duplicate column name" and must not crash startup. Re-throw every other error unchanged.
- [ ] Wire the helper into `runMigrations()`: call `await ensureTicketFullyReadyColumn();` immediately before `await seedTickets();` — mirrors the existing precedent where `ensureSzenarioAgileKiColumn()` runs immediately before `seedSzenario()`.
- [ ] Leave the existing comment on the `ticket.status` `CHECK` constraint as-is — unrelated to `fullyReady`, which gets its own guarded path instead of requiring a reset.

### 3. Migration Tests for `fullyReady` (REQ-002 Test Strategy)
**Agent:** db-coder
**Model:** sonnet — precedented test pattern (mirrors `agentTaskSeed.spec.ts`'s direct-DB-access style); no unresolved cause or architectural decision.

Depends on Task 1 and Task 2 — this test file imports `ensureTicketFullyReadyColumn`/`alterTicketAddFullyReadyColumn`, which don't exist until Task 2 lands.

- [ ] Create `backend/src/test/ticketFullyReadyMigration.spec.ts`, following the direct-DB-access pattern already used in `backend/src/test/agentTaskSeed.spec.ts`: import `client` from `../config/db.js` and `ensureTicketFullyReadyColumn`, `alterTicketAddFullyReadyColumn` from `../config/migrate.js`. Use `test.describe.serial` since these tests mutate the live `ticket` table's schema, consistent with this suite's `workers: 1` config.
- [ ] Test — **"the real repeat test"**: call `await ensureTicketFullyReadyColumn()` twice in a row, directly, against the already-migrated DB. Assert the second call resolves (does not throw), and `PRAGMA table_info(ticket)` still reports exactly one `fullyReady` column afterward. This proves `ensureTicketFullyReadyColumn()` is safely callable repeatedly once the column already exists — it does **not** prove anything about the `ALTER` path itself: in this test environment `fullyReady` always arrives via `CREATE TABLE` on the fresh Playwright test DB (wiped every run), so the `table_info` guard finds the column already present on **both** calls, and neither call ever reaches the `ALTER`/catch branch. Comment this explicitly, and note the "duplicate-column ALTER is swallowed" test below is the one that actually exercises the `ALTER`/catch branch, by calling `alterTicketAddFullyReadyColumn()` directly and bypassing the guard.
- [ ] Test — **"duplicate-column ALTER is swallowed"**: call `alterTicketAddFullyReadyColumn()` directly against the live DB (column already present) — bypassing the `table_info` guard so the `ALTER` actually fires against a table that already has the column. Assert it resolves without throwing.
- [ ] Test — **"a different error still throws"**: prove the catch is narrow, by exercising the real, exported `alterTicketAddFullyReadyColumn()` itself against a genuinely different SQL error — not a hand-copied try/catch shape that only tests a condition mirrored by hand (if the real function's catch were later widened to swallow everything, a copied-shape test would never notice). Concrete approach: temporarily rename the live `ticket` table away (`ALTER TABLE ticket RENAME TO ticket_bak`), call the real `alterTicketAddFullyReadyColumn()` (its hardcoded `ALTER TABLE ticket ADD COLUMN...` now fails because `ticket` doesn't exist), assert it throws with a message that does **not** contain `duplicate column`, then restore the table name (`ALTER TABLE ticket_bak RENAME TO ticket`) in a `finally` block. This is safe specifically because this test file already runs `test.describe.serial` under `workers: 1` (confirmed in `backend/playwright.config.ts`) — no concurrent access to the table to worry about during the rename — and because the restore happens in `finally`, so it cannot leak even if the assertion fails. State both of these safety points explicitly in the test's comments, so a future reader knows the rename-and-restore is a deliberate, considered choice, not an oversight.
- [ ] Test — **"fresh DB gets the column from CREATE TABLE"**: assert via `PRAGMA table_info(ticket)` that `fullyReady` has `notnull = 1` and `dflt_value = '0'`. Also assert every currently-seeded ticket row reads `fullyReady = 0` at the raw-SQL level, independent of any service-layer boolean coercion (that's Task 4's responsibility, not this one).
- [ ] Add an `afterAll` that restores the table to its normal state for the rest of the suite (mirroring `agentTaskSeed.spec.ts`'s cleanup discipline).

### 4. Ticket Service — `fullyReady` field, mappers, create, addComment
**Agent:** be-coder
**Model:** sonnet — standard, well-specified service-layer change with a direct precedent (`commentCount: Number(row.commentCount)` for coercion, `handBackToAi`'s existing guard-then-batch shape for atomicity). No cross-cutting or architectural unknowns.

- [ ] In `backend/src/services/ticketService.ts`, add `fullyReady: boolean` to the `TicketDTO` and `TicketListItemDTO` interfaces.
- [ ] Add `fullyReady: number` to the internal `TicketRow` and `TicketListRow` types — raw SQLite `INTEGER` (0/1). No SQL string needs to change: `findNext`'s `RETURNING *`, `findById`'s `SELECT *`, and `findAll`/`getBoard`'s `t.*` already pull the new column once Task 1/2 lands it.
- [ ] In `toDTO()`, add `fullyReady: Boolean(row.fullyReady)` — mirrors the existing `Number(row.commentCount)` coercion precedent in `toListItemDTO()`.
- [ ] In `toListItemDTO()`, add the same `fullyReady: Boolean(row.fullyReady)` coercion.
- [ ] Confirm by inspection this covers all 9 response-returning endpoints (REQ-003): `GET /:id`, `GET /` (paginated list), `GET /board`, `GET /next`, `POST /:id/start`, `POST /:id/done`, `POST /:id/ask`, `PATCH /:id/status`, `PATCH /:id/owner`. All route through `toDTO`/`toListItemDTO`.
- [ ] `create(data)`: widen the parameter type to `{ type: TicketType; title: string; body: string; fullyReady?: boolean }`. Add `fullyReady` to the existing `INSERT INTO ticket (...)` statement, bound as `data.fullyReady ? 1 : 0` (defaults to `0`/false when omitted — REQ-004). Do **not** change any other column, value, or statement — `status` stays `'DEFINITION'`, `owner` stays `'HUMAN'`, no comment insert (REQ-005: zero routing side effects).
- [ ] `addComment(id, body, handBackToAi?, clearFullyReady?)`: add `clearFullyReady?: boolean` as a 4th parameter. Leave the existing guard exactly where it is: `findById` (404 if missing) then the `handBackToAi` guard (`ConflictError` if `status !== 'ON_HOLD' || owner !== 'HUMAN'`), still thrown *before* the `stmts` array is constructed. Only once that guard passes, push `UPDATE ticket SET fullyReady = 0, updatedAt = ? WHERE id = ?` onto `stmts` when `clearFullyReady` is true, batched via the existing `client.batch(stmts, 'write')` call.
- [ ] Do not reorder the guard relative to the batch construction — this is what makes REQ-006/REQ-013's atomicity hold: a guard failure throws (409) before `stmts` — and therefore `clearFullyReady` — is ever built.
- [ ] `clearFullyReady` acts independently of `handBackToAi` in every other respect — apply whenever `handBackToAi` is `true`, `false`, or omitted, as long as the (unrelated) guard didn't throw. Clearing an already-`false` flag is a naturally idempotent no-op UPDATE.
- [ ] REQ-007: verify by inspection that `start`, `handToAi`, `done`, `ask`, `wontDo`, `setStatus`, `setOwner` contain no reference to `fullyReady`. Leave all untouched.

### 5. Ticket Routes — zod schemas for `fullyReady` / `clearFullyReady`
**Agent:** be-coder
**Model:** sonnet — mirrors the `handBackToAi` optional-boolean pattern already in the same file; no new middleware, auth, or routing surface.

- [ ] In `backend/src/routes/tickets.ts`, add `fullyReady: z.boolean().optional()` to `CreateBodySchema`. No `.strict()` on this schema means an undeclared field is silently stripped (REQ-004) — declaring it is what makes it land and makes a non-boolean value 400 with a field error via the existing `validate()` helper.
- [ ] Add `clearFullyReady: z.boolean().optional()` to `CommentBodySchema`, alongside the existing `handBackToAi: z.boolean().optional()`.
- [ ] `POST /` (create) handler: pass the validated `dto` straight through to `ticketService.create(dto)` unchanged.
- [ ] `POST /:id/comments` handler: `ticketService.addComment(id, dto.body, dto.handBackToAi, dto.clearFullyReady)`.
- [ ] No auth/middleware change on either route — both keep `requireAgentTokenOrAdminSession`.
- [ ] REQ-007: confirm no other handler in the file reads `fullyReady`/`clearFullyReady` off `req.body`.
- [ ] After Task 4 and this task both land, run `cd backend && npx tsc --noEmit` to confirm the widened types check cleanly end to end.

### 6. Backend API Tests — `fullyReady` / `clearFullyReady`
**Agent:** be-test-coder
**Model:** sonnet — well-specified test-writing against a fully-detailed PRD Test Strategy section.

- [ ] Add to `tickets.spec.ts`'s create suite: create without `fullyReady` → 201, `fullyReady === false`, `typeof === 'boolean'`.
- [ ] Create with `fullyReady: true` → 201, `fullyReady === true`, `status === 'DEFINITION'`, `owner === 'HUMAN'`, `comments` empty — proves REQ-005 (zero routing side effects).
- [ ] Create with a non-boolean `fullyReady` (e.g. `"yes"`) → 400, `fieldErrors.fullyReady` present.
- [ ] Update the `Ticket`/`TicketListItem` interfaces at the top of `tickets.spec.ts` to add `fullyReady: boolean`, so new assertions type-check under `tsc --noEmit`.
- [ ] New suite `fullyReady round-trip — boolean typing across read endpoints`: `GET /:id`, `GET /board` (every ticket in every column), `GET /next`, and the paginated `GET /` list — `typeof t.fullyReady === 'boolean'` in every case, both a `true` and a `false` fixture, never `0`/`1`. `GET /next` and `GET /board`'s `TODO` column only ever surface `TODO`+`AI` tickets, so a `true` fixture isn't reachable there by simply creating one — spell out the setup explicitly: create a ticket with `fullyReady: true` (lands `DEFINITION`+`HUMAN` per REQ-005), then `PATCH /:id/status {"status":"TODO"}`, then `PATCH /:id/owner {"owner":"AI"}`, before claiming it via `GET /next` / asserting on it in `GET /board`'s `TODO` column. Do not settle for a false-only fixture on these two endpoints.
- [ ] New suite `POST /:id/comments — clearFullyReady flag`: comment with `clearFullyReady: true` on a `fullyReady: true` ticket → 200, `fullyReady === false`, comment stored with `author === 'HUMAN'`.
- [ ] Comment without `clearFullyReady` → unchanged.
- [ ] **Idempotent-clear:** `clearFullyReady: true` sent twice in a row → 200 both times, `fullyReady` stays `false`.
- [ ] Both `clearFullyReady: true` and `handBackToAi: true` on an `ON_HOLD`+`HUMAN` ticket → 200, hand-back succeeds (`status: 'TODO'`, `owner: 'AI'`), `fullyReady` clears too. This fixture must explicitly start with `fullyReady: true` — seeded `ON_HOLD`+`HUMAN` tickets default to `false`, which would make "clears too" trivially true even if the clear never ran. Assert `fullyReady === true` before the call and `fullyReady === false` after.
- [ ] **Atomicity:** both flags together on a ticket that is NOT `ON_HOLD`+`HUMAN` → 409, no comment stored, follow-up `GET /:id` shows `fullyReady === true`, unchanged from before the call. The bug this test exists to catch (`clearFullyReady` leaking through the batch despite the guard throwing) can only ever flip `true → false`, never the reverse — so the fixture must start with `fullyReady: true`, or a `false → false` "unchanged" result would pass even if the leak happens. Reuse the ticket already created earlier in this task via the "create with `fullyReady: true`" bullet — it lands `DEFINITION`+`HUMAN` with 0 comments, which is already NOT `ON_HOLD`+`HUMAN` and already the required starting state. Do not create a fresh fixture for this test. Assert `fullyReady === true` explicitly after the 409 — proves the `handBackToAi` guard blocks the whole batch, including the independent `clearFullyReady` half.
- [ ] New suite `fullyReady untouched by non-write endpoints`: `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner` — all 7 REQ-007 endpoints. `/wont-do` and `/hand-to-ai` are admin-session-only, a different auth path from the other five, and the ones most likely to regress silently — do not drop them. `tickets.spec.ts` already has working admin-session test helpers for both, used elsewhere in the file for their own existing tests; reuse them here. For each endpoint, two separate assertions per response: (a) `fullyReady` equals the pre-call value exactly, (b) `typeof fullyReady === 'boolean'`. Do not collapse into one assertion — "unchanged" alone wouldn't catch a silent `0`/`1` leak.
- [ ] Migration tests (Task 3) belong to `db-coder`'s direct-DB-access test file, not this Playwright suite — they exercise a startup-time DB function, not an HTTP endpoint. Do not duplicate them here.

### 7. Skill: write-ticket — send `fullyReady` on ticket creation
**Agent:** skill-coder
**Model:** haiku — single mechanical field addition to one existing `curl` payload, driven by a judgment variable the skill already computes; no new logic, direct precedent (`type`) in the same call.

- [ ] In `.claude/skills/write-ticket/SKILL.md` Schritt 3, extend the `POST /api/tickets` JSON payload: add `"fullyReady": true` when Schritt 2's verdict is "gut genug zum Bauen"; omit the field (or send `false`) when the verdict is "muss verfeinert werden".
- [ ] `fullyReady` is a raw JSON boolean literal (unquoted) — unlike `type`/`title`/`body`, which are escaped JSON strings. Do not run it through the string-escaping step.
- [ ] Leave everything else untouched: Schritt 2's judgment logic, Schritt 3's body template, Schritt 3a/3b, Schritt 4/5.
- [ ] Bump frontmatter `version` 1.4.0 → 1.5.0, `last-modified` → 2026-08-02.

### 8. Skill: do-fully-automatic — add third candidate class (`fullyReady`)
**Agent:** skill-coder
**Model:** sonnet — the PRD already resolves the hard correctness/race-condition reasoning in full prose (mandatory call order in REQ-012, precedence in REQ-010, partial-failure analysis). This is precise transcription into the skill's existing structure, not new design work.

- [ ] Name the new class `DEFINITION_READY` in `ticket_class` (parallel to `READY`/`DEFINITION_AI`). Use consistently everywhere below.
- [ ] Frontmatter `description`: rewrite away from the binary "either Ready... or Definition+AI" framing to name all three classes. Extend "promoting a Definition+AI ticket to Ready itself first when ready" to also cover the new class's two-call promotion.
- [ ] Bump frontmatter `version` 1.0.0 → 1.1.0; confirm `last-modified` is 2026-08-02 (already correct in the real file — no change needed there).

**Schritt 1 — board-scan branch:**
- [ ] After the existing `DEFINITION`-array scan for oldest `owner=="AI"` (→ `DEFINITION_AI`), add: only if that scan found nothing, scan the same array again for oldest `fullyReady==true` (any owner) → `ticket_class = DEFINITION_READY`. Must be two sequential whole-array passes in this order — not independent per-entry checks — so REQ-010's precedence (a ticket that's both `owner=="AI"` and `fullyReady==true` is always caught by the first pass) holds by construction.
- [ ] Reword the "nothing to do" message to name all three classes accurately — do not reuse the two-class text verbatim.

**Schritt 1 — ID/URL branch:**
- [ ] Real file line 116 (`HTTP 200 → JSON parsen. id, title, body, status, owner und das comments-Array behalten.`): extend the retained-field list to also keep `fullyReady` — the `DEFINITION`+`fullyReady==true` check below has nothing to test against without it.
- [ ] Extend the classification chain: `TODO`+`owner=="AI"` → `READY`, then `DEFINITION`+`owner=="AI"` → `DEFINITION_AI`, then `DEFINITION`+`fullyReady==true` → `DEFINITION_READY` (checked only if the owner branch didn't match — same if/elif ordering naturally enforces precedence here too).
- [ ] Extend the rejection message to also print `fullyReady=<value>` (matching now depends on the flag too) and name all three classes.
- [ ] "Wichtig" callout (no mutation in Schritt 1) stays valid for all three classes — note it applies to all three.

**Schritt 3 (judgment):** No change — confirm the `requirements-reviewer` call already runs identically for all three classes (REQ-011).

**Schritt 3a (decline):**
- [ ] Real file line 149, Schritt 3a section header (`*(NICHT ablehnen, plan-and-do NICHT aufrufen. Gilt für beide Ticket-Klassen — READY und DEFINITION_AI.)*`): reword "Gilt für beide Ticket-Klassen — READY und DEFINITION_AI" to name all three classes (READY, DEFINITION_AI, DEFINITION_READY).
- [ ] Add `"clearFullyReady": true` to the comment call's JSON body, only when `ticket_class == DEFINITION_READY`. `READY`/`DEFINITION_AI` declines unchanged.
- [ ] The gate itself (real file line 175, `**Nur wenn `ticket_class == READY`:**`) is a positive condition — it already excludes every non-READY class with zero wording change needed. What actually needs editing: the explanatory prose right after it (real file line 185, `Für ticket_class == DEFINITION_AI wird dieser Aufruf übersprungen...`) — extend it to also state that `DEFINITION_READY` skips this call. The codes-check line (real file line 187) is covered by the next bullet.
- [ ] Update the code-count check line to add the two-call/both-200 rule for `DEFINITION_READY`.
- [ ] Note next to the `owner=HUMAN` PATCH: for `DEFINITION_READY` this is a **no-op** — owner is already `HUMAN` by construction of the precedence rule. Still runs, unconditionally, same code path as the other classes.
- [ ] Update the closing summary line to describe the `DEFINITION_READY` outcome: stays `DEFINITION`, `owner=HUMAN` (no-op'd), and `fullyReady` is now `false`.

**Schritt 3b (build):**
- [ ] Structural placement: real file item 1 (line 195) is scoped by a single header, `**Nur wenn `ticket_class == DEFINITION_AI`:**`, covering the whole re-fetch + guard + promote block. Recommendation: add the `DEFINITION_READY` logic as a new, separate, sibling numbered sub-item placed directly after item 1 — do NOT broaden item 1's existing header to branch internally between the two classes. Reason: `DEFINITION_AI` needs one promotion call (status only); `DEFINITION_READY` needs two calls in a specific mandatory order with a different guard — merging both into one header/branch is more error-prone than two parallel sibling sub-items.
- [ ] Add this new class-specific sub-block, parallel to (not merged into) the existing DEFINITION_AI re-fetch/promote block, for `ticket_class == DEFINITION_READY`:
  - Re-fetch `GET /:id` immediately before mutating.
  - Guard: `status=="DEFINITION" && fullyReady==true` — **replaces** the owner-based guard (do not check owner here).
  - Guard fails → exit cleanly, no error, no build.
  - Guard passes → issue exactly two promotion calls, **mandatory order**:
    1. `PATCH /:id/status {"status":"TODO"}` FIRST. Non-200 → stop, report, end. Ticket unchanged — safe, no partial state.
    2. `PATCH /:id/owner {"owner":"AI"}` SECOND, only after step 1 returns 200.
- [ ] Add a "Wichtig, load-bearing" note explaining the mandatory order (status-first is safe — the transient `TODO`+`owner=HUMAN` state matches no scan class; owner-first is forbidden — it creates a transient `DEFINITION`+`owner=AI` state a concurrent run would misclassify as a genuine DEFINITION_AI ticket and grab mid-promotion). State plainly: do not reorder, do not remove this check.
- [ ] Handle partial failure explicitly as its own documented outcome: `status` succeeds but `owner` fails → ticket stuck at `TODO`+`owner=HUMAN`, unclaimable by any of the three classes, refused by `/start` too. State this needs manual repair. Never report the run as built or successful.
- [ ] Note the same accepted-risk class already documented for DEFINITION_AI applies here too (both PATCH endpoints unguarded server-side) — not new or worse, just now protecting a two-call sequence.
- [ ] Real file line 222, Schritt 3b item 2 header (`Ticket claimen (beide Klassen konvergieren hier, identisch zu do-semi-automatic):`): also says "beide" — reword to name all three classes converging here, or drop the enumeration and just state all classes converge here.
- [ ] Confirm convergence after successful promotion: same `/start` claim, same "In Bearbeitung genommen..." comment, same `plan-and-do` call as the other classes — extend the existing DEFINITION_AI parenthetical to also cover DEFINITION_READY (comment narrates the two-call promotion + claim as one unit).

**Kommentar-Regel:**
- [ ] `→ DEFINITION` bullet: name all three classes; note `DEFINITION_READY`'s comment also carries `clearFullyReady: true`.
- [ ] `→ IN_PROGRESS` bullet: extend to state `DEFINITION_READY`'s comment documents the two-call promotion plus the claim, as one unit.
- [ ] `→ ON_HOLD` bullet (real file line 320): wording needs updating — "Unverändert — für beide Ticket-Klassen nur über Schritt 3b-Blocker erreichbar, nie über Schritt 3a" also says "beide" and must name all three classes. The underlying mechanic (ON_HOLD only reachable via 3b-Blocker, never 3a) genuinely doesn't change — only the wording does.
- [ ] `→ DONE` bullet: no change.
- [ ] Closing "Anmerkung": extend from two cases to three — a declined `DEFINITION_READY` ticket also stays `DEFINITION`+`owner=HUMAN`, but uniquely ends with `fullyReady=false`. All three resolve through the identical shared Schritt-3a mechanism.

### 9. Documentation — SPEC-API-TICKETS.md, SPECS-database.md (REQ-014)
**Agent:** be-coder
**Model:** haiku — mechanical documentation update; every fact needed is already fully specified in the PRD and in Tasks 1-8's actual changes.

- [ ] `docs/specs/SPEC-API-TICKETS.md`: add `fullyReady` to the ticket object JSON example.
- [ ] Document the `POST /` create endpoint's new optional `fullyReady` request field.
- [ ] Document the `POST /:id/comments` endpoint's new optional `clearFullyReady` request field, including the atomicity behavior with `handBackToAi` (both flags on a ticket that fails the `handBackToAi` guard → whole request 409s, neither flag applies).
- [ ] Update the "For skill authors" table (the `| Step | Call | Notes |` table near the end of the file) — REQ-014 names this table as one of three places (ticket object, ticket list item, "For skill authors" table) that must show the new fields, and it is a separate skill-author-facing summary from the main endpoint sections above, so it needs its own edit. In the **Create** row (`POST /api/tickets`), extend the Notes column to also mention the new optional `fullyReady` boolean request field. In the **Comment** row (`POST /api/tickets/:id/comments`), extend the Notes column to also mention the new optional `clearFullyReady` boolean request field.
- [ ] Extend the Concepts section to describe the third route out of `DEFINITION`: a `fullyReady`-flagged ticket that `do-fully-automatic` picks up with no human click.
- [ ] Replace the Concepts section's routing lead-in sentence, which today reads "A human refines the ticket via the comment thread, then routes it with one of two actions:" — this becomes wrong once a `fullyReady`-flagged ticket can be promoted with no human action at all. Use this exact replacement sentence: "A human refines the ticket via the comment thread, then either routes it with one of two actions, or — if `write-ticket` already flagged it `fullyReady=true` — `do-fully-automatic` routes it automatically, with no human action at all:" Leave the two existing bullets ("An KI übergeben", "Nach Bereit") directly below unchanged — they remain the two human-driven actions.
- [ ] Correct the "Agents only ever claim TODO+AI tickets" sentence — already stale (DEFINITION_AI is a prior exception), now gets a second exception for the new `fullyReady` class. Replace the current sentence "Agents only ever claim `TODO`+`AI` tickets, so a `DEFINITION` ticket is never auto-claimed." with this exact replacement: "Agents do not only claim `TODO`+`AI` tickets: `do-fully-automatic` also claims a `DEFINITION` ticket directly, in two cases — `owner=AI` (a human clicked "An KI übergeben") or `fullyReady=true` (flagged automatically by `write-ticket`, no human click at all)." Leave the following sentence ("The `TODO` column is labelled **"Bereit"** in the UI.") unchanged.
- [ ] `docs/specs/SPECS-database.md`: add the `fullyReady` column to the `ticket` table listing.
- [ ] `docs/specs/SPECS-database.md`: the "Migration approach" paragraph (under "Schema Files") currently says "with one exception" and then calls `ensureSzenarioAgileKiColumn()` "the codebase's first real ALTER-on-an-existing-table migration; every other table still relies on `CREATE TABLE IF NOT EXISTS` only." This becomes false once Task 2's `ensureTicketFullyReadyColumn()` ships as a second such migration. Update the paragraph to name both exceptions: change "with one exception —" to "with two exceptions —", then change the sentence "This is the codebase's first real ALTER-on-an-existing-table migration; every other table still relies on `CREATE TABLE IF NOT EXISTS` only." to this exact replacement: "These are the codebase's only two ALTER-on-an-existing-table migrations — `ensureSzenarioAgileKiColumn()` (adds `agileKiSteps` to `szenario`) and `ensureTicketFullyReadyColumn()` (adds `fullyReady` to `ticket`); every other table still relies on `CREATE TABLE IF NOT EXISTS` only." Also add a short clause introducing `ensureTicketFullyReadyColumn()` the same way the paragraph already introduces `ensureSzenarioAgileKiColumn()`: a guarded, idempotent `ALTER TABLE ticket ADD COLUMN fullyReady ...` for databases created before that column existed, checking `PRAGMA table_info(ticket)` first and swallowing a "duplicate column" error.

### 10. Verification
**Agent:** be-coder
**Model:** sonnet — final integration check across a change that spans schema, service, route, and two skill files; confirms Tasks 1-9 compose correctly, not a mechanical single-file check.

- [ ] Run `cd backend && npm test` — full suite, including the new migration tests (Task 3) and new API tests (Task 6). All green, no regressions in existing tests.
- [ ] Run `cd backend && npx tsc --noEmit` — confirm the widened `TicketDTO`/`TicketListItemDTO`/`create`/`addComment` types check cleanly end to end.
- [ ] Read the finished `.claude/skills/do-fully-automatic/SKILL.md` top to bottom. Confirm the mandatory `status`-then-`owner` promotion order actually appears in that sequence in Schritt 3b (not just described in a note) — this is the one detail most likely to get silently transposed during editing.
- [ ] Confirm every PRD Success Criteria checklist item is met. In particular, re-verify REQ-003 ("every ticket response returns the field as a real JSON boolean") against the full set of 11 endpoints named in REQ-003's own acceptance text — `GET /:id`, `GET /` (paginated list), `GET /board`, `GET /next`, `POST /:id/start`, `POST /:id/done`, `POST /:id/ask`, `PATCH /:id/status`, `PATCH /:id/owner`, `POST /:id/comments`, and `POST /` (create) — not just the 9 endpoints Task 4's inspection bullet names (which omits `/comments` and `create`). Both omitted endpoints are already exercised by Task 6's dedicated suites (the `clearFullyReady` suite and the create suite), so confirm their responses also carry `fullyReady` as a real boolean and close the count gap Task 4 leaves.
- [ ] **Mandatory manual end-to-end spot check** — not optional. This is the only behavioral verification anywhere in this plan of REQ-010 (candidate precedence), REQ-012 (mandatory promotion call order and partial-failure handling), and REQ-013 (decline clears the flag with no spam loop) — none of that skill-level logic is covered by the automated Playwright suite (Task 6), which tests the API only, not the skills. Run all four scenarios below, in order:
  - [ ] (a) Run `write-ticket` on clear feedback. Confirm the new ticket shows `fullyReady=true` via `GET /:id`.
  - [ ] (b) With no `TODO`+`AI` (READY) or `DEFINITION`+`AI` (DEFINITION_AI) ticket waiting on the board, run `do-fully-automatic` with no argument. Confirm it picks up and processes the `fullyReady=true` ticket from (a) via the new `DEFINITION_READY` class — re-judges it, then either promotes-and-builds it or declines it with the flag cleared.
  - [ ] (c) If (b) declined the ticket, run `do-fully-automatic` again with no argument. Confirm the same ticket is NOT re-picked — proves no spam loop (REQ-013).
  - [ ] (d) Create or manufacture a ticket that is BOTH `DEFINITION`+`owner=AI` AND `fullyReady=true` at once — e.g. a human does "An KI übergeben" (`PATCH /:id/owner {"owner":"AI"}`) on a ticket `write-ticket` also flagged `fullyReady=true`. Run `do-fully-automatic`. Confirm it classifies and processes the ticket via the `DEFINITION_AI` path only — never the `DEFINITION_READY` path — and the ticket is never double-processed. Proves REQ-010's precedence rule.

## Tests

### Unit / Integration (Task 3, Task 6 — full detail there)
- [ ] Migration: repeat-call safety, duplicate-column swallow, narrow-catch (other errors still throw), fresh-DB column defaults.
- [ ] API: create with/without/invalid `fullyReady`; boolean-type round-trip across all 9 response endpoints; `clearFullyReady` clear/no-op/idempotent; atomicity with `handBackToAi`; flag untouched by non-write endpoints.

### Edge Cases
- [ ] A ticket matching both `DEFINITION_AI` and the new `DEFINITION_READY` class (human did "An KI übergeben" on a ticket `write-ticket` also flagged) is classified `DEFINITION_AI` only — never processed twice.
- [ ] A `DEFINITION_READY` ticket re-judged NOT ready by `do-fully-automatic` ends with `fullyReady=false`, `status=DEFINITION`, `owner=HUMAN`, and is never re-picked by a later run (no spam loop).
- [ ] A `DEFINITION_READY` ticket where the promotion's `owner` PATCH fails after the `status` PATCH succeeded is left `TODO`+`owner=HUMAN` — unclaimable by any class, and the skill reports this plainly rather than claiming success.
- [ ] A `DEFINITION_READY` ticket promoted and claimed, then hitting Schritt 3b-Blocker mid-build, ends `ON_HOLD` — indistinguishable from any other class hitting the same path.
