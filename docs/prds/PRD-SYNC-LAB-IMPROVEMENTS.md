## Summary

### Business Summary
Five small fixes bring this training repo in line with its sibling lab project. The Windows start script becomes reliable, and both start scripts create the missing configuration file on a fresh clone, so new workshop participants get a working setup on the first try. Our build pipeline now always reports frontend test results, even when a backend step fails, so no broken test stays hidden. Finally, several documents that pointed at the wrong project get corrected, and the ticket board becomes readable for every logged-in user, while only administrators can still change anything.

### Technical Summary
Five independent changes. `start.bat` gets argument validation, a guarded Node version check, removal of a dead `better-sqlite3` rebuild block, and goto-based readiness loops instead of `for /l` with delayed expansion. `start.sh` and `start.bat` copy `backend/.env.example` to `backend/.env` when missing. The three frontend steps in the `test` job of `.github/workflows/deploy.yml` get `if: ${{ !cancelled() }}`. Doc-only fixes land in `docs/SKILLS.md`, `docs/SUBAGENTS.md`, `README.MD`, and both welcome docs. The ticket read endpoints (`GET /api/tickets`, `/board`, `/summary`, `/:id`) and the `/admin/tickets` routes open up to any authenticated session, while every write path stays ADMIN-only.

## Source

Ported from the sibling lab repo `/Users/karsten/workspaces/fh/repos/coding-with-ai-lab` (commit range 2026-09-01 to 2026-09-07). Reference commits, for context only — nothing gets copied verbatim:

| Item | Lab commit |
|------|-----------|
| 1 — `start.bat` robustness | `ab381b8` |
| 2 — `.env` bootstrap | `475f122` (start.sh), `9527f26` (start.bat) |
| 3 — CI frontend reporting | `7cb4b72` |
| 5 — Ticket board for all users | `f73135a`, plus test fixes `46fe461`, `38601ac` |

Scope is final and user-approved. Item 4 has no single reference commit — it fixes drift found in this repo.

## Problem Statement

**1. `start.bat` is fragile and carries dead weight.** It ignores arguments after the first one, so `start.bat --reset-db typo` starts anyway. That is a real bug today.

Three more spots need work, but for different reasons:

- **Node version guard is missing.** The parsing itself works for real `node --version` output. The gap is the missing guard: if `NODE_MAJOR` or `NODE_MINOR` ever end up empty or non-numeric, the `IF` comparison becomes malformed and the script silently continues instead of failing. That is the actual defect.
- **The `better-sqlite3` block is dead code.** It is not a broken check. `require('better-sqlite3')` does load on a real Windows machine — npm installs the package as a prebuilt optional peer pulled in transitively by `drizzle-orm`. The point is that the app never calls it. The backend uses `@libsql/client` and `drizzle-orm` only. So whether the check passes or fails makes no difference. It runs on every start, costs time, and can fire a pointless rebuild. The same check was already removed from `start.sh` during the Turso migration. `start.bat` never caught up.
- **The `for /l` readiness loops are a maintenance risk.** They work correctly today. Delayed expansion is used right, there is no mis-detection, and there is no added wait time. But `for /l` plus `!VAR!` is a known Windows-batch footgun: one later edit inside the loop body can break expansion in ways that are hard to spot. Converting to a goto-based counter is hardening, not a bug fix.

**2. A fresh clone has no `backend/.env`.** The file is gitignored (`backend/.gitignore`). `backend/.env.example` ships with the repo, but neither start script copies it. Without `AGENT_API_TOKEN`, `requireAgentToken` rejects every agent endpoint with 401 — even from localhost, because the token check runs before the loopback bypass. Workshop participants hit this on day one.

**3. CI hides frontend failures.** In `.github/workflows/deploy.yml`, job `test`, the three frontend steps have no `if:`. One failing backend step skips all of them. A broken frontend test then stays invisible until the backend is green again.

**4. Documentation points at the wrong things.** `docs/SKILLS.md` does not document `/plan-and-do` ticket mode, does not list `embedded` for `/review`, and does not mention `embedded base:<sha>` for `/update-claude-files`. `docs/SUBAGENTS.md` claims 24 agents and 6 tooling agents — the real numbers are 27 and 9. `README.MD` sends conference attendees to a branch in a different GitHub repo, carries a wrong `git clone` command of its own, and repeats the stale counts. Both welcome docs tell readers to clone the lab repo.

