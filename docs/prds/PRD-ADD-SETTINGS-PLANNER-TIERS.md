# PRD: plan-and-do Skill Upgrade — Settings File + Model-Tier Delegation

## Source

User request. Upgrade package at `/Users/karsten/Downloads/bpf-plan-and-do-upgrade/` (`PROMPT.md` is the user's spec). Package holds verbatim blocks from a newer sibling of this skill: `01-config/CONFIG-LOADING.md`, `01-config/SKILL-EDITS.md`, `01-config/claude.bpf.example.json`, `02-planner/bpf-plan-and-do-delegation.md`, `02-planner/SKILL-EDITS.md`, `02-planner/planner.generic.md`, `02-planner/planner.example-project.md`, `03-shared/STATE-AND-TEMPLATES.md`.

Target: `.claude/skills/plan-and-do/SKILL.md` (1003 lines) and `.claude/skills/plan-and-do/plan-and-do-modes.md` (401 lines). Tooling only. No CRM app code, DB, or frontend changes.

## Problem Statement

Two gaps.

**No standing preferences.** Every run leaves PRD, plan, review, and state files behind. The user decides cleanup by hand, every time. No way to say "always delete the plan, always keep the review". No way to have Markdown artifacts open in the Mac app at a checkpoint.

**One model does everything.** Every `Task` dispatch runs on whatever model the agent's frontmatter pins. A rename costs the same as an architecture change. No planner agent exists, so the plan gets stitched together from parallel coder drafts. Slices go unverified. A failed slice has no escalation path — the orchestrator just retries or gives up.

Third problem, structural: SKILL.md is already 1003 lines. The package's own hard gate is 850. Adding content without extracting content makes it worse.

## Requirements

### R1 — Settings file `claude.atra.json`

Two locations. Global `~/.claude/claude.atra.json`. Local `[project-root]/claude.atra.json`.

- Skill creates either file when missing. Never overwrites an existing one. A failed Write warns and falls back to built-in defaults.
- Five keys, all namespaced under `planAndDo` (nested format: `.planAndDo.keepFiles.prd/plan/review/state`, `.planAndDo.openMd`): `keepFiles.prd`, `keepFiles.plan`, `keepFiles.review`, `keepFiles.state`, `openMd`. Each takes `always`, `never`, or `ask`. The `planAndDo` prefix keeps this skill's settings in their own corner of `claude.atra.json`, so other skills can write their own prefs into the same file under their own top-level key (the example config's `review.remainingIssuesScope` already does this) without colliding.
- Built-in defaults: `prd=always`, `plan=always`, `review=always`, `state=never`, `openMd=never`. **This is an intentional deviation from the package's verbatim defaults** (`prd=ask`, `plan=ask`, `state=ask`) — direct user instruction. Keep the human-readable artifacts (PRD/plan/review) by default; the state file is internal bookkeeping only, so it goes by default. Nobody gets asked on a typical run unless a config file overrides a key to `ask`.
- Precedence per key: valid local beats valid global beats built-in default. An invalid value falls through to the next level with a warning.
- Two formats parse: nested (`planAndDo.*`) and legacy flat (top-level `keepFiles`/`openMd`). Each file classified on its own. Malformed JSON → warn, treat as absent.
- Skill writes only the `planAndDo` namespace. Never another skill's namespace.
- Local file stays untracked. The skill never stages it, never commits it.
- Report both file paths, both statuses, all five resolved values with their source (`local`/`global`/`default`), plus a local-override note when local and global both hold valid values that differ.

Content comes verbatim from `01-config/CONFIG-LOADING.md`, with `claude.bpf.json` → `claude.atra.json` throughout.

### R2 — Config load order

New Step 3.3 (Load Config) runs inside docs-folder setup, **before** the state file gets written. Otherwise the state file stores nulls. Only Step 3.3 calls the loader.

