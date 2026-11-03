import { expect, test } from 'claude-code/testing'
import type { PhaseName, Run, TraceRow } from '../types'
import {
  FILES,
  GATES,
  PHASES,
  SKILLS,
  TEXTS,
  TURN_CAPS,
  acResults,
  afterStatus,
  approve,
  CRITERION_CHARS,
  CRITERION_LINES,
  bandLine,
  bandParts,
  bandTail,
  bandText,
  criterionTexts,
  phaseMark,
  changeIdFrom,
  countTurn,
  criteriaOf,
  freeformId,
  frontMatterValue,
  highRiskItems,
  isRequestFile,
  ticketLink,
  highRiskUnanswered,
  goalFor,
  isActive,
  isBranchName,
  newRun,
  nextAction,
  offer,
  outOfScopeOf,
  parseArgs,
  requestFileParts,
  requestTitle,
  phaseStatus,
  rerun,
  restored,
  stop,
  testPathsFrom,
  traceParts,
  traceRows,
  pointCounts,
  pointLines,
  undecidedPoints,
} from './phases'

const NOW = Date.UTC(2026, 9, 29, 18, 5)

const phaseAt = (name: PhaseName) => PHASES.indexOf(name)

const ENV = { claudeCode: '2.1.314', plugin: '0.1.0', provider: 'anthropic', permissionMode: 'default' }

function runAt(overrides: Partial<Run> = {}): Run {
  return {
    ...newRun({ id: 'ABC-43224', input: 'ABC-43224', source: 'jira', base: 'main', now: NOW, env: ENV }),
    ...overrides,
  }
}

function approval(phase: PhaseName) {
  return { phase, file: FILES[phase], sha256: 'abc', at: NOW }
}

test('constants hold the phases', () => {
  expect(PHASES).toEqual(['Intent', 'Spec', 'Plan', 'Build', 'Test', 'PR'])
  expect([...GATES]).toEqual(['Intent', 'Spec', 'Plan'])
  expect(FILES).toEqual({
    Intent: 'intent.md',
    Spec: 'spec.md',
    Plan: 'plan.md',
    Build: 'build.md',
    Test: 'test.md',
    PR: 'pr.md',
  })
  expect(SKILLS).toEqual({
    Intent: 'write-intent',
    Spec: 'write-spec',
    Plan: 'plan-change',
    Build: 'build-change',
    Test: 'test-change',
    PR: 'open-pr',
  })
  expect(TURN_CAPS).toEqual({ Intent: 10, Spec: 15, Plan: 20, Build: 40, Test: 25, PR: 60 })
})

test('changeIdFrom reads a Jira key or browse URL', () => {
  const jira = { id: 'ABC-43224', source: 'jira' }
  expect(changeIdFrom('https://jira.example.com/browse/ABC-43224', NOW)).toEqual(jira)
  expect(changeIdFrom('https://jira.example.com/browse/ABC-43224?focusedCommentId=1#x', NOW)).toEqual(jira)
  expect(changeIdFrom('https://jira.example.com/browse/ABC-43224/', NOW)).toEqual(jira)
  expect(changeIdFrom('  abc-43224 ', NOW)).toEqual(jira)
})

test('changeIdFrom slugs free text', () => {
  const free = (id: string) => ({ id, source: 'freeform' })
  expect(changeIdFrom('Add a CSV export to the broker list', NOW)).toEqual(free('CH-20261029-add-a-csv-export-to-the-broker'))
  expect(changeIdFrom('Fix the bug in ABC-43224', NOW)).toEqual(free('CH-20261029-fix-the-bug-in-abc-43224'))
  expect(changeIdFrom('Implement customer notification preferences quickly', NOW)).toEqual(free('CH-20261029-implement-customer'))
  expect(changeIdFrom('Supercalifragilisticexpialidociousness', NOW)).toEqual(free('CH-20261029-supercalifragilisticexpialidoc'))
  expect(changeIdFrom('Ändere den Export für Makler', NOW)).toEqual(free('CH-20261029-aendere-den-export-fuer-makler'))
})

test('changeIdFrom keeps requests that share their first four words apart, and gives one request one ID', () => {
  const formats = changeIdFrom('Add a function that formats dates', NOW).id
  const rounds = changeIdFrom('Add a function that rounds amounts', NOW).id
  expect(formats).toBe('CH-20261029-add-a-function-that-formats')
  expect(rounds).toBe('CH-20261029-add-a-function-that-rounds')
  expect(changeIdFrom('Add a function that formats dates', NOW).id).toBe(formats)
})

test('changeIdFrom treats a board URL as free text', () => {
  const r = changeIdFrom('https://jira.example.com/secure/RapidBoard.jspa?selectedIssue=ABC-43224', NOW)
  expect(r.source).toBe('freeform')
  expect(r.id.startsWith('CH-20261029-')).toBe(true)
})

test('changeIdFrom falls back to the UTC time without words', () => {
  expect(changeIdFrom('!!!', NOW)).toEqual({ id: 'CH-20261029-1805', source: 'freeform' })
  expect(changeIdFrom('!!!', Date.UTC(2026, 9, 29, 23, 30))).toEqual({ id: 'CH-20261029-2330', source: 'freeform' })
})

test('changeIdFrom counts a bare utf-8 as a key', () => {
  expect(changeIdFrom('utf-8', NOW)).toEqual({ id: 'UTF-8', source: 'jira' })
})

test('phaseStatus reads the front matter status', () => {
  expect(phaseStatus('---\nphase: spec\nstatus: done\n---\n# Spec')).toBe('done')
  expect(phaseStatus('---\r\nphase: spec\r\nstatus: done\r\n---\r\n')).toBe('done')
  expect(phaseStatus('---\nstatus: "done"\n---')).toBe('done')
  expect(phaseStatus("---\nstatus: 'done'\n---")).toBe('done')
  expect(phaseStatus('---\nstatus: done   \n---')).toBe('done')
  expect(phaseStatus('---\nstatus: blocked\n---')).toBe('blocked')
  expect(phaseStatus('---\nstatus: draft\n---')).toBe('draft')
  expect(phaseStatus('\uFEFF---\nstatus: done\n---')).toBe('done')
})

test('phaseStatus gives undefined when the front matter does not say', () => {
  expect(phaseStatus('---\nphase: spec\n---\nstatus: done')).toBeUndefined()
  expect(phaseStatus('---\n  status: done\n---')).toBeUndefined()
  expect(phaseStatus('---\nstatus: done\nno closing line')).toBeUndefined()
  expect(phaseStatus('# Spec\nstatus: done')).toBeUndefined()
  expect(phaseStatus('---\nstatus: finished\n---')).toBeUndefined()
})

test('frontMatterValue returns a trimmed, unquoted value', () => {
  expect(frontMatterValue('---\npr-url: "https://x/y"\n---', 'pr-url')).toBe('https://x/y')
  expect(frontMatterValue('---\nchecks: passed\n---', 'missing')).toBeUndefined()
})

test('testPathsFrom reads the test-paths line', () => {
  const plan = '---\nstatus: done\ntest-paths: tests/test_ac1.py tests/test_ac2.py\n---\n'
  expect(testPathsFrom(plan)).toEqual(['tests/test_ac1.py', 'tests/test_ac2.py'])
  expect(testPathsFrom('---\nstatus: done\n---\n')).toEqual([])
})

test('goalFor names the skill, folder, file, front matter and cap, within 500 characters', () => {
  const longest = 'CH-20261029-' + 'a'.repeat(30)
  for (const phase of PHASES) {
    for (const id of ['ABC-43224', longest]) {
      const goal = goalFor(phase, id)
      expect(goal).toContain(`goal-and-do:${SKILLS[phase]}`)
      expect(goal).toContain(`changes/${id}/`)
      expect(goal).toContain(FILES[phase])
      expect(goal).toContain('front matter')
      expect(goal).toContain('status: done')
      expect(goal).toContain('status: blocked')
      expect(goal).toContain('Show the front matter')
      expect(goal).toContain(`Stop after ${TURN_CAPS[phase]} turns`)
      expect(goal.length <= 500).toBe(true)
    }
  }
  expect(goalFor('PR', 'ABC-43224')).toContain('none when origin is not GitHub')
})

test('goalFor gives the Intent and Spec goals as written', () => {
  expect(goalFor('Intent', 'ABC-1')).toBe(
    'Write the intent changes/ABC-1/intent.md with the goal-and-do:write-intent skill, from request.md beside it. Done when its front matter says status: done and it has Problem, Outcome, Business acceptance criteria (BAC-1 to BAC-n), Users, Constraints, and Open questions sections, or status: blocked with the reason under Open questions. Show the front matter and the section headings as your last step. Stop after 10 turns.'
  )
  expect(goalFor('Spec', 'ABC-1')).toBe(
    'Write the spec changes/ABC-1/spec.md with the goal-and-do:write-spec skill, from intent.md beside it. Done when spec.md has, in its front matter, status: done with acceptance criteria AC-1 to AC-n and an Open points section, or status: blocked with the reason under Open points. Show the front matter as your last step. Stop after 15 turns.'
  )
})

test("the Intent and Spec goals stay readable, as ProposeGoal's 500", () => {
  for (const phase of ['Intent', 'Spec'] as const) {
    expect(goalFor(phase, 'ABC-1').length).toBeLessThan(500)
  }
})

test('parseArgs separates subcommands from a start', () => {
  expect(parseArgs('next')).toEqual({ kind: 'next' })
  expect(parseArgs(' Next ')).toEqual({ kind: 'next' })
  expect(parseArgs('status')).toEqual({ kind: 'status' })
  expect(parseArgs('allow')).toEqual({ kind: 'allow' })
  expect(parseArgs('allow local')).toEqual({ kind: 'allow local' })
  expect(parseArgs('stop')).toEqual({ kind: 'stop' })
  expect(parseArgs('Stop sending duplicate emails')).toEqual({ kind: 'start', input: 'Stop sending duplicate emails' })
  expect(parseArgs('Allow brokers to export CSV')).toEqual({ kind: 'start', input: 'Allow brokers to export CSV' })
  expect(parseArgs('ABC-43224')).toEqual({ kind: 'start', input: 'ABC-43224' })
  expect(parseArgs('')).toEqual({ kind: 'usage' })
  // next and status take no more words, so a typed `next reruns Intent` starts no run.
  expect(parseArgs('next reruns Intent')).toEqual({ kind: 'subcommand words' })
  expect(parseArgs('Next   steps for the export')).toEqual({ kind: 'subcommand words' })
  expect(parseArgs('status of the export')).toEqual({ kind: 'subcommand words' })
  // --base <branch> comes first; what follows is the request, a word such as next included.
  expect(parseArgs('--base feat/goal-and-do ABC-43224')).toEqual({ kind: 'start', input: 'ABC-43224', base: 'feat/goal-and-do' })
  expect(parseArgs('  --base  release/1.2   Stop sending  duplicate emails ')).toEqual({
    kind: 'start',
    input: 'Stop sending  duplicate emails',
    base: 'release/1.2',
  })
  // A subcommand's word or nothing after the branch, --base anywhere else, or --base=: no run starts.
  for (const args of [
    '--base main next',
    '--base main Status',
    '--base main allow  local',
    '--base main stop',
    '--base main',
    '--base',
    'ABC-1 --base main',
    'https://jira.example.com/browse/ABC-1 --base x',
    'ABC-1 --base=main',
    '--base=main ABC-1',
  ]) {
    expect(parseArgs(args), args).toEqual({ kind: 'misplaced base' })
  }
  // After a subcommand's word or a request file's path, --base is misplaced too.
  for (const args of [
    'next --base main',
    'Status --base main',
    'allow --base main',
    'allow local --base main',
    'stop --base=main',
    'docs/req.md --base dev',
    'README.md --base=dev',
  ]) {
    expect(parseArgs(args), args).toEqual({ kind: 'misplaced base' })
  }
  // Anywhere else --base is plain text.
  expect(parseArgs('Fix it --base dev')).toEqual({ kind: 'start', input: 'Fix it --base dev' })
  expect(parseArgs('Document the --base option')).toEqual({ kind: 'start', input: 'Document the --base option' })
  expect(parseArgs('Fix --base=main parsing')).toEqual({ kind: 'start', input: 'Fix --base=main parsing' })
  expect(parseArgs('--base main next steps for the export')).toEqual({ kind: 'start', input: 'next steps for the export', base: 'main' })
  expect(parseArgs('--basement leaks')).toEqual({ kind: 'start', input: '--basement leaks' })
  expect(parseArgs('   ')).toEqual({ kind: 'usage' })
})

test('newRun starts the first phase with the goal pending, in schema 2', () => {
  const run = runAt()
  expect(run.schema).toBe(2)
  expect(run.phase).toBe(0)
  expect(PHASES[run.phase]).toBe('Intent')
  expect(run.state).toBe('running')
  expect(run.pendingGoal).toBe(true)
  expect(run.goalActive).toBe(false)
  expect(run.startedAt).toBe(NOW)
  expect(run.usage).toEqual({ schema: 'usage-1', rows: {} })
  expect(isActive(run)).toBe(true)
})

test('isActive is true for the five live states only', () => {
  for (const state of ['running', 'gate', 'blocked', 'capped', 'interrupted'] as const) {
    expect(isActive(runAt({ state }))).toBe(true)
  }
  for (const state of ['stopped', 'finished'] as const) {
    expect(isActive(runAt({ state }))).toBe(false)
  }
  expect(isActive(null)).toBe(false)
})

