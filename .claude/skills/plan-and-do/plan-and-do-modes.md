# Plan and Do — Special Modes & Resume Router

Reference file for plan-and-do skill. Read and execute the matching section when help or doctor mode is detected, or when resuming from a specific step.

**All user prompts in this file MUST call the `AskUserQuestion` tool** — no prose prompts, no stdin reads, no "soft" wait-for-next-message. See SKILL.md → "HOW TO ASK THE USER FOR DECISIONS" for the full rule.

---

## HELP MODE

Execute when `$ARGUMENTS` contains "help". Display and STOP:

```
Plan and Do Skill - Help

Purpose: End-to-end implementation workflow from idea to code review

Usage:
  /plan-and-do "description of work"        # Freeform task
  /plan-and-do                               # Interactive (asks what to do)
  /plan-and-do <input> "<special-instructions>"
  /plan-and-do <input> resume:<step>
  /plan-and-do help
  /plan-and-do doctor

Input Modes:
  Freeform:       "Add Redis caching"                         -> REDIS-CACHING
  Empty:          (scans for resumable tasks, then asks)      -> USER-CHOSEN-NAME

File Naming:
  All files use the task_key (derived from description):
  - PRD-[task_key].md
  - PLAN-[task_key].md
  - STATE-[task_key].json
  - REVIEW-[task_key].md

Examples:
  /plan-and-do "Add Redis caching for sessions"
  /plan-and-do "Add Redis caching" "Use node-cache with 5 min TTL"
  /plan-and-do "Fix login button" resume:10

Prerequisites:
  - git command available (optional — non-git mode skips branches, commits, and PRs)
  - Working in a git repository (optional — skill runs in non-git mode when not detected)
  - Test execution capability (required)

Features:
  - Freeform mode: accepts any task description
  - Agent discovery: uses project agents if defined in CLAUDE.md
  - Pulls latest before branching; keep-or-create when on a feature branch
  - Optionally generates specifications (PRD); can pivot to "Create PRD first" at plan approval
  - Creates detailed plan with test cases
  - Implements code changes with tests
  - Runs automated tests (with auto-fix capability)
  - Performs local code review using /review
  - Checkpoint persistence (quit/resume at any checkpoint)
  - Detects an existing PR early; auto-derives PR prefix (feat/fix/chore) from commits
  - PR creation/update and merge workflow
  - Config file (claude.atra.json): set standing keep/delete preferences for the PRD, plan, review, and state files, and whether Markdown artifacts auto-open in your default app (openMd)
  - Model-tier delegation: dispatches work to haiku/sonnet/opus by difficulty, with verification and escalation

Agent Support:
  If the project CLAUDE.md defines an ## Agents section:
  - Coding agents (be-coder, fe-coder, db-coder, ui-designer) implement tasks
  - Reviewer agents (be-reviewer, fe-reviewer, db-reviewer, ui-reviewer) review code
  - Independent agents launch in parallel for speed
  - Planner agents (name ends -planner, or is exactly planner) draft the PRD and the plan. Optional.
  If no agents defined: skill does all work directly (original behavior)

Delegation:
  Three worker tiers. Every agent dispatch names one:
  - haiku: mechanical work. Renames, boilerplate, spelled-out diffs, repetitive edits.
  - sonnet: standard, well-specified coding. One endpoint, a bug fix with a known cause.
  - opus: hard slices. Cross-cutting changes, unknown-cause debugging, security- or architecture-sensitive work.
  Rule: pick the lowest tier that can plausibly succeed.
  Implementation slices default to sonnet — opus needs a named trigger, never a hunch.
  Agent picks the domain. Model picks the difficulty. The model parameter beats the agent's frontmatter model.
  Verification: every coding slice gets checked — diff read or delegated review.
  Tests never run per slice. They run once after a parallel group, and at Step 9.
  Escalation: two attempts per tier, then one tier up.
  Full rules: plan-and-do-delegation.md

  Planner agent (optional): name ends -planner, or is exactly planner.
  When present, it drafts the PRD (Step 6.2) and the whole plan (Step 7.3).
  Step-by-step creation guide with a copy-paste agent file: plan-and-do-delegation.md

File Locations:
  - Specifications (PRD) files: [docs]/prds/PRD-[task_key].md
  - Detailed plan files: [docs]/plans/PLAN-[task_key].md
  - State files: [docs]/state/STATE-[task_key].json
  - Review files: [docs]/reviews/REVIEW-*.md
  - Uses existing 'doc' or 'docs' folder, or creates 'docs' if neither exists
  - All files committed to git automatically
  - Planning files kept by default (option to delete)
  - Planning files: keep/delete controlled by claude.atra.json's `planAndDo.keepFiles` (global ~/.claude/claude.atra.json + local ./claude.atra.json, local overrides global; legacy flat-format files with top-level `keepFiles` still work); falls back to a one-time prompt at plan approval for any file set to "ask"
  - Markdown auto-open: controlled by `planAndDo.openMd` in the same claude.atra.json (always/never/ask; legacy flat-format files use top-level `openMd`); "ask" prompts once, before Step 4

Workflow Steps:
  1-3. Setup (checkpoint, tools, docs folder)
  4. Task Analysis & Branch Setup
  5. Specifications (PRD) Decision
  6. Specifications (PRD) Creation (optional)
  7. Detailed Plan (with test cases)
  8. Implementation
  9. Testing (with auto-fix)
  10. Code Review (local, via /review)
  11. Post-Review Testing
  12. Documentation Updates
  13. Summary, PR Creation, Merge

Resume Capability:
  Automatic state persistence (JSON):
  - Quit at any checkpoint with (Q)uit option
  - Progress saved to [docs]/state/STATE-[task_key].json
  - All runtime variables persisted (agents, test command, etc.)
  - Restart with same input to resume from last checkpoint
  - Choose (R)esume, (S)tart fresh, or (Q)uit

  No-argument scan:
  - Running /plan-and-do with no arguments scans for paused
    or in-progress state files
  - Shows numbered list of resumable tasks
  - Option to start a new task instead

  Manual resume (skip to specific step):
  - resume:10 - Skip to Step 10 (Code Review)
  - resume:11 - Skip to Step 11 (Post-Review Testing)
  - resume:12 - Skip to Step 12 (Documentation Updates)
  - resume:13 - Skip to Step 13 (Summary)
  - Validates required artifacts exist before resuming
  - Use for testing fixes or recovering from failures

Integrations:
  - git (required): Branch management, commits
  - gh CLI (optional): PR creation and merge
  - review (required): Code review
  - Task tool (optional): Agent delegation

Success Criteria:
  - Branch always created when git available (original branch stays clean)
  - State file tracks progress; committed at init, pause, and completion only
  - PRD created or explicitly skipped
  - Detailed plan created with test cases
  - Implementation matches plan; tests pass
  - Code review via /project:review completed
  - No uncommitted changes when skill finishes
  - Agents used when available (fallback to direct mode)
  - Every agent dispatch names an explicit model
  - No fix path writes files directly while coding agents exist
  - Each coding slice verified, and escalated per the ladder when it fails
```

