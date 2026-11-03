import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import { guard } from './guard'
import { isTestFile, reviewerInput, SCAN_POINTS, signalsLine, testRecordSection, weakeningSignals } from './weakening'
import type { BranchFacts, ChangedPath, Item, Signals } from './weakening'

type Ctx = Parameters<typeof guard>[1]

const ctxFor = (phase: PhaseName, overrides: Partial<Ctx> = {}): Ctx => ({
  active: true,
  phase,
  id: 'ABC-1',
  lockedPaths: [],
  root: '/repo',
  home: '/home/dev',
  ...overrides,
})

const change = (path: string, status: ChangedPath['status'], addedLines: string[] = [], from?: string): ChangedPath =>
  from === undefined ? { path, status, addedLines } : { path, status, from, addedLines }

const facts = (overrides: Partial<BranchFacts> = {}): BranchFacts => ({
  baseFiles: [],
  changes: [],
  deletions: [],
  runnerPaths: [],
  specText: '',
  ...overrides,
})

const paths = (items: Item[]): string[] => items.map(item => item.path).sort()

// The lines a test record or a dialog must never carry.
const CODE_MARKER = 'flaky on CI'
const PY_SKIP_LINE = `@pytest.mark.skip(reason="${CODE_MARKER}")`
const JS_SKIP_LINE = `  it.skip('${CODE_MARKER}', () => {})`

// Synthetic personal data, assembled at run time.
const EMAIL = ['jane.doe', '@example.test'].join('')
const PHONE = ['+', '4915112', '345678'].join('')
const IBAN = ['DE89', '3704', '0044', '0532', '0130', '00'].join('')
const BAD_IBAN = ['DE89', '3704', '0044', '0532', '0130', '01'].join('')

const pythonFacts = (): BranchFacts =>
  facts({
    baseFiles: ['src/app.py', 'tests/test_old.py', 'tests/test_keep.py', 'pytest.ini'],
    changes: [
      change('tests/test_old.py', 'deleted'),
      change('tests/test_keep.py', 'modified', [PY_SKIP_LINE, 'def test_other(): pass']),
      change('pytest.ini', 'modified', ['addopts = -q']),
    ],
    deletions: [{ path: 'tests/test_old.py', message: 'chore: drop the old test' }],
  })

const jsFacts = (): BranchFacts =>
  facts({
    baseFiles: ['src/app.ts', 'src/old.test.ts', 'src/keep.spec.ts', 'jest.config.js', 'package.json'],
    changes: [
      change('src/old.test.ts', 'deleted'),
      change('src/keep.spec.ts', 'modified', [JS_SKIP_LINE, 'const unrelated = 1']),
      change('jest.config.js', 'modified', ['module.exports = { bail: 1 }']),
    ],
    deletions: [{ path: 'src/old.test.ts', message: 'chore: drop the old test' }],
  })

function expectThreeSignals(signals: Signals, deleted: string, skipped: string, config: string): void {
  expect(paths(signals.deletedTests)).toEqual([deleted])
  expect(paths(signals.skipMarkers)).toEqual([skipped])
  expect(paths(signals.runnerConfigEdits)).toEqual([config])

  const line = signalsLine(signals)
  const record = testRecordSection(signals)
  for (const text of [line, record]) {
    for (const path of [deleted, skipped, config]) {
      expect(text, `the text names ${path}`).toContain(path)
    }
    expect(text, 'the text holds no line of code').not.toContain(CODE_MARKER)
    expect(text, 'the text holds no line of code').not.toContain('def test_other')
    expect(text, 'the text holds no line of code').not.toContain('const unrelated')
    expect(text, 'the text holds no line of code').not.toContain('addopts')
  }
}

test('AC-8: the dialog counts new dependencies and each personal-data shape with their paths, shows no personal data, and blocks nothing', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['requirements.txt'],
      changes: [
        change('requirements.txt', 'modified', ['requests==2.31.0']),
        change('data/contacts.csv', 'added', [`name,${EMAIL}`]),
        change('data/phones.txt', 'added', [`call ${PHONE}`]),
        change('data/accounts.txt', 'added', [`iban ${IBAN}`]),
      ],
    })
  )
  expect(paths(signals.newDependencies)).toEqual(['requirements.txt'])
  expect(paths(signals.email)).toEqual(['data/contacts.csv'])
  expect(paths(signals.phone)).toEqual(['data/phones.txt'])
  expect(paths(signals.iban)).toEqual(['data/accounts.txt'])

  const line = signalsLine(signals)
  for (const path of ['requirements.txt', 'data/contacts.csv', 'data/phones.txt', 'data/accounts.txt']) {
    expect(line, `the dialog names ${path}`).toContain(path)
  }
  for (const value of [EMAIL, PHONE, IBAN, 'jane.doe', PHONE.slice(4), IBAN.slice(4)]) {
    expect(line, 'the dialog shows no personal data').not.toContain(value)
  }
})