test('the run walks through all phases', () => {
  let run = runAt({ phase: phaseAt('Intent'), goalActive: true, pendingGoal: false })

  run = afterStatus(run, 'done')
  expect(run.state).toBe('gate')
  expect(run.phase).toBe(phaseAt('Intent'))
  expect(run.goalActive).toBe(false)

  run = approve(run, approval('Intent'))
  expect(run.state).toBe('running')
  expect(run.phase).toBe(phaseAt('Spec'))
  expect(run.pendingGoal).toBe(true)
  expect(run.turns).toBe(0)
  expect(run.approvals.length).toBe(1)

  run = afterStatus(run, 'done')
  expect(run.state).toBe('gate')
  expect(run.phase).toBe(phaseAt('Spec'))
  expect(run.goalActive).toBe(false)

  run = approve(run, approval('Spec'))
  expect(run.state).toBe('running')
  expect(run.phase).toBe(phaseAt('Plan'))
  expect(run.pendingGoal).toBe(true)
  expect(run.turns).toBe(0)
  expect(run.approvals.length).toBe(2)

  run = afterStatus(run, 'done')
  expect(run.state).toBe('gate')
  expect(run.phase).toBe(phaseAt('Plan'))

  const lock = { lockedAt: 'abc123', lockedFiles: { 'tests/a.py': 'h1' }, testPaths: ['tests/a.py'] }
  run = approve(run, { ...approval('Plan'), lockedAt: 'abc123' }, lock)
  expect(run.state).toBe('running')
  expect(run.phase).toBe(phaseAt('Build'))
  expect(run.lockedAt).toBe('abc123')
  expect(run.lockedFiles).toEqual({ 'tests/a.py': 'h1' })
  expect(run.testPaths).toEqual(['tests/a.py'])
  expect(run.approvals.length).toBe(3)

  run = afterStatus(run, 'done')
  expect(run.state).toBe('running')
  expect(run.phase).toBe(phaseAt('Test'))
  expect(run.pendingGoal).toBe(true)

  run = afterStatus(run, 'done')
  expect(run.state).toBe('running')
  expect(run.phase).toBe(phaseAt('PR'))

  run = afterStatus(run, 'done')
  expect(run.state).toBe('finished')
  expect(run.phase).toBe(phaseAt('PR'))
  expect(isActive(run)).toBe(false)
})

test('afterStatus blocks on blocked, draft and a missing status', () => {
  expect(afterStatus(runAt({ phase: phaseAt('Spec') }), 'blocked', 'needs a decision')).toMatchObject({
    state: 'blocked',
    reason: 'needs a decision',
  })
  expect(afterStatus(runAt({ phase: phaseAt('Spec') }), 'draft', 'the goal ended without status: done: x')).toMatchObject({
    state: 'blocked',
    reason: 'the goal ended without status: done: x',
  })
  expect(afterStatus(runAt({ phase: phaseAt('Spec') }), undefined, 'no front matter')).toMatchObject({
    state: 'blocked',
    reason: 'no front matter',
  })
})

test('afterStatus acts on running only', () => {
  for (const state of ['gate', 'blocked', 'capped', 'interrupted', 'stopped', 'finished'] as const) {
    const run = runAt({ state })
    expect(afterStatus(run, 'done')).toEqual(run)
  }
})

test('countTurn counts, then caps at the phase limit', () => {
  let run = runAt({ phase: phaseAt('Spec') })
  run = countTurn(run)
  expect(run.turns).toBe(1)
  expect(run.state).toBe('running')
  run = countTurn(runAt({ phase: phaseAt('Spec'), turns: TURN_CAPS.Spec - 1 }))
  expect(run.turns).toBe(TURN_CAPS.Spec)
  expect(run.state).toBe('capped')
  expect(countTurn(runAt({ phase: phaseAt('Intent'), turns: TURN_CAPS.Intent - 1 })).state).toBe('capped')
  expect(TURN_CAPS.Intent).toBe(10)
  const build = countTurn(runAt({ phase: phaseAt('Build'), turns: TURN_CAPS.Build - 1 }))
  expect(build.state).toBe('capped')
  expect(countTurn(runAt({ phase: phaseAt('Build'), turns: TURN_CAPS.Build - 2 })).state).toBe('running')
  const gate = runAt({ state: 'gate', turns: 3 })
  expect(countTurn(gate)).toEqual(gate)
})

test('approve changes nothing outside the gate', () => {
  for (const state of ['running', 'blocked', 'capped', 'interrupted', 'stopped', 'finished'] as const) {
    const run = runAt({ state })
    expect(approve(run, approval('Spec'))).toEqual(run)
  }
})

test('rerun restarts the phase from blocked, capped and interrupted', () => {
  for (const state of ['blocked', 'capped', 'interrupted'] as const) {
    const run = rerun(runAt({ state, phase: phaseAt('Build'), turns: 40, reason: 'x', goalActive: false, pendingGoal: false }))
    expect(run.state).toBe('running')
    expect(run.pendingGoal).toBe(true)
    expect(run.turns).toBe(0)
    expect(run.phase).toBe(phaseAt('Build'))
    expect(run.reruns).toEqual({ Build: 1 })
    expect(run.reason).toBeUndefined()
  }
  const twice = rerun(runAt({ state: 'blocked', phase: phaseAt('Spec'), reruns: { Spec: 1 } }))
  expect(twice.reruns).toEqual({ Spec: 2 })
  const running = runAt()
  expect(rerun(running)).toEqual(running)
})

test('stop ends the run and asks for the goal to be cleared', () => {
  const run = stop(runAt({ goalActive: true }))
  expect(run.state).toBe('stopped')
  expect(run.pendingClear).toBe(true)
  expect(run.pendingGoal).toBe(false)
  expect(isActive(run)).toBe(false)
})

test('restored interrupts a running run and leaves the rest', () => {
  const running = restored(runAt({ goalActive: true }))
  expect(running.state).toBe('interrupted')
  expect(running.goalActive).toBe(false)
  for (const state of ['gate', 'blocked', 'capped', 'interrupted', 'stopped', 'finished'] as const) {
    const run = runAt({ state })
    expect(restored(run)).toEqual(run)
  }
})

test('offer adds rules once', () => {
  const run = offer(offer(runAt(), ['Bash(git status)']), ['Bash(git status)', 'Bash(npm test)'])
  expect(run.offered).toEqual(['Bash(git status)', 'Bash(npm test)'])
})

test('nextAction follows the run state', () => {
  expect(nextAction(runAt({ state: 'gate' }))).toBe('gate-dialog')
  for (const state of ['blocked', 'capped', 'interrupted'] as const) {
    expect(nextAction(runAt({ state }))).toBe('rerun')
  }
  expect(nextAction(runAt({ state: 'running', goalActive: true }))).toBe('refuse-goal-running')
  expect(nextAction(runAt({ state: 'running', goalActive: false, pendingGoal: true }))).toBe('start-pending')
  expect(nextAction(runAt({ state: 'running', goalActive: false, pendingGoal: false }))).toBe('start-pending')
  expect(nextAction(runAt({ state: 'finished' }))).toBe('refuse-finished')
  expect(nextAction(runAt({ state: 'stopped' }))).toBe('refuse-stopped')
  expect(nextAction(null)).toBe('no-run')
})

const MARKS = '✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR'

// The goal turn's clock, started the given minutes before NOW.
const clockOf = (minutes: number) => ({ startedAt: NOW - minutes * 60_000, now: NOW })

const tokensOf = (input: number) => ({
  schema: 'usage-1' as const,
  rows: { Spec: { models: { m: { input, output: 0, cacheRead: 0, cacheWrite: 0 } }, turns: 1, ms: 1 } },
})

test('bandText shows marks, the goal turn with its minutes and the state at full width', () => {
  const run = runAt({ phase: phaseAt('Build'), turns: 2, goalActive: true, usage: tokensOf(21_000) })
  expect(bandText(run, 120, clockOf(12))).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR    turn 3/40 · 12 min · working')
  const plan = runAt({ phase: phaseAt('Plan'), usage: tokensOf(1_200_000) })
  expect(bandText(plan, 120, clockOf(0))).toBe(`${MARKS}    turn 1/20 · 0 min · working`)
})

test('bandText has no run ID, at any width and in any state', () => {
  const id = 'ABC-43224'
  const states: Partial<Run>[] = [
    { state: 'running' },
    { state: 'gate' },
    { state: 'blocked' },
    { state: 'capped' },
    { state: 'interrupted' },
    { state: 'finished' },
  ]
  for (const overrides of states) {
    for (const columns of [40, 60, 80, 120, 200]) {
      const run = runAt({ id, phase: phaseAt('Build'), prUrl: 'https://github.example.com/o/r/pull/485', ...overrides })
      // The blocked text names the change folder, which holds the ID.
      const text = bandText(run, columns, clockOf(12)).replace(`changes/${id}/`, '')
      expect(text, `${overrides.state} at ${columns}`).not.toContain(id)
    }
  }
  expect(
    bandParts(runAt({ phase: phaseAt('Build') }), 200, clockOf(1))
      .flat()
      .some(part => part.text === 'ABC-43224')
  ).toBe(false)
})

test('bandText counts the goal turn against the phase cap and shows the turn part only while running or capped', () => {
  for (const phase of PHASES) {
    const run = runAt({ phase: phaseAt(phase), turns: 1 })
    expect(bandText(run, 200, clockOf(5)), phase).toContain(`   turn 2/${TURN_CAPS[phase]} · 5 min · working`)
  }
  const capped = runAt({ phase: phaseAt('Test'), state: 'capped', turns: 25 })
  expect(bandText(capped, 200, clockOf(30))).toBe(
    '✔ INTENT  ✔ SPEC  ✔ PLAN  ✔ BUILD  ✖ TEST  PR    turn 25/25 · 30 min · out of turns: /goal-and-do next reruns Test'
  )
  for (const state of ['gate', 'blocked', 'interrupted', 'finished'] as const) {
    const text = bandText(runAt({ phase: phaseAt('Build'), state, turns: 3 }), 200, clockOf(12))
    expect(text, state).not.toContain('turn ')
    expect(text, state).not.toContain(' min')
  }
  const gate = runAt({ phase: phaseAt('Plan'), state: 'gate' })
  expect(bandText(gate, 120, clockOf(12))).toBe('✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR    waiting: approve Plan with /goal-and-do next')
  expect(bandText(gate, 110, clockOf(12))).toBe('✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR    waiting: approve Plan with /goal-and-do next')
})

test('bandText leaves the minutes out without a goal turn clock', () => {
  const run = runAt({ phase: phaseAt('Build'), usage: tokensOf(842) })
  expect(bandText(run, 200)).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR    turn 0/40 · working')
  expect(bandText(run, 200)).not.toContain(' min')
  expect(bandText(runAt({ phase: phaseAt('Plan'), turns: 4 }), 200)).toContain('   turn 4/20 · working')
  expect(bandText(runAt({ phase: phaseAt('Plan'), state: 'capped', turns: 20 }), 200)).toContain('   turn 20/20 · out of turns')
})

test('bandText floors the minutes and never counts backwards', () => {
  const run = runAt({ phase: phaseAt('Build') })
  expect(bandText(run, 200, { startedAt: NOW - 119_999, now: NOW })).toContain('turn 1/40 · 1 min · working')
  expect(bandText(run, 200, { startedAt: NOW + 60_000, now: NOW })).toContain('turn 1/40 · 0 min · working')
})

test('bandText stays on one line: it leaves out the PR number, then a plain working; else the whole tail goes to line 2', () => {
  const run = runAt({ phase: phaseAt('Build'), turns: 2, prUrl: 'https://github.example.com/o/r/pull/485' })
  const marks = '✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR'
  const full = bandText(run, 200, clockOf(12))
  expect(full).toBe(`${marks}    turn 3/40 · 12 min · working · PR #485`)
  const noPr = bandText(run, full.length - 1, clockOf(12))
  expect(noPr).toBe(`${marks}    turn 3/40 · 12 min · working`)
  const short = bandText(run, noPr.length - 1, clockOf(12))
  expect(short).toBe(`${marks}    turn 3/40 · 12 min`)
  // One column less: the turn and the minutes stay, with the whole tail, on line 2.
  expect(bandText(run, short.length - 1, clockOf(12)).split('\n')).toEqual([marks, 'turn 3/40 · 12 min · working · PR #485'])
  expect(
    bandParts(run, noPr.length, clockOf(12))
      .flat()
      .some(part => part.text === 'PR #485')
  ).toBe(false)
  expect(
    bandParts(run, 200, clockOf(12))
      .flat()
      .find(part => part.text === 'PR #485')
  ).toEqual({ text: 'PR #485', color: 'suggestion' })
})

test('bandText keeps the draft PR number after the state', () => {
  const run = runAt({ phase: phaseAt('PR'), turns: 6, prUrl: 'https://github.example.com/o/r/pull/485', usage: tokensOf(21_000) })
  expect(bandText(run, 200, clockOf(12))).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ✔ BUILD  ✔ TEST  ● PR    turn 7/60 · 12 min · working · PR #485')
  const gate = runAt({ phase: phaseAt('Plan'), state: 'gate', prUrl: 'https://github.example.com/o/r/pull/485' })
  expect(bandText(gate, 200)).toContain('next · PR #485')
})

test('bandText shows no token count; the pane has them per phase', () => {
  expect(bandText(runAt({ usage: tokensOf(12_345) }), 200)).not.toContain('tokens')
  expect(bandText(runAt({ phase: phaseAt('Plan'), state: 'gate', usage: tokensOf(842) }), 200)).not.toContain('tokens')
})

test('bandText shows each state text and marks', () => {
  const at = (overrides: Partial<Run>) => bandText(runAt(overrides), 200, clockOf(1))
  expect(at({})).toContain(' · working')
  expect(at({ state: 'gate', phase: phaseAt('Plan') })).toContain('waiting: approve Plan with /goal-and-do next')
  expect(at({ state: 'gate', phase: phaseAt('Plan') })).toContain('✔ SPEC  ● PLAN  BUILD')
  expect(at({ state: 'gate', phase: phaseAt('Intent') })).toContain('waiting: approve Intent with /goal-and-do next')
  expect(at({ state: 'gate', phase: phaseAt('Intent') })).toContain('● INTENT  SPEC')

  const blocked = at({ state: 'blocked', phase: phaseAt('Build') })
  expect(blocked).toContain('stuck: see build.md, then type /goal-and-do next')
  expect(blocked).toContain('✔ PLAN  ✖ BUILD  TEST')

  const capped = at({ state: 'capped', phase: phaseAt('Test') })
  expect(capped).toContain('out of turns: /goal-and-do next reruns Test')
  expect(capped).toContain('✖ TEST')

  const interrupted = at({ state: 'interrupted', phase: phaseAt('PR') })
  expect(interrupted).toContain('interrupted: /goal-and-do next reruns PR')
  expect(interrupted).toContain('● PR')

  const finished = at({ state: 'finished', phase: phaseAt('PR') })
  expect(finished).toContain('✔ INTENT  ✔ SPEC  ✔ PLAN  ✔ BUILD  ✔ TEST  ✔ PR')
  expect(finished).toMatch(/   finished$/)

  expect(at({ state: 'stopped' })).toBe('')
})