---

## DOCTOR MODE

Execute when `$ARGUMENTS` contains "doctor". Perform health checks and STOP:

1. Tool Check using Bash:
   ```
   Checking required tools...
   ```
   - Check git: `git --version`
     - If found: Report version
     - If not found: Report "git not installed (CRITICAL)"
   - Check gh: `gh --version`
     - If found: Report version
     - If not found: Report "gh CLI not installed (optional, needed for PR creation)"

2. Repository Check using git:
   ```
   Checking git repository...
   ```
   - Check if in git repository: `git rev-parse --git-dir`
     - If in repo: Report "In git repository"
     - If not in repo: Report "Not in a git repository (CRITICAL)"
   - Check current branch: `git branch --show-current`
     - If successful: Report current branch name
     - If on main/master: Report "Currently on main branch (should be on feature branch)"
     - If failed: Report "Cannot determine current branch"

3. ATRA Config Check:
   ```
   Checking claude.atra.json config...
   ```
   - Look for both files: global `~/.claude/claude.atra.json`, local `./claude.atra.json`.
     - Validate JSON. Malformed → Report "Warning: [path] is not valid JSON. Ignoring."
     - Detect nested vs. legacy-flat format per file, same rule as CONFIG LOADING.
     - Report both locations' absolute paths and status (`existing`/`missing` — doctor never creates files).
   - Resolve the five keys (`prd`, `plan`, `review`, `state`, `openMd`) local → global → default, with sources.
     - Report the resolved `openMd` value only. NEVER run the auto-open prompt — doctor is read-only and asks nothing.
   - Neither file exists → Report "No config (using defaults): prd=always, plan=always, review=always, state=never, openMd=never".
   - At least one file exists → Report "Config resolved: prd=[value] ([source]), plan=[value] ([source]), review=[value] ([source]), state=[value] ([source]), openMd=[value] ([source])".
   - Local-override note, same qualifying rule as CONFIG LOADING (only when local and global both have present-and-valid values for a key, and the two differ): report which keys and their global values.

   **NOTE for maintainers:** Doctor mode short-circuits before Step 3.3 runs, so it cannot call CONFIG LOADING directly — this check duplicates the same read/parse/precedence rules by hand. If you change CONFIG LOADING (in `plan-and-do-setup.md`), update this check to match, and vice versa.

