import { expect, test } from 'claude-code/testing'
import { checkCommit, checkCommitMessage, checkPrBody, checkPush, publishKinds, redactSecrets, scanPatch, scannerArgs, untrackedScope } from './scan'
import type { Check, Scanner } from './scan'

const join = (...parts: string[]): string => parts.join('')
const TOKEN = join('ghp', '_', 'Ab12Cd34Ef56', 'Gh78Ij90Kl12', 'Mn34Op56Qr78')
const SHA = 'c0ffee1' + 'a'.repeat(33)

test('publishKinds: a commit is a commit check, whatever its options', () => {
  for (const command of ["git commit -m 'feat: x'", "git commit -a -m 'x'", "git commit -m 'x' -- changes/a.md", "git add f.ts && git commit -m 'x'"]) {
    expect(publishKinds(command).commit, command).toBe(true)
  }
})

test('publishKinds: gh pr create and gh pr edit are PR checks, other commands are none', () => {
  expect(publishKinds('gh pr create --fill').isPr).toBe(true)
  expect(publishKinds('gh pr edit 7 --body-file x.md').isPr).toBe(true)
  expect(publishKinds('git status && gh pr view 1')).toEqual({ commit: false, isPr: false, forcedAdd: false })
  expect(publishKinds("git commit -m 'about gh pr create'").isPr).toBe(false)
})

test('checkPrBody: a body given as a command substitution with a heredoc is read line by line', async () => {
  const command = `gh pr create --title t --body "$(cat <<'EOF'\n## Summary\nuse ${TOKEN} here\nEOF\n)"`
  const check = await checkPrBody(command, async () => undefined)
  expect(check.verdict).toBe('deny')
})

test('the scanner runs with the plugin config and ignore file when it has them, never the repo ones', async () => {
  const seen: string[][] = []
  const trusted = { config: '/plugin/hooks/gitleaks.toml', ignorePath: '/plugin/hooks/gitleaks.ignore' }
  const scanner: Scanner = {
    reportPath: '/tmp/report.json',
    trusted,
    version: async () => 'v8.30.1',
    approved: () => true,
    scan: async (_target, args) => {
      seen.push(args)
      return { exitCode: 0 }
    },
    removeReport: async () => undefined,
  }
  const git = { stagedPatch: async () => '', commitsAhead: async () => [{ sha: SHA, message: 'feat: x', patch: '' }] }
  expect(await checkPush(git, 'main', scanner)).toEqual({ verdict: 'pass', scanner: 'ran' })
  expect(seen).toEqual([scannerArgs('/tmp/report.json', trusted)])
  expect(seen[0]).toContain('--config')
  expect(seen[0]).toContain('--gitleaks-ignore-path')
})

test("checkCommit: a reader that throws denies, and the denial names the staged diff and the reader's cause", async () => {
  const git = {
    stagedPatch: async (): Promise<string> => {
      throw new Error('more than 200 untracked files')
    },
    commitsAhead: async () => [],
  }
  const check = await checkCommit(git)
  expect(check.verdict).toBe('deny')
  expect(check.verdict === 'deny' ? check.reason : '').toContain('staged diff cannot be read: more than 200 untracked files')
})

test("publishKinds: the commit is found as the guard's parser finds it", () => {
  const commands = [
    '/usr/bin/git commit -m x',
    'git --no-pager commit -m x',
    'git -c core.pager=cat commit -m x',
    'git -C . commit -m x',
    'env FOO=1 git commit -m x',
    'timeout 30 git commit -m x',
    'sh -c "git commit -m x"',
    "bash -lc 'git add f && git commit -m x'",
    'eval "git commit -m x"',
    'echo $(git commit -m x)',
    'echo `git commit -m x`',
    'true && (git commit -m x)',
    'cd app; git commit -m x',
  ]
  for (const command of commands) expect(publishKinds(command).commit, command).toBe(true)
})

