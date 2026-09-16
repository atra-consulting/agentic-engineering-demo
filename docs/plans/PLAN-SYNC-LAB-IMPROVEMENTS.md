# Implementation Plan: SYNC-LAB-IMPROVEMENTS

## Summary

### Business Summary
Five small, independent fixes bring this training repo in line with its sibling lab project. New workshop participants get a working setup on the first try: the Windows start script stops being fragile, and both start scripts create the missing configuration file on a fresh clone. The build pipeline always reports frontend test results, even when a backend step fails, so no broken test stays hidden. Several documents that pointed at the wrong project get corrected, and the ticket board becomes readable for every logged-in user — while only administrators can still change anything.

### Technical Summary
Eleven task groups across four areas. `start.bat` gets argument validation, a guarded Node version check, removal of the dead `better-sqlite3` rebuild block, and goto-based readiness loops. Both start scripts copy `backend/.env.example` to `backend/.env` when missing. The three frontend steps in the `test` job of `.github/workflows/deploy.yml` get `if: ${{ !cancelled() }}`. Doc-only edits land in `docs/SKILLS.md`, `docs/SUBAGENTS.md`, `README.MD`, and both welcome docs. The four ticket read endpoints and the `/admin/tickets` routes open to any authenticated session through a new **additive** middleware — `requireAgentTokenOrAdminSession` keeps gating the seven write routes unchanged.

## Test Command
`cd backend && npm test` and `cd frontend && npx ng test --watch=false`

## Tasks

### 1. `start.bat` robustness (R1)
**Agent:** shell-coder
**Model:** sonnet — single file, known batch idioms, every sub-requirement spelled out; no cross-cutting or security trigger

Current state confirmed: arg parsing sits at lines 10–19, version block at 33–46, dead `better-sqlite3` block at 96–103, backend `for /l` loop at 110–126, frontend `for /l` loop at 153–169.

- [ ] R1.1 — reject any argument beyond one optional `--reset-db`. Today line 12 only looks at `%~1`; `start.bat --reset-db extra` starts anyway. Check `%~2` too (or loop over all args). On extra args print the existing usage text (`Usage: %~nx0 [--reset-db]` plus the `--reset-db` description line), `exit /b 1`.
- [ ] R1.2 — simplify the Node version parsing so it no longer depends on `delims=v` splitting. Keep the `NODE_VERSION`, `NODE_MAJOR`, `NODE_MINOR` variable names; `NODE_VERSION` is still printed on the success path. **Technique hint:** strip the leading `v` with a batch substring expansion (`%VAR:~1%` style, on the real variable name), then split the rest on `.` — no `delims=v`.
- [ ] R1.3 — add the guard: if `NODE_MAJOR` or `NODE_MINOR` is empty or non-numeric, print a clear error and `exit /b 1`. Never reach the `IF %NODE_MAJOR% LSS 20` comparison with an empty value. **Technique hint:** validate each of the two values with a `findstr /r "^[0-9][0-9]*$"` check (or equivalent) *before* the comparison; an empty value must fail the check, not skip it.
- [ ] R1.4 — delete the `node -e "require('better-sqlite3')"` check, the `errorlevel` branch, the `npm rebuild better-sqlite3` call, and the three comment lines above them (lines 96–103). No replacement check.
- [ ] R1.5 — replace the backend `for /l` loop with a label-and-counter loop: one `curl` health check per second against `http://localhost:%BACKEND_PORT%/api/health`, hard cap 60 tries, leave the loop as soon as the check returns 200.
- [ ] R1.6 — replace the frontend `for /l` loop the same way: one `netstat` port-listen check per second on `%FRONTEND_PORT%`, hard cap 120 tries, leave as soon as the port listens.
- [ ] The new loops must not depend on `!VAR!` delayed expansion. Keep `setlocal enabledelayedexpansion` at line 2 only if something else still needs it.
- [ ] R1.7 negative check — confirm byte-for-byte unchanged: both timeout values (60 / 120), both error message texts (`ERROR: Backend failed to start within 60 seconds`, `ERROR: Frontend failed to start within 120 seconds`), both `call :cleanup` invocations, the port pre-flight block (lines 59–73), the `:monitor_loop` block, and the `:cleanup` block.
- [ ] R1.8 negative check — confirm the success path is unchanged: same console lines, same ports, same startup order, same `start "CRM-Backend"` / `start "CRM-Frontend"` commands.

**Acceptance criteria:** Success Criteria 1, 2, 3, 4. `start.bat` contains no string `better-sqlite3` and no `for /l`. A diff shows only the five intended regions changed.