4. Agent Discovery Check:
   ```
   Checking agent availability...
   ```
   - Read project CLAUDE.md for ## Agents section
     - If found: List discovered agents by category — `writer_agents`, `coding_agents`, `review_agents`, `test_coding_agents`, `test_review_agents`, `test_runner_agents`, `tooling_coding_agents`, `tooling_review_agents`, `planner_agents`
     - If not found: Report "No agents in project CLAUDE.md (skill runs in direct mode)"

5. Test Command Check:
   ```
   Checking for test command...
   ```
   - Read CLAUDE.md for test command
     - If found: Report test command
     - If not found: Report "No test command found in CLAUDE.md (will ask during execution)"

6. Overall Status Summary:
   ```

   Overall Status: [SUCCESS / FAILED]
   ```
   - SUCCESS: git available and in git repository
   - FAILED: git missing or not in git repository

---

## TICKET MODE

The skill can process a Kanban ticket from the workshop ticket system instead of a freeform description. Full API contract: `docs/specs/SPEC-API-TICKETS.md` (read the "For skill authors" section).

**When it triggers.** In Step 1, if the *entire* trimmed `$ARGUMENTS` (ignoring any `resume:<n>` token) is one of:
- a **ticket URL** — matches `…/admin/tickets/<id>` for any host/port, e.g. `http://localhost:7200/admin/tickets/8`
- a **bare positive integer** — matches `^\d+$`, e.g. `8`

then set `ticket_mode = true` and extract `ticket_id`. Otherwise `ticket_mode = false` and the skill runs its normal freeform flow, unchanged. A real task description is never a bare number, so this is unambiguous.

Ticket input does **not** support `resume:<step>` — each ticket run reads the live board state fresh in TM.1 and reacts; there is no saved-run resume for a ticket. (`resume:<step>` applies only to freeform description input.)

**Board terminology.** The board at `/admin/tickets` shows **German labels only** — map them to the `status` enum:

| Skill term | German column | `status` | notes |
|------------|---------------|----------|-------|
| Ready | **Zu bereit** | `TODO` | claimable **only** when `owner=AI` |
| In Progress | **In Arbeit** | `IN_PROGRESS` | |
| Blocked | **Wartet** | `ON_HOLD` | `owner` flips to `HUMAN` |
| Done | **Erledigt** | `DONE` | `solution=DONE` |
| (intake) | Definition | `DEFINITION` | never processed |

`owner` (`AI` | `HUMAN`) is a **separate field**, not a column or a visible label. **The skill only processes tickets that are `TODO` + `owner=AI`** — i.e. in the "Ready" ("Zu bereit") column and owned by the AI.

