# Implementation Plan: ADD-SETTINGS-PLANNER-TIERS

## Summary

Upgrade `.claude/skills/plan-and-do/` with two features from the package at `/Users/karsten/Downloads/bpf-plan-and-do-upgrade/`: a `claude.atra.json` settings file (keep/delete per artifact, auto-open Markdown) and model-tier delegation (a `planner` agent plus an explicit `model` on every `Task` dispatch, with verification and an escalation ladder). SKILL.md is 1003 lines today and the hard gate is 850, so the work starts with extraction: `## TICKET MODE`, `## STEP 12`, the state-file JSON template, the plan template, and the `## AGENT DISCOVERY` family all move into reference files, leaving pointers. New detail lands in two new reference files — `plan-and-do-setup.md` and `plan-and-do-delegation.md` — never in SKILL.md. Main risk: cross-references. Eight call sites point into TICKET MODE and eight more into the AGENT DISCOVERY family; each move needs a grep gate before the next phase starts.

## Business Summary

The workflow tool gets two upgrades. First, standing preferences: the user says once which planning documents to keep and whether documents open automatically, instead of deciding by hand every run. Second, cost and quality control: each piece of work goes to a helper sized to the job, gets checked, and moves up to a stronger helper only when it fails. A new planning helper writes the whole plan in one go, so plans read as one document instead of stitched-together pieces.

## Test Command

`N/A — manual verification only (see Verification tasks below)`

---

## Line budget

Do the math before any content grows. Estimates ±15 %. Re-measure at every gate.

| # | Move or add | Δ SKILL.md | Running |
|---|---|---|---|
| — | Today | — | 1003 |
| A1 | Renumber Step 3.3 → 3.4 | 0 | 1003 |
| A2 | `## TICKET MODE` → `plan-and-do-modes.md` | −65 | 938 |
| A3 | `## STEP 12: DOCUMENTATION UPDATES` → `plan-and-do-modes.md` | −38 | 900 |
| A4 | State-file JSON template → new `plan-and-do-setup.md` | −49 | 851 |
| A5 | Usage comment, Branch Protection, Success Criteria, References trims | −30 | 821 |
| B3 | Feature 1 SKILL.md touch points | +52 | 873 |
| C4 | AGENT DISCOVERY family + Step 8.1 file-map → `plan-and-do-delegation.md` | −57 | 816 |
| C5 | Feature 2 SKILL.md edits (incl. −26 for plan template + Step 7.3 body) | +47 | 863 |
| D1 | Tier extension (test authoring, test review, tooling) | +6 | 869 |
| D3 | Contingency trims (ranked list, apply until ≤840) | −25 … −44 | 825–844 |

Hard gate 850. Target ≤840. Every reference file also ≤850.

---

## Tasks

### 1. Phase A1 — Renumber the state-file step

**Agent:** skill-coder
**Model:** haiku — three spelled-out string edits, exact strings named below.

Order rationale: renumber **before** the TICKET MODE move. All three `3.3` hits sit in one file right now, so one grep pass finds them all. Move first and one of them lands in a second file, where it is easy to miss.

- [ ] In `.claude/skills/plan-and-do/SKILL.md`, rename heading `### Step 3.3: Initialize State File` → `### Step 3.4: Initialize State File` (today line 397).
- [ ] Inside that step's JSON template, change `"current_step": "3.3"` → `"current_step": "3.4"` (today line 406).
- [ ] In `## TICKET MODE` → `### TM.1 — Resolve & verify`, change "creates a new state file (Step 3.3)" → "(Step 3.4)" (today line 267).
- [ ] Grep `3\.3` in SKILL.md. Confirm the only remaining hits are `### Step 13.3: Post-Completion Workflow` and the Step 13.4 sentence that mentions "Step 13.3". Report the hit list.
- [ ] Do not add `### Step 3.3: Load Config` yet. That is task 9.

### 2. Phase A2 — Extract `## TICKET MODE`

**Agent:** skill-coder
**Model:** opus — named trigger: cross-cutting move with eight cross-references across two files; a missed reference silently breaks ticket mode.

- [ ] Cut `## TICKET MODE` from SKILL.md — heading through `### TM.4 — Question / error → Blocked + Human`, including the intro prose, the board-terminology table, the Config block, and the admin-session comment block (today lines 221–289).
- [ ] Paste it verbatim into `.claude/skills/plan-and-do/plan-and-do-modes.md` as a new top-level section, placed after `## DOCTOR MODE` and before `## STEP RESUME ROUTER`.
- [ ] Leave in SKILL.md, at the same spot, a pointer section `## TICKET MODE` — max 5 lines: what triggers it (ticket URL or bare integer in Step 1), that TM.1–TM.4 live in `plan-and-do-modes.md` → `## TICKET MODE`, and the four call sites (Step 1, Step 4.6, Step 8.2, Step 13.4).
- [ ] Fix every cross-reference so it names the file: `## REUSABLE PATTERNS` → `### Quit Pattern` item 3 (TM.4 mention) and item 4; `### Step 1: Check for Existing Checkpoint` Path A ticket-detection bullet; `### Step 3.4: Initialize State File` ticket-mode note; `### Step 4.6: Claim Ticket`; `### Step 8.2: Interactive Assistance`; `### Step 13.3: Post-Completion Workflow` ticket-mode paragraph; `### Step 13.4: Finish Ticket`. Also the usage comment at the top of SKILL.md ("see ## TICKET MODE").
- [ ] Grep `TM\.[1-4]` and `TICKET MODE` across both files. Every hit in SKILL.md must name `plan-and-do-modes.md`. Report the list.

### 3. Phase A3 — Extract `## STEP 12: DOCUMENTATION UPDATES`

**Agent:** skill-coder
**Model:** sonnet — same move pattern as A2 but only three inbound references.