test('publishKinds: a command or a git subcommand that cannot be told for sure needs both checks', () => {
  for (const command of ['git --unknown-option commit -m x', 'env -S "git commit -m x"', '$GIT commit -m x', 'bash run.sh', 'sh -c "$CMD"']) {
    expect(publishKinds(command), command).toEqual({ commit: true, isPr: true, forcedAdd: false })
  }
})

test('publishKinds: a command that is not a commit or a PR call needs neither check', () => {
  for (const command of ['git status', 'git log -1', 'ls -la', 'npm test', 'sh -c "ls"', "git diff HEAD -- 'a b'"]) {
    expect(publishKinds(command), command).toEqual({ commit: false, isPr: false, forcedAdd: false })
  }
})

test('publishKinds: gh with an option before pr is found, and a forced git add is flagged', () => {
  expect(publishKinds('gh -R org/repo pr create --fill').isPr).toBe(true)
  for (const command of ['git add -f build/out.js', 'git add --force a.txt', 'git add -fA']) expect(publishKinds(command).forcedAdd, command).toBe(true)
  expect(publishKinds('git add -A').forcedAdd).toBe(false)
})

const reasonOf = (check: Check): string => (check.verdict === 'deny' ? check.reason : '')
const noFile = async (): Promise<string | undefined> => undefined
const fileWith = (text: string) => async (): Promise<string | undefined> => text

test('checkPrBody: a gh pr create is found on any line, in a subshell, behind an option, in sh -c and in a command substitution', async () => {
  const commands = [
    `export GH_PAGER=cat\nexport X=1\ngh pr create --title t --body "use ${TOKEN}"`,
    `(gh pr create --body "use ${TOKEN}")`,
    `{ gh pr create --body 'use ${TOKEN}'; }`,
    `cd app && gh pr create \\\n  --title t \\\n  --body "use ${TOKEN}"`,
    `gh -R org/repo pr create --body "use ${TOKEN}"`,
    `gh pr -R org/repo edit 7 --body "use ${TOKEN}"`,
    `sh -c "gh pr create --body 'use ${TOKEN}'"`,
    `bash -lc 'gh pr edit 7 --body "use ${TOKEN}"'`,
    `eval "gh pr create --body 'use ${TOKEN}'"`,
    `echo "$(gh pr create --body 'use ${TOKEN}')"`,
    `GH_HOST=h env gh pr create --body-file=pr.md`,
    `gh pr create --title t -b"use ${TOKEN}"`,
  ]
  for (const command of commands) {
    const check = await checkPrBody(command, fileWith(`use ${TOKEN}`))
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('PR body, line 1')
    expect(reasonOf(check), command).not.toContain(TOKEN)
  }
})

test('checkPrBody: a body given as a whole $(cat file) is read from the file', async () => {
  const check = await checkPrBody('gh pr create --body "$(cat pr.md)"', async path => (path === 'pr.md' ? `ok\nuse ${TOKEN}` : undefined))
  expect(reasonOf(check)).toContain('PR body, line 2')
  const missing = await checkPrBody('gh pr create --body "$(cat pr.md)"', noFile)
  expect(reasonOf(missing)).toContain('cannot be read')
})

test('checkPrBody: a clean body passes on every form, and other commands pass', async () => {
  for (const command of [
    'export A=1\ngh pr create --title t --body "clean"',
    '(gh pr create --body "clean")',
    'gh -R org/repo pr create --fill',
    "sh -c 'gh pr edit 7 --body clean'",
    `git commit -m "mentions gh pr create ${TOKEN}"`,
    'bash run.sh',
    'gh pr view 7',
  ]) {
    expect((await checkPrBody(command, fileWith('clean'))).verdict, command).toBe('pass')
  }
})