- **Numbering collision — binding resolution.** SKILL.md today already has `### Step 3.3: Initialize State File`. Two steps cannot both be 3.3. So: the existing `Step 3.3: Initialize State File` renumbers to `### Step 3.4: Initialize State File`, and the new `### Step 3.3: Load Config` gets inserted **before** it. Two follow-on edits are mandatory. First, the JSON template inside the renumbered step holds the literal `"current_step": "3.3"` — that becomes `"current_step": "3.4"`. Second, `## TICKET MODE` says "Each fresh run creates a new state file (Step 3.3)" — that cross-reference becomes "(Step 3.4)". Grep for `3.3` after the renumber and check every hit points at the right step.

### R3 — Auto-open Markdown

- New `## OPEN IN APP RULE` section. Opens PRD, plan, review with `open [path]`, falls back to `open -a "Marked" [path]`. Never the state JSON.
- Non-macOS: `auto_open_md = false`, no prompt, skip silently.
- `openMd: ask` prompts exactly once, at Step 3.3, before Step 4. Never again.
- Automatic open fires only for artifacts new or changed since the last checkpoint, right after the artifact-path display, before the checkpoint choices.
- "Open in app" becomes a checkpoint choice regardless of `auto_open_md`. It returns to the same checkpoint. It never advances the workflow. Applies to the Standard Checkpoint (3 choices → 4), the Plan Approval checkpoint, and the Code Review checkpoint.

### R4 — Keep/delete decision and cleanup

- New Step 7.5b (File Cleanup Decision), once, after scope selection at Step 7.5, before the plan commit at Step 7.6.
- Decision set: `plan`, `review`, `state`, plus `prd` only when `prd_skipped == false`.
- `always` → keep, `never` → delete, `ask` → prompt. Zero `ask` files → no prompt. One → a single keep/delete question. Two or more → one multi-select question.
- Result stored as `config.keep_files`, an **object** of booleans. Never a single boolean.
- Step 13.0 deletes PRD, plan, and review per `keep_files`. Review resolves by **branch name** (`REVIEW-<branch_name>.md`), not task key. Missing entry means keep.
- The state file survives Step 13.0. Step 13.2 marks it complete, commits, and only then deletes it when `keep_files.state == false`.
- Non-git mode: plain `rm -f`, no `git rm`, no commit.

### R5 — Planner agent discovery

- AGENT DISCOVERY gains a `planner_agents` category: name ends `-planner`, or is exactly `planner`. The rule must sit before the "anything else → skip as utility" catch-all. The display block goes from eight lists to nine.
- No planner → today's path runs unchanged. Nothing errors.
- `coding_agents` empty → implementation and fixes go direct, reviews still delegate. Display the notice.

### R6 — New planner agent file

Create `.claude/agents/planner.md` from `02-planner/planner.generic.md`. Adapt Step 1 to this project's real modules (`backend/`, `frontend/`, `docs/specs/`, `.claude/`) and Step 3 to this project's real agent roster from `CLAUDE.md`. Frontmatter follows this project's pattern: `name`, `description`, explicit read-only `tools` (Read, Grep, Glob, WebSearch, WebFetch), `model: sonnet`.

Register it in `CLAUDE.md` `## Agents` using the existing **3-column** format (`Agent | Purpose | Type`). An agent file with no table row stays invisible to the skill.

### R7 — Explicit model on every dispatch

Every `Task` dispatch in SKILL.md and its reference files names an explicit `model`. Agent picks the domain. Model picks the difficulty. The `model` parameter beats the agent's frontmatter `model:`.

Tiers by dispatch type:

| Dispatch | Tier rule |
|---|---|
| PRD draft, plan draft | `opus` complex, `sonnet` small. Never `haiku`. |
| Implementation slice (Step 8.1) | Default `sonnet`. `opus` only with a named trigger: cross-cutting, unknown-cause debugging, architecture, security. |
| Review of a draft or diff | One tier below the work. Floor `sonnet` for security or architecture. |
| Fix after review | Same tier as the draft (drafts) or by severity (code): typo `haiku`, security/design flaw `opus`. |
| Test fix (Step 9.2) | Clear one-line break → `haiku`. Unknown cause → `opus`. |
| `be-test-runner`, `fe-test-runner` | Always `haiku`. |
| **Test authoring** (`be-test-coder`, `fe-test-coder`) | Default `sonnet`. `haiku` only for mechanical spelled-out test edits. `opus` needs a named trigger. |
| **Test review** (`be-test-reviewer`, `fe-test-reviewer`) | One tier below the test author. Floor `sonnet` for security-relevant tests. |
| **Tooling coders** (`python-coder`, `shell-coder`, `skill-coder`) | Default `sonnet`. `haiku` for mechanical edits. `opus` needs a named trigger. |
| **Tooling reviewers** (`python-reviewer`, `shell-reviewer`, `skill-reviewer`) | One tier below the coder. Floor `sonnet` for security or portability-critical work. |

