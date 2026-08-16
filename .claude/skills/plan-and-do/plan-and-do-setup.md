# Plan and Do — Setup & Config Reference

Reference file for the plan-and-do skill. SKILL.md reads specific sections from this file on demand.

---

## STATE FILE TEMPLATE

```json
{
  "version": 1,
  "task_key": "[task_key]",
  "status": "in_progress",
  "current_step": "3.4",
  "started": "[ISO timestamp]",
  "updated": "[ISO timestamp]",
  "config": {
    "input_mode": "freeform",
    "user_description": "[user_description]",
    "special_instructions": null,
    "ticket_mode": false,
    "ticket_id": null,
    "ticket_url": null,
    "ticket_api_base": null,
    "ticket_claimed": false,
    "branch_name": null,
    "original_branch": null,
    "original_head": null,
    "docs_folder": "[docs_folder]",
    "is_git_repo": true,
    "workflow_scope": null,
    "pr_prefix": null,
    "pr_exists": null,
    "pr_url": null,
    "keep_settings": {
      "prd": "[keep_settings.prd]",
      "plan": "[keep_settings.plan]",
      "review": "[keep_settings.review]",
      "state": "[keep_settings.state]"
    },
    "keep_files": null,
    "open_md_setting": "[open_md_setting]",
    "auto_open_md": [auto_open_md]
  },
  "discovery": {
    "agents_available": false,
    "planner_agents": [],
    "writer_agents": [],
    "coding_agents": [],
    "review_agents": [],
    "test_coding_agents": [],
    "test_review_agents": [],
    "test_runner_agents": [],
    "tooling_coding_agents": [],
    "tooling_review_agents": [],
    "test_command": null
  },
  "artifacts": {
    "prd_skipped": null,
    "prd_file": null,
    "plan_file": null
  },
  "delegation": {
    "assignments": [],
    "escalations": []
  },
  "completed_steps": []
}
```

`config.keep_settings` comes from Step 3.3 and is never null. `config.keep_files` stays null until Step 7.5b, then becomes an OBJECT of per-file booleans (e.g. `{ "plan": true, "state": false }`), never a single boolean. `auto_open_md` is a literal `true`/`false` boolean, not a quoted string — the unquoted `[auto_open_md]` placeholder in the template above gets replaced with the literal boolean value.

### What goes in `delegation`

`delegation.assignments` records one entry per subagent dispatch, of any kind — PRD/plan draft, review, fix, implementation slice, phase review, test fix, post-review testing: step label, agent, model, verification method. `delegation.escalations` records slice, from-tier, to-tier, reason. Both stay empty in direct mode. Step 13.1 prints every recorded entry.

**Legacy state files:** a state file written before a feature existed lacks its keys. Treat a missing `delegation` object, `delegation.assignments`, `delegation.escalations`, or `discovery.planner_agents` as empty (`{}` / `[]`) and create it on the next write. Never warn, never error. The same tolerance already covers `config.keep_settings` (falls back to built-in defaults — see `## FILE CLEANUP DECISION (Step 7.5b)` below), `config.keep_files` (stays `null` until Step 7.5b runs), and `config.auto_open_md` (defaults to `false`).

**Ticket mode:** when `ticket_mode = true` (TM.1 in `plan-and-do-modes.md` → `## TICKET MODE` ran in Step 1), write the **real** resolved values into this file now — `ticket_mode: true` plus the actual `ticket_id`, `ticket_url`, and `ticket_api_base` — not the defaults above. These gates (`ticket_mode` especially) are re-read after context compression per `## Context Recovery`; if they stay `false`/`null` here, a compacted run silently loses ticket mode and the ticket is never marked Done or handed back.

---

## CONFIG LOADING

Load the `claude.atra.json` config file(s) to resolve keep/delete behavior for the four planning files (PRD, plan, review, state), and whether Markdown artifacts open automatically in the macOS default app. Create either file when it is missing, so the user always has a config to edit.

The two locations:
1. **Global:** `~/.claude/claude.atra.json` — the user's home config.
2. **Local:** `[project-root]/claude.atra.json` — `[project-root]` is the current working directory (same basis as `docs_folder` detection).

### Create Missing Config Files

Check both locations. For each file that does NOT exist, create it with this default content using the Write tool. Never overwrite a file that already exists.

```json
{
  "planAndDo": {
    "keepFiles": {
      "prd": "always",
      "plan": "always",
      "review": "always",
      "state": "never"
    },
    "openMd": "never"
  }
}
```

This is the nested format. This section only ever writes the `planAndDo` namespace — never any other skill's namespace. Another skill reading the same file owns its own namespace; this section never creates it, and a missing key there defers to whatever is already set at the other config level, or to that skill's own built-in default. Writing another skill's default here would let a freshly created local file silently override the user's global setting for that skill — local always wins over global, per key.