test('checkCommitMessage: a secret in a message is denied before the commit, with the line and without the value', async () => {
  const commands = [
    `git commit -m "use ${TOKEN}"`,
    `git commit -am "use ${TOKEN}"`,
    `git commit -m 'feat: x' -m "use ${TOKEN}"`,
    `git commit --message="use ${TOKEN}"`,
    `git commit --message "use ${TOKEN}"`,
    `git commit --mess="use ${TOKEN}"`,
    `git commit -m"use ${TOKEN}"`,
    `git commit -sm "use ${TOKEN}"`,
    `git add f.ts && git commit -m "use ${TOKEN}"`,
    `(cd app; git commit -m "use ${TOKEN}")`,
    `git -c core.pager=cat commit -m "use ${TOKEN}"`,
    `/usr/bin/git commit -m "use ${TOKEN}"`,
    `sh -c 'git commit -m "use ${TOKEN}"'`,
    `git commit -m "$(cat <<'EOF'\nfeat: x\n\nuse ${TOKEN}\nEOF\n)"`,
    `git commit -F - <<'EOF'\nfeat: x\n\nuse ${TOKEN}\nEOF`,
    'git commit -F msg.txt',
    'git commit --file=msg.txt',
    'git commit -m "$(cat msg.txt)"',
  ]
  for (const command of commands) {
    const check = await checkCommitMessage(command, fileWith(`feat: x\n\nuse ${TOKEN}`))
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toMatch(/commit message, line \d/)
    expect(reasonOf(check), command).not.toContain(TOKEN)
    for (const step of ['Stop', 'Rotate', 'ACDC', 'Document']) expect(reasonOf(check), command).toContain(step)
  }
})

test('checkCommitMessage: the line of the hit is its line in the message', async () => {
  const check = await checkCommitMessage(`git commit -m "$(cat <<'EOF'\nfeat: x\n\nuse ${TOKEN}\nEOF\n)"`, noFile)
  expect(reasonOf(check)).toContain('commit message, line 3')
  const file = await checkCommitMessage('git commit -F msg.txt', fileWith(`a\nb\nuse ${TOKEN}`))
  expect(reasonOf(file)).toContain('commit message, line 3')
})

test('checkCommitMessage: a clean message passes, and so do commands that are no commit with a message', async () => {
  for (const command of [
    'git commit -m "feat: x"',
    "git commit -m 'feat: x' -m 'body'",
    'git commit -F msg.txt',
    "git commit -F - <<'EOF'\nfeat: x\nEOF",
    'git commit --amend --no-edit',
    'git commit -C HEAD',
    'git commit -a',
    `git log -m "${TOKEN}"`,
    `echo "git commit -m ${TOKEN}"`,
    'npm test',
    'bash run.sh',
  ]) {
    expect((await checkCommitMessage(command, fileWith('feat: x'))).verdict, command).toBe('pass')
  }
})

test('checkCommitMessage: a message that cannot be read denies and names the cause', async () => {
  const missing = await checkCommitMessage('git commit -F msg.txt', noFile)
  expect(missing.verdict).toBe('deny')
  expect(reasonOf(missing)).toContain('The secret check could not run')
  expect(reasonOf(missing)).toContain('msg.txt')
  const stdin = await checkCommitMessage('cat msg.txt | git commit -F -', noFile)
  expect(stdin.verdict).toBe('deny')
  expect(reasonOf(stdin)).toContain('standard input')
})

test('publishKinds: gh with an option between pr and the verb is a PR call', () => {
  expect(publishKinds('gh pr -R org/repo edit 7 --body-file x.md').isPr).toBe(true)
  expect(publishKinds('gh pr --repo org/repo create --fill').isPr).toBe(true)
  expect(publishKinds('gh pr -R org/repo view 7').isPr).toBe(false)
})