**Known gap (OQ6):** Windows-specific manual verification (Success Criteria 1–4) cannot be executed in this environment — there is no Windows machine and no Windows CI job in this repo. Flag it as a known gap in the final summary. The code changes are still reviewable by diff and by any static batch-syntax check that does not require running Windows. Do not add a `windows-latest` CI job in this task.

### 2. Auto-create `backend/.env` (R2)
**Agent:** shell-coder
**Model:** sonnet — two files, two platform-specific gotchas to get right

- [ ] R2.1 — add the bootstrap block to `start.sh` before the backend starts (before `npx tsx --watch src/index.ts`, currently line 179) and after the prerequisite checks. `start.sh` is not touched by group 1, so this line number holds.
- [ ] R2.1 — add the same block to `start.bat` before the `start "CRM-Backend"` line and after the prerequisite checks. **Do not use a line number here.** Group 1 deletes eight lines earlier in the same file and rewrites two loops, so any number this plan gives is stale by the time you run. Locate the insertion point by searching the file for the literal text `start "CRM-Backend"`.
- [ ] Use absolute paths in both scripts (`${ROOT_DIR}/backend/.env`, `%ROOT_DIR%\backend\.env`). Both scripts `cd` around; do not rely on the current directory.
- [ ] R2.2 — when `backend/.env` is missing and `backend/.env.example` exists, copy the example unchanged.
- [ ] R2.3 — print exactly one line on copy. Name both files. Say the user can edit the new file.
- [ ] R2.4 — when `backend/.env` exists: do nothing, print nothing. Never overwrite, never merge.
- [ ] R2.5 — when `backend/.env.example` is missing too: print exactly one warning line and continue. Do not abort.
- [ ] R2.6 — same message text in both scripts (translate only where the script already differs).
- [ ] **R2.7 gotcha** — in `start.bat`, redirect the `copy` command's own "1 file(s) copied." output to `nul`. Without this the batch version prints two lines where R2.3 allows one.
- [ ] **R2.8 gotcha** — in `start.sh`, write an explicit `if` / `elif` / `else` block. No one-line `||` / `&&` shortcut. The script runs under `set -euo pipefail` (line 2); a bare `cp` failure inside a `||` chain kills the whole script and breaks R2.5.
- [ ] Confirm `backend/.gitignore` still lists `.env` (line 5) after the change. No new runtime dependency, no Node/Python/PowerShell helper.

**Acceptance criteria:** Success Criteria 5, 6.

### 3. CI reports frontend results on backend failure (R3)
**Agent:** shell-coder
**Model:** haiku — three identical one-line additions, exact text given; no app code is touched

Agent choice: this repo's roster has no CI/YAML-owning coding agent. The file-ownership table in `.claude/skills/update-claude-files/SKILL.md` assigns `.github/workflows/**` to `admin`, but `admin`'s tools are `Read, Grep, Glob, Bash` only — no Write, no Edit — so `admin` cannot make this edit. `shell-coder` is the nearest coding agent by domain: it already owns `start.sh` and `start.bat`, and it shares `docs/specs/SPECS-infrastructure.md` with `admin`.

- [ ] R3.1 — add `if: ${{ !cancelled() }}` to the three steps in job `test` of `.github/workflows/deploy.yml`: "Frontend — install dependencies" (line 47), "Frontend — run unit tests (CI)" (line 51), "Frontend — build" (line 55).
- [ ] Placement inside each of the three steps: the new `if:` line goes directly under the step's `- name:` line, before `working-directory:`. Same indentation as the other step keys.
- [ ] R3.2 — do not use `always()`.
- [ ] R3.3 — add no condition to any backend step (lines 29–43).
- [ ] R3.4 — leave the `deploy` job untouched. It keeps `needs: test`.

**Acceptance criteria:** Success Criteria 7, 8. The diff touches exactly three lines.

### 4. Stale docs — `docs/SKILLS.md` and `docs/SUBAGENTS.md` (R4.1–R4.7)
**Agent:** skill-coder
**Model:** sonnet — the argument docs must match the real `SKILL.md` files, so this needs reading before writing

