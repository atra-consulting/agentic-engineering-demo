# Implementation Plan: DO-FULLY-AUTOMATIC-SKILL

## Context

`do-semi-automatic` works one **Ready** (`TODO`+`owner=AI`) ticket per run: judges it via `requirements-reviewer`, then either builds it via `plan-and-do` (Schritt 3b) or sends it back to `DEFINITION`, owner `HUMAN` (Schritt 3a). A build-time blocker mid-`plan-and-do` moves it to Blocked (`ON_HOLD`, via `POST /:id/ask`, Schritt 3b-Blocker).

`do-fully-automatic` removes the **one remaining checkpoint** `do-semi-automatic` doesn't touch: the human-only "Nach Bereit" hand-off. Today, a ticket a human has assigned to the AI via "An KI übergeben" (`DEFINITION`+`owner=AI` — assigned, but not yet promoted to the Ready queue) still needs a human to click "Nach Bereit" before any skill will look at it. `do-fully-automatic` claims and judges these tickets itself, promoting them to Ready and building them when ready, or leaving a comment and handing back to the human when not.

**For everything else, `do-fully-automatic` behaves exactly like `do-semi-automatic`** — same Schritt 3a (unclear Ready ticket → back to `DEFINITION`), same Schritt 3b (build via `plan-and-do`), same Schritt 3b-Blocker (unsolvable mid-build problem → Blocked). An earlier draft of this plan also changed Schritt 3a's outcome from `DEFINITION` to Blocked for Ready tickets — that change was explicitly reverted: only the Definition+AI auto-promotion capability is being added.

**Note on scope:** a further extension was explored during planning (a `fullyReady` flag letting `write-ticket` mark tickets for zero-human-click processing, bypassing even the "An KI übergeben" step) and was reviewed in depth (4 parallel agent reviews: business, database, backend, skill-authoring lenses). It surfaced real design issues (a broken auto-clear mechanism, a decline-spam-loop risk, a missing migration file, boolean-coercion and validation gaps) and, more importantly, a sequencing risk: it assumes a self-promotion contract from `do-fully-automatic` that doesn't exist on disk yet. Decision: ship this skill (the scope below) first, and treat the `fullyReady` flag as a **separate follow-up task** once this skill's actual contract is real and verifiable. That work is deliberately **not** part of this plan.

The skill recognizes two **ticket classes**:
- **READY** = `TODO` + `owner=AI`
- **DEFINITION_AI** = `DEFINITION` + `owner=AI`

Any other ticket (including `DEFINITION`+`owner=HUMAN` — never handed to AI at all) is out of scope and rejected. "An KI übergeben" stays the one remaining human checkpoint: a human still decides which tickets the AI may touch at all; the skill only decides whether an AI-assigned ticket is ready to move further.

**Verified against `docs/specs/SPEC-API-TICKETS.md`, `backend/src/services/ticketService.ts`, `backend/src/routes/tickets.ts`** (two rounds of `skill-coder`/`skill-reviewer` agent review):

- `PATCH /:id/status` (`ticketService.setStatus`) has **no guard at all** beyond ticket existence — doesn't check current status or owner. `PATCH /:id/owner` (`setOwner`) is likewise unguarded. **Schritt 1's `owner=="AI"` check inside the skill is the only thing preventing a still-human-owned ticket from ever being promoted** — no server-side defense-in-depth. Must be called out explicitly in the skill text, right next to the promotion `PATCH` call.
- `POST /:id/hand-to-ai` — the endpoint with a real atomic `DEFINITION→TODO` guard — is **admin-session-only**, not available to the agent token. The promotion path must use unguarded `PATCH /:id/status` instead, accepting the TOCTOU risk below.
- **Race window (real):** between Schritt 1's read and Schritt 3b's promotion `PATCH` for a `DEFINITION_AI` ticket, tens of seconds can pass (thread read + a full `requirements-reviewer` subagent call). A concurrent run could mutate the same ticket in that window; because `setStatus`/`setOwner` are unguarded, this could silently interfere with another run's in-flight claim. Mitigation: **re-fetch `GET /:id` immediately before the promotion `PATCH`** to shrink the window (cannot close it entirely — no atomic, agent-token-accessible primitive exists). Document the residual risk as an accepted tradeoff for single-runner workshop usage.
- `POST /:id/start` still requires `TODO`+`owner=AI` — after promotion, this guard behaves exactly as it already does for any Ready ticket, `409` on a genuine claim race.
- `SPEC-API-TICKETS.md` currently documents "An KI übergeben" as "the ticket is not yet ready to build" (implying a human always promotes it later). That becomes misleading once `do-fully-automatic` exists — needs a one-line update.

