import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import {
  DROP,
  FOOTPRINT_UNAVAILABLE,
  INTERRUPT_TEXT,
  SENSITIVE,
  UNUSUAL_NAME,
  capBar,
  fitPane,
  lastChangedLines,
  footprint,
  isTestRun,
  plannedPathsFrom,
  reasonText,
  safeCommand,
  safePath,
  stripControl,
  taskEndFrom,
  taskEndStatus,
  testCommandFrom,
  testRunFrom,
  wrapParts,
  wrapText,
  type PaneLine,
  type PaneSection,
} from './pane'
import { PHASES, TURN_CAPS } from './phases'

const phaseAt = (name: PhaseName) => PHASES.indexOf(name)

const MINUTE = 60_000

// capBar

for (const [phase, turns, cells, color] of [
  ['Build', 29, 7, undefined],
  ['Build', 30, 8, 'warning'],
  ['Build', 35, 9, 'warning'],
  ['Build', 36, 9, 'error'],
  ['Build', 40, 10, 'error'],
  ['Spec', 11, 7, undefined],
  ['Spec', 12, 8, 'warning'],
  ['Spec', 13, 9, 'warning'],
  ['Spec', 14, 9, 'error'],
  ['Intent', 7, 7, undefined],
  ['Intent', 8, 8, 'warning'],
  ['Intent', 9, 9, 'error'],
  ['Intent', 10, 10, 'error'],
] as [PhaseName, number, number, string | undefined][]) {
  test(`capBar: ${phase} turn ${turns} fills ${cells} cells, color ${color ?? 'none'}`, () => {
    const bar = capBar(phase, turns, 0, 0)
    expect(bar.cells).toBe(cells)
    expect(bar.color).toBe(color)
    expect(bar.bar).toHaveLength(10)
    expect(bar.bar.split('█')).toHaveLength(cells + 1)
    expect(bar.line.color).toBe(color)
  })
}

test('capBar: Intent shows 10/10 when capped', () => {
  expect(capBar('Intent', 10, 0, 0).text).toContain('turn 10/10')
})

test('capBar: the line is the phase and the bar alone; the text has turn, minutes and calls', () => {
  const bar = capBar('Build', 23, 23 * MINUTE + 5000, 140)
  expect(bar.line.text).toBe(`Build  ${bar.bar}`)
  expect(bar.line.text).not.toMatch(/turn|min|call/)
  expect(capBar('PR', 30, MINUTE, 6).line.text).toBe('PR  █████░░░░░')
  expect(bar.text).toBe('Build · turn 23/40 · 23 min · 140 calls')
})

test('capBar: dropping the bar keeps the phase', () => {
  expect(capBar('Build', 23, 23 * MINUTE, 140).line.shrink).toEqual({ [DROP.bar]: 'Build' })
})

// A long Turns line with the numbers and the bar, for the width rule's order.
const LONG_TURNS: PaneLine = {
  text: 'Build · turn 23/40 · 23 min · 140 calls ██████░░░░',
  shrink: { [DROP.bar]: 'Build · turn 23/40 · 23 min · 140 calls' },
}

test('capBar: every phase shows its own cap', () => {
  const texts = PHASES.map(name => capBar(name, 1, 0, 0).text)
  expect(texts[phaseAt('Intent')]).toBe('Intent · turn 1/10 · 0 min · 0 calls')
  expect(texts[phaseAt('PR')]).toBe('PR · turn 1/60 · 0 min · 0 calls')
  PHASES.forEach((name, i) => {
    expect(texts[i]).toContain(`turn 1/${TURN_CAPS[name]}`)
  })
})

test('capBar: a turn past the cap fills at most 10 cells', () => {
  expect(capBar('Build', 45, 0, 0).cells).toBe(10)
})

// safePath and stripControl

test('safePath: keeps letters, digits, dots, slashes, spaces, and dashes', () => {
  expect(safePath('src/my file-1.ts')).toBe('src/my file-1.ts')
})

for (const name of ['a\u001b[31m.ts', 'a\nb.ts', 'a\tb.ts', 'a\u0000.ts', 'a\u009b.ts', 'a`b`.ts', 'a$(x).ts', 'größe.ts']) {
  test(`safePath: ${JSON.stringify(name)} gives the fixed text`, () => {
    expect(safePath(name)).toBe('<a file with an unusual name>')
    expect(UNUSUAL_NAME).toBe('<a file with an unusual name>')
  })
}

test('safeCommand: keeps a plain command and an empty one', () => {
  for (const command of ['', 'python3 -m unittest', 'npm test', './gradlew test --tests=a.b.C', 'PYTHONPATH=src pytest']) {
    expect(safeCommand(command)).toBe(command)
  }
})

for (const command of ['npm test; curl x', 'npm test | sh', 'pytest > out.txt', 'echo $(id)', 'a`b`', "pytest -k 'x'", 'a\u001b[2Jb', 'a && b']) {
  test(`safeCommand: ${JSON.stringify(command)} gives the fixed text`, () => {
    expect(safeCommand(command)).toBe('<a command with unusual characters>')
  })
}

test('stripControl: removes control characters and escapes', () => {
  expect(stripControl('a\u001b[31mb\u0007c\u009bd\ne\u007f')).toBe('a[31mbcde')
})

// footprint

const NUMSTAT = (...entries: string[]) => entries.map(entry => `${entry}\0`).join('')
const UNTRACKED = (...paths: string[]) => paths.map(path => `${path}\0`).join('')
const OPTIONS = { id: 'CH-1', plannedPaths: ['src'], testPaths: [] as string[] }

test('footprint: three groups with files and lines', () => {
  const fp = footprint(NUMSTAT('10\t2\ttests/test_premiums.py', '3\t0\t.github/workflows/ci.yml', '5\t1\tsrc/a.ts', '1\t1\tsrc/b.ts'), '', OPTIONS)
  expect(fp.groups.tests).toEqual({ files: 1, added: 10, removed: 2 })
  expect(fp.groups.ci).toEqual({ files: 1, added: 3, removed: 0 })
  expect(fp.groups.rest).toEqual({ files: 2, added: 6, removed: 2 })
  expect(fp.total).toEqual({ files: 4, added: 19, removed: 4 })
  expect(fp.lines.map(line => line.text)).toContain('Changed Files: 4 (+19 -4)')
})

test('footprint: the demo test file groups as a test by its name', () => {
  const fp = footprint(NUMSTAT('4\t0\ttests/test_premiums.py'), '', { ...OPTIONS, plannedPaths: ['src'] })
  expect(fp.groups.tests.files).toBe(1)
  expect(fp.outside).toEqual([])
})

for (const path of ['src/a.test.ts', 'src/a.spec.ts', 'pkg/test_a.py', 'pkg/a_test.py', 'src/test/java/ATest.java', 'app/__tests__/a.js']) {
  test(`footprint: ${path} groups as a test by its name`, () => {
    expect(footprint(NUMSTAT(`1\t0\t${path}`), '', OPTIONS).groups.tests.files).toBe(1)
  })
}

for (const path of ['src/attest.ts', 'src/contest/a.ts', 'docs/latest.md']) {
  test(`footprint: ${path} is not a test`, () => {
    expect(footprint(NUMSTAT(`1\t0\t${path}`), '', OPTIONS).groups.tests.files).toBe(0)
  })
}