**5. The ticket board is admin-only.** Workshop participants log in as `user` and cannot see the board at all. They should be able to watch the human/AI workflow. They must not be able to change it.

## Requirements

### R1 — `start.bat` robustness

- R1.1 Reject every argument beyond a single optional `--reset-db`. Print the existing usage text, exit code 1. Today only the first argument is checked. This fixes a real bug.
- R1.2 Simplify the Node version parsing so it no longer depends on `delims=v` splitting. Today's parsing works for normal `node --version` output. Treat this as a simplification that comes bundled with the R1.3 guard, not as a fix for a current failure.
- R1.3 Add the missing guard: if the major or minor version comes out empty or non-numeric, print a clear error and exit 1. Never fall into the numeric comparison with an empty value. This is the real defect in the version block.
- R1.4 Remove the `better-sqlite3` load check and the `npm rebuild better-sqlite3` fallback. No replacement check. Reason: the app never requires that package at runtime — only `@libsql/client` and `drizzle-orm` are real dependencies. The check is dead code, whatever its result. `start.sh` already dropped it during the Turso migration.
- R1.5 Replace the backend readiness `for /l` loop with a goto-based loop: counter, one health-check attempt per second against `http://localhost:7070/api/health`, hard cap 60 tries. Leave the loop as soon as the check returns 200. Motivation is robustness and maintainability — today's loop works.
- R1.6 Replace the frontend readiness `for /l` loop the same way: counter, one port-listen check per second on port 7200, hard cap 120 tries. Same motivation as R1.5.
- R1.7 Keep timeouts (60s / 120s), the current error messages, the cleanup call on failure, the port pre-flight, the monitor loop, and the shutdown logic unchanged.
- R1.8 No behavior change on the success path: same console output, same ports, same startup order.

### R2 — Auto-create `backend/.env`

- R2.1 Both `start.sh` and `start.bat` check for `backend/.env` before they start the backend.
- R2.2 If `backend/.env` is missing and `backend/.env.example` exists, copy the example to `backend/.env` unchanged.
- R2.3 Print exactly one line when the copy happens. Name both files. Say the user can edit the new file.
- R2.4 If `backend/.env` already exists, do nothing and print nothing. Never overwrite, never merge.
- R2.5 If `backend/.env.example` is also missing, print one warning line and continue the startup. Do not abort — the CRM app itself works without it.
- R2.6 Both scripts behave the same way and print the same message text (translated only where the script already differs).
- R2.7 In `start.bat`, suppress the Windows `copy` command's own "1 file(s) copied." output — redirect it to nul. Unix `cp` is silent by nature. Without this, the batch version prints two lines where R2.3 and R2.6 allow exactly one.
- R2.8 In `start.sh`, write the exists-check-and-copy logic as an explicit `if` / `elif` / `else` block. Do not use a one-line `||` / `&&` shortcut. `start.sh` runs under `set -euo pipefail`; a bare `cp` failure inside a `||` chain would kill the whole script when `.env.example` is missing too, which breaks R2.5.

### R3 — CI reports frontend results on backend failure

- R3.1 Add `if: ${{ !cancelled() }}` to these three steps in job `test` of `.github/workflows/deploy.yml`: "Frontend — install dependencies", "Frontend — run unit tests (CI)", "Frontend — build".
- R3.2 Do not use `always()`. A cancelled run must still stop immediately.
- R3.3 Do not add any condition to the backend steps.
- R3.4 Do not change the `deploy` job. It keeps `needs: test`, so a failed `test` job still blocks deployment.

### R4 — Fix stale documentation (doc-only)

