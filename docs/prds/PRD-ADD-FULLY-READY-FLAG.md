# PRD: ADD-FULLY-READY-FLAG

## Source

User request. Follow-up to the shipped `do-fully-automatic` skill (`.claude/skills/do-fully-automatic/SKILL.md`, `docs/plans/PLAN-DO-FULLY-AUTOMATIC-SKILL.md`).

That task deferred this work. Reason: the base skill did not exist yet. It exists now and is merged to `main`.

A prior session drafted this PRD and ran a four-agent review (business, database, backend, skill-authoring). This version carries those findings forward.

## Problem Statement

The workshop pipeline turns raw feedback into shipped code. Today it looks like this:

1. Raw feedback lands in the agent-task queue.
2. `write-ticket` claims it, judges it with `requirements-reviewer`, and files a Kanban ticket. The ticket lands `status=DEFINITION`, `owner=HUMAN`.
3. **A human clicks "An KI übergeben" or "Nach Bereit".**
4. `do-fully-automatic` claims the ticket, judges it again, and builds it.

Step 3 is the last human checkpoint. It blocks everything else.

The pain: `write-ticket` already judged the ticket in step 2. When its `requirements-reviewer` says "gut genug zum Bauen", the ticket sits in `DEFINITION` and waits for a click that adds no information. The pipeline stalls on a rubber stamp.

`do-fully-automatic` cannot pick the ticket up itself. It only scans two candidate classes: `TODO`+`owner=AI` (Ready) and `DEFINITION`+`owner=AI` ("An KI übergeben"). Both need the human click first. A `DEFINITION`+`owner=HUMAN` ticket is invisible to it — by design, because there is no signal that says "this one is clear".

We need that signal. One boolean on the ticket. Set by `write-ticket` at creation time, only when its own judgment says the ticket is buildable.

Target pipeline: raw feedback → `write-ticket` → (if judged good enough) flag set → `do-fully-automatic` judges again and builds → done.

What this removes: the **board click**. Nobody has to open `/admin/tickets` and press "An KI übergeben" any more.

What this does **not** remove: a human still starts each skill by hand. Two slash commands, typed by a person. CI and cron triggering stay out of scope — there is no `do-fully-automatic` workflow today, and the sibling `do-semi-automatic` workflow is dormant on purpose. So this is "no board click", not "fully unattended".

## Requirements

### Data model

```
[REQ-001] The ticket carries a fullyReady flag.
Priority: High
Reason: Nothing today marks a Definition ticket as "already judged buildable".
Acceptance:
- New boolean column on the ticket table. NOT NULL. Default false.
- Every existing ticket reads back as false.
- The flag is independent of status, owner, type, and solution. No CHECK constraint ties them together.
```

```
[REQ-002] A guarded migration adds the column to databases that already exist.
Priority: High
Reason: The ticket table already exists in every local dev DB and in Turso production.
        `CREATE TABLE IF NOT EXISTS` is a no-op there — the column would never land.
        A prior draft of this PRD omitted the migration entirely. That must not repeat.
Acceptance:
- Startup adds the column to a pre-existing ticket table, following the exact precedent
  already in this codebase: `ensureSzenarioAgileKiColumn()` in `backend/src/config/migrate.ts`
  (PRAGMA `table_info` check, then `ALTER TABLE ... ADD COLUMN`).
- Two concurrent cold-starts against the same database do not crash. The "duplicate column"
  error — and only that error — is swallowed. Every other error still throws.
- Migration runs twice in a row without error.
- A fresh database (`./start.sh --reset-db`) gets the column from the CREATE TABLE statement.
```