Track which files you created — `created_configs` list. Leave the local file untracked in git; do NOT stage or commit it. The user decides whether to commit it or ignore it.

**If a Write fails** (e.g. no permission): warn "Warning: could not create [path]. Using built-in defaults." Continue — the built-in defaults still apply.

### Read Config Files

Read both files. Each one exists now — you just created any that were missing.

**If a file fails to parse as JSON:** Display: "Warning: [path] is not valid JSON. Ignoring this config file." Treat it as absent. Continue.

**Detect the format, per file, independently.** A file is **nested format** when its top-level JSON has a `planAndDo` key whose value is an object — read `keepFiles`/`openMd` from inside `.planAndDo` (`.planAndDo.keepFiles.prd`, `.planAndDo.openMd`, etc.). A file is **legacy flat format** when its top-level JSON has no `planAndDo` key, or has one whose value is not an object, but has `keepFiles` and/or `openMd` directly at the top level — read them from there. Local and global are classified independently; one can be nested while the other is legacy flat. A file matching neither shape (no `planAndDo` object and no top-level `keepFiles`/`openMd`) has nothing to read for plan-and-do — treat every key as absent from that file, same as if the file didn't exist.

### Resolve Settings

Built-in defaults: `prd` = `always`, `plan` = `always`, `review` = `always`, `state` = `never`, `openMd` = `never`.

**Valid values:** `always`, `never`, `ask` — for every one of `keepFiles.prd/plan/review/state` and for `openMd`. A value that is any other string counts as invalid — treat it as missing at that level, and warn: "Warning: invalid value for keepFiles.[key]. Skipping it." (or "invalid value for openMd" for that key).

"Local `keepFiles.[key]`" and "local `openMd`" below mean whatever `### Read Config Files` resolved for the local file per its detected format — `.planAndDo.keepFiles.[key]` / `.planAndDo.openMd` if nested, top-level `keepFiles.[key]` / `openMd` if legacy flat. Same for global.

For each of the five keys (`prd`, `plan`, `review`, `state`, `openMd`), pick the first value that is present AND valid, in this order:
1. Local `keepFiles.[key]` (or local `openMd`).
2. Global `keepFiles.[key]` (or global `openMd`).
3. That key's built-in default.

So an invalid local value falls through to a valid global value, and only lands on the built-in default when no level has a valid value.

For each of the five keys, also record which level supplied the winning value — `local`, `global`, or `default` — alongside the value itself. This is bookkeeping only, for `### Store and Display` to show provenance later. Name these fields `prd_source`, `plan_source`, `review_source`, `state_source`, `open_md_source`, each one of `local`/`global`/`default`.

### Store and Display

Store `keep_settings = { prd, plan, review, state }` — each one of `always` / `never` / `ask`. Store `open_md_setting` (the resolved `openMd` string).

**Report both config files' status.** Always show this, for both locations, before the resolved settings — whether or not either file existed beforehand. Status is `existing` if the file was already there, `created` if `### Create Missing Config Files` just wrote it this run (it's in `created_configs`), or `missing (could not create)` if that step's Write failed for that location — the only "missing" status possible, since `### Create Missing Config Files` always targets both locations.
```
Config files:
- Global: [full absolute path] ([existing|created|missing (could not create)])
- Local: [full absolute path] ([existing|created|missing (could not create)])
```

Then display the resolved settings, with each key's source in parentheses:
```
Config: keepFiles — prd=[prd] ([prd_source]), plan=[plan] ([plan_source]), review=[review] ([review_source]), state=[state] ([state_source]); openMd=[open_md_setting] ([open_md_source])
```

**Check for a local override.** For each of the five keys, in this fixed order — `prd`, `plan`, `review`, `state`, `openMd` — the key qualifies only when it has a present-and-valid local value AND a present-and-valid global value AND the two differ. A key where local equals global does NOT qualify, even though its source is `local`. A key with no valid local value at all does NOT qualify either — there's nothing to override.

If at least one key qualifies, display one more line, listing only the qualifying keys in that order, comma-separated, each with its global value, ending in a period. Pattern: `[key] (global: [value])`, repeated per qualifying key, joined with `, `:
```
Note: local claude.atra.json overrides your global settings for: [key1] (global: [value1]), [key2] (global: [value2]).
```
If no key qualifies, print nothing extra — no blank "Note:" line.

If you created the local `claude.atra.json`, add: "The local config is untracked. Commit it to share with your team, or add it to `.gitignore`."

### Resolve Auto-Open Decision

Turn the resolved `openMd` setting into a single boolean, `auto_open_md`, used for the rest of the run. Do this AFTER Store and Display, so if it prompts, the user has already seen the resolved config — the same show-then-decide order `keepFiles` uses at Step 7.5b.

**Platform:** on any non-macOS platform, skip this whole subsection first — set `auto_open_md = false` without prompting, even if `openMd` resolved to `always` or `ask`. The OPEN IN APP RULE's platform check would just no-op it later anyway; skipping the prompt here avoids asking a question whose answer can't matter.