test('AC-8: a malformed IBAN, a short phone number and a comment-only requirements change are not counted; 8 and 15 digits are', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['requirements.txt'],
      changes: [
        change('requirements.txt', 'modified', ['# pinned for now', '']),
        change('data/bad-iban.txt', 'added', [`iban ${BAD_IBAN}`]),
        change('data/short-phone.txt', 'added', ['call +1234567']),
        change('data/eight.txt', 'added', ['call +12345678']),
        change('data/fifteen.txt', 'added', ['call +123456789012345']),
      ],
    })
  )
  expect(signals.newDependencies).toEqual([])
  expect(signals.iban).toEqual([])
  expect(paths(signals.phone)).toEqual(['data/eight.txt', 'data/fifteen.txt'])
})

test('AC-8: package.json and pyproject.toml additions count as new dependencies', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['package.json', 'pyproject.toml'],
      changes: [change('package.json', 'modified', ['    "left-pad": "^1.3.0",']), change('pyproject.toml', 'modified', ['    "httpx>=0.27",'])],
    })
  )
  expect(paths(signals.newDependencies)).toEqual(['package.json', 'pyproject.toml'])
})

test('AC-8: the dialog line for an unreadable branch says not scanned', () => {
  expect(signalsLine('not scanned')).toContain('not scanned')
})

test('AC-9: a Python branch that deletes a test, adds a skip marker and edits the runner configuration shows three counted signals with paths and no code', () => {
  expectThreeSignals(weakeningSignals(pythonFacts()), 'tests/test_old.py', 'tests/test_keep.py', 'pytest.ini')
})

test('AC-9: unittest.skip counts as a skip marker, and conftest.py counts as a setup edit', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_keep.py', 'tests/conftest.py'],
      changes: [change('tests/test_keep.py', 'modified', ['@unittest.skip("later")']), change('tests/conftest.py', 'modified', ['import os'])],
    })
  )
  expect(paths(signals.skipMarkers)).toEqual(['tests/test_keep.py'])
  expect(paths(signals.setupEdits)).toEqual(['tests/conftest.py'])
})

test('AC-9: the dialog line and the test record show the count of a signal', () => {
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']
  const deleted = names.map(name => `tests/test_${name}.py`)
  const signals = weakeningSignals(
    facts({
      baseFiles: deleted,
      changes: deleted.map(path => change(path, 'deleted')),
      deletions: deleted.map(path => ({ path, message: 'chore: drop tests' })),
    })
  )
  expect(signals.deletedTests.length).toBe(7)
  for (const text of [signalsLine(signals), testRecordSection(signals)]) {
    expect(text).toContain('7')
    for (const path of deleted) {
      expect(text, `the text names ${path}`).toContain(path)
    }
  }
})

test('AC-9: a renamed test file is not a deletion', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py', 'src/old.test.ts'],
      changes: [change('tests/test_new_name.py', 'renamed', [], 'tests/test_old.py'), change('src/new-name.test.ts', 'renamed', [], 'src/old.test.ts')],
    })
  )
  expect(signals.deletedTests).toEqual([])
})

test('AC-9: a skip marker outside a test file is not a weakening signal', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['src/app.py'],
      changes: [change('src/app.py', 'modified', [PY_SKIP_LINE])],
    })
  )
  expect(signals.skipMarkers).toEqual([])
})

test('AC-9: Python test files are found by test_*.py, *_test.py and the tests/ folder', () => {
  for (const path of ['src/test_models.py', 'src/models_test.py', 'tests/helpers.py', 'pkg/tests/deep/helpers.py']) {
    expect(isTestFile(path), path).toBe(true)
  }
  for (const path of ['src/models.py', 'src/contest.py', 'src/latest.py']) {
    expect(isTestFile(path), path).toBe(false)
  }
})

test('AC-10: a JS or TS branch that deletes a test, adds a skip marker and edits the runner configuration shows three counted signals with paths and no code', () => {
  expectThreeSignals(weakeningSignals(jsFacts()), 'src/old.test.ts', 'src/keep.spec.ts', 'jest.config.js')
})