```
[REQ-003] The API returns fullyReady as a real JSON boolean.
Priority: High
Reason: This project's services use raw `client.execute()`, not the Drizzle query builder
        (confirmed: no `db.select/insert/update/delete` anywhere under `backend/src`).
        So Drizzle's automatic boolean coercion never fires. A raw read returns 0 or 1.
        Without explicit mapping the field leaks into JSON as a number.
Acceptance:
- `GET /api/tickets/:id` returns `"fullyReady": true` or `false` — never `0` or `1`.
- Same for `GET /api/tickets` (paginated list), `GET /api/tickets/board`,
  `GET /api/tickets/next`, and every endpoint that returns a ticket object
  (`/start`, `/done`, `/ask`, `PATCH /status`, `PATCH /owner`, `/comments`, create).
- The row→DTO mapper coerces explicitly, the same way it already does for `commentCount`.
- `typeof ticket.fullyReady === 'boolean'` holds in a test.
```

### API surface

```
[REQ-004] POST /api/tickets accepts an optional fullyReady flag.
Priority: High
Reason: The create body schema uses zod without `.strict()`. Unknown keys get stripped
        in silence. If the field is not declared, `write-ticket` can send it forever
        and nothing happens — with no error to notice.
Acceptance:
- Request body accepts `fullyReady` as an optional boolean. Mirrors the existing
  `handBackToAi` optional-boolean pattern on the comment endpoint.
- Omitted → the new ticket has `fullyReady=false`.
- `true` → the new ticket has `fullyReady=true`, and the response body says so.
- A non-boolean value → 400 with a field error.
- Auth is unchanged: agent token, loopback bypass, or admin session.
```

```
[REQ-005] Creating a ticket with fullyReady=true does not change where it lands.
Priority: High
Reason: The flag is a hint, not a routing action. The board must stay predictable.
Acceptance:
- A ticket created with `fullyReady=true` still lands `status=DEFINITION`, `owner=HUMAN`,
  no comments — identical to today.
- No status change, no owner change, no side effect of any kind.
```

```
[REQ-006] POST /api/tickets/:id/comments can clear the flag.
Priority: High
Reason: The decline path must turn the flag off. Without it, the same declined ticket
        gets re-picked and re-declined on every future run — a spam loop, forever,
        because nothing else ever clears it.
Acceptance:
- Request body accepts `clearFullyReady` as an optional boolean. Default false.
  Mirrors the `handBackToAi` pattern on the same endpoint.
- `true` → the ticket ends with `fullyReady=false`. Works from any status and any owner.
  No guard, no 409.
- `true` on a ticket that is already `fullyReady=false` → 200, no change. Idempotent.
- Omitted or `false` → the flag keeps its value.
- The two optional flags are independent in *meaning*. Either, both, or neither may be sent.
  `clearFullyReady` adds no guard of its own.
- But the request is **atomic**. `handBackToAi` keeps its existing guard: the ticket must be
  `ON_HOLD` + `owner=HUMAN`. Send both flags on a ticket that fails that guard → the whole
  request returns 409. No comment is stored, and `fullyReady` stays unchanged. The guard runs
  before the write batch is built, so `clearFullyReady` never lands on its own.
- The comment itself is stored exactly as today, with `author=HUMAN`.
```

```
[REQ-007] No other endpoint changes the flag.
Priority: Medium
Reason: A small, explicit API surface. Two write points only: create and clear.
Acceptance:
- `/start`, `/done`, `/ask`, `/wont-do`, `/hand-to-ai`, `PATCH /status`, `PATCH /owner`
  leave `fullyReady` untouched.
- A ticket that reaches DONE keeps its flag value. Useful as an audit trail; harmless,
  because a DONE ticket is never a candidate.
- No new endpoint is added.
```

### Skill behavior — write-ticket

```
[REQ-008] write-ticket sets the flag only on a "good enough to build" judgment.
Priority: High
Reason: The flag must mean exactly one thing: this skill's own reviewer said it is buildable.
Acceptance:
- Judgment "gut genug zum Bauen" → the create call sends `fullyReady: true`.
- Judgment "muss verfeinert werden" → the create call sends `fullyReady: false` or omits it.
- The judgment already happens today, before the create call. No extra reviewer run is added.
- Everything else in the skill is unchanged: the ticket still lands DEFINITION + HUMAN,
  the four-section body is unchanged, the refine branch still posts its questions-only comment,
  and the agent task is still closed.
```