test('checkPrBody and checkCommitMessage: a command that hides what it runs, or nests shells too deep, cannot be read, so it is denied', async () => {
  for (const command of ['env -S "gh pr create --body x"', 'sh -c "sh -c \'sh -c \\"gh pr create --body x\\"\'"']) {
    const pr = await checkPrBody(command, noFile)
    expect(pr.verdict, command).toBe('deny')
    expect(reasonOf(pr), command).toContain('The secret check could not run')
    const commit = await checkCommitMessage(command, noFile)
    expect(commit.verdict, command).toBe('deny')
    expect(reasonOf(commit), command).toContain('The secret check could not run')
  }
})

// A private key that starts in the middle of a line. The fragments are joined here, so no file holds a key block, and the base64 line is filler.
const BEGIN_MARK = ['-----BEGIN', ' RSA PRIVATE', ' KEY-----'].join('')
const KEY_LINE = ['MIIE', 'a'.repeat(30), 'Zm9v', 'b'.repeat(30)].join('')
const addedPatch = (path: string, lines: string[]): string =>
  [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(line => `+${line}`),
  ].join('\n') + '\n'

test('scanPatch: a private key block whose begin marker is in the middle of a line is a private-key hit at that line', () => {
  for (const first of [
    `KEY = """${BEGIN_MARK}`,
    `const key = \`${BEGIN_MARK}`,
    `key: '${BEGIN_MARK}`,
    `export KEY="${BEGIN_MARK}`,
    `  - ${BEGIN_MARK}`,
    `# ${BEGIN_MARK}`,
    BEGIN_MARK,
  ]) {
    const hits = scanPatch(addedPatch('src/keys.py', ['import os', first, KEY_LINE, 'END']))
    expect(hits, first).toEqual([{ shape: 'private-key', place: { kind: 'file', path: 'src/keys.py', line: 2 } }])
  }
})

test('scanPatch: a begin marker in the middle of a line with no key body after it is no hit', () => {
  expect(scanPatch(addedPatch('docs/keys.md', [`Files that start with ${BEGIN_MARK} are keys.`, 'Never commit them.']))).toEqual([])
  expect(scanPatch(addedPatch('docs/keys.md', [`KEY = """${BEGIN_MARK}`]))).toEqual([])
})

test('redactSecrets: a token shape is replaced by <removed: token> and the other text stays', () => {
  expect(redactSecrets(`curl -H 'Authorization: token ${TOKEN}' https://example.test/`)).toBe(
    "curl -H 'Authorization: token <removed: token>' https://example.test/"
  )
  expect(redactSecrets(`echo ${TOKEN} ${TOKEN}`)).toBe('echo <removed: token> <removed: token>')
  expect(redactSecrets('gh pr merge 7')).toBe('gh pr merge 7')
  expect(redactSecrets('')).toBe('')
})

test('redactSecrets: every shape of shapes.ts is replaced, and nothing the shapes do not name', () => {
  const aws = join('AKIA', 'ABCDEFGHIJKLMNOP')
  const jira = join('JIRA_', 'TOKEN=', 'a'.repeat(24))
  expect(redactSecrets(`a ${aws} b`)).toBe('a <removed: token> b')
  expect(redactSecrets(`export ${jira}`)).toBe('export <removed: token>')
  expect(redactSecrets('password is hunter2')).toBe('password is hunter2')
})

test('redactSecrets: a private key block is replaced, and a begin marker with no key body after it stays', () => {
  const block = `KEY = """${BEGIN_MARK}\n${KEY_LINE}\n-----END RSA PRIVATE KEY-----\nrest`
  const out = redactSecrets(block)
  expect(out).toContain('<removed: token>')
  expect(out).not.toContain(KEY_LINE)
  expect(out.endsWith('\nrest')).toBe(true)
  const prose = `Files that start with ${BEGIN_MARK} are keys.\nNever commit them.`
  expect(redactSecrets(prose)).toBe(prose)
})