- R4.1 `docs/SKILLS.md`, `/plan-and-do` → **Argumente:** line — document ticket mode alongside free-text mode: a ticket URL (e.g. `http://localhost:7200/admin/tickets/8`) or a bare ticket number. State that `resume:<step>` applies to free-text mode only.
- R4.2 `docs/SKILLS.md`, `/review` → argument list — add `embedded`: used when `plan-and-do` calls the skill mid-run; skips header, plan check, and confirmation.
- R4.3 `docs/SKILLS.md`, `/update-claude-files` → argument line — document the `embedded base:<sha>` form, which scopes the run to one branch.
- R4.4 Do not edit any `.claude/skills/*/SKILL.md`. The skills are correct; only the docs describing them are wrong.
- R4.5 `docs/SUBAGENTS.md` — change the stated total from 24 to 27 agents.
- R4.6 `docs/SUBAGENTS.md`, Tooling section — change "sechs Agents" to nine and add table rows for `planner` (sonnet), `data-reader` (haiku), `data-writer` (haiku), with a one-line purpose each, matching the existing table style. Keep the note that these agents read only the root `CLAUDE.md`, with `shell-*` also reading `docs/specs/SPECS-infrastructure.md`.
- R4.7 `docs/SUBAGENTS.md`, "Domänengebunden oder allgemein?" — the "18 Agents" line is already correct and stays. Update the "6 Tooling-Agents" line to 9 and extend the name list (`planner`, `python-*`, `shell-*`, `skill-*`, `data-*`).
- R4.8 `README.MD` — replace the dead "Auf die `solution-jfs-2026`-Branch wechseln" link to `github.com/atra-consulting/coding-with-ai-lab` with an in-page link to the existing section "Für Konferenz-Zuhörer: Skills & Subagents übernehmen". That section exists in this README, so no new section is needed.
- R4.9 `README.MD` — correct every stale count: 24 Subagents → 27 (three places), 4 Skills → 7 (three places). Seven matches the seven top-level folders under `.claude/skills/`; internal reference files like `plan-and-do-setup.md` do not count.
- R4.10 `README.MD` — fix the `git clone` command. This is a separate line from the dead link in R4.8. Repo `https://github.com/ksilz/coding-with-ai-demo.git`, directory `coding-with-ai-demo`. See Open Question 1.
- R4.11 `docs/welcome_DE.MD` and `docs/welcome_EN.MD` — fix the same clone command and `cd` line. No other change to these files.
- R4.12 No functional code changes in R4.

### R5 — Ticket board readable by every logged-in user

**Backend — widen these four read endpoints to any authenticated session:**

- R5.1 `GET /api/tickets` (paginated list) — today `requireAuth` + `requireRole('ADMIN')`. Any logged-in role gets 200.
- R5.2 `GET /api/tickets/summary` — today `requireAuth` + `requireRole('ADMIN')`. Any logged-in role gets 200.
- R5.3 `GET /api/tickets/board` — today `requireAgentTokenOrAdminSession`. Keep agent token and loopback bypass. Widen the session path from ADMIN-only to any authenticated session.
- R5.4 `GET /api/tickets/:id` — same widening as R5.3.
- R5.5 No session at all still returns 401 on all four (loopback bypass and agent token excepted, where they apply today).

**Backend — these stay exactly as they are:**

- R5.6 `GET /api/tickets/next` — agent token or loopback only. It claims a ticket, so it must not accept a session cookie (CSRF on a simple GET).
- R5.7 Session path stays ADMIN-only for: `POST /api/tickets`, `PATCH /:id/status`, `PATCH /:id/owner`, `POST /:id/start`, `POST /:id/done`, `POST /:id/ask`, `POST /:id/comments`. Agent-token and loopback paths unchanged.
- R5.8 Unchanged and ADMIN-only: `POST /:id/wont-do`, `POST /:id/hand-to-ai`, `POST /api/tickets/reset`.
- R5.9 A non-admin session that calls any write endpoint gets 403, not 200 and not a silent no-op.
- R5.10 Follow this repo's own middleware conventions in `backend/src/middleware/auth.ts` and `agentAuth.ts`. Do not copy the lab repo's names.
- R5.10a **Do not weaken the shared guard in place.** `requireAgentTokenOrAdminSession` currently protects both the two GET routes we widen (`/board`, `/:id`) and the seven write routes in R5.7. Its admin-only session check must keep gating those seven writes, unchanged. Build the widening as a separate, additive check that only `/board` and `/:id` use. Editing the admin test inside the shared guard would silently open the writes too.

