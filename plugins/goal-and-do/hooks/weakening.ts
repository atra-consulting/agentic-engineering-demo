// The test-weakening signals: plain facts about merge-base..HEAD in, counts and paths out. They gate nothing and never throw. The text for
// the push dialog, the test record and the change reviewer holds counts and paths, never a line of code and never a matched value.
import {
  EMAIL,
  IBAN_CANDIDATE,
  isIban,
  JS_TEST_FILE,
  NON_DEPENDENCY_KEYS,
  PACKAGE_JSON_LINE,
  PHONE,
  PYPROJECT_LIST_LINE,
  PYPROJECT_TABLE_LINE,
  PYTHON_TEST_FILE,
  REQUIREMENTS_FILE,
  REQUIREMENTS_LINE,
  RUNNER_CONFIG,
  SETUP_FILE,
  SKIP_MARKERS,
  TEST_DIR,
} from './shapes'

export interface ChangedPath {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  from?: string
  addedLines: string[]
}

export interface Deletion {
  path: string
  message: string
}

export interface BranchFacts {
  baseFiles: string[]
  changes: ChangedPath[]
  deletions: Deletion[]
  runnerPaths: string[]
  specText: string
  // The setup files the runner configuration names, when the caller could read them. conftest.py and the conventional names need no entry.
  setupPaths?: string[]
}

export interface Item {
  path: string
  authorized?: boolean
}

export interface Signals {
  deletedTests: Item[]
  skipMarkers: Item[]
  runnerConfigEdits: Item[]
  setupEdits: Item[]
  newDependencies: Item[]
  email: Item[]
  phone: Item[]
  iban: Item[]
}

// Where the signals are computed: the end of Build, the end of Test, and before every push.
export const SCAN_POINTS = ['build-end', 'test-end', 'push'] as const

export function isTestFile(path: string, runnerPaths: string[] = []): boolean {
  return runnerPaths.includes(path) || PYTHON_TEST_FILE.test(path) || JS_TEST_FILE.test(path) || TEST_DIR.test(path)
}

const REMOVAL_WORD = /\b(?:removed?|replaced?|deleted?|dropped)\b/i

// The criteria of spec.md: the ID of each "### AC-n" heading and the lines up to the next heading.
function criteria(specText: string): { id: string; lines: string[] }[] {
  const found: { id: string; lines: string[] }[] = []
  let current: { id: string; lines: string[] } | undefined
  for (const line of specText.split('\n')) {
    const id = /^###\s+(AC-\d+)\b/.exec(line)?.[1]
    if (id !== undefined) {
      current = { id, lines: [] }
      found.push(current)
    } else if (/^#{1,6}\s/.test(line)) {
      current = undefined
    } else {
      current?.lines.push(line)
    }
  }
  return found
}

// A deletion is authorized when a criterion names the file as removed or replaced and the deleting commit's message names that criterion's
// ID. An ID anywhere else (a code comment) authorizes nothing.
function isAuthorized(specText: string, path: string, deletion: Deletion | undefined): boolean {
  if (deletion === undefined) return false
  return criteria(specText).some(
    criterion =>
      criterion.lines.some(line => line.includes(path) && REMOVAL_WORD.test(line)) && new RegExp(`(?<![\\w-])${criterion.id}(?![\\w-])`).test(deletion.message)
  )
}

const basenameOf = (path: string): string => path.split('/').pop() ?? path

function isDependencyLine(name: string, line: string): boolean {
  if (name === 'package.json') {
    const key = PACKAGE_JSON_LINE.exec(line)?.[1]
    return key !== undefined && !NON_DEPENDENCY_KEYS.has(key)
  }
  if (REQUIREMENTS_FILE.test(name)) return REQUIREMENTS_LINE.test(line.trim())
  if (name === 'pyproject.toml') {
    if (PYPROJECT_LIST_LINE.test(line)) return true
    const key = PYPROJECT_TABLE_LINE.exec(line)?.[1]
    return key !== undefined && !NON_DEPENDENCY_KEYS.has(key)
  }
  return false
}

const copies = (path: string, count: number): Item[] => Array.from({ length: count }, () => ({ path }))