test('redactSecrets: a begin marker in prose does not hide a key block that follows it', () => {
  const END_MARK = '-----END RSA PRIVATE KEY-----'
  const prose = `Files that start with ${BEGIN_MARK} are keys.\nNever commit them.`
  for (const body of [
    `${BEGIN_MARK}\n${KEY_LINE}\n${END_MARK}`,
    `# ${BEGIN_MARK}\n# ${KEY_LINE}\n# ${END_MARK}`,
    `${BEGIN_MARK}\nProc-Type: 4,ENCRYPTED\n${KEY_LINE}\n${END_MARK}`,
  ]) {
    const out = redactSecrets(`${prose}\n${body}\nrest`)
    expect(out, body).toBe(`${prose}\n${body.startsWith('#') ? '# ' : ''}<removed: token>\nrest`)
    expect(out).not.toContain(KEY_LINE)
  }
})

test('a private key that starts mid-line is denied by the commit check, the push check, the message check and the PR body check, never with its value', async () => {
  const first = `KEY = """${BEGIN_MARK}`
  const patch = addedPatch('src/keys.py', [first, KEY_LINE])
  const commit = await checkCommit({ stagedPatch: async () => patch, commitsAhead: async () => [] })
  expect(commit.verdict).toBe('deny')
  expect(reasonOf(commit)).toContain('file src/keys.py, line 1')
  const push = await checkPush({ stagedPatch: async () => '', commitsAhead: async () => [{ sha: SHA, message: 'feat: x', patch }] }, 'main')
  expect(push.verdict).toBe('deny')
  expect(reasonOf(push)).toContain('file src/keys.py, line 1, commit c0ffee1')
  // The message is written inside double quotes, so its first line uses single quotes.
  const quoted = `key: '${BEGIN_MARK}`
  const message = await checkCommitMessage(`git commit -m "$(cat <<'EOF'\nfeat: x\n\n${quoted}\n${KEY_LINE}\nEOF\n)"`, noFile)
  expect(reasonOf(message)).toContain('commit message, line 3')
  const body = await checkPrBody('gh pr create --body-file pr.md', fileWith(`Summary\n\n${first}\n${KEY_LINE}\n`))
  expect(reasonOf(body)).toContain('PR body, line 3')
  const pushMessage = await checkPush(
    { stagedPatch: async () => '', commitsAhead: async () => [{ sha: SHA, message: `${first}\n${KEY_LINE}`, patch: '' }] },
    'main'
  )
  expect(reasonOf(pushMessage)).toContain('commit message of c0ffee1, line 1')
  for (const check of [commit, push, message, body, pushMessage]) {
    expect(reasonOf(check)).not.toContain(KEY_LINE)
    expect(reasonOf(check)).not.toContain(BEGIN_MARK)
  }
})

test('untrackedScope: a commit takes tracked files only, so no untracked file is read', () => {
  for (const command of [
    "git commit -m 'x'",
    "git commit -a -m 'x'",
    "git commit -am 'x'",
    "git add -u && git commit -m 'x'",
    "git add src/a.ts && git commit -m 'x'".replace('src/a.ts', '-u'),
    "git status && git commit -m 'x' -- src/a.ts",
    'npm test',
  ]) {
    expect(untrackedScope(command), command).toEqual({ all: false, paths: [] })
  }
})

test('untrackedScope: a git add of the same command puts the untracked files it names into the commit', () => {
  expect(untrackedScope("git add src/a.ts docs && git commit -m 'x'")).toEqual({ all: false, paths: ['src/a.ts', 'docs'] })
  expect(untrackedScope("git add ./src/ && git commit -m 'x'")).toEqual({ all: false, paths: ['src'] })
  expect(untrackedScope("git add -v -- a.txt b.txt && git commit -m 'x'")).toEqual({ all: false, paths: ['a.txt', 'b.txt'] })
  expect(untrackedScope("(git add a.txt; git commit -m 'x')")).toEqual({ all: false, paths: ['a.txt'] })
  expect(untrackedScope("sh -c 'git add a.txt && git commit -m x'")).toEqual({ all: false, paths: ['a.txt'] })
})