**Frontend:**

- R5.11 `frontend/src/app/features/admin/admin.routes.ts` — the `tickets` and `tickets/:id` routes drop `roleGuard('ROLE_ADMIN')`. The parent `authGuard` on the `''` route still applies, so anonymous users keep getting bounced.
- R5.12 The other admin routes (`agent-tasks`, `agent-tasks/:id`, `cron`) keep `roleGuard('ROLE_ADMIN')`.
- R5.13 Sidebar — the "Tickets" entry drops `requiredRole`, so every logged-in user sees it. All other admin entries keep their role gate.
- R5.14 Ticket board, non-admin — hide the "Neues Ticket" button, hide the drag handles, and disable drag-and-drop on every card. The new non-admin condition gets OR'd with the existing `recentOnly`-based disable condition at all five card locations. It does not replace it. Both reasons must still disable dragging on their own. Columns, KPI tiles, badges, comment counts, and the "Kürzlich geändert" filter stay visible and working. Cards stay clickable and navigate to the detail page.
- R5.15 Ticket detail, non-admin — hide the comment form ("Kommentar senden", "Zurück an KI") and the whole right-hand "Aktionen" panel. That includes the read-only "Info" block nested inside the same panel (ticket ID, status, owner, type, solution, and the `agentTaskId` / App-Feedback cross-link). It is one container structurally, and the cross-link target `/admin/agent-tasks/:id` is admin-gated anyway. When the panel is hidden, widen the left column from `col-12 col-lg-8` to full width, so non-admins do not stare at a dead empty gutter. Ticket fields, status, owner, and the full comment thread stay visible in the left column.
- R5.16 Admin users see no change at all on either screen.
- R5.17 The role check reads the current user from the existing auth service, the same way the sidebar does today.
- R5.18 Hiding UI is convenience only. The backend stays the authority — see R5.9 and R5.10a.

**Docs that must match the new behavior:**

- R5.19 Update the ticket auth statements in `docs/specs/SPEC-API-TICKETS.md` and the Tickets route table plus middleware paragraph in `docs/specs/SPECS-backend.md`.
- R5.20 Update `docs/TOOLS.md` (Ticket-Board "Zugang: Nur Admin") and the Tools table row in `README.MD`.
- R5.21 Update the ticket paragraphs in `AGENTS.md` and, if affected, `CLAUDE.md`.

## Special Instructions

- Do not touch `.claude/skills/do-semi-automatic/` — the skill stays.
- Do not touch `.claude/skills/plan-and-do/plan-and-do-modes.md` or `.claude/prompts/agent-github-refinement.md`, even though both still reference the lab repo.
- Nothing about the feedback-form app, Apps Script webhooks, CSV export, or an "Agent Factory" track. This repo has none of these.
- No rewrite of the welcome docs. Only the clone command changes there.
- The five items are independent. They can land in any order, or in parallel.

### Open Questions

1. `README.MD` also carries the wrong clone URL (`atra-consulting/coding-with-ai-lab`). Found during verification, not in the listed scope. R4.10 assumes we fix it together with the welcome docs — confirm.
2. `README.MD` lists `/simplify` under "Nützliche Befehle". No such skill exists in `.claude/skills/`. **Default: leave it.** Out of scope for this task. Logged here as a known follow-up for a future task.
3. After R5.13 the "Tickets" entry stays inside the sidebar section "Administration", which then shows for every user with a single item. **Default: leave as-is.** That is the smallest change and matches the "five independent items, minimal footprint" instruction. Revisit later if it reads oddly in practice.
4. `docs/SKILLS.md` says `backend/.env` must contain `AGENT_API_TOKEN=test-secret-123` "genau so". The `.env.example` placeholder value differs, so the auto-copy in R2 produces a different token. **Default: leave both as they are.** This is a pre-existing doc-versus-`.env.example` mismatch. R2 fixes the *missing-file* 401 only, not token-value alignment for headless skills. Out of scope for this task.
5. Other lab-repo references exist in `docs/TRANSFER.md`, `docs/specs/SPECS-infrastructure.md`, and `docs/specs/SPEC-API-TASKS.md` (`GH_DISPATCH_REPO` default). Confirmed out of scope — they stay untouched.
6. **Windows CI for R1.** This repo has no Windows CI job at all today, so every R1 check is manual on someone's Windows machine. Proposal: add a one-off `windows-latest` GitHub Actions job that runs the `start.bat` argument, version-guard, and failure-path scenarios. Add it, or verify R1 by hand this once and skip the CI job? Decision needed before the R1 verification step.