test('bandParts joins to bandText exactly, in every state and at every width', () => {
  const states: Partial<Run>[] = [
    { state: 'running', phase: phaseAt('Intent') },
    { state: 'running', phase: phaseAt('Spec') },
    { state: 'running', phase: phaseAt('Build'), prUrl: 'https://github.example.com/o/r/pull/485' },
    { state: 'gate', phase: phaseAt('Intent') },
    { state: 'gate', phase: phaseAt('Spec') },
    { state: 'gate', phase: phaseAt('Plan') },
    { state: 'blocked', phase: phaseAt('Build') },
    { state: 'capped', phase: phaseAt('Test') },
    { state: 'interrupted', phase: phaseAt('Build') },
    { state: 'finished', phase: phaseAt('PR') },
    { state: 'stopped', phase: phaseAt('Plan') },
    { id: 'CH-20261029-stop-sending-duplicate-emails', state: 'blocked', phase: phaseAt('PR') },
  ]
  for (const overrides of states) {
    for (const columns of [20, 40, 49, 54, 60, 80, 100, 120, 200]) {
      for (const clock of [undefined, clockOf(12)]) {
        const run = runAt(overrides)
        const joined = bandParts(run, columns, clock)
          .map(line => line.map(part => part.text).join(''))
          .join('\n')
        expect(joined, `${JSON.stringify(overrides)} at ${columns}`).toBe(bandText(run, columns, clock))
      }
    }
  }
})

test('bandParts colors the marks, arrows, turn and state with theme keys', () => {
  const parts = (overrides: Partial<Run>) => bandParts(runAt(overrides), 120, clockOf(12)).flat()
  const find = (overrides: Partial<Run>, text: string) => parts(overrides).find(part => part.text === text)
  expect(find({ phase: phaseAt('Build') }, '● BUILD')).toEqual({ text: '● BUILD', color: 'claude', bold: true })
  expect(find({ phase: phaseAt('Build') }, '✔ SPEC')).toEqual({ text: '✔ SPEC', color: 'success' })
  expect(find({ phase: phaseAt('Build') }, 'TEST')).toEqual({ text: 'TEST', color: 'inactive', dim: true })
  expect(find({ phase: phaseAt('Build'), state: 'blocked' }, '✖ BUILD')).toEqual({ text: '✖ BUILD', color: 'error', bold: true })
  expect(find({ phase: phaseAt('Test'), state: 'capped' }, '✖ TEST')?.color).toBe('error')
  // Two spaces between the phases, in no color.
  expect(find({ phase: phaseAt('Build') }, '  ')).toEqual({ text: '  ' })
  expect(parts({ phase: phaseAt('Build') }).some(part => part.text.includes('→'))).toBe(false)
  expect(find({ phase: phaseAt('Build') }, 'turn 1/40')?.color).toBe('subtle')
  expect(find({ phase: phaseAt('Build') }, '12 min')?.color).toBe('subtle')
  expect(parts({ phase: phaseAt('Build') }).some(part => part.text.includes('tokens'))).toBe(false)
  expect(find({ phase: phaseAt('Build') }, 'working')?.color).toBe('suggestion')
  expect(parts({ state: 'gate', phase: phaseAt('Spec') }).find(part => part.text.startsWith('waiting'))?.color).toBe('warning')
  expect(parts({ phase: phaseAt('Build'), state: 'blocked' }).find(part => part.text.startsWith('stuck'))?.color).toBe('error')
  expect(parts({ phase: phaseAt('Build'), state: 'capped' }).find(part => part.text.startsWith('out of turns'))?.color).toBe('error')
  expect(parts({ phase: phaseAt('Build'), state: 'interrupted' }).find(part => part.text.startsWith('interrupted'))?.color).toBe('warning')
  expect(find({ phase: phaseAt('PR'), state: 'finished' }, 'finished')?.color).toBe('success')
  expect(bandParts(runAt({ state: 'stopped' }), 120, clockOf(1))).toEqual([])
})

test('the band shows a phase not reached yet by its name alone and keeps the other marks', () => {
  const texts = (overrides: Partial<Run>) =>
    bandParts(runAt(overrides), 200, clockOf(1))
      .flat()
      .map(part => part.text)
      .filter(text => !text.includes('→') && PHASES.some(name => text.endsWith(name.toUpperCase())))
  expect(texts({ phase: phaseAt('Build') })).toEqual(['✔ INTENT', '✔ SPEC', '✔ PLAN', '● BUILD', 'TEST', 'PR'])
  expect(texts({ phase: phaseAt('Build'), state: 'blocked' })).toEqual(['✔ INTENT', '✔ SPEC', '✔ PLAN', '✖ BUILD', 'TEST', 'PR'])
  expect(texts({ phase: phaseAt('Test'), state: 'capped' })).toEqual(['✔ INTENT', '✔ SPEC', '✔ PLAN', '✔ BUILD', '✖ TEST', 'PR'])
  expect(texts({ phase: phaseAt('PR'), state: 'finished' })).toEqual(['✔ INTENT', '✔ SPEC', '✔ PLAN', '✔ BUILD', '✔ TEST', '✔ PR'])
  expect(bandText(runAt({ phase: phaseAt('Intent') }), 200)).not.toContain('○')
  expect(bandText(runAt({ phase: phaseAt('Intent') }), 200)).toContain('● INTENT  SPEC  PLAN  BUILD  TEST  PR')
})

test('phaseMark gives each phase its mark and color', () => {
  const run = runAt({ phase: phaseAt('Build') })
  expect(PHASES.map((_, i) => phaseMark(run, i).mark)).toEqual(['✔', '✔', '✔', '●', '○', '○'])
  expect(phaseMark(run, phaseAt('Build'))).toEqual({ mark: '●', color: 'claude', bold: true })
  expect(phaseMark(runAt({ state: 'gate', phase: phaseAt('Spec') }), phaseAt('Spec'))).toEqual({ mark: '●', color: 'warning', bold: true })
})

test('bandText wraps to two lines and never exceeds the columns', () => {
  const longest = 'CH-20261029-' + 'a'.repeat(30)
  const states = [
    { state: 'running', start: 'turn 2/20', phase: phaseAt('Plan') },
    { state: 'running', start: 'working', phase: phaseAt('Intent') },
    { state: 'gate', start: 'waiting: approve Plan', phase: phaseAt('Plan') },
    { state: 'blocked', start: 'stuck: see build.md, then type', phase: phaseAt('Build') },
    { state: 'capped', start: 'out of turns: /goal-and-do next reruns Build', phase: phaseAt('Build') },
    { state: 'interrupted', start: 'interrupted: /goal-and-do next reruns', phase: phaseAt('Test') },
    { state: 'finished', start: 'finished', phase: phaseAt('PR') },
  ] as const
  for (const { state, start, phase } of states) {
    for (const id of ['ABC-43224', longest]) {
      for (const prUrl of [undefined, 'https://github.example.com/o/r/pull/485']) {
        for (const columns of [40, 58, 80, 120]) {
          const run = runAt({ id, state, phase, turns: 1, ...(prUrl === undefined ? {} : { prUrl }) })
          const lines = bandText(run, columns, clockOf(12)).split('\n')
          const label = `${state} ${id} ${prUrl ?? 'no PR'} ${columns}`
          expect(`${label} ${lines.length <= 2}`).toBe(`${label} true`)
          for (const line of lines) expect(`${label} ${line.length <= columns}`).toBe(`${label} true`)
          if (columns >= 54) for (const name of PHASES) expect(lines[0]).toContain(name.toUpperCase())
          expect(lines.join('\n')).toContain(start.slice(0, columns))
        }
      }
    }
  }
})

test('bandText puts the marks on line 1 and the rest on line 2 when one line is too wide', () => {
  const text = bandText(runAt({ state: 'capped', phase: phaseAt('Build'), turns: 40 }), 60, clockOf(12))
  expect(text.split('\n')).toEqual(['✔ INTENT  ✔ SPEC  ✔ PLAN  ✖ BUILD  TEST  PR', 'turn 40/40 · out of turns: /goal-and-do next reruns Build'])
  const room = bandText(runAt({ state: 'gate', phase: phaseAt('Plan') }), 83).split('\n')
  expect(room[1]).toBe('waiting: approve Plan with /goal-and-do next')
  const turn = bandText(runAt({ phase: phaseAt('Build'), turns: 2 }), 55, clockOf(12)).split('\n')
  expect(turn[1]).toBe('turn 3/40 · 12 min · working')
})

test('the phase of a run out of range falls back to the first phase', () => {
  expect(bandText(runAt({ phase: 99, state: 'capped' }), 200)).toContain('out of turns: /goal-and-do next reruns Intent')
})

test('the walk-through says open questions at Intent and open points elsewhere', () => {
  expect(TEXTS.walkThrough(1, 'Intent')).toBe('Walk through the 1 open question')
  expect(TEXTS.walkThrough(2, 'Intent')).toBe('Walk through the 2 open questions')
  expect(TEXTS.walkThrough(2, 'Spec')).toBe('Walk through the 2 open points')
  expect(TEXTS.walkThrough(1)).toBe('Walk through the 1 open point')
  expect(TEXTS.walkPicked('Intent', 'gate')).toBe("The person picked 'Walk through the open questions' at the Intent gate dialog.")
  expect(TEXTS.walkPicked('Plan', 'stuck')).toBe("The person picked 'Walk through the open points' at the Plan stuck dialog.")
})

test('TEXTS gate and dialog texts', () => {
  expect(TEXTS.gateHeader).toBe('Gate')
  expect(TEXTS.gateQuestion('Intent', 'ABC-1', [])).toBe(
    'Intent is done: changes/ABC-1/intent.md. Check the problem, the outcome, and the business acceptance criteria. Approve and start Spec?'
  )
  expect(TEXTS.gateQuestion('Intent', 'ABC-1', [], 2)).toBe(
    'Intent is done: changes/ABC-1/intent.md. Check the problem, the outcome, and the business acceptance criteria. 2 open questions stay open if you approve; Spec carries them. Approve and start Spec?'
  )
  expect(TEXTS.gateQuestion('Intent', 'ABC-1', [], 1)).toBe(
    'Intent is done: changes/ABC-1/intent.md. Check the problem, the outcome, and the business acceptance criteria. 1 open question stays open if you approve; Spec carries it. Approve and start Spec?'
  )
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 7)).toBe(
    'Spec is done: changes/ABC-1/spec.md. Check that the acceptance criteria are complete and the open points answered. 7 open points stay open if you approve; Plan carries them. Approve and start Plan?'
  )
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 1)).toContain(' 1 open point stays open if you approve; Plan carries it. Approve')
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 2, ['BAC-6'])).toContain(
    '2 open points stay open if you approve; Plan carries them. Spec puts BAC-6 out of scope; approving accepts that. Approve'
  )
  expect(TEXTS.gateQuestion('Plan', 'ABC-1', ['t'], 7)).toBe(
    'Plan is done: changes/ABC-1/plan.md. Check the tasks, the test map, and the acceptance tests that lock when you approve: t. Test command: none. Planned paths: none. 7 open points stay open if you approve. Approve and start Build?'
  )
  expect(TEXTS.gateQuestion('Plan', 'ABC-1', ['t'], 1)).toContain('Planned paths: none. 1 open point stays open if you approve. Approve')
  for (const phase of ['Intent', 'Spec', 'Plan'] as const) expect(TEXTS.gateQuestion(phase, 'ABC-1', ['t'], 0)).not.toContain('stay')
  expect(TEXTS.gateText('Intent', 'ABC-1')).toContain('start Spec')
  expect(TEXTS.gateQuestion('Spec', 'ABC-43224', [])).toBe(
    'Spec is done: changes/ABC-43224/spec.md. Check that the acceptance criteria are complete and the open points answered. Approve and start Plan?'
  )
  expect(TEXTS.gateQuestion('Plan', 'ABC-43224', ['tests/a.py', 'tests/b.py'])).toBe(
    'Plan is done: changes/ABC-43224/plan.md. Check the tasks, the test map, and the acceptance tests that lock when you approve: tests/a.py, tests/b.py. Test command: none. Planned paths: none. Approve and start Build?'
  )
  expect(TEXTS.gateQuestion('Plan', 'ABC-43224', ['tests/a.py'], 0, [], { testCommand: 'npm test', plannedPaths: 3 })).toBe(
    'Plan is done: changes/ABC-43224/plan.md. Check the tasks, the test map, and the acceptance tests that lock when you approve: tests/a.py. Test command: npm test. Planned paths: 3. Approve and start Build?'
  )
  expect(TEXTS.pushSignals(3, 1, 2)).toBe('Outside the plan: 3 files. Sensitive: 1 file. Denials: 2.')
  expect(TEXTS.pushSignals('not checked', 0, 0)).toBe('Outside the plan: not checked. Sensitive: 0 files. Denials: 0.')
  expect(TEXTS.pushSignals('unknown', 'unknown', 1)).toBe('Outside the plan: unknown. Sensitive: unknown. Denials: 1.')
  expect(TEXTS.denialCount(1)).toBe('Denials: 1.')
  expect(TEXTS.gateOptions('Plan')).toEqual(['Approve, start Plan', "Not yet, I'll review or edit first", 'Stop this run'])
  expect(TEXTS.gateText('Spec', 'ABC-43224')).toBe(
    'Spec is done: changes/ABC-43224/spec.md. Read it, edit it, or ask Claude for changes. Then type /goal-and-do next to approve and start Plan, or /goal-and-do stop to end the run. Continue with /goal-and-do next.'
  )
  expect(TEXTS.stuckContinue('Build')).toBe("Fix what's needed, then continue with /goal-and-do next (it reruns Build).")
  expect(TEXTS.pushContinue).toBe('Continue with /goal-and-do next when you want to push (it reruns PR).')
  expect(TEXTS.relockOption).toBe('Approve the changed tests and re-lock')
  expect(TEXTS.relockQuestion('Build', ['tests/a.test.ts', 'tests/b.test.ts'])).toBe(
    'Build is blocked: the acceptance tests changed since Plan approval.\nChanged locked files:\n`tests/a.test.ts`\n`tests/b.test.ts`\nApproving records the current tests as the new lock. Approve the changed tests and rerun Build?'
  )
  expect(TEXTS.relockQuestion('Test', ['tests/ok.ts', 'tests/`rm -rf ~`.ts', 'tests/a b.ts'])).toBe(
    'Test is blocked: the acceptance tests changed since Plan approval.\nChanged locked files:\n`tests/ok.ts`\n<a file with an unusual name>\n<a file with an unusual name>\nApproving records the current tests as the new lock. Approve the changed tests and rerun Test?'
  )
  const ten = Array.from({ length: 10 }, (_, i) => `tests/t${i}.ts`)
  expect(TEXTS.relockQuestion('Build', ten).split('\n').slice(2, 11)).toEqual([...ten.slice(0, 8).map(name => `\`${name}\``), '+2 more'])
  expect(TEXTS.relockQuestion('Build', []).split('\n')[2]).toBe('none found')
  expect(TEXTS.relockCommitFirst).toBe('Commit the test changes first, then approve the re-lock.')
  expect(TEXTS.stuckHeader).toBe('Stuck')
  expect(TEXTS.stuckBlocked('Build', 'tests fail', 'ABC-43224')).toBe('Build is blocked: tests fail (changes/ABC-43224/build.md). Rerun Build?')
  expect(TEXTS.stuckCapped('Build', 'ABC-43224')).toBe('Build ran out of turns (40) without status: done in changes/ABC-43224/build.md. Rerun Build?')
  expect(TEXTS.stuckOptions('Build')).toEqual(['Rerun Build now', "Not yet, I'll fix it first", 'Stop this run'])
  expect(TEXTS.pushHeader).toBe('Push')
  expect(TEXTS.pushQuestion('ABC-43224')).toBe('Push sdd/ABC-43224 to origin and open a draft PR?')
  expect(TEXTS.pushOptions).toEqual(['Push and open the draft PR', 'Not now'])
  expect(TEXTS.pushOpenBody).toBe('Open the PR body in app')
})

