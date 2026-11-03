import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import { BLOCKING_REASONS, guard, isDocLookupTool, isEnvFile, isMcpWrite, isOutboundTool, reasonKeyOf, testRunCommand } from './guard'
import { plannedToolsFrom, testEnvKeepFrom } from './pane'

type Ctx = Parameters<typeof guard>[1]

interface Call {
  tool: string
  input: Record<string, unknown>
}

interface Row {
  phases: PhaseName[]
  call: Call
  overrides?: Partial<Ctx>
}

const ALL_PHASES: PhaseName[] = ['Intent', 'Spec', 'Plan', 'Build', 'Test', 'PR']
const LATER_PHASES: PhaseName[] = ['Spec', 'Plan', 'Build', 'Test', 'PR']
const BEFORE_APPROVAL: PhaseName[] = ['Intent', 'Spec', 'Plan']
const CONTEXT7_QUERY = 'mcp__plugin_context7_context7__query-docs'
const CONTEXT7_RESOLVE = 'mcp__plugin_context7_context7__resolve-library-id'

const ctxFor = (phase: PhaseName, overrides: Partial<Ctx> = {}): Ctx => ({
  active: true,
  phase,
  id: 'ABC-1',
  lockedPaths: [],
  root: '/repo',
  home: '/home/dev',
  ...overrides,
})

const bash = (command: string): Call => ({ tool: 'Bash', input: { command } })
const read = (filePath: string): Call => ({ tool: 'Read', input: { file_path: filePath } })
const write = (filePath: string): Call => ({ tool: 'Write', input: { file_path: filePath } })
const grepTool = (input: Record<string, unknown>): Call => ({ tool: 'Grep', input })
const mcp = (tool: string, input: Record<string, unknown> = {}): Call => ({ tool, input })

const describeCall = (phase: PhaseName, call: Call): string => `${phase} ${call.tool} ${JSON.stringify(call.input)}`

const keyIsBlocking = (reason: string): boolean => {
  const key = reasonKeyOf(reason)
  return key !== undefined && BLOCKING_REASONS.has(key)
}

// A refusal that ends the run: deny, the reason contains `mention`, and the reason key is a blocking key.
const expectBlocked = (call: Call, phase: PhaseName, mention: string, overrides: Partial<Ctx> = {}): void => {
  const label = describeCall(phase, call)
  const result = guard(call, ctxFor(phase, overrides))
  expect(result.verdict, label).toBe('deny')
  if (result.verdict === 'deny') {
    expect(result.reason, label).toContain(mention)
    expect(reasonKeyOf(result.reason) !== undefined, `${label}: the reason has a key`).toBe(true)
    expect(keyIsBlocking(result.reason), `${label}: the reason key ends the run`).toBe(true)
  }
}

// A refusal with no demand on the key.
const expectDenied = (call: Call, phase: PhaseName, overrides: Partial<Ctx> = {}): void => {
  const label = describeCall(phase, call)
  const result = guard(call, ctxFor(phase, overrides))
  expect(result.verdict, label).toBe('deny')
}

// A refused folder search: deny with the key folderSearch, which does not end the run.
const expectFolderSearch = (call: Call, phase: PhaseName, mention: string, overrides: Partial<Ctx> = {}): void => {
  const label = `${describeCall(phase, call)} with ${JSON.stringify(overrides)}`
  const result = guard(call, ctxFor(phase, overrides))
  expect(result.verdict, label).toBe('deny')
  if (result.verdict === 'deny') {
    expect(result.reason, label).toContain(mention)
    expect(reasonKeyOf(result.reason), label).toBe('folderSearch')
    expect(keyIsBlocking(result.reason), `${label}: folderSearch does not end the run`).toBe(false)
  }
}

const TRACKED_ENV: Partial<Ctx> = { envFiles: ['.env'], envFilesReachable: ['.env'] }

const expectPass = (call: Call, phase: PhaseName, overrides: Partial<Ctx> = {}): void => {
  const label = `${describeCall(phase, call)} with ${JSON.stringify(overrides)}`
  expect(guard(call, ctxFor(phase, overrides)).verdict, label).toBe('pass')
}