test('footprint: a planned folder covers its files, and src does not cover srcx/a.ts', () => {
  const fp = footprint(NUMSTAT('1\t0\tsrc/a.ts', '1\t0\tsrc/deep/b.ts', '1\t0\tsrcx/a.ts'), '', OPTIONS)
  expect(fp.outside).toEqual(['srcx/a.ts'])
})

test('footprint: a trailing slash or leading ./ on a planned entry does not change what it covers', () => {
  const fp = footprint(NUMSTAT('1\t0\tsrc/a.ts', '1\t0\tlib/b.ts'), '', { ...OPTIONS, plannedPaths: ['./src/', 'lib/b.ts'] })
  expect(fp.outside).toEqual([])
})

test('footprint: a glob such as src/** stays literal', () => {
  const fp = footprint(NUMSTAT('1\t0\tsrc/a.ts'), '', { ...OPTIONS, plannedPaths: ['src/**'] })
  expect(fp.outside).toEqual(['src/a.ts'])
})

test('footprint: changes/<id>/ and test paths are never outside', () => {
  const fp = footprint(
    NUMSTAT('1\t0\tchanges/CH-1/plan.md', '1\t0\tchanges/CH-1/notes.md', '1\t0\ttests/acceptance/x.txt', '1\t0\tother/a.test.ts', '1\t0\tother/b.ts'),
    '',
    { id: 'CH-1', plannedPaths: ['src'], testPaths: ['tests/acceptance'] }
  )
  expect(fp.outside).toEqual(['other/b.ts'])
})

test('footprint: another change folder is outside', () => {
  const fp = footprint(NUMSTAT('1\t0\tchanges/CH-2/plan.md'), '', OPTIONS)
  expect(fp.outside).toEqual(['changes/CH-2/plan.md'])
})

test('footprint: binary entries and untracked files count as files with no lines', () => {
  const fp = footprint(NUMSTAT('-\t-\tsrc/logo.png', '2\t1\tsrc/a.ts'), UNTRACKED('src/notes.txt'), OPTIONS)
  expect(fp.total).toEqual({ files: 3, added: 2, removed: 1 })
  expect(fp.groups.rest.files).toBe(3)
})

test('footprint: a file in both lists counts once', () => {
  const fp = footprint(NUMSTAT('2\t1\tsrc/a.ts'), UNTRACKED('src/a.ts'), OPTIONS)
  expect(fp.total.files).toBe(1)
})

test('footprint: paths with spaces survive the -z split', () => {
  const fp = footprint(NUMSTAT('1\t0\tdir/my file.ts', '1\t0\tother/x y.ts'), UNTRACKED('dir/a b.txt'), OPTIONS)
  expect(fp.total.files).toBe(3)
  expect(fp.outside).toEqual(['dir/my file.ts', 'other/x y.ts', 'dir/a b.txt'])
})

test('footprint: no changes', () => {
  const fp = footprint('', '', OPTIONS)
  expect(fp.total).toEqual({ files: 0, added: 0, removed: 0 })
  expect(fp.outside).toEqual([])
  expect(fp.sensitive).toEqual([])
  expect(fp.lines.map(line => line.text)).toContain('Changed Files: none')
})

test('footprint: without plannedPaths the plan is not checked', () => {
  for (const plannedPaths of [undefined, []]) {
    const fp = footprint(NUMSTAT('1\t0\tsrc/a.ts'), '', { id: 'CH-1', plannedPaths, testPaths: [] })
    expect(fp.outside).toBeUndefined()
    expect(fp.isBroad).toBe(false)
    expect(fp.lines.map(line => line.text)).toContain('Outside the Plan: not checked (no planned-paths in plan.md)')
  }
})

for (const entry of ['.', '/', '*', './', '**', 'src', 'src/']) {
  test(`footprint: a planned entry of ${entry} gives the warning`, () => {
    const fp = footprint(NUMSTAT('1\t0\tsrc/a.ts'), '', { ...OPTIONS, plannedPaths: [entry] })
    expect(fp.isBroad).toBe(true)
    const warning = fp.lines.find(line => line.text === 'Planned paths cover too much')
    expect(warning?.color).toBe('warning')
  })
}

test('footprint: a deeper folder or a top-level file gives no warning', () => {
  for (const entry of ['src/main/', 'src/main', 'pom.xml']) {
    const fp = footprint(NUMSTAT('1\t0\tsrc/main/a.ts', '1\t0\tpom.xml'), '', { ...OPTIONS, plannedPaths: [entry] })
    expect(fp.isBroad).toBe(false)
    expect(fp.lines.map(line => line.text)).not.toContain('Planned paths cover too much')
  }
})

test('footprint: the outside line keeps its count and its paths drop first', () => {
  const fp = footprint(NUMSTAT('1\t0\tlib/a.ts', '1\t0\tlib/b.ts'), '', { ...OPTIONS, plannedPaths: ['src/main/'] })
  const count = fp.lines.find(line => line.text === 'Outside the Plan: 2 files')
  expect(count?.drop).toBeUndefined()
  const paths = fp.lines.filter(line => line.text.startsWith('  lib/'))
  expect(paths.map(line => line.text)).toEqual(['  lib/a.ts', '  lib/b.ts'])
  expect(paths.every(line => line.drop === DROP.paths)).toBe(true)
})

test('footprint: a path list holds five paths and +n more', () => {
  const entries = Array.from({ length: 8 }, (_, i) => `1\t0\tlib/f${i}.ts`)
  const fp = footprint(NUMSTAT(...entries), '', { ...OPTIONS, plannedPaths: ['src/main/'] })
  const texts = fp.lines.map(line => line.text)
  expect(texts).toContain('Outside the Plan: 8 files')
  expect(texts.filter(text => text.startsWith('  lib/'))).toHaveLength(5)
  expect(texts).toContain('  +3 more')
})

test('footprint: Sensitive ignores plannedPaths', () => {
  const entries = ['1\t0\t.github/workflows/ci.yml', '1\t0\tCLAUDE.md', '1\t0\tpackage.json', '1\t0\tsrc/a.ts']
  for (const plannedPaths of [['.'], ['.github/', 'CLAUDE.md', 'package.json'], undefined]) {
    const fp = footprint(NUMSTAT(...entries), '', { id: 'CH-1', plannedPaths, testPaths: [] })
    expect(fp.sensitive.map(item => item.path)).toEqual(['.github/workflows/ci.yml', 'CLAUDE.md', 'package.json'])
    expect(fp.lines.map(line => line.text)).toContain('Sensitive Files: 3')
  }
})

test('footprint: a settings file the mod wrote reads learned rules (this mod)', () => {
  const entries = NUMSTAT('1\t0\t.claude/settings.json', '1\t0\t.claude/settings.local.json')
  const fp = footprint(entries, '', { ...OPTIONS, learnedRules: ['.claude/settings.local.json'] })
  expect(fp.sensitive).toEqual([{ path: '.claude/settings.json' }, { path: '.claude/settings.local.json', label: 'learned rules (this mod)' }])
  const texts = fp.lines.map(line => line.text)
  expect(texts).toContain('  .claude/settings.local.json (learned rules (this mod))')
  expect(texts).toContain('  .claude/settings.json')
})