- [ ] Cut `## STEP 12: DOCUMENTATION UPDATES` from SKILL.md — intro paragraphs plus `### Step 12.1: Run the doc-sync skill`, `### Step 12.2: Commit the result`, `### Step 12.3: Advance to Summary` (today lines 881–922).
- [ ] Paste verbatim into `plan-and-do-modes.md` as `## STEP 12: DOCUMENTATION UPDATES`, placed after the new `## TICKET MODE` section and before `## STEP RESUME ROUTER`.
- [ ] Leave a 4-line pointer in SKILL.md at the same spot: when it runs (`workflow_scope == "full"`, after Step 11.2), that the body lives in `plan-and-do-modes.md`, and that Step 12.3 advances to Step 13.
- [ ] Update `### Step 11.2: Advance to Documentation` to point at the reference file.
- [ ] Update `plan-and-do-modes.md` → `## STEP RESUME ROUTER` → "**Step 12: Documentation Updates**" so its "Continue to STEP 12: DOCUMENTATION UPDATES" resolves inside the same file.

### 4. Phase A4 — Extract the state-file template into the new setup file

**Agent:** skill-coder
**Model:** sonnet — new file plus one pointer; needs judgment on what stays in SKILL.md.

- [ ] Create `.claude/skills/plan-and-do/plan-and-do-setup.md`. Header: title `# Plan and Do — Setup & Config Reference`, one line saying SKILL.md reads sections from here. No YAML frontmatter (matches `plan-and-do-modes.md`).
- [ ] Move the JSON template out of `### Step 3.4: Initialize State File` (today lines 401–447) into a new setup-file section `## STATE FILE TEMPLATE`. Carry the ticket-mode note (today line 451) with it.
- [ ] SKILL.md keeps `### Step 3.4: Initialize State File` at ~6 lines: write `[state_dir]/STATE-[task_key].json` with the Write tool using the template in `plan-and-do-setup.md` → `## STATE FILE TEMPLATE`; do not git add/commit yet; committed on the new branch in Step 4.5.
- [ ] Update `## Context Recovery` and `plan-and-do-modes.md` → `## STEP RESUME ROUTER` if either quotes template keys.

### 5. Phase A5 — Trim the header and footer blocks

**Agent:** skill-coder
**Model:** sonnet — editorial condensation, not mechanical; must not drop a rule.

- [ ] Condense the HTML usage comment at the top of SKILL.md (today lines 27–38) to 5 lines: the four usage forms, `$ARGUMENTS`, prerequisites. Drop the four `Example:` lines — `plan-and-do-modes.md` → `## HELP MODE` already carries them.
- [ ] Condense `## Branch Protection` (today lines 40–49) to 5 lines: new-branch rule, PR Target Rule, non-git mode, review scope. Keep every named variable (`original_branch`, `original_head`, `is_git_repo`).
- [ ] Move `## Success Criteria` (today lines 985–996) to `plan-and-do-modes.md`, appended to `## HELP MODE` under a `Success Criteria:` block inside the displayed help text.
- [ ] Delete `## References` (today lines 998–1003). `plan-and-do-modes.md` → `## HELP MODE` → "File Locations" already lists the same four paths; add the review path there if missing.
- [ ] Do not touch any rule text in `## FILE PATH DISPLAY RULE`, `## HOW TO ASK THE USER FOR DECISIONS`, or `### Forbidden Input Patterns`.

### 6. Phase A6 — Extraction gate

**Agent:** skill-reviewer
**Model:** sonnet — one tier below the opus extraction in task 2; judgment needed on reference resolution.

- [ ] Run `wc -l` on `.claude/skills/plan-and-do/SKILL.md`, `plan-and-do-modes.md`, `plan-and-do-setup.md`. Report all three. SKILL.md must be ≤825. Stop and report if it is not.
- [ ] Grep SKILL.md for `TICKET MODE`, `TM.1`, `TM.2`, `TM.3`, `TM.4`, `STEP 12`, `STATE FILE TEMPLATE`, `Step 3.3`, `Step 3.4`. Confirm every hit either names the target reference file or is a heading.
- [ ] Read the moved sections in `plan-and-do-modes.md` and `plan-and-do-setup.md`. Confirm the text is byte-identical to what left SKILL.md, except the `(Step 3.4)` fix from task 1.
- [ ] Confirm SKILL.md still runs the ticket path end to end on a dry read: Step 1 → TM.1, Step 4.6 → TM.2, Step 8.2 → TM.4, Step 13.4 → TM.3, Quit Pattern → no TM.4.
- [ ] Gate: Phase B and Phase C SKILL.md edits do not start until this task reports pass.

### 7. Phase B1 — Write `plan-and-do-setup.md` content

**Agent:** skill-coder
**Model:** sonnet — verbatim copy with five named deviations; fidelity matters more than volume.

Runs in parallel with tasks 8, 11, 12, 13. Serializes with task 4 (same file) and with task 15 (same file).