test('AC-1: reads of .env and .env.<suffix> files are refused by name, through Read, Grep, a shell command and Git, in every phase', () => {
  expect(isEnvFile('.env')).toBe('secret')
  expect(isEnvFile('.env.local')).toBe('secret')
  expect(isEnvFile('.env.production')).toBe('secret')
  expect(isEnvFile('app/.env.local')).toBe('secret')
  expect(isEnvFile('/repo/.env')).toBe('secret')

  const named: [string, Call][] = [
    ['/repo/.env', read('/repo/.env')],
    ['/repo/.env.local', read('/repo/.env.local')],
    ['/repo/.env.production', read('/repo/.env.production')],
    ['/repo/app/.env.local', read('/repo/app/.env.local')],
    ['/repo/.env', grepTool({ pattern: 'SECRET', path: '/repo/.env' })],
    ['/repo/app/.env.local', grepTool({ pattern: 'SECRET', path: '/repo/app/.env.local' })],
    ['.env.local', grepTool({ pattern: 'SECRET', path: '/repo', glob: '.env.local' })],
    ['.env', bash('cat .env')],
    ['.env.local', bash('cat .env.local')],
    ['.env.production', bash('head -n 1 .env.production')],
    ['app/.env.production', bash('cat app/.env.production')],
    ['.env', bash('grep SECRET .env')],
    ['.env', bash('source .env')],
    ['.env.local', bash('set -a; source .env.local; set +a')],
    ['.env', bash('sort < .env')],
    ['.env', bash('cat < .env')],
    ['.env', bash('cat .env.example .env')],
    ['.env.local', bash('cd app && cat .env.local')],
    ['.env', bash("cat '.env'")],
    ['.env', bash('cat ".env"')],
    ['.env', bash('cat ./.env')],
    ['.env', bash('cat ../.env')],
    ['.ENV', bash('cat .ENV')],
    ['.env', bash('cat .env{,.local}')],
    ['.env', bash('git show HEAD:.env')],
    ['.env', bash('git show main:.env')],
    ['.env.local', bash('git show HEAD:app/.env.local')],
    ['.env', bash('git log -p -- .env')],
    ['.env', bash('git grep SECRET -- .env app/.env.local')],
    ['.env', bash('git grep -n SECRET HEAD -- .env')],
  ]
  for (const phase of LATER_PHASES) {
    for (const [mention, call] of named) {
      expectBlocked(call, phase, mention)
    }
  }

  // A folder search is judged by reach: refused with the key folderSearch, and the run goes on.
  const folderRefused: [Call, Partial<Ctx>, string][] = [
    [grepTool({ pattern: 'SECRET', path: '/repo' }), { envFiles: ['.env'] }, '/repo'],
    [grepTool({ pattern: 'SECRET' }), { envFiles: ['.env'] }, ''],
    [grepTool({ pattern: 'SECRET', path: '/repo/app' }), { envFiles: ['app/.env.local'] }, 'app'],
    [grepTool({ pattern: 'SECRET', path: '/repo' }), { envFiles: ['.env'], envFilesReachable: ['.env'] }, '/repo'],
    [bash('rg SECRET'), { envFiles: ['.env'], envFilesReachable: ['.env'] }, ''],
    [bash('git grep SECRET'), { envFiles: ['.env'] }, ''],
    [bash('rg -u SECRET'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('rg -uu SECRET'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('rg --no-ignore SECRET'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('git grep --untracked SECRET'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('git grep --no-index SECRET'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('grep -r SECRET .'), { envFiles: ['.env'], envFilesReachable: [] }, ''],
    [bash('grep -R SECRET .'), { envFiles: ['.env'] }, ''],
    [bash('grep -r SECRET app'), { envFiles: ['app/.env.local'] }, 'app'],
    [bash('grep -r SECRET .'), { envFilesUnknown: true }, ''],
    [bash('rg SECRET'), { envFilesUnknown: true }, ''],
    [bash('git grep SECRET'), { envFilesUnknown: true }, ''],
    [grepTool({ pattern: 'SECRET', path: '/repo' }), { envFilesUnknown: true, envFiles: [] }, '/repo'],
    // Git patch prints with no pathspec, or one that reaches the file, while the project tracks an environment file.
    [bash('git diff'), TRACKED_ENV, ''],
    [bash('git diff HEAD~1'), TRACKED_ENV, ''],
    [bash('git diff origin/main...HEAD'), TRACKED_ENV, ''],
    [bash('git diff --cached'), TRACKED_ENV, ''],
    [bash('git diff --stat -p'), TRACKED_ENV, ''],
    [bash('git diff -U5 main'), TRACKED_ENV, ''],
    [bash('git diff HEAD -- .'), TRACKED_ENV, ''],
    [bash('git diff -- app'), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }, 'app'],
    [bash('git -C . diff'), TRACKED_ENV, ''],
    [bash('git show'), TRACKED_ENV, ''],
    [bash('git show HEAD'), TRACKED_ENV, ''],
    [bash('git show abc1234 --format=%H'), TRACKED_ENV, ''],
    [bash('git log -p'), TRACKED_ENV, ''],
    [bash('git log -u -3'), TRACKED_ENV, ''],
    [bash('git log --patch main..HEAD'), TRACKED_ENV, ''],
    [bash('git log --cc'), TRACKED_ENV, ''],
    [bash('git log -pw'), TRACKED_ENV, ''],
    [bash('git reflog -p'), TRACKED_ENV, ''],
    [bash('git whatchanged -p'), TRACKED_ENV, ''],
    [bash('git diff-tree -p HEAD'), TRACKED_ENV, ''],
    [bash('git stash show -p'), TRACKED_ENV, ''],
    [bash('git diff'), { envFilesUnknown: true }, ''],
    [bash('git log -p'), { envFilesUnknown: true }, ''],
    // More routes to a patch: other options and sibling subcommands, a show of a revision beside a blob, no-index folders.
    [bash('git show HEAD HEAD:README.md'), TRACKED_ENV, ''],
    [bash('git log -U3'), TRACKED_ENV, ''],
    [bash('git log --word-diff'), TRACKED_ENV, ''],
    [bash('git log --color-words'), TRACKED_ENV, ''],
    [bash('git log -L1,5:app.py'), TRACKED_ENV, ''],
    [bash('git log --binary'), TRACKED_ENV, ''],
    [bash('git format-patch -1 --stdout'), TRACKED_ENV, ''],
    [bash('git format-patch -1'), TRACKED_ENV, ''],
    [bash('git range-diff main...topic'), TRACKED_ENV, ''],
    [bash('git diff-index -p HEAD'), TRACKED_ENV, ''],
    [bash('git diff-files -p'), TRACKED_ENV, ''],
    [bash('git stash list -p'), TRACKED_ENV, ''],
    [bash('git diff --no-index . /tmp/other'), TRACKED_ENV, '.'],
    // An exclude counts only when it matches the file's whole path, as Git matches it; a scope with a wildcard reaches by it.
    [bash("git diff -- . ':(exclude)docs/.env*'"), TRACKED_ENV, ''],
    [bash("git diff -- . ':(exclude).env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }, ''],
    [bash("git diff -- . ':(exclude).env*'"), { envFilesUnknown: true }, ''],
    [bash("git diff -- . ':(exclude,glob).env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }, ''],
    [bash("git diff -- ':(glob)**/.env*'"), TRACKED_ENV, '.env*'],
    [bash("git log -p -- ':!app/.env.local'"), TRACKED_ENV, ''],
    // Pathspecs are read from the folder the command runs in: an exclude there covers that folder, and no exclude counts
    // under git -C, --git-dir or --work-tree. A literal list of samples is no exclude of every environment file.
    [bash("cd app && git diff -- . ':(exclude)docs/.env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }, '.'],
    [bash("cd app && git diff -- ':(exclude,glob)**/.env*'"), { envFiles: ['.env', 'app/.env'], envFilesReachable: ['.env'] }, ''],
    [bash("git -C app diff -- ':(exclude,glob)**/.env*'"), TRACKED_ENV, ''],
    [bash("git --work-tree=app diff -- . ':(exclude,glob)**/.env*'"), TRACKED_ENV, ''],
    [bash("git diff -- . ':(exclude).env' ':(exclude)a/.env' ':(exclude).env.local' ':(exclude)a/b/.env.production'"), { envFilesUnknown: true }, ''],
    [bash('git diff ~/.ssh'), { envFiles: [] }, ''],
  ]
  for (const phase of LATER_PHASES) {
    for (const [call, overrides, mention] of folderRefused) {
      expectFolderSearch(call, phase, mention, overrides)
    }
  }
})

test('AC-1: Git prints that carry no patch, name a path that holds no environment file, or exclude them pass while the project tracks one', () => {
  const passing: [Call, Partial<Ctx>][] = [
    [bash('git diff --stat'), TRACKED_ENV],
    [bash('git diff --name-only HEAD~1'), TRACKED_ENV],
    [bash('git diff --name-status main...HEAD'), TRACKED_ENV],
    [bash('git diff --numstat'), TRACKED_ENV],
    [bash('git diff --quiet'), TRACKED_ENV],
    [bash('git diff --no-patch'), TRACKED_ENV],
    [bash('git diff --shortstat'), TRACKED_ENV],
    [bash('git log'), TRACKED_ENV],
    [bash('git log --oneline -5'), TRACKED_ENV],
    [bash('git log --stat'), TRACKED_ENV],
    [bash('git log --name-only'), TRACKED_ENV],
    [bash('git reflog'), TRACKED_ENV],
    [bash('git show --stat HEAD'), TRACKED_ENV],
    [bash('git show --name-only HEAD'), TRACKED_ENV],
    [bash('git show -s HEAD'), TRACKED_ENV],
    [bash('git show origin/feat/goal-and-do:CLAUDE.md'), TRACKED_ENV],
    [bash('git show HEAD:src/main.ts'), TRACKED_ENV],
    [bash('git stash show'), TRACKED_ENV],
    [bash('git status'), TRACKED_ENV],
    [bash("git diff -- . ':(exclude).env*'"), TRACKED_ENV],
    [bash("git diff origin/main...HEAD -- . ':!.env*'"), TRACKED_ENV],
    [bash("git log -p -- . ':(exclude,glob)**/.env*'"), TRACKED_ENV],
    [bash('git log -p -- src'), TRACKED_ENV],
    [bash('git diff -- src/main.ts'), TRACKED_ENV],
    [bash('git diff'), { envFiles: ['.env'], envFilesReachable: [] }],
    [bash('git log -p'), { envFiles: [] }],
    [bash('git diff'), {}],
    [bash("git diff -- . ':(exclude,glob)**/.env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }],
    [bash("git diff -- . ':(exclude,glob)**/.env*'"), { envFilesUnknown: true }],
    [bash("git diff -- . ':(exclude)app/.env.local'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }],
    [bash('git show HEAD:src/main.ts HEAD:README.md'), TRACKED_ENV],
    [bash("cd app && git diff -- . ':(exclude,glob)**/.env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }],
    [bash("cd app && git diff -- ':(exclude).env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }],
    [bash("cd app && git diff -- ':(top,exclude,glob)**/.env*'"), { envFiles: ['app/.env.local'], envFilesReachable: ['app/.env.local'] }],
    [bash('git format-patch --stat -1'), TRACKED_ENV],
    [bash('git diff --no-index /tmp/a /tmp/b'), TRACKED_ENV],
    [bash('git diff -- .env.example'), TRACKED_ENV],
    [bash('git log -p -- .env.example'), TRACKED_ENV],
  ]
  for (const phase of LATER_PHASES) {
    for (const [call, overrides] of passing) {
      expectPass(call, phase, overrides)
    }
  }
})

test('AC-2: documented example files (.env.example, .env.sample, .env.template, .env.dist) pass through every route of AC-1', () => {
  expect(isEnvFile('.env.example')).toBe('example')
  expect(isEnvFile('.env.sample')).toBe('example')
  expect(isEnvFile('.env.template')).toBe('example')
  expect(isEnvFile('.env.dist')).toBe('example')
  expect(isEnvFile('.env.EXAMPLE')).toBe('example')
  expect(isEnvFile('app/.env.example')).toBe('example')
  expect(isEnvFile('.envrc')).toBe('none')
  expect(isEnvFile('env.txt')).toBe('none')
  expect(isEnvFile('app.env')).toBe('none')
  expect(isEnvFile('README.md')).toBe('none')

  const passing: [Call, Partial<Ctx>][] = [
    [read('/repo/.env.example'), {}],
    [read('/repo/.env.sample'), {}],
    [read('/repo/.env.template'), {}],
    [read('/repo/.env.dist'), {}],
    [read('/repo/app/.env.example'), {}],
    [grepTool({ pattern: 'HOST', path: '/repo/.env.example' }), {}],
    [grepTool({ pattern: 'HOST', path: '/repo', glob: '.env.example' }), { envFiles: ['.env'] }],
    [grepTool({ pattern: 'HOST', path: '/repo' }), { envFiles: [] }],
    [bash('cat .env.example'), {}],
    [bash('cat .env.sample'), {}],
    [bash('cat .env.template'), {}],
    [bash('cat .env.dist'), {}],
    [bash('cat app/.env.example'), {}],
    [bash('cat .env.EXAMPLE'), {}],
    [bash('grep HOST .env.template'), {}],
    [bash('source .env.example'), {}],
    [bash('cd app && cat .env.example'), {}],
    [bash('git show HEAD:.env.example'), {}],
    [bash('git show HEAD:.env.dist'), {}],
    [bash('git log -p -- .env.example'), {}],
    [bash('git grep HOST -- .env.example'), {}],
    [bash('grep -r HOST .'), { envFiles: [] }],
  ]
  for (const phase of LATER_PHASES) {
    for (const [call, overrides] of passing) {
      expectPass(call, phase, overrides)
    }
  }

  // Lifted routes: a folder search whose reach list holds no environment file, and searches that exclude or cannot match them.
  const lifted: [Call, Partial<Ctx>][] = [
    [bash('rg SECRET'), { envFiles: ['.env'], envFilesReachable: [] }],
    [bash('git grep SECRET'), { envFiles: ['.env'], envFilesReachable: [] }],
    [grepTool({ pattern: 'SECRET', path: '/repo' }), { envFiles: ['.env'], envFilesReachable: [] }],
    [bash('grep -r SECRET .'), {}],
    [bash('grep -r SECRET src'), { envFiles: ['.env'] }],
    [bash('rg SECRET src'), { envFiles: ['.env'], envFilesReachable: ['.env'] }],
    [bash("grep -r --exclude='.env*' SECRET ."), { envFiles: ['.env'] }],
    [bash("grep -r --exclude='.env*' SECRET ."), { envFilesUnknown: true }],
    [bash("rg -g '!.env*' SECRET"), { envFiles: ['.env'], envFilesReachable: ['.env'] }],
    [bash("rg -g '!.env*' SECRET"), { envFilesUnknown: true }],
    [bash("git grep SECRET -- . ':(exclude,glob)**/.env*'"), { envFiles: ['.env'], envFilesReachable: ['.env'] }],
    [bash("git grep SECRET -- . ':(exclude,glob)**/.env*'"), { envFilesUnknown: true }],
    [grepTool({ pattern: 'fun', path: '/repo', glob: '*.kt' }), { envFiles: ['.env'] }],
    [grepTool({ pattern: 'fun', path: '/repo', glob: '*.kt' }), { envFilesUnknown: true }],
  ]
  for (const phase of LATER_PHASES) {
    for (const [call, overrides] of lifted) {
      expectPass(call, phase, overrides)
    }
  }
})

test('AC-3: token prints and environment listings are refused, other uses of matching names pass', () => {
  const refused: string[] = [
    'gh auth token',
    "gh auth 'token'",
    'gh auth token --hostname example.test',
    'curl --show-token https://example.test/api',
    'tool --show-token',
    'git credential fill',
    'git credential approve',
    'printenv',
    'env',
    'set',
    'export -p',
    'declare -p',
    'echo $GH_TOKEN',
    'echo "$GH_TOKEN"',
    'echo ${GH_TOKEN}',
    'echo "${JIRA_PAT}"',
    'echo $JIRA_PAT',
    'printenv JIRA_PAT',
    'printenv GH_TOKEN',
    'printf %s $GH_TOKEN',
    'print $GH_TOKEN',
    'cat <<< $GH_TOKEN',
    'echo $GH_TOKEN | tee out.txt',
    'echo $AWS_SECRET_KEY',
    'echo $KEYBOARD_LAYOUT',
    'printenv KEYBOARD_LAYOUT',
  ]
  const passing: string[] = [
    'printenv HOME',
    'env FOO=1 cmd',
    'echo hello',
    './gradlew build -Ptoken=$REPO_TOKEN',
    'mvn deploy -Dpassword=$NEXUS_KEY',
    'API_TOKEN=$OTHER_TOKEN ./run.sh',
  ]
  for (const phase of LATER_PHASES) {
    for (const command of refused) {
      expectDenied(bash(command), phase)
    }
    for (const command of passing) {
      expectPass(bash(command), phase)
    }
  }
})

test('AC-4: credential stores of the developer account are refused through Read, Grep and shell commands, other files under the same folders pass', () => {
  const namedStores: [string, Call][] = [
    ['/home/dev/.netrc', read('/home/dev/.netrc')],
    ['/home/dev/.m2/settings.xml', read('/home/dev/.m2/settings.xml')],
    ['/home/dev/.gradle/gradle.properties', read('/home/dev/.gradle/gradle.properties')],
    ['/home/dev/.npmrc', read('/home/dev/.npmrc')],
    ['/home/dev/.aws/credentials', read('/home/dev/.aws/credentials')],
    ['/home/dev/.ssh/id_ed25519', read('/home/dev/.ssh/id_ed25519')],
    ['/home/dev/.ssh/config', read('/home/dev/.ssh/config')],
    ['/home/dev/.docker/config.json', read('/home/dev/.docker/config.json')],
    ['/home/dev/.claude.json', read('/home/dev/.claude.json')],
    ['/home/dev/.netrc', grepTool({ pattern: 'password', path: '/home/dev/.netrc' })],
    ['/home/dev/.m2/settings.xml', grepTool({ pattern: 'password', path: '/home/dev/.m2/settings.xml' })],
    ['/home/dev/.ssh/id_rsa', grepTool({ pattern: 'PRIVATE', path: '/home/dev/.ssh/id_rsa' })],
    ['.netrc', bash('cat ~/.netrc')],
    ['.netrc', bash('cat /home/dev/.netrc')],
    ['.netrc', bash('cat $HOME/.netrc')],
    ['.netrc', bash('cat "$HOME/.netrc"')],
    ['.m2/settings.xml', bash('cat ~/.m2/settings.xml')],
    ['gradle.properties', bash('grep password ~/.gradle/gradle.properties')],
    ['.npmrc', bash('cat $HOME/.npmrc')],
    ['.aws/credentials', bash('cat /home/dev/.aws/credentials')],
    ['.ssh/id_rsa', bash('cat ~/.ssh/id_rsa')],
    ['id_rsa', bash('cd ~/.ssh && cat id_rsa')],
    ['config.json', bash('head ~/.docker/config.json')],
    ['.claude.json', bash('cat ~/.claude.json')],
  ]
  const passingReads: Call[] = [
    read('/home/dev/.m2/repository/org/example/lib/1.0/lib-1.0.pom'),
    read('/home/dev/.claude/settings.json'),
    grepTool({ pattern: 'artifact', path: '/home/dev/.m2/repository' }),
    grepTool({ pattern: 'artifact', path: '/home/dev/.gradle/caches' }),
    bash('cat ~/.gradle/init.gradle'),
    bash('ls ~/.m2'),
    bash('ls ~/.ssh/'),
  ]
  for (const phase of LATER_PHASES) {
    for (const [mention, call] of namedStores) {
      expectBlocked(call, phase, mention)
    }
    for (const call of passingReads) {
      expectPass(call, phase)
    }
  }

  // A folder search rooted at a folder that holds a store file is refused with the key folderSearch, unless the glob cannot match the store file.
  const folderRefused: [Call, string][] = [
    [grepTool({ pattern: 'password', path: '/home/dev/.m2' }), '/home/dev/.m2'],
    [grepTool({ pattern: 'password', path: '/home/dev/.gradle' }), '/home/dev/.gradle'],
    [grepTool({ pattern: 'password', path: '/home/dev' }), '/home/dev'],
    [grepTool({ pattern: 'password', path: '/home/dev/.ssh' }), '/home/dev/.ssh'],
    [grepTool({ pattern: 'password', path: '/home/dev/.ssh', glob: '*.pom' }), '/home/dev/.ssh'],
    [grepTool({ pattern: 'password', path: '/home/dev/.aws' }), '/home/dev/.aws'],
    [grepTool({ pattern: 'password', path: '/home/dev/.docker' }), '/home/dev/.docker'],
    [bash('grep -r password ~/.m2'), ''],
  ]
  for (const phase of LATER_PHASES) {
    for (const [call, mention] of folderRefused) {
      expectFolderSearch(call, phase, mention)
    }
    expectPass(grepTool({ pattern: 'artifact', path: '/home/dev/.m2', glob: '*.pom' }), phase)
  }
})

test('AC-5: writes to steering files and shell startup files are refused when no planned-paths entry names the file', () => {
  const editWrites: [string, Call][] = [
    ['/repo/CLAUDE.md', write('/repo/CLAUDE.md')],
    ['/repo/CLAUDE.md', { tool: 'Edit', input: { file_path: '/repo/CLAUDE.md' } }],
    ['/repo/.mcp.json', { tool: 'Edit', input: { file_path: '/repo/.mcp.json' } }],
    ['/repo/.mcp.json', write('/repo/.mcp.json')],
    ['/repo/.claude/skills/verify/SKILL.md', { tool: 'MultiEdit', input: { file_path: '/repo/.claude/skills/verify/SKILL.md' } }],
    ['/repo/.claude/skills/verify/SKILL.md', write('/repo/.claude/skills/verify/SKILL.md')],
    ['/repo/.claude/notebooks/n.ipynb', { tool: 'NotebookEdit', input: { notebook_path: '/repo/.claude/notebooks/n.ipynb' } }],
    ['/home/dev/.zshrc', write('/home/dev/.zshrc')],
    ['/home/dev/.zprofile', write('/home/dev/.zprofile')],
    ['/home/dev/.zshenv', write('/home/dev/.zshenv')],
    ['/home/dev/.zlogin', write('/home/dev/.zlogin')],
    ['/home/dev/.bashrc', write('/home/dev/.bashrc')],
    ['/home/dev/.bash_profile', write('/home/dev/.bash_profile')],
    ['/home/dev/.bash_login', write('/home/dev/.bash_login')],
    ['/home/dev/.profile', write('/home/dev/.profile')],
    ['/repo/.zshrc', write('/repo/.zshrc')],
    ['/home/dev/.claude/settings.json', write('/home/dev/.claude/settings.json')],
    ['/home/dev/.claude/CLAUDE.md', { tool: 'Edit', input: { file_path: '/home/dev/.claude/CLAUDE.md' } }],
  ]
  const shellWrites: [string, string][] = [
    ['CLAUDE.md', 'echo x > CLAUDE.md'],
    ['CLAUDE.md', 'echo x >> ./CLAUDE.md'],
    ['CLAUDE.md', 'echo x > "CLAUDE.md"'],
    ['CLAUDE.md', "sed -i 's/a/b/' CLAUDE.md"],
    ['CLAUDE.md', 'mv /tmp/x.md CLAUDE.md'],
    ['.mcp.json', 'echo {} | tee .mcp.json'],
    ['.mcp.json', 'cp /tmp/x.json .mcp.json'],
    ['SKILL.md', 'cp /tmp/x.md .claude/skills/verify/SKILL.md'],
    ['SKILL.md', 'cd .claude/skills/verify && echo x > SKILL.md'],
    ['.zshrc', 'echo x >> ~/.zshrc'],
    ['.zshrc', 'echo x >> $HOME/.zshrc'],
    ['.zshrc', 'echo x >> /home/dev/.zshrc'],
    ['.zshrc', 'echo x | tee -a ~/.zshrc'],
    ['.bashrc', 'echo x >> ~/.bashrc'],
    ['settings.json', 'echo {} > ~/.claude/settings.json'],
    ['CLAUDE.md', 'echo x > ~/.claude/CLAUDE.md'],
  ]
  for (const phase of ALL_PHASES) {
    // Before Plan approval no plan.md exists; afterwards an approved plan names other files only.
    const overrides: Partial<Ctx> = BEFORE_APPROVAL.includes(phase) ? {} : { plannedPaths: ['src/Main.kt'] }
    for (const [mention, call] of editWrites) {
      expectBlocked(call, phase, mention, overrides)
    }
    for (const [mention, command] of shellWrites) {
      expectBlocked(bash(command), phase, mention, overrides)
    }
  }
  for (const phase of ['Build', 'Test', 'PR'] as PhaseName[]) {
    expectBlocked(write('/repo/CLAUDE.md'), phase, '/repo/CLAUDE.md', { plannedPaths: [] })
  }

  // Files that are not steering files stay writable.
  expectPass(write('/repo/src/Main.kt'), 'Build', { plannedPaths: ['CLAUDE.md'] })
})

test('AC-6: a planned-paths entry that names a steering file allows that file only', () => {
  const claudeMd = { plannedPaths: ['CLAUDE.md'] }
  expectPass(write('/repo/CLAUDE.md'), 'Build', claudeMd)
  expectPass({ tool: 'Edit', input: { file_path: '/repo/CLAUDE.md' } }, 'Build', claudeMd)
  expectPass(bash('echo x >> CLAUDE.md'), 'Build', claudeMd)
  expectBlocked(write('/repo/.mcp.json'), 'Build', '/repo/.mcp.json', claudeMd)
  expectBlocked(write('/repo/.claude/skills/verify/SKILL.md'), 'Build', '/repo/.claude/skills/verify/SKILL.md', claudeMd)
  expectBlocked(write('/home/dev/.zshrc'), 'Build', '/home/dev/.zshrc', claudeMd)
  expectBlocked(bash('echo x >> ~/.zshrc'), 'Build', '.zshrc', claudeMd)
  expectBlocked(bash('cp /tmp/x.json .mcp.json'), 'Build', '.mcp.json', claudeMd)

  const mcpJson = { plannedPaths: ['.mcp.json'] }
  expectPass(write('/repo/.mcp.json'), 'Build', mcpJson)
  expectBlocked(write('/repo/CLAUDE.md'), 'Build', '/repo/CLAUDE.md', mcpJson)

  const skill = { plannedPaths: ['.claude/skills/verify/SKILL.md'] }
  expectPass(write('/repo/.claude/skills/verify/SKILL.md'), 'Build', skill)
  expectBlocked(write('/repo/CLAUDE.md'), 'Build', '/repo/CLAUDE.md', skill)
  expectBlocked(write('/repo/.mcp.json'), 'Build', '/repo/.mcp.json', skill)

  // A folder entry is not a file name and allows nothing under it.
  for (const entry of ['.claude/', '.claude', '.claude/skills/verify/']) {
    expectBlocked(write('/repo/.claude/skills/verify/SKILL.md'), 'Build', '/repo/.claude/skills/verify/SKILL.md', { plannedPaths: [entry] })
  }
  expectBlocked(write('/repo/CLAUDE.md'), 'Build', '/repo/CLAUDE.md', { plannedPaths: ['src/'] })

  // Without an approved plan the same write is refused.
  for (const phase of BEFORE_APPROVAL) {
    expectBlocked(write('/repo/CLAUDE.md'), phase, '/repo/CLAUDE.md')
  }
})

test('AC-7: in the PR phase the reviewer cannot read the working-tree CLAUDE.md, only the copy on the base branch', () => {
  const reviewer = { isReviewer: true, base: 'feat/goal-and-do' }
  expectDenied(read('/repo/CLAUDE.md'), 'PR', reviewer)
  expectDenied(bash('cat CLAUDE.md'), 'PR', reviewer)
  expectDenied(bash('cat ./CLAUDE.md'), 'PR', reviewer)
  expectDenied(grepTool({ pattern: 'rule', path: '/repo/CLAUDE.md' }), 'PR', reviewer)
  expectPass(bash('git show origin/feat/goal-and-do:CLAUDE.md'), 'PR', reviewer)
  expectPass(read('/repo/README.md'), 'PR', reviewer)
  // The copy the open-pr skill writes for it, in the repository's Git folder or a worktree's.
  expectPass(read('/repo/.git/goal-and-do/base-claude-CH-1.md'), 'PR', reviewer)
  expectPass(read('/repo/.git/worktrees/wt/goal-and-do/base-claude-CH-1.md'), 'PR', reviewer)
  // The open-pr skill (the PR phase's main loop, not the reviewer) writes that copy from the base branch.
  expectPass(bash('git show origin/feat/goal-and-do:CLAUDE.md > .git/goal-and-do/base-claude-CH-1.md'), 'PR', { base: 'feat/goal-and-do' })

  expectPass(read('/repo/CLAUDE.md'), 'PR')
  expectPass(read('/repo/CLAUDE.md'), 'PR', { base: 'feat/goal-and-do' })
  expectPass(read('/repo/CLAUDE.md'), 'PR', { isReviewer: false, base: 'feat/goal-and-do' })
  expectPass(bash('cat CLAUDE.md'), 'PR', { isReviewer: false, base: 'feat/goal-and-do' })
})

test('AC-8: the test command runs without JIRA_PAT and GH_TOKEN, unless the plan keeps one of them', () => {
  const testCommand = './gradlew test'
  expect(testRunCommand('./gradlew test', testCommand)).toBe('(unset JIRA_PAT GH_TOKEN; ./gradlew test)')
  expect(testRunCommand('./gradlew test --tests ExampleTest', testCommand)).toBe('(unset JIRA_PAT GH_TOKEN; ./gradlew test --tests ExampleTest)')
  expect(testRunCommand('./gradlew test', testCommand, [])).toBe('(unset JIRA_PAT GH_TOKEN; ./gradlew test)')
  expect(testRunCommand('./gradlew test', testCommand, ['GH_TOKEN'])).toBe('(unset JIRA_PAT; ./gradlew test)')
  expect(testRunCommand('./gradlew test', testCommand, ['JIRA_PAT'])).toBe('(unset GH_TOKEN; ./gradlew test)')
  expect(testRunCommand('./gradlew test', testCommand, ['SOME_OTHER_NAME'])).toBe('(unset JIRA_PAT GH_TOKEN; ./gradlew test)')
  expect(testRunCommand('./gradlew test', testCommand, ['SOME_OTHER_NAME', 'GH_TOKEN'])).toBe('(unset JIRA_PAT; ./gradlew test)')
  expect(testRunCommand('./gradlew test', testCommand, ['JIRA_PAT', 'GH_TOKEN'])).toBeUndefined()
  expect(testRunCommand('git status', testCommand)).toBeUndefined()
  expect(testRunCommand('echo hello', testCommand, ['GH_TOKEN'])).toBeUndefined()

  const plan = ['---', 'phase: plan', 'planned-paths: src/Main.kt', 'test-command: ./gradlew test', 'test-env-keep: GH_TOKEN', '---', '', '# Plan'].join('\n')
  const keep = testEnvKeepFrom(plan)
  expect(keep).toEqual(['GH_TOKEN'])
  expect(testRunCommand('./gradlew test', testCommand, keep)).toBe('(unset JIRA_PAT; ./gradlew test)')
  expect(testEnvKeepFrom(['---', 'test-env-keep: JIRA_PAT GH_TOKEN', '---'].join('\n'))).toEqual(['JIRA_PAT', 'GH_TOKEN'])
  expect(testEnvKeepFrom(['---', 'phase: plan', '---', '# Plan'].join('\n'))).toEqual([])
})

test('AC-9: web and browser tools are refused from Spec to PR with a deny that names the address, whatever the plan says', () => {
  const planned = { plannedTools: ['WebFetch', 'WebSearch', 'mcp__playwright__browser_navigate'] }
  const longQuery = 'q'.repeat(120)

  expect(isOutboundTool('WebFetch')).toBe(true)
  expect(isOutboundTool('WebSearch')).toBe(true)
  expect(isOutboundTool('mcp__playwright__browser_navigate')).toBe(true)
  expect(isOutboundTool('mcp__jira__getIssue')).toBe(false)
  expect(isOutboundTool('mcp__jenkins__getBuildLog')).toBe(false)
  expect(isOutboundTool('mcp__confluence__readPage')).toBe(false)
  expect(isOutboundTool(CONTEXT7_QUERY)).toBe(false)
  expect(isDocLookupTool(CONTEXT7_QUERY)).toBe(true)
  expect(isDocLookupTool(CONTEXT7_RESOLVE)).toBe(true)
  expect(isDocLookupTool('WebFetch')).toBe(false)
  expect(isDocLookupTool('mcp__jira__getIssue')).toBe(false)

  for (const phase of LATER_PHASES) {
    for (const overrides of [{}, planned]) {
      expectBlocked({ tool: 'WebFetch', input: { url: 'https://example.test/docs/page' } }, phase, 'https://example.test/docs/page', overrides)
      expectBlocked(mcp('mcp__playwright__browser_navigate', { url: 'https://example.test/app' }), phase, 'https://example.test/app', overrides)
      expectBlocked(mcp('mcp__playwright__browser_click', { element: 'button' }), phase, 'mcp__playwright__browser_click', overrides)
    }

    // The message shows scheme, host and path only.
    const withQuery = guard({ tool: 'WebFetch', input: { url: 'https://example.test/docs?token=not-a-real-token#frag' } }, ctxFor(phase))
    expect(withQuery.verdict, `${phase} url with a query string`).toBe('deny')
    if (withQuery.verdict === 'deny') {
      expect(withQuery.reason).toContain('https://example.test/docs')
      expect(withQuery.reason).not.toContain('not-a-real-token')
      expect(withQuery.reason).not.toContain('?token')
      expect(withQuery.reason).not.toContain('#frag')
      expect(keyIsBlocking(withQuery.reason)).toBe(true)
    }
    const withCredentials = guard({ tool: 'WebFetch', input: { url: 'https://dev:not-a-real-token@example.test/path?x=1' } }, ctxFor(phase))
    expect(withCredentials.verdict, `${phase} url with credentials`).toBe('deny')
    if (withCredentials.verdict === 'deny') {
      expect(withCredentials.reason).toContain('https://example.test/path')
      expect(withCredentials.reason).not.toContain('not-a-real-token')
      expect(withCredentials.reason).not.toContain('dev:')
      expect(withCredentials.reason).not.toContain('x=1')
      expect(keyIsBlocking(withCredentials.reason)).toBe(true)
    }

    // A search query is cut to 80 characters.
    const search = guard({ tool: 'WebSearch', input: { query: longQuery } }, ctxFor(phase, planned))
    expect(search.verdict, `${phase} WebSearch`).toBe('deny')
    if (search.verdict === 'deny') {
      expect(search.reason).toContain('q'.repeat(80))
      expect(search.reason).not.toContain('q'.repeat(81))
      expect(keyIsBlocking(search.reason)).toBe(true)
    }
    expectBlocked({ tool: 'WebSearch', input: { query: 'example query' } }, phase, 'example query')

    // Connected systems stay reachable.
    expectPass(mcp('mcp__jira__getIssue', { issueKey: 'ABC-1' }), phase)
    expectPass(mcp('mcp__jenkins__getBuildLog', { job: 'example' }), phase)
    expectPass(mcp('mcp__confluence__readPage', { pageId: '1' }), phase)
  }

  // TEMPORARY EXCEPTION 2: documentation lookups pass in Spec, Plan and Build, and are refused in Test and PR.
  for (const phase of ['Spec', 'Plan', 'Build'] as PhaseName[]) {
    expectPass(mcp(CONTEXT7_QUERY, { query: 'how to use the library' }), phase)
    expectPass(mcp(CONTEXT7_RESOLVE, { libraryName: 'example-lib' }), phase)
  }
  for (const phase of ['Test', 'PR'] as PhaseName[]) {
    expectBlocked(mcp(CONTEXT7_QUERY, { query: 'how to use the library' }), phase, CONTEXT7_QUERY)
    expectBlocked(mcp(CONTEXT7_RESOLVE, { libraryName: 'example-lib' }), phase, CONTEXT7_RESOLVE)
  }
})

test('AC-10: an MCP write tool passes only for a step of plan.md that names the tool', () => {
  const writes = ['mcp__jira__addComment', 'mcp__jira__transitionIssue', 'mcp__confluence__updatePage']
  const reads = ['mcp__jira__getIssue', 'mcp__jira__searchIssues', 'mcp__jenkins__getBuildLog', 'mcp__confluence__readPage']
  for (const tool of writes) {
    expect(isMcpWrite(tool), tool).toBe(true)
  }
  for (const tool of reads) {
    expect(isMcpWrite(tool), tool).toBe(false)
  }

  for (const phase of LATER_PHASES) {
    for (const tool of writes) {
      expectDenied(mcp(tool), phase)
      expectDenied(mcp(tool), phase, { plannedTools: [] })
      expectDenied(mcp(tool), phase, { plannedTools: ['mcp__jira__addComments'] })
      expect(keyIsBlocking(denyReason(mcp(tool), phase)), `${phase} ${tool}`).toBe(true)
    }
    expectPass(mcp('mcp__jira__addComment', { issueKey: 'ABC-1' }), phase, { plannedTools: ['mcp__jira__addComment'] })
    expectDenied(mcp('mcp__jira__transitionIssue'), phase, { plannedTools: ['mcp__jira__addComment'] })
    expectDenied(mcp('mcp__confluence__updatePage'), phase, { plannedTools: ['mcp__jira__addComment'] })
    expectPass(mcp('mcp__confluence__updatePage'), phase, { plannedTools: ['mcp__jira__addComment', 'mcp__confluence__updatePage'] })
    expectDenied(mcp('mcp__jira__addComment'), phase, { plannedTools: ['mcp__nothing__doesNotExist'] })
    for (const tool of reads) {
      expectPass(mcp(tool), phase)
    }
  }

  const plan = ['---', 'phase: plan', 'planned-tools: mcp__jira__addComment mcp__confluence__updatePage', '---', '# Plan'].join('\n')
  expect(plannedToolsFrom(plan)).toEqual(['mcp__jira__addComment', 'mcp__confluence__updatePage'])
  expect(plannedToolsFrom(['---', 'phase: plan', '---', '# Plan'].join('\n'))).toEqual([])
  expectPass(mcp('mcp__confluence__updatePage'), 'Build', { plannedTools: plannedToolsFrom(plan) })
  expectDenied(mcp('mcp__jira__transitionIssue'), 'Build', { plannedTools: plannedToolsFrom(plan) })
})

test('AC-11: in the PR phase only the gh forms the phase uses pass', () => {
  const passing = [
    'gh pr create --title t --body b',
    'gh pr view 1',
    'gh pr edit 1 --body b',
    'gh pr checks 1',
    'gh run view 1',
    'gh repo view',
    'gh api repos/example/repo/pulls',
    'gh api user',
  ]
  const refused = [
    'gh pr comment 1 --body hi',
    'gh issue comment 1 --body hi',
    'gh issue create --title t --body b',
    'gh pr merge 1',
    'gh run rerun 1',
    'gh repo clone example/repo',
    'gh release list',
  ]
  for (const command of passing) {
    expectPass(bash(command), 'PR')
  }
  for (const command of refused) {
    expectDenied(bash(command), 'PR')
  }
})

test('AC-12: the guard denies each route and form of AC-1, AC-3 to AC-5 and AC-9 to AC-11 and passes the allowed cases', () => {
  const refused: Row[] = [
    // AC-1
    { phases: LATER_PHASES, call: read('/repo/.env') },
    { phases: LATER_PHASES, call: grepTool({ pattern: 'SECRET', path: '/repo/.env.local' }) },
    { phases: LATER_PHASES, call: bash('cat .env') },
    { phases: LATER_PHASES, call: bash('git show HEAD:.env') },
    { phases: LATER_PHASES, call: bash('grep -r SECRET .'), overrides: { envFiles: ['.env'] } },
    // AC-3
    { phases: LATER_PHASES, call: bash('gh auth token') },
    { phases: LATER_PHASES, call: bash('printenv') },
    { phases: LATER_PHASES, call: bash('echo $GH_TOKEN') },
    // AC-4
    { phases: LATER_PHASES, call: read('/home/dev/.netrc') },
    { phases: LATER_PHASES, call: bash('cat ~/.ssh/id_rsa') },
    // AC-5
    { phases: BEFORE_APPROVAL, call: write('/repo/CLAUDE.md') },
    { phases: ['Build'], call: write('/repo/CLAUDE.md'), overrides: { plannedPaths: ['src/Main.kt'] } },
    { phases: ALL_PHASES, call: bash('echo x >> ~/.zshrc') },
    // AC-9
    { phases: LATER_PHASES, call: { tool: 'WebFetch', input: { url: 'https://example.test/docs' } } },
    { phases: LATER_PHASES, call: { tool: 'WebSearch', input: { query: 'example query' } } },
    { phases: LATER_PHASES, call: mcp('mcp__playwright__browser_navigate', { url: 'https://example.test/app' }) },
    { phases: ['Test', 'PR'], call: mcp(CONTEXT7_QUERY, { query: 'how to use the library' }) },
    // AC-10
    { phases: LATER_PHASES, call: mcp('mcp__jira__addComment', { issueKey: 'ABC-1' }) },
    // AC-11
    { phases: ['PR'], call: bash('gh pr comment 1 --body hi') },
    { phases: ['PR'], call: bash('gh issue comment 1 --body hi') },
    { phases: ['PR'], call: bash('gh issue create --title t --body b') },
  ]
  for (const row of refused) {
    for (const phase of row.phases) {
      expectDenied(row.call, phase, row.overrides)
    }
  }

  const passing: (Row & { verdict?: 'pass' | 'push' })[] = [
    { phases: ['Spec'], call: mcp('mcp__jira__getIssue', { issueKey: 'ABC-1' }) },
    { phases: ['Test'], call: mcp('mcp__jenkins__getBuildLog', { job: 'example' }) },
    { phases: ['PR'], call: bash('gh pr view 1') },
    { phases: ['PR'], call: bash('gh pr create --title t --body b') },
    { phases: ['PR'], call: bash('gh run view 1') },
    { phases: ['PR'], call: bash('gh repo view') },
    { phases: ['PR'], call: bash('gh api user') },
    { phases: ['PR'], call: bash('git push origin sdd/ABC-1'), verdict: 'push' },
    { phases: ['Build'], call: bash('cat .env.example') },
    { phases: ['Build'], call: write('/repo/CLAUDE.md'), overrides: { plannedPaths: ['CLAUDE.md'] } },
    { phases: ['Build'], call: bash('rg PATTERN'), overrides: { envFiles: ['.env'], envFilesReachable: [] } },
    { phases: ['Build'], call: bash('./gradlew build -Ptoken=$REPO_TOKEN') },
    { phases: ['Build'], call: read('/home/dev/.m2/repository/org/example/lib/1.0/lib-1.0.pom') },
    { phases: ['Build'], call: mcp(CONTEXT7_QUERY, { query: 'how to use the library' }) },
  ]
  for (const row of passing) {
    for (const phase of row.phases) {
      const label = `${describeCall(phase, row.call)} with ${JSON.stringify(row.overrides ?? {})}`
      expect(guard(row.call, ctxFor(phase, row.overrides)).verdict, label).toBe(row.verdict ?? 'pass')
    }
  }
})

function denyReason(call: Call, phase: PhaseName, overrides: Partial<Ctx> = {}): string {
  const result = guard(call, ctxFor(phase, overrides))
  return result.verdict === 'deny' ? result.reason : ''
}