test('footprint: a path with an unusual name draws as the fixed text', () => {
  const fp = footprint(NUMSTAT('1\t0\tlib/a\u001b[31m.ts'), '', { ...OPTIONS, plannedPaths: ['src/main/'] })
  const texts = fp.lines.map(line => line.text)
  expect(texts).toContain(`  ${UNUSUAL_NAME}`)
  expect(texts.join('\n')).not.toContain('\u001b')
})

test('footprint: no line holds a control character', () => {
  const fp = footprint(NUMSTAT('1\t0\tlib/a\nb.ts', '1\t0\tCLAUDE.md'), UNTRACKED('x\u0007y.txt'), OPTIONS)
  for (const line of fp.lines) expect(line.text).toBe(stripControl(line.text))
})

test('footprint: skips an entry it cannot read', () => {
  const fp = footprint(`garbage\0${NUMSTAT('1\t0\tsrc/a.ts')}`, '', OPTIONS)
  expect(fp.total.files).toBe(1)
})

test('footprint: the unavailable line is fixed text', () => {
  expect(FOOTPRINT_UNAVAILABLE).toBe('Changed Files: unavailable')
})

for (const [path, isSensitive] of [
  ['.github/workflows/ci.yml', true],
  ['Jenkinsfile', true],
  ['build/Jenkinsfile.dev', true],
  ['.gitlab-ci.yml', true],
  ['package.json', true],
  ['web/package-lock.json', true],
  ['pom.xml', true],
  ['services/a/build.gradle.kts', true],
  ['requirements-dev.txt', true],
  ['pyproject.toml', true],
  ['Dockerfile', true],
  ['.claude/settings.json', true],
  ['.claude/settings.local.json', true],
  ['.mcp.json', true],
  ['src/main/resources/application-prod.yml', true],
  ['.env.local', true],
  ['db/migrate/20260101_x.rb', true],
  ['db/flyway/V1__x.sql', true],
  ['src/main/resources/db/migration/V1__init.sql', true],
  ['src/main/resources/db/changelog/db.changelog-master.yaml', true],
  ['ops/liquibase/changelog.xml', true],
  ['app/migrations/0001_initial.py', true],
  ['CLAUDE.md', true],
  ['docs/CLAUDE.md', true],
  ['AGENTS.md', true],
  ['.claude/skills/x/SKILL.md', true],
  ['.claude/agents/a.md', true],
  ['src/a.ts', false],
  // Git hooks and config
  ['.husky/pre-commit', true],
  ['.githooks/pre-push', true],
  ['.pre-commit-config.yaml', true],
  ['lefthook.yml', true],
  ['.gitmodules', true],
  ['.gitattributes', true],
  // Keys and secrets
  ['certs/server.pem', true],
  ['certs/server.key', true],
  ['id_rsa', true],
  ['.ssh/id_ed25519', true],
  ['store.p12', true],
  ['store.jks', true],
  ['.netrc', true],
  ['.npmrc', true],
  ['.pypirc', true],
  // Infrastructure
  ['docker-compose.yml', true],
  ['deploy/compose.prod.yaml', true],
  ['infra/main.tf', true],
  ['infra/prod.tfvars', true],
  ['helm/app/Chart.yaml', true],
  ['helm/app/values.yaml', true],
  ['k8s/kustomization.yaml', true],
  ['infra/main.bicep', true],
  ['app.Dockerfile', true],
  ['Dockerfile.dev', true],
  ['services/a/Dockerfile', true],
  // CI and ownership
  ['CODEOWNERS', true],
  ['.github/CODEOWNERS', true],
  ['.github/actions/setup/action.yml', true],
  ['.github/dependabot.yml', true],
  ['azure-pipelines.yml', true],
  ['azure-pipelines-pr.yml', true],
  ['Jenkinsfile.dev', true],
  // Wrappers
  ['gradlew', true],
  ['gradlew.bat', true],
  ['mvnw', true],
  ['mvnw.cmd', true],
  ['gradle/wrapper/gradle-wrapper.properties', true],
  ['.mvn/wrapper/maven-wrapper.properties', true],
  // Instruction files and Claude settings
  ['.claude/hooks/check.sh', true],
  ['CLAUDE.local.md', true],
  ['GEMINI.md', true],
  ['.cursorrules', true],
  ['.cursor/rules/a.mdc', true],
  ['.github/copilot-instructions.md', true],
  // Not sensitive: names that only start or contain a sensitive name
  ['src/DockerfileParser.java', false],
  ['src/JenkinsfileLinter.kt', false],
  ['src/Jenkinsfiles/a.kt', false],
  ['docs/applicationGuide.yaml', false],
  ['app/migration/V1.sql', false],
  ['src/main/kotlin/db/MigrationService.kt', false],
  ['src/mydb/migration/V1.sql', false],
  ['src/migrationHelper.ts', false],
  ['docs/environment.md', false],
  ['.environment', false],
  ['src/monkey.ts', false],
  ['src/composer.ts', false],
  ['docs/compose-guide.md', false],
  ['src/requirements-check.ts', false],
  ['src/gradlewrapper.kt', false],
  ['src/husky/a.ts', false],
  ['src/charts/a.ts', false],
  ['README.md', false],
  ['docs/migration-notes.md', false],
  ['src/environment.ts', false],
  ['tests/test_premiums.py', false],
] as [string, boolean][]) {
  test(`SENSITIVE: ${path} is ${isSensitive ? '' : 'not '}sensitive`, () => {
    expect(SENSITIVE.some(pattern => pattern.test(path))).toBe(isSensitive)
  })
}

// isTestRun

const TEST_COMMANDS = ['npm test', 'pytest', 'python -m unittest', './gradlew test']

for (const testCommand of TEST_COMMANDS) {
  test(`isTestRun: ${testCommand} alone is a run`, () => {
    expect(isTestRun(testCommand, testCommand)).toBe('run')
    expect(isTestRun(`  ${testCommand}  `, testCommand)).toBe('run')
  })

  test(`isTestRun: ${testCommand} after VAR=value pairs and cd <dir> && is a run`, () => {
    expect(isTestRun(`CI=1 NODE_ENV=test ${testCommand}`, testCommand)).toBe('run')
    expect(isTestRun(`cd app && ${testCommand}`, testCommand)).toBe('run')
    expect(isTestRun(`cd "my app" && CI=1 ${testCommand}`, testCommand)).toBe('run')
    expect(isTestRun(`cd a && cd b && ${testCommand}`, testCommand)).toBe('run')
  })

  test(`isTestRun: ${testCommand} followed only by && is a run`, () => {
    expect(isTestRun(`${testCommand} && echo done`, testCommand)).toBe('run')
    expect(isTestRun(`cd app && ${testCommand} && echo done && date`, testCommand)).toBe('run')
  })

  for (const operator of ['|', ';', '||', '&']) {
    test(`isTestRun: ${testCommand} followed by ${operator} is unreadable`, () => {
      expect(isTestRun(`${testCommand} ${operator} tee out.txt`, testCommand)).toBe('unreadable')
      expect(isTestRun(`cd app && ${testCommand} ${operator} true`, testCommand)).toBe('unreadable')
    })
  }

  test(`isTestRun: ${testCommand} followed by && and then another operator is unreadable`, () => {
    expect(isTestRun(`${testCommand} && echo a | cat`, testCommand)).toBe('unreadable')
  })

  test(`isTestRun: ${testCommand} with echo or grep in front is none`, () => {
    expect(isTestRun(`echo ${testCommand}`, testCommand)).toBe('none')
    expect(isTestRun(`grep ${testCommand} README.md`, testCommand)).toBe('none')
  })
}