**Config (store in state under `config`).**
- `ticket_api_base` — default `http://localhost:7070` (the backend). A bare number or a `localhost:7200` frontend URL both use `http://localhost:7070`. For a non-localhost URL, use that URL's origin as the base (replace a `:7200` frontend port with `:7070` if present); if unsure, ask the user for the backend base URL.
- **Auth** — the backend needs `AGENT_API_TOKEN` set in `backend/.env` for **any** agent call to work: an unset token → **401** on every agent endpoint, even from localhost (loopback bypass is gated on the token being configured). Read `backend/.env` with the **Read** tool to get the `AGENT_API_TOKEN` value (do not `source` it into the shell), then send `-H "Authorization: Bearer <that value>"` on every agent call — or, if `AGENT_AUTH_ALLOW_LOOPBACK=1` is set, omit the header and let the localhost bypass through. If `backend/.env` has no `AGENT_API_TOKEN`, tell the user to set it (see the "Local setup" block in `docs/specs/SPEC-API-TICKETS.md`) and STOP. The admin session used for the claim comment does **not** need the agent token.
- `ticket_url` — the frontend URL `http://localhost:7200/admin/tickets/<id>` (rebuild it when only a number was given).

**Comment on every state change.** Agent verbs carry a comment only on `done` and `ask`. The claim (`/start` → In Progress) has **no** comment field, so the skill posts that one comment through a short-lived **admin session** (workshop admin user `admin` / `admin123`):

```bash
# Login body uses German field names: benutzername / passwort. Cookie name is set by the server (-c captures it).
# Use a per-ticket cookie jar so concurrent runs don't clobber each other. Verify login returned 200 before commenting.
JAR="/tmp/pad-cookies-<id>.txt"
code=$(curl -s -o /dev/null -w "%{http_code}" -c "$JAR" -X POST -H "Content-Type: application/json" \
  -d '{"benutzername":"admin","passwort":"admin123"}' "$ticket_api_base/api/auth/login")
# if $code != 200 -> admin login failed; warn the user (the transition still happened, only the comment is missing) and skip the comment
curl -s -b "$JAR" -X POST -H "Content-Type: application/json" \
  -d '{"body":"<message>"}' "$ticket_api_base/api/tickets/<id>/comments"
rm -f "$JAR"
```
Use the admin session **only** for the extra In-Progress comment. Do the real transitions with the agent verbs below. (`done` and `ask` already post their own comments, so no admin comment is needed there.) A failed admin login is non-fatal — warn, skip the comment, keep going.

### TM.1 — Resolve & verify (run from Step 1, ticket mode only)

Each fresh `/plan-and-do <id>` run creates a new state file (Step 3.4), so ticket mode does **not** try to auto-resume a saved run — it just reads the live board state and reacts.

1. `GET $ticket_api_base/api/tickets/<id>` (auth per the TICKET MODE config). `404` → "Ticket <id> not found", STOP. `401` → the backend has no `AGENT_API_TOKEN` set (or the token/loopback is wrong); tell the user to fix `backend/.env` per the "Local setup" block in `docs/specs/SPEC-API-TICKETS.md`, STOP.
2. Branch on `status` + `owner` — **only `TODO`+`AI` is processed**:
   - `TODO` + `owner=AI` → claimable. Continue to step 3.
   - `IN_PROGRESS` + `owner=AI` → already claimed (a previous run is running or stalled). Do NOT re-claim or change anything. Tell the user: "Ticket <id> is already In Arbeit (AI) — a previous run may still hold it. If it stalled, finish it or hand it back to a human on the board (`/admin/tickets/<id>`) before re-running." STOP.
   - anything else (`DEFINITION`, `ON_HOLD`, `DONE`, or `owner=HUMAN`) → "Ticket <id> is <status> / <owner> — not Ready+AI, nothing to do." STOP.
3. Set `user_description` = ticket `title` + two newlines + `body` (append the existing `comments` thread for context). Set `task_key = TICKET-<id>-<2–4 kebab words from the title, UPPERCASED, umlauts transliterated: ä→ae ö→oe ü→ue ß→ss>` (e.g. ticket 8 "Icons für Aktivitätstypen" → `TICKET-8-ICONS-FUER-AKTIVITAETSTYPEN`). Set `ticket_url`.

### TM.2 — Claim → In Progress (run from Step 4.6, after the branch exists)