**Net result: the invariant do-semi-automatic already documents stays true, unchanged** — this skill's only outcomes are **erledigt** (Schritt 4), **zurück auf Definition** (Schritt 3a — now for either ticket class), or **Blocked** (Schritt 3b-Blocker only — unchanged, not reachable from Schritt 3a for either class). No new outcome type is introduced; Definition_AI's "declined promotion" reuses the *exact same* Schritt 3a mechanism as a Ready ticket being sent back, just skipping the redundant status PATCH since it's already there.

Everything else (env loading, `Hinweis` parsing, error-handling rules, `plan-and-do` standing instructions, no push/no PR) stays the same pattern as `do-semi-automatic`.

## Test Command

`cd backend && npm test`

(No backend/frontend code paths change — this is a skill-markdown + spec-doc change. Run as a regression safety net; expect unchanged pass/fail counts vs. baseline.)

## Tasks

### 1. Scaffold the new skill file

- [ ] Create `.claude/skills/do-fully-automatic/SKILL.md`. Single file, no companion `-modes.md`.
- [ ] Frontmatter:
  ```yaml
  name: "project:do-fully-automatic"
  description: "Headless skill that works one Kanban ticket per run — either Ready (TODO+AI) or Definition+AI (assigned to the AI via 'An KI übergeben' but not yet promoted). Judges it with requirements-reviewer: builds via plan-and-do (promoting a Definition+AI ticket to Ready itself first when ready), or sends it back to Definition (owner HUMAN) with a comment when not. An unsolvable problem during implementation still moves the ticket to Blocked, exactly like do-semi-automatic. No push, no PR. For headless claude -p runs."
  argument-hint: "[ticket-id | ticket-url] [comment]"
  version: 1.0.0
  last-modified: 2026-08-02
  allowed-tools:
    - Read
    - Bash
    - Task
    - Skill
  ```
- [ ] Title `# Do Fully Automatic`.
- [ ] **Auftrag / mission sentence**, extending do-semi-automatic's original: "Ein Ticket finden — entweder schon „Bereit" und der KI zugewiesen, oder in „Definition" liegend und der KI zugewiesen (aber noch nicht befördert) — seinen Thread lesen, beurteilen ob es baubar bzw. beförderungsreif ist, und es dann entweder vollständig umsetzen (bei Definition+KI: erst selbst nach „Bereit" befördern) oder zurück auf Definition geben — unbeaufsichtigt. Ein Ticket pro Durchlauf."
- [ ] `API-Referenz: docs/specs/SPEC-API-TICKETS.md (Abschnitt „For skill authors")` — unchanged.

### 2. Copy Schritt 0, 2, 3b-Blocker, Schritt 4 verbatim

- [ ] **Konfiguration**: copy verbatim.
- [ ] **Parameter**: copy verbatim — same three input modes; the resolved ticket's actual state determines its class (Task 3), the parameter grammar itself is unchanged.
- [ ] **Fehlerbehandlung bei mutierenden Aufrufen**: copy, update the referenced step list to **Schritt 3a, 3b, 3b-Blocker und 4**.
- [ ] **Schritt 0** (env vars): copy verbatim.
- [ ] **Schritt 2** (Thread lesen): copy verbatim.
- [ ] **Schritt 3b-Blocker**: copy verbatim, byte-for-byte — unchanged, applies identically regardless of which class the claimed ticket started as.
- [ ] **Schritt 4** (Erledigt markieren): copy verbatim.

### 3. Rewrite Schritt 1 (ticket resolution, both classes)

