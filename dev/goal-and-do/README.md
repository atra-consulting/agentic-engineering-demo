# Checks for goal-and-do

Contributor-facing. The checks for the plugin's own code in `plugins/goal-and-do/`: types, lint, format, Markdown, front matter, the plugin's validation and its suite, in one command. They live outside the plugin, so nothing here becomes part of what Claude Code installs, reads or tests as the plugin, and a `/goal-and-do` run, whose changes stay inside `plugins/goal-and-do/`, can't loosen them.

## Run

From the repository root, with Node 20 or newer and `claude` on the `PATH`:

```sh
npm --prefix dev/goal-and-do ci
npm --prefix dev/goal-and-do run check
```

`run check` runs every check to its end, then prints a summary, and exits 1 when a blocking check fails. `run fix` lets Prettier, ESLint and markdownlint fix what they can first. CI runs `run check` on every pull request that changes `plugins/goal-and-do/` or this folder.

## What it checks, and what blocks

| Check | Tool and config | Blocks |
| --- | --- | --- |
| Types | `tsc -p tsconfig.check.json`, strict, against `types/claude-code.d.ts` | every error |
| Lint, `hooks/` | ESLint 9 with typescript-eslint 8, `eslint.config.mjs` | every preset rule with a fixer, `no-floating-promises`, `no-misused-promises`, no `import()`, no Node or DOM globals; every other preset rule warns |
| Format, TypeScript | Prettier 3, `.prettierrc.json` | every file not in its format |
| Markdown, outside `docs/reviews/` | markdownlint-cli2, `.markdownlint-cli2.jsonc` | every finding |
| Front matter and dashes | `scripts/rules.mjs` | a skill's `description` that doesn't start with "Use when" or reaches 1,024 characters; an agent without `name`, `description`, `model` or `color`; an em-dash or an en-dash |
| The rules script | `node --test test/*.test.mjs` | every failing test |
| The plugin | `claude plugin validate plugins/goal-and-do` | an error |
| The suite | `claude plugin test plugins/goal-and-do` | a failing test |

A warning rule moves to blocking when a run shows what it costs, or when its count reaches 0.

## The API types

The engine writes a mod's API types into `.claude-plugin/types/` only when it loads the mod from a folder the person owns, never for a marketplace install and never in CI. `types/claude-code.d.ts` is a copy, from the version its first line names. The repository doesn't commit it (`.gitignore`): copy it into `types/` before you run the checks. Without it, `run check` skips the type check and the lint, with a warning; CI runs without it. The check warns when `claude --version` differs. To copy a newer one: load the `plugin-authoring` skill in a Claude Code session, and copy the `types/claude-code.d.ts` beside the skill's `SKILL.md` that the skill names.

## Dependencies

`.npmrc` sets `omit-lockfile-registry-resolved`: the lockfile keeps each package's integrity hash but no registry URL, so each machine installs from its own registry.
