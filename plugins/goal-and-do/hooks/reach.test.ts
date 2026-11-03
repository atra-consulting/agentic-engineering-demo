import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import { guard, reasonKeyOf } from './guard'

type Ctx = Parameters<typeof guard>[1]

const ctxFor = (phase: PhaseName, overrides: Partial<Ctx> = {}): Ctx => ({
  active: true,
  phase,
  id: 'ABC-1',
  lockedPaths: [],
  root: '/work/proj',
  home: '/home/dev',
  ...overrides,
})

const PHASES: PhaseName[] = ['Spec', 'Plan', 'Build', 'Test', 'PR']
const bash = (command: string) => ({ tool: 'Bash', input: { command } })
const grepTool = (input: Record<string, unknown>) => ({ tool: 'Grep', input })
const read = (file_path: string) => ({ tool: 'Read', input: { file_path } })

function expectFolderSearch(call: { tool: string; input: Record<string, unknown> }, overrides: Partial<Ctx>): void {
  for (const phase of PHASES) {
    const result = guard(call, ctxFor(phase, overrides))
    expect(result.verdict, `${phase} ${JSON.stringify(call.input)}`).toBe('deny')
    if (result.verdict === 'deny') expect(reasonKeyOf(result.reason)).toBe('folderSearch')
  }
}

function expectPass(call: { tool: string; input: Record<string, unknown> }, overrides: Partial<Ctx>): void {
  for (const phase of PHASES) {
    expect(guard(call, ctxFor(phase, overrides)).verdict, `${phase} ${JSON.stringify(call.input)}`).toBe('pass')
  }
}

test('a search rooted at a folder above the project root covers the whole project', () => {
  const env = { envFiles: ['.env'], envFilesReachable: ['.env'] }
  expectFolderSearch(bash('grep -r SECRET ..'), env)
  expectFolderSearch(bash('rg SECRET /work'), env)
  expectFolderSearch(grepTool({ pattern: 'SECRET', path: '/work' }), env)
  expectFolderSearch(grepTool({ pattern: 'SECRET', path: '/' }), env)
  expectFolderSearch(bash('grep -r SECRET ..'), { envFilesUnknown: true })
  expectPass(bash("grep -r --exclude='.env*' SECRET .."), env)
  expectPass(bash('grep -r SECRET ..'), { envFiles: [], envFilesReachable: [] })
  expectPass(bash('grep -r SECRET /work/other'), env)
  expectPass(bash('rg SECRET ../other'), env)
  expectPass(grepTool({ pattern: 'SECRET', path: '/work', glob: '*.kt' }), env)
})

test('ack is judged by all environment files, ag by all when it is told to read ignored files', () => {
  const ignored = { envFiles: ['.env'], envFilesReachable: [] }
  expectFolderSearch(bash('ack SECRET'), ignored)
  for (const option of ['-U', '--skip-vcs-ignores', '--hidden', '-a', '--all-types', '-u', '--unrestricted']) {
    expectFolderSearch(bash(`ag ${option} SECRET`), ignored)
  }
  expectPass(bash('ag SECRET'), ignored)
  expectPass(bash('rg SECRET'), ignored)
  expectPass(bash('ack SECRET'), { envFiles: [], envFilesReachable: [] })
  expectFolderSearch(bash('ag SECRET'), { envFiles: ['.env'], envFilesReachable: ['.env'] })
})