### Skill behavior — do-fully-automatic

```
[REQ-009] do-fully-automatic gains a third candidate class.
Priority: High
Reason: This is the whole point — remove the last human click.
Acceptance:
- The board scan in Schritt 1 adds a third class: `status=DEFINITION` and `fullyReady=true`,
  regardless of current owner. Oldest first, by `createdAt ASC`, like the other two classes.
- The two shipped classes are untouched: `TODO`+`owner=AI` (READY) and
  `DEFINITION`+`owner=AI` (DEFINITION_AI).
- No candidate at all → the skill still exits cleanly with a "nothing to do" message.
  The message text must name all three classes accurately. Today's wording lists two.
  It becomes wrong once a third class exists, so it gets updated — not reused verbatim.
- The ID and URL input modes accept a ticket of the new class too. A ticket that matches
  none of the three classes is still refused. That refusal message also names all three
  classes, so a reader understands why the ticket was rejected.
```

```
[REQ-010] Candidate precedence is fixed and each ticket is handled once.
Priority: High
Reason: A ticket can be DEFINITION + owner=AI + fullyReady=true at the same time —
        a human clicked "An KI übergeben" on a ticket write-ticket also flagged.
        Two scan branches must never both grab it.
Acceptance:
- Order: READY first, then DEFINITION_AI, then the new fullyReady class.
- A ticket matching both DEFINITION_AI and the new class is classified as DEFINITION_AI.
  It is never processed twice, and never counted in both branches.
- One ticket per run stays true.
```

```
[REQ-011] The flag never skips the AI's own judgment.
Priority: High
Reason: `write-ticket`'s judgment does not cross-check the ticket against live code.
        `do-fully-automatic`'s judgment does — its reviewer checks whether the described
        problem still exists in the real code. That is the defense-in-depth argument.
        The flag only bypasses the human owner-gate.
Acceptance:
- A fullyReady ticket still goes through the full `requirements-reviewer` step (Schritt 3)
  before any build starts.
- There is no shortcut path from "flag is true" straight to build.
- The reviewer's verdict wins. A "zurückgeben" verdict on a fullyReady ticket takes the
  decline path, not the build path.
```

```
[REQ-012] The build path promotes a flagged ticket itself.
Priority: High
Reason: `/start` guards on TODO + owner=AI. A flagged ticket may still be owner=HUMAN.
        So this class needs TWO promotion calls, not one. The shipped DEFINITION_AI class
        needs only `status` — its owner is already AI. Two calls are not atomic. Order matters.
Acceptance:
- On a positive verdict for a new-class ticket, the skill re-reads the ticket, then promotes
  it before claiming it — using existing endpoints only (`PATCH /:id/status`,
  `PATCH /:id/owner`). No admin session, no `/hand-to-ai`.
- The re-read guard for this class checks `status` is still `DEFINITION` and `fullyReady`
  is still `true`. It replaces the owner check, which does not apply when owner is HUMAN.
- Guard fails (a human or another run moved the ticket) → exit cleanly, no error, no build.

- **Call order is mandatory: `status` first, then `owner`.** Not a suggestion. A hard
  requirement. Reason — the transient state between the two calls must match no scan class:

    `status` first (REQUIRED):
      Transient state = TODO + owner=HUMAN.
      Safe. READY needs owner=AI. DEFINITION_AI and the new class both need
      status=DEFINITION. This state matches none of the three. No concurrent run
      can misclassify it.

    `owner` first (FORBIDDEN):
      Transient state = DEFINITION + owner=AI.
      Unsafe. That is indistinguishable from a genuine "An KI übergeben" ticket.
      A concurrent do-fully-automatic board scan grabs it as DEFINITION_AI,
      mid-promotion. The same ticket gets worked twice.

- **Partial failure is possible and must be documented.** `status` succeeds, `owner` fails →
  the ticket sits at `TODO` + `owner=HUMAN`. That state matches none of the three scan classes,
  so no future run picks it up. `/start` refuses it too (it wants owner=AI). The ticket is
  stuck and needs a human. The skill must stop on the failed call, report the endpoint and the
  HTTP code, and say the ticket is left `TODO`+`HUMAN` and needs manual repair. It must never
  report the run as built or promoted.

- **Accepted risk, stated openly.** `PATCH /:id/status` and `PATCH /:id/owner` are both
  unguarded on the server — no status guard, no owner guard, nothing stops a still-human-owned
  or already-moved ticket. The only defense is this skill's own re-read pre-check. The shipped
  skill already says this for DEFINITION_AI (Schritt 3b, the "Wichtig, load-bearing" note).
  REQ-012 reuses the same two unguarded endpoints and inherits the same class of risk — the
  same one, not a new or worse one. We accept it for single-runner workshop use. The skill text
  must carry the same explicit warning for the new class, including "do not remove this check".

- After promotion the flow is identical to the shipped classes: claim, comment, `plan-and-do`,
  done. No push, no PR.
```