- [ ] **No argument (board-scan):** `GET /board`. Check `TODO` array first — oldest `owner=="AI"` entry → `ticket_class = READY`. If none, check `DEFINITION` array — oldest `owner=="AI"` entry → `ticket_class = DEFINITION_AI`. Both empty → "Keine Tickets bereit für AI (weder Bereit+KI noch Definition+KI)." and end. (READY takes priority — already vetted, no promotion needed; DEFINITION_AI is only a fallback when the Ready queue is empty.) Then `GET /:id` for full details, as today.
- [ ] **Ticket ID/URL given:** `GET /:id`. `404` → end. `200` → parse `status`, `owner`, `comments`:
  - `status=="TODO" && owner=="AI"` → `ticket_class = READY`.
  - `status=="DEFINITION" && owner=="AI"` → `ticket_class = DEFINITION_AI`.
  - anything else → "Ticket <id>: status=<status>, owner=<owner> — Skill verarbeitet nur Bereit+KI oder Definition+KI Tickets. Durchlauf beendet." and end.
  - other codes → error, end.
- [ ] "Wichtig" callout: this step doesn't mutate anything (no claim, no promotion) — both happen only in Schritt 3b.

### 4. Rewrite Schritt 3 / 3a / 3b

- [ ] **Schritt 3** (judge via `requirements-reviewer`): copy verbatim — same subagent, same four criteria, same binary verdict, same "Dem Urteil des Subagenten ohne Abweichung folgen." Identical question regardless of class.
- [ ] **Schritt 3a — Nicht gut genug → zurück auf Definition** (heading unchanged from do-semi-automatic; now explicitly covers both classes):
  1. `POST /:id/comments` — genau benennen was fehlt (unchanged standard: no generic "unklar").
  2. `PATCH /:id/owner {"owner":"HUMAN"}`.
  3. **Nur wenn `ticket_class == READY`:** `PATCH /:id/status {"status":"DEFINITION"}`. For `DEFINITION_AI` this call is **skipped** — the ticket is already there.
  - Check codes per the error-handling rule: for `READY`, all three codes must be `200`; for `DEFINITION_AI`, both of the two calls must be `200`. Any failure → error, end, do not report "sent back."
  - One-line note: for `DEFINITION_AI` this is not a regression — the ticket never left `DEFINITION`.