The last four rows extend the package's own rules to dispatch points this project has and the package's sibling did not. Same principles, no new ones.

`fable` is never a worker. The orchestrator is a role, not a tier — never a dispatch target.

### R8 — Slice contract, verification, escalation

- Every slice prompt stands alone: exact paths, what to change, acceptance criteria, output format, what not to touch, the Commit Scoping Rule, and "do not run the project test suite" (coding slices only, never test runners).
- Every coding slice gets verified. Diff read at minimum, or a delegated review one tier below the coder.
- Tests never run per slice. Once after a parallel group, and again at Step 9. Never two test runs at the same time.
- Escalation: two attempts per tier, then one tier up. The orchestrator takes the slice itself only after `opus` fails twice, and flags it in the summary.
- Test failures and review findings run the same ladder. The user gets asked only after the ladder is spent — never on the first failure.

### R9 — Planner-aware drafting

- Step 6.2 (PRD): draft order of preference — first `planner_agent`, else `ba-writer` / first writer, else first coder, else direct. Then review, then fix. Each with an explicit model.
- Step 7.3 (plan): points at the delegation reference file's plan draft/review/fix cycle. With a planner, one dispatch writes the whole plan, no merge. Without one, all coding agents draft in parallel and the orchestrator merges. Review and fix run either way.
- Step 8.1 follows the plan's `**Agent:**` / `**Model:**` lines. It does not re-decide. A plan without those lines falls back to choosing per task group and never fails.
- Step 11.1 (post-review testing) keeps its existing `test_runner_agents` dispatch, unchanged from today, and just gets tagged `model: haiku` per the test-runner rule in R7. The package's Edit 9 tiers post-review testing off `review_agents` because its sibling project has no test runners at that point; this project dispatches real `be-test-runner` / `fe-test-runner` there, so that part of Edit 9 is intentionally not adopted.

### R10 — Plan structure and state file

- Plan template gains `## Summary`, `## Business Summary`, and `**Agent:**` + `**Model:**` lines on every task group — including Test Implementation and Verification. Direct mode writes `**Agent:** direct`, `**Model:** n/a`.
- State file gains `config.keep_settings`, `config.keep_files`, `config.open_md_setting`, `config.auto_open_md`, `discovery.planner_agents`, and a `delegation` object with `assignments` and `escalations`.
- Every dispatch writes an `assignments` entry: step label, agent, model, verification method. Every escalation writes an `escalations` entry: slice, from-tier, to-tier, reason.
- Legacy state files degrade silently. Missing `delegation`, `assignments`, `escalations`, or `planner_agents` read as empty and get created on the next write. Missing `keep_settings` falls back to built-in defaults. Missing `keep_files` keeps everything. Legacy boolean `keep_files` maps: `true` → keep all, `false` → delete prd/plan/state, keep review. Missing `auto_open_md` defaults to `false`. No warning, no error.

### R11 — Summary, help, doctor

- Step 13.1 prints an "Agents & Models Used" table: one row per dispatch, in run order, with Step, Agent, Model, Verified by, Escalated. Plus kept-file paths and any orchestrator takeover note.
- Help mentions both features: the config file and its five keys, and model-tier delegation with the planner agent.
- Doctor gains an ATRA Config Check. It reports both file paths and status (`existing`/`missing` — doctor never creates files), resolves all five keys with sources, and reports `openMd` without ever prompting. Doctor also lists `planner_agents` in the discovered-agents report. A maintainer note records that doctor duplicates the CONFIG LOADING rules by hand and both must change together.

### R12 — Commit scoping

Add a Commit Scoping Rule near the top of SKILL.md: every commit stages exact paths. Never `git add -A`, `git add .`, or `git commit -a`. Above all, the local `claude.atra.json` stays untracked.