test('TEXTS rule dialogs', () => {
  expect(TEXTS.ruleHeader).toBe('Rules')
  expect(TEXTS.ruleQuestion(2)).toBe(
    'Claude Code asked your permission for these commands in this run. Tick each one it may run without asking from now on, then pick Submit. Tick none to keep being asked.'
  )
  expect(TEXTS.ruleQuestion(4)).toBe(TEXTS.ruleQuestion(2))
  expect(TEXTS.ruleQuestion(1)).toBe('Claude Code asked your permission for this command in this run. Allow it without asking from now on?')
  expect(TEXTS.ruleNotNow).toEqual({ label: 'Not now', description: 'Claude Code keeps asking.' })
  expect(TEXTS.ruleWhere).toBe('Where should the rules go?')
  expect(TEXTS.ruleWhereOptions).toEqual([
    'Everyone on this project (.claude/settings.json; you commit it)',
    'Only me (.claude/settings.local.json)',
    'Not now',
  ])
})

test('TEXTS start replies and finish', () => {
  expect(TEXTS.startedJira('ABC-43224')).toBe('Run ABC-43224 started from Jira ticket ABC-43224 on branch sdd/ABC-43224.')
  expect(TEXTS.startedFreeText('CH-20261029-x')).toBe(
    'Run CH-20261029-x started from free text, no ticket read. To use a ticket, give its key or browse URL alone.'
  )
  expect(TEXTS.finishedPr('https://github.com/o/r/pull/1')).toBe('All six phases are done. Draft PR: https://github.com/o/r/pull/1.')
  expect(TEXTS.finishedNoPr).toBe('All six phases are done. No PR: origin is not GitHub.')
  expect(TEXTS.finishedPrNotDraft('https://h/o/r/pull/1')).toBe('All six phases are done. PR: https://h/o/r/pull/1.')
  expect(TEXTS.summaryHead('ABC-1', 125 * 60000, 351_000, 50)).toBe('✔ ABC-1 finished in 2 h 5 min · 351k tokens (input plus output) · 50 goal turns')
  expect(TEXTS.summaryPr('485', 'https://h/o/r/pull/485', 'passed', 2)).toBe('PR #485: https://h/o/r/pull/485 · checks passed · 2 fix rounds')
  expect(TEXTS.summaryPr('485', 'https://h/o/r/pull/485', 'failed', 1)).toBe('PR #485: https://h/o/r/pull/485 · checks failed · 1 fix round')
  expect(TEXTS.summaryNoPr).toBe('No PR: origin is not GitHub.')
  expect(TEXTS.summaryNotDraft).toBe('⚠ The PR is not a draft. Convert it to a draft in the PR sidebar before anyone reviews it.')
  expect(TEXTS.summaryReview(0, 1, 2)).toBe('Review: 0 Blocker, 1 Major, 2 Minor (see pr.md)')
  expect(TEXTS.summaryNext('ABC-1')).toBe('Next: read the whole diff · mark the PR ready by hand.')
  expect(TEXTS.walkThrough(2)).toBe('Walk through the 2 open points')
  expect(TEXTS.walkThrough(1)).toBe('Walk through the 1 open point')
  expect(TEXTS.walkPrompt('ABC-1', 'spec.md', '2026-10-29')).toBe(
    "Go through the open points in changes/ABC-1/spec.md one at a time. Start each question with the label 'Question <n> of <N> · <k>/<N> open': n is its place among all the points in the file, N is how many points the file has, and k is how many have no answer yet, this one included, counted as the side pane counts them. For each point: explain in two or three sentences what is open and why it matters, give your recommendation, and ask the person with AskUserQuestion (your recommendation first, two or three alternatives). From the second question on, offer 'Back to question <n-1>' as the last option, at most four options in all. When the person picks it, ask that question again, show the answer they gave, and when they answer, replace its line instead of adding one. Then go on with the question after it. Write the decision into spec.md right under that point as a line starting 'Decided (the person, 2026-10-29):' before you go to the next point. When a question times out or the person skips it, the point stays open, even when an option came back with it. Write nothing under it. Write no names. When all are done, list the decisions and the points still open; the mod then opens the gate again."
  )
  expect(TEXTS.walkPrompt('ABC-1', 'build.md', '2026-10-29', 'stuck')).toMatch(
    /When all are done, list the decisions and the points still open; the mod then opens the Stuck dialog again\.$/
  )
  expect(TEXTS.walkPicked('Spec', 'gate')).toBe("The person picked 'Walk through the open points' at the Spec gate dialog.")
  expect(TEXTS.walkPicked('Build', 'stuck')).toBe("The person picked 'Walk through the open points' at the Build stuck dialog.")
  expect(TEXTS.changedSinceApproval('spec.md')).toBe('spec.md changed since its approval; approving also approves the current spec.md.')
  expect(TEXTS.subcommandWords('status')).toBe(
    '/goal-and-do status takes no more words: type /goal-and-do status alone. To start a request that begins with "status" (such as "Status badge for the claims page"), begin it with another word ("Add a status badge for the claims page") or put it in a request file, a .md file in the project.'
  )
  expect(TEXTS.subcommandWords('next')).toBe(
    '/goal-and-do next takes no more words: type /goal-and-do next alone. To start a request that begins with "next" (such as "Next steps for the export"), begin it with another word ("Plan the next steps for the export") or put it in a request file, a .md file in the project.'
  )
  expect(TEXTS.stopped('ABC-1', 'main')).toBe(
    'Run ABC-1 stopped. To start over: git reset -- changes/ABC-1, git switch main, rm -r changes/ABC-1, git branch -D sdd/ABC-1.'
  )
})

test('TEXTS refusals and preflight lines', () => {
  expect(TEXTS.notAtRoot).toBe("Start Claude Code in the repository's root folder.")
  expect(TEXTS.runActive('ABC-1')).toBe('Run ABC-1 is active (changes/ABC-1/). Type /goal-and-do next to go on.')
  expect(TEXTS.changeExists('ABC-1', 'main')).toBe(
    'changes/ABC-1/ exists already. To start over: git reset -- changes/ABC-1, git switch main, rm -r changes/ABC-1, git branch -D sdd/ABC-1.'
  )
  expect(TEXTS.wrongBranch('feat/x', 'main')).toBe('You are on branch feat/x. Switch to the default branch first: git switch main.')
  expect(TEXTS.notFromPerson('next', 'a plugin')).toBe('Only a person can type /goal-and-do next; this came from a plugin.')
  expect(TEXTS.notFromPerson('allow local', 'a hook')).toBe('Only a person can type /goal-and-do allow local; this came from a hook.')
  expect(TEXTS.goalRunning('Plan')).toBe('The Plan goal is still running. Wait for it, or type /goal-and-do stop.')
  expect(TEXTS.noRun).toBe('No run here. Start one with /goal-and-do <ticket URL | key | text | file.md>.')
  expect(TEXTS.runFinished('ABC-1')).toBe('Run ABC-1 is finished. Start a new one with /goal-and-do <ticket URL | key | text | file.md>.')
  expect(TEXTS.runStopped('ABC-1', 'main')).toBe(
    'Run ABC-1 was stopped. To start over: git reset -- changes/ABC-1, git switch main, rm -r changes/ABC-1, git branch -D sdd/ABC-1.'
  )
  expect(TEXTS.usage).toBe(
    'Usage: /goal-and-do [--strict] [--base <branch>] <ticket URL | key | text | file.md> | level strict|review | next | status | allow [local] | stop'
  )
  expect(TEXTS.levelSwitched('review', 'strict')).toBe('Guard level: strict. It was review.')
  expect(TEXTS.levelUnchanged('review')).toBe('Guard level is already review.')
  expect(TEXTS.goalEnded('no front matter')).toBe('the goal ended without status: done: no front matter')
  expect(TEXTS.preflightNotAtRoot).toBe("You are not at the repository's root folder. Start Claude Code there.")
  expect(TEXTS.preflightDirty('a.txt, b.txt')).toBe('The working tree has uncommitted changes: a.txt, b.txt. Commit or stash them first.')
  expect(TEXTS.preflightNoJira).toBe('No Jira tool is connected. Connect the Jira MCP, or start with free text.')
  expect(TEXTS.preflightGh('github.com')).toBe('gh is not logged in to github.com. Run: gh auth login --hostname github.com')
  expect(TEXTS.preflightManaged('allowManagedHooksOnly')).toBe(
    'A managed setting (allowManagedHooksOnly) stops mods or /goal here. Ask your Claude Code admins.'
  )
})

test('TEXTS the Intent gate: its walk-through, its counts, a blocked Intent and a changed intent', () => {
  expect(TEXTS.intentWalkPrompt('ABC-1', '2026-10-29')).toBe(
    "Go through the open questions in changes/ABC-1/intent.md one at a time. Start each question with the label 'Question <n> of <N> · <k>/<N> open': n is its place among all the points in the file, N is how many points the file has, and k is how many have no answer yet, this one included, counted as the side pane counts them. For each point: explain in two or three sentences what is open and why it matters. Give no recommendation on a question about who, the problem, the cost, or the outcome; a question about a value may keep one, marked as yours. Ask the person with AskUserQuestion and always offer \"Not known yet (stays open for the ticket's owner)\". From the second question on, offer 'Back to question <n-1>' as the last option, at most four options in all. When the person picks it, ask that question again, show the answer they gave, and when they answer, replace its line instead of adding one. Then go on with the question after it. For a question that starts with an item of high-risk:, say that approval waits for its answer and that Not known yet leaves it open; where a point has no natural options, ask with kind: \"text\" and name that answer in the question's description. Write the person's answer word for word right under its point, as a line Answer (2026-10-29): \"<their words>\", with names as roles and credentials as <removed: what it was>. When a question times out or the person skips it, the point stays open, even when an option came back with it. Write nothing under it. After the last answer, fold the answers into Problem, Outcome, and the business acceptance criteria: a new or changed criterion takes the next free BAC number, the one it replaces is marked (dropped), and no ID is ever renumbered. Then list the answers and the points still open; the mod then opens the gate again."
  )
  expect(TEXTS.intentWalkPrompt('ABC-1', '2026-10-29', 'stuck')).toMatch(
    /Then list the answers and the points still open; the mod then opens the Stuck dialog again\.$/
  )
  expect(TEXTS.walkCounts(3, 0, 1)).toBe('3 answered, 1 timed out: it stays open.')
  expect(TEXTS.walkCounts(1, 1, 1)).toBe('1 answered, 1 skipped, 1 timed out: they stay open.')
  expect(TEXTS.walkCounts(0, 2, 0)).toBe('0 answered, 2 skipped: they stay open.')
  expect(TEXTS.walkCounts(2, 0, 0)).toBe('2 answered.')
  expect(TEXTS.criteriaSince(['BAC-2'], ['BAC-1'])).toBe('Since the gate first opened: added BAC-2; changed BAC-1.')
  expect(TEXTS.criteriaSince([], ['BAC-1', 'BAC-3'])).toBe('Since the gate first opened: changed BAC-1, BAC-3.')
  expect(TEXTS.criteriaSince(['BAC-4'], [])).toBe('Since the gate first opened: added BAC-4.')
  expect(TEXTS.intentBlocked('the export exists already')).toBe("Intent says the change isn't needed: the export exists already. Stop the run?")
  expect(TEXTS.intentBlocked('The export exists already.')).toBe("Intent says the change isn't needed: The export exists already. Stop the run?")
  expect(TEXTS.intentBlockedOptions).toEqual(['Stop this run', 'Rerun Intent', 'Not yet'])
  expect(TEXTS.intentChanged).toBe('Spec traced the old intent; edit spec.md or rerun Spec first.')
})

test('criteriaOf reads the criterion lines under Business acceptance criteria only', () => {
  const text = [
    '---',
    'phase: intent',
    '---',
    '',
    '## Problem',
    '',
    '- BAC-9: not a criterion, this is the Problem section.',
    '',
    '## Business acceptance criteria',
    '',
    '- BAC-1: Given a broker, when they export, then they get a file.',
    '- **BAC-10**: Given a broker, when the export fails, then they see why.',
    '- BAC-2 (dropped): Given a clerk, when they export, then nothing.',
    'A note that is no criterion.',
    '',
    '## Open questions',
    '',
    '- BAC-3 is unclear?',
  ].join('\r\n')
  expect(criteriaOf(text)).toEqual([
    { id: 'BAC-1', line: '- BAC-1: Given a broker, when they export, then they get a file.' },
    { id: 'BAC-10', line: '- **BAC-10**: Given a broker, when the export fails, then they see why.' },
    { id: 'BAC-2', line: '- BAC-2 (dropped): Given a clerk, when they export, then nothing.' },
  ])
  expect(criteriaOf('# No criteria\n')).toEqual([])
})

