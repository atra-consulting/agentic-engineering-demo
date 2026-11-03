# goal-and-do

A prototype for trials on your own work; it isn't ready for a team rollout. It runs the six phases of a change (Intent, Spec, Plan, Build, Test, PR) in Claude Code, each as a `/goal`, with gates after Intent, Spec and Plan. A mod drives the phases, shows progress, learns permissions, and counts tokens and models per phase.

**State:** the five-phase version passed a full run on a demo project and on a real ticket; the six-phase version has reached the Intent gate on the demo project, and its full run is next. What it does and how it works, for reviewers: [`docs/README.md`](docs/README.md). The design: [`docs/goal-and-do-design.md`](docs/goal-and-do-design.md).

## Before You Start

- Claude Code 2.1.314 or later: `claude --version`.
- Start Claude Code in the repository's root folder, on its default branch, with a clean tree.
- For a GitHub origin: `gh auth status --hostname <host>`. For a ticket: a connected Jira MCP.

## Install

In Claude Code, in the target project:

```text
/plugin marketplace add atra-consulting/agentic-engineering-demo
/plugin install goal-and-do@agentic-engineering-demo
```

From a local checkout of this repository instead:

```sh
claude plugin marketplace add <path-to-checkout> --scope local
claude plugin install goal-and-do@agentic-engineering-demo --scope local
```

After an edit to the plugin, `/reload-plugins`. Disable the plugin with `/plugin` when not in use. A step-by-step test with the expected output, for reviewers: [`docs/community-tests/01-install.md`](docs/community-tests/01-install.md).

## Use