### R13 — File layout and line budget

New files:

| File | Content |
|---|---|
| `.claude/skills/plan-and-do/plan-and-do-setup.md` | The verbatim CONFIG LOADING section |
| `.claude/skills/plan-and-do/plan-and-do-delegation.md` | The verbatim delegation rules, trimmed per Special Instructions |
| `.claude/agents/planner.md` | The adapted planner agent |
| `claude.atra.example.json` (repo root) | The documented example config |

SKILL.md must end **at or under 850 lines**. New detail lives in the two new reference files.

Do the math first. Both features together add roughly **+180 to +220 lines** to SKILL.md before any extraction — even after the bulk of the prose already sits in the reference files. SKILL.md is 1003 lines today. The hard gate is 850. So roughly **350–370 lines must leave SKILL.md**, not the ~70 that `## TICKET MODE` alone buys. One extraction is not enough. Two concrete moves:

- **`## TICKET MODE` (all of TM.1–TM.4) moves into the existing `plan-and-do-modes.md`.** That file already holds HELP MODE, DOCTOR MODE, and the resume router. TICKET MODE is a special mode too, so it belongs there — and this avoids creating a third new reference file. Leave a short pointer in SKILL.md.
- **Config-driven prose moves into `plan-and-do-setup.md`, next to CONFIG LOADING.** Three pieces: the full prose of the new `## OPEN IN APP RULE` section, the resolution logic of the new Step 7.5b (File Cleanup Decision), and the resolution logic of the rewritten Step 13.0 (Cleanup Planning Files). All three are config-driven behavior, same as CONFIG LOADING itself. SKILL.md keeps only the short step trigger plus a pointer for each — mirroring how Step 3.3 just points at that file for CONFIG LOADING.

Step 7 of the workflow — the plan, not this PRD — does the final line count. If these two moves still miss 850, the plan extracts further. The PRD sets the direction, not the exact final byte count.

Every cross-reference from Steps 1, 4.6, 8.2, 13.3, 13.4, and the Quit Pattern must keep working.

Every touched file ends at or under 850 lines.

### R14 — Version bump

Bump `version` to `2.0.0` and set `last-modified` in the frontmatter, and update the same version and date in the `## SKILL HEADER` block the skill prints. All three must match. Add `Bash(open:*)` to `allowed-tools`.

## Special Instructions

**Naming — binding.**

- `claude.atra.json` everywhere the package says `claude.bpf.json`. Example file is `claude.atra.example.json`. This renames the settings files only — not the skill, not its reference files.
- New reference files follow this project's existing no-prefix convention: `plan-and-do-setup.md` and `plan-and-do-delegation.md`. No `bpf-` prefix.
- All in-skill command mentions become `/plan-and-do help` and `/plan-and-do doctor`.

**Do not touch the existing root `claude.bpf.json`.** It is tracked, legacy flat format, and belongs to the separate installed `bpf-plan-and-do` plugin skill. The upgraded project skill never reads, writes, or deletes it.

**Test-runner scoping stays as-is.** This project already matches `be-test-runner` / `fe-test-runner` by backend/frontend scope in Steps 9.1 and 11.1. Keep that mechanism. Do **not** adopt the package's `paths`-based scoping and do **not** add a "File Patterns" column to `CLAUDE.md` — the package's `bpf-plan-and-do-test-scoping.md` was not shipped, so that mechanism cannot be reproduced faithfully. Test runners still get tagged `model: haiku`.

**Trims to the delegation reference file.** Report every trim.

- § 7 item 3 → `**Run tests or the build.** Only after a parallel group finishes, never per slice.` Drop the `paths` sentences and the `bpf-plan-and-do-test-scoping.md` reference.
- § 2 last line and § 4 table row about test runners → keep, but name this project's runners.
- § 9f → adapt the registration example to this project's real 3-column `## Agents` table. Delete the "third column" / File Patterns block and its test-scoping reference.
- § 10 last line → retarget the `bpf-plan-and-do-templates.md` pointer to wherever the plan structure actually lands.
- § 9g → `/plan-and-do doctor`.

**Ground rules from PROMPT.md are binding.**