test('git-credentials, the gh hosts file and the git credentials file are credential stores', () => {
  const stores = ['/home/dev/.git-credentials', '/home/dev/.config/gh/hosts.yml', '/home/dev/.config/git/credentials']
  for (const phase of PHASES) {
    for (const store of stores) {
      for (const call of [read(store), grepTool({ pattern: 'x', path: store }), bash(`cat ${store}`)]) {
        const result = guard(call, ctxFor(phase))
        expect(result.verdict, `${phase} ${JSON.stringify(call.input)}`).toBe('deny')
        if (result.verdict === 'deny') {
          expect(reasonKeyOf(result.reason)).toBe('credentialStore')
          expect(result.reason).toContain(store)
        }
      }
    }
    for (const command of ['cat ~/.git-credentials', 'cat $HOME/.config/gh/hosts.yml', 'cat ~/.config/git/credentials']) {
      expect(guard(bash(command), ctxFor(phase)).verdict, command).toBe('deny')
    }
  }
  // Other files in the same folders, and a project file of the same name, stay readable.
  expectPass(read('/home/dev/.config/gh/config.yml'), {})
  expectPass(read('/home/dev/.config/git/ignore'), {})
  expectPass(read('/work/proj/.git-credentials'), {})
  expectPass(bash('ls ~/.config/gh'), {})
  // A folder search rooted at a folder that holds one is refused, unless its glob cannot match the file.
  expectFolderSearch(grepTool({ pattern: 'x', path: '/home/dev/.config/gh' }), {})
  expectFolderSearch(grepTool({ pattern: 'x', path: '/home/dev/.config' }), {})
  expectPass(grepTool({ pattern: 'x', path: '/home/dev/.config/gh', glob: '*.kt' }), {})
})

test('bundled short flags widen ag and rg, and the values of ag options are not taken for the pattern', () => {
  const ignored = { envFiles: ['.env'], envFilesReachable: [] }
  for (const command of [
    'ag -Ua SECRET',
    'ag -ua SECRET',
    'ag -nU SECRET',
    'ag -aU SECRET',
    'rg -uu SECRET',
    'rg -nu SECRET',
    'rg -uun SECRET',
    'ag -Un SECRET',
  ]) {
    expectFolderSearch(bash(command), ignored)
  }
  expectPass(bash('rg -n SECRET'), ignored)
  expectPass(bash('ag -n SECRET'), ignored)
  // --depth takes a value: the pattern is SECRET and the search is over the project folder.
  expectFolderSearch(bash('ag --depth 2 SECRET'), { envFiles: ['.env'], envFilesReachable: ['.env'] })
  expectFolderSearch(bash('ag -G kt$ SECRET'), { envFiles: ['.env'], envFilesReachable: ['.env'] })
  expectPass(bash('ag -G kt$ SECRET'), ignored)
  expectFolderSearch(bash('ag -G kt$ -U SECRET'), ignored)
  expectPass(bash('ag --ignore-dir build SECRET src'), { envFiles: ['.env'], envFilesReachable: ['.env'] })
})

test('paths are compared with the project root without regard to case', () => {
  const env = { envFiles: ['.env'], envFilesReachable: ['.env'] }
  expectFolderSearch(bash('grep -r SECRET /WORK'), env)
  expectFolderSearch(bash('grep -r SECRET /Work/Proj'), env)
  expectFolderSearch(grepTool({ pattern: 'SECRET', path: '/WORK/PROJ' }), env)
  expectFolderSearch(grepTool({ pattern: 'SECRET', path: '/work' }), { envFilesUnknown: true })
  expectPass(bash('grep -r SECRET /WORK/other'), env)
  expectPass(bash('grep -r SECRET /WORK/PROJ/src'), env)
  // A steering file under a root spelled in another case is still a steering file.
  for (const phase of PHASES) {
    const result = guard({ tool: 'Write', input: { file_path: '/WORK/PROJ/CLAUDE.md' } }, ctxFor(phase))
    expect(result.verdict, phase).toBe('deny')
    if (result.verdict === 'deny') expect(reasonKeyOf(result.reason)).toBe('steeringFile')
  }
})