// The demo's test.md as it stands (branch sdd/CH-20261030-add-a-function-that): it writes pass.
const DEMO_TEST = [
  '---',
  'phase: test',
  'status: done',
  '---',
  '',
  '# Test: CH-20261030-add-a-function-that',
  '',
  '## AC coverage',
  '',
  '| AC ID | Test | Result |',
  '| --- | --- | --- |',
  '| AC-1 | `FormatPremiumAcceptanceTest.test_ac_1_whole_number_shows_two_decimals` | pass |',
  '| AC-2 | `FormatPremiumAcceptanceTest.test_ac_2_one_decimal_place_is_padded_to_two_decimals` | pass |',
  '| AC-3 | `FormatPremiumAcceptanceTest.test_ac_3_more_than_two_decimals_is_rounded_to_nearest_cent` | pass |',
  '| AC-4 | `FormatPremiumAcceptanceTest.test_ac_4_result_marks_amount_as_euros` | pass |',
  '| AC-5 | `FormatPremiumAcceptanceTest.test_ac_5_zero_shows_zero_amount_in_euros_without_error` | pass |',
  '| AC-6 | `FormatPremiumAcceptanceTest.test_ac_6_annual_premium_output_is_formatted_in_euros` | pass |',
  '',
  '## Suite',
  '',
  '- `python3 -m unittest` (the test command in `CLAUDE.md`): pass, `Ran 8 tests`, `OK`, no test skipped.',
  '- `python3 -m unittest -v tests.test_format_premium` (acceptance tests): pass, `Ran 6 tests`, `OK`, no test skipped.',
  '',
  '## Build',
  '',
  'Not applicable: the project has no build step, and neither `CLAUDE.md` nor a CI config names a build command. There is no CI config in the repository.',
  '',
  '## Scan',
  '',
  'SAST: left to CI.',
  '',
  '## Lock check',
  '',
  "Locked at `a6873784a75f446a696fff4a444ae82192324e55` (the Plan row's `locked-at` in `approvals.md`), `test-paths: tests/test_format_premium.py`. Both parts pass:",
  '',
  '- `git diff --quiet a6873784a75f446a696fff4a444ae82192324e55 -- tests/test_format_premium.py`: exit 0.',
  '- `git ls-files --others --exclude-standard -- tests/test_format_premium.py`: prints nothing.',
  '',
  '## Open points',
  '',
  'None.',
  '',
].join('\n')

// The demo's spec.md as it stands (branch sdd/CH-20261030-add-a-function-that), except that its six acceptance criteria
// move into the layout ### AC-<n> (BAC-<n>), with Given, When and Then below. The marks name the criteria of AC-1 to
// AC-6; the extra lines go at the end of Out of scope and of Open points.
function demoSpec(marks: string[], extra: { scope?: string[]; points?: string[] } = {}): string {
  const block = (n: number, given: string, when: string, then: string) =>
    [`### AC-${n} (${marks[n - 1]})`, '', `- Given ${given}`, `- When ${when}`, `- Then ${then}`, ''].join('\n')
  return [
    '---',
    'phase: spec',
    'status: done',
    'change: CH-20261030-add-a-function-that',
    'source: freeform',
    'issue-type: freeform',
    'base: main',
    'adds-ai-feature: no',
    '---',
    '',
    '## What the change must do',
    '',
    'The `premiums` package gets a new helper that turns a premium amount into display text in euros, always showing exactly two decimal places. It sits next to `annual_premium` and is meant for showing either a monthly or an annual premium. The request does not say how the text is laid out beyond "euros" and "two decimals"; those details are listed under Open points rather than assumed.',
    '',
    '## Acceptance criteria',
    '',
    block(
      1,
      'a premium of `10`, a whole number of euros',
      'it is formatted',
      'the result is text that shows the amount `10` with exactly two decimals, `10.00` or the local equivalent.'
    ),
    block(2, 'a premium with one decimal place, such as `10.5`', 'it is formatted', 'the result shows exactly two decimals, with the amount `10.50`.'),
    block(
      3,
      'a premium with more than two decimal places, such as `10.126`',
      'it is formatted',
      'the result shows exactly two decimals, with the amount rounded to the nearest cent, `10.13`.'
    ),
    block(4, 'any valid premium', 'it is formatted', 'the result marks the amount as euros, with the `€` sign.'),
    block(5, 'a premium of `0`', 'it is formatted', 'the result shows the amount `0.00` in euros and no error is raised.'),
    block(6, 'the output of `annual_premium(10.0)`', 'it is formatted', 'the result shows the amount `120.00` in euros.'),
    '## Out of scope',
    '',
    '- Currencies other than the euro.',
    '- Parsing formatted text back into a number.',
    '- Changes to `annual_premium` or its validation.',
    '- Locale detection or user-configurable formats.',
    ...(extra.scope ?? []),
    '',
    '## Open points',
    '',
    '- **Layout of the text**: the request does not say where the `€` sign goes (before or after the amount), whether a space separates them, or which decimal and thousands separators apply, for example `€1,234.50` versus `1.234,50 €`. AC-1 to AC-6 therefore check the amount and the `€` sign, not the exact string.',
    "- **Rounding rule**: the request does not say how a half-cent is rounded (half up, or banker's rounding). AC-3 uses a case that does not sit on the half-cent.",
    '- **Negative amounts**: the request is silent on whether a negative amount is formatted or raises an error. `annual_premium` rejects negative input with `ValueError`.',
    '- **Input type**: the request does not say whether the input is a `float`, an `int` or a `Decimal`. `annual_premium` takes a `float`.',
    '- **Invalid input**: the request does not say what happens for `None`, `NaN`, infinity or non-numeric input.',
    '- **Name and location**: the request names no function name. It is assumed to go in the `premiums` package, but this is not decided.',
    '- **Thousands grouping**: the request does not say whether large amounts such as `1234567.5` are grouped.',
    ...(extra.points ?? []),
    '',
  ].join('\n')
}

const DEMO_INTENT = [
  '---',
  'phase: intent',
  'status: done',
  '---',
  '',
  '# Show premiums in euros',
  '',
  '## Business acceptance criteria',
  '',
  '- BAC-1: Given a clerk, when they look at a premium, then it shows two decimals.',
  '- BAC-2: Given a clerk, when they look at a premium, then it shows the euro sign.',
  '- BAC-3: Given a clerk, when they look at an annual premium, then it shows euros.',
  '',
  '## Open questions',
  '',
  'None.',
  '',
].join('\n')

const SPLIT = ['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-3']

const acsOf = (ids: string[], result?: 'passed' | 'failed' | 'unknown') => ids.map(id => (result ? { id, result } : { id }))
const passed = (ids: string[]) => acsOf(ids, 'passed')

// Each row as the chain draws it: its parts joined, in the color of its parts.
const traceLines = (rows: TraceRow[]) =>
  rows.map(row => {
    const parts = traceParts(row)
    const color = parts[0]?.color
    return { text: parts.map(part => part.text).join(''), ...(color === undefined ? {} : { color }) }
  })

test('acResults reads the AC ID | Test | Result table of the demo test.md into passed, failed or unknown', () => {
  expect(acResults(DEMO_TEST)).toEqual({
    'AC-1': 'passed',
    'AC-2': 'passed',
    'AC-3': 'passed',
    'AC-4': 'passed',
    'AC-5': 'passed',
    'AC-6': 'passed',
  })
})

test('acResults reads pass, passed, fail and failed in any case, marks and all; anything else is unknown', () => {
  const table = [
    'AC-1 | a | pass',
    'AC-2 | b | PASSED',
    'AC-3 | c | Fail',
    'AC-4 | d | **FAILED**',
    'AC-5 | e | skipped',
    'AC-6 | f | ',
    'ac-7 | g | `pass`',
  ].map(row => `| ${row} |`)
  expect(acResults(['| AC ID | Test | Result |', '| --- | --- | --- |', ...table].join('\r\n'))).toEqual({
    'AC-1': 'passed',
    'AC-2': 'passed',
    'AC-3': 'failed',
    'AC-4': 'failed',
    'AC-5': 'unknown',
    'AC-6': 'unknown',
    'AC-7': 'passed',
  })
})

test('acResults counts a repeated AC as failed when one row failed, else unknown when one is unclear, and ignores prose and other tables', () => {
  const text = [
    'AC-9 passes, says this line, which is no table row.',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| AC-8 | pass |',
    '',
    '| AC ID | Test | Result |',
    '| --- | --- | --- |',
    '| AC-1 | a | pass |',
    '| AC-1 | b | fail |',
    '| AC-2 | a | pass |',
    '| AC-2 | b | n/a |',
    '| AC-3 | has a \\| pipe | pass |',
    '',
    '| AC-4 | after the table | fail |',
  ].join('\n')
  expect(acResults(text)).toEqual({ 'AC-1': 'failed', 'AC-2': 'unknown', 'AC-3': 'passed' })
})

test('acResults finds nothing in a missing file or a file without the table', () => {
  expect(acResults('')).toEqual({})
  expect(acResults('# Test\n\nAll pass.\n')).toEqual({})
  expect(acResults('| AC ID | Test |\n| --- | --- |\n| AC-1 | a |\n')).toEqual({})
})

test('traceRows gives one row per criterion with its ACs and their marks from the demo files', () => {
  expect(traceRows(DEMO_INTENT, demoSpec(SPLIT), DEMO_TEST)).toEqual([
    { id: 'BAC-1', kind: 'acs', acs: passed(['AC-1', 'AC-2', 'AC-3']) },
    { id: 'BAC-2', kind: 'acs', acs: passed(['AC-4', 'AC-5']) },
    { id: 'BAC-3', kind: 'acs', acs: passed(['AC-6']) },
  ])
})

test('traceRows gives an AC no mark before test.md has its table, and unknown when the table lacks the AC', () => {
  expect(traceRows(DEMO_INTENT, demoSpec(SPLIT), '')[0]).toEqual({ id: 'BAC-1', kind: 'acs', acs: acsOf(['AC-1', 'AC-2', 'AC-3']) })
  const partial = DEMO_TEST.split('\n')
    .filter(line => !line.startsWith('| AC-3 |'))
    .join('\n')
  expect(traceRows(DEMO_INTENT, demoSpec(SPLIT), partial)[0]).toEqual({
    id: 'BAC-1',
    kind: 'acs',
    acs: [
      { id: 'AC-1', result: 'passed' },
      { id: 'AC-2', result: 'passed' },
      { id: 'AC-3', result: 'unknown' },
    ],
  })
})

test('traceRows lists an AC that serves two criteria under both', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'BAC-1', 'BAC-1, BAC-2', 'BAC-2', 'BAC-2', 'BAC-3']), DEMO_TEST)
  expect(rows.map(row => [row.id, row.acs.map(ac => ac.id)])).toEqual([
    ['BAC-1', ['AC-1', 'AC-2', 'AC-3']],
    ['BAC-2', ['AC-3', 'AC-4', 'AC-5']],
    ['BAC-3', ['AC-6']],
  ])
})

test('traceRows keeps BAC-1 apart from BAC-10', () => {
  const intent = DEMO_INTENT.replace('- BAC-3:', '- BAC-10:')
  const rows = traceRows(intent, demoSpec(['BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-10', 'BAC-10']), DEMO_TEST)
  expect(rows.map(row => [row.id, row.kind, row.acs.map(ac => ac.id)])).toEqual([
    ['BAC-1', 'acs', ['AC-1', 'AC-2']],
    ['BAC-2', 'acs', ['AC-3', 'AC-4']],
    ['BAC-10', 'acs', ['AC-5', 'AC-6']],
  ])
  const onlyTen = traceRows(DEMO_INTENT.replace('- BAC-3:', '- BAC-10:'), demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-1', 'BAC-1', 'BAC-1']), DEMO_TEST)
  expect(onlyTen.map(row => [row.id, row.kind])).toEqual([
    ['BAC-1', 'acs'],
    ['BAC-2', 'none'],
    ['BAC-10', 'none'],
  ])
})

test('traceRows marks a criterion with no AC as none', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-2']), DEMO_TEST)
  expect(rows[2]).toEqual({ id: 'BAC-3', kind: 'none', acs: [] })
})

test('traceRows counts IDs in the prose of Open points and Out of scope for nothing, and a - BAC-<n> (out of scope) line for out of scope', () => {
  const marks = ['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-2']
  const prose = {
    scope: ['- Anything BAC-3 would need, and the (BAC-3) of the old plan.'],
    points: ['- **BAC-3**: does it need AC-9 (BAC-3)? Spec asks.'],
  }
  expect(traceRows(DEMO_INTENT, demoSpec(marks, prose), DEMO_TEST)[2]).toEqual({ id: 'BAC-3', kind: 'none', acs: [] })
  const listed = { ...prose, scope: [...prose.scope, '- BAC-3 (out of scope): the ticket leaves annual premiums to a later change.'] }
  expect(traceRows(DEMO_INTENT, demoSpec(marks, listed), DEMO_TEST)[2]).toEqual({ id: 'BAC-3', kind: 'out of scope', acs: [] })
  const upper = { scope: ['* bac-3 (Out Of Scope): later.'] }
  expect(traceRows(DEMO_INTENT, demoSpec(marks, upper), DEMO_TEST)[2]?.kind).toBe('out of scope')
  // The line counts only under Out of scope.
  const misplaced = { points: ['- BAC-3 (out of scope): later.'] }
  expect(traceRows(DEMO_INTENT, demoSpec(marks, misplaced), DEMO_TEST)[2]?.kind).toBe('none')
})

test('traceRows keeps the ACs of a criterion that Out of scope lists too, and flags the contradiction', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(SPLIT, { scope: ['- BAC-3 (out of scope): later.'] }), DEMO_TEST)
  expect(rows[2]).toEqual({ id: 'BAC-3', kind: 'acs', acs: passed(['AC-6']), alsoOutOfScope: true })
  expect(rows[0]).toEqual({ id: 'BAC-1', kind: 'acs', acs: passed(['AC-1', 'AC-2', 'AC-3']) })
})

test('outOfScopeOf names every criterion with an Out of scope line, with or without ACs', () => {
  const marks = ['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-3']
  const scope = ['- BAC-2 (out of scope): later.', '- BAC-3 (out of scope): later.']
  const rows = traceRows(DEMO_INTENT, demoSpec(marks, { scope }), DEMO_TEST)
  expect(outOfScopeOf(rows)).toEqual(['BAC-2', 'BAC-3'])
  const bare = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-1', 'BAC-1', 'BAC-1'], { scope }), DEMO_TEST)
  expect(outOfScopeOf(bare)).toEqual(['BAC-2', 'BAC-3'])
  expect(outOfScopeOf(traceRows(DEMO_INTENT, demoSpec(SPLIT), DEMO_TEST))).toEqual([])
})

test('traceLines marks a criterion with ACs that is also out of scope in the warning color, after its marks', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(SPLIT, { scope: ['- BAC-3 (out of scope): later.'] }), DEMO_TEST)
  expect(traceLines(rows)[2]).toEqual({ text: 'BAC-3 → AC-6 ✔ (also out of scope)', color: 'warning' })
  expect(traceLines(rows)[0]).toEqual({ text: 'BAC-1 → AC-1 ✔, AC-2 ✔, AC-3 ✔' })
  const only = traceRows(
    DEMO_INTENT,
    demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-2'], { scope: ['- BAC-3 (out of scope): later.'] }),
    DEMO_TEST
  )
  expect(traceLines(only)[2]).toEqual({ text: 'BAC-3 → out of scope (Spec)', color: 'subtle' })
})