1. Match steps by name and purpose, never by number. Report any step whose content had to land somewhere else.
2. Do not reword pasted verbatim text. CONFIG LOADING and the delegation file are verbatim. Behavior lives in the exact wording. Renames and the listed trims are the only edits.
3. Nothing that works today may break. Missing config file, missing planner, legacy state file, non-macOS, non-git mode, ticket mode, direct mode — all degrade to today's behavior.
4. Writing style: short and brief. Short sentences. Simple words. No passive voice. Sentence fragments fine.
5. Feature 1 first. It is smaller and independent. Then feature 2.

## Implementation Approach

Four phases.

**Phase A — extraction.** Move the chosen bulky section(s) out of SKILL.md into a reference file. Leave pointers. Verify every cross-reference still resolves. This buys the line budget before anything grows.

**Phase B — feature 1.** Create `plan-and-do-setup.md` with the verbatim CONFIG LOADING section. Apply the nine SKILL.md touch points: commit scoping rule, OPEN IN APP RULE, artifact-path auto-open hook, four-choice checkpoints, CONFIG LOADING pointer plus Step 3.3, state keys, Step 7.5b, Step 13.0 and 13.2 cleanup, resume and help/doctor text. Copy the example config to the repo root.

**Phase C — feature 2.** Copy the delegation file, apply the trims. Add the `## DELEGATION` summary to SKILL.md. Extend AGENT DISCOVERY with `planner_agents`. Rewrite Steps 6.2, 7.3, 8.1, 9.2, 10.3, 11.1 to name models and record dispatches. Add the state `delegation` object, the plan template lines, and the Step 13.1 table. Create and adapt `.claude/agents/planner.md`. Register it in `CLAUDE.md`.

**Phase D — tier extension and verification.** Apply the R7 tier rules to the test-authoring, test-review, and tooling dispatch points the package does not cover. Then walk the acceptance checklist, grep every `Task` dispatch for a `model`, and count lines on every touched file.

## Test Strategy

No automated tests. Manual verification, run in this order.

**Static checks.**

- Line count per touched file ≤ 850.
- Grep every `Task` mention in SKILL.md and both reference files. Each dispatch names a model.
- Grep for `git add -A`, `git add .`, `git commit -a`. Zero hits.
- Grep for `claude.bpf.json` and `bpf-plan-and-do` inside the skill directory. Zero hits.
- `claude.atra.example.json` parses as JSON.
- Frontmatter version, `last-modified`, and the printed SKILL HEADER agree.

**Command checks.**

- `/plan-and-do doctor` — reports both config paths, the five resolved keys with sources, and lists `planner` under discovered agents.
- `/plan-and-do help` — mentions the config file and model-tier delegation.

**Scenario walk-throughs** (dry read of the flow, plus at least one live run):

- No config file anywhere → both get created, defaults resolve, nothing gets staged.
- Local file with an invalid value → falls through to global, warning shown.
- Legacy flat local file next to a nested global file → both parse.
- `openMd: ask` → one prompt before Step 4, none later.
- `keepFiles` with zero, one, and two-plus `ask` entries → no prompt, single question, multi-select.
- `keep_files.state = false` → state file survives Step 13.0, dies in Step 13.2.
- Legacy state file with no `delegation` and no `keep_files` → resumes clean, keeps everything, no warning.
- Planner row removed from `CLAUDE.md` → old path runs, no error.
- Ticket-mode run after the extraction → claim, question, and done paths all still work.

## Non-Functional Requirements