test('isTestRun: a trailing & or ; is unreadable', () => {
  expect(isTestRun('pytest &', 'pytest')).toBe('unreadable')
  expect(isTestRun('pytest;', 'pytest')).toBe('unreadable')
})

test('isTestRun: an empty test command is none', () => {
  expect(isTestRun('pytest', '')).toBe('none')
  expect(isTestRun('pytest', '   ')).toBe('none')
})

test('isTestRun: an operator inside quotes does not split the command', () => {
  expect(isTestRun("git commit -m 'fix; pytest passes'", 'pytest')).toBe('none')
  expect(isTestRun('git commit -m "fix && pytest | passes"', 'pytest')).toBe('none')
  expect(isTestRun("echo 'a | b' && pytest", 'pytest')).toBe('unreadable')
})

test('isTestRun: another word that starts the same is none', () => {
  expect(isTestRun('npm testing', 'npm test')).toBe('none')
  expect(isTestRun('pytest-watch', 'pytest')).toBe('none')
  expect(isTestRun('npm test-all', 'npm test')).toBe('none')
})

test('isTestRun: the test command with more words is extra, which leaves the last run as it was', () => {
  expect(isTestRun('pytest -k premium', 'pytest')).toBe('extra')
  expect(isTestRun('npm test -- --watch', 'npm test')).toBe('extra')
  expect(isTestRun('python3 -m unittest -v', 'python3 -m unittest')).toBe('extra')
  expect(isTestRun('python3 -m unittest tests.test_format', 'python3 -m unittest')).toBe('extra')
  expect(isTestRun('cd app && CI=1 python3 -m unittest -v', 'python3 -m unittest')).toBe('extra')
  expect(isTestRun('python3 -m unittest -v && echo done', 'python3 -m unittest')).toBe('extra')
  expect(isTestRun('npm run build && npm test -- -t one', 'npm run build && npm test')).toBe('extra')
})

test('isTestRun: more words with a pipe, an operator, a redirection or a substitution stay unreadable', () => {
  for (const command of [
    'python3 -m unittest -v | tail -5',
    'python3 -m unittest -v 2>&1 | tail',
    'python3 -m unittest -v; echo x',
    'python3 -m unittest -v || true',
    'python3 -m unittest -v &',
    'python3 -m unittest -v > out.txt',
    'python3 -m unittest -v 2>&1',
    'python3 -m unittest < in.txt',
    'python3 -m unittest $(cat tests.txt)',
    'python3 -m unittest `cat tests.txt`',
  ]) {
    expect(isTestRun(command, 'python3 -m unittest'), command).toBe('unreadable')
  }
})

test('isTestRun: the test command later in a chain, in a pipe, or in a substitution is unreadable', () => {
  expect(isTestRun('npm run build && pytest', 'pytest')).toBe('unreadable')
  expect(isTestRun('echo x | pytest', 'pytest')).toBe('unreadable')
  expect(isTestRun('echo $(pytest)', 'pytest')).toBe('unreadable')
  expect(isTestRun('echo "$(pytest)"', 'pytest')).toBe('unreadable')
  expect(isTestRun('(pytest)', 'pytest')).toBe('unreadable')
  expect(isTestRun('`pytest`', 'pytest')).toBe('unreadable')
})

test('isTestRun: a test command with its own cd and && matches the same chain', () => {
  expect(isTestRun('cd web && npm test', 'cd web && npm test')).toBe('run')
  expect(isTestRun('npm test', 'cd web && npm test')).toBe('run')
  expect(isTestRun('npm run lint && npm test', 'npm run lint && npm test')).toBe('run')
  expect(isTestRun('npm run lint', 'npm run lint && npm test')).toBe('unreadable')
  expect(isTestRun('echo hi', 'npm run lint && npm test')).toBe('none')
})

test('isTestRun: a redirect is part of the word, not an operator', () => {
  expect(isTestRun('pytest 2>&1', 'pytest')).toBe('unreadable')
  expect(isTestRun('pytest > out.txt', 'pytest')).toBe('unreadable')
})

for (const command of [
  '; pytest',
  '&& pytest',
  '| pytest',
  '|| pytest',
  '& pytest',
  '(pytest',
  '(pytest)',
  'pytest &&',
  'pytest ||',
  'pytest |',
  'cd app && pytest &&',
  ' && cd app && pytest',
]) {
  test(`isTestRun: ${command} is a syntax error, never a run`, () => {
    expect(isTestRun(command, 'pytest')).not.toBe('run')
  })
}

for (const command of ["'X=1' pytest", '"X=1" pytest', 'X\\=1 pytest', 'X=1 "Y=2" pytest', "CI=1 'pytest'x"]) {
  test(`isTestRun: ${command} has a word that is not an assignment`, () => {
    expect(isTestRun(command, 'pytest')).toBe('none')
  })
}

for (const command of ["X='1' pytest", 'X="a b" pytest', 'PYTHONPATH="src" pytest', 'X="$HOME" pytest', 'X=a\\ b pytest', 'X=\'a b\'c"d" pytest']) {
  test(`isTestRun: ${command} is an assignment with a quoted value, so a run`, () => {
    expect(isTestRun(command, 'pytest')).toBe('run')
    expect(isTestRun(`cd app && ${command}`, 'pytest')).toBe('run')
  })
}

test('isTestRun: an assignment with a quoted value before npm test is a run', () => {
  expect(isTestRun("NODE_OPTIONS='--max-old-space-size=4096' npm test", 'npm test')).toBe('run')
  expect(isTestRun('NODE_OPTIONS="--max-old-space-size=4096" CI=1 npm test && echo ok', 'npm test')).toBe('run')
})

test('isTestRun: a quote or escape inside the name part is not an assignment', () => {
  for (const command of ["X'='1' pytest", 'X"="1" pytest', 'X\\=1 pytest', "'X'=1 pytest", '"X"=1 pytest']) {
    expect(isTestRun(command, 'pytest')).toBe('none')
  }
})

test('isTestRun: a quoted test command word still counts as the word', () => {
  expect(isTestRun("X=1 'pytest'", 'pytest')).toBe('run')
  expect(isTestRun('cd app && X=1 Y=2 pytest', 'pytest')).toBe('run')
})

test('isTestRun: an empty command is none', () => {
  expect(isTestRun('', 'pytest')).toBe('none')
})

// testRunFrom, with the shapes the live check found in Claude Code 2.1.314

const FAILED = {
  isError: true as const,
  text: 'Exit code 1\nF\n======================================================================\nFAIL: test_fails (test_fail.T.test_fails)\n----------------------------------------------------------------------\nAssertionError: 1 != 2',
  result: 'Error: Exit code 1\nF\n======================================================================\nFAIL: test_fails (test_fail.T.test_fails)',
}

const RECORD = { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false }

const PASSED = {
  result: {
    ...RECORD,
    stdout: '.\n----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nOK',
  },
  text: '.\n----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nOK',
}

const LONG = {
  result: {
    ...RECORD,
    stdout: 'x'.repeat(30_000),
    persistedOutputPath: '/home/u/.claude/projects/x/tool-results/a.txt',
    persistedOutputSize: 40099,
  },
  text: '<persisted-output>\nOutput too large (39.2KB). Full output saved to: /home/u/.claude/projects/x/tool-results/a.txt\n\nPreview (first 2KB):\nxxxx',
}