```
[REQ-013] The decline path clears the flag explicitly.
Priority: High
Reason: Two reviewers confirmed `POST /:id/comments` always stores `author=HUMAN`,
        whatever the caller. So "clear the flag when a human comments" is impossible to
        implement correctly — the skill's own decline comment would clear its own flag.
        The clear must be caller-driven, not inferred from authorship.
Acceptance:
- The new class reuses the **same shared Schritt 3a mechanism** the two existing classes use.
  No second decline path. That shared path: post the comment, `PATCH owner=HUMAN`, then a
  status PATCH only for READY. The one addition is `clearFullyReady: true` on the comment call.
- On a negative verdict for a new-class ticket, the skill posts its "what is missing"
  comment with `clearFullyReady: true` in the same request.
- For the new class the `owner=HUMAN` PATCH in that shared path is a **no-op** — the owner is
  already HUMAN by construction. REQ-010's precedence rule means a ticket that was already
  `owner=AI` gets classified DEFINITION_AI, never as the new class. The call still runs, for
  one code path instead of two. It just changes nothing.
- The status PATCH is skipped for the new class, same as for DEFINITION_AI — the ticket is
  already `DEFINITION`. So Schritt 3a's existing `**Nur wenn ticket_class == READY**` gate now
  excludes two classes, not one. That gate wording gets updated to say so.
- After the decline, the ticket reads `fullyReady=false`, `status=DEFINITION`, `owner=HUMAN`.
- A second run of the skill does not pick the same ticket again. No spam loop.
- No mechanism anywhere clears the flag based on who authored a comment.
- The decline path for the two shipped classes is unchanged. It does not send the new field.
```

### Documentation

```
[REQ-014] The ticket API spec documents the new field and the new flow.
Priority: Medium
Reason: `docs/specs/SPEC-API-TICKETS.md` is the contract every skill author reads.
Acceptance:
- The ticket object, the ticket list item, and the "For skill authors" table show `fullyReady`.
- The create endpoint documents the optional request field.
- The comment endpoint documents `clearFullyReady`.
- The Concepts section explains the third route out of `DEFINITION`: a flagged ticket that
  `do-fully-automatic` picks up with no human click.
- The statement "Agents only ever claim TODO+AI tickets" is corrected — it is already stale
  for `DEFINITION`+`owner=AI` and gets a second exception now.
```

## Special Instructions

Carry these forward. They come from the prior review. Do not re-litigate them.