- [ ] R4.1 — `docs/SKILLS.md`, `/plan-and-do` → **Argumente:** line (line 43): document ticket mode beside free-text mode — a ticket URL (e.g. `http://localhost:7200/admin/tickets/8`) or a bare ticket number. State that `resume:<schritt>` applies to free-text mode only. Match the wording style already used for `/do-semi-automatic` (line 107).
- [ ] R4.2 — `docs/SKILLS.md`, `/review` argument list (line 61): add `embedded` — used when `plan-and-do` calls the skill mid-run; skips header, plan check, and confirmation.
- [ ] R4.3 — `docs/SKILLS.md`, `/update-claude-files` argument line (line 79): document the `embedded base:<sha>` form, which scopes the run to one branch.
- [ ] **R4.4 negative check** — do not edit any `.claude/skills/*/SKILL.md`. Read them to get the facts right; change only `docs/SKILLS.md`.
- [ ] R4.5 — `docs/SUBAGENTS.md` line 3: 24 → 27 Subagents. Verified: `.claude/agents/` holds 27 files.
- [ ] R4.6 — `docs/SUBAGENTS.md` Tooling section (lines 74–76): "sechs Agents" → nine. Add table rows for `planner` (sonnet), `data-reader` (haiku), `data-writer` (haiku), one-line purpose each, matching the existing table style. Keep the note that these agents read only the root `CLAUDE.md`, with `shell-*` also reading `docs/specs/SPECS-infrastructure.md`.
- [ ] R4.7 — `docs/SUBAGENTS.md`, "Domänengebunden oder allgemein?": leave the "18 Agents" line (line 89) as is. Update line 90 from "6 Tooling-Agents" to 9 and extend the name list to `planner`, `python-*`, `shell-*`, `skill-*`, `data-*`.
- [ ] R4.12 — no functional code changes.

**Acceptance criteria:** Success Criteria 9, 10 (the `docs/SUBAGENTS.md` half).

### 5. Stale docs — `README.MD` and both welcome docs (R4.8–R4.11)
**Agent:** ba-writer
**Model:** haiku — mechanical find-and-replace; every target line and its replacement is known, including the anchor

Root-level user docs have no owning agent in the FILE PATH → AGENT MAP. `ba-writer` is the nearest match: it writes business-facing documentation, and these files are the reader-facing project docs.

- [ ] R4.8 — `README.MD` line 32: replace the link `[Auf die \`solution-jfs-2026\`-Branch wechseln](https://github.com/atra-consulting/coding-with-ai-lab/blob/solution-jfs-2026/README.MD)` with an in-page link to the existing section. Anchor verified in this README at line 52: `#für-konferenz-zuhörer-skills--subagents-übernehmen`. Section heading exists at line 145. Create no new section.
- [ ] R4.9 — `README.MD`, 24 → 27 Subagents in three places: lines 149, 154, 248.
- [ ] R4.9 — `README.MD`, 4 → 7 Skills in three places: lines 149, 155, 249. Verified: `.claude/skills/` holds 7 top-level folders.
- [ ] R4.10 — `README.MD` lines 86–87: clone `https://github.com/ksilz/coding-with-ai-demo.git`, then `cd coding-with-ai-demo`. Separate line from R4.8.
- [ ] R4.11 — `docs/welcome_DE.MD` lines 28–29 and `docs/welcome_EN.MD` lines 28–29: same clone URL and `cd` line. Change nothing else in those two files.
- [ ] Keep every edit an in-place text substitution. Add no lines, delete no lines. Group 8 edits `README.MD` line 139 and relies on the line count staying the same.
- [ ] After the edits, confirm `README.MD` contains no occurrence of `coding-with-ai-lab`.
- [ ] Leave `/simplify` under "Nützliche Befehle" alone (OQ2 default). Leave `docs/TRANSFER.md`, `docs/specs/SPECS-infrastructure.md`, and `docs/specs/SPEC-API-TASKS.md` alone (OQ5).
- [ ] R4.12 — no functional code changes.

**Acceptance criteria:** Success Criteria 10 (the `README.MD` half), 11, 12, 13.

### 6. Ticket read endpoints — backend (R5.1–R5.10a)
**Agent:** be-coder
**Model:** opus — **security-relevant**: `requireAgentTokenOrAdminSession` is load-bearing for seven write routes (R5.10a). A change to its admin test silently opens writes to every logged-in user.