test('AC-10: it.skip, xit and describe.skip each count as a skip marker, and process.exit does not', () => {
  const markers: [string, string][] = [
    ['src/a.test.ts', "it.skip('x', () => {})"],
    ['src/b.test.ts', "xit('x', () => {})"],
    ['src/c.spec.ts', "describe.skip('x', () => {})"],
  ]
  const signals = weakeningSignals(
    facts({
      baseFiles: [...markers.map(([path]) => path), 'src/d.test.ts'],
      changes: [...markers.map(([path, line]) => change(path, 'modified', [line])), change('src/d.test.ts', 'modified', ['process.exit(1)'])],
    })
  )
  expect(paths(signals.skipMarkers)).toEqual(['src/a.test.ts', 'src/b.test.ts', 'src/c.spec.ts'])
})

test('AC-10: pytest.ini, tox.ini, setup.cfg, jest.config.* and vitest.config.* each count as a runner configuration edit, whether modified, added or renamed', () => {
  const names = ['pytest.ini', 'tox.ini', 'setup.cfg', 'jest.config.js', 'jest.config.ts', 'vitest.config.mts', 'packages/web/jest.config.js']
  for (const status of ['modified', 'added', 'renamed'] as const) {
    const signals = weakeningSignals(
      facts({
        baseFiles: status === 'added' ? [] : names,
        changes: names.map(name => (status === 'renamed' ? change(name, status, ['x = 1'], `old/${name}`) : change(name, status, ['x = 1']))),
      })
    )
    expect(paths(signals.runnerConfigEdits), status).toEqual([...names].sort())
  }
})

test('AC-10: JS and TS test files are found by *.test.*, *.spec.*, the __tests__ folder and the runner configuration paths', () => {
  for (const path of ['src/a.test.ts', 'src/a.spec.tsx', 'src/__tests__/a.ts', 'src/a.test.js']) {
    expect(isTestFile(path), path).toBe(true)
  }
  expect(isTestFile('src/a.ts')).toBe(false)
  expect(isTestFile('qa/suite-one.js')).toBe(false)
  expect(isTestFile('qa/suite-one.js', ['qa/suite-one.js'])).toBe(true)
  expect(isTestFile('src/a.ts', ['qa/suite-one.js'])).toBe(false)
})

test('AC-11: the push dialog and the test record scan at the end of Build, the end of Test, and before every push', () => {
  expect([...SCAN_POINTS]).toEqual(['build-end', 'test-end', 'push'])
})

test('AC-11: only tests at the merge base are existing tests, so a test the branch added and later deleted is not counted', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['src/app.py'],
      changes: [change('tests/test_temp.py', 'deleted'), change('tests/test_new.py', 'added', [PY_SKIP_LINE])],
      deletions: [{ path: 'tests/test_temp.py', message: 'chore: remove my own temporary test' }],
    })
  )
  expect(signals.deletedTests).toEqual([])
  expect(signals.skipMarkers).toEqual([])

  const net = weakeningSignals(facts({ baseFiles: ['src/app.py'], changes: [] }))
  expect(net.deletedTests).toEqual([])
  expect(net.skipMarkers).toEqual([])
})

test('AC-11: a test file at the merge base that the branch deletes is counted', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py'],
      changes: [change('tests/test_old.py', 'deleted')],
      deletions: [{ path: 'tests/test_old.py', message: 'chore: drop' }],
    })
  )
  expect(paths(signals.deletedTests)).toEqual(['tests/test_old.py'])
})

test('AC-12: with test-weakening signals, the guard still allows an edit of an existing test file in the Test phase and the PR fix loop, and denies the acceptance test', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py', 'tests/test_keep.py'],
      changes: [change('tests/test_old.py', 'deleted'), change('tests/test_keep.py', 'modified', [PY_SKIP_LINE])],
      deletions: [{ path: 'tests/test_old.py', message: 'chore: drop' }],
    })
  )
  expect(signals.deletedTests.length).toBe(1)
  expect(signals.skipMarkers.length).toBe(1)

  const acceptance = 'tests/acceptance/test_change_acceptance.py'
  for (const phase of ['Test', 'PR'] as PhaseName[]) {
    const ctx = ctxFor(phase, { lockedPaths: [acceptance] })
    for (const tool of ['Write', 'Edit']) {
      for (const existing of ['/repo/tests/test_old.py', '/repo/tests/test_keep.py']) {
        const verdict = guard({ tool, input: { file_path: existing } }, ctx)
        expect(verdict.verdict, `${phase} ${tool} ${existing}`).toBe('pass')
      }
      const locked = guard({ tool, input: { file_path: `/repo/${acceptance}` } }, ctx)
      expect(locked.verdict, `${phase} ${tool} ${acceptance}`).toBe('deny')
    }
  }
})