test('untrackedScope: git add -A, --all, ., a glob, pathspec magic, -N, -i, -p and a pathspec file put all of them in', () => {
  for (const add of [
    'git add -A',
    'git add --all',
    'git add .',
    'git add ./',
    'git add :/',
    'git add :(glob)**/*.ts',
    'git add *.ts',
    'git add src/*',
    'git add -N src',
    'git add -i',
    'git add -p',
    'git add -vA',
    'git add --pathspec-from-file=list.txt',
  ]) {
    expect(untrackedScope(`${add} && git commit -m x`), add).toEqual({ all: true, paths: [] })
  }
})

test('untrackedScope: a command the check cannot place, or one that changes directory, puts all of them in', () => {
  for (const command of ['env -S "git add a.txt"', 'cd app && git add a.txt && git commit -m x', 'git -C app add a.txt', 'git --git-dir=x add a.txt']) {
    expect(untrackedScope(command), command).toEqual({ all: true, paths: [] })
  }
})

test('checkCommitMessage and checkPrBody: the line of a hit in a heredoc is its line in the message or the body, not in the command', async () => {
  const line = (n: number, text: string): string[] => [...Array<string>(n - 1).fill('ok'), text]
  const message = [...line(5, `use ${TOKEN}`)].join('\n')
  for (const command of [`git commit -m "$(cat <<'EOF'\n${message}\nEOF\n)"`, `git add f.ts && git commit -a -m "$(cat <<'EOF'\n${message}\nEOF\n)"`]) {
    expect(reasonOf(await checkCommitMessage(command, noFile)), command).toContain('commit message, line 5')
  }
  const body = `gh pr create --title t --body "$(cat <<'EOF'\n${message}\nEOF\n)"`
  expect(reasonOf(await checkPrBody(body, noFile))).toContain('PR body, line 5')
  // A second -m is a paragraph after a blank line, as Git joins them.
  const two = await checkCommitMessage(`git commit -m 'one' -m "use ${TOKEN}"`, noFile)
  expect(reasonOf(two)).toContain('commit message, line 3')
})

test('checkCommitMessage: standard input is read when a heredoc, a here-string or a < file feeds that command itself', async () => {
  const body = `ok\nok\nuse ${TOKEN}`
  for (const command of [
    `git commit -F - <<'EOF'\n${body}\nEOF`,
    `git commit --file=- <<-EOF\n${body}\nEOF`,
    `git add f && git commit -F - <<EOF\n${body}\nEOF\ngit log -1`,
  ]) {
    expect(reasonOf(await checkCommitMessage(command, noFile)), command).toContain('commit message, line 3')
  }
  expect(reasonOf(await checkCommitMessage(`git commit -F - <<< "use ${TOKEN}"`, noFile))).toContain('commit message, line 1')
  for (const command of ['git commit -F - < msg.txt', 'git commit -F - <msg.txt', 'git commit -F -  < msg.txt && git log -1']) {
    expect(reasonOf(await checkCommitMessage(command, async path => (path === 'msg.txt' ? body : undefined))), command).toContain('commit message, line 3')
  }
  expect((await checkCommitMessage("git commit -F - <<'EOF'\nfeat: x\nEOF", noFile)).verdict).toBe('pass')
})

test('checkCommitMessage: standard input that nothing on the commit feeds cannot be read, even when a heredoc stands elsewhere in the command', async () => {
  for (const command of [
    'cat msg.txt | git commit -F -',
    "echo x | git commit -F -; cat <<'EOF'\nok\nEOF",
    "git commit -F -; cat <<'EOF'\nok\nEOF",
    "git commit -F - && cat > notes.txt <<'EOF'\nok\nEOF",
    'git commit --file -',
  ]) {
    const check = await checkCommitMessage(command, fileWith(`use ${TOKEN}`))
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('The secret check could not run')
    expect(reasonOf(check), command).toContain('standard input')
  }
})

