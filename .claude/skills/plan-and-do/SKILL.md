---
name: "project:plan-and-do"
description: "End-to-end implementation workflow from idea to code review. Use for building features, implementing tasks, fixing complex bugs, or any substantial coding work. Handles planning, implementation, testing, and review automatically."
argument-hint: "description" [special-instructions|resume:<step>] | ticket-url | ticket-number
version: 2.0.0
last-modified: 2026-08-15
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash(git:*)
  - Bash(npm:*)
  - Bash(gradle:*)
  - Bash(fvm:*)
  - Bash(./run-all-tests.sh:*)
  - Bash(gh:*)
  - Bash(curl:*)
  - Bash(rm:*)
  - Bash(open:*)
  - Task
  - AskUserQuestion
---

# Plan and Do Workflow

<!--
Usage: /plan-and-do "description" [special-instructions] | (empty — scans for resumable tasks) | <input> resume:<step> | <ticket-url-or-number> (ticket mode — see plan-and-do-modes.md, ## TICKET MODE)
Variables: $ARGUMENTS (freeform description + optional special instructions, OR a ticket URL/number, OR resume:<step>) | Prerequisites: git, test execution capability
-->

## Branch Protection

All commits go to the NEW BRANCH created by this skill (or the kept feature branch, Step 4.4); the original branch always stays clean. State file written to disk first, committed after switching branches.

**PR Target Rule:** PRs always target `original_branch` — the branch active when the skill started, captured in Step 4.4 via `git branch --show-current` and stored in `config.original_branch`. Never default to main/master.

**Non-git mode:** When `is_git_repo = false`, all git operations (branch, commit, push, PR) are skipped; the rest of the skill still runs.

**Review scope:** Code review (Step 10) compares against `original_head` — captured at Step 4.4 — not main/master.

---

## Commit Scoping Rule

**Every commit in this skill stages only the specific files it changed.** Always use `git add [exact file paths]`. NEVER use `git add -A`, `git add .`, or `git commit -a`. This keeps stray untracked files out of commits — above all the local `claude.atra.json` that CONFIG LOADING creates in the working directory. That file must stay untracked unless the user commits it themselves.

---

## PLAN MODE CHECK

If in plan mode (system reminders indicate plan mode active):
```
ERROR: This skill cannot run in plan mode.
Please exit plan mode and run this skill again.
```
STOP immediately.

If NOT in plan mode → continue.

## SKILL HEADER

```
Plan and Do (v2.0.0, 2026-08-15)
************************************

Plan and implement any work from freeform description
```

---

# Plan and Do

**CRITICAL — MANDATORY WORKFLOW. NO SHORTCUTS.**
You MUST execute every numbered step (1–13) in strict order. No skipping. No combining. No "just doing it" because the task looks simple. Every task — no matter how trivial — gets: state file, branch, PRD decision, plan, checkpoints, review, summary. The user relies on checkpoints to stay in control. Skipping steps breaks the skill. Do NOT write any implementation code before Step 8. If you feel tempted to skip ahead, STOP and follow the next step instead.

**Questions are tasks, not investigations.** Even when the input is phrased as a question ("Why doesn't X work?", "Is Y broken?"), treat it as a task to investigate and fix through the full workflow. Do NOT answer it directly. Do NOT start reading source code, searching for patterns, querying logs, or analyzing the problem before Step 8 (Implementation). Parameter parsing, state setup, branch creation, planning, and plan approval come first — always.

**CHECKPOINT RULE: NEVER auto-continue past a Standard Checkpoint.** You MUST call the `AskUserQuestion` tool and WAIT for the user's response at every Standard Checkpoint. The user must explicitly choose "Continue" before you proceed. No exceptions.

**A step prompts the user ONLY if its body explicitly calls AskUserQuestion.** Steps labeled with phrases like "Auto-Advance", "Advance to …", or marked "NOT a user checkpoint" are pure transitions — never call AskUserQuestion on them. When a step body says "Do NOT prompt", that wins over any word in the heading.

You are a senior developer implementing a complete feature from a freeform task description through to code review.

**Task input**: $ARGUMENTS

## Writing Style

Short and brief. Short sentences. Simple words non-native speakers understand. No passive voice. Use sentence fragments.

This applies to every document this skill produces: the specifications (PRD), the plan, and — via the review skill — the code review.

## FILE PATH DISPLAY RULE

When displaying any file path to the user, ALWAYS use the full absolute path. Get the project root with `pwd` and prepend it to relative paths. Example: `/Users/dev/project/docs/plans/PLAN-FOO.md` instead of `docs/plans/PLAN-FOO.md`. This lets users Command-click paths in the terminal to open them.

## ARTIFACT PATH DISPLAY RULE

**Before EVERY checkpoint prompt**, display full absolute paths of all artifact files that exist. Always in this order:

1. Specifications (PRD): `[full path to prd_file]` (if exists)
2. Plan: `[full path to plan_file]` (if exists)
3. Review: `[full path to review file]` (if exists)
4. State: `[full path to state_file]`

**If the user edited any file since the last checkpoint**, re-display all artifact paths so the user can re-open them.

**"New or changed since the last checkpoint"** means: the file did not exist at the previous checkpoint, or its content changed since then (just created this step, or edited via the "Edit" checkpoint choice).

**Then, if `config.auto_open_md == true`:** automatically open every MD artifact that is new or changed since the last checkpoint (as defined above), per the OPEN IN APP RULE's Automatic behavior, before presenting the checkpoint choices.

---

## OPEN IN APP RULE

Opens PRD/plan/review files in the macOS default app (`open [path]`, fallback `open -a "Marked" [path]`) — never the state JSON. macOS only; skip silently elsewhere.

The "Open in app" checkpoint choice opens on demand and returns to the SAME checkpoint — it never advances the workflow. Automatic open (`config.auto_open_md == true`) fires only for artifacts new or changed since the last checkpoint.

Full rules: `plan-and-do-setup.md` → `## OPEN IN APP RULE`.

---

## HOW TO ASK THE USER FOR DECISIONS

**CRITICAL — ALWAYS call the `AskUserQuestion` tool for every user prompt.** Every decision, confirmation, and choice in this skill is an `AskUserQuestion` tool invocation — never prose, never a shell prompt, never a wait-for-next-message.

This rule overrides any past guidance. Previous advice to use a home-made terminal input mechanism (because of a long-skill bug) is **revoked**. The bug is no longer a concern. Call `AskUserQuestion`.

If tempted to "just print the question and wait" for the user's next message, **STOP** and call `AskUserQuestion` instead.

**Numbered choices:** Pass the question text as the `question` parameter of `AskUserQuestion`, with the numbered options in `options`.

**Freeform input:** Pass the question as the `question` parameter of `AskUserQuestion`; the user can pick "Other" to type a freeform answer.

### Forbidden Input Patterns

Never do any of these — each is a bug:

- Printing a question as text and waiting for the user's next message. → Call `AskUserQuestion` instead.
- `Bash` with `read -p`, piped `echo`, or any interactive stdin pattern. → Call `AskUserQuestion` instead.
- Soft phrasing like "let me know", "what do you think?", or "please confirm" without a tool call. → Call `AskUserQuestion` instead.
- Treating a mid-turn user correction as an implicit answer to an unasked question. → Call `AskUserQuestion` with an explicit question instead.
- Assuming the user's silence means approval. → Call `AskUserQuestion` and wait.

---

## REUSABLE PATTERNS

### Quit Pattern

When user chooses "quit" at any checkpoint:
1. Update state file: set `status` = "paused"
2. **If `is_git_repo`:** Commit state file: `git add [state_file] && git commit -m "docs: Save state at Step [N]. [task_key]"`
3. **If `ticket_mode = true` AND `ticket_claimed = true`:** Quit is a pause, not a question or error — do **not** run TM.4 (`plan-and-do-modes.md` → `## TICKET MODE`). Leave the ticket in "In Arbeit" and post a neutral admin-session comment, e.g. "KI-Bearbeitung pausiert. Ticket bleibt in In Arbeit." so the board shows why. (To instead return it to a human, the user hands it back on the board.) If `ticket_claimed = false`, the ticket was never claimed — do nothing.
4. Display: "Progress saved. Resuming a paused ticket run is not automatic — re-running /plan-and-do [id] starts fresh and will see the ticket as already In Arbeit." (That fresh run re-runs TM.1 — see `plan-and-do-modes.md` → `## TICKET MODE`.)
5. STOP (clean exit)

### Standard Checkpoint

**You MUST wait for user response. NEVER auto-continue past a checkpoint.**

Before presenting choices, display artifact paths per the ARTIFACT PATH DISPLAY RULE above.

At each checkpoint, **call the `AskUserQuestion` tool** with four choices:
- Continue → proceed to next step
- Edit → call the `AskUserQuestion` tool again to ask what changes are needed, apply them, return to this checkpoint
- Open in app → open the existing MD artifacts (PRD, plan, review) per the OPEN IN APP RULE, then return to this checkpoint
- Quit → execute Quit Pattern above

When asking for approval, also display the full absolute path of every file that was created or changed since the last checkpoint.

---

## DELEGATION

When agents are available, you orchestrate. You do not do the hands-on work. You slice the task, write standalone subagent prompts, integrate results, and verify. Workers write the code, docs, and tests.

Every Task-tool dispatch names a model. **Agent picks the domain. Model picks the difficulty.** The `model` parameter overrides the agent's frontmatter `model:`.

Three worker tiers. Pick the LOWEST tier that can plausibly succeed:

- `haiku` — mechanical. Renames, boilerplate, applying a spelled-out diff, repetitive edits with a clear pattern.
- `sonnet` — standard well-specified coding. One component, one endpoint, a bug fix with a known cause.
- `opus` — hard slices. Cross-cutting changes, unknown-cause debugging, architecture- or security-sensitive work.

Implementation slices (Step 8.1) default to `sonnet` — `opus` needs a named trigger (cross-cutting, unknown-cause debugging, architecture, security), never a hunch. This rule binds at plan-authoring time (Step 7.3) — once the plan is approved at Step 7.5, Step 8.1 follows it as written, without re-litigating the tier choice.

All three tiers stay available no matter which model you run on. Dispatch `opus` freely even when you are Opus. You never dispatch a Task "to the orchestrator" — that is a role, not a tier. `fable` is never a worker.

Verify every slice. Escalate on failure: two attempts per tier, then one tier up.

You do hands-on work yourself in exactly two cases: `coding_agents` is empty (see AGENT DISCOVERY), or a slice failed twice at `opus`. Flag the second case in the summary.

**Full rules — slice prompt contract, verification options, escalation loop, worked examples, and how to create a planner agent: read `plan-and-do-delegation.md`.**

---

## AGENT DISCOVERY

Read `plan-and-do-delegation.md` → `## 12. AGENT DISCOVERY` and apply it: classify every agent in `CLAUDE.md` → `## Agents`. Sections 13 (dispatch narration) and 14 (reviewer scope filter) govern every dispatch that follows.

Results feed `discovery.*` in the state file. Timing is unchanged — the first step that needs an agent triggers discovery.

If no agents are found, display "No agents found. Running in direct mode." and set `agents_available = false`.

---

## Context Recovery

If you lose track of variables after context compression, re-read `[docs_folder]/state/STATE-[task_key].json`. Trust the file over conversation memory.

**Legacy state files:** a state file written before a feature existed lacks its keys. Treat a missing `delegation` object, `delegation.assignments`, `delegation.escalations`, or `discovery.planner_agents` as empty (`{}` / `[]`) and create it on the next write. Never warn, never error.

---

## CONFIG LOADING

Read `plan-and-do-setup.md` → `## CONFIG LOADING` and execute it. It creates any missing `claude.atra.json` (global and local), reads both, and resolves `keep_settings`, `open_md_setting`, and `auto_open_md`.

Step 3.3 is the only caller. Nothing else runs it.

---

## TICKET MODE

Triggered in Step 1 when the whole input is a ticket URL (`…/admin/tickets/<id>`) or a bare integer (`^\d+$`). Sets `ticket_mode = true`.

Full rules — board terminology, config, auth, and TM.1–TM.4 — live in `plan-and-do-modes.md` → `## TICKET MODE`. Read that file before running any TM step.

Call sites: Step 1 (TM.1 resolve), Step 4.6 (TM.2 claim), Step 8.2 (TM.4 blocked), Step 13.4 (TM.3 done).

---

## PARAMETER PARSING

**If $ARGUMENTS contains "help" or "doctor":**
Read `plan-and-do-modes.md` and execute matching section. STOP.

**Otherwise:** Continue to Step 1.

### Step 1: Check for Existing Checkpoint

1. Determine task_key from input:

   **Path A — Freeform text** (non-empty):
   - Store as `user_description`
   - **Ticket detection (read `plan-and-do-modes.md` → `## TICKET MODE`):** If the trimmed input is a ticket URL (`…/admin/tickets/<id>`) or a bare integer (`^\d+$`), set `ticket_mode = true`, then run **TM.1 (Resolve & verify)** from that file now. TM.1 sets `user_description`, `task_key`, `ticket_id`, `ticket_url`. If TM.1 stops (not found, or not Ready+AI), STOP the whole skill. Otherwise skip the UPPERCASE-name extraction below (TM.1 already set `task_key`) and go straight to `branch_prefix`. Set `ticket_api_base` per that file's TICKET MODE config.
   - **If not a ticket** (`ticket_mode = false`): Extract UPPERCASE task name (2-4 words, hyphenated). Example: "Add Redis caching" → "ADD-REDIS-CACHING"
   - Display understanding and key. Do NOT ask for approval — just show it and continue.
   - Set `branch_prefix` = lowercase task_key, `input_mode` = "freeform"

   **Path B — Empty:**

   1. Scan for resumable state files:
      ```bash
      ls doc/state/STATE-*.json docs/state/STATE-*.json 2>/dev/null
      ```

   2. **If files found:** Read each file. Filter to `status` = "paused" or "in_progress".

      **If resumable files found:**
      Display numbered list:
      ```
      Found in-progress work:
        1 - [task_key] (step [current_step], [status]) — "[user_description]"
        2 - [task_key] (step [current_step], [status]) — "[user_description]"
        N - Start new task

      ```
      Call the `AskUserQuestion` tool with this list. Wait for response.

      - If user picks existing task → set `task_key`, `user_description`, all config from state file. Set `branch_prefix` = lowercase task_key, `input_mode` = "freeform". Jump to step 1.2 (state file check).
      - If user picks "Start new task" → call the `AskUserQuestion` tool with: "What would you like to implement?" Then follow Path A.

      **If no resumable files (all completed):** Fall through.

   3. **No state files or all completed:** Call the `AskUserQuestion` tool with: "What would you like to implement?" Then follow Path A.

2. Check for state file in `doc/state/` or `docs/state/`.

3. **If state file exists with status=PAUSED:** Show progress. Call the `AskUserQuestion` tool with: 1-Resume, 2-Start fresh, 3-Quit. Wait for response — do not proceed until the user answers.

   **If COMPLETED or IN_PROGRESS:** Continue.

4. **No state file:** Continue.

### Resume Mode Detection

If $ARGUMENTS contains "resume:<number>":
1. Extract step (must be 1-13)
2. Parse task input
3. Display: "RESUME MODE: Skipping to Step [number]"
4. Jump to STEP RESUME ROUTER

Otherwise → STEP 2.

---

## STEP 2: TOOL VALIDATION & GIT DETECTION

```bash
git rev-parse --git-dir 2>/dev/null
```
- If succeeds: set `is_git_repo = true`. Display: "Git repository detected."
- If fails: set `is_git_repo = false`. Display: "Not a git repository. Running without git (no branches, commits, or PRs)."

### Step 2.1: Pull Latest Changes

**If `is_git_repo = false`:** Skip this step.

Fetch and check whether the current branch is behind its upstream:

```bash
git fetch origin 2>/dev/null
git rev-list HEAD..@{u} --count 2>/dev/null || echo "0"
```

- If the count is > 0: Display "Pulling latest changes..." then run `git pull`. If the pull fails, warn "Pull failed. Continuing with local state." Do NOT stop.
- If the count is 0 or there is no upstream tracking branch: Display "Already up-to-date."

Continue to STEP 3 either way.

---

## STEP 3: DOCS FOLDER SETUP

### Step 3.1: Detect Docs Folder

Check `doc` then `docs`. If neither exists, create `docs`. Store as `docs_folder`.

### Step 3.2: Create Subdirectories

```bash
mkdir -p [docs_folder]/{prds,plans,state,reviews}
```

Store paths: `prd_dir`, `plan_dir`, `state_dir`, `review_dir`.

### Step 3.3: Load Config

Read `plan-and-do-setup.md` → `## CONFIG LOADING` and execute it now, before the state file gets written. This resolves `keep_settings`, `open_md_setting`, and `auto_open_md` so Step 3.4 never writes nulls for these config-derived state keys.

### Step 3.4: Initialize State File

Write `[state_dir]/STATE-[task_key].json` using the Write tool, using the template in `plan-and-do-setup.md` → `## STATE FILE TEMPLATE`. Do NOT git add/commit yet. File committed on the new branch in Step 4.5.

**Ticket mode:** when `ticket_mode = true` (TM.1 in `plan-and-do-modes.md` → `## TICKET MODE` ran in Step 1), write the **real** resolved values into this file now — see the ticket-mode note in `plan-and-do-setup.md` → `## STATE FILE TEMPLATE`.

---

## STEP RESUME ROUTER

Read `plan-and-do-modes.md` and execute "STEP RESUME ROUTER" section.

---

## STEP 4: TASK ANALYSIS & BRANCH SETUP

### Step 4.1: Display Tracking

```
Tracking: [task_key]
```

Set `ticket_summary` = user_description.

### Step 4.2: Generate Branch Name

Format: `[branch_prefix]-[short-kebab-case]`, max 50 chars. Store as `branch_name`.

### Step 4.3: Check Branch Existence

```bash
git rev-parse --verify [branch_name] 2>/dev/null
git ls-remote --heads origin [branch_name]
```

If exists: append random 6-digit number to `branch_name`.

### Step 4.4: Create and Push Branch

**If `is_git_repo = false`:** Skip this step entirely. `original_head` stays `null`; Step 10.1 then uses plain `/project:review "embedded"`. Continue to Step 5.

Get current branch → store as `original_branch`. Capture the starting commit → `original_head = git rev-parse HEAD`. Capture both BEFORE any branch creation, so `original_head` records the true starting point. (For the kept-branch path and the create-branch path, `original_head` is the same starting commit — it is captured once here, before branching.)

**If on main/master:** Display: "On [branch]. Creating new branch [branch_name]." Always create the branch. Never ask. Never allow staying on main/master. Go to **Create branch** below.

**If NOT on main/master (already on a feature branch):** Display: "You are on branch `[original_branch]`. This looks like existing work." Call the `AskUserQuestion` tool with: 1-Keep this branch (recommended), 2-Create new branch, 3-Quit. Wait for response.
- Keep → set `branch_name = original_branch`. Skip branch creation. Go to Step 4.4b.
- Create new → continue to **Create branch** below.
- Quit → execute Quit Pattern.

**Create branch:**
```bash
git checkout -b [branch_name]
git push -u origin [branch_name]
```
If push fails: warn, continue local-only.

### Step 4.4b: Check for Existing PR

**If `is_git_repo = false`:** Skip this step. Continue to Step 4.5.

Detect an open PR for `branch_name` (cheap, keeps logic uniform for new and kept branches — a just-created branch always returns none):

```bash
gh pr list --head [branch_name] --state open --json number,title,url 2>/dev/null
```

- If a PR is found: set `pr_exists = true`, store its URL as `pr_url`, display: "Open PR found: [pr_url]".
- If none found, or `gh` is unavailable: set `pr_exists = false`, `pr_url = null`.

### Step 4.5: Commit State File

**If `is_git_repo = false`:** Skip this step.

Update state with `branch_name`, `original_branch`, `original_head`, `pr_exists`, `pr_url`, then commit:

```bash
git add [state_dir]/STATE-[task_key].json
git commit -m "docs: Initialize state tracking for [task_key]"
```

### Step 4.6: Claim Ticket (ticket mode only)

**If `ticket_mode = false`:** Skip this step.

**Otherwise:** Run **TM.2 (Claim → In Progress)** from `plan-and-do-modes.md` → `## TICKET MODE` now — the branch exists (when `is_git_repo`), so the In-Progress comment can name it. This flips the ticket `TODO → IN_PROGRESS`, sets `ticket_claimed = true`, and posts the state-change comment. A `409` here means the ticket is no longer Ready+AI — STOP and tell the user.

---

## STEP 5: SPECIFICATIONS (PRD) DECISION

### Step 5.1: Assess Task Scope

Evaluate the task based on user_description and codebase analysis:
- **Small task:** Few files, single concern, straightforward change (e.g., config update, single-file fix, small refactor, updating a markdown skill file)
- **Complex task:** Multiple components, new feature with multiple touch points, architectural changes, cross-cutting concerns

**If small/limited scope:** Display: "Task is small. Skipping specifications (PRD)." Set `prd_skipped = true`, `prd_file = null`, update state: `current_step` = "5.1", `artifacts.prd_skipped = true` → STEP 7.

**If complex:** Call the `AskUserQuestion` tool with: 1-Create specifications (PRD) first (recommended for complex features), 2-Skip to detailed plan.

- "1" → `prd_skipped = false`, continue to STEP 6
- "2" → `prd_skipped = true`, `prd_file = null`, update state: `current_step` = "5.1", `artifacts.prd_skipped = true` → STEP 7

---

## STEP 6: SPECIFICATIONS (PRD) CREATION

**Conditional:** Only when `prd_skipped = false`.

### Step 6.1: Analyze Requirements

Analyze user_description and codebase using Grep/Glob. Identify patterns, modules, conventions.

### Step 6.2: Generate Specifications (PRD)

**If agents_available:**

1. **Draft:** Launch ONE agent via Task tool to write the PRD, in this order of preference: first `planner_agent`, else `ba-writer` (or first `writer_agent`), else first `coding_agent`, else write directly. Model: `opus` for a complex task, `sonnet` for a small one — never `haiku`. Provide user_description, codebase context from Step 6.1, and the structure below. Apply the **DISPATCH NARRATION RULE** (`plan-and-do-delegation.md` → `## 13. DISPATCH NARRATION RULE`).
2. **Review:** Apply the **REVIEWER SCOPE FILTER** (`plan-and-do-delegation.md` → `## 14. REVIEWER SCOPE FILTER`) — for a PRD always include `ba-reviewer`, plus any domain reviewers whose area the PRD covers. Launch them in parallel via Task tool. Model: one tier below the draft, floor of `sonnet` for anything security- or architecture-relevant. Apply the DISPATCH NARRATION RULE from the same file. Each reviewer gets the draft PRD and checks for completeness, correctness, and feasibility from their domain perspective.
3. **Fix:** Collect all reviewer findings. Delegate the fixes to the drafting agent with the findings in the prompt — no user prompt needed. Model: same tier as the draft. If reviewers disagree, prefer the more conservative/thorough approach. Fix directly only when `coding_agents` is empty or `agents_available == false`. Failed fixes run the escalation loop.
4. **Result:** The reviewed and fixed PRD becomes the final draft for user approval.

**Record:** log the draft, each reviewer, and the fix in `delegation.assignments` — step "PRD draft" / "PRD review: [agent]" / "PRD fix", agent, model, verification method.

**Otherwise:** Write directly.

Structure:

```markdown
## Summary
### Business Summary
[2-4 sentences. Business audience. What this change does and why it matters. No jargon, no file paths, no code.]

### Technical Summary
[2-4 sentences. Technical audience. The shape of the change at a high level.]

## Source
## Problem Statement
## Requirements
## Special Instructions
## Implementation Approach (high-level, no code)
## Test Strategy
## Non-Functional Requirements
## Success Criteria
## Technical Notes (optional)
[Only if needed. Technical audience. Deeper technical detail than the Technical Summary. Skip this section when the Technical Summary already covers it.]
```

Audience rule: everything above must read clearly to a business person, except Technical Summary and Technical Notes — those two are for technical readers only.

Keep brief. No code samples anywhere in the PRD — not even in Technical Notes. Details go in the Step 7 plan.

### Step 6.3: Write to File

Write to `[prd_dir]/PRD-[task_key].md`. Store as `prd_file`.

### Step 6.4: Checkpoint 6 — PRD Approval

Update state: `current_step` = "6.4", set `artifacts.prd_file`.

Display PRD content and full absolute file path. Call the `AskUserQuestion` tool with: 1-Continue, 2-Edit, 3-Open in app, 4-Quit. Wait for response — do not proceed until the user answers.

### Step 6.5: Commit PRD

**If `is_git_repo`:** Use a HEREDOC so the `PRD:` footer lands on its own line per CLAUDE.md.
```bash
git add [prd_dir]/PRD-[task_key].md
git commit -m "$(cat <<'EOF'
docs: Add specifications (PRD) for [task summary]. [task_key]

PRD: [prd_file relative to repo root]
EOF
)"
```

**Implementation commits in Step 8.1 must also include the `PRD: [path]` footer** when `prd_file` exists, so the commit ↔ PRD link is preserved per CLAUDE.md.

---

## STEP 7: DETAILED PLAN

**Context refresh:** Re-read PRD file (if exists) using Read tool. Use file as authoritative source.

### Step 7.1: Determine Test Command

Check in order:
1. **CLAUDE.md** — if found, use directly (no confirmation needed)
2. **README.md / README.adoc** — if found, call the `AskUserQuestion` tool with the prompt `"Found test command: [command]. Use this one?"` (1-Yes / 2-Let me type a different one). Do not run tests until the user confirms.
3. **Not found** — call the `AskUserQuestion` tool with: "How do you run tests? Type your test command:"

Store as `test_command`. Do not continue until confirmed.

### Step 7.2: Analyze Requirements

If PRD exists: read it. If skipped: use user_description + codebase analysis via Grep/Glob.

Create implementation tasks: file changes, tests, configuration, verification steps.

### Step 7.3: Generate Detailed Plan

Read `plan-and-do-delegation.md` → `## 10. STEP 7.3: PLAN DRAFT/REVIEW/FIX CYCLE` and execute it. Short version: a planner writes the WHOLE plan in one dispatch — no merge needed. Without one, all `coding_agents` draft in parallel and the orchestrator merges. Review and fix run either way.

Plan structure: `plan-and-do-delegation.md` → `## 11. PLAN STRUCTURE (Step 7.3)`.

### Step 7.4: Write to File

Write to `[plan_dir]/PLAN-[task_key].md`. Store as `plan_file`.

### Step 7.5: Checkpoint 7 — Plan Approval

Update state: `current_step` = "7.5", set `artifacts.plan_file` and `discovery.test_command`. Set `config.workflow_scope` (and `config.pr_prefix`, when derived) only *after* the user answers — never before.

Display plan content. Display artifact paths per the ARTIFACT PATH DISPLAY RULE. **If `pr_exists = true`, also display "Open PR found: [pr_url]" so the user sees it before choosing** — `pr_exists`/`pr_url` come from Step 4.4b; do NOT re-detect here.

**Plan Approval Checkpoint — NOT a Standard Checkpoint.** Call the `AskUserQuestion` tool with these choices. Always in this order. Add "(Recommended)" after the one you recommend based on task complexity:

1. **Approve and implement** — Run implementation and tests (Steps 8-9). Stop after testing. Best for small, low-risk changes.
2. **Approve, implement, and review** — Run implementation, tests, and code review (Steps 8-10). Stop after review. Good for medium changes.
3. **If `pr_exists = false`: Approve, implement, review, and create PR** — Full workflow through PR creation (Steps 8-13). Best for complex or team-shared work.
   **If `pr_exists = true`: Approve, implement, review, and update PR** — Full workflow; the post-completion step updates the existing PR instead of creating one.
4. **If `prd_skipped = true`: Create PRD first** — Discard the current draft plan, create a PRD (Step 6), then regenerate the plan (Step 7) with the PRD as input. **Omit this option entirely when `prd_skipped = false`.**
5. **Edit** — Request changes to the plan.
6. **Open in app** — Open the plan (and PRD if it exists) per the OPEN IN APP RULE, then return to this checkpoint.
7. **Quit** — Execute Quit Pattern.

**Numbering:** When `prd_skipped = false`, omit option 4 (Create PRD first) entirely and present exactly six options with no gap — renumber so Edit = 4, Open in app = 5, and Quit = 6. When `prd_skipped = true`, present all seven as numbered above: 1, 2, 3, 4-Create PRD, 5-Edit, 6-Open in app, 7-Quit. Always label each option by name as well as number so the mapping below stays unambiguous.

Store the user's choice in state as `config.workflow_scope`:
- Choice 1 → `"implement"`
- Choice 2 → `"implement-review"`
- Choice 3 → `"full"`, then **derive the PR prefix** (see below)
- "Create PRD first" (only when `prd_skipped = true`) → set `prd_skipped = false`, update state (`artifacts.prd_skipped = false`). **If `is_git_repo`:** the draft plan was written in Step 7.4 but is only committed in Step 7.6, so it may be untracked — remove it safely: if `git ls-files --error-unmatch [plan_file]` succeeds (tracked), run `git rm [plan_file] && git commit -m "docs: Remove draft plan, creating PRD first. [task_key]"`; otherwise just `rm [plan_file]` (nothing to commit). Then go to STEP 6. After Step 6 completes, continue to Step 7.1 (re-run plan generation with the PRD as input) and return here.
- Edit → call the `AskUserQuestion` tool to ask what changes are needed, apply them, re-display the plan, return to this checkpoint.
- Open in app → open the plan (and PRD if it exists) per the OPEN IN APP RULE, then return to this checkpoint. Does not set any state.
- Quit → execute Quit Pattern.

**Auto-derive PR title prefix (Choice 3 only):** This lets the full workflow run uninterrupted through PR creation/update. Always derive — for both new and existing PRs — so the PR title is never malformed. Never ask the user.
1. Run: `git log [original_branch]..HEAD --oneline`
2. Count commits starting with `feat:`, `fix:`, `chore:`, or `docs:` (case-sensitive).
3. Majority prefix wins. Map `docs:` → `chore:`.
4. If no commits yet (e.g. a kept branch where the range is empty), all `docs:`, or no clear majority (including ties): default to `feat:`.

Display: "PR prefix: [pr_prefix] (derived from commit history)." Store as `config.pr_prefix`.

### Step 7.5b: File Cleanup Decision

Runs once after scope selection at Step 7.5 — never re-runs after an Edit loop back to 7.5. Decision set: `plan`, `review`, `state`, plus `prd` when `prd_skipped == false`.

Resolution logic and exact prompt shapes live in `plan-and-do-setup.md` → `## FILE CLEANUP DECISION (Step 7.5b)`. Result stored in state as `config.keep_files` — an OBJECT of booleans, one entry per file in the decision set.

### Step 7.6: Commit Plan

**If `is_git_repo`:** Append `PRD: [prd_file]` footer when `prd_file` exists.
```bash
git add [plan_dir]/PLAN-[task_key].md
git commit -m "$(cat <<'EOF'
docs: Add detailed plan for [task summary]. [task_key]

PRD: [prd_file relative to repo root, or omit footer if no PRD]
EOF
)"
```

---

## STEP 8: IMPLEMENTATION

**Context refresh:** Re-read plan file (and PRD if exists). Use files as authoritative source.

### Step 8.1: Execute Plan

**If agents_available AND `coding_agents` is not empty:**

Dispatch each task group to the agent and model that its `**Agent:**` / `**Model:**` lines name — the user approved those assignments at Step 7.5, follow them, do not re-decide. Apply the **DISPATCH NARRATION RULE** (`plan-and-do-delegation.md` → `## 13. DISPATCH NARRATION RULE`) before every Task call. Launch independent groups in parallel, in a single message with multiple Task calls. Serialize only when one group's output feeds another.

**If the plan carries no `Agent:`/`Model:` lines** (a plan written before this feature): display "Plan has no agent assignments. Choosing per task group." Then pick the agent per `plan-and-do-delegation.md` → `## 15. FILE PATH → AGENT MAP (Step 8.1)` and the tier by difficulty per `## DELEGATION`. Never fail on this.

Write each slice prompt to stand alone: exact file paths to touch, what to change, acceptance criteria, expected output format, what NOT to touch, and the Commit Scoping Rule (`git add [exact paths]`, never `git add -A`/`git add .`/`git commit -a`, and never `git push`). Also tell the agent not to run the project test suite — it reports what it changed, the orchestrator runs tests. **Exception:** test-runner dispatches (Step 9.1, Step 11.1) are exempt from the no-test-suite rule — running the suite is their entire purpose. Full contract in `plan-and-do-delegation.md` → `## 5. SLICE PROMPT CONTRACT`.

Each agent commits the work it produced. **If `prd_file` exists**, the commit message MUST end with `PRD: [prd_file]` per CLAUDE.md:
```
feat: [description]. [task_key]

PRD: [prd_file relative to repo root]
```
Omit the `PRD:` footer when no PRD exists.

**Record** each dispatch in state under `delegation.assignments`: task group, agent, model, verification method.

**Verify every slice.** Read the diff at minimum, or delegate a review slice to the matching reviewer agent one tier below the coder. Do NOT run the test suite per slice — it runs once after a parallel group finishes, and again at Step 9. Never two test runs at once.

**On failure, escalate:** two attempts per tier, then one tier up. You do the slice yourself only after `opus` fails twice — record it in `delegation.escalations` and flag it in the Step 13 summary. Full loop in `plan-and-do-delegation.md` → `## 8. ESCALATION LOOP`.

**Phase review (agents_available only):** If the plan has multiple phases or numbered task groups, treat each group as a phase. After each phase completes:
1. Apply the **REVIEWER SCOPE FILTER** (`plan-and-do-delegation.md` → `## 14. REVIEWER SCOPE FILTER`) — pick only the reviewers whose domain the phase touched. Launch them in parallel via Task tool, each with an explicit model — one tier below the coder that did the phase, floor of `sonnet` for security or architecture. Apply the DISPATCH NARRATION RULE from the same file.
2. Collect all reviewer findings. Delegate the fixes to the coding agent that owns the phase, with the findings in the prompt. Model: tier by severity — a typo is `haiku`, a security or design flaw is `opus`. Fix directly only when `coding_agents` is empty or `agents_available == false`. Failed fixes run the escalation loop.
3. Commit fixes: `fix: Address phase [N] review findings. [task_key]` (with `PRD:` footer if applicable)
4. Then proceed to the next phase.
5. **Record** each reviewer and fix dispatch in `delegation.assignments` — step "Phase [N] review: [agent]" / "Phase [N] fix".

This catches issues early, before they compound across phases.

**Test authoring phase (agents_available only):** After all implementation phases are committed, launch `test_coding_agents` to write tests for the new code. One runs per scope touched:

- Backend files changed → `be-test-coder` writes Playwright API tests under `backend/src/test/`
- Frontend files changed → `fe-test-coder` writes Jasmine specs colocated with sources

Model: default `sonnet`. `haiku` only for genuinely mechanical, spelled-out test edits. `opus` needs a named trigger — same triggers as Step 8.1 implementation slices: cross-cutting, unknown-cause, architecture, security.

Apply the **DISPATCH NARRATION RULE** (`plan-and-do-delegation.md` → `## 13. DISPATCH NARRATION RULE`). Launch in parallel when both scopes are touched. Each agent commits its test files: `test: Add tests for [description]. [task_key]` (with `PRD:` footer if applicable).

Then launch matching `test_review_agents` (`be-test-reviewer` / `fe-test-reviewer`) in parallel to review the new tests. Model: one tier below the test author that wrote what they're reviewing, floor `sonnet` for security-relevant tests. Auto-fix findings and commit: `fix: Address test review findings. [task_key]`. No user prompt.

Skip the test authoring phase when:
- The plan explicitly marks the change as test-inappropriate (e.g., a pure docs edit)
- No `test_coding_agents` exist for the changed scope

**Otherwise:** Implement directly:

For each task in PLAN:
1. Read relevant files — narrate: "Reading [file] to understand current implementation..."
2. Make changes (Edit/Write tools) — narrate: "Updating [file] to add [feature]..."
3. Explain briefly what was done
4. Mark task complete in PLAN file
5. **If `is_git_repo`:** Commit logical change groups: `feat: [description]. [task_key]` (with `PRD:` footer if applicable)

### Step 8.2: Interactive Assistance

If questions arise: explain the issue, then call the `AskUserQuestion` tool with numbered alternatives.

**Ticket mode:** If a blocking question cannot be answered or an error cannot be recovered (here or during testing in Step 9), run **TM.4 (Blocked + Human)** from `plan-and-do-modes.md` → `## TICKET MODE` with that question/error as the text, then STOP. This is how a ticket-mode run "asks a question or runs into an error": comment + move to "Wartet" + reassign to Human.

---

## STEP 9: TESTING

### Step 9.1: Run Tests

**If `test_runner_agents` is non-empty:** Launch each relevant runner in parallel via Task tool, model: `haiku`. Match by scope:
- Backend files changed → `be-test-runner`
- Frontend files changed → `fe-test-runner`
- Both scopes → launch both in parallel

Apply the **DISPATCH NARRATION RULE** (`plan-and-do-delegation.md` → `## 13. DISPATCH NARRATION RULE`). Collect each runner's pass/fail report.

**Otherwise:** Execute `[test_command]` directly.

### Step 9.2: Handle Results

**If tests pass:** Continue to Step 9.3.

**If tests fail:**
1. Show failures. Delegate the fix to the coding agent that owns the failing code, at the tier the failure warrants — a clear one-line break is `haiku`, an unknown cause is `opus`. Fix directly only when `coding_agents` is empty or `agents_available == false`. Record the dispatch in `delegation.assignments` (step "Test fix", agent, model, verification).
2. Commit fixes: `fix: Fix test failures. [task_key]`
3. Re-run tests
4. **If still failing:** run the escalation loop — two attempts per tier, then one tier up (see `plan-and-do-delegation.md` → `## 8. ESCALATION LOOP`). Record escalations in `delegation.escalations`.
5. **Only after the escalation loop is exhausted** (`opus` failed twice): show details, call the `AskUserQuestion` tool with: "What should I try next?" Apply guidance. Retry. **Never ask on the first failure.**

### Step 9.3: Implementation Complete — Auto-Advance

**This is NOT a user checkpoint. Never call AskUserQuestion here. Auto-advance per workflow_scope.**

Update state: `current_step` = "9.3".

Display artifact paths per the ARTIFACT PATH DISPLAY RULE.

Output: "All tests pass."

The user already chose `workflow_scope` at Step 7.5 — honor it without re-asking:

- `workflow_scope == "implement"` → Skip to STEP 13 (summary). Do NOT prompt.
- `workflow_scope == "implement-review"` or `"full"` → Announce "Continuing to code review." and proceed to STEP 10. Do NOT prompt.

To make changes instead, the user can interrupt and run `/plan-and-do <key> resume:8`.

---

## STEP 10: CODE REVIEW (LOCAL)

### Step 10.1: Invoke Review

Pick the invocation by whether `original_head` is set:

```
If `original_head` is set:    /project:review "embedded base:[original_head]"
If `original_head` is unset:  /project:review "embedded"
```

**Always invoke the project skill `project:review`** — never a plugin or global skill of the same base name (e.g. `bpf:review`). The `project:` prefix is required to disambiguate.

Pass `original_head` (the starting branch's commit, from `config.original_head`) as the review base. This scopes the review to changes made since the skill started — not main/master. When `original_head` is unset (e.g., non-git mode), use plain `/project:review "embedded"` so review defaults to main/master. Never pass the literal `base:[original_head]` — substitute the SHA or drop the token.

Wait for completion.

### Step 10.2: Analyze Findings

Read `[review_dir]/REVIEW-*.md`.

**No issues:** "Code review passed." → STEP 11.
**Issues found:** Display by severity (critical, warnings, suggestions).

### Step 10.3: Checkpoint 10

Update state: `current_step` = "10.3".

Display artifact paths per the ARTIFACT PATH DISPLAY RULE.

**If no issues:** Continue without prompting.

**If issues found:**
- `workflow_scope == "full"` AND this is the first review round → Auto-fix: delegate each finding to the coding agent that owns the file, tier by severity (a typo is `haiku`, a security or design flaw is `opus`). Group findings by agent and launch in parallel via Task tool. Fix directly only when `coding_agents` is empty or `agents_available == false`. Failed fixes run the escalation loop. Record each dispatch in `delegation.assignments` (step "Review fix: [file]"). Commit `fix: Address code review findings. [task_key]` (with `PRD:` footer if applicable), re-run `/project:review`, return to 10.2. No prompt.
- Second review round, OR `workflow_scope == "implement-review"`, OR the same finding survives → Call the `AskUserQuestion` tool with: 1-Fix findings, 2-Skip to summary, 3-Open review in app, 4-Quit.
  - Fix → delegate each finding to the coding agent that owns the file, tier by severity (a typo is `haiku`, a security or design flaw is `opus`). Group findings by agent and launch in parallel. Fix directly only when `coding_agents` is empty or `agents_available == false`. Failed fixes run the escalation loop. Record each dispatch in `delegation.assignments` (step "Review fix: [file]"). Commit, re-run `/project:review`, return to 10.2.
  - Skip → continue
  - Open → open `[review_dir]/REVIEW-*.md` per the OPEN IN APP RULE, then return to this checkpoint

**After Checkpoint 10 resolves (no issues or user chose Skip):** If `workflow_scope == "implement-review"`, skip to STEP 13 (summary). Do not ask — the user already chose this scope at plan approval.

---

## STEP 11: POST-REVIEW TESTING

### Step 11.1: Post-Review Verification

Code review may have changed implementation or test code. Re-run the relevant runners once to confirm the suite is still green.

**If `test_runner_agents` is non-empty:** Launch the same runners as Step 9.1 (match by scope) in parallel via Task tool, model: `haiku`. Apply the **DISPATCH NARRATION RULE** (`plan-and-do-delegation.md` → `## 13. DISPATCH NARRATION RULE`). Record the dispatch in `delegation.assignments` (step "Post-review testing: [agent]").

- All pass → continue to STEP 12
- Any fail → delegate the fix to the coding agent that owns the failing code, at the tier the failure warrants — a clear one-line break is `haiku`, an unknown cause is `opus`. Fix directly only when `coding_agents` is empty or `agents_available == false`. Record the dispatch in `delegation.assignments`. Commit `fix: Restore green tests after review. [task_key]`, re-run once. If still failing, surface the report and call the `AskUserQuestion` tool with: 1-Investigate (returns to STEP 8), 2-Skip to summary, 3-Quit. (This one-retry-then-ask flow is intentional, not a missing escalation ladder — Step 11.1 does not run the full two-attempts-per-tier loop from `## 8. ESCALATION LOOP` that Step 8.1/9.2 use. This step already had a working fix-and-recheck mechanism before the delegation feature existed, and PRD R9 chose to leave it unchanged rather than fold it into the ladder.)

**Otherwise (no agents):** Re-run `[test_command]` directly. Same fail-handling as above.

### Step 11.2: Advance to Documentation

**This is NOT a user checkpoint. Never call AskUserQuestion here.**

Update state: `current_step` = "11.2". → STEP 12. Step 12's full body lives in `plan-and-do-modes.md` → `## STEP 12: DOCUMENTATION UPDATES` — read it there.

---

## STEP 12: DOCUMENTATION UPDATES

Runs only for `workflow_scope == "full"`, right after Step 11.2.
Full step body lives in `plan-and-do-modes.md` → `## STEP 12: DOCUMENTATION UPDATES`. Step 12.3 (in that file) advances to Step 13.

---

## STEP 13: SUMMARY

### Step 13.0: Cleanup Planning Files

Use `config.keep_files` from Step 7.5b. No prompt — the user already decided.

Resolve and delete per `plan-and-do-setup.md` → `## CLEANUP RESOLUTION (Step 13.0)`. The review file resolves by `REVIEW-[branch_name].md`, NOT by task key. The state file is NOT touched here — it survives this step and is only deleted later, in Step 13.2 (below), which is fully self-contained.

Display the full absolute path of every file kept.

### Step 13.1: Display Summary

The table below gets one row per dispatch recorded in `delegation.assignments`, in run order.

```
=== Implementation Summary ===

Branch: [branch_name]
Task: [task_key]

Files Changed: [count]
Commits Created: [count]
Tests: [passed/failed counts]
Code Review: [issues found/no issues]

Agents & Models Used: [table below, or "None (direct mode)"]

| Step | Agent | Model | Verified by | Escalated |
|------|-------|-------|-------------|-----------|
| [e.g. "PRD draft", "PRD review: ba-reviewer", "Plan fix", "Implementation: [task group]", "Phase [N] review: [agent]", "Test fix", "Review fix: [file]", "Post-review testing: [agent]"] | [agent] | [tier] | [diff read / reviewer / tests / n/a] | [no, or "haiku -> sonnet"] |

[If any slice ran directly after opus failed twice, say so here.]

[If PRD exists and kept]: Specifications: [full absolute path to prd_file]
[If plan kept]: Plan: [full absolute path to plan_file]
[If review kept]: Review: [full absolute path to review file]
[If state kept]: State: [full absolute path to state_file]
[If ticket_mode]: Ticket: [ticket_url]  (final ticket status set in Step 13.4)

Commits:
[List SHAs and messages]

Next Steps:
- Review changes: git diff [original_branch]...[branch_name]
```

### Step 13.2: Mark State Complete

**If `is_git_repo`:** If state file exists: update `status` = "completed", commit. **Then, only after that commit:** if `config.keep_files.state == false`, delete the state file now (`git rm` for a tracked file, `rm -f` as a fallback) and commit: `docs: Remove state file. [task_key]`. If `config.keep_files.state` is `true`, or missing, keep the state file. No action needed.

**If NOT `is_git_repo`:** If state file exists: update `status` = "completed" (no commit — nothing to commit to). If `config.keep_files.state == false`, delete the state file with plain `rm -f` — no `git rm`, no commit. Otherwise keep it.

Nothing after this step may assume the state file still exists.

### Step 13.3: Post-Completion Workflow

Read `plan-and-do-modes.md` and execute "POST-COMPLETION WORKFLOW" section. This handles: cleanup uncommitted changes, push confirmation, PR creation, PR merge, and branch switch.

**CRITICAL:** PRs MUST target `original_branch` (the branch active when the skill started, stored in state file `config.original_branch`). Never default to main/master.

**Ticket mode — do not stop yet.** The POST-COMPLETION WORKFLOW ends with "STOP — workflow complete" (`plan-and-do-modes.md`, PC.5). When `ticket_mode = true`, treat that terminal STOP as "return here": note the `pr_url` / `pr_merged` it set, then **continue to Step 13.4** to mark the ticket Done (TM.3 in the same file, `## TICKET MODE`) before the skill actually ends. In non-ticket mode, PC.5's STOP is final as before.

### Step 13.4: Finish Ticket (ticket mode only)

**If `ticket_mode = false`:** Skip this step.

**If `ticket_mode = true`:** Run **TM.3 (Finish → Done)** from `plan-and-do-modes.md` → `## TICKET MODE` — the last step, so any PR created in Step 13.3 is already known and its URL goes into the Done comment. This moves the ticket to `DONE` ("Erledigt"). Run this on any successful completion regardless of `workflow_scope`. If the run ended by asking a question or hitting an unrecoverable error, TM.4 (Blocked + Human) already ran instead — do **not** also mark it Done.

Then display the final ticket status: on success `Ticket <id> → Erledigt (Done): [ticket_url]`; if that Done call failed, `Ticket <id> still In Arbeit — mark Done manually: [ticket_url]`.