- [ ] **R5.10a, do this first and never break it** — do **not** relax the admin check inside `requireAgentTokenOrAdminSession` (`backend/src/middleware/agentAuth.ts`, lines 103–116). Add a **separate, additive** middleware beside it. Only `GET /board` and `GET /:id` use the new one. The existing guard keeps gating the seven writes unchanged.
- [ ] Add the new middleware to `backend/src/middleware/agentAuth.ts`, following the file's own conventions: same loopback-bypass block gated on `configuredToken`, same forwarding-header refusal, same wrong-token-rejects-outright behavior. Difference: the session branch accepts any user found by `findById(req.session.userId)` and sets `req.currentUser`, instead of requiring the `ADMIN` role. No session at all → `UnauthorizedError`. R5.10 — do not copy the lab repo's names.
- [ ] **Duplication is intentional.** The new middleware repeats the loopback-bypass and token-check logic instead of extracting a shared helper. That is a deliberate trade-off: refactoring the shared parts would touch `requireAgentTokenOrAdminSession`, the already-tested guard on seven write routes, for zero functional gain. Say so in a short comment above the new function so a future reviewer reads it as a choice, not an oversight.
- [ ] R5.3 — `GET /api/tickets/board` (`backend/src/routes/tickets.ts` line 88): swap `requireAgentTokenOrAdminSession` for the new middleware. Keep agent token and loopback bypass working.
- [ ] R5.4 — `GET /api/tickets/:id` (line 172): same swap.
- [ ] R5.1 — `GET /api/tickets` (line 118): drop `requireRole('ADMIN')`, keep `requireAuth`. Any logged-in role gets 200.
- [ ] R5.2 — `GET /api/tickets/summary` (line 97): same change.
- [ ] R5.5 — no session at all still returns 401 on all four, except where the loopback bypass or agent token applies today.
- [ ] **R5.6 negative check** — `GET /api/tickets/next` (line 62) keeps `requireAgentToken`. Keep the CSRF comment at lines 57–61 verbatim.
- [ ] **R5.7 negative check** — these seven keep `requireAgentTokenOrAdminSession` with its unchanged admin-only session path: `POST /` (line 159), `PATCH /:id/status` (184), `PATCH /:id/owner` (197), `POST /:id/start` (210), `POST /:id/done` (222), `POST /:id/ask` (235), `POST /:id/comments` (271).
- [ ] **R5.8 negative check** — these keep `requireAuth` + `requireRole('ADMIN')`: `POST /:id/wont-do` (246), `POST /:id/hand-to-ai` (258), `POST /reset` (107).
- [ ] R5.9 — a non-admin session on any write endpoint gets 403. Not 200, not a silent no-op.
- [ ] Update the route comments above `/board` and `/:id` to describe the new rule.

**Acceptance criteria:** Success Criteria 16, 17, 18 (the backend half). A reviewer can point at the diff and see that the shared guard's admin test is untouched.

### 7. Ticket board and detail — frontend (R5.11–R5.18)
**Agent:** fe-coder
**Model:** sonnet — one route file, one nav array, two components' conditional rendering; the pattern already exists in `sidebar.component.ts`

- [ ] R5.17 — read the role the way the sidebar does: `private authService = inject(AuthService)`, then `this.authService.currentUser()?.rollen.includes('ROLE_ADMIN')`. Expose one member per component (e.g. an `isAdmin` computed or a `hasRole` method). Do not add a shared helper service.
- [ ] R5.11 — `frontend/src/app/features/admin/admin.routes.ts`: drop `canActivate: [roleGuard('ROLE_ADMIN')]` from `tickets` (lines 27–32) and `tickets/:id` (33–38). The parent `''` route in `app.routes.ts` (line 27) still carries `authGuard`, so anonymous users still bounce.
- [ ] **R5.12 negative check** — `agent-tasks`, `agent-tasks/:id`, and `cron` keep `roleGuard('ROLE_ADMIN')`.
- [ ] R5.13 — `frontend/src/app/layout/sidebar/sidebar.component.ts`: remove `requiredRole: 'ROLE_ADMIN'` from the "Tickets" item (lines 91–96). "App-Feedback" and "Cron-Jobs" keep theirs. Leave the item inside the "Administration" section (OQ3 default).
- [ ] R5.14 — `ticket-board.component.ts`: hide the "Neues Ticket" button (lines 56–58) for non-admins.
- [ ] R5.14 — hide the drag handle `div.ticket-drag-handle` on all five card locations (lines 218, 261, 304, 347, 390).
- [ ] **R5.14, the OR condition** — `[cdkDragDisabled]` currently reads `recentOnly` at all five card locations (lines 217, 260, 303, 346, 389). OR the new non-admin condition **with** it. Do not replace it. Each reason must disable dragging on its own.
- [ ] R5.14 negative check — columns, KPI tiles, badges, comment counts, and the "Kürzlich geändert" filter stay visible and working for non-admins. Cards stay clickable and still navigate to the detail page.
- [ ] R5.15 — `ticket-detail.component.ts`: hide the comment form block for non-admins (lines 107–156: "Kommentar hinzufügen", "Kommentar senden", "Zurück an KI"). The comment thread above it (lines 80–105) stays.
- [ ] **R5.15, one container** — hide the whole right-hand `col-12 col-lg-4` panel (lines 160–261). That includes the read-only "Info" block nested inside it (lines 239–259: ID, Status, Eigentümer, Typ, Lösung, and the `agentTaskId` App-Feedback cross-link). Do not keep the Info block behind. The cross-link target `/admin/agent-tasks/:id` is admin-gated anyway.
- [ ] **R5.15, widen the left column** — when the panel is hidden, the left column (line 42) changes from `col-12 col-lg-8` to full width. Otherwise non-admins stare at an empty third of the page on large screens.
- [ ] R5.16 — admins see zero change on both screens.
- [ ] R5.18 — hiding UI is convenience only. Add no client-side authority claims.
- [ ] German UI strings stay German. Existing tone and wording stay.