**On macOS:**
- `always` → `auto_open_md = true`. No prompt.
- `never` → `auto_open_md = false`. No prompt.
- `ask` → prompt once, right here, before any checkpoint exists to ask at: use AskUserQuestion — "Automatically open new or updated Markdown files (PRD, plan, review) in your default app at each checkpoint? 1-Yes, 2-No (recommended)." Store the answer as `auto_open_md`.

This runs once per session. Later checkpoints read `auto_open_md` — they never re-resolve `openMd` or ask again.

---

## OPEN IN APP RULE

The user can open any review Markdown file (PRD, plan, review) in the macOS default app, either on demand at any checkpoint, or automatically — controlled by the `openMd` config setting (see CONFIG LOADING).

**To open a file:** run `open [full path]`. If that fails, fall back to `open -a "Marked" [full path]`.

**Which files:** only the MD artifacts that currently exist — PRD, plan, review. NEVER the state JSON.

**Platform:** macOS only. On any other platform, skip silently and tell the user once: "Open in app is macOS-only. Skipping."

**On demand (manual):** the "Open in app" checkpoint choice, available regardless of `auto_open_md`. Opens every existing MD artifact. After opening, return to the SAME checkpoint and re-ask. Opening never advances the workflow.

**Automatic:** when `config.auto_open_md == true`, run this right after the ARTIFACT PATH DISPLAY RULE and before presenting the checkpoint choices — no separate ask, no return-loop, just open then continue to the checkpoint as normal. Open only files that are "new or changed since the last checkpoint" per that rule's definition — not every existing artifact. This avoids re-opening a file the user already has open and hasn't touched.

---

## FILE CLEANUP DECISION (Step 7.5b)

### Step 7.5b: File Cleanup Decision

**Runs once after scope selection.** If user chose Edit at Step 7.5, this step does not run until a scope is selected.

**Resolve settings:** Use `config.keep_settings` from state (set at Step 3.3). If it is null or absent — e.g. a legacy state file from before this feature existed — fall back to built-in defaults: `prd` = `always`, `plan` = `always`, `review` = `always`, `state` = `never`.

**Build the decision set:** Start with `plan`, `review`, `state`. Add `prd` only if `prd_skipped == false` — a skipped PRD never existed, so it needs no decision.

**Resolve each file in the set:**
- `always` → keep, no prompt.
- `never` → delete, no prompt.
- `ask` → needs a prompt.

**Prompt, based on how many files resolved to `ask`:**
- **Zero:** No prompt. Every decision is already known.
- **Exactly one:** Use AskUserQuestion with a single numbered keep/delete question for that file, e.g. "Keep the [file] file after completion? 1-Keep (recommended), 2-Delete."
- **Two or more:** Use AskUserQuestion with one multi-select question: "Which files to keep after completion?" List each `ask` file as an option and pass `multiSelect: true`. Checked = keep, unchecked = delete.

**Store the result** in state as `config.keep_files` — an OBJECT of booleans (`true` = keep, `false` = delete), one entry per file in the decision set. Files excluded from the set (e.g. a skipped PRD) get no entry.

Example: `{ "plan": true, "review": true, "state": false }` — PRD absent here because it was skipped.

Update the state file with the resolved `config.keep_files`.

---

## CLEANUP RESOLUTION (Step 13.0)

### Step 13.0: Cleanup Planning Files

Use stored `config.keep_files` from Step 7.5b. No prompt needed — user already decided.

**Path mapping (review is named differently — by branch, not task_key):**
- `prd` → `[prd_dir]/PRD-[task_key].md` (only if it exists and was not skipped)
- `plan` → `[plan_dir]/PLAN-[task_key].md`
- `review` → `[review_dir]/REVIEW-[branch_name].md` — uses `config.branch_name`, NOT `task_key`
- `state` → `[state_dir]/STATE-[task_key].json` — handled separately in Step 13.2, not here

**For each of `prd`, `plan`, `review`:**
- Entry is `false` in `config.keep_files` → delete.
- Entry is `true`, or the file has no entry at all → keep.

**Delete the files marked for deletion, if any:**
```bash
git rm --ignore-unmatch [path-of-each-file-marked-false]
rm -f [path-of-each-file-marked-false]
git commit -m "docs: Remove planning files. [task_key]"
```
`git rm --ignore-unmatch` covers tracked files; `rm -f` catches anything untracked. Skip the commit if nothing was marked for deletion. In non-git mode, use plain `rm -f` — no `git rm`, no commit.

**This commit skips the state file on purpose.** Even if `config.keep_files.state == false`, the state file must stay intact through Step 13.2 (status = completed). Step 13.2 removes it later — see SKILL.md's own Step 13.2, which is fully self-contained and doesn't read this file.

Display the full absolute file path of every file kept (PRD if it exists, plan, review — in that order).