const TIMED_OUT = {
  result: { ...RECORD, backgroundTaskId: 'b7x3886qf', timedOutAfterMs: 3000 },
  text: 'Command did not complete within its 3s timeout and was moved to the background (ID: b7x3886qf). You will be notified when it completes.',
}

const IN_BACKGROUND = {
  result: { ...RECORD, backgroundTaskId: 'bw0lx7g0e' },
  text: 'Command running in background with ID: bw0lx7g0e. Output is being written to: /tmp/x/tasks/bw0lx7g0e.output You will be notified when it completes.',
}

const REFUSED = {
  isError: true as const,
  text: "Permission to use Bash has been denied because Claude Code is running in don't ask mode. IMPORTANT: You *may* attempt to accomplish this action using other tools.",
  result: "Error: Permission to use Bash has been denied because Claude Code is running in don't ask mode.",
}

const BLOCKED = {
  isError: true as const,
  text: '<tool_use_error>Blocked: standalone sleep 30. Use run_in_background.</tool_use_error>',
  result: 'Error: Blocked: standalone sleep 30. Use run_in_background.',
}

test('testRunFrom: isError gives failed', () => {
  expect(testRunFrom(FAILED)).toBe('failed')
})

test('testRunFrom: an error with no text gives failed', () => {
  expect(testRunFrom({ isError: true, result: 'Error: boom' })).toBe('failed')
  expect(testRunFrom({ isError: true, result: undefined })).toBe('failed')
})

test('testRunFrom: no error gives passed', () => {
  expect(testRunFrom(PASSED)).toBe('passed')
  expect(testRunFrom({ result: undefined })).toBe('passed')
})

test('testRunFrom: the answered record with interrupted gives interrupted', () => {
  expect(testRunFrom({ result: { ...RECORD, interrupted: true }, text: 'partial output' })).toBe('interrupted')
})

test('testRunFrom: the typed record outside an error is not an error', () => {
  expect(testRunFrom({ result: { ...RECORD, interrupted: false } })).toBe('passed')
})

test('testRunFrom: the engine interrupt text gives interrupted (skipped while the text is unknown)', () => {
  if (INTERRUPT_TEXT === '') {
    expect(testRunFrom({ isError: true, text: '' })).toBe('failed')
    return
  }
  expect(testRunFrom({ isError: true, text: INTERRUPT_TEXT, result: INTERRUPT_TEXT })).toBe('interrupted')
})

test('testRunFrom: a pytest collection error gives failed', () => {
  const text = 'Exit code 2\n==== ERRORS ====\n_____ ERROR collecting tests/test_a.py _____\nImportError while importing test module'
  expect(testRunFrom({ isError: true, text, result: `Error: ${text}` })).toBe('failed')
})

test('testRunFrom: a test named test_payment_interrupted gives failed', () => {
  const text = 'Exit code 1\nFAILED tests/test_pay.py::test_payment_interrupted - AssertionError'
  expect(testRunFrom({ isError: true, text, result: `Error: ${text}` })).toBe('failed')
})

test('testRunFrom: InterruptedException in a failure gives failed', () => {
  const text = 'Exit code 1\njava.lang.InterruptedException: sleep interrupted\n\tat Foo.run(Foo.java:12)'
  expect(testRunFrom({ isError: true, text, result: `Error: ${text}` })).toBe('failed')
})

test('testRunFrom: output that mentions interrupted but ran is passed', () => {
  expect(testRunFrom({ result: { ...RECORD, stdout: 'test_payment_interrupted ... ok' }, text: 'test_payment_interrupted ... ok' })).toBe('passed')
})

test('testRunFrom: backgroundTaskId gives started, with or without timedOutAfterMs', () => {
  expect(testRunFrom(TIMED_OUT)).toBe('started')
  expect(testRunFrom(IN_BACKGROUND)).toBe('started')
})

test('testRunFrom: the long output gives the status of its short form', () => {
  expect(testRunFrom(LONG)).toBe(testRunFrom(PASSED))
  const longFailed = {
    isError: true as const,
    text: '<persisted-output>\nOutput too large (39.2KB). Full output saved to: /home/u/.claude/projects/x/tool-results/a.txt',
    result: 'Error: Exit code 1\n...',
  }
  expect(testRunFrom(longFailed)).toBe(testRunFrom(FAILED))
  const longBackground = {
    result: { ...LONG.result, backgroundTaskId: 'bw0lx7g0e' },
    text: LONG.text,
  }
  expect(testRunFrom(longBackground)).toBe(testRunFrom(IN_BACKGROUND))
})

test('testRunFrom: a refusal or a block before the run gives unreadable', () => {
  expect(testRunFrom(REFUSED)).toBe('unreadable')
  expect(testRunFrom(BLOCKED)).toBe('unreadable')
})

test('testRunFrom: a deny gives unreadable', () => {
  expect(testRunFrom({ deny: 'refused' })).toBe('unreadable')
})

test('testRunFrom: a failure whose text only mentions permission is failed', () => {
  expect(testRunFrom({ isError: true, text: 'Exit code 1\nPermission to use the file was denied' })).toBe('failed')
})

// taskEndFrom

const NOTIFICATION = (status?: string) =>
  [
    '<task-notification>',
    '<task-id>bw0lx7g0e</task-id>',
    '<tool-use-id>toolu_x</tool-use-id>',
    '<output-file>/tmp/x/tasks/bw0lx7g0e.output</output-file>',
    ...(status === undefined ? [] : [`<status>${status}</status>`]),
    '<summary>Background command "pytest" failed with exit code 1</summary>',
    '</task-notification>',
  ].join('\n')

test('taskEndFrom: reads the failed and completed texts', () => {
  expect(taskEndFrom(NOTIFICATION('failed'))).toEqual({ taskId: 'bw0lx7g0e', toolUseId: 'toolu_x', status: 'failed' })
  expect(taskEndFrom(NOTIFICATION('completed'))).toEqual({ taskId: 'bw0lx7g0e', toolUseId: 'toolu_x', status: 'completed' })
})

test('taskEndFrom: a Monitor expiry has no status', () => {
  const text = '<task-notification>\n<task-id>m1</task-id>\n<summary>Monitor expired</summary>\n</task-notification>'
  expect(taskEndFrom(text)).toEqual({ taskId: 'm1' })
})

test('taskEndFrom: text that is not a notification gives undefined', () => {
  expect(taskEndFrom('run the tests')).toBeUndefined()
  expect(taskEndFrom('')).toBeUndefined()
  expect(taskEndFrom('<task-notification>\n<status>failed</status>\n</task-notification>')).toBeUndefined()
  expect(taskEndFrom('say <task-notification><task-id>x</task-id></task-notification>')).toBeUndefined()
})

test('taskEndFrom: a status inside the summary does not count', () => {
  const text = [
    '<task-notification>',
    '<task-id>t1</task-id>',
    '<summary>Background command "x" <status>failed</status> oddly</summary>',
    '</task-notification>',
  ].join('\n')
  expect(taskEndFrom(text)).toEqual({ taskId: 't1' })
})