test('case is folded only where a path is refused: a differently cased path is granted nothing', () => {
  const change = 'changes/ABC-1/intent.md'
  const edit = (file: string, overrides: Partial<Ctx> = {}, phase: PhaseName = 'Intent') =>
    guard({ tool: 'Write', input: { file_path: file } }, ctxFor(phase, { real: { path: file, root: '/work/proj' }, ...overrides }))
  // The Intent phase allows edits in the change folder only; a root spelled in another case is not that folder.
  expect(edit(`/work/proj/${change}`).verdict).toBe('pass')
  for (const file of [`/WORK/PROJ/${change}`, `/Work/proj/${change}`, `/work/PROJ/${change}`]) {
    const result = edit(file)
    expect(result.verdict, file).toBe('deny')
    if (result.verdict === 'deny') expect(reasonKeyOf(result.reason), file).toBe('intentEdit')
  }
  // A planned-paths entry grants the file spelled as the entry spells it, under the root as spelled.
  const planned = { plannedPaths: ['CLAUDE.md'] }
  expect(edit('/work/proj/CLAUDE.md', planned, 'Build').verdict).toBe('pass')
  for (const file of ['/WORK/PROJ/CLAUDE.md', '/work/proj/claude.md', '/work/proj/Claude.md']) {
    const result = edit(file, planned, 'Build')
    expect(result.verdict, file).toBe('deny')
    if (result.verdict === 'deny') expect(reasonKeyOf(result.reason), file).toBe('steeringFile')
  }
  // The refusals still fold case.
  expectFolderSearch(bash('grep -r SECRET /WORK/PROJ'), { envFiles: ['.env'], envFilesReachable: ['.env'] })
})

// Heredoc bodies are read as shell words

test('the guard reads the body of a heredoc as shell words, quoted or not, and the commands around it', () => {
  for (const command of ['cat <<EOF\ncat .env\nEOF', "echo hi # <<'X'\ncat .env\nX", "cat <<'EOF'\nbody\nEOF\ncat .env", "cat <<< 'x'\ncat .env"]) {
    for (const phase of PHASES) {
      const result = guard(bash(command), ctxFor(phase))
      expect(result.verdict, `${phase} ${command}`).toBe('deny')
      if (result.verdict === 'deny') expect(reasonKeyOf(result.reason)).toBe('envFile')
    }
  }
})

test('a quoted heredoc body is read as words, so a command in it is judged wherever the heredoc stands', () => {
  for (const command of [
    `echo "$(cat <<'EOF'\ncat .env\nEOF\n)"`,
    "echo `cat <<'EOF'\ncat .env\nEOF\n`",
    "cat > .husky/pre-commit <<'EOF'\ncat .env\nEOF\ngit commit -m x",
    "bash <<'EOF'\ncat .env\nEOF",
    "cat <<'EOF' | sh\ncat .env\nEOF",
    "cat > run.sh <<'EOF'\ncat .env\nEOF\npytest",
  ]) {
    for (const phase of PHASES) expect(guard(bash(command), ctxFor(phase)).verdict, `${phase} ${command}`).toBe('deny')
  }
})

test('the refusal names a glob as a pattern that could match an environment file, and a file as the file', () => {
  const refusal = (command: string): string => {
    const result = guard(bash(command), ctxFor('Build'))
    return result.verdict === 'deny' ? result.reason : ''
  }
  const pattern = refusal('cat .env*')
  expect(pattern).toContain('.env*, a pattern that could match one.')
  expect(reasonKeyOf(pattern)).toBe('envFile')
  const file = refusal('cat .env')
  expect(file).toMatch(/readable: \.env\.$/)
  expect(reasonKeyOf(file)).toBe('envFile')
})

test('every shell of the shared list has its -c string read, so a read of an environment file in it is judged', () => {
  for (const shell of ['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish']) {
    for (const phase of PHASES) {
      const result = guard(bash(`${shell} -c 'cat .env'`), ctxFor(phase))
      expect(result.verdict, `${phase} ${shell}`).toBe('deny')
      if (result.verdict === 'deny') expect(reasonKeyOf(result.reason), shell).toBe('envFile')
    }
  }
})

// Run 3 (November 2, 2026): a regex in a quoted awk or grep program blocked the finished Test phase twice as an
// environment file pattern. A wildcard counts only when it can reach an environment file. PR 48's security review: the
// shell expands $ and backticks, follows symlinks, and zsh reads ^ as a negation, so those keep the old rule.
function keyOf(command: string, overrides: Partial<Ctx>): string | undefined {
  const result = guard(bash(command), ctxFor('Test', overrides))
  return result.verdict === 'deny' ? reasonKeyOf(result.reason) : 'pass'
}