**Acceptance criteria:** Success Criteria 14, 15, 18 (the frontend half).

### 8. Ticket access docs (R5.19–R5.21)
**Agent:** ba-writer
**Model:** sonnet — six files must stay consistent with each other and with the new middleware name

- [ ] R5.19 — `docs/specs/SPEC-API-TICKETS.md`, "Authentication" overview: line 113 (Admin session), line 117 (Admin-only list — `GET /` and `GET /summary` move out), line 121 (the agent-token-or-admin list — `GET /:id` and `GET /board` move out into a new "any authenticated session" bucket). Every write endpoint still says ADMIN. `GET /next` still says agent token or loopback only.
- [ ] **R5.19, same file, per-endpoint sections — do not stop at the overview.** Four endpoint sections below the overview still describe the old rule and go factually wrong the moment the overview changes. Update all of them, plus the "Three schemes" summary sentence (currently line 80). Per endpoint, three spots each — heading/subtitle, the `**Auth:**` line, and the response-code table row:
  - `GET /api/tickets` — heading (194, "— paginated list (admin)"), Auth line (195), table row (217, `401` / `403` | not logged in / not admin).
  - `GET /api/tickets/board` — heading (221), Auth line (222), table rows (241–242, the `403` "logged in but not admin" row).
  - `GET /api/tickets/summary` — heading (246, "(admin)"), Auth line (247), table row (263).
  - `GET /api/tickets/:id` — heading (267), Auth line (268), table row (276, "not authenticated / not admin").
- [ ] **Re-locate before editing.** The line numbers above are current-state. Editing the Authentication section first shifts them. Find each section by its heading text, not by number.
- [ ] R5.19 acceptance — after the edit, a non-admin session reads as a 403 case **nowhere** in `SPEC-API-TICKETS.md` for those four GETs. Grep the file for `403` and check every remaining hit belongs to a write endpoint or `/reset`.
- [ ] R5.19 — `docs/specs/SPECS-backend.md`: Tickets route table rows for `/board` (line 158), `/summary` (159), `GET /api/tickets` (161), `GET /:id` (163). The middleware paragraph at line 274 lists nine Tickets endpoints under `requireAgentTokenOrAdminSession` — drop `GET /:id` and `GET /board` from that list and name the new additive read check beside it.
- [ ] R5.20 — `docs/TOOLS.md` line 54: the Ticket-Board entry no longer says "Zugang: Nur Admin (`admin` / `admin123`)". It says every logged-in user reads the board; only admins change it. Leave the Agent-Task entry at line 34 alone.
- [ ] R5.20 — `README.MD` line 139: the Tools table row for `/admin/tickets` says the same. Leave line 138 (Agent-Task-Dashboard) alone. Group 5 also edits this file — see Parallelism.
- [ ] R5.21 — `AGENTS.md`, Ticket System section: the "Drag-and-drop admin board at `/admin/tickets`" claim. State that admin rights gate the write endpoints and the drag-and-drop board actions, not reading the board.
- [ ] R5.21 — `CLAUDE.md`: change only if it repeats the claim. Check first.

**Acceptance criteria:** Success Criterion 20, all five bullets.

### 9. Test Implementation — backend Playwright
**Agent:** be-test-coder
**Model:** sonnet — known file, known patterns, one real gotcha about the header constant's scope

File: `backend/src/test/tickets.spec.ts`.

- [ ] Update the two now-wrong assertions: `GET /summary with USER role → 403` (line 435) and `GET / with USER role → 403` (line 462) both become 200.
- [ ] **Gotcha** — `NO_LOOPBACK_HEADERS` (`{ 'X-Forwarded-For': '10.0.0.1' }`) is declared at line 273 **inside a different `describe` block**. The "Auth matrix — admin endpoints" block (line 380) has no such constant. Hoist it to module scope or declare it locally. Without the header the loopback bypass masks every result.
- [ ] Add USER-session 200 tests with those headers, one assertion per endpoint: `GET /api/tickets`, `GET /board`, `GET /summary`, `GET /:id`.
- [ ] Add USER-session 403 tests with those headers for the representative writes: `POST /api/tickets`, `PATCH /:id/status`, `POST /:id/comments`, `POST /:id/wont-do`, `POST /:id/hand-to-ai`, `POST /api/tickets/reset`.
- [ ] Add an anonymous-with-headers 401 test for the four read endpoints (R5.5).
- [ ] **Add a wrong-agent-token → 401 test for `GET /api/tickets/:id`.** This case does not exist today. `GET /board` already has one (line 424, uses the `wrongToken` context from `wrongTokenCtx()`); `/:id` has no equivalent. Mirror the `/board` test. It proves a bad token still rejects outright and never falls through to the widened session check.
- [ ] Keep the existing agent-token, wrong-token, and anonymous cases green. Add new cases beside the admin-path assertions, never on top of them.
- [ ] Update the explanatory header comment (lines 34–51). Line 50–51 still calls summary and list admin-only.