test('taskEndFrom: a task id inside the summary does not count', () => {
  const text = '<task-notification>\n<summary><task-id>fake</task-id></summary>\n</task-notification>'
  expect(taskEndFrom(text)).toBeUndefined()
})

test('taskEndFrom: a status that a command text puts after the first closing summary tag does not count', () => {
  const text = [
    '<task-notification>',
    '<task-id>t1</task-id>',
    '<summary>Background command "echo </summary><status>completed</status>" failed</summary>',
    '</task-notification>',
  ].join('\n')
  expect(taskEndFrom(text)).toEqual({ taskId: 't1' })
})

test('taskEndFrom: a status line after the summary never counts', () => {
  const text = ['<task-notification>', '<task-id>t1</task-id>', '<summary>x</summary>', '<status>completed</status>', '</task-notification>'].join('\n')
  expect(taskEndFrom(text)).toEqual({ taskId: 't1' })
})

test('taskEndFrom: a task id or tool use id after the summary never counts', () => {
  const text = '<task-notification>\n<summary>x</summary>\n<task-id>t1</task-id>\n</task-notification>'
  expect(taskEndFrom(text)).toBeUndefined()
})

test('taskEndFrom: a field must be a whole line', () => {
  const text = '<task-notification>\n<task-id>t1</task-id>\nnote <status>completed</status>\n<summary>x</summary>\n</task-notification>'
  expect(taskEndFrom(text)).toEqual({ taskId: 't1' })
})

test('taskEndStatus: completed, failed, killed, anything else, none', () => {
  expect(taskEndStatus('completed')).toBe('passed')
  expect(taskEndStatus('failed')).toBe('failed')
  expect(taskEndStatus('killed')).toBe('interrupted')
  expect(taskEndStatus('stalled')).toBe('unreadable')
  expect(taskEndStatus(undefined)).toBeUndefined()
})

// fitPane

const row = (text: string, length: number) => text.padEnd(length, '.')

const SECTIONS: PaneSection[] = [
  {
    id: 'phases',
    lines: [
      {
        text: row('Build working 2 open TOKENS', 51),
        shrink: { [DROP.tokens]: row('Build working 2 open', 38), [DROP.points]: row('Build working', 25) },
      },
    ],
  },
  { id: 'trace', lines: [{ text: row('TRACE', 62), drop: DROP.trace }] },
  {
    id: 'blockers',
    lines: [{ text: 'Denials: 2' }, { text: row('DENIAL-A', 84), drop: DROP.denials }, { text: row('DENIAL-B', 78), drop: DROP.denials }],
  },
  {
    id: 'files',
    lines: [{ text: 'Outside the Plan: 3 files' }, { text: row('  PATH', 66), drop: DROP.paths }, { text: '  +2 more', drop: DROP.paths }],
  },
  { id: 'turns', lines: [LONG_TURNS] },
]

const textsOf = (sections: PaneSection[]) => sections.flatMap(section => section.lines.map(line => line.text))
const keptAt = (columns: number) => {
  const texts = textsOf(fitPane(SECTIONS, columns)).join('\n')
  return {
    tokens: texts.includes('TOKENS'),
    paths: texts.includes('PATH'),
    denials: texts.includes('DENIAL'),
    trace: texts.includes('TRACE'),
    bar: texts.includes('█') || texts.includes('░'),
    points: texts.includes('2 open'),
  }
}

for (const columns of [40, 60, 64, 80]) {
  test(`fitPane: at ${columns} columns no line is longer`, () => {
    for (const text of textsOf(fitPane(SECTIONS, columns))) expect(text.length).toBeLessThanOrEqual(columns)
  })
}

test('fitPane: wide enough keeps every line', () => {
  expect(textsOf(fitPane(SECTIONS, 200))).toEqual(textsOf(SECTIONS))
  expect(keptAt(200)).toEqual({ tokens: true, paths: true, denials: true, trace: true, bar: true, points: true })
})

test('fitPane: at 80 columns the tokens, the path lists and the denial lines go', () => {
  expect(keptAt(80)).toEqual({ tokens: false, paths: false, denials: false, trace: true, bar: true, points: true })
})

test('fitPane: at 64 columns, the docked pane, the trace chain still fits', () => {
  expect(keptAt(64)).toEqual({ tokens: false, paths: false, denials: false, trace: true, bar: true, points: true })
})

test('fitPane: at 60 columns the trace chain goes too', () => {
  expect(keptAt(60)).toEqual({ tokens: false, paths: false, denials: false, trace: false, bar: true, points: true })
})

test('fitPane: at 40 columns the bar goes too, and the open-point counts stay while the row fits', () => {
  expect(keptAt(40)).toEqual({ tokens: false, paths: false, denials: false, trace: false, bar: false, points: true })
})

test('fitPane: at 30 columns the open-point counts go last', () => {
  expect(keptAt(30)).toEqual({ tokens: false, paths: false, denials: false, trace: false, bar: false, points: false })
})

test('fitPane: a part drops only after the parts before it', () => {
  const order = ['tokens', 'paths', 'denials', 'trace', 'bar', 'points'] as const
  for (let columns = 20; columns <= 200; columns++) {
    const kept = keptAt(columns)
    order.forEach((part, i) => {
      const before = order[i - 1]
      if (before !== undefined && !kept[part]) expect(kept[before]).toBe(false)
    })
  }
})

test('fitPane: the counts survive when the path lists drop', () => {
  const texts = textsOf(fitPane(SECTIONS, 60))
  expect(texts).toContain('Outside the Plan: 3 files')
  expect(texts).toContain('Denials: 2')
})

test('fitPane: dropping the bar keeps the turn text, and the phase on the line without numbers', () => {
  const texts = textsOf(fitPane([{ id: 'turns', lines: [LONG_TURNS] }], 45))
  expect(texts).toEqual(['Build · turn 23/40 · 23 min · 140 calls'])
  expect(textsOf(fitPane([{ id: 'turns', lines: [capBar('Build', 23, 23 * MINUTE, 140).line] }], 30))).toEqual(['Build  ██████░░░░'])
  expect(textsOf(fitPane([{ id: 'turns', lines: [capBar('Build', 23, 23 * MINUTE, 140).line] }], 12))).toEqual(['Build'])
})

test('fitPane: wraps what is still too long and strips control characters first', () => {
  const fitted = fitPane([{ id: 'x', lines: [{ text: 'a\u001b[31mbcdefghijklmnop\nq' }] }], 10)
  expect(textsOf(fitted)).toEqual(['a[31mbcdef', '  ghijklmn', '  opq'])
})

test('fitPane: leaves the input alone and keeps colors', () => {
  const line: PaneLine = { text: 'x'.repeat(100), color: 'error', drop: DROP.paths }
  const input: PaneSection[] = [{ id: 'a', lines: [line, { text: 'ok', color: 'warning' }] }]
  const fitted = fitPane(input, 20)
  expect(input[0]?.lines).toHaveLength(2)
  expect(input[0]?.lines[0]?.text).toHaveLength(100)
  expect(fitted[0]?.lines).toEqual([{ text: 'ok', color: 'warning' }])
})