test('traceRows shows a criterion that spec.md names and intent.md lacks as not in intent.md, after the criteria of intent.md', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-4', 'BAC-3'], { scope: ['- BAC-9 (out of scope): gone.'] }), DEMO_TEST)
  expect(rows.map(row => [row.id, row.kind])).toEqual([
    ['BAC-1', 'acs'],
    ['BAC-2', 'acs'],
    ['BAC-3', 'acs'],
    ['BAC-4', 'not in intent'],
    ['BAC-9', 'not in intent'],
  ])
  const gone = traceRows('# No criteria\n', demoSpec(SPLIT), DEMO_TEST)
  expect(gone.map(row => [row.id, row.kind])).toEqual([
    ['BAC-1', 'not in intent'],
    ['BAC-2', 'not in intent'],
    ['BAC-3', 'not in intent'],
  ])
})

test('traceRows gives a dropped criterion no row, and an AC that still names it not in intent.md; a dropped AC is in no row', () => {
  const intent = DEMO_INTENT.replace('- BAC-2: Given', '- BAC-2 (dropped): Given')
  const still = traceRows(intent, demoSpec(SPLIT), DEMO_TEST)
  expect(still.map(row => [row.id, row.kind])).toEqual([
    ['BAC-1', 'acs'],
    ['BAC-3', 'acs'],
    ['BAC-2', 'not in intent'],
  ])
  const withDropped = traceRows(intent, demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'dropped', 'none', 'BAC-3']), DEMO_TEST)
  expect(withDropped.map(row => [row.id, row.kind, row.acs.map(ac => ac.id)])).toEqual([
    ['BAC-1', 'acs', ['AC-1', 'AC-2', 'AC-3']],
    ['BAC-3', 'acs', ['AC-6']],
    ['no BAC', 'no bac', ['AC-5']],
  ])
})

test('traceRows puts ACs marked (none) into one no BAC row, last', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'none', 'BAC-1', 'BAC-2', 'None', 'BAC-3']), DEMO_TEST)
  expect(rows.map(row => [row.id, row.kind])).toEqual([
    ['BAC-1', 'acs'],
    ['BAC-2', 'acs'],
    ['BAC-3', 'acs'],
    ['no BAC', 'no bac'],
  ])
  expect(rows[3]?.acs).toEqual(passed(['AC-2', 'AC-5']))
})

test('traceRows returns no rows without any (BAC-<n>) in spec.md, or without spec.md', () => {
  expect(
    traceRows(DEMO_INTENT, demoSpec(['none', 'none', 'dropped', 'none', 'none', 'none'], { scope: ['- BAC-1 (out of scope): later.'] }), DEMO_TEST)
  ).toEqual([])
  expect(traceRows(DEMO_INTENT, '## Acceptance criteria\n\n- **AC-1**\n  - Given a\n  - Then (BAC-1)\n', DEMO_TEST)).toEqual([])
  expect(traceRows(DEMO_INTENT, '', DEMO_TEST)).toEqual([])
})

test('traceRows reads files with CRLF line ends', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')
  const marks = ['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-2']
  const spec = demoSpec(marks, { scope: ['- BAC-3 (out of scope): later.'] })
  expect(traceRows(crlf(DEMO_INTENT), crlf(spec), crlf(DEMO_TEST))).toEqual(traceRows(DEMO_INTENT, spec, DEMO_TEST))
  expect(traceRows(crlf(DEMO_INTENT), crlf(spec), crlf(DEMO_TEST))[2]?.kind).toBe('out of scope')
})

test('traceRows reads a missing test.md as no marks, and a failed test as failed', () => {
  expect(traceRows(DEMO_INTENT, demoSpec(SPLIT), '')[2]).toEqual({ id: 'BAC-3', kind: 'acs', acs: [{ id: 'AC-6' }] })
  const failing = DEMO_TEST.replace('| pass |\n| AC-4', '| FAIL |\n| AC-4')
  expect(traceRows(DEMO_INTENT, demoSpec(SPLIT), failing)[0]?.acs.map(ac => ac.result)).toEqual(['passed', 'passed', 'failed'])
})

test('traceLines draws one line per row with the marks, and the colors: none and not in intent.md warn, out of scope is neutral', () => {
  const rows = traceRows(
    DEMO_INTENT.replace('- BAC-3:', '- BAC-10:'),
    demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'none', 'BAC-7', 'BAC-10'], { scope: ['- BAC-2 (out of scope): later.'] }),
    DEMO_TEST.replace('| pass |\n| AC-2', '| fail |\n| AC-2').replace('| AC-6 |', '| AC-7 |')
  )
  expect(traceLines(rows)).toEqual([
    { text: 'BAC-1 → AC-1 ✖, AC-2 ✔, AC-3 ✔' },
    { text: 'BAC-2 → out of scope (Spec)', color: 'subtle' },
    { text: 'BAC-10 → AC-6 ?' },
    { text: 'BAC-7 → not in intent.md', color: 'warning' },
    { text: 'no BAC: AC-4 ✔' },
  ])
  const none = traceRows(DEMO_INTENT, demoSpec(['BAC-1', 'BAC-1', 'BAC-1', 'BAC-2', 'BAC-2', 'BAC-2']), '')
  expect(traceLines(none)).toEqual([{ text: 'BAC-1 → AC-1, AC-2, AC-3' }, { text: 'BAC-2 → AC-4, AC-5, AC-6' }, { text: 'BAC-3 → none', color: 'warning' }])
})

test('traceParts draws every row, and leaves a long line whole for the pane to wrap', () => {
  const row = (n: number) => ({ id: `BAC-${n}`, kind: 'acs' as const, acs: [{ id: 'AC-1' }, { id: 'AC-2' }] })
  expect(traceLines([row(1)])).toEqual([{ text: 'BAC-1 → AC-1, AC-2' }])
  expect(traceLines([1, 2, 3, 4, 5, 6, 7, 8].map(row)).map(line => line.text)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(n => `BAC-${n} → AC-1, AC-2`))
  expect(traceLines([])).toEqual([])
})

test('TEXTS the Spec gate question names each criterion Spec puts out of scope', () => {
  const plain = TEXTS.gateQuestion('Spec', 'ABC-1', [])
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 0, [])).toBe(plain)
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 0, ['BAC-3'])).toBe(
    'Spec is done: changes/ABC-1/spec.md. Check that the acceptance criteria are complete and the open points answered. Spec puts BAC-3 out of scope; approving accepts that. Approve and start Plan?'
  )
  expect(TEXTS.gateQuestion('Spec', 'ABC-1', [], 0, ['BAC-3', 'BAC-10'])).toContain(
    'Spec puts BAC-3 out of scope; approving accepts that. Spec puts BAC-10 out of scope; approving accepts that. Approve and start Plan?'
  )
  expect(TEXTS.gateQuestion('Plan', 'ABC-1', ['t'], 0, ['BAC-3'])).toBe(TEXTS.gateQuestion('Plan', 'ABC-1', ['t']))
})

// Undecided open points

const pointsText = (heading: string, points: string[]) => ['---', 'status: done', '---', '', heading, '', ...points, ''].join('\n')

for (const [name, points, count] of [
  ['an Answer line under the item', ['- Who?', '  Answer (2026-10-29): "The broker."'], 0],
  ['an Answer line as a sub-item', ['- Who?', '  - Answer (2026-10-29): "The broker."'], 0],
  ['an Answer line without quotes', ['- Who?', '  Answer (2026-10-29): The broker.'], 0],
  ['an Answer of Not known yet', ['- Who?', `  Answer (2026-10-29): "Not known yet (stays open for the ticket's owner)"`], 1],
  ['an Answer that only mentions not known yet', ['- Who?', '  Answer (2026-10-29): "The broker; the format is not known yet."'], 0],
  ['"Answer" in the question', ['- Who can answer (today) the calls?'], 1],
  ['a top-level Answer item between two open items', ['- A?', '- Answer (2026-10-29): "yes"', '- B?'], 1],
  ['a Decided line', ['- Who?', '  Decided (the person, 2026-10-29): the broker.'], 0],
  ['a top-level Decided item', ['- Who?', '- Decided (the person, 2026-10-29): the broker.'], 0],
  ['"Decided (" inside the item', ['- Point 2: delete it. Decided (the person, 2026-10-30).'], 0],
  ['"Still undecided" in the item', ['- Still undecided: date format'], 1],
  ['"Not decided yet" under the item', ['1. Date format?', '   Not decided yet'], 1],
  ['"yet to be Decided (" in the item', ['- Date format, yet to be Decided (later)'], 1],
  ['"None."', ['None.'], 0],
  ['"- None."', ['- None.'], 0],
  ['two open, one answered', ['- A?', '- B?', '  Answer (2026-10-29): "yes"', '- C?'], 2],
  ['one decided, one open', ['- A?', '  Decided: yes', '- B?'], 1],
] as [string, string[], number][]) {
  test(`undecidedPoints: ${name} counts ${count}`, () => {
    expect(undecidedPoints(pointsText('## Open points', points))).toBe(count)
    expect(undecidedPoints(pointsText('## Open questions', points))).toBe(count)
  })
}

test('undecidedPoints: no heading, no text and an empty section count 0', () => {
  expect(undecidedPoints('# Spec\n\n- A?\n')).toBe(0)
  expect(undecidedPoints(undefined)).toBe(0)
  expect(undecidedPoints('## Open points\n\n')).toBe(0)
})

test('undecidedPoints: counting stops at the next heading', () => {
  expect(undecidedPoints('## Open points\n\n- A?\n\n## Notes\n\n- B?\n')).toBe(1)
})

// Counts of all open points

for (const [name, points, undecided, total] of [
  ['none decided', ['- A?', '- B?', '- C?'], 3, 3],
  ['some decided', ['- A?', '  Decided: yes', '- B?', '- C?', '  Answer (2026-10-29): "yes"', '- D?'], 2, 4],
  ['all decided', ['- A?', '  Decided: yes', '- B?', '  Answer (2026-10-29): "yes"'], 0, 2],
  ['an Answer of Not known yet', ['- A?', `  Answer (2026-10-29): "Not known yet (stays open for the ticket's owner)"`, '- B?'], 2, 2],
  ['a top-level Decided item, which belongs to the item above', ['- A?', '- Decided (the person, 2026-10-29): yes', '- B?'], 1, 2],
  ['a top-level Answer item between two open items', ['- A?', '- Answer (2026-10-29): "yes"', '- B?'], 1, 2],
  ['numbered items', ['1. A?', '2. B?', '   Decided: yes'], 1, 2],
  ['a "- None." item, which is no point', ['- None.'], 0, 0],
  ['"None." without a marker', ['None.'], 0, 0],
  ['an empty section', [], 0, 0],
] as [string, string[], number, number][]) {
  test(`pointCounts: ${name} counts ${undecided} of ${total}`, () => {
    expect(pointCounts(pointsText('## Open points', points))).toEqual({ undecided, total })
    expect(pointCounts(pointsText('## Open questions', points))).toEqual({ undecided, total })
    expect(undecidedPoints(pointsText('## Open points', points))).toBe(undecided)
  })
}

test('pointCounts: no heading and no text count 0 of 0, and counting stops at the next heading', () => {
  expect(pointCounts('# Spec\n\n- A?\n')).toEqual({ undecided: 0, total: 0 })
  expect(pointCounts(undefined)).toEqual({ undecided: 0, total: 0 })
  expect(pointCounts('## Open points\n\n- A?\n- B?\n  Decided: x\n\n## Notes\n\n- C?\n')).toEqual({ undecided: 1, total: 2 })
})

// The goal turn's calls in the band

const callsAt = (minutes: number, calls: number) => ({ startedAt: NOW - minutes * 60_000, now: NOW, calls })

test('bandText shows the calls of the goal turn after its minutes', () => {
  expect(bandText(runAt({ phase: phaseAt('Intent') }), 200, callsAt(0, 10))).toBe(
    '● INTENT  SPEC  PLAN  BUILD  TEST  PR    turn 1/10 · 0 min · 10 calls · working'
  )
  const part = bandParts(runAt({ phase: phaseAt('Build') }), 200, callsAt(3, 4))
    .flat()
    .find(one => one.text === '4 calls')
  expect(part).toEqual({ text: '4 calls', color: 'subtle' })
  // Without a clock there are no minutes and no calls.
  expect(bandText(runAt({ phase: phaseAt('Build') }), 200)).not.toContain('calls')
  for (const state of ['gate', 'blocked', 'interrupted', 'finished'] as const) {
    expect(bandText(runAt({ phase: phaseAt('Build'), state }), 200, callsAt(3, 4)), state).not.toContain('calls')
  }
})

test('bandText drops the PR number, then the calls, then a plain working to stay on one line; line 2 keeps them when one line cannot', () => {
  const run = runAt({ phase: phaseAt('Build'), turns: 2, prUrl: 'https://github.example.com/o/r/pull/485' })
  const marks = '✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR'
  const clock = callsAt(12, 7)
  const full = bandText(run, 200, clock)
  expect(full).toBe(`${marks}    turn 3/40 · 12 min · 7 calls · working · PR #485`)
  const noPr = bandText(run, full.length - 1, clock)
  expect(noPr).toBe(`${marks}    turn 3/40 · 12 min · 7 calls · working`)
  const noCalls = bandText(run, noPr.length - 1, clock)
  expect(noCalls).toBe(`${marks}    turn 3/40 · 12 min · working`)
  const short = bandText(run, noCalls.length - 1, clock)
  expect(short).toBe(`${marks}    turn 3/40 · 12 min`)
  for (const columns of [short.length - 1, 54]) {
    expect(bandText(run, columns, clock).split('\n')[1], String(columns)).toBe('turn 3/40 · 12 min · 7 calls · working · PR #485')
  }
  // Line 2 itself gives up the PR number, the calls, the minutes, then the turn.
  const second = (columns: number) => bandText(run, columns, clock).split('\n')[1]
  expect(second('turn 3/40 · 12 min · 7 calls · working'.length)).toBe('turn 3/40 · 12 min · 7 calls · working')
  expect(second('turn 3/40 · 12 min · 7 calls · working'.length - 1)).toBe('turn 3/40 · 12 min · working')
  expect(second('turn 3/40 · 12 min · working'.length - 1)).toBe('turn 3/40 · working')
  expect(second('turn 3/40 · working'.length - 1)).toBe('working')
})

test('bandText keeps a state that says more than working, and takes two lines for it', () => {
  const run = runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x' })
  const text = bandText(run, 60)
  expect(text).toContain('stuck: see ')
})