test('checkPrBody: --body-file - and -F - read standard input, not a file named -', async () => {
  const body = `ok\nuse ${TOKEN}`
  const readFile = async (path: string): Promise<string | undefined> => (path === 'pr.md' ? body : undefined)
  for (const command of [
    `gh pr create --title t --body-file - <<'EOF'\n${body}\nEOF`,
    `gh pr create -F - <<EOF\n${body}\nEOF`,
    `gh pr edit 7 --body-file=- <<'EOF'\n${body}\nEOF`,
    'gh pr create --body-file - < pr.md',
    'gh pr create -F - <pr.md',
    `gh pr create --body-file - <<< "ok\nuse ${TOKEN}"`,
  ]) {
    expect(reasonOf(await checkPrBody(command, readFile)), command).toContain('PR body, line 2')
  }
  expect((await checkPrBody("gh pr create --body-file - <<'EOF'\nclean\nEOF", noFile)).verdict).toBe('pass')
  for (const command of ['cat pr.md | gh pr create --body-file -', "gh pr create -F -; cat <<'EOF'\nok\nEOF", 'gh pr create --body-file=-']) {
    const check = await checkPrBody(command, readFile)
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('standard input')
  }
})

test('checkCommitMessage: only a $(cat <<EOF ... EOF) that is the whole value is read as its lines, any other shape is checked as written', async () => {
  const lines = (first: string): string => `$(cat <<'EOF'\n${first}\nEOF\n)`
  expect(reasonOf(await checkCommitMessage(`git commit -m "${lines(`use ${TOKEN}`)}"`, noFile))).toContain('commit message, line 1')
  for (const value of [
    `$(cat <<'EOF'\nok\nEOF\n; echo use ${TOKEN})`,
    `$(cat notes.txt <<'EOF'\nok\nEOF\n; echo use ${TOKEN})`,
    `$(cat <<'EOF' | tr a b\nok\nEOF\n; echo use ${TOKEN})`,
    `$(cat <<'EOF'\nok\nEOF\n) use ${TOKEN}`,
  ]) {
    expect((await checkCommitMessage(`git commit -m "${value}"`, noFile)).verdict, value).toBe('deny')
  }
})

test('checkCommitMessage and checkPrBody: a file is not placed when the command changes directory, so the check denies and names the cause', async () => {
  const readFile = fileWith('feat: clean')
  for (const command of [
    'cd app && git commit -F msg.txt',
    '(cd app; git commit --file=msg.txt)',
    'pushd app; git commit -F msg.txt',
    'git -C app commit -F msg.txt',
    'cd app && git commit -m "$(cat msg.txt)"',
    'cd app && git commit -F - < msg.txt',
    "sh -c 'cd app && git commit -F msg.txt'",
  ]) {
    const check = await checkCommitMessage(command, readFile)
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('changes directory')
    expect(reasonOf(check), command).toContain('cannot be placed')
  }
  for (const command of [
    'cd app && gh pr create --body-file pr.md',
    '(cd app; gh pr edit 7 -F pr.md)',
    'gh -R o/r pr create --body "$(cat pr.md)" && cd app',
  ]) {
    const check = await checkPrBody(command, readFile)
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('cannot be placed')
  }
})

test('checkCommitMessage and checkPrBody: after a change of directory, an absolute path is read, and a literal message needs no file', async () => {
  const readFile = async (path: string): Promise<string | undefined> => (path === '/work/app/msg.txt' ? `use ${TOKEN}` : undefined)
  expect(reasonOf(await checkCommitMessage('cd app && git commit -F /work/app/msg.txt', readFile))).toContain('commit message, line 1')
  expect(reasonOf(await checkPrBody('cd app && gh pr create --body-file /work/app/msg.txt', readFile))).toContain('PR body, line 1')
  expect((await checkCommitMessage('cd app && git commit -m "feat: clean"', noFile)).verdict).toBe('pass')
  expect((await checkPrBody('cd app && gh pr create --body "clean"', noFile)).verdict).toBe('pass')
  expect(reasonOf(await checkCommitMessage(`cd app && git commit -m "use ${TOKEN}"`, noFile))).toContain('commit message, line 1')
})