const ROOT_ENV = { envFiles: ['.env'], envFilesReachable: ['.env'], envLinks: [] }

test('the pattern of grep is regex syntax, with or without the listing; an awk or sed program keeps the old rule', () => {
  expect(keyOf("awk '/^hooks\\/.*:$/ { cur=$0; next }' out.txt", {})).toBe('envFile')
  expect(keyOf("grep -E '^hooks/.*:$|^[a-z].*\\.(ts|tsx):$' out.txt", {})).toBe('pass')
  expect(keyOf("grep -E '^hooks/.*:$' out.txt", ROOT_ENV)).toBe('pass')
  expect(keyOf("grep -c '^skills/.*' out.txt", { envFilesUnknown: true })).toBe('pass')
  expect(keyOf("sed -n 's/src\\/.*:$//p' out.txt", {})).toBe('envFile')
  expect(keyOf("sed -n '/src\\/.*/p' out.txt", {})).toBe('pass')
})

test('a file argument of grep, awk and sed is still a name, and -e or -f leaves no pattern word', () => {
  expect(keyOf('grep x .*', ROOT_ENV)).toBe('envFile')
  expect(keyOf("awk '{ print }' .*", ROOT_ENV)).toBe('envFile')
  expect(keyOf('grep -e x .*', {})).toBe('envFile')
  expect(keyOf('grep -f .* data.txt', {})).toBe('envFile')
  expect(keyOf("sed -e 's/a/b/' .*", {})).toBe('envFile')
  expect(keyOf("awk '{ print }' ^hooks/.env", {})).toBe('envFile')
})

test('in the project, a plain wildcard that matches no listed environment file and no link reaches none', () => {
  expect(keyOf('cat src/.*', ROOT_ENV)).toBe('pass')
  expect(keyOf('grep x src/.*', ROOT_ENV)).toBe('pass')
  expect(keyOf('cat app/.*', { envFiles: ['.env'], envFilesReachable: [], envLinks: [] })).toBe('pass')
  expect(keyOf('cat .*', { envFiles: [], envFilesReachable: [], envLinks: [] })).toBe('pass')
  expect(keyOf('cat src/.*', { ...ROOT_ENV, envLinks: ['docs/latest'] })).toBe('pass')
})