test('the band at a goal start stays on one line beside a docked pane, and shows the calls where they fit', () => {
  // The Spec goal's start: its marks take 39 columns, the gap 4, and the tail with the calls 37.
  const spec = runAt({ phase: phaseAt('Spec') })
  for (const columns of [74, 78, 80, 84]) {
    const text = bandText(spec, columns, callsAt(0, 5))
    expect(text.split('\n'), String(columns)).toHaveLength(1)
    expect(text, String(columns)).toContain('turn 1/15 · 0 min')
    expect(text.includes('5 calls'), String(columns)).toBe(columns >= 80)
  }
  expect(bandText(runAt({ phase: phaseAt('Intent') }), 76, callsAt(0, 0))).toBe('● INTENT  SPEC  PLAN  BUILD  TEST  PR    turn 1/10 · 0 min · working')
})

test('bandTail is the band without its phase chain: turn, minutes, calls, state and PR number, in their colors', () => {
  const run = runAt({ phase: phaseAt('Build'), turns: 2, prUrl: 'https://github.example.com/o/r/pull/485' })
  const tail = bandTail(run, callsAt(12, 7))
  expect(tail.map(part => part.text).join('')).toBe('turn 3/40 · 12 min · 7 calls · working · PR #485')
  expect(tail.find(part => part.text === 'working')).toEqual({ text: 'working', color: 'suggestion' })
  expect(tail.find(part => part.text === '7 calls')).toEqual({ text: '7 calls', color: 'subtle' })
  expect(tail.some(part => part.text.includes('BUILD') || part.text.includes('→'))).toBe(false)
  const gate = runAt({ phase: phaseAt('Plan'), state: 'gate' })
  expect(
    bandTail(gate, callsAt(1, 1))
      .map(part => part.text)
      .join('')
  ).toBe('waiting: approve Plan with /goal-and-do next')
  expect(bandTail(runAt({ state: 'stopped' }))).toEqual([])
})

// A phase at its gate counts as current until approved

test('the band shows the gated phase as current, in the warning color, until its approval', () => {
  const gate = runAt({ phase: phaseAt('Spec'), state: 'gate' })
  expect(bandText(gate, 200)).toBe('✔ INTENT  ● SPEC  PLAN  BUILD  TEST  PR    waiting: approve Spec with /goal-and-do next')
  expect(
    bandParts(gate, 200)
      .flat()
      .find(part => part.text === '● SPEC')
  ).toEqual({ text: '● SPEC', color: 'warning', bold: true })
  const approved = approve(gate, approval('Spec'))
  expect(bandText(approved, 200)).toContain('✔ INTENT  ✔ SPEC  ● PLAN')
  expect(
    bandParts(approved, 200)
      .flat()
      .find(part => part.text === '✔ SPEC')
  ).toEqual({ text: '✔ SPEC', color: 'success' })
  // A stuck phase keeps its own mark.
  expect(bandText(runAt({ phase: phaseAt('Spec'), state: 'blocked' }), 200)).toContain('✖ SPEC')
  expect(bandText(runAt({ phase: phaseAt('Spec'), state: 'interrupted' }), 200)).toContain('● SPEC')
  expect(
    bandParts(runAt({ phase: phaseAt('Spec'), state: 'interrupted' }), 200)
      .flat()
      .find(part => part.text === '● SPEC')?.color
  ).toBe('claude')
})

// The trace chain's IDs

test('traceParts gives each BAC and AC ID a button, and every part the color of its line', () => {
  const rows = traceRows(DEMO_INTENT, demoSpec(SPLIT, { scope: ['- BAC-3 (out of scope): later.'] }), DEMO_TEST)
  rows.push({ id: 'BAC-9', kind: 'not in intent', acs: [] }, { id: 'no BAC', kind: 'no bac', acs: [{ id: 'AC-7' }] })
  expect(traceLines(rows)).toEqual([
    { text: 'BAC-1 → AC-1 ✔, AC-2 ✔, AC-3 ✔' },
    { text: 'BAC-2 → AC-4 ✔, AC-5 ✔' },
    { text: 'BAC-3 → AC-6 ✔ (also out of scope)', color: 'warning' },
    { text: 'BAC-9 → not in intent.md', color: 'warning' },
    { text: 'no BAC: AC-7' },
  ])
  for (const row of rows) {
    const parts = traceParts(row)
    for (const part of parts) expect(part.color).toBe(parts[0]?.color)
  }
  const first = traceParts(rows[0]!)
  expect(first.filter(part => part.button !== undefined).map(part => [part.text, part.button])).toEqual([
    ['BAC-1', 'BAC-1'],
    ['AC-1', 'AC-1'],
    ['AC-2', 'AC-2'],
    ['AC-3', 'AC-3'],
  ])
  const none = traceParts({ id: 'no BAC', kind: 'no bac', acs: [{ id: 'AC-7' }] })
  expect(none.filter(part => part.button !== undefined).map(part => part.text)).toEqual(['AC-7'])
  expect(
    traceParts({ id: 'BAC-2', kind: 'none', acs: [] })
      .filter(part => part.button !== undefined)
      .map(part => part.text)
  ).toEqual(['BAC-2'])
})

test('criterionTexts gives a BAC its line from intent.md and an AC its Given, When and Then from spec.md', () => {
  const texts = criterionTexts(DEMO_INTENT, demoSpec(SPLIT))
  expect(texts['BAC-1']).toEqual(['Given a clerk, when they look at a premium, then it shows two decimals.'])
  expect(texts['AC-2']).toEqual([
    'Given a premium with one decimal place, such as `10.5`',
    'When it is formatted',
    'Then the result shows exactly two decimals, with the amount `10.50`.',
  ])
  expect(texts['AC-6']?.[0]).toBe('Given the output of `annual_premium(10.0)`')
  expect(texts['AC-9']).toBeUndefined()
  const bold = criterionTexts('## Business acceptance criteria\n\n- **BAC-4**: Given x, when y, then z.\n- BAC-5:\n', '')
  expect(bold['BAC-4']).toEqual(['Given x, when y, then z.'])
  expect(bold['BAC-5']).toBeUndefined()
  const empty = criterionTexts('', '### AC-1 (BAC-1)\n\n### AC-2 (BAC-1)\n\n- Given a\n')
  expect(empty['AC-1']).toBeUndefined()
  expect(empty['AC-2']).toEqual(['Given a'])
})

test('criterionTexts reads a spec.md of 100,000 lines under one AC in well under a second', () => {
  const spec = `### AC-1 (BAC-1)\n\n- Given a\n${'x\n'.repeat(100_000)}`
  const started = Date.now()
  const texts = criterionTexts(`## Business acceptance criteria\n\n- BAC-1: Given ${'y'.repeat(1_000_000)}\n`, spec)
  expect(Date.now() - started).toBeLessThan(300)
  expect(texts['AC-1']).toEqual(['Given a'])
  expect(Array.from(texts['BAC-1']?.[0] ?? '').length).toBe(CRITERION_CHARS + 1)
})

test('criterionTexts keeps at most 12 lines and 1,200 characters per criterion, then …', () => {
  expect(CRITERION_LINES).toBe(12)
  expect(CRITERION_CHARS).toBe(1200)
  const many = `### AC-1 (BAC-1)\n\n${Array.from({ length: 20 }, (_, i) => `- Then ${i}`).join('\n')}\n`
  const lines = criterionTexts('', many)['AC-1'] ?? []
  expect(lines).toHaveLength(12)
  expect(lines[10]).toBe('Then 10')
  expect(lines[11]).toBe('Then 11 …')
  const long = `### AC-1 (BAC-1)\n\n- Given ${'a'.repeat(700)}\n- When ${'b'.repeat(700)}\n- Then c\n`
  const cut = criterionTexts('', long)['AC-1'] ?? []
  expect(cut).toHaveLength(2)
  expect(cut.join('').length).toBe(CRITERION_CHARS + 1)
  expect(cut[1]?.endsWith('b…')).toBe(true)
  expect(criterionTexts('', '### AC-1 (BAC-1)\n\n- Given 😀😀\n')['AC-1']).toEqual(['Given 😀😀'])
  const exact = `### AC-1 (BAC-1)\n\n${Array.from({ length: 12 }, (_, i) => `- Then ${i}`).join('\n')}\n`
  expect(criterionTexts('', exact)['AC-1']?.[11]).toBe('Then 11')
})

test('criterionTexts stops an AC at the end of its Given, When and Then lines', () => {
  const spec = [
    '### AC-1 (BAC-1)',
    '',
    '- Given a',
    '',
    '- When b',
    '- And c',
    '- Then d',
    '- But e',
    'Note: this AC also covers the edge case.',
    '- Then not this one',
    '### AC-2 (BAC-1)',
    '',
    '- **Given** f',
    '```',
    '# not a heading',
    '```',
    '| a | b |',
    '### AC-3 (BAC-1)',
    '',
    'Some prose first.',
    '- Given g',
  ].join('\n')
  const texts = criterionTexts('', spec)
  expect(texts['AC-1']).toEqual(['Given a', 'When b', 'And c', 'Then d', 'But e'])
  expect(texts['AC-2']).toEqual(['**Given** f'])
  // Prose before the first Given counts nothing.
  expect(texts['AC-3']).toEqual(['Given g'])
})

test('criterionTexts keeps the indented rest of a step that wraps onto the next line', () => {
  const spec = [
    '### AC-1 (BAC-1)',
    '',
    '- Given a premium of 10.5',
    '- Then the result shows two decimals,',
    '  with the amount 10.50.',
    '',
    '  An indented note after a blank line.',
    '- Then more',
    '',
    '### AC-2 (BAC-1)',
    '',
    `- Then ${'a'.repeat(1_190)}`,
    `  ${'b'.repeat(50)}`,
  ].join('\n')
  const texts = criterionTexts('', spec)
  expect(texts['AC-1']).toEqual(['Given a premium of 10.5', 'Then the result shows two decimals, with the amount 10.50.'])
  const cut = texts['AC-2'] ?? []
  expect(cut).toHaveLength(1)
  expect(Array.from(cut[0] ?? '').length).toBe(CRITERION_CHARS + 1)
  expect(cut[0]?.endsWith('b…')).toBe(true)
})

// The band on one line, for a band with room for one row

test('bandLine puts the state first, then the turn, the minutes and the calls, then the phase chain', () => {
  const text = (run: Run, columns: number, clock?: { startedAt: number; now: number; calls?: number }) =>
    bandLine(run, columns, clock)
      .map(part => part.text)
      .join('')
  const gate = runAt({ phase: phaseAt('Intent'), state: 'gate' })
  expect(text(gate, 200)).toBe('waiting: approve Intent with /goal-and-do next    ● INTENT  SPEC  PLAN  BUILD  TEST  PR')
  expect(text(gate, 40)).toBe('waiting: approve Intent with /goal-and-d')
  const running = runAt({ phase: phaseAt('Spec'), turns: 0 })
  expect(text(running, 200, callsAt(2, 5))).toBe('working · turn 1/15 · 2 min · 5 calls    ✔ INTENT  ● SPEC  PLAN  BUILD  TEST  PR')
  expect(bandLine(running, 200, callsAt(2, 5))[0]).toEqual({ text: 'working', color: 'suggestion' })
  for (const columns of [10, 30, 76, 120]) expect(text(gate, columns).length).toBeLessThanOrEqual(columns)
  expect(bandLine(runAt({ state: 'stopped' }), 80)).toEqual([])
})

test('isBranchName takes plain names only: no leading dash, no .., no shell characters', () => {
  for (const name of ['main', 'feat/goal-and-do', 'release/1.2', 'a_b.c-d']) expect(isBranchName(name), name).toBe(true)
  for (const name of ['', 'HEAD', '-x', '--upload-pack=x', 'a..b', '../main', 'a b', 'a;b', 'a$(x)', 'a`b`', 'ä', 'a:b', 'a~1', 'a^']) {
    expect(isBranchName(name), name).toBe(false)
  }
})

// A request from a file

test('requestTitle takes the first heading, else the first line with text', () => {
  expect(requestTitle('Some intro\n\n# Format premium amounts\n\nMore.')).toBe('Format premium amounts')
  expect(requestTitle('## Second level\n# First')).toBe('Second level')
  expect(requestTitle('\n\n  Add a function that formats amounts.  \nMore')).toBe('Add a function that formats amounts.')
  expect(requestTitle('')).toBe('')
  expect(freeformId(requestTitle('# Format premium amounts\n'), NOW)).toBe('CH-20261029-format-premium-amounts')
  // A heading that reads like a ticket key still gives a free-text ID.
  expect(freeformId('ABC-43224', NOW)).toBe('CH-20261029-abc-43224')
})

test('requestFileParts reads the text below a front matter that holds base alone, and refuses any other key', () => {
  expect(requestFileParts('# Title\n\nText.\n')).toEqual({ text: '# Title\n\nText.' })
  expect(requestFileParts('---\nbase: feat/goal-and-do\n---\n\n# Title\n')).toEqual({ text: '# Title', base: 'feat/goal-and-do' })
  expect(requestFileParts('---\n\n---\nText')).toEqual({ text: 'Text' })
  expect(requestFileParts('\uFEFF---\nbase: main\n---\nText')).toEqual({ text: 'Text', base: 'main' })
  for (const bad of [
    '---\nbase: main\ntitle: x\n---\nText',
    '---\ntitle: x\n---\nText',
    '---\nbase: main\n',
    '---\nbase: a b\n---\nT',
    '---\nbase: a\nbase: b\n---\nT',
  ]) {
    expect(requestFileParts(bad), bad).toBe('bad front matter')
  }
})

// High-risk questions

test('highRiskItems: reads the front matter list; none and a missing line give none', () => {
  expect(highRiskItems('---\nhigh-risk: Personal data; Money\n---\n')).toEqual(['Personal data', 'Money'])
  expect(highRiskItems('---\nhigh-risk: none\n---\n')).toEqual([])
  expect(highRiskItems('---\nphase: intent\n---\n')).toEqual([])
})

const riskIntent = (...points: string[]) => ['---', 'high-risk: Personal data', '---', '', '## Open questions', '', ...points, ''].join('\n')