const SPEC_TEXT = [
  '## Acceptance criteria',
  '',
  '### AC-3 (BAC-8)',
  '',
  '- Given the old suite',
  '- When the change lands',
  '- Then tests/test_old.py is removed and replaced by tests/test_new.py',
  '',
  '### AC-4 (BAC-9)',
  '',
  '- Given a report',
  '- Then the report is printed',
  '',
  '### AC-5 (BAC-9)',
  '',
  '- Then tests/test_comment.py is removed',
  '',
].join('\n')

test('AC-13: a deletion the spec authorizes, in a commit that names the ID, is authorized; an ID only in a code comment is not', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py', 'tests/test_other.py', 'tests/test_comment.py', 'src/notes.py'],
      changes: [
        change('tests/test_old.py', 'deleted'),
        change('tests/test_other.py', 'deleted'),
        change('tests/test_comment.py', 'deleted'),
        change('src/notes.py', 'modified', ['# removes tests/test_comment.py, see AC-5']),
      ],
      deletions: [
        { path: 'tests/test_old.py', message: 'test: remove the old suite (AC-3)' },
        { path: 'tests/test_other.py', message: 'test: drop it (AC-4)' },
        { path: 'tests/test_comment.py', message: 'chore: clean up' },
      ],
      specText: SPEC_TEXT,
    })
  )
  expect(signals.deletedTests.length, 'all three deletions are counted').toBe(3)
  const byPath = (path: string) => signals.deletedTests.find(item => item.path === path)
  expect(byPath('tests/test_old.py')?.authorized).toBe(true)
  expect(byPath('tests/test_other.py')?.authorized, 'the criterion does not name the file').toBeFalsy()
  expect(byPath('tests/test_comment.py')?.authorized, 'the ID stands only in a code comment').toBeFalsy()
})

test('AC-13: a commit message without the ID does not authorize a deletion the spec names', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py'],
      changes: [change('tests/test_old.py', 'deleted')],
      deletions: [{ path: 'tests/test_old.py', message: 'test: remove the old suite' }],
      specText: SPEC_TEXT,
    })
  )
  expect(signals.deletedTests.length).toBe(1)
  expect(signals.deletedTests[0]?.authorized).toBeFalsy()
})

test('AC-13: skip markers and runner configuration edits are never authorized', () => {
  const signals = weakeningSignals(
    facts({
      baseFiles: ['tests/test_old.py', 'tests/test_keep.py', 'pytest.ini'],
      changes: [
        change('tests/test_old.py', 'deleted'),
        change('tests/test_keep.py', 'modified', [PY_SKIP_LINE]),
        change('pytest.ini', 'modified', ['addopts = -q']),
      ],
      deletions: [{ path: 'tests/test_old.py', message: 'test: remove the old suite (AC-3)' }],
      specText: SPEC_TEXT,
    })
  )
  expect(signals.deletedTests[0]?.authorized).toBe(true)
  expect(signals.skipMarkers.length).toBe(1)
  expect(signals.runnerConfigEdits.length).toBe(1)
  expect(signals.skipMarkers[0]?.authorized).toBeFalsy()
  expect(signals.runnerConfigEdits[0]?.authorized).toBeFalsy()
})

test('AC-16: the reviewer input holds the same counts and paths as the test record and no line of code', () => {
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']
  const deleted = names.map(name => `tests/test_${name}.py`)
  const signals = weakeningSignals(
    facts({
      baseFiles: [...deleted, 'tests/test_keep.py', 'pytest.ini'],
      changes: [
        ...deleted.map(path => change(path, 'deleted')),
        change('tests/test_keep.py', 'modified', [PY_SKIP_LINE]),
        change('pytest.ini', 'modified', ['addopts = -q']),
      ],
      deletions: deleted.map(path => ({ path, message: 'chore: drop tests' })),
    })
  )
  const record = testRecordSection(signals)
  const input = reviewerInput(signals)
  for (const path of [...deleted, 'tests/test_keep.py', 'pytest.ini']) {
    expect(record, `the test record names ${path}`).toContain(path)
    expect(input, `the reviewer input names ${path}`).toContain(path)
  }
  expect(record).toContain('7')
  expect(input).toContain('7')
  for (const text of [record, input]) {
    expect(text, 'no line of code').not.toContain(CODE_MARKER)
    expect(text, 'no line of code').not.toContain('addopts')
  }
})