1. `POST $ticket_api_base/api/tickets/<id>/start` → `IN_PROGRESS`. A `409` means it is no longer Ready+AI (someone claimed it since TM.1) — STOP and tell the user. (The branch/state file already created are harmless; the user can delete the branch.)
2. On success set `config.ticket_claimed = true` in the state file (so the Quit hook and Step 8.2 know the ticket is live).
3. Post the state-change comment via the admin session, e.g. `"Von der KI übernommen. Status → In Arbeit."` — append `" (Branch: <branch_name>)"` only when `is_git_repo`.

### TM.3 — Finish → Done (run from Step 13.4, on success)

`POST $ticket_api_base/api/tickets/<id>/done` with body `{"comment":"<2–3 sentence summary of the change + the PR link if one was created>"}`. Moves the ticket to `DONE` (`solution=DONE`); the `comment` is the state-change comment. **On failure** (`409` not IN_PROGRESS, `404`, `401`, or a network error — retry once on a transient network error): do NOT claim success — show the response and tell the user the ticket is still "In Arbeit" and needs manual completion. Reflect this in the Step 13.4 output.

### TM.4 — Question / error → Blocked + Human (run on any unanswerable question or unrecoverable error while in ticket mode)

`POST $ticket_api_base/api/tickets/<id>/ask` with body `{"question":"<the exact question or error text, plus what you already tried>"}`. This moves the ticket to `ON_HOLD` ("Wartet"), sets `owner=HUMAN`, and posts the text as an `AGENT` comment — the state-change comment **and** the reassignment to Human in a single call. Then STOP the skill. (This is for a genuine question or error — **not** a plain user Quit; see the Quit Pattern.)

---

## STEP 12: DOCUMENTATION UPDATES

Reached only for `workflow_scope == "full"` — Steps 9.3 and 10.3 route the other scopes straight to Step 13. So the doc sync runs on the full path, right before the PR is opened.

This step syncs the project docs (`.claude/agents/`, `docs/specs/`, `CLAUDE.md`) with the code this run produced. It runs **before** PR creation (POST-COMPLETION PC.2).

The `update-claude-files` skill owns this sync. It scopes to the branch's changes and requires the project's agent roster.

### Step 12.1: Run the doc-sync skill

**If `agents_available` and `is_git_repo`:** Invoke the skill in embedded mode, scoped to the branch. Substitute the real SHA from `config.original_head`:
```
/project:update-claude-files "embedded base:[original_head]"
```
**Always invoke the project skill `project:update-claude-files`** — never a plugin or global skill of the same base name (e.g. `bpf:update-claude-files`). The `project:` prefix is required to disambiguate.

Wait for completion. The skill writes `docs/state/UPDATE-CLAUDE-FILES-RESULT.md` (gitignored). It never prompts and never blocks.

**If `is_git_repo` but NOT `agents_available`:** Skip the skill. Display:
```
No agents found — skipping doc sync.
Install the agents first: https://github.com/atra-consulting/coding-with-ai-lab/tree/main/.claude/agents
```
Continue to Step 12.3 (do not block the PR).

**If NOT `is_git_repo`:** Direct fallback — scan `CLAUDE.md` and `docs/specs/` for updates the implementation made necessary, and apply them directly (no branch diff available). Skip the result-file logic below.

### Step 12.2: Commit the result

**Only when the skill ran in Step 12.1 (`agents_available` and `is_git_repo`):**

Read `docs/state/UPDATE-CLAUDE-FILES-RESULT.md`. Act on its `status`:
- `status: updated` → Display "Applying documentation updates: [files from result]." Stage only the changed docs (`git add .claude/agents docs/specs CLAUDE.md`) and commit `docs: Update project documentation. [task_key]` (with `PRD:` footer when `prd_file` exists). Do NOT stage the result file — it is gitignored.
- `status: no-changes` → Display "No documentation updates needed." Commit nothing.
- `status: skipped-no-agents` or `status: error` → Display the note from the result file. Commit nothing. Continue — never block the PR.

### Step 12.3: Advance to Summary

**This is NOT a user checkpoint. Never call AskUserQuestion here.**