- [ ] Append `## CONFIG LOADING` to `plan-and-do-setup.md`, copied verbatim from `01-config/CONFIG-LOADING.md` — the whole section including `### Create Missing Config Files`, `### Read Config Files`, `### Resolve Settings`, `### Store and Display`, `### Resolve Auto-Open Decision`. Drop the package file's own intro paragraphs above the `---`.
- [ ] When copying content from `01-config/SKILL-EDITS.md` (Edit 2, Edit 7, Edit 8), copy only the fenced code block. The "Edit N — ..." heading and its lead-in sentence above the fence are editorial scaffolding from the package, not skill content — do not paste them.
- [ ] Rename `claude.bpf.json` → `claude.atra.json` at every occurrence — intro sentence, both location bullets, the local-override "Note:" line, the untracked-local sentence. Report the count.
- [ ] Deviation 1 (PRD R1): the default JSON in `### Create Missing Config Files` becomes `prd: "always"`, `plan: "always"`, `review: "always"`, `state: "never"`, `openMd: "never"`.
- [ ] Deviation 2 (PRD R1): the "Built-in defaults:" line in `### Resolve Settings` becomes `prd` = `always`, `plan` = `always`, `review` = `always`, `state` = `never`, `openMd` = `never`.
- [ ] Keep the `planAndDo`-namespace paragraph in `### Create Missing Config Files` verbatim — it is R1's "other skills own their own key" rule. Change nothing but the filename.
- [ ] Append `## OPEN IN APP RULE` — the full prose from `01-config/SKILL-EDITS.md` Edit 2, verbatim.
- [ ] Append `## FILE CLEANUP DECISION (Step 7.5b)` — the resolution logic from Edit 7, verbatim, with the fallback-defaults line changed to the new built-in defaults from Deviation 2.
- [ ] Append `## CLEANUP RESOLUTION (Step 13.0 and Step 13.2)` — the path mapping, the per-file keep/delete rule, the `git rm --ignore-unmatch` + `rm -f` + commit block, the "this commit skips the state file on purpose" paragraph, and the Step 13.2 delete-after-commit paragraph, from Edit 8, verbatim. Add one sentence: in non-git mode use plain `rm -f`, no `git rm`, no commit (PRD R4).
- [ ] Extend `## STATE FILE TEMPLATE` with the four feature-1 keys under `config`: `keep_settings` (object of four strings), `keep_files: null`, `open_md_setting`, `auto_open_md`. Add the Edit 6 note below the template: `keep_settings` comes from Step 3.3 and is never null; `keep_files` stays null until Step 7.5b and is then an OBJECT of booleans, never a single boolean.
- [ ] Report every deviation from the package text as a list.

### 8. Phase B2 — `claude.atra.example.json`

**Agent:** skill-coder
**Model:** haiku — copy one file, change five string values.

Runs in parallel with tasks 7, 11, 12, 13.

- [ ] Copy `/Users/karsten/Downloads/bpf-plan-and-do-upgrade/01-config/claude.bpf.example.json` to the repo root as `claude.atra.example.json`.
- [ ] Set `planAndDo.keepFiles` to `prd: "always"`, `plan: "always"`, `review: "always"`, `state: "never"`, and `planAndDo.openMd` to `"never"`.
- [ ] Keep the `review.remainingIssuesScope` block. It shows another skill's namespace living in the same file — that is the point of the `planAndDo` prefix.
- [ ] No filename strings inside the JSON. Do not add comments — JSON has none.
- [ ] Do not touch the existing repo-root `claude.bpf.json`. It belongs to the separately installed `bpf-plan-and-do` plugin skill and stays exactly as it is.

### 9. Phase B3 — Feature 1 touch points in SKILL.md

**Agent:** skill-coder
**Model:** sonnet — nine edits with paste-ready text, but placement and checkpoint renumbering need care.

Serializes after task 6 and task 7. Blocks task 15 (same file, overlapping checkpoint regions).

- [ ] Frontmatter: add `Bash(open:*)` to `allowed-tools`.
- [ ] Add the Commit Scoping Rule as a new 4-line block right after `## Branch Protection`, before `## PLAN MODE CHECK`. Text verbatim from `01-config/SKILL-EDITS.md` Edit 1, with `claude.bpf.json` → `claude.atra.json`.
- [ ] Add `## OPEN IN APP RULE` after `## ARTIFACT PATH DISPLAY RULE`, before `## HOW TO ASK THE USER FOR DECISIONS`. Max 7 lines: `open [path]` with `open -a "Marked" [path]` fallback; PRD, plan, review only, never the state JSON; macOS only, skip silently elsewhere; the manual choice returns to the same checkpoint and never advances; automatic fires only for new-or-changed artifacts; full rules in `plan-and-do-setup.md` → `## OPEN IN APP RULE`.
- [ ] In `## ARTIFACT PATH DISPLAY RULE`, add the "New or changed since the last checkpoint" definition and the `config.auto_open_md == true` auto-open hook line, both verbatim from Edit 3.
- [ ] In `### Standard Checkpoint`, go from three choices to four. Insert "Open in app" between Edit and Quit, wording from Edit 4.
- [ ] In `### Step 6.4: Checkpoint 6 — PRD Approval`, change the choice list to 1-Continue, 2-Edit, 3-Open in app, 4-Quit.
- [ ] In `### Step 7.5: Checkpoint 7 — Plan Approval`, insert "Open in app — Open the plan (and PRD if it exists) per the OPEN IN APP RULE, then return to this checkpoint" as the second-to-last choice, above Quit. Update the "**Numbering:**" paragraph: `prd_skipped = false` now presents six options — `1, 2, 3, 4-Edit, 5-Open in app, 6-Quit` (Edit stays 4, Open in app becomes 5, Quit becomes 6); `prd_skipped = true` presents seven — `1, 2, 3, 4-Create PRD, 5-Edit, 6-Open in app, 7-Quit`. Add the Open-in-app branch to the choice-mapping list below it.
- [ ] In `### Step 10.3: Checkpoint 10`, change the issues-found prompt to 1-Fix findings, 2-Skip to summary, 3-Open review in app, 4-Quit. Open opens `[review_dir]/REVIEW-*.md` and returns to the same checkpoint.
- [ ] Add `## CONFIG LOADING` as a 5-line pointer section next to the other setup rules (after `## Context Recovery`): read `plan-and-do-setup.md` → `## CONFIG LOADING`; it creates any missing `claude.atra.json`, reads global and local, resolves `keep_settings`, `open_md_setting`, `auto_open_md`; Step 3.3 is the only caller.
- [ ] Insert `### Step 3.3: Load Config` in `## STEP 3: DOCS FOLDER SETUP`, between `### Step 3.2: Create Subdirectories` and `### Step 3.4: Initialize State File`. Body: 3 lines, pointer + the reason (Step 3.4 must never write nulls).
- [ ] Insert `### Step 7.5b: File Cleanup Decision` between `### Step 7.5: Checkpoint 7 — Plan Approval` and `### Step 7.6: Commit Plan`. Body ≤8 lines: runs once after scope selection, never after an Edit loop; decision set is `plan`, `review`, `state`, plus `prd` when `prd_skipped == false`; resolution logic and prompt shapes live in `plan-and-do-setup.md` → `## FILE CLEANUP DECISION (Step 7.5b)`; result stored as `config.keep_files`, an OBJECT of booleans.
- [ ] Replace `### Step 13.0: Planning Files` with `### Step 13.0: Cleanup Planning Files`. Body ≤7 lines: use `config.keep_files` from Step 7.5b, no prompt; resolve and delete per `plan-and-do-setup.md` → `## CLEANUP RESOLUTION`; review resolves by `REVIEW-[branch_name].md`, not task key; the state file survives this step; display the absolute path of every kept file.
- [ ] Extend `### Step 13.2: Mark State Complete`: after the completion commit, delete the state file when `config.keep_files.state == false` and commit `docs: Remove state file. [task_key]`. Keep it when the entry is `true` or missing. Add: nothing after this step may assume the state file exists.
- [ ] In `### Step 13.1: Display Summary`, make the artifact lines conditional — `[If PRD exists and kept]`, `[If plan kept]`, `[If review kept]`, `[If state kept]` — per `03-shared/STATE-AND-TEMPLATES.md` § 3.
- [ ] Remove nothing else. Report any Edit whose content had to land at a different step name than the package assumed (expected: the state-file keys landed in `plan-and-do-setup.md` → `## STATE FILE TEMPLATE`, written at Step 3.4 not Step 4.5).