for (const [name, points, waits] of [
  ['an open question', ['- Personal data: who may see it?'], ['Personal data']],
  ['an answer under it', ['- Personal data: who may see it?', '  Answer (2026-10-29): "Brokers."'], []],
  ['a top-level answer item', ['- Personal data: who may see it?', '- Answer (2026-10-29): "Brokers."'], []],
  ['a Decided line', ['- Personal data: who may see it?', '  Decided (the person, 2026-10-29): brokers.'], []],
  ['Not known yet', ['- Personal data: who may see it?', '  Answer (2026-10-29): "Not known yet (stays open for the ticket\'s owner)"'], ['Personal data']],
  ['no question for the item', ['- Which formats?'], ['Personal data']],
  ['bold and another case', ['- **personal data:** who may see it?', '  Answer (2026-10-29): "Brokers."'], []],
  ['an answer under the next question only', ['- Personal data: who?', '- Which formats?', '  Answer (2026-10-29): "CSV."'], ['Personal data']],
] as [string, string[], string[]][]) {
  test(`highRiskUnanswered: ${name}`, () => {
    expect(highRiskUnanswered(riskIntent(...points))).toEqual(waits)
  })
}

// The request in the pane's header

test('ticketLink: a browse URL links with its key; a key alone, free text and unsafe URLs do not', () => {
  expect(ticketLink('https://jira.example.com/browse/ABC-1')).toEqual({ href: 'https://jira.example.com/browse/ABC-1', key: 'ABC-1' })
  expect(ticketLink('http://jira.example.com:8080/browse/ABC-1/')).toEqual({ href: 'http://jira.example.com:8080/browse/ABC-1/', key: 'ABC-1' })
  expect(ticketLink('ABC-1')).toBeUndefined()
  expect(ticketLink('Export the list')).toBeUndefined()
  expect(ticketLink('javascript:alert(1)//ABC-1')).toBeUndefined()
  expect(ticketLink('https://jira.example.com/browse/ABC-1"onclick')).toBeUndefined()
  expect(ticketLink('https://jira.example.com/browse/ABC-1?focused=1')).toBeUndefined()
})

test('isRequestFile: one word ending in .md', () => {
  expect(isRequestFile('docs/run-1.md')).toBe(true)
  expect(isRequestFile('fix the docs.md')).toBe(false)
  expect(isRequestFile('ABC-1')).toBe(false)
})

// Open points in subsections

const withSubsections = [
  '## Open points',
  '',
  '- A?',
  '  Decided: yes',
  '',
  '### Revision',
  '',
  '- B?',
  '- C?',
  '  Decided: no',
  '',
  '#### Deeper',
  '',
  '- D?',
  '',
  '## How to Test',
  '',
  '- E?',
  '',
].join('\n')

test('pointCounts: counts the items of subsections under Open points, up to the next heading of its level', () => {
  expect(pointCounts(withSubsections)).toEqual({ undecided: 2, total: 4 })
})

test('pointCounts: an open item right before a subsection heading still counts', () => {
  expect(pointCounts('## Open points\n\n- A?\n\n### More\n\n- B?\n  Decided: yes\n')).toEqual({ undecided: 1, total: 2 })
})

test('pointLines: stops at a heading of the same or a higher level, and is undefined without the heading', () => {
  expect(pointLines(withSubsections)?.join('\n')).not.toContain('E?')
  expect(pointLines('# Plan\n\n## Open points\n\n- A?\n\n# Next\n\n- B?\n')?.join('\n')).not.toContain('B?')
  expect(pointLines('## Tasks\n\n- A?\n')).toBeUndefined()
})

test('highRiskUnanswered: finds a high-risk question in a subsection', () => {
  const text = [
    '---',
    'high-risk: Money',
    '---',
    '',
    '## Open questions',
    '',
    '- Who?',
    '',
    '### From the ticket',
    '',
    '- Money: does a premium change?',
    '  Answer (2026-11-01): "No."',
    '',
  ].join('\n')
  expect(highRiskUnanswered(text)).toEqual([])
})

test('walkPrompt and intentWalkPrompt label each question with its place and the open count the side pane shows', () => {
  for (const prompt of [TEXTS.walkPrompt('ABC-1', 'spec.md', '2026-10-29'), TEXTS.intentWalkPrompt('ABC-1', '2026-10-29')]) {
    expect(prompt).toContain('Question <n> of <N> · <k>/<N> open')
    expect(prompt).toContain('counted as the side pane counts them')
  }
})

// A Departure line in spec.md

const DEPARTURE_DATE = '2026-11-02'
const departure = (text: string) => `Departure (${DEPARTURE_DATE}, decided at the Plan gate): ${text}`

// The line as the walk-through writes it: unindented, after a blank line, below the AC's last line, and below a Departure already there.
function withDeparture(spec: string, ac: number, ...lines: string[]): string {
  const rows = spec.split('\n')
  const heading = rows.findIndex(row => row.startsWith(`### AC-${ac} `))
  let last = heading
  for (let i = heading + 1; i < rows.length && !rows[i]?.startsWith('#'); i += 1) if ((rows[i] ?? '').trim() !== '') last = i
  rows.splice(last + 1, 0, '', ...lines)
  return rows.join('\n')
}

test('the Plan gate prompt gives the Departure line, its place and its tool, and no other phase prompt does', () => {
  const prompt = TEXTS.walkPrompt('ABC-1', 'plan.md', DEPARTURE_DATE)
  expect(prompt).toContain("A point that starts 'Departure AC-<n>:'")
  expect(prompt).toContain('into changes/ABC-1/spec.md with your Edit tool')
  expect(prompt).toContain(`'Departure (${DEPARTURE_DATE}, decided at the Plan gate): <what was decided and why>'`)
  expect(prompt).toContain("from the person's words and not yours")
  expect(prompt).toContain("unindented, after a blank line, below the last line of AC-<n>'s block and below any Departure line already there")
  expect(prompt).toContain("so the AC's heading and its Given, When and Then lines stay as they are")
  expect(prompt).toContain('A point the person skips or declines gets no Departure line.')
  expect(TEXTS.walkPrompt('ABC-1', 'plan.md', DEPARTURE_DATE, 'stuck')).toContain('Departure (2026-11-02, decided at the Plan gate)')
  for (const file of ['spec.md', 'build.md', 'test.md', 'pr.md']) expect(TEXTS.walkPrompt('ABC-1', file, DEPARTURE_DATE), file).not.toContain('Departure')
  expect(TEXTS.intentWalkPrompt('ABC-1', DEPARTURE_DATE)).not.toContain('Departure')
})

test('traceRows and criterionTexts ignore a Departure line placed as the prompt says', () => {
  const base = demoSpec(SPLIT)
  const texts = criterionTexts(DEMO_INTENT, base)
  const rows = traceRows(DEMO_INTENT, base, DEMO_TEST)
  const departures = [
    withDeparture(base, 2, departure('the euro sign goes after the amount, because the clerks read it so')),
    withDeparture(base, 3, departure('BAC-3 is served by AC-3 and by AC-1; Given a clerk, When they look, Then it shows euros')),
    withDeparture(base, 1, departure('first'), departure('second, stacked below the first')),
    withDeparture(base, 2, departure('x'), departure('y')).replace(departure('x'), departure('x with BAC-1 (dropped)')),
  ]
  for (const spec of departures) {
    expect(criterionTexts(DEMO_INTENT, spec)).toEqual(texts)
    expect(traceRows(DEMO_INTENT, spec, DEMO_TEST)).toEqual(rows)
    expect(traceRows(DEMO_INTENT, spec, '')).toEqual(traceRows(DEMO_INTENT, base, ''))
    expect(spec).toContain('\n\nDeparture (')
  }
})

test('the Departure line leaves the AC heading and its Given, When and Then lines as they are', () => {
  const base = demoSpec(SPLIT)
  const written = withDeparture(base, 2, departure('changed'))
  const kept = (text: string) => text.split('\n').filter(line => !line.startsWith('Departure'))
  // Only blank lines and the Departure line are new.
  expect(kept(written).filter(line => line.trim() !== '')).toEqual(kept(base).filter(line => line.trim() !== ''))
  const rows = written.split('\n')
  const at = rows.findIndex(row => row.startsWith('Departure'))
  expect(rows[at - 1]).toBe('')
  expect(rows[at - 2]).toMatch(/^- Then /)
  expect(rows[at]).toBe(departure('changed'))
})

test('a Departure line that breaks the format is not ignored: an indented line right under a step is appended to it', () => {
  const base = demoSpec(SPLIT)
  const rows = base.split('\n')
  const then = rows.findIndex((row, index) => index > rows.findIndex(r => r.startsWith('### AC-2 ')) && row.startsWith('- Then '))
  rows.splice(then + 1, 0, `  ${departure('indented, no blank line')}`)
  expect(criterionTexts(DEMO_INTENT, rows.join('\n'))['AC-2']?.at(-1)).toContain('Departure')
})

test('parseArgs takes --strict as the first word or right after --base, and refuses it anywhere it cannot start a request', () => {
  expect(parseArgs('--strict fix it')).toEqual({ kind: 'start', input: 'fix it', strict: true })
  expect(parseArgs('--strict --base develop fix it')).toEqual({ kind: 'start', input: 'fix it', base: 'develop', strict: true })
  expect(parseArgs('--base develop --strict fix it')).toEqual({ kind: 'start', input: 'fix it', base: 'develop', strict: true })
  expect(parseArgs('  --base   develop   --strict   ABC-1 ')).toEqual({ kind: 'start', input: 'ABC-1', base: 'develop', strict: true })
  expect(parseArgs('--base develop fix the --strict flag')).toEqual({ kind: 'start', input: 'fix the --strict flag', base: 'develop' })
  expect(parseArgs('--strict --strict fix it').kind).toBe('misplaced strict')
  expect(parseArgs('--strict --base').kind).toBe('misplaced base')
  for (const text of [
    '--strict',
    '--strict stop',
    '--strict allow local',
    '--strict=1 fix',
    '--base main --strict',
    '--base main --strict stop',
    '--base main --strict --strict fix it',
    '--base main --strict=1 fix it',
    '--strict --base main --strict fix it',
    'ABC-1 --strict',
    'level --strict',
  ]) {
    expect(parseArgs(text).kind, text).toBe('misplaced strict')
  }
  expect(parseArgs('fix the --strict flag')).toEqual({ kind: 'start', input: 'fix the --strict flag' })
})

test('parseArgs reads level strict and level review as a subcommand, and refuses other words after level', () => {
  expect(parseArgs(' Level   REVIEW ')).toEqual({ kind: 'level', level: 'review' })
  expect(parseArgs('level strict')).toEqual({ kind: 'level', level: 'strict' })
  for (const text of ['level', 'level high', 'level strict now']) expect(parseArgs(text).kind, text).toBe('subcommand words')
  expect(parseArgs('level --base main').kind).toBe('misplaced base')
})

test('newRun starts at strict unless a level is given', () => {
  const fields = {
    id: 'ABC-1',
    input: 'x',
    source: 'freeform',
    base: 'main',
    now: 1,
    env: { claudeCode: '2.1.316', plugin: '0.8.0', provider: 'anthropic', permissionMode: 'default' },
  } as const
  expect(newRun(fields).guardLevel).toBe('strict')
  expect(newRun({ ...fields, level: 'review' }).guardLevel).toBe('review')
})

test('the band shows review and the count of denials at the review level only', () => {
  const base = {
    ...newRun({
      id: 'ABC-1',
      input: 'x',
      source: 'freeform',
      base: 'main',
      now: 1,
      env: { claudeCode: '2.1.316', plugin: '0.8.0', provider: 'anthropic', permissionMode: 'default' },
    }),
    phase: 3,
  }
  const strict = { ...base, deniedCount: 2 }
  const review = { ...base, guardLevel: 'review' as const }
  expect(bandText(strict, 200)).not.toMatch(/review|denied/)
  expect(bandText(review, 200)).toContain('review')
  expect(bandText(review, 200)).not.toContain('denied')
  expect(bandText({ ...review, deniedCount: 3 }, 200)).toContain('3 denied')
  expect(bandText({ ...review, deniedCount: 3, guardLevel: 'REVIEW' as never }, 200)).not.toContain('review')
})

test('summaryHead names the guard level only when it is given', () => {
  expect(TEXTS.summaryHead('ABC-1', 125 * 60000, 351_000, 50, 'review')).toBe(
    '✔ ABC-1 finished in 2 h 5 min · 351k tokens (input plus output) · 50 goal turns · Guard level: review'
  )
})

// PR 47's review: the PR goal fixed the cap at 3, so a reset count or a raised cap changed nothing for the agent.
test('the PR goal names the cap and the count of fix pushes the run holds', () => {
  expect(goalFor('PR', 'ABC-1')).toContain('at most 3 fix pushes in all, 0 done so far')
  expect(goalFor('PR', 'ABC-1', { fixPushes: 3, fixCap: 6 })).toContain('at most 6 fix pushes in all, 3 done so far')
  expect(goalFor('PR', 'ABC-1', { fixPushes: 0, fixCap: 3 })).toBe(goalFor('PR', 'ABC-1'))
  const longest = 'CH-20261029-' + 'a'.repeat(30)
  expect(goalFor('PR', longest, { fixPushes: 9, fixCap: 9 }).length <= 500).toBe(true)
  for (const phase of ['Intent', 'Spec', 'Plan', 'Build', 'Test'] as const) {
    expect(goalFor(phase, 'ABC-1', { fixPushes: 3, fixCap: 6 })).toBe(goalFor(phase, 'ABC-1'))
  }
})

// The author's request (November 2, 2026): during a walk-through, a way back to the question before.
test('walkPrompt and intentWalkPrompt offer a way back to the question before, from the second question on', () => {
  for (const prompt of [
    TEXTS.walkPrompt('ABC-1', 'spec.md', '2026-10-29'),
    TEXTS.intentWalkPrompt('ABC-1', '2026-10-29'),
    TEXTS.walkPrompt('ABC-1', 'build.md', '2026-10-29', 'stuck'),
  ]) {
    expect(prompt).toContain("From the second question on, offer 'Back to question <n-1>' as the last option")
    expect(prompt).toContain('replace its line instead of adding one')
    expect(prompt).toContain('at most four options in all')
  }
})

// PR 50's second review: --strict after a ticket or a request file with --base, and the refusal text of level.
test('with --base, a --strict after a ticket or a request file is refused, as without --base', () => {
  expect(parseArgs('--base main ABC-1 --strict').kind).toBe('misplaced strict')
  expect(parseArgs('--base main docs/request.md --strict').kind).toBe('misplaced strict')
  expect(parseArgs('--base develop fix the --strict flag')).toEqual({ kind: 'start', input: 'fix the --strict flag', base: 'develop' })
})

test('the refusal for level names its two forms', () => {
  const text = TEXTS.subcommandWords('level')
  expect(text).toContain('level strict')
  expect(text).toContain('level review')
  expect(text).not.toContain('takes no more words')
})