Update state: `current_step` = "12.3". → STEP 13.

---

## STEP RESUME ROUTER

This section handles explicit `resume:<step>` argument.
Automatic resume from state file is handled in Step 1 (PARAMETER PARSING).

**Setup docs_folder for resume:**

Before validating artifacts, detect docs folder:
```bash
test -d doc && echo "doc" || (test -d docs && echo "docs" || echo "none")
```
- If "doc" exists: `docs_folder` = "doc"
- If "docs" exists: `docs_folder` = "docs"
- If neither: Display error "No docs folder found. Cannot resume." and STOP.

Set paths:
- `prd_dir` = `[docs_folder]/prds`
- `plan_dir` = `[docs_folder]/plans`
- `state_dir` = `[docs_folder]/state`
- `review_dir` = `[docs_folder]/reviews`

**Restore variables from state.** Now that `state_dir` is set, read `[state_dir]/STATE-[task_key].json` and load these in-memory values before routing: `branch_name`, `original_branch`, `workflow_scope`, `pr_prefix`, `pr_exists`, `pr_url`. Trust the state file over conversation memory.

- Read `config.keep_files` from the state file as an OBJECT (per-file booleans, `true` = keep). Handle each case:
  - Absent or null → keep all files. Display: "keep_files not found. Defaulting to keep all files."
  - Legacy single boolean `true` → keep all files. Display: "keep_files in legacy format (true). Keeping all files."
  - Legacy single boolean `false` → delete `prd`, `plan`, `state`; keep `review`.
- Also read `config.keep_settings` from the state file if present (informational only — cleanup decisions come from `keep_files`).
- Read `config.auto_open_md` from the state file. Absent (legacy state predates this feature) → default to `false`.

**Prerequisites Validation:**

Based on target step, verify required artifacts exist:

**Step 1-9: No resume needed**
```
ERROR: Cannot resume from Step [number].
Steps 1-9 create foundational artifacts.
Please run from Step 1.
```
STOP with error.

**Step 10: Code Review**
Required artifacts:
- `[prd_dir]/PRD-[task_key].md` (specifications (PRD) file - optional, may have been skipped)
- `[plan_dir]/PLAN-[task_key].md` (detailed plan file)
- Implementation commits exist (check git log for [task_key])

Validation:
```
Validating Step 10 prerequisites...
```

Check each artifact:
```bash
# Check PRD exists (optional)
test -f [prd_dir]/PRD-[task_key].md

# Check PLAN exists (required)
test -f [plan_dir]/PLAN-[task_key].md

# Check commits exist
git log --oneline --grep="[task_key]"
```

**If PLAN or commits missing:**
```
ERROR: Missing required artifacts for Step 10:
- Specifications (PRD) file: [prd_dir]/PRD-[task_key].md [FOUND/SKIPPED]
- Detailed plan file: [plan_dir]/PLAN-[task_key].md [FOUND/MISSING]
- Implementation commits: [FOUND/MISSING]

Cannot resume from Step 10.
Please run from Step 1 or ensure all artifacts exist.
```
STOP with error.

**If required artifacts found:**
- If PRD missing: Set `prd_skipped = true`, display: "Specifications (PRD) was skipped"
- Display: "All Step 10 prerequisites found"
- Continue to STEP 10: CODE REVIEW (LOCAL)

**Step 11: Post-Review Testing**
Required artifacts:
- All Step 10 artifacts (specifications (PRD), PLAN, commits)
- Code review completed

Validation:
```
Validating Step 11 prerequisites...
```

Check Step 10 artifacts first (same validation as above).

**If Step 10 artifacts missing:**
- Show same error as Step 10
- STOP with error

**If Step 10 artifacts found:**
- Display: "All Step 11 prerequisites found"
- Display: "Note: Assuming code review complete or issues addressed"
- Continue to STEP 11: POST-REVIEW TESTING

**Step 12: Documentation Updates**
Required artifacts:
- All Step 10 artifacts
- Post-review testing complete (or skipped via resume)

Validation: Same as Step 11.

**If artifacts found:**
- Display: "All Step 12 prerequisites found"
- Continue to STEP 12: DOCUMENTATION UPDATES