### 10. Phase B4 — Feature 1 touch points in `plan-and-do-modes.md`

**Agent:** skill-coder
**Model:** sonnet — doctor mode duplicates the loader by hand; wording must match.

Serializes after task 7 (needs the final CONFIG LOADING text to mirror). Blocks task 16 (same file).

- [ ] In `## HELP MODE` → "Features:", add the config-file line from Edit 9, with `claude.bpf.json` → `claude.atra.json`.
- [ ] In `## HELP MODE` → "File Locations:", add the two Edit 9 lines about `planAndDo.keepFiles` and `planAndDo.openMd`, renamed to `claude.atra.json`, with the new built-in defaults.
- [ ] In `## DOCTOR MODE`, insert a new check **3. ATRA Config Check** after "Repository Check". Renumber the existing checks 3, 4, 5 to 4, 5, 6. Content per Edit 9: both absolute paths and `existing`/`missing` status (doctor never creates files), JSON validation with the malformed warning, nested-vs-flat detection per file, five keys resolved local → global → default with sources, `openMd` reported without ever prompting, the local-override note with the same qualifying rule.
- [ ] Doctor's "no config" line uses the new defaults: `prd=always, plan=always, review=always, state=never, openMd=never`.
- [ ] Add the maintainer NOTE from Edit 9 directly under the new check.
- [ ] In `## STEP RESUME ROUTER` → "**Restore variables from state.**", add `config.keep_files` (object; absent/null → keep all with the display line; legacy `true` → keep all; legacy `false` → delete prd/plan/state, keep review), `config.keep_settings` (informational), `config.auto_open_md` (absent → `false`). Text verbatim from Edit 9.

### 11. Phase C1 — Create `plan-and-do-delegation.md`

**Agent:** skill-coder
**Model:** sonnet — verbatim copy plus five named trims and two renames.

Runs in parallel with tasks 7, 8, 12, 13.

- [ ] Copy `/Users/karsten/Downloads/bpf-plan-and-do-upgrade/02-planner/bpf-plan-and-do-delegation.md` to `.claude/skills/plan-and-do/plan-and-do-delegation.md`.
- [ ] Rename the title to `# Plan and Do — Delegation & Model Selection` and the line below it to name the `plan-and-do` skill. Report both.
- [ ] Trim 1 — § 7 item 3 becomes exactly: `**Run tests or the build.** Only after a parallel group finishes, never per slice.` Delete the `paths` sentences and the `bpf-plan-and-do-test-scoping.md` reference.
- [ ] Trim 2 — § 2 last line and the § 4 table row stay, but name this project's runners: `be-test-runner` / `fe-test-runner` instead of `test-runner-*`.
- [ ] Trim 3 — § 9f: replace the two-column example with this project's real 3-column shape (`| Agent | Purpose | Type |`) and a `planner` row plus one existing row. Delete the "third column" / File Patterns block and its `bpf-plan-and-do-test-scoping.md` reference entirely.
- [ ] Trim 4 — § 10, both occurrences of the `bpf-plan-and-do-templates.md` pointer: retarget them to `## 11. PLAN STRUCTURE (Step 7.3)` in this same file.
- [ ] Trim 5 — § 9g: `/bpf-plan-and-do doctor` → `/plan-and-do doctor`.
- [ ] Append `## 11. PLAN STRUCTURE (Step 7.3)` from `03-shared/STATE-AND-TEMPLATES.md` § 2 — `## Summary`, `## Business Summary`, `## Test Command`, `## Tasks` with `**Agent:**` / `**Model:**` on every group including Test Implementation and Verification, `## Tests`. Keep the closing paragraph about the fallback when the lines are missing, and the direct-mode `**Agent:** direct` / `**Model:** n/a` rule.
- [ ] Grep the finished file for `bpf-plan-and-do` and `claude.bpf`. Zero hits.
- [ ] Report every trim and rename with before/after.

### 12. Phase C2 — Create `.claude/agents/planner.md`

**Agent:** skill-coder
**Model:** sonnet — adaptation needs real knowledge of this repo's modules and roster.

Runs in parallel with tasks 7, 8, 11, 13.