- [ ] **Schritt 3b — Gut genug**, branches by class then converges exactly like `do-semi-automatic`:
  1. **Only if `ticket_class == DEFINITION_AI`:** re-fetch `GET /:id` immediately before mutating (shrinks, doesn't close, the TOCTOU window from Context). If the ticket is no longer `DEFINITION`+`owner=AI`, end cleanly — no error, just note another process/human is handling it. Otherwise `PATCH /:id/status {"status":"TODO"}` to promote. `200`→continue; other→error, end (ticket stays `DEFINITION`, no claim attempted). **Inline note right at this call:** `owner` is already `AI` from Schritt 1's gate; `PATCH /:id/status` itself enforces nothing — Schritt 1's check is the only safeguard. Do not remove it when editing this skill later.
  2. **Both classes converge** (unchanged from `do-semi-automatic`): `POST /:id/start` (claim). `200`→continue; `409`→claimed elsewhere, error, end; other→error, end.
  3. Comment: "In Bearbeitung genommen. Baue jetzt via plan-and-do." (For `DEFINITION_AI`, this single comment narrates promotion+claim as one unit — no separate "promoted" comment.)
  4. Call `/project:plan-and-do` with the same standing autonomous instructions as `do-semi-automatic` — copy verbatim (skip PRD, plan approval = "Approve, implement, and review", auto-approve review findings, test-command fallback, never push/PR, escape to Schritt 3b-Blocker on a real blocker).

### 5. Rewrite Kommentar-Regel (minimal change from do-semi-automatic)

- [ ] `→ DEFINITION (Schritt 3a, beide Ticket-Klassen)`: eigener `POST /:id/comments`, da `/owner` und `/status` selbst kein Kommentarfeld kennen. Note: for `DEFINITION_AI` this comment is the whole story (no status-PATCH follow-up needed).
- [ ] `→ IN_PROGRESS (Schritt 3b)`: eigener Kommentar "In Bearbeitung genommen...". For `DEFINITION_AI` tickets this also documents the promotion.
- [ ] `→ ON_HOLD (Schritt 3b-Blocker)`: automatisch von `POST /:id/ask`. Unchanged — not reachable from Schritt 3a for either class.
- [ ] `→ DONE (Schritt 4)`: automatisch von `POST /:id/done`.
- [ ] Closing "Anmerkung": **copy do-semi-automatic's wording almost verbatim** — "Dieser Skill löst ein Ticket nie als „Won't Do" auf... Seine einzigen Ergebnisse sind erledigt, zurück auf Definition, oder Blocked." Add one clause: "zurück auf Definition" now applies to a Ready ticket regressing, or a Definition+AI ticket simply staying where it was (declined promotion) — both use the identical Schritt-3a mechanism.

### 6. Update `docs/specs/SPEC-API-TICKETS.md`

- [ ] Around line 25, the "An KI übergeben" bullet ends "...the ticket is not yet ready to build." Add a clause noting a headless skill (`do-fully-automatic`) may judge it ready and promote+build it automatically.

### 7. Update `docs/SKILLS.md`

- [ ] Line 3: "sechs eigene Skills" → **"sieben eigene Skills."**
- [ ] Headless-skills intro sentence → **"Vier Skills... `/do-factory-automatic`, `/do-fully-automatic`, `/do-semi-automatic` und `/write-ticket`"** (alphabetical).
- [ ] New `### /do-fully-automatic` subsection directly after `### /do-semi-automatic`. Mirror its structure. "Was passiert" states: builds Bereit+KI tickets exactly like `/do-semi-automatic`; for Definition+KI tickets, promotes to Bereit itself when ready, or leaves a comment and hands back to a human when not (same "zurück auf Definition" outcome either way).

### 8. Update `docs/TOOLS.md`

- [ ] The "Ticket-Board" tool section's "Skills dazu" sentence — add `/do-fully-automatic`.

### 9. Explicitly scope out (note in the final summary)

- [ ] `docs/SUBAGENTS.md`, `.github/workflows/do-fully-automatic.yml`, admin `/admin/cron` dashboard card, `README.MD`'s stale "4 Skills" count — deliberately out of scope, same reasoning as `do-semi-automatic` itself (no CI wrapper/cron card beyond its own workflow file; README drift predates this task).
- [ ] The `fullyReady` flag / zero-human-click extension (schema change + `write-ticket` + `do-fully-automatic` extension) — deliberately deferred to a separate follow-up task. Not part of this plan.

### 10. Verification pass

- [ ] Read the finished `.claude/skills/do-fully-automatic/SKILL.md` top to bottom. Confirm Schritt 3a for `READY` tickets is functionally identical to `do-semi-automatic`'s Schritt 3a (three calls, back to Definition) — no Blocked/`/ask` path introduced there.
- [ ] Confirm Blocked (`ON_HOLD`) is reachable **only** via Schritt 3b-Blocker, for either ticket class — never via Schritt 3a.
- [ ] Confirm the "Schritt 1 owner=='AI' gate is load-bearing" note appears next to the Schritt 3b promotion `PATCH` call.
- [ ] Run `cd backend && npm test` — expect no change in pass/fail counts.

## Tests

Documentation/skill-markdown change — no automated test coverage of its own. Verification is manual/structural:

### Structural / Consistency Checks
- [ ] Confirm Schritt 3a's call count is conditional (2 calls for `DEFINITION_AI`, 3 for `READY`) and both paths check all their own codes before reporting success.
- [ ] Frontmatter is valid YAML.
- [ ] `docs/SKILLS.md` skill count matches the number of `###` entries under "Die Skills."

### Edge Cases Documented in the Skill Logic
- [ ] `READY` ticket judged not-buildable → back to `DEFINITION`, exactly like `do-semi-automatic` today.
- [ ] `DEFINITION_AI` ticket judged not-ready → stays in `DEFINITION`, comment posted, owner→HUMAN, no status call made.
- [ ] `DEFINITION_AI` ticket, re-fetch before promotion shows it's no longer `DEFINITION`+`AI` → clean end, no error, no claim attempted.
- [ ] `DEFINITION_AI` ticket, promotion succeeds but `/start` then 409s (race window materialized) → error, end; ticket left `TODO`+`owner=AI`, unclaimed (documented residual risk).
- [ ] `DEFINITION_AI` ticket promoted, claimed, then hits Schritt 3b-Blocker mid-build → ends `ON_HOLD`, indistinguishable from a `READY` ticket hitting the same path.
- [ ] Mid-build unsolvable problem (either class, already claimed) → Blocked via Schritt 3b-Blocker, unchanged from `do-semi-automatic`.

### Regression
- [ ] `cd backend && npm test` passes with unchanged counts.