- **Size.** SKILL.md ≤ 850 lines, target ≤840 (revised from an initial ~800 estimate once the plan's actual extraction scope — TICKET MODE, STEP 12, and the AGENT DISCOVERY family — was known). Every reference file ≤ 850.
- **Backward compatibility.** No breaking change to existing runs, state files, plans, or the ticket flow.
- **Fidelity.** Verbatim blocks stay verbatim. Only the documented renames and trims.
- **Style.** Project markdown style: short sentences, active voice, empty line before lists and code blocks.
- **Safety.** No destructive default. Nothing deletes without a resolved setting or an explicit user answer. No `git push` from a slice.
- **Isolation.** Tooling change only. Zero CRM app files touched.

## Success Criteria

### Feature 1 — settings file

- [ ] Config loads at Step 3.3, before the state file gets written.
- [ ] Both `claude.atra.json` locations get created when missing. Neither ever gets overwritten.
- [ ] The local `claude.atra.json` is never staged and never committed. No `git add -A` anywhere in the skill.
- [ ] Per key: local beats global beats built-in default. An invalid value falls through instead of winning.
- [ ] Nested (`planAndDo.*`) and legacy flat (top-level `keepFiles`/`openMd`) both parse. Each file classified on its own.
- [ ] `openMd: ask` prompts exactly once, before Step 4 — never again at a checkpoint.
- [ ] Non-macOS sets `auto_open_md = false` and skips the prompt entirely.
- [ ] "Open in app" is a choice at every checkpoint, whatever `auto_open_md` says. It returns to the same checkpoint and never advances the workflow.
- [ ] Auto-open fires only for artifacts new or changed since the last checkpoint. Never the state JSON.
- [ ] Step 7.5b asks once, after scope selection. Zero `ask` files → no prompt. One → single question. Two or more → one multi-select.
- [ ] `config.keep_files` is stored as an OBJECT of booleans, never a single boolean.
- [ ] Step 13.0 deletes PRD/plan/review. The state file survives to Step 13.2 and dies there.
- [ ] Review file resolves by branch name, not task key.
- [ ] A state file with no `keep_files` keeps everything and never errors.
- [ ] The existing root `claude.bpf.json` stays untouched.

### Feature 2 — planner and model tiers

- [ ] Agent discovery has a `planner_agents` category — `-planner` suffix, or exactly `planner`.
- [ ] No planner defined → the old path runs unchanged. Nothing errors.
- [ ] `coding_agents` empty → implementation and fixes go direct, reviews still delegate.
- [ ] Every Task dispatch in the skill names an explicit `model`. Grep for `Task` and check each one.
- [ ] The plan's task groups carry `**Agent:**` and `**Model:**` lines — including Test Implementation and Verification.
- [ ] Step 8.1 follows those lines instead of re-deciding. A plan without them falls back to choosing per group, and never fails.
- [ ] Implementation slices default to `sonnet`. `opus` needs a named trigger.
- [ ] Reviews run one tier below the work, floored at `sonnet` for security or architecture.
- [ ] `be-test-runner` and `fe-test-runner` dispatches always run at `haiku`. Their backend/frontend scope matching is unchanged.
- [ ] Test-authoring, test-review, and tooling dispatches all carry a tier that follows the same principles.
- [ ] Every coding slice gets verified — diff read at minimum.
- [ ] Escalation: two attempts per tier, then one tier up. The orchestrator only takes over after `opus` fails twice, and flags it in the summary.
- [ ] Tests never run per slice.
- [ ] Test failures escalate through the ladder first. The user gets asked only after the ladder is spent — never on the first failure.
- [ ] `delegation.assignments` and `delegation.escalations` exist in the state file and get written at every dispatch.
- [ ] The Step 13.1 summary prints one row per dispatch, in run order.
- [ ] A legacy state file with no `delegation` object reads as empty — no warning, no error.
- [ ] `.claude/agents/planner.md` exists, is adapted to this project, and has a row in the 3-column `## Agents` table in `CLAUDE.md`.

### Both

- [ ] Every touched file is at or under 850 lines.
- [ ] Version number bumped — in the frontmatter AND in the header the skill prints.
- [ ] `/plan-and-do help` mentions both features.
- [ ] `/plan-and-do doctor` reports the config resolution and lists planner agents.
- [ ] Ticket mode, non-git mode, and direct mode all still work after the extraction.
- [ ] Every trim and every place this copy differed from the package is reported.

## Implementierung

Implemented on branch `add-settings-planner-tiers`.

Commits:
- `bb058ef` docs: Add specifications (PRD) for plan-and-do settings file and model-tier delegation
- `ee66059` docs: Add detailed plan for plan-and-do settings file and model-tier delegation
- `a67e276` feat: Add settings file and model-tier delegation to plan-and-do skill
- `3ef20c6` fix: Name the real test-runner agents in the delegation reference

PR: not yet created