**Depends on:** group 6. **Acceptance criteria:** Success Criteria 16, 17, 18, 19 (backend half).

### 10. Test Implementation — frontend Jasmine/Karma
**Agent:** fe-test-coder
**Model:** sonnet — four spec files, one real DI gotcha

- [ ] **Gotcha 1, missing provider** — `ticket-board.component.spec.ts` (`setupTestBed`, line 88) and `ticket-detail.component.spec.ts` (every `providers` array) do **not** provide `AuthService` today. Once the components inject it, each TestBed needs a mock. Reuse the sidebar pattern: `{ provide: AuthService, useValue: { currentUser: signal<BenutzerInfo | null>(...) } }` (see `sidebar.component.spec.ts` lines 34–54).
- [ ] **Refactor first, then add the mock.** `ticket-detail.component.spec.ts` has 17 separate inline `TestBed.configureTestingModule` blocks (confirmed by count). `ticket-board.component.spec.ts` centralizes setup in one `setupTestBed` helper plus one standalone block. Bring the detail spec to the board spec's convention — one shared `setupTestBed`-style helper — **before** adding the `AuthService` mock. Hand-editing 17 near-identical blocks risks missing one and shipping a test that crashes with "no provider for AuthService".
- [ ] **Gotcha 2, guards are not reference-equal** — `roleGuard()` (`frontend/src/app/core/guards/role.guard.ts`) is a factory. Every call returns a **new** closure. Two calls never compare equal. `expect(route.canActivate).toEqual([roleGuard('ROLE_ADMIN')])` can never pass. Assert behavior, not identity.
- [ ] New file `frontend/src/app/features/admin/admin.routes.spec.ts` — assert guard composition on the route table. Follow this repo's own pattern from `role.guard.spec.ts` (lines 53–58): pull the actual guard function out of the route's `canActivate` array and run it inside `TestBed.runInInjectionContext(...)` against a mocked `AuthService` signal. Assert the outcome: for `cron`, `agent-tasks`, and `agent-tasks/:id` a `ROLE_USER` user gets `false` plus a `/dashboard` navigation; for `tickets` and `tickets/:id` there is no `roleGuard` left to run (assert the array is empty or absent).
- [ ] `ticket-board.component.spec.ts` — admin sees the create button and the drag handles; non-admin sees neither, but still sees columns, cards, and KPI tiles.
- [ ] `ticket-board.component.spec.ts` — a non-admin card stays drag-disabled even when `recentOnly` is off. This is the R5.14 OR condition.
- [ ] `ticket-board.component.spec.ts` — **the other half of the OR**: admin with `recentOnly = true`, cards stay drag-disabled. Proves the old reason still works and was not replaced. Do not skip this one — it is the case that catches a replace-instead-of-OR mistake.
- [ ] `ticket-detail.component.spec.ts` — admin sees the comment form, the "Aktionen" panel, and the Info block.
- [ ] `ticket-detail.component.spec.ts` — non-admin sees none of those three, but still sees ticket data and the comment thread, in a full-width left column.
- [ ] `sidebar.component.spec.ts` — a USER now sees the "Tickets" entry and still does not see "App-Feedback" or "Cron-Jobs".
- [ ] Leave `role.guard.spec.ts` unchanged. Guard behavior does not change.
- [ ] Keep every existing admin-path assertion unmodified.

**Depends on:** group 7. **Acceptance criteria:** Success Criteria 14, 15, 18, 19 (frontend half).

### 11. Verification
**Agent:** be-test-runner and fe-test-runner
**Model:** haiku — run two suites, report pass/fail; no judgment needed

- [ ] `be-test-runner`: `cd backend && npm test`. Report pass/fail per suite.
- [ ] `fe-test-runner`: `cd frontend && npx ng test --watch=false`. Report pass/fail per spec.
- [ ] Report every failure with the spec name and the assertion text. Fix nothing.

**Acceptance criteria:** Success Criterion 19 — both suites pass.