test('checkCommitMessage: a pipe in the command line, a device as the source, or an expanded here-string or heredoc is not read as written', async () => {
  const readFile = fileWith('feat: clean')
  for (const command of [
    "echo x | git commit -F - --author '<benign.txt'",
    "cat msg | git commit -F - <<'EOF'\nfeat: clean\nEOF",
    'git commit -F - < /dev/stdin',
    'git commit -F - </proc/self/fd/0',
    'git commit -F - <<< "$HOME"',
    'git commit -F - <<< "$(git log -1)"',
    'git commit -F - <<EOF\nfeat: $(date)\nEOF',
    'git commit -F - <<EOF\nfeat: ${USER}\nEOF',
  ]) {
    const check = await checkCommitMessage(command, readFile)
    expect(check.verdict, command).toBe('deny')
    expect(reasonOf(check), command).toContain('The secret check could not run')
  }
  // The text of a quoted heredoc is literal, and a pipe in its body is a table cell.
  expect((await checkCommitMessage("git commit -F - <<'EOF'\nfeat: $(date) | a | b |\nEOF", noFile)).verdict).toBe('pass')
  expect(reasonOf(await checkCommitMessage(`git commit -F - <<'EOF'\n| a | ${TOKEN} |\nEOF`, noFile))).toContain('commit message, line 1')
  // A here-string of $(cat file) is that file.
  expect(reasonOf(await checkCommitMessage('git commit -F - <<< "$(cat msg.txt)"', fileWith(`use ${TOKEN}`)))).toContain('commit message, line 1')
})

test('untrackedScope: a command the check cannot place, or one that may add files by another way, puts all untracked files in', () => {
  for (const command of [
    "git ls-files -o | xargs git add && git commit -m 'x'",
    "find . -name '*.png' -exec git add {} + && git commit -m 'x'",
    "parallel git add ::: a.txt && git commit -m 'x'",
    "bash add.sh && git commit -m 'x'",
    "./add.sh && git commit -m 'x'",
    "source add.sh; git commit -m 'x'",
    "git stage a.txt && git commit -m 'x'",
    "git update-index --add a.txt && git commit -m 'x'",
    "git apply --index p.diff && git commit -m 'x'",
    "git read-tree HEAD && git commit -m 'x'",
    "git x && git commit -m 'x'",
    "git add ../other && git commit -m 'x'",
    "git add /abs/path && git commit -m 'x'",
    "git add a//b && git commit -m 'x'",
    "git add a/../b && git commit -m 'x'",
    "git add 'a*' && git commit -m 'x'",
  ]) {
    expect(untrackedScope(command), command).toEqual({ all: true, paths: [] })
  }
  expect(untrackedScope("sh -c 'git status' && git commit -m 'x'")).toEqual({ all: false, paths: [] })
  expect(untrackedScope("git status && git log -1 && git push origin sdd/x && git commit -m 'x'")).toEqual({ all: false, paths: [] })
})

test('every shell of the shared list has its -c string read by the secret checks', async () => {
  for (const shell of ['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish']) {
    expect((await checkCommitMessage(`${shell} -c 'git commit -m "use ${TOKEN}"'`, noFile)).verdict, shell).toBe('deny')
    expect((await checkPrBody(`${shell} -c 'gh pr create --body "use ${TOKEN}"'`, noFile)).verdict, shell).toBe('deny')
    expect(publishKinds(`${shell} -c "git commit -m x"`).commit, shell).toBe(true)
    expect(untrackedScope(`${shell} -c "git add -A" && git commit -m x`), shell).toEqual({ all: true, paths: [] })
  }
})
