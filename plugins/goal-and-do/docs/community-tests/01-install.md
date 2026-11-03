# Community Test 1: Install the Prototype

**Time:** about 10 minutes. **You send back:** the short report at the end.

This test checks one thing: you can install `goal-and-do` from this repository on your own machine, and Claude Code loads it. It does not start a run. Later tests do that.

## What You Need

- Claude Code 2.1.314 or later. Check with `claude --version`.
- A model for step 4 only. Steps 1 to 3 run without one.

## If You Have Installed It Before

A second `marketplace add` with the same name `agentic-engineering-demo` replaces the first one's source, for all your projects. Claude Code prints that it did so. To keep your own setup, run this whole test in a separate config folder:

```sh
export CLAUDE_CONFIG_DIR=$(mktemp -d)
```

Run it in the terminal where you do the test. The variable lives only in that terminal. Claude Code then starts without your settings. Before step 4, set your usual model access in that terminal (for Bedrock: `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `AWS_REGION`). Everyone else skips this section.

## Step 1: A Throw-Away Repository

The plugin installs per project, so nothing in your real projects changes.

```sh
mkdir ~/goal-and-do-test && cd ~/goal-and-do-test
git init -q && git commit --allow-empty -q -m init
```

## Step 2: Install

Try route A. If it fails, note the error and try route B. Both end the same way.

### Route A: From GitHub

```sh
claude plugin marketplace add atra-consulting/agentic-engineering-demo --scope local
claude plugin install goal-and-do@agentic-engineering-demo --scope local
```

Expect, in this order:

```text
Successfully added marketplace: agentic-engineering-demo (declared in local settings)
✔ Successfully installed plugin: goal-and-do@agentic-engineering-demo (scope: local)
```

### Route B: From a Local Clone

```sh
git clone --depth 1 https://github.com/atra-consulting/agentic-engineering-demo.git ~/goal-and-do-checkout
claude plugin marketplace add ~/goal-and-do-checkout --scope local
claude plugin install goal-and-do@agentic-engineering-demo --scope local
```

Expect the same two lines. Claude Code reads the plugin straight from this folder, so a later `git pull` there updates it.

## Step 3: Check That It Is There

In `~/goal-and-do-test`:

```sh
claude plugin list
```

Expect:

```text
  ❯ goal-and-do@agentic-engineering-demo
    Version: 0.9.1
    Scope: local
    Status: ✔ enabled
```

A newer version number is fine; an older one means the install came from an older checkout. Route B also shows a `Read from:` line with your clone's path.

## Step 4: Check That It Loads

In `~/goal-and-do-test`, start `claude`. Then:

1. Type `/plugin` and open the **Installed** tab. Expect `1 mod active · goal-and-do`, with the status `Enabled`.
2. Press Esc. Type `/goal-and-do` with nothing after it. Expect this usage text:

   ```text
   Usage: /goal-and-do [--strict] [--base <branch>] <ticket URL | key | text | file.md> | level strict|review | next | status | allow [local] | stop
   ```

Stop here. Don't type a request after the command: that starts a real run.

If Claude Code says it doesn't know `/goal-and-do`, type `/reload-plugins` and try again. If that fails too, quit and start `claude` again.

## Clean Up

```sh
cd ~/goal-and-do-test
claude plugin uninstall goal-and-do@agentic-engineering-demo --scope local
claude plugin marketplace remove agentic-engineering-demo
cd ~ && rm -rf ~/goal-and-do-test ~/goal-and-do-checkout
```

If you used a separate config folder, skip the first two lines. The folder sits under your temp directory and goes away with it.

## What Goes Wrong

| You see | It means | What to do |
| --- | --- | --- |
| A clone error | No network access to github.com | Check your network or proxy, then retry |
| `Marketplace ... was already added from ... and now points at ...` | You installed before; the old source is replaced | Follow "If You Have Installed It Before" next time |
| `/goal-and-do` is unknown | The session started before the install | `/reload-plugins`, or restart `claude` |

## Your Report

Reply with this, filled in:

| | |
| --- | --- |
| Claude Code version (`claude --version`) | |
| Route A | worked / failed (paste the error) |
| Route B | worked / failed / not tried (paste the error) |
| Version shown by `claude plugin list` | |
| Usage text appeared in step 4 | yes / no |
| Minutes it took | |
| A step that was unclear or wrong | |