**Manual checks that no runner covers.** List them as gaps in the final summary:
- Windows R1 checks (Success Criteria 1–4) — **cannot run in this environment.** No Windows machine, no Windows CI job (OQ6). Reviewable by diff only. Do not block the task on this.
- R2 checks (Success Criteria 5, 6) — rename `backend/.env` away, run each script, confirm one line and a recreated file; run again, confirm silence and no overwrite; then rename `backend/.env.example` away too and confirm one warning line, no abort, stack still starts. Restore both files afterwards.
- R3 checks (Success Criteria 7, 8) — no automated test. Read the step list of the next CI run.
- R5 UI checks (Success Criteria 14, 15) — log in as `user` / `test123`, then as `admin` / `admin123`, and walk both screens plus `/admin/cron`.

## Parallelism

- **Groups 1, 2, 3, 4, 5 run in parallel.** They touch disjoint files and depend on nothing. Groups 1 and 2 both touch `start.bat` — if one agent runs both, keep the R1 and R2 checklists distinct in the commit; if two agents run them, serialize 1 before 2 to avoid a merge conflict in that file.
- **Groups 5 and 8 both edit `README.MD`.** Group 5 touches lines 32, 86–87, 149, 154–155, 248–249 (branch link, clone command, agent/skill counts). Group 8 touches line 139 (the Tools-table ticket-board row). Different, non-adjacent lines, all in-place substitutions with no line-count change — so line 139 stays line 139. **Recommendation: no extra rule needed.** The wave order already serializes them: group 5 runs in the first wave, group 8 waits for group 6 and lands in the second. If they do somehow run at once, the overlap is a clean two-hunk merge, not a conflict. Group 5 must not add or delete lines — that is already in its checklist.
- **Group 6 (backend) and group 7 (frontend) run in parallel.** Recommended. The endpoint contract is already fixed in the PRD, so the frontend needs nothing from the backend at code time. The R5.10a risk lives entirely in `backend/src/middleware/agentAuth.ts` and `backend/src/routes/tickets.ts`; group 7 touches none of those files, so there is no merge overlap and no way for the frontend work to weaken the guard. The cost of waiting is real, the benefit is zero. Only the **manual** UI verification (Success Criteria 14, 15) needs both landed — that already sits in group 11.
- **Group 8 (R5 docs) waits for group 6.** `SPECS-backend.md` must name the new middleware, and that name does not exist until group 6 lands.
- **Group 9 waits for group 6. Group 10 waits for group 7.** Tests get written against the real implementation, not against a guess.
- **Group 11 waits for everything.**

## Tests

### Unit Tests
- [ ] `ticket-board.component.spec.ts` — admin: "Neues Ticket" button present. Non-admin: absent.
- [ ] `ticket-board.component.spec.ts` — admin: `.ticket-drag-handle` rendered on cards. Non-admin: not rendered.
- [ ] `ticket-board.component.spec.ts` — non-admin, `recentOnly = false`: cards still drag-disabled. Proves the OR, not a replace.
- [ ] `ticket-board.component.spec.ts` — admin, `recentOnly = true`: cards drag-disabled. Proves the old reason still works.
- [ ] `ticket-board.component.spec.ts` — non-admin: five columns, KPI tiles, badges, and comment counts all still render.
- [ ] `ticket-detail.component.spec.ts` — admin: comment form, "Aktionen" panel, and Info block all present.
- [ ] `ticket-detail.component.spec.ts` — non-admin: all three absent.
- [ ] `ticket-detail.component.spec.ts` — non-admin: ticket title, body, status, owner, and the full comment thread still render.
- [ ] `ticket-detail.component.spec.ts` — non-admin: left column carries the full-width class, not `col-lg-8`.
- [ ] `sidebar.component.spec.ts` — USER sees "Tickets"; USER does not see "App-Feedback" or "Cron-Jobs"; ADMIN sees all three.
- [ ] `admin.routes.spec.ts` (new) — `tickets` and `tickets/:id` have no `roleGuard` in `canActivate`; `cron`, `agent-tasks`, `agent-tasks/:id` still do. Assert by executing the guard, never by comparing closures.

### Integration Tests
- [ ] `GET /api/tickets` with USER session + `X-Forwarded-For` → 200.
- [ ] `GET /api/tickets/board` with USER session + `X-Forwarded-For` → 200.
- [ ] `GET /api/tickets/summary` with USER session + `X-Forwarded-For` → 200.
- [ ] `GET /api/tickets/:id` with USER session + `X-Forwarded-For` → 200.
- [ ] `POST /api/tickets` with USER session + `X-Forwarded-For` → 403.
- [ ] `PATCH /api/tickets/:id/status` with USER session + `X-Forwarded-For` → 403.
- [ ] `POST /api/tickets/:id/comments` with USER session + `X-Forwarded-For` → 403.
- [ ] `POST /api/tickets/:id/wont-do` with USER session + `X-Forwarded-For` → 403.
- [ ] `POST /api/tickets/:id/hand-to-ai` with USER session + `X-Forwarded-For` → 403.
- [ ] `POST /api/tickets/reset` with USER session + `X-Forwarded-For` → 403.
- [ ] Existing admin-session assertions across the whole ticket suite stay green and unmodified.
- [ ] Existing agent-token 200 cases on `/board` and `/:id` stay green.