- **Raw SQL, not Drizzle.** Services here call `client.execute()`. Drizzle's `{ mode: 'boolean' }` coercion does not run. Coerce in the mapper. See REQ-003.
- **The migration is mandatory.** Follow `ensureSzenarioAgileKiColumn()` exactly. See REQ-002.
- **Declare the field in the zod schema.** No `.strict()` means silent stripping. See REQ-004.
- **No "clear on human comment".** That design was wrong and is dropped. The decline path clears the flag itself. See REQ-006 and REQ-013.
- **Always re-judge.** The flag is not a build permit. See REQ-011.
- **`hand-to-ai` stays admin-only.** It is not part of this feature. The skill uses `/status` + `/owner`.
- **Promotion order: `status`, then `owner`.** Load-bearing. The reverse order creates a
  `DEFINITION`+`owner=AI` window that a concurrent run reads as a real DEFINITION_AI ticket.
  See REQ-012.
- **Both PATCH endpoints are unguarded.** The skill's own pre-check is the only defense —
  already true today for DEFINITION_AI, and true again here. Accepted risk. State it in the
  skill text, do not remove the check. See REQ-012.

## Implementation Approach (high level)

### Backend

- `backend/src/db/schema/schema.ts` — add the boolean column to the `ticket` table definition. Standard SQLite/Drizzle pattern: integer column, boolean mode, NOT NULL, default false. No other table exists to mirror; this is the schema's first boolean column.
- `backend/src/config/migrate.ts` — two changes. Add the column to the `CREATE TABLE IF NOT EXISTS ticket` statement (for fresh databases). Add a guarded `ALTER TABLE` helper for existing databases, modelled on `ensureSzenarioAgileKiColumn()`, and call it from `runMigrations()`.
- `backend/src/services/ticketService.ts` — add the field to the ticket DTO, the list-item DTO, and the internal row type. Coerce it to a boolean in both mappers. Accept it in `create()`. Accept an optional clear flag in `addComment()` and add the update statement to the existing batch.
- `backend/src/routes/tickets.ts` — add the optional field to the create schema and the optional clear flag to the comment schema. Pass both through to the service. No route, auth, or middleware change.

### Skills

- `.claude/skills/write-ticket/SKILL.md` — the create call carries the flag, derived from the Schritt 2 verdict. Bump the version and the last-modified date.
- `.claude/skills/do-fully-automatic/SKILL.md` — a third candidate class in Schritt 1, with the precedence rule; the promote-then-claim variant in Schritt 3b; the clear flag on the Schritt 3a decline comment. Bump the version and the last-modified date. The exact wording is plan-level detail.
- `.claude/skills/do-fully-automatic/SKILL.md` frontmatter — the `description` field also needs an update. It says "either Ready... or Definition+AI" today. That binary framing is wrong with three classes. This field is what makes the skill discoverable, so a stale description costs real behavior.

### Docs

- `docs/specs/SPEC-API-TICKETS.md` — per REQ-014.
- `docs/specs/SPECS-database.md` — add the column to the ticket table listing.

No frontend change. No CI, cron, or workflow change.

## Test Strategy

Backend, Playwright API tests in `backend/src/test/tickets.spec.ts`:

- Create without the field → `fullyReady` is `false`, and `typeof` is boolean.
- Create with `true` → `fullyReady` is `true`, status `DEFINITION`, owner `HUMAN`, no comments.
- Create with a non-boolean → 400.
- Read back through `GET /:id`, `GET /board`, `GET /next`, and the paginated list → boolean every time, never `0`/`1`.
- Comment with `clearFullyReady: true` → flag is `false`, comment stored, `author=HUMAN`.
- Comment without the field → flag unchanged.
- Comment with `clearFullyReady: true` twice → 200 both times, still `false`.
- Comment with both flags on an `ON_HOLD`+`HUMAN` ticket → hand-back works and the flag clears.
- **Atomicity:** comment with `clearFullyReady: true` **and** `handBackToAi: true` on a ticket that is NOT `ON_HOLD`+`HUMAN` → 409, and `fullyReady` is still `true` afterwards. Proves the `handBackToAi` guard blocks the whole batch, not just its own half.
- `/start`, `/done`, `/ask`, `PATCH /status`, `PATCH /owner` → flag unchanged.
- Same five endpoints, second assertion: `typeof fullyReady === 'boolean'` on each response body. "Unchanged" alone does not prove the type survived the round trip.