## Implementation Approach (high-level, no code)

**Item 1** — Edit `start.bat` only. Argument check first, then version parsing with its new guard, then delete the dead native-rebuild block, then convert both wait loops to label-and-counter form. Keep `setlocal enabledelayedexpansion` if other parts still need it; the new loops must not depend on it.

**Item 2** — Add a small bootstrap block to both start scripts, placed before the backend starts and after the prerequisite checks. Existence check, copy, one message. Each script uses its platform's native copy. Batch silences the copy output; shell uses a full `if` / `elif` / `else` because of `set -euo pipefail`.

**Item 3** — One-line addition to three steps in `deploy.yml`. No other change.

**Item 4** — Pure Markdown edits across five files. Read the current wording first and change only the wrong parts; keep tone and structure. Counts come from the real files: 27 agent files in `.claude/agents/`, 9 of them tooling (`planner`, `python-*`, `shell-*`, `skill-*`, `data-*`), 18 domain-bound, 7 skill folders in `.claude/skills/`.

**Item 5** — Backend first: add a session variant that accepts any authenticated user, and wire it to the four GET endpoints only. Leave the existing admin check in the shared guard alone. Then the frontend: route guards, sidebar entry, and role-conditional rendering in the board and detail components. Then the docs. Backend and frontend can proceed in parallel once the endpoint list is agreed; the backend test updates depend on the backend change.

## Test Strategy

**Backend (Playwright, `backend/src/test/tickets.spec.ts`)**

- Update the two now-wrong assertions: `GET /summary with USER role → 403` and `GET / with USER role → 403` both become 200.
- Add USER-session tests for all four read endpoints that run with proxy-forwarding headers, so the loopback bypass is off and the session path is actually exercised. Without those headers the local bypass masks the result.
- Add USER-session negative tests with the same headers for representative writes: create, status change, comment, `wont-do`, `hand-to-ai`, `reset`. Expect 403.
- Keep the existing agent-token, wrong-token, and anonymous cases green.
- Update the explanatory header comment in that spec file — it still describes summary and list as admin-only.

**Frontend (Jasmine/Karma)**

- `ticket-board.component.spec.ts` — admin sees the create button and drag handles; non-admin sees neither, but still sees columns, cards, and KPI tiles. Cover that a non-admin card stays drag-disabled even when `recentOnly` is off.
- `ticket-detail.component.spec.ts` — admin sees the comment form, the action panel, and the Info block; non-admin sees none of the three, but still sees ticket data and the comment thread in a full-width left column.
- A sidebar test that a USER now sees the "Tickets" entry and still does not see the other admin entries.
- A route-guard test in a new `frontend/src/app/features/admin/admin.routes.spec.ts`. Assert the guard composition on the route table: `tickets` and `tickets/:id` carry `authGuard` only, `cron` and the `agent-tasks` routes still carry `roleGuard('ROLE_ADMIN')`. The existing `role.guard.spec.ts` tests the guard factory itself, not route configs — it needs no change, since guard behavior does not change.

**Manual / scripted checks**

- Item 1 needs Windows checks: run `start.bat`, `start.bat --reset-db`, and `start.bat --reset-db extra`. Then a run where the backend never comes up. Then a run on a machine with a too-old Node. Then a run where the version string cannot be parsed — confirm the new guard fires and the script exits 1 instead of continuing. See Open Question 6 on how to get a Windows environment for this.
- Item 2: rename `backend/.env` away, run each start script, confirm the file reappears with the example content and exactly one console line. Run again, confirm no message and no overwrite.
- Item 2, R2.5 path: rename both `backend/.env` and `backend/.env.example` away. Run each start script. Confirm exactly one warning line, confirm the script keeps going, and confirm the stack still comes up. Neither script may abort. Restore both files afterwards.
- Item 3: no automated test. Verify on the next CI run with a deliberately failing backend step, or by reading the workflow run's step list.
- Item 5: log in as `user` / `test123`. Confirm the sidebar shows "Tickets". Open `/admin/tickets` — full board, KPI tiles, no create button, no drag handles, dragging does nothing. Click a card — detail page renders with the comment thread, no comment form, no action panel, no Info block, left column full width. Open `/admin/cron` — still redirected to the dashboard. Then log in as `admin` and confirm both screens look and behave exactly as before.