- [ ] Copy `02-planner/planner.generic.md` to `.claude/agents/planner.md`.
- [ ] Frontmatter: `name: planner`; `description` as in the generic file; `tools: Read, Grep, Glob, WebSearch, WebFetch`; `model: sonnet`. No `project:` key (that is the example project's own field).
- [ ] Adapt Step 1 to this repo's real modules: `backend/` (Express + Drizzle + libSQL, routes / services / middleware / db / seed), `frontend/` (Angular 21 standalone, `src/app/features`, `src/app/core`), `docs/specs/` (the spec set the plan must respect), `.claude/` (skills, agents, prompts). Name the closest-existing-example rule per module: read an existing route before adding one, an existing feature component before adding one.
- [ ] Adapt Step 3 to this repo's real roster from `CLAUDE.md` → `## Agents`, grouped by domain: business — `ba-writer`, `ba-reviewer`, `requirements-reviewer`; backend — `be-coder`, `be-reviewer`; database — `db-coder`, `db-reviewer`; frontend — `fe-coder`, `fe-reviewer`; UI — `ui-designer`, `ui-reviewer`; tests — `be-test-coder`, `be-test-reviewer`, `be-test-runner`, `fe-test-coder`, `fe-test-reviewer`, `fe-test-runner`; tooling — `python-coder`, `python-reviewer`, `shell-coder`, `shell-reviewer`, `skill-coder`, `skill-reviewer`; ops — `admin`.
- [ ] Add one line in Step 3: test runners always run at `haiku`; coding and review agents never run a suite themselves.
- [ ] Keep Steps 2, 4, 5, 6, the Output format block, and the Writing style block verbatim.
- [ ] Keep the `## Summary` / `## Business Summary` opening rule verbatim.

### 13. Phase C3 — Register `planner` in `CLAUDE.md`

**Agent:** skill-coder
**Model:** haiku — one table row in a known 3-column format.

Runs in parallel with tasks 7, 8, 11, 12.

- [ ] Add one row to `CLAUDE.md` → `## Agents`, first row in the table (planning comes before everything): `| planner | Draft PRDs and implementation plans, assign agent + model tier per task group | planning |`.
- [ ] Leave the `## Spec Reading Lists` table alone. `planner` is a general tooling agent like `skill-*`, so add it to the sentence naming the non-domain-bound agents if that sentence needs updating — check the "The `python-*`, `shell-*`, and `skill-*` agents are general tooling agents" line and extend it to include `planner`.
- [ ] Change nothing else in `CLAUDE.md` or `AGENTS.md`.

### 14. Phase C4 — Move the AGENT DISCOVERY family into the delegation file

**Agent:** skill-coder
**Model:** opus — named trigger: cross-cutting move with eight inbound references across five workflow steps; this is the second-largest correctness risk after TICKET MODE.

Serializes after task 6, task 9, and task 11.

- [ ] Cut `## AGENT DISCOVERY` (today lines 160–182), `## DISPATCH NARRATION RULE` (184–196), and `## REVIEWER SCOPE FILTER` (198–211) from SKILL.md.
- [ ] Paste them into `plan-and-do-delegation.md` as `## 12. AGENT DISCOVERY`, `## 13. DISPATCH NARRATION RULE`, `## 14. REVIEWER SCOPE FILTER`. Text unchanged.
- [ ] Also cut the file-pattern → agent mapping table from `### Step 8.1: Execute Plan` (today lines 717–727) into `## 15. FILE PATH → AGENT MAP (Step 8.1)` in the same file.
- [ ] In `## 12. AGENT DISCOVERY`, add the `planner_agents` category — "Names ending `-planner`, or exactly `planner`" — as a new rule placed **before** the "Anything else → skip as utility" catch-all, and after the `-reviewer` rule. Renumber the rules. Change "Display all eight lists" to "Display all nine lists". Note: rule 0 (tooling-agent prefix match) still runs first and would catch a hypothetical `skill-planner`-style name before this rule — document this precedence in the rule text, not just here.
- [ ] Leave in SKILL.md a `## AGENT DISCOVERY` pointer of ≤8 lines: read `plan-and-do-delegation.md` §§ 12–14 to classify agents from `CLAUDE.md` → `## Agents`; results feed `discovery.*` in the state file; timing unchanged — the first step that needs an agent triggers it; no agents → "No agents found. Running in direct mode.", `agents_available = false`. Plus the three notes from `02-planner/SKILL-EDITS.md` Edit 2: the model-override note, the `planner_agents` is optional note, and the empty-`coding_agents` note.
- [ ] Retarget all eight inbound references so each names the file and section: Step 6.2 (two), Step 8.1 (two), the test-authoring block, Step 9.1, Step 11.1, and the phase-review block.
- [ ] In `### Step 8.1: Execute Plan`, replace the removed table with a one-line pointer to `## 15. FILE PATH → AGENT MAP (Step 8.1)`.
- [ ] Grep SKILL.md for `AGENT DISCOVERY`, `DISPATCH NARRATION`, `REVIEWER SCOPE FILTER`. Every hit must name `plan-and-do-delegation.md` or be the pointer heading.

### 15. Phase C5 — Feature 2 dispatch edits in SKILL.md

**Agent:** skill-coder
**Model:** sonnet — ten spelled-out edits with paste-ready text from the package.

Serializes after task 14. Also edits `plan-and-do-setup.md` → serializes after task 7.

- [ ] Add `## DELEGATION` after `## REUSABLE PATTERNS`, before the `## AGENT DISCOVERY` pointer. Text verbatim from `02-planner/SKILL-EDITS.md` Edit 1, with the final pointer renamed to `plan-and-do-delegation.md`.
- [ ] Rewrite `### Step 6.2: Generate Specifications (PRD)` per Edit 3: draft order first `planner_agent`, else `ba-writer` / first `writer_agent`, else first `coding_agent`, else direct; model `opus` complex / `sonnet` small, never `haiku`; review one tier below with a `sonnet` floor for security or architecture; fix at the draft's tier, delegated to the drafting agent; the `delegation.assignments` record line.
- [ ] Replace the body of `### Step 7.3: Generate Detailed Plan` with a pointer to `plan-and-do-delegation.md` → `## 10. STEP 7.3: PLAN DRAFT/REVIEW/FIX CYCLE`, plus one sentence on the short version (planner writes the whole plan in one dispatch, no merge; without one, all coding agents draft in parallel and the orchestrator merges; review and fix run either way).
- [ ] Delete the inline plan-structure code block from Step 7.3. Point at `plan-and-do-delegation.md` → `## 11. PLAN STRUCTURE (Step 7.3)` instead.
- [ ] Rewrite `### Step 8.1: Execute Plan` per Edit 6: follow the plan's `**Agent:**` / `**Model:**` lines, never re-decide; fallback when the lines are missing, with the display line, never fail; slice prompts stand alone (paths, what to change, acceptance criteria, output format, what not to touch, the Commit Scoping Rule, no `git push`, do not run the project test suite); record each dispatch in `delegation.assignments`; verify every slice (diff read minimum); escalate two attempts per tier then one tier up.
- [ ] Rewrite the phase-review block in Step 8.1 per Edit 6's phase-review text: reviewer one tier below the coder with a `sonnet` floor, fixes delegated with tier by severity, record step labels "Phase [N] review: [agent]" / "Phase [N] fix".
- [ ] Rewrite `### Step 9.2: Handle Results` per Edit 7: fix delegated to the owning coding agent at the warranted tier (clear one-line break → `haiku`, unknown cause → `opus`); the escalation ladder; `AskUserQuestion` only after the ladder is spent, never on the first failure.
- [ ] In `### Step 10.3: Checkpoint 10`, rewrite the Fix branch per Edit 8: delegate per finding to the owning coding agent, tier by severity, group by agent and launch in parallel, direct only when `coding_agents` is empty, record as "Review fix: [file]".
- [ ] In `### Step 11.1: Post-Review Verification`, keep the existing `test_runner_agents` dispatch and its backend/frontend scope matching exactly as-is. Add `model: haiku` to the dispatch and one record line ("Post-review testing: [agent]"). **Do not adopt Edit 9's `review_agents`-based tiering** — PRD R9 rejects it because this project has real test runners here. Note this in the deviation report.
- [ ] In `## Context Recovery`, add the legacy-state tolerance note from Edit 10 verbatim.
- [ ] In `### Step 13.1: Display Summary`, add the "Agents & Models Used" table from `03-shared/STATE-AND-TEMPLATES.md` § 3 — columns Step, Agent, Model, Verified by, Escalated; one row per `delegation.assignments` entry in run order; the orchestrator-takeover note line. Keep the existing `Agents Used:` line only if it does not duplicate the table — otherwise replace it.
- [ ] In `plan-and-do-setup.md` → `## STATE FILE TEMPLATE`, add `discovery.planner_agents: []` and the top-level `delegation` object with `assignments: []` and `escalations: []`. Add the "What goes in `delegation`" paragraph and the legacy-state paragraph from `03-shared/STATE-AND-TEMPLATES.md` § 1 below the template.

### 16. Phase C6 — Feature 2 touch points in `plan-and-do-modes.md`

**Agent:** skill-coder
**Model:** sonnet — help text must stay readable inside one printed block.

Serializes after task 10 (same file).

- [ ] In `## HELP MODE` → "Features:", add the model-tier delegation line from `02-planner/SKILL-EDITS.md`.
- [ ] In `## HELP MODE` → "Agent Support:", add the planner line, then the whole `Delegation:` block and the `Planner agent (optional):` block, with the reference file renamed to `plan-and-do-delegation.md`.
- [ ] In `## DOCTOR MODE` → the agent-discovery check, list `planner_agents` alongside the other categories.
- [ ] In `## HELP MODE` → the Success Criteria block added in task 5, append the four criteria from `02-planner/SKILL-EDITS.md` "Success criteria to add".

### 17. Phase D1 — Extend tiers to this project's own dispatch points

**Agent:** skill-coder
**Model:** sonnet — applies existing R7 rules to four dispatch sites; no new rules.

Serializes after task 15.

- [ ] In `### Step 8.1: Execute Plan` → the test-authoring phase, add explicit models: `be-test-coder` / `fe-test-coder` default `sonnet`, `haiku` only for mechanical spelled-out test edits, `opus` needs a named trigger.
- [ ] Same block: `be-test-reviewer` / `fe-test-reviewer` run one tier below the test author, floor `sonnet` for security-relevant tests.
- [ ] In the `## AGENT DISCOVERY` pointer and in `plan-and-do-delegation.md` → `## 12. AGENT DISCOVERY` rule 0, add the tooling-tier rule: `python-coder`, `shell-coder`, `skill-coder` default `sonnet`, `haiku` for mechanical edits, `opus` needs a named trigger; `python-reviewer`, `shell-reviewer`, `skill-reviewer` one tier below the coder, floor `sonnet` for security or portability-critical work.
- [ ] In `### Step 9.1: Run Tests`, tag the `be-test-runner` / `fe-test-runner` dispatch `model: haiku`. Leave the scope-matching mechanism untouched.
- [ ] Add the R7 tier table to `plan-and-do-delegation.md` § 4 as four extra rows: test authoring, test review, tooling coders, tooling reviewers. Mark them as this project's extension of the same principles.

### 18. Phase D2 — Version bump

**Agent:** skill-coder
**Model:** haiku — three spelled-out values in two places.

Serializes after task 17.

- [ ] SKILL.md frontmatter: `version: 2.0.0`, `last-modified:` set to the date the work lands.
- [ ] `## SKILL HEADER` block: `Plan and Do (v2.0.0, <same date>)`.
- [ ] Confirm frontmatter and header agree character for character.

### 19. Phase D3 — Line-budget gate and contingency trims

**Agent:** skill-coder
**Model:** sonnet — needs judgment on what to cut without losing a rule.

Serializes after task 18 and task 16.

- [ ] Run `wc -l` on SKILL.md, `plan-and-do-modes.md`, `plan-and-do-setup.md`, `plan-and-do-delegation.md`, `.claude/agents/planner.md`. Report all five.
- [ ] If SKILL.md ≤840, stop here and report. Otherwise apply the trims below, in this order, until it is ≤840. Report each one applied and each one skipped.
- [ ] Trim T1 (−6): move the "Auto-derive PR title prefix (Choice 3 only)" block out of `### Step 7.5` into `plan-and-do-modes.md` → `## POST-COMPLETION WORKFLOW` → `### PC.2`, where `pr_prefix` is consumed. Leave a one-line pointer in Step 7.5.
- [ ] Trim T2 (−8): compress `### Step 7.6: Commit Plan` to reference the HEREDOC pattern already spelled out in `### Step 6.5: Commit PRD` instead of repeating it.
- [ ] Trim T3 (−6): condense the `### Step 10.1: Invoke Review` prose to the two invocation forms plus the `project:` prefix rule and the substitute-the-SHA warning.
- [ ] Trim T4 (−4): condense the `### Step 4.4: Create and Push Branch` capture paragraph, keeping every variable name.
- [ ] Trim T5 (−20): move `### Step 1: Check for Existing Checkpoint` Path B (the resumable-state scan and its numbered list) into `plan-and-do-modes.md` next to `## STEP RESUME ROUTER`, leaving a 3-line pointer. Apply this one last — it touches the entry path.
- [ ] Hard gate: SKILL.md ≤850. Every reference file ≤850. Stop and report if any file misses.
- [ ] If all five trims (T1–T5) still leave SKILL.md over 850, stop and report the overage with a list of remaining large sections by line count, for a follow-up decision — do not guess at further cuts.

### 20. Test Implementation — static, command, and scenario checks

**Agent:** skill-reviewer
**Model:** sonnet — the scenario walk-throughs need reading comprehension, not just greps.

Serializes after task 19. This project has no automated tests for skill Markdown, so "tests" here are the PRD's Test Strategy checks, run by hand.

- [ ] Static: `wc -l` every touched file. Record each count. All ≤850, SKILL.md ideally ≤840.
- [ ] Static: grep `Task` in SKILL.md, `plan-and-do-setup.md`, `plan-and-do-delegation.md`, `plan-and-do-modes.md`. List every dispatch site. Each one names a `model`. Report any site without one.
- [ ] Static: grep `git add -A`, `git add \.`, `git commit -a` across the skill directory. Zero hits.
- [ ] Static: grep `claude.bpf.json` and `bpf-plan-and-do` inside `.claude/skills/plan-and-do/`. Zero hits. Do **not** flag the repo-root `claude.bpf.json` file itself — it is out of scope and must stay.
- [ ] Static: parse `claude.atra.example.json` as JSON. Confirm the five `planAndDo` values match the new defaults and the `review` namespace survived.
- [ ] Static: SKILL.md frontmatter `version` + `last-modified` match the `## SKILL HEADER` block. `Bash(open:*)` present in `allowed-tools`.
- [ ] Static: `.claude/agents/planner.md` frontmatter has `name: planner`, read-only `tools`, `model: sonnet`. `CLAUDE.md` → `## Agents` has the matching row.
- [ ] Static: grep the repo root — `claude.bpf.json` unchanged (compare against `git status`, must not appear).
- [ ] Command: run `/plan-and-do doctor`. It reports both config paths and statuses, five resolved keys with sources, lists `planner` under discovered agents, and never prompts.
- [ ] Command: run `/plan-and-do help`. It mentions the config file with its five keys and model-tier delegation with the planner agent.
- [ ] Scenario: no config file anywhere → both files get created, defaults resolve, nothing gets staged.
- [ ] Scenario: local file with an invalid value → falls through to global, warning shown.
- [ ] Scenario: legacy flat local file next to a nested global file → both parse, classified independently.
- [ ] Scenario: `openMd: ask` → exactly one prompt at Step 3.3, before Step 4, none at any checkpoint.
- [ ] Scenario: `keepFiles` with zero, one, and two-plus `ask` entries → no prompt, single question, one multi-select.
- [ ] Scenario: `keep_files.state = false` → the state file survives Step 13.0 and dies in Step 13.2, after the completion commit.
- [ ] Scenario: legacy state file with no `delegation` and no `keep_files` → resumes clean, keeps everything, no warning.
- [ ] Scenario: planner row removed from `CLAUDE.md` → Step 6.2 falls back to `ba-writer`, Step 7.3 falls back to parallel coders + merge, no error.
- [ ] Scenario: ticket-mode run after the extraction → claim (TM.2), question (TM.4), and done (TM.3) paths all resolve.
- [ ] Scenario: non-git mode → Step 13.0 uses plain `rm -f`, no `git rm`, no commit.
- [ ] Scenario: `coding_agents` empty → implementation and fixes go direct, reviews still delegate, notice displayed.

### 21. Verification — acceptance checklist walk

**Agent:** skill-reviewer
**Model:** sonnet — judgment call per line; reports pass/fail, never edits.

Serializes after task 20.

- [ ] Walk `docs/prds/PRD-ADD-SETTINGS-PLANNER-TIERS.md` → `## Success Criteria` → "Feature 1" (15 lines). Report pass/fail per line with the file and section that proves it.
- [ ] Walk the same PRD's "Feature 2" list (18 lines). Same reporting.
- [ ] Walk the same PRD's "Both" list (6 lines). Same reporting.
- [ ] Walk `/Users/karsten/Downloads/bpf-plan-and-do-upgrade/PROMPT.md` → `## Acceptance checklist`, all three blocks, line by line. Map its `claude.bpf.json` lines to `claude.atra.json` and its `/bpf-plan-and-do` lines to `/plan-and-do`. Report pass/fail per line.
- [ ] Produce the deviation report PROMPT.md asks for: every trim to the delegation file, every rename, every place this copy differed from the package, and every step whose content had to land somewhere else. Known entries so far — the state-file template lives in `plan-and-do-setup.md` and is written at Step 3.4, not Step 4.5; Step 11.1 keeps `test_runner_agents` and rejects Edit 9's `review_agents` tiering; the built-in defaults deviate from the package; the package's `paths`-based test scoping is not adopted; `## AGENT DISCOVERY`, `## STEP 12`, and `## TICKET MODE` moved to reference files for line budget.
- [ ] Produce a diff summary: which files changed, which are new, line counts for each.
- [ ] Confirm no CRM app file changed — grep the branch diff for `backend/`, `frontend/`, `api/`, `docs/specs/`. Zero hits outside `docs/prds/`, `docs/plans/`, `.claude/`, `CLAUDE.md`, and `claude.atra.example.json`.
- [ ] Note in the final report: this repo has no `install.sh`, so nothing needs re-running. A Claude Code restart still picks up the new agent file.

---

## Parallelism

- **Serial chain on SKILL.md** — tasks 1 → 2 → 3 → 4 → 5 → 6 → 9 → 14 → 15 → 17 → 18 → 19. Every one of these edits SKILL.md. Feature 1 and feature 2 both touch the checkpoint patterns, the state template, and Steps 6/7/8/13, so they cannot run in parallel. Feature 1 first, per PROMPT.md ground rule 5.
- **Parallel batch 1** — tasks 7, 8, 11, 12, 13 all write files nobody else is holding (`plan-and-do-setup.md` after task 4 creates it, `claude.atra.example.json`, `plan-and-do-delegation.md`, `.claude/agents/planner.md`, `CLAUDE.md`). Launch them together once task 6 passes.
- **Serial chain on `plan-and-do-modes.md`** — tasks 2 → 3 → 5 → 10 → 16. Four separate edits to one file.
- **Serial chain on `plan-and-do-setup.md`** — tasks 4 → 7 → 15 (the state-template extension).
- **Merge points** — task 14 needs task 11 finished (it appends to the delegation file). Task 15 needs tasks 7, 11, and 14. Task 19 needs both chains done: task 18 (end of the SKILL.md chain) and task 16 (end of the `plan-and-do-modes.md` chain) — it measures and can also write to `plan-and-do-modes.md` via trim T5. Task 20 needs everything.
- **Gates** — task 6 blocks all of Phase B and Phase C. Task 19 blocks task 20. Task 20 blocks task 21.

---

## Tests

### Static Checks

- [ ] `wc -l` on all five touched files — every one ≤850, SKILL.md ≤840. Verifies R13 and the non-functional size requirement.
- [ ] Every `Task` dispatch in SKILL.md and the three reference files names a `model`. Verifies R7 and PROMPT.md's "grep for Task" line.
- [ ] Zero hits for `git add -A`, `git add .`, `git commit -a` in the skill directory. Verifies R12 and keeps the local `claude.atra.json` untracked.
- [ ] Zero hits for `claude.bpf.json` and `bpf-plan-and-do` inside `.claude/skills/plan-and-do/`. Verifies the binding rename. The repo-root `claude.bpf.json` file itself stays and is not a hit to fix.
- [ ] `claude.atra.example.json` parses as JSON and carries `prd=always, plan=always, review=always, state=never, openMd=never` plus the `review` namespace. Verifies R1's deviation and the namespace story.
- [ ] SKILL.md frontmatter `version: 2.0.0` and `last-modified` match the printed `## SKILL HEADER`. `Bash(open:*)` present. Verifies R14.
- [ ] Every cross-reference into a moved section names its new file: TICKET MODE (8 sites), STEP 12 (3), AGENT DISCOVERY family (8), state template (2), plan structure (1). Verifies R13's "every cross-reference keeps working".
- [ ] `git status` shows the repo-root `claude.bpf.json` unmodified. Verifies the Special Instruction.

### Command Checks

- [ ] `/plan-and-do doctor` — both config paths with `existing`/`missing`, five keys resolved with sources, `openMd` reported without a prompt, `planner` listed under discovered agents. Verifies R11.
- [ ] `/plan-and-do help` — names `claude.atra.json` with its five keys and the model-tier delegation with the planner. Verifies R11.

### Scenario Walk-throughs

- [ ] Config precedence: invalid local → valid global wins with a warning; valid local ≠ valid global → local wins plus the override note. Verifies R1.
- [ ] Format detection: legacy flat local next to nested global — both parse, classified independently. Verifies R1.
- [ ] `openMd: ask` prompts once at Step 3.3, before Step 4, and never at a checkpoint. Non-macOS sets `auto_open_md = false` with no prompt. Verifies R3.
- [ ] "Open in app" is a choice at the Standard Checkpoint, the PRD checkpoint, the Plan Approval checkpoint, and the Code Review checkpoint. It returns to the same checkpoint and never advances. Verifies R3.
- [ ] Step 7.5b with zero, one, and two-plus `ask` entries → no prompt, single question, one multi-select. `config.keep_files` stored as an object. Verifies R4.
- [ ] Delete order: Step 13.0 removes PRD/plan/review (review by branch name), the state file survives to Step 13.2 and dies there. Non-git mode uses plain `rm -f`. Verifies R4.
- [ ] Legacy state file with no `delegation`, no `keep_files`, no `keep_settings`, no `auto_open_md` → resumes clean, keeps everything, no warning. Verifies R10.
- [ ] Planner row removed from `CLAUDE.md` → Step 6.2 and Step 7.3 fall back to the old path, nothing errors. Verifies R5 and R9.
- [ ] `coding_agents` empty → implementation and fixes direct, reviews still delegate, notice shown. Verifies R5.
- [ ] Ticket mode after the extraction: claim, question, and done paths all resolve, plus Quit leaving the ticket In Arbeit. Verifies R13's cross-reference requirement.
- [ ] Escalation: two attempts per tier, then one tier up; the user is asked only after `opus` fails twice; the takeover is flagged in the Step 13.1 summary. Verifies R8.
- [ ] Tests never run per slice — once after a parallel group, once at Step 9, once at Step 11.1, never two at the same time. Verifies R8.