Migration:

- Call the guarded-ALTER helper twice in a row, directly, against the same database. Second call must not throw. This is the real repeat test.
- Force the duplicate-column path: drop the PRAGMA `table_info` early-return (or run the raw `ALTER TABLE` first, then call the helper) so the helper's `ALTER` actually fires against a table that already has the column. The catch block must swallow that one error and only that one.
- Feed the helper a different error (for example a missing table) → it still throws. The catch is narrow, not a blanket swallow.
- Fresh DB via `./start.sh --reset-db` → column comes from `CREATE TABLE`, existing rows read `false`.

Note: "start the backend twice" is **not** enough. The second start early-returns at the `table_info` check and never reaches the `ALTER` or its catch block. That test would pass with a broken catch.

Manual, end to end: run `write-ticket` on clear feedback → the new ticket shows `fullyReady=true` via the API. Run `do-fully-automatic` with no argument and no Ready or Definition+AI ticket waiting → it picks the flagged ticket, re-judges it, and either builds it or declines it with the flag cleared. Run it again → the declined ticket is not picked a second time.

No frontend tests. The flag has no UI.

## Non-Functional Requirements

- **Backward compatible.** Every existing API client keeps working. The field is additive on responses and optional on requests.
- **Idempotent migration.** Safe on repeat startups and on concurrent Vercel cold-starts against one Turso database.
- **No new auth surface.** Existing agent-token endpoints only. No new admin capability, no new endpoint.
- **No performance cost.** No new query, no new index, no extra round trip.
- **Known limitation, accepted for this iteration:** the flag is invisible on the board and on the ticket detail page. A `DEFINITION` ticket can therefore leave the column with zero human action, and nobody saw it coming. This is a real transparency gap. We accept it now and do not solve it here. Making the flag visible — a badge, a filter, or a manual toggle — is a follow-up.
- **Blast radius if the flag is wrong:** the ticket still passes a second `requirements-reviewer` judgment, and a bad ticket comes back to `DEFINITION` with a comment and a cleared flag. Worst case is one wasted run, not a wrong build.

## Out of Scope

- Rewriting the shipped `TODO`+`owner=AI` or `DEFINITION`+`owner=AI` handling in `do-fully-automatic`. This PRD only adds a third class on top.
- The literal Markdown wording of both skill files. Plan-level detail.
- Board and detail-page UI for the flag. See the known limitation above.
- Any CI workflow, cron dashboard card, push, or PR behavior change.
- A human-facing way to set or unset the flag by hand.
- Seed data changes. Seeded tickets keep the default `false`.

## Open Questions

None. All points from the prior four-agent review are resolved and captured above.

## Success Criteria

- [ ] `fullyReady` exists on the ticket table, NOT NULL, default false.
- [ ] Existing local and Turso databases get the column on a plain restart — no `--reset-db` needed.
- [ ] Every ticket response returns the field as a real JSON boolean.
- [ ] `POST /api/tickets` accepts and honours the field; omitted means false.
- [ ] Creating with `fullyReady=true` still lands `DEFINITION`+`HUMAN`. Zero routing side effects.
- [ ] `POST /api/tickets/:id/comments` accepts `clearFullyReady` and turns the flag off.
- [ ] `write-ticket` sets the flag only when its reviewer says "gut genug zum Bauen".
- [ ] `do-fully-automatic` finds `DEFINITION`+`fullyReady=true` tickets whatever the owner.
- [ ] A ticket matching two candidate classes is processed once, as DEFINITION_AI.
- [ ] A flagged ticket is always re-judged before any build.
- [ ] The promote-then-claim path works: re-read guard, then `status` before `owner`, then claim.
- [ ] A declined flagged ticket ends `fullyReady=false` and is never picked again.
- [ ] `SPEC-API-TICKETS.md` and `SPECS-database.md` describe the new field and flow.
- [ ] Full backend test suite green.
- [ ] End to end: clear feedback becomes shipped code without any board click. A human still runs both skills by hand.