test('a wildcard that matches a listed environment file still counts as one', () => {
  expect(keyOf('cat .*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat .env*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat app/.*', { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'], envLinks: [] })).toBe('envFile')
  expect(keyOf('cat */.e*', { envFiles: ['app/.env'], envFilesReachable: ['app/.env'], envLinks: [] })).toBe('envFile')
  expect(keyOf('cd app && cat .*', { envFiles: ['app/.env'], envFilesReachable: ['app/.env'], envLinks: [] })).toBe('envFile')
})

test('a wildcard the shell expands, a link on its path or among its matches, and a zsh glob keep the old rule', () => {
  expect(keyOf('cat $D/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat ${D}/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat `echo app`/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat $(echo app)/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat ^app/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat src/#/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat src~x/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat src/.*', { ...ROOT_ENV, envLinks: ['src/.secret'] })).toBe('envFile')
  expect(keyOf('cat link/.*', { ...ROOT_ENV, envLinks: ['link'] })).toBe('envFile')
  expect(keyOf('cat a/link/.*', { ...ROOT_ENV, envLinks: ['a/link'] })).toBe('envFile')
  expect(keyOf('cat src/.*', { envFiles: ['.env'], envFilesReachable: ['.env'] })).toBe('envFile')
})

test('without a listing, outside the project, and where the listing does not look, the old rule holds', () => {
  expect(keyOf('cat src/.*', {})).toBe('envFile')
  expect(keyOf('cat src/.*', { envFilesUnknown: true })).toBe('envFile')
  expect(keyOf('cat ../other/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat /home/dev/other/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat node_modules/pkg/.*', { envFiles: [], envFilesReachable: [], envLinks: [] })).toBe('envFile')
  expect(keyOf('cat .git/.*', { envFiles: [], envFilesReachable: [], envLinks: [] })).toBe('envFile')
})

test('a named environment file counts whatever the listing says', () => {
  expect(keyOf('cat src/.env', { envFiles: [], envFilesReachable: [], envLinks: [] })).toBe('envFile')
})

// PR 48's second security review: an unquoted pattern word is globbed by the shell, an option with an argument moves the
// pattern word, and a link made earlier in the same command beats the listing.
test('a pattern word is regex syntax only when its wildcards sit inside quotes', () => {
  expect(keyOf('grep .e* data.txt', ROOT_ENV)).toBe('envFile')
  expect(keyOf('grep .e* data.txt', {})).toBe('envFile')
  expect(keyOf('grep ^x/.* data.txt', ROOT_ENV)).toBe('envFile')
  expect(keyOf('grep -E "^hooks/.*:$" out.txt', {})).toBe('pass')
  expect(keyOf("grep -E '^hooks/'.*':$' out.txt", {})).toBe('envFile')
})

test('only flags without an argument leave the pattern word in place', () => {
  expect(keyOf("gawk -E '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("gawk -i '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("gawk --source '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("awk -F: '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("grep -m 1 '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("grep --include=x '.e*' data.txt", {})).toBe('envFile')
  expect(keyOf("grep '.e*' -f x data.txt", {})).toBe('envFile')
  expect(keyOf("grep -c -E '^skills/.*' out.txt", {})).toBe('pass')
  expect(keyOf("grep -cnv -- '^skills/.*' out.txt", {})).toBe('pass')
  expect(keyOf("sed -n -E 's/x.*//p' out.txt", {})).toBe('pass')
})

test('the listing lets a wildcard through only in a command of one segment', () => {
  expect(keyOf('ln -s ../.env src/.x && cat src/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('ln -s ../.env src/.x; cat src/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat src/.* | head', ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat $(ln -s ../.env src/.x) src/.*', ROOT_ENV)).toBe('envFile')
  expect(keyOf("grep -E '^hooks/.*:$' out.txt | sed 's/^hooks\\///' | sort", ROOT_ENV)).toBe('pass')
  expect(keyOf("awk '/^hooks\\/.*:$/ { print }' out.txt | sort", ROOT_ENV)).toBe('envFile')
})

// PR 48's third security review: awk and sed programs can run commands, a quoted wildcard can be expanded later by
// another tool, and an unquoted $ in a pattern word adds words the guard can't see.
test('an awk or sed program is never a pattern word, so a command it runs keeps the old rule', () => {
  expect(keyOf('awk \'{ system("cat .e*") }\' data.txt', {})).toBe('envFile')
  expect(keyOf('awk \'{ print | "cat .e*" }\' data.txt', {})).toBe('envFile')
  expect(keyOf('awk \'{ "cat .e*" | getline x }\' data.txt', {})).toBe('envFile')
  expect(keyOf("sed 's/x/cat .e*/e' data.txt", {})).toBe('envFile')
  expect(keyOf("sed '1e cat .e*' data.txt", {})).toBe('envFile')
  expect(keyOf("sed 's/x.*/y/w .e*' data.txt", {})).toBe('envFile')
  expect(keyOf("sed -n 's/src\\/.*:$//p' out.txt", {})).toBe('envFile')
  expect(keyOf("sed -n '/src\\/.*/p' out.txt", {})).toBe('pass')
  expect(keyOf("sed 's/^hooks\\/.*//; s/x.*//g' out.txt", {})).toBe('pass')
  expect(keyOf("awk '/^hooks\\/.*:$/ { cur=$0; next }' out.txt", {})).toBe('envFile')
})

test('the listing lets a wildcard through only when the shell itself globs it', () => {
  const appEnv = { envFiles: ['app/.env'], envFilesReachable: ['app/.env'], envLinks: [] }
  expect(keyOf("find app -name '.*' -exec cat {} +", appEnv)).toBe('envFile')
  expect(keyOf("find app -name '.*'", { envFiles: [], envFilesReachable: [], envLinks: [] })).toBe('envFile')
  expect(keyOf("cat 'src/.*'", ROOT_ENV)).toBe('envFile')
  expect(keyOf('cat src/.*', ROOT_ENV)).toBe('pass')
})

test('a pattern word with an unquoted $ is no pattern word', () => {
  expect(keyOf("grep $X'/.e*' data.txt", {})).toBe('envFile')
  expect(keyOf('grep $X"^hooks/.*" out.txt', {})).toBe('envFile')
  expect(keyOf("grep '^hooks/.*' out.txt", {})).toBe('pass')
})

// PR 48's fourth security review: a glob that matches nothing reaches the command as written, and a tool such as tar or
// rsync reads it as its own pattern. The listing lets a wildcard through only for commands that just read the files named.
test('the listing lets a wildcard through only for plain reading commands, and grep only without recursion', () => {
  for (const reader of ['cat', 'cat -n', 'head', 'head -n 5', 'head -5', 'tail -n 20', 'wc -l', 'grep x', 'grep -c x', 'grep -in x']) {
    expect(keyOf(`${reader} src/.*`, ROOT_ENV), reader).toBe('pass')
  }
  for (const other of [
    'tar cf x.tar --wildcards',
    'rsync -a',
    'cp -r',
    'zip -r x.zip',
    'xargs cat',
    'grep -r x',
    'grep -R x',
    'grep --recursive x',
    'grep -rn x',
  ]) {
    expect(keyOf(`${other} src/.*`, ROOT_ENV), other).toBe('envFile')
  }
})

// PR 48's fifth security review: abbreviated long options, diff -r, and options that read file names from a file.
test('a reader counts only with flags from its own list; any other option keeps the old rule', () => {
  for (const other of [
    'grep --recur x',
    'grep --dir=recurse x',
    'grep -d recurse x',
    'grep --include=x x',
    'diff -r',
    'diff',
    'sort',
    'file -f names.txt',
    'wc --files0-from=names.txt',
    'wc --files0-from names.txt',
    'head --lines=5',
    'cat --show-all',
  ]) {
    expect(keyOf(`${other} src/.*`, ROOT_ENV), other).toBe('envFile')
  }
})

// PR 48's sixth security review: a word the shell expands first can turn into an option after the flag check.
test('a word with brace expansion or an unquoted $ makes no plain reader', () => {
  for (const command of ['grep x src/.* {--recursive,y}', 'grep x src/.* {-r,y}', 'cat src/.* {a..c}', 'grep x src/.* $R', 'cat $OPT src/.*']) {
    expect(keyOf(command, ROOT_ENV), command).toBe('envFile')
  }
  expect(keyOf("grep 'a{1,2}' src/.*", ROOT_ENV)).toBe('pass')
})

// PR 51's security review: an unquoted glob that starts with a wildcard can match a file named like an option (-r).
test('a word that starts with an unquoted wildcard makes no plain reader; a path prefix keeps it one', () => {
  for (const command of ['grep x src/.* *', 'grep x src/.* ?r', 'cat src/.* [-]r', 'head src/.* *.txt']) {
    expect(keyOf(command, ROOT_ENV), command).toBe('envFile')
  }
  expect(keyOf('cat src/.* docs/*.md', ROOT_ENV)).toBe('pass')
  expect(keyOf('grep x src/.* ./*.txt', ROOT_ENV)).toBe('pass')
})

// PR 51's review of 2a92724: zsh expands more leading characters: ^ and ~ (extendedglob), # and = (a command's path).
test('a word that starts with a zsh expansion character makes no plain reader', () => {
  for (const command of ['cat src/.* ^x', 'cat src/.* ~x', 'grep x src/.* =x', "cat src/.* '^'x"]) {
    expect(keyOf(command, ROOT_ENV), command).toBe('envFile')
  }
  expect(keyOf('cat src/.* x^y', ROOT_ENV)).toBe('pass')
})