### Edge Cases
- [ ] Anonymous + `X-Forwarded-For` on all four read endpoints → 401. The bypass must be off.
- [ ] Wrong agent token on `/board` and `/:id` → 401. A bad token never falls through to the session check. `/board` has this test today; `/:id` does not — group 9 adds it.
- [ ] `GET /api/tickets/next` with an ADMIN session + `X-Forwarded-For` → still rejected. The CSRF rule does not move.
- [ ] `GET /api/tickets/next` with the agent token → still 200 or 204.
- [ ] Non-admin with no `currentUser` (signal returns `null`) on board and detail: treated as non-admin, never as admin.

## Open Questions

- OQ1 — README's wrong clone URL gets fixed with the welcome docs (R4.10). PRD default taken. No blocker.
- OQ2 — `/simplify` under "Nützliche Befehle" stays. Out of scope. Logged as a future follow-up.
- OQ3 — "Tickets" stays inside the sidebar section "Administration", which now shows one item for non-admins. PRD default taken.
- OQ4 — the `AGENT_API_TOKEN` value mismatch between `docs/SKILLS.md` and `backend/.env.example` stays. R2 fixes the missing-file 401 only.
- OQ5 — lab-repo references in `docs/TRANSFER.md`, `docs/specs/SPECS-infrastructure.md`, and `docs/specs/SPEC-API-TASKS.md` stay untouched.
- **OQ6 — decided, not open. This plan adds no Windows CI.** No Windows machine and no Windows CI job exists here. Group 1's code gets written, reviewed, and committed; R1 is verified by code review and diff only. The live Windows run (Success Criteria 1–4) does not happen in this task and gets disclosed as a known gap in the final summary. That is the pragmatic call: a `windows-latest` job is its own piece of work with its own cost, and holding R1 hostage to it buys nothing. Listed here so the gap stays visible, not because an answer is pending.
- New, minor — the exact German wording of the R2 console lines and of the new middleware's name is left to the implementer. Both must follow the surrounding file's existing style.

---

**Grounding notes — files read to write this plan (all absolute):**
- `/Users/karsten/workspaces/fh/repos/coding-with-ai-demo/start.bat`, `/start.sh`, `/.github/workflows/deploy.yml`
- `/backend/src/middleware/agentAuth.ts`, `/backend/src/middleware/auth.ts`, `/backend/src/routes/tickets.ts`, `/backend/src/test/tickets.spec.ts`, `/backend/src/test/helpers.ts`, `/backend/.gitignore`
- `/frontend/src/app/features/admin/admin.routes.ts`, `/frontend/src/app/features/admin/tickets/ticket-board.component.ts`, `/ticket-detail.component.ts`, both `.spec.ts` files, `/frontend/src/app/layout/sidebar/sidebar.component.ts` + spec, `/frontend/src/app/core/guards/role.guard.ts` + spec, `/frontend/src/app/app.routes.ts`
- `/docs/SKILLS.md`, `/docs/SUBAGENTS.md`, `/README.MD`, `/docs/TOOLS.md`, `/docs/welcome_DE.MD`, `/docs/welcome_EN.MD`, `/docs/specs/SPECS-backend.md`, `/docs/specs/SPEC-API-TICKETS.md`, `/.claude/skills/update-claude-files/SKILL.md`

**Three PRD claims verified independently:** `.claude/agents/` holds exactly 27 files; `.claude/skills/` holds exactly 7 `SKILL.md` folders; `requireAgentTokenOrAdminSession` guards exactly the seven write routes plus `/board` and `/:id`, so R5.10a's warning is accurate.

**Four implementation traps the PRD does not name, all now in the plan:** `NO_LOOPBACK_HEADERS` is scoped to the wrong `describe` block in `tickets.spec.ts` (declared line 273, needed in the block starting line 380); neither ticket component spec provides `AuthService` today, and `ticket-detail.component.spec.ts` spreads its setup over 17 inline `TestBed` blocks; `roleGuard()` returns a fresh closure per call, so guard assertions must execute, not compare; `SPEC-API-TICKETS.md` repeats the old auth rule in four per-endpoint sections below the overview paragraph.