test('fitPane: a line that no step can shorten does not make the other parts drop', () => {
  const stuck = { text: 'Outside the Plan: not checked (no planned-paths in plan.md)' }
  expect(stuck.text).toHaveLength(59)
  const sections: PaneSection[] = [
    {
      id: 'phases',
      lines: [
        {
          text: row('Build working 2 open TOKENS', 51),
          shrink: { [DROP.tokens]: row('Build working 2 open', 38), [DROP.points]: row('Build working', 25) },
        },
      ],
    },
    { id: 'trace', lines: [{ text: row('TRACE', 40), drop: DROP.trace }] },
    { id: 'files', lines: [stuck] },
    { id: 'turns', lines: [capBar('Build', 23, 23 * MINUTE, 140).line] },
  ]
  for (const columns of [53, 55]) {
    const texts = textsOf(fitPane(sections, columns))
    expect(texts).toContain('Outside the Plan: not checked (no planned-paths in')
    expect(texts).toContain('  plan.md)')
    expect(texts.some(text => text.includes('TOKENS'))).toBe(true)
    expect(texts.some(text => text.includes('TRACE'))).toBe(true)
    expect(texts.some(text => text.includes('2 open'))).toBe(true)
    expect(texts.some(text => text.includes('█'))).toBe(true)
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(columns)
  }
})

test('fitPane: a step still runs for a line that a later step can shorten', () => {
  const sections: PaneSection[] = [
    {
      id: 'a',
      lines: [
        { text: 'x'.repeat(30), shrink: { [DROP.points]: 'x'.repeat(10) } },
        { text: 'y'.repeat(30), drop: DROP.trace },
      ],
    },
  ]
  expect(textsOf(fitPane(sections, 20))).toEqual(['x'.repeat(10)])
})

test('fitPane: drops Unicode format characters, bidi overrides and line separators', () => {
  const fitted = fitPane([{ id: 'x', lines: [{ text: 'a\u202eb\u200bc\u2028d\u2029e\ufeff\u2066f\u00adg' }] }], 20)
  expect(textsOf(fitted)).toEqual(['abcdefg'])
})

test('stripControl: removes format characters and separators', () => {
  expect(stripControl('a\u202eb\u200dc\u2028d\u2029e')).toBe('abcde')
})

test('fitPane: wraps by code point, never inside a surrogate pair', () => {
  const fitted = textsOf(fitPane([{ id: 'x', lines: [{ text: '😀'.repeat(5) }, { text: 'ab😀cd' }] }], 3))
  expect(fitted).toEqual(['😀😀😀', '  😀', '  😀', 'ab😀', '  c', '  d'])
  for (const text of fitted) expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
})

test('fitPane: a long line wraps at word boundaries, the continuation lines indented by two spaces, in its color', () => {
  const text = 'Blocked: goal-and-do blocks the run: Git config, hooks or attributes changed since the run started.'
  const fitted = fitPane(
    [
      {
        id: 'blockers',
        lines: [
          { text, color: 'error' },
          { text: 'Denials: 1', color: 'warning' },
        ],
      },
    ],
    40
  )
  expect(fitted[0]?.id).toBe('blockers')
  expect(fitted[0]?.lines).toEqual([
    { text: 'Blocked: goal-and-do blocks the run: Git', color: 'error' },
    { text: '  config, hooks or attributes changed', color: 'error' },
    { text: '  since the run started.', color: 'error' },
    { text: 'Denials: 1', color: 'warning' },
  ])
  for (const line of fitted[0]?.lines ?? []) expect(Array.from(line.text).length).toBeLessThanOrEqual(40)
})

test('fitPane: a word longer than the width is split, and a line that fits stays whole', () => {
  const fitted = textsOf(fitPane([{ id: 'x', lines: [{ text: 'see ' + 'w'.repeat(25) + ' now' }, { text: 'short' }] }], 12))
  expect(fitted).toEqual(['see', '  wwwwwwwwww', '  wwwwwwwwww', '  wwwww now', 'short'])
})

test('fitPane: wrapping replaces only the final cut, so the drop order stays', () => {
  const sections: PaneSection[] = [
    {
      id: 'a',
      lines: [{ text: 'x'.repeat(30), drop: DROP.paths }, { text: 'one two three four five six seven', drop: DROP.trace }, { text: 'keep this line whole' }],
    },
  ]
  expect(textsOf(fitPane(sections, 20))).toEqual(['keep this line whole'])
  expect(textsOf(fitPane(sections, 200))).toEqual(textsOf(sections))
})

test('wrapText: breaks at spaces, keeps a first line indent, and indents the continuation by two spaces', () => {
  expect(wrapText('', 10)).toEqual([''])
  expect(wrapText('abc def ghi', 7)).toEqual(['abc def', '  ghi'])
  expect(wrapText('abc def ghi', 11)).toEqual(['abc def ghi'])
  expect(wrapText('  src/a.ts +3 -1 and more words', 14)).toEqual(['  src/a.ts +3', '  -1 and more', '  words'])
  expect(wrapText('a    b', 3)).toEqual(['a', '  b'])
})

test('wrapText: a width of two or less cuts into pieces with no indent', () => {
  expect(wrapText('abcde', 2)).toEqual(['ab', 'cd', 'e'])
})

test('fitPane: counts a line by code points', () => {
  const sections: PaneSection[] = [{ id: 'x', lines: [{ text: '😀'.repeat(5), drop: DROP.paths }, { text: 'ok' }] }]
  expect(textsOf(fitPane(sections, 5))).toEqual(['😀😀😀😀😀', 'ok'])
})

// reasonText

test('reasonText: the pane text for tests holds no path', () => {
  expect(reasonText('tests')).toBe('goal-and-do blocks edits to the acceptance tests after Plan approval.')
})

test('reasonText: pushPhase drops its last sentence, which repeats the phase', () => {
  expect(reasonText('pushPhase')).toBe('goal-and-do allows git push only in the PR phase.')
})

test('reasonText: another reason shows as the guard words it', () => {
  expect(reasonText('ci')).toBe('goal-and-do blocks edits to CI files (.github/workflows/, Jenkinsfile*).')
})

// plannedPathsFrom and testCommandFrom

test('plannedPathsFrom reads the planned-paths line', () => {
  const plan = '---\nstatus: done\nplanned-paths: src/pricing/ src/api/premium.ts  tests/\n---\n'
  expect(plannedPathsFrom(plan)).toEqual(['src/pricing/', 'src/api/premium.ts', 'tests/'])
})

test('plannedPathsFrom: a missing field or an empty plan gives an empty list', () => {
  expect(plannedPathsFrom('---\nstatus: done\n---\n')).toEqual([])
  expect(plannedPathsFrom('')).toEqual([])
  expect(plannedPathsFrom('---\nplanned-paths:\n---\n')).toEqual([])
})

test('testCommandFrom reads the test-command line', () => {
  expect(testCommandFrom('---\nstatus: done\ntest-command: pytest -q\n---\n')).toBe('pytest -q')
  expect(testCommandFrom('---\ntest-command: "npm test"\n---\n')).toBe('npm test')
})

test('testCommandFrom: a missing field or an empty plan gives an empty string', () => {
  expect(testCommandFrom('---\nstatus: done\n---\n')).toBe('')
  expect(testCommandFrom('')).toBe('')
})

// wrapParts

test('wrapParts: a line that fits stays as it is, with its colors', () => {
  const line = [{ text: 'turn 1/40', color: 'subtle' as const }, { text: ' · ' }, { text: 'working', color: 'suggestion' as const }]
  expect(wrapParts(line, 19)).toEqual([line])
})