**Suites to run:** `cd backend && npm test` and `cd frontend && npx ng test --watch=false`.

## Non-Functional Requirements

- No new runtime dependencies anywhere.
- Start scripts stay dependency-free: no Node, Python, or PowerShell helper for the `.env` copy.
- `start.bat` keeps working on Windows 10 and 11 with the default `cmd.exe`.
- `backend/.env` must never be committed. `backend/.gitignore` already covers it — confirm it still does after the change.
- Item 5 widens read access only. No endpoint may become writable for a non-admin, and no unauthenticated access may appear.
- The ticket seed and fixture data shipped with this repo holds no personal or sensitive data, so read access for all logged-in users carries no data-protection risk today. This is a property of the shipped data, not a general guarantee: ticket bodies and comments are freeform text, and nothing stops someone from typing sensitive content later.
- German UI strings stay German; existing tone and wording stay.
- No performance impact expected; the widened endpoints are unchanged queries.

## Success Criteria

1. `start.bat --reset-db extra` prints usage and exits 1. `start.bat` and `start.bat --reset-db` still start the full stack.
2. `start.bat` contains no reference to `better-sqlite3` and no `for /l` readiness loop. Both waits use a counter with a hard cap of 60 and 120 tries, and exit as soon as the service answers.
3. A `start.bat` run on a machine with a too-old Node prints the version error and exits 1. A run where the version string cannot be parsed prints the new guard error and exits 1 — it never reaches the numeric comparison.
4. When the backend never becomes healthy, `start.bat` still calls its cleanup routine, prints the same error text as today, and exits with a non-zero code. On the success path the console output, ports, and startup order are byte-for-byte what they are today.
5. On a clone without `backend/.env`, both `./start.sh` and `start.bat` create the file from `backend/.env.example`, print exactly one line about it, and the agent endpoints answer instead of 401. A second run prints nothing new and leaves the file untouched.
6. With both `backend/.env` and `backend/.env.example` missing, both scripts print exactly one warning line, do not abort, and start the stack anyway.
7. In a CI run where a backend step fails, the frontend install, unit-test, and build steps all execute and their results appear in the run summary. The `test` job is still red and the `deploy` job does not run.
8. In a cancelled CI run, the frontend steps do not execute.
9. `docs/SKILLS.md` documents `/plan-and-do` ticket mode, the free-text-only scope of `resume:<step>`, `/review embedded`, and `/update-claude-files embedded base:<sha>`. No `SKILL.md` file changed.
10. `docs/SUBAGENTS.md` states 27 agents, lists 9 tooling agents including `planner`, `data-reader`, and `data-writer`, and keeps 18 domain-bound. `README.MD` says 27 Subagents and 7 Skills everywhere.
11. `README.MD` has no link to `coding-with-ai-lab` anywhere, and the conference-attendee line points at the in-page section "Für Konferenz-Zuhörer: Skills & Subagents übernehmen".
12. `README.MD`'s own `git clone` line — a separate line from criterion 11 — clones `https://github.com/ksilz/coding-with-ai-demo.git` and `cd`s into `coding-with-ai-demo`.
13. `docs/welcome_DE.MD` and `docs/welcome_EN.MD` both clone `ksilz/coding-with-ai-demo` with the matching `cd` line. Nothing else in those two files changed.
14. Logged in as `user` / `test123`: the sidebar shows "Tickets", `/admin/tickets` renders the full board with KPI tiles, a ticket detail page renders with its comment thread in a full-width column, and `/admin/cron` still redirects to the dashboard.
15. As `user`: no create button, no drag handles, no comment form, no action panel, no Info block. Drag-and-drop does nothing.
16. As `user`, with the loopback bypass disabled: `GET /api/tickets`, `/board`, `/summary`, and `/:id` each return 200. Verified independently, one assertion per endpoint.
17. As `user`, with the loopback bypass disabled: `POST /api/tickets`, `PATCH /:id/status`, `POST /:id/comments`, `POST /:id/wont-do`, `POST /:id/hand-to-ai`, and `POST /api/tickets/reset` each return 403. Verified independently of criterion 16 — passing the 403 half does not prove the 200 half.
18. Every pre-existing admin-session assertion in `backend/src/test/tickets.spec.ts` stays green, and its admin-path expectations stay unmodified. Same for the admin-path assertions in `ticket-board.component.spec.ts` and `ticket-detail.component.spec.ts`. New non-admin cases get added beside them, not on top of them.
19. `cd backend && npm test` and `cd frontend && npx ng test --watch=false` both pass.
20. The five docs from R5.19–R5.21 match the new rules:
    - `docs/specs/SPEC-API-TICKETS.md` — the auth entries for `GET /api/tickets`, `/summary`, `/board`, and `/:id` name any authenticated session instead of ADMIN. Every write endpoint still says ADMIN. `GET /next` still says agent token or loopback only.
    - `docs/specs/SPECS-backend.md` — the Tickets route table shows the same four reads as open to any authenticated session, and the middleware paragraph names the new additive read check alongside `requireAgentTokenOrAdminSession`.
    - `docs/TOOLS.md` — the Ticket-Board entry no longer says "Zugang: Nur Admin". It says every logged-in user reads the board; only admins change it.
    - `README.MD` — the Tools table row for the ticket board says the same.
    - `AGENTS.md` — the ticket paragraph no longer calls the board and detail admin-only. It states that admin rights gate the write endpoints and the drag-and-drop board actions. `CLAUDE.md` gets the same treatment only if it repeats the claim.