// New dependencies and the personal-data shapes, one item per occurrence in the lines the branch added.
function dataSignals(facts: BranchFacts): Pick<Signals, 'newDependencies' | 'email' | 'phone' | 'iban'> {
  const found = { newDependencies: [] as Item[], email: [] as Item[], phone: [] as Item[], iban: [] as Item[] }
  for (const change of facts.changes) {
    const name = basenameOf(change.path)
    for (const line of change.addedLines) {
      if (isDependencyLine(name, line)) found.newDependencies.push({ path: change.path })
      found.email.push(...copies(change.path, [...line.matchAll(EMAIL)].length))
      found.phone.push(...copies(change.path, [...line.matchAll(PHONE)].length))
      found.iban.push(...copies(change.path, [...line.matchAll(IBAN_CANDIDATE)].filter(match => isIban(match[0])).length))
    }
  }
  return found
}

export function weakeningSignals(facts: BranchFacts): Signals {
  const base = new Set(facts.baseFiles)
  const setup = new Set(facts.setupPaths ?? [])
  const deletedTests: Item[] = []
  const skipMarkers: Item[] = []
  const runnerConfigEdits: Item[] = []
  const setupEdits: Item[] = []
  for (const change of facts.changes) {
    const { path } = change
    // Only a test at the merge base is an existing test: one the branch added and later deleted is absent from the net change.
    if (change.status === 'deleted' && base.has(path) && isTestFile(path, facts.runnerPaths)) {
      const deletion = facts.deletions.find(item => item.path === path)
      deletedTests.push(isAuthorized(facts.specText, path, deletion) ? { path, authorized: true } : { path })
    }
    if (RUNNER_CONFIG.test(path)) runnerConfigEdits.push({ path })
    if (SETUP_FILE.test(path) || setup.has(path)) setupEdits.push({ path })
    const isExisting = (change.status === 'modified' || change.status === 'renamed') && base.has(change.from ?? path)
    if (isExisting && isTestFile(path, facts.runnerPaths)) {
      for (const line of change.addedLines) {
        if (SKIP_MARKERS.some(marker => marker.test(line))) skipMarkers.push({ path })
      }
    }
  }
  return { deletedTests, skipMarkers, runnerConfigEdits, setupEdits, ...dataSignals(facts) }
}

const LABELS: readonly (readonly [keyof Signals, string])[] = [
  ['deletedTests', 'deleted test files'],
  ['skipMarkers', 'new skip markers'],
  ['runnerConfigEdits', 'runner configuration edits'],
  ['setupEdits', 'setup file edits'],
  ['newDependencies', 'new dependencies'],
  ['email', 'e-mail address shapes'],
  ['phone', 'phone number shapes'],
  ['iban', 'IBAN shapes'],
]

const uniquePaths = (items: Item[]): string[] => [...new Set(items.map(item => item.path))].sort()
const authorizedNote = (items: Item[]): string => {
  const count = items.filter(item => item.authorized === true).length
  return count > 0 ? `, ${count} authorized by the spec` : ''
}

// The push dialog's text: a count and the paths of each signal. A path is shown as it is; a matched value never.
export function signalsLine(signals: Signals | 'not scanned'): string {
  if (signals === 'not scanned') return 'Test-weakening signals and counts: not scanned (the branch could not be read). Nothing is blocked.'
  const parts = LABELS.flatMap(([key, label]) => {
    const items = signals[key]
    return items.length === 0 ? [] : [`${label}: ${items.length}${authorizedNote(items)} (${uniquePaths(items).join(', ')})`]
  })
  if (parts.length === 0) return 'Test-weakening signals and counts: none found. Nothing is blocked.'
  return `Test-weakening signals and counts (nothing is blocked): ${parts.join('; ')}.`
}

// Markdown for test.md: counts and paths, no line of code.
export function testRecordSection(signals: Signals): string {
  const lines = ['## Test-weakening signals', '', 'Counts and paths of the branch against its merge base. No line of code. Nothing is blocked.', '']
  let isAny = false
  for (const [key, label] of LABELS) {
    const items = signals[key]
    if (items.length === 0) continue
    isAny = true
    lines.push(`- ${label}: ${items.length}${authorizedNote(items)}`)
    for (const path of uniquePaths(items)) {
      lines.push(`  - ${path}${items.some(item => item.path === path && item.authorized === true) ? ' (authorized by the spec)' : ''}`)
    }
  }
  if (!isAny) lines.push('No signals found.')
  return `${lines.join('\n')}\n`
}

// The change reviewer gets the same counts and paths as the test record.
export function reviewerInput(signals: Signals): string {
  return testRecordSection(signals)
}