test("wrapParts: a line that is too wide wraps by the pane's rule, and every row fits", () => {
  const line = [{ text: 'turn 1/40', color: 'subtle' as const }, { text: ' · ' }, { text: 'waiting: approve Plan with next', color: 'warning' as const }]
  const rows = wrapParts(line, 20)
  expect(rows.map(row => row.map(part => part.text).join(''))).toEqual(wrapText('turn 1/40 · waiting: approve Plan with next', 20))
  for (const row of rows) expect(row.map(part => part.text).join('').length).toBeLessThanOrEqual(20)
})

test('wrapParts: each character keeps the color of its part across a break, and the indent has none', () => {
  const line = [
    { text: 'aaa bbb', color: 'success' as const },
    { text: ' → ', color: 'subtle' as const },
    { text: 'ccc ddd', color: 'warning' as const, bold: true as const },
  ]
  const rows = wrapParts(line, 8)
  expect(rows.map(row => row.map(part => part.text).join(''))).toEqual(wrapText('aaa bbb → ccc ddd', 8))
  const letters = (parts: typeof line) =>
    parts.flatMap(part =>
      Array.from(part.text)
        .filter(char => char !== ' ')
        .map(char => [char, part.color, part.bold])
    )
  expect(letters(rows.flat() as typeof line)).toEqual(letters(line))
  for (const row of rows.slice(1)) expect(row[0]).toEqual({ text: '  ' })
})

test('wrapParts: a part longer than the width is split, every row fits, and the colors stay', () => {
  const line = [
    { text: 'ab ', color: 'success' as const },
    { text: 'cdefghijkl', color: 'error' as const },
  ]
  const rows = wrapParts(line, 5)
  const texts = rows.map(row => row.map(part => part.text).join(''))
  expect(texts).toEqual(wrapText('ab cdefghijkl', 5))
  for (const text of texts) expect(Array.from(text).length).toBeLessThanOrEqual(5)
  expect(texts.join('').replace(/ /g, '')).toBe('abcdefghijkl')
  const letters = rows.flatMap(row => row.filter(part => part.text.trim() !== ''))
  for (const part of letters) expect(part.color).toBe(part.text.startsWith('a') || part.text.startsWith('b') ? 'success' : 'error')
})

test('wrapParts: at 30 and 40 columns no row is longer and no word is split', () => {
  const line = [
    { text: '✔ INTENT', color: 'success' as const },
    { text: ' → ', color: 'subtle' as const },
    { text: '● BUILD', color: 'claude' as const, bold: true as const },
    { text: ' → ', color: 'subtle' as const },
    { text: 'TEST', color: 'inactive' as const, dim: true as const },
    { text: '   ' },
    { text: 'waiting: approve Build with /goal-and-do next', color: 'warning' as const },
  ]
  for (const columns of [30, 40]) {
    const texts = wrapParts(line, columns).map(row => row.map(part => part.text).join(''))
    for (const text of texts) expect(Array.from(text).length, text).toBeLessThanOrEqual(columns)
    expect(
      texts
        .join(' ')
        .split(/\s+/)
        .filter(word => word !== '')
    ).toEqual('✔ INTENT → ● BUILD → TEST waiting: approve Build with /goal-and-do next'.split(' '))
  }
})

// Foldable path lists

test('footprint: a path list has a head line with its count, and each of its paths names the list', () => {
  const entries = NUMSTAT('1\t0\tlib/a.ts', '1\t0\tlib/b.ts', '1\t0\tCLAUDE.md')
  const fp = footprint(entries, '', { ...OPTIONS, plannedPaths: ['src/main/'] })
  expect(fp.lines.find(line => line.text === 'Outside the Plan: 3 files')).toMatchObject({ head: 'outside', count: 3 })
  expect(fp.lines.filter(line => line.under === 'outside').map(line => line.text)).toEqual(['  lib/a.ts', '  lib/b.ts', '  CLAUDE.md'])
  expect(fp.lines.find(line => line.text === 'Sensitive Files: 1')).toMatchObject({ head: 'sensitive', count: 1 })
  expect(fp.lines.filter(line => line.under === 'sensitive').map(line => line.text)).toEqual(['  CLAUDE.md'])
  const none = footprint(NUMSTAT('1\t0\tsrc/main/a.ts'), '', { ...OPTIONS, plannedPaths: ['src/main/'] })
  expect(none.lines.some(line => line.head !== undefined || line.under !== undefined)).toBe(false)
})

test('fitPane: a fold header keeps its fold on every row it wraps to', () => {
  const fitted = fitPane([{ id: 'x', lines: [{ text: '▼ Recent Files (5) and more words', fold: 'recent', color: 'warning' }, { text: 'plain' }] }], 20)
  expect(fitted[0]?.lines).toEqual([
    { text: '▼ Recent Files (5)', color: 'warning', fold: 'recent' },
    { text: '  and more words', color: 'warning', fold: 'recent' },
    { text: 'plain' },
  ])
})

test('wrapParts: a part that is a button keeps its button across a break', () => {
  const line = [{ text: 'BAC-1', button: 'BAC-1' }, { text: ' → ' }, { text: 'AC-1', button: 'AC-1' }, { text: ', ' }, { text: 'AC-2', button: 'AC-2' }]
  const rows = wrapParts(line, 14)
  expect(rows).toEqual([
    [{ text: 'BAC-1', button: 'BAC-1' }, { text: ' → ' }, { text: 'AC-1', button: 'AC-1' }, { text: ',' }],
    [{ text: '  ' }, { text: 'AC-2', button: 'AC-2' }],
  ])
})

// Last Changed

test('lastChangedLines: the five newest changed files, newest first, under their header; a file without a time leaves', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((path, i) => ({ path: `src/${path}.ts`, mtimeMs: i * 1000 }))
  const lines = lastChangedLines([...files, { path: 'gone.ts', mtimeMs: undefined }])
  expect(lines[0]).toMatchObject({ text: 'Last Changed: 5', head: 'last', count: 5 })
  expect(lines.slice(1).map(line => line.text)).toEqual(['  src/f.ts', '  src/e.ts', '  src/d.ts', '  src/c.ts', '  src/b.ts'])
  expect(lines.slice(1).every(line => line.under === 'last')).toBe(true)
  expect(lastChangedLines([{ path: 'gone.ts', mtimeMs: undefined }])).toEqual([])
})

test('lastChangedLines: an unusual name shows as the fixed text', () => {
  expect(lastChangedLines([{ path: 'a\u202eb.ts', mtimeMs: 1 }])[1]?.text).toBe(`  ${UNUSUAL_NAME}`)
})

test('footprint: lists every changed path, the untracked ones too', () => {
  expect(footprint('1\t0\tsrc/a.ts\0', 'notes.md\0', { id: 'ABC-1' }).paths).toEqual(['src/a.ts', 'notes.md'])
})

test('fitPane keeps a bold head bold on every row it wraps to', () => {
  const [section] = fitPane([{ id: 'tests', lines: [{ text: 'Tests: passed at 18:00 CET (PR)', bold: true }, { text: 'AC marks' }] }], 12)
  const rows = section?.lines ?? []
  expect(rows.length).toBeGreaterThan(2)
  expect(rows.slice(0, -1).every(line => line.bold === true)).toBe(true)
  expect(rows.at(-1)).toEqual({ text: 'AC marks' })
})