- `/goal-and-do <Jira browse URL | key | text | file.md>` starts a run on branch `sdd/<id>`. A one-word path ending in `.md` names a request file of the project, which may be new and untracked; a tracked request file must be committed first; its front matter may hold only `base: <branch>`. A path that is no readable file inside the project refuses the start.
- `/goal-and-do --base <branch> <request>` starts the run from that branch instead of origin's default branch; the branch must be on origin. It wins over a request file's `base:`. `--base` counts as the option only as the first word, and needs a request after the branch; elsewhere it is plain text, except after a ticket key or URL, a subcommand or a `.md` path, which refuses. The mod fetches the branch with batch-mode ssh and no prompt, for up to 30 seconds; a fetch that fails or takes longer refuses the start.
- `/goal-and-do --strict <request>` starts the run at the strict guard level; without it the run is at the review level. See [Guard Level](#guard-level). `--strict` counts as the option only as the first word or right after `--base <branch>`, so `--strict --base <branch> <request>` and `--base <branch> --strict <request>` both start a strict run; after a ticket key or URL, a subcommand or a `.md` path, alone, given twice, or as `--strict=<value>` it refuses the start, and inside the request it is plain text.
- `/goal-and-do level strict|review` switches an active run to the other guard level.
- `/goal-and-do next` approves at a gate or reruns a stuck phase; `status` shows the phase files and the usage table; `stop` ends the run; `allow` and `allow local` write learned permission rules.
- Esc interrupts a running goal at once; the subcommands act when Claude's turn ends.
- After a run: read the diff, mark the draft PR ready by hand. `changes/<id>/` stays in the branch as the run's record; `run.json` is never committed.

### What the PR phase does with checks and the description

- It reads each check from `gh pr checks --json name,bucket,state,link`, never from the exit code. A pending check is waiting, never passed. A neutral or cancelled check, and a Jenkins check whose build can't be found or read, goes under To Do, counts as `checks: failed`, and stops the phase (`status: blocked`) until you look.
- A failing check whose log holds a line of `skills/open-pr/assets/infrastructure-patterns.txt` is not fixed by the agent: it goes under To Do as "re-run by hand" with the matching line named. The plugin's code owner owns that file; it changes only by pull request.
- The mod counts fix pushes (pushes that went through with a commit starting `fix(<id>):`) and caps them at 3. The PR goal names the cap and the count, so a reset or a raise reaches the agent. A fourth push with such a commit is refused and the run is stuck. The Stuck dialog offers: rerun (the count stays), reset the count, or raise the cap by 3 (never above 9). Each choice is logged in `.git/goal-and-do/fix-choices-<id>.log` on your machine, never in a commit, the pull request or the ticket system. The record push (`docs(<id>): pr record`) passes at the cap.
- Right after `gh pr create` the phase reads `isDraft` and stops when the PR is not a draft; the run's summary warns again if it is no longer a draft at the end.
- If you edit the pull request description by hand, the record push leaves your text alone and copies it into `pr.md` with a note. Only line endings and whitespace at the end of a line (and blank lines at the end) don't count as an edit.
- Check results are reported as the pushed commit's only once the pull request's head commit is that commit (up to five re-reads, 60 seconds apart); `pr.md` names the commit the `checks` line describes.

## Guard Level

A run has a guard level, `review` or `strict`. The guard judges every call the same way at both levels; the level decides only what a denial does to the run.

- `review` is the default. A denied call stays denied and the run goes on. The mod counts the call and lists it in `run.json` under `deniedCalls` (phase, key, tool, time, and the command with secret shapes removed; at most 200). The band shows `review` after the state and, once a call was denied, `N denied`; the pane shows `Guard level: review`. The start shows one toast and one transcript line: `Guard level: review. Add --strict to the start line for a measured run.`
- `strict` ends the run blocked, with the denial's reason, when the guard denies reading a named environment file, a credential store, writing a steering file, an outbound channel or an MCP write. Start with `/goal-and-do --strict <request>` for a measured run: a start line without `--strict` runs at the weaker level. The pane shows `Guard level: strict`; the band looks as it did before.
- `/goal-and-do level strict|review` switches an active run (running, at a gate, blocked, capped or interrupted), only when a person typed it, also while a goal turn runs. Each switch is logged in `run.json` under `levelChanges`. The state, the reason and the denial records stay as they are, so a blocked run stays blocked until `next` reruns it.
- The mod's own blocks (tests changed since the lock, approvals that differ, changed Git settings, a declined push, a guard that fails) end the run at both levels.
- The level shows in the first line of the end summary and above the usage table of `status`. A `run.json` with no level, or with any value but `review`, restores as `strict`. The mod also keeps the level in its store beside the approvals record: a run restores at `review` only when `run.json` and the store both say `review`, and any other pair restores at `strict`, with a toast when `run.json` said `review`.

## Why the Prototype Locks Things

The prototype lets an AI agent write, test and push code with little supervision. To make that safe enough to try, it locks what the agent must not change on its own:

- **The acceptance tests, after the Plan gate.** Otherwise the agent could make a test pass by changing the test.
- **The CI files, the run's own records, the settings and the agent's instruction files.** Otherwise the agent could change the checks that judge its work.
- **Secrets.** Environment files and credential stores stay unreadable.
- **The pull request.** The agent pushes only its own branch, and it never merges, approves or marks the pull request ready.

Without these locks, passing tests and green CI would prove little, because the agent could have changed them.

### What It Costs

The locks sometimes stop correct work, and then a person has to step in. Examples from November 2, 2026:

- The guard read a search pattern (`^hooks/.*`) as a pattern that could match `.env` and stopped a finished phase. A rerun fixed it.
- A locked test had a bug. Only a person may fix it: they edit the test and approve a new lock in the mod's dialog.
- Claude Code's own permission check, which is not part of the prototype, refused a plain commit and a restore. The person ran them with `!`.

### What We Do About It

- False alarms are fixed as they show up.
- The review level, the default for reviewers, keeps a phase going after a refused command. Strict stays for measured runs.
- Planned: when a run is stuck, the dialog names the next step, including the exact command to paste.

## How the Prototype Checks Itself

Every pull request into the prototype runs about 1,600 unit tests, ESLint, Prettier, the TypeScript type check (`tsc`), markdownlint and `claude plugin validate` in CI. A failure in any of them fails the pull request. The agent's own changes must pass the same checks, and it can't edit them.

## Known Limits

- The usage table counts the working model and subagents; the `/goal` evaluator and the auto-mode permission classifier (both on a small model) are only in `/usage`.
- Subcommands typed while a goal runs wait for Claude's turn to end; Esc interrupts at once.
- Each phase starts with a fresh context, so the previous phase's chat leaves the screen; the phase files keep everything.
- In the default permission mode Claude asks for edits and writes during Build; learned rules persist in the repo's settings.
- After `claude --continue` an old goal may still be set but idle; `/goal-and-do next` clears it and reruns the phase.
- The engine pauses a goal after 9 stops in a row without a tool call (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- The guard reads a wildcard in the pattern of `grep` as regex syntax when it sits inside quotes, with no `$` outside quotes, and the command uses only flags without an argument (`grep -E -c -n`). An `awk` or `sed` program keeps the old rule, since both can run commands: a regex such as `/^hooks\/.*/` there is refused at strict and stops the phase. Elsewhere the guard judges a wildcard by the environment files and links it lists at each such call, but only for plain reading commands (`cat`, `head`, `tail`, `wc` and `grep`, each with a fixed set of flags, never `-r` or a long option) in a command of one segment, and only when the shell itself globs it: `cat src/.*` passes when no `.env` file and no link lives in `src/`, while `cat src/.* | head`, `tar --wildcards src/.*` and a quoted `find app -name '.*'` are refused. The guard can't see what a variable holds: `cat $F` with `F=.env` is not refused, at either level. A wildcard with `$`, a backtick, `^`, `#` or `~`, and one outside the project or in `node_modules` and `.git`, is still refused when it could match `.env`.
- Each of the three gates writes a role, "the person who approved", into `approvals.md`, never the runner's Git name, and Build commits the file to the target repo.
- The guard reads shell commands; it is best effort, and `source`, script files and variables built at run time stay unseen. A command that first `cd`s into a folder and then names a file by a relative path, a wildcard, or a variable gets past its checks of `approvals.md`, `run.json` and the mod's store. The mod's store keeps the approvals and the test lock, and a restore or a push that finds a mismatch blocks the run; branch protection stays the real control.
- The mod's store is a file in the user's Claude Code config folder (`~/.claude/plugins/store/`), owned by the same user as Claude's shell. The guard denies edits and shell commands that name it; it can't stop every route.
- The Claude Code mod API has no way to read a symbolic link's target. The mod denies an edit whose path it can't place, in every phase, so a dangling link blocks the edit instead of following it.
- During Intent, Claude's shell runs only plain `git` commands for the branch and the change folder, and only reading, edit and Jira-read tools run. A project whose Jira server name holds neither `jira` nor `atlassian` can't run Intent from a ticket.
- A refused run (its `run.json` differs from the store, or it predates the six-phase update) stays blocked with the guard on until the person types `/goal-and-do stop`.
- Wrappers and options the guard doesn't parse get past its push rules: a shell that reads its commands from standard input or a script file, `command -p`, `exec -a`, `nice -n`. The same goes for `gh`'s own config and aliases, and for keys the fingerprint allows because Git and `gh` write them (`branch.*.mergeOptions` can name a program that `git merge` then runs).
- The allowed push runs with the project's hooks off, to the push URL recorded at the start, from the project root, with `GIT_SSH_COMMAND` and similar variables removed. A function or variable in the shell's startup file (`~/.zshenv`), a replaced `git` or `env` program on the `PATH`, or a `GIT_CONFIG_SYSTEM` set only in Claude's shell can still change it. A URL rewrite at any scope that matches the recorded URL still redirects the push; the check after the push then blocks the run.
- The push rules read the words of a shell command. A push run through an interpreter or a script (`python3 -c`, `sh script.sh`) gets past them, and so does `git credential fill`, which prints a stored token. Branch protection on the target repository stays the real control.
- The mod records a fingerprint of Git's whole config (every entry except branch tracking and what `gh` writes), its hooks with their content, and its attributes at the start, and blocks the run at a gate, before the push, and after it when they changed. The allowed push runs with the project's hooks off and goes to the push URL recorded at the start. A planted `url.*.insteadOf` for exactly that URL, written in the milliseconds before the push, can still redirect it; the check after the push then blocks the run. It doesn't cover hook subfolders or hooks a tool keeps in the working tree (such as husky's `.husky/`). A tool that installs hooks or changes Git's config during a run (husky, lefthook, pre-commit, `git lfs install`, `gh auth login`) blocks the next gate.
- The mod's own Git calls switch off filters that the repository's own config defines, except Git LFS's standard ones; global and system filters stay on. A filter planted in `~/.gitconfig` during a run runs in the mod's own status and diff until the next gate, where the fingerprint blocks the run. A repository set up with `git lfs install --skip-smudge`, Git LFS at system scope, or a customized LFS line can show LFS files as changed, and a lock check can then block the run.
- While a dialog is open the pane shows the band's turn and state part, because the dialog hides the band. Claude Code does not tell the mod when the person collapses the band by hand (ctrl+x ctrl+a or `[-]`), so a band collapsed that way is not replaced in the pane.
- The pane's recent files come from the tool calls. A Bash call counts as a delete only for the paths its `rm`, `git rm` or `mv` names, read from the project root: after a `cd`, or with a wildcard or a variable, the path shows wrong or as `<a file with an unusual name>`, and a script's deletes stay unseen.
- After a walk-through the mod opens the gate or Stuck dialog again when the turn that starts with its prompt ends. A mod that rewrites that prompt keeps the dialog closed; `/goal-and-do next` opens it.
- The pane ends with a Help section above Denials: what to do when stuck, how to get out (`stop` ends the run for good), and how to start over. It is folded during a normal run and opens on its own while the run is blocked, capped, interrupted or stopped; a stopped run shows only how to start over, and a finished run shows none.
- The pane draws no turn line: the turn, minutes and calls are in the band, and in the pane's copy of the band while a dialog is open.
- A run of the test command with more words (`-v`, one test) leaves the Tests line as the last full run left it; with a pipe, `;`, `||`, `&`, a redirection or a substitution it shows as not readable.
- The rule dialog's option descriptions come from the mod's drawing of Claude Code's question dialog. A surface that draws that dialog without plugin hooks shows the commands without them.
- The guard denies setting a timer (`ScheduleWakeup`, `CronCreate`) while a run is active; cancelling one stays allowed. A timer set before the run, or by another session, still fires.
- The band takes the rows Claude Code gives it: on a short terminal it drops its box, and with one row it shows one line, the state first. The mod opens its pane at the start of a run; on a terminal too narrow for a docked pane Claude Code places it inline above the prompt, and after a restart below 144 columns (110 once opened) the pane waits until the terminal is wider. `/goal-and-do status` or `next` opens it again. At 80 columns in fullscreen, Claude Code has been seen to draw no inline pane at all; the band and the status command then carry the run's state.
- The mod's own `/goal-and-do status` at the end of a run starts while the turn's end hook runs. When Claude Code still answers that no hook of the mod's answered, the mod writes a short form to the transcript as a log line (per phase: tokens, goal turns, minutes), and `/goal-and-do status` shows the full table.

## What Changes in 0.2.0

From Spec on the guard also keeps secrets, steering files and unneeded outbound channels out of a run's reach. Reviewers of a project the plugin runs on see these rules:

- Environment files (`.env`, `.env.<suffix>`) cannot be read by Read, Grep, a shell command or Git, and a `git diff`, `git show`, or `git log -p` over a project that tracks one is refused unless it names a path without it or excludes it (`-- . ':(exclude,glob)**/.env*'`); the `.env.example`, `.sample`, `.template` and `.dist` copies can. A refusal names the file and ends the run blocked.
- `gh auth token`, `--show-token`, `git credential`, `printenv`, `env`, `set`, `export -p` and `declare -p` are refused, and so is printing a variable whose name matches `*_PAT`, `*TOKEN*` or `*KEY*`. A false match such as `KEYBOARD_LAYOUT` is refused too; print or edit it by hand.
- The account's credential stores (`~/.netrc`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`, `~/.npmrc`, `~/.aws/credentials`, `~/.ssh/`, `~/.docker/config.json`, `~/.claude.json`, and beyond the first spec `~/.git-credentials`, `~/.config/gh/hosts.yml`, `~/.config/git/credentials`) cannot be read. `~/.m2/repository`, `~/.gradle/caches` and the wrapper stay readable.
- Steering files (`.claude/`, `.mcp.json`, `CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, shell startup files) cannot be written unless `planned-paths` of the approved plan names that exact file. A folder entry allows nothing under it.
- In the PR phase the reviewer reads `CLAUDE.md` from the base branch: the open-pr skill writes `git show origin/<base>:CLAUDE.md` to `.git/goal-and-do/base-claude-<id>.md`, and the reviewer, which has no shell, reads that file.
- The test run starts without `JIRA_PAT` and `GH_TOKEN`, unless the approved plan keeps one in `test-env-keep:`.
- `WebFetch`, `WebSearch` and fetch or browser MCP tools are refused from Spec on. An MCP write tool passes only when the approved plan names it in `planned-tools:`.
- In the PR phase only `gh pr create|view|edit|checks|list|status|diff`, `gh run view|list|watch`, `gh repo view`, `gh auth status` and a read-only `gh api` pass. `gh api` takes one relative endpoint, the method GET and only `--paginate`, `--jq` and `--include`; a `--jq` filter that reads the environment, other methods, fields, `--input`, `--hostname`, headers, URLs and `graphql` are refused. A GET can read any endpoint of the code host, and the output lands in the transcript. For every `gh` form in the PR phase, a word with a `$` or a backquote, a `--jq` filter that reads the environment, and a variable in front that points `gh` at another host, proxy, CA file or token are refused; `GH_PAGER=cat` and `gh`'s output flags (`GH_NO_UPDATE_NOTIFIER`, `GH_PROMPT_DISABLED`) pass. An `export` of such a variable is refused with its own reason in every phase.

### Known Limits of the New Rules

- Shell is best effort: `source` of a computed name, script files, variables built at run time and a `cd` in an earlier call stay unseen.
- A token passed as an argument (`./gradlew -Ptoken=$REPO_TOKEN`) is not printed and passes, but the value can show in process lists and build logs.
- `mvn` and `./gradlew` read `~/.m2/settings.xml` and `~/.gradle/gradle.properties` themselves; the guard sees only command text. An option that names the file (`mvn -s ~/.m2/settings.xml`) is refused.
- Folder searches are judged by a listing of the environment files made at each phase start. A file created or un-ignored during a phase is not in it. Whether the Grep tool honours `.gitignore` is not verified: Claude Code 2.1.316 has no Grep tool (checked in the main session and in the Explore subagent), so the check waits for a version that has one. The AC-13 run showed that Claude Code's own `Read(./.env*)` deny rule refuses the read first, without a prompt, in auto mode; the guard is the second layer.

### Temporary Exceptions for the Community Tests

Both end when the community tests are over, as the person judges. No date forces their removal.

- TEMPORARY EXCEPTION 1: a refused folder search denies the call and does not end the run.
- TEMPORARY EXCEPTION 2: `context7` documentation lookups pass in Spec, Plan and Build and are refused in Test and PR. Library names and queries go to a third party.

### The Claude Sandbox, Gradle and Maven (untested)

This change does not turn the sandbox on. Claude Code's documentation (code.claude.com, sandboxing) says the sandbox covers shell commands only and names no Gradle or Maven setting. Inference, untested: for a Gradle or Maven project put `~/.gradle` and `~/.m2` in `sandbox.filesystem.allowWrite` and the project's repository hosts in `sandbox.network.allowedDomains`. A `sandbox.credentials` entry of mode `deny` on `~/.m2/settings.xml` or `~/.gradle/gradle.properties` would also stop `mvn` and `./gradlew` from reading them, so it is no drop-in for a build that needs a mirror or credentials. The label comes off after a community reviewer confirms it on a real project.

## For Reviewers

What it does, how it works under the hood, and the questions where feedback helps most: [`docs/README.md`](docs/README.md).

A criterion the plan cannot keep as written is an open point that starts with `Departure AC-<n>:`; when the person decides it at the Plan gate, `spec.md` gains one line under that AC, `Departure (<date>, decided at the Plan gate): <what and why>`, and the AC's own lines stay as approved. Approving the gate approves that `spec.md` again, and `approvals.md` holds a second Spec row. Reviewers: read the Departure lines in `spec.md` first; they are where the shipped change differs from the approved criteria.

## For Contributors

The checks for this plugin's code (types, ESLint, Prettier, Markdown, front matter, `claude plugin validate` and the suite) run as one command from the repository root:

```sh
npm --prefix dev/goal-and-do ci
npm --prefix dev/goal-and-do run check
```

CI runs it on every pull request that changes the plugin. What each check covers and what blocks: [`dev/goal-and-do/README.md`](../../dev/goal-and-do/README.md).

## Secret checks and test-weakening signals

- Each commit, each push, and each `gh pr create` or `gh pr edit` is checked for secret shapes (private keys, AWS and Azure access keys, GitHub tokens, Jira and Atlassian tokens). A hit denies the action, names the file and line (or the commit message or PR body and its line), and never shows the value. A commit's message is checked before the commit, from `-m`, `--message`, `-F` and a heredoc. A check that cannot run denies too. The code owner approves every change to `hooks/shapes.ts`, including each allowlist entry.
- The push dialog shows counts and paths for deleted tests, new skip markers, runner-configuration and setup-file edits, new dependencies and personal-data shapes (e-mail, phone, IBAN). They block nothing. A path may itself carry personal data in a project whose file names do.
- `test.md` and the change reviewer's input hold the same counts and paths, never a line of code. Reviewers: an unauthorized deleted test or a new skip marker is where to look first.
- The optional scanner (gitleaks) says "not scanned" until the code owner approves it and the installed version matches the pinned one.