**Step 13: Summary**
Required artifacts:
- All Step 10 artifacts

Validation: Same as Step 11.

**If artifacts found:**
- Display: "All Step 13 prerequisites found"
- Display: "Note: Assuming prior steps complete or issues addressed"
- Continue to STEP 13: SUMMARY

---

## POST-COMPLETION WORKFLOW

Execute after Step 13.2 (Mark State Complete). Handles cleanup, push, PR, merge, and branch switch.

### PC.1: Ensure Clean Working Directory

```bash
git status --porcelain
```

**If uncommitted changes exist:**
1. Stage tracked modified files: `git add -u`
2. Also stage any skill-created files (PRD, PLAN, STATE, REVIEW)
3. Commit: `git commit -m "docs: Final cleanup - commit remaining changes. [task_key]"`
4. Display: "Committed remaining uncommitted changes."

**If clean:** Display: "Working directory clean."

### PC.2: Push and Pull Request

Combined prompt — `gh pr create` cannot succeed without a push, so collapse the two decisions into one.

Call the `AskUserQuestion` tool with:
1. Push and create pull request (recommended)
2. Push only (no PR)
3. Skip — keep commits local

Wait for response — do not push or create a PR without user confirmation.

- **Push and create PR:**
  ```bash
  git push -u origin [branch_name]
  ```
  If push fails: warn, ask whether to retry or skip; do not attempt PR creation on a failed push.

  **CRITICAL:** The PR MUST target `original_branch` — the branch active when the skill started (stored in state file `config.original_branch`). Never default to main/master. Re-read the state file if `original_branch` is unknown.

  **PR title:** Use `[pr_prefix] [brief title]. [task_key]` when `config.pr_prefix` is set (derived in Step 7.5). When `config.pr_prefix` is null/empty, drop it entirely — use `[brief title]. [task_key]` with no leading space and no literal "null". This applies to both the `gh pr edit` and `gh pr create` commands below.

  **Existing PR?** If `config.pr_exists = true` (an open PR was found in Step 4.4b), update it instead of creating a new one:
  ```bash
  gh pr edit [pr_url] --title "[pr_prefix] [brief title]. [task_key]" --body "$(cat <<'EOF'
  ## Summary
  [Brief summary of changes made]

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
  Display the existing PR URL. Continue to PC.4.

  **No existing PR** (`config.pr_exists = false` or null): create one with gh CLI. Do NOT add a test plan section — only include the summary.
  ```bash
  gh pr create --base [original_branch] --title "[pr_prefix] [brief title]. [task_key]" --body "$(cat <<'EOF'
  ## Summary
  [Brief summary of changes made]

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
  Display PR URL. Continue to PC.4.

- **Push only:**
  ```bash
  git push -u origin [branch_name] || echo "Push failed - commits are local only"
  ```
  (Use the full `-u origin [branch_name]` form — a bare `git push` fails on a branch with no upstream, and suppressing stderr would hide why.)
  Continue to PC.5.

- **Skip:** Display "Commits stay local on `[branch_name]`." Continue to PC.5.

### PC.4: Merge Pull Request

Call the `AskUserQuestion` tool with: 1-Merge PR, 2-Skip merge (done). Wait for response — merging is destructive, never merge without explicit user confirmation.

- Merge:
  ```bash
  gh pr merge --merge
  ```
  Set `pr_merged = true`. Continue to PC.5.

- Skip → Continue to PC.5 (offer branch switch).

### PC.5: Switch Back to Original Branch

**If `pr_merged = true`:**

```bash
git checkout [original_branch]
git pull
```

Display: "Switched to `[original_branch]` and pulled latest changes."

**If `pr_merged = false` (user skipped PR or merge):**

Check if currently on a feature branch different from `original_branch`. If so:

Call the `AskUserQuestion` tool with: 1-Switch back to `[original_branch]`, 2-Stay on `[branch_name]`. Wait for response.

- Switch back:
  ```bash
  git checkout [original_branch]
  ```
  Display: "Switched to `[original_branch]`."

- Stay → Display: "Staying on `[branch_name]`."

STOP — workflow complete.