## Technical Notes

- **Loopback bypass hides auth locally.** With `AGENT_AUTH_ALLOW_LOOPBACK=1` in `backend/.env`, local requests without auth headers skip the check entirely — for reads and writes alike. Any test that claims to prove an access rule must send a proxy-forwarding header to switch the bypass off. The existing spec file already has a constant for this pattern.
- **Two different guards protect the ticket reads today.** List and summary use `requireAuth` + `requireRole('ADMIN')`. Board and single ticket use `requireAgentTokenOrAdminSession`. The widening therefore touches two mechanisms, not one.
- **The shared guard is load-bearing.** `requireAgentTokenOrAdminSession` also protects the seven write routes in R5.7. Relaxing its admin check in place would open those writes to every logged-in user. See R5.10a — the widening must be additive and scoped to `/board` and `/:id`.
- **`GET /api/tickets/next` mutates state.** It claims a ticket. It must keep rejecting session cookies, because a `SameSite=Lax` cookie rides cross-site top-level GET navigations. The existing code comments spell this out — keep them.
- **`!cancelled()` versus `always()`.** `!cancelled()` runs the step on success and on failure, but not when the run is cancelled. `always()` would also run on cancellation and waste runner time.
- **`better-sqlite3` is dead code, not a broken check.** `require('better-sqlite3')` does succeed on a real Windows machine — npm installs it as a prebuilt optional peer of `drizzle-orm`. But `backend/package.json` declares only `@libsql/client`, and no application code ever requires it. So the check's result is irrelevant either way. `start.sh` dropped the same block during the Turso migration; `start.bat` still carries it.
- **Today's `for /l` loops work.** Delayed expansion is applied correctly, the health check does not mis-detect, and no extra wait time accrues. R1.5 and R1.6 harden a fragile batch idiom for future edits. They are not repairs.
- **Frontend role checks have no shared helper yet.** `AuthService` exposes `currentUser` and `isAuthenticated`; the sidebar implements its own `hasRole`. The implementer can reuse that pattern or add a shared computed — a plan-level decision.
- **Ticket detail layout.** The left content column is `col-12 col-lg-8`; the "Aktionen" panel sits in a sibling `col-12 col-lg-4` and contains the Info block. Hiding the sibling without widening the left column leaves a third of the page empty on large screens.
