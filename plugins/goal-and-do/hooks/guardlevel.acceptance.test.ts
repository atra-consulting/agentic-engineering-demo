import { expect, test } from 'claude-code/testing'

import type { DeniedCall, GuardLevel, LevelChange, Run } from '../types'
import { guard, reasonKeyOf, REASONS } from './guard'
import type { GuardResult } from './level'
import { afterDenial, announceLevel, guardAt, guardLevelOf, LEVEL_NOTICE, levelLine, MAX_DENIED_CALLS, startLevel, switchLevel } from './level'
import { bandText, newRun, parseArgs, TEXTS } from './phases'
import { redactSecrets } from './scan'
import { formatUsage } from './usage'

const INTENT = 0
const SPEC = 1
const PLAN = 2
const BUILD = 3
const TEST = 4
const PR = 5
const LEVELS: GuardLevel[] = ['strict', 'review']
const ACTIVE_STATES = ['running', 'gate', 'blocked', 'capped', 'interrupted'] as const
const WIDE = 200

type Call = Parameters<typeof guardAt>[0]
type Ctx = Parameters<typeof guardAt>[1]
type Denied = Parameters<typeof afterDenial>[1]
type Deny = Extract<GuardResult, { verdict: 'deny' }>

function makeRun(level: GuardLevel | undefined, overrides: Partial<Run> = {}): Run {
  const base = newRun({
    id: 'ABC-1',
    input: 'x',
    source: 'freeform',
    base: 'main',
    now: 1_000,
    env: { claudeCode: '2.1.316', plugin: '0.8.0', provider: 'anthropic', permissionMode: 'default' },
    ...(level === undefined ? {} : { level }),
  })
  return { ...base, phase: BUILD, state: 'running', ...overrides }
}

const PHASE_NAMES = ['Intent', 'Spec', 'Plan', 'Build', 'Test', 'PR'] as const

// The guard's context names the phase; a run holds its index.
// A spy the runner doesn't give: it records each call's arguments.
function spy(): { fn: (text: string) => undefined; calls: string[][] } {
  const calls: string[][] = []
  return { fn: (text: string) => void calls.push([text]), calls }
}

function ctxFor(phase: number, lockedPaths: string[] = []): Ctx {
  return { active: true, phase: PHASE_NAMES[phase] ?? 'Intent', id: 'ABC-1', lockedPaths, root: '/repo', home: '/home/dev', base: 'main' }
}

const bash = (command: string): Call => ({ tool: 'Bash', input: { command } })

const READ_ENV: Call = { tool: 'Read', input: { file_path: '/repo/.env' } }
const READ_NETRC: Call = { tool: 'Read', input: { file_path: '/home/dev/.netrc' } }
const WRITE_STEERING: Call = { tool: 'Write', input: { file_path: '/repo/CLAUDE.md', content: 'x' } }
const WEB_FETCH: Call = { tool: 'WebFetch', input: { url: 'https://example.test/' } }
const MCP_WRITE: Call = { tool: 'mcp__jira__addComment', input: {} }
const EDIT_LOCKED_TEST: Call = { tool: 'Edit', input: { file_path: '/repo/tests/acceptance/a.test.ts', old_string: 'a', new_string: 'b' } }
const LOCKED = ['tests/acceptance/a.test.ts']

function denyOf(result: GuardResult): Deny {
  expect(result.verdict).toBe('deny')
  if (result.verdict !== 'deny') throw new Error(`expected a deny, got ${result.verdict}`)
  return result
}

function deniedFor(call: Call, phase = BUILD): Denied {
  const result = denyOf(guardAt(call, ctxFor(phase), 'strict'))
  const command = typeof call.input.command === 'string' ? call.input.command : undefined
  return { reason: result.reason, key: result.key ?? 'unknown', tool: call.tool, ...(command === undefined ? {} : { command }) }
}

// The guard's own result, whatever its shape, holds the same reason text.
function expectSameReasonAsGuard(call: Call, ctx: Ctx, result: Deny) {
  expect(JSON.stringify(guard(call, ctx))).toContain(JSON.stringify(result.reason))
}

function expectDenyAtBothLevels(call: Call, ctx: Ctx): { strict: Deny; review: Deny } {
  const strict = denyOf(guardAt(call, ctx, 'strict'))
  const review = denyOf(guardAt(call, ctx, 'review'))
  expect(review.reason).toBe(strict.reason)
  expect(review.key).toBe(strict.key)
  expect(review.blocks).toBe(false)
  expectSameReasonAsGuard(call, ctx, strict)
  return { strict, review }
}

function expectPassAtBothLevels(command: string, phase: number) {
  for (const level of LEVELS) {
    const result = guardAt(bash(command), ctxFor(phase), level)
    expect(result.verdict).toBe('pass')
    expect(result.blocks).toBe(false)
  }
}

function startArgs(text: string) {
  const args = parseArgs(text)
  expect(args.kind).toBe('start')
  if (args.kind !== 'start') throw new Error(`expected a start, got ${args.kind}`)
  return args
}

function withoutLevel(run: Run): Run {
  const legacy: Run = { ...run }
  delete legacy.guardLevel
  return legacy
}

// Two calls of bandText may straddle a clock tick; the legacy band must match one of the two around it.
function expectBandAsBefore(run: Run) {
  const before = bandText(run, WIDE)
  const legacy = bandText(withoutLevel(run), WIDE)
  const after = bandText(run, WIDE)
  expect([before, after]).toContain(legacy)
}

const token = () => ['gh', 'p_', 'a'.repeat(36)].join('')

// AC-1

for (const [name, call, key] of [
  ['a steering file write', WRITE_STEERING, 'steeringFile'],
  ['an outbound tool', WEB_FETCH, 'outbound'],
  ['an MCP write tool the plan does not name', MCP_WRITE, 'mcpWrite'],
] as const) {
  test(`AC-1: at review, ${name} in Build is denied with the guard's reason and does not block`, () => {
    const review = denyOf(guardAt(call, ctxFor(BUILD), 'review'))
    const strict = denyOf(guardAt(call, ctxFor(BUILD), 'strict'))
    expect(review.key).toBe(key)
    expect(review.reason).toBe(strict.reason)
    expect(review.blocks).toBe(false)
    expectSameReasonAsGuard(call, ctxFor(BUILD), review)
  })

  test(`AC-1: at review, a denial of ${name} leaves the run running in its phase`, () => {
    const run = makeRun('review')
    const next = afterDenial(run, deniedFor(call), 2_000)
    expect(next.state).toBe('running')
    expect(next.phase).toBe(BUILD)
    expect(next.reason).toBe(run.reason)
    expect(next.deniedCount).toBe(1)
  })
}

test('AC-1: at review, an outbound tool is denied without blocking in every phase before the PR phase', () => {
  for (const phase of [INTENT, SPEC, PLAN, BUILD, TEST]) {
    const result = denyOf(guardAt(WEB_FETCH, ctxFor(phase), 'review'))
    expect(result.blocks).toBe(false)
    const next = afterDenial(makeRun('review', { phase }), { reason: result.reason, key: result.key ?? 'outbound', tool: 'WebFetch' }, 2_000)
    expect(next.state).toBe('running')
    expect(next.phase).toBe(phase)
  }
})

test('AC-1: several denials in a row at review are each denied, counted and listed, and none stops the phase', () => {
  let run = makeRun('review')
  const calls = [WRITE_STEERING, WEB_FETCH, MCP_WRITE, READ_ENV]
  calls.forEach((call, i) => {
    expect(guardAt(call, ctxFor(BUILD), 'review').verdict).toBe('deny')
    run = afterDenial(run, deniedFor(call), 2_000 + i)
    expect(run.state).toBe('running')
  })
  expect(run.deniedCount).toBe(4)
  expect((run.deniedCalls ?? []).map(entry => entry.key)).toEqual(['steeringFile', 'outbound', 'mcpWrite', 'envFile'])
  expect(run.phase).toBe(BUILD)
})

// AC-2

test('AC-2: at review, reading a named environment file is denied with the envFile reason and does not block', () => {
  const review = denyOf(guardAt(READ_ENV, ctxFor(BUILD), 'review'))
  const strict = denyOf(guardAt(READ_ENV, ctxFor(BUILD), 'strict'))
  expect(review.key).toBe('envFile')
  expect(review.reason).toBe(strict.reason)
  expect(review.blocks).toBe(false)
})

test('AC-2: at review, reading a credential store is denied with the credentialStore reason and does not block', () => {
  const review = denyOf(guardAt(READ_NETRC, ctxFor(BUILD), 'review'))
  const strict = denyOf(guardAt(READ_NETRC, ctxFor(BUILD), 'strict'))
  expect(review.key).toBe('credentialStore')
  expect(review.reason).toBe(strict.reason)
  expect(review.blocks).toBe(false)
})

test('AC-2: at review, a shell read of a named environment file is denied and does not block', () => {
  const review = denyOf(guardAt(bash('cat .env'), ctxFor(BUILD), 'review'))
  expect(review.blocks).toBe(false)
})

test('AC-2: at review, denials of an environment file and a credential store leave the run running and are listed', () => {
  let run = makeRun('review')
  run = afterDenial(run, deniedFor(READ_ENV), 2_000)
  expect(run.state).toBe('running')
  run = afterDenial(run, deniedFor(READ_NETRC), 2_001)
  expect(run.state).toBe('running')
  expect(run.phase).toBe(BUILD)
  const calls: DeniedCall[] = run.deniedCalls ?? []
  expect(calls.map(entry => [entry.key, entry.tool])).toEqual([
    ['envFile', 'Read'],
    ['credentialStore', 'Read'],
  ])
  expect(calls[0]?.command).toBeUndefined()
})

// AC-3

for (const [name, call, key] of [
  ['a named environment file', READ_ENV, 'envFile'],
  ['a credential store', READ_NETRC, 'credentialStore'],
] as const) {
  test(`AC-3: at strict, reading ${name} is denied and blocks`, () => {
    const strict = denyOf(guardAt(call, ctxFor(BUILD), 'strict'))
    expect(strict.key).toBe(key)
    expect(strict.blocks).toBe(true)
    expectSameReasonAsGuard(call, ctxFor(BUILD), strict)
  })

  test(`AC-3: at strict, a denial of ${name} ends the run blocked with that reason`, () => {
    const denied = deniedFor(call)
    const next = afterDenial(makeRun('strict'), denied, 2_000)
    expect(next.state).toBe('blocked')
    expect(next.reason).toBe(denied.reason)
    expect(next.deniedCount).toBe(1)
    expect(next.deniedCalls).toBeUndefined()
  })
}

// AC-4

test('AC-4: gh auth status is allowed in the PR phase at strict and at review', () => {
  expectPassAtBothLevels('gh auth status', PR)
})

for (const command of ['gh auth token', 'gh auth status --show-token']) {
  test(`AC-4: ${command} stays denied in the PR phase at both levels, since it reveals a token`, () => {
    expectDenyAtBothLevels(bash(command), ctxFor(PR))
  })
}

// AC-5

for (const command of [
  'gh api repos/o/r/pulls',
  'gh api -X GET repos/o/r/pulls',
  "gh api --method=GET repos/o/r/pulls/7 --paginate --jq '.[].number'",
  'gh api repos/o/r/pulls/7 --include',
]) {
  test(`AC-5: ${command} is allowed in the PR phase at strict and at review`, () => {
    expectPassAtBothLevels(command, PR)
  })
}

for (const [command, key] of [
  ['gh api -X POST repos/o/r/issues', 'apiWrite'],
  ['gh api repos/o/r/issues -f title=x', 'apiWrite'],
  ['gh api repos/o/r/issues -F n=1', 'apiWrite'],
  ['gh api --input body.json repos/o/r/issues', 'apiWrite'],
  ['gh api graphql -f query=x', 'apiWrite'],
  ['gh api graphql', 'ghForm'],
  ['gh api https://git.example/api/v3/user', 'ghForm'],
  ['gh api --hostname git.example repos/o/r/pulls', 'ghForm'],
  ["gh api -H 'Accept: x' repos/o/r/pulls", 'ghForm'],
] as const) {
  test(`AC-5: ${command} stays denied in the PR phase at both levels with key ${key}`, () => {
    const { strict } = expectDenyAtBothLevels(bash(command), ctxFor(PR))
    expect(strict.key).toBe(key)
    expect(strict.blocks).toBe(false)
  })
}

test('AC-5: outside the PR phase the gh api rules do not change at either level', () => {
  expectPassAtBothLevels('gh api repos/o/r/pulls', BUILD)
  const { strict } = expectDenyAtBothLevels(bash('gh api -X POST repos/o/r/issues'), ctxFor(BUILD))
  expect(strict.key).toBe('apiWrite')
})

// AC-6

for (const command of ['gh pr view', 'gh pr view 7', 'gh pr view https://git.example/o/r/pull/9', 'gh pr view 7 -R o/r']) {
  test(`AC-6: ${command} is allowed in the PR phase at strict and at review`, () => {
    expectPassAtBothLevels(command, PR)
  })
}

test('AC-6: gh pr view handed in through xargs stays denied in the PR phase at both levels', () => {
  expectDenyAtBothLevels(bash('echo 7 | xargs gh pr view'), ctxFor(PR))
})

// AC-7

test('AC-7: an edit of a locked acceptance test is denied at both levels with the same reason, not blocking at review', () => {
  const ctx = ctxFor(BUILD, LOCKED)
  expectDenyAtBothLevels(EDIT_LOCKED_TEST, ctx)
})

test('AC-7: an edit of a CI file is denied at both levels with the same reason, not blocking at review', () => {
  const edit: Call = { tool: 'Edit', input: { file_path: '/repo/.github/workflows/validate.yml', old_string: 'a', new_string: 'b' } }
  expectDenyAtBothLevels(edit, ctxFor(BUILD))
})

test('AC-7: a shell write to the run state is denied at both levels with the same reason, not blocking at review', () => {
  expectDenyAtBothLevels(bash('echo x > changes/ABC-1/run.json'), ctxFor(BUILD))
})

test('AC-7: a shell write to the approvals record is denied at both levels with the same reason, not blocking at review', () => {
  expectDenyAtBothLevels(bash('echo x > changes/ABC-1/approvals.md'), ctxFor(BUILD))
})

test('AC-7: a model call that tries to change the level through run.json is denied at both levels as a write to run state', () => {
  const viaShell = expectDenyAtBothLevels(bash("sed -i 's/strict/review/' changes/ABC-1/run.json"), ctxFor(BUILD))
  const viaWrite = expectDenyAtBothLevels(
    { tool: 'Write', input: { file_path: '/repo/changes/ABC-1/run.json', content: '{"guardLevel":"review"}' } },
    ctxFor(BUILD)
  )
  const plainShell = denyOf(guardAt(bash('echo x > changes/ABC-1/run.json'), ctxFor(BUILD), 'strict'))
  const plainWrite = denyOf(guardAt({ tool: 'Write', input: { file_path: '/repo/changes/ABC-1/run.json', content: '{}' } }, ctxFor(BUILD), 'strict'))
  expect(viaShell.strict.key).toBe(plainShell.key)
  expect(viaWrite.strict.key).toBe(plainWrite.key)
})

test('AC-7: a denied write to run state does not change the level of the run', () => {
  for (const level of LEVELS) {
    const next = afterDenial(makeRun(level), deniedFor(bash("sed -i 's/strict/review/' changes/ABC-1/run.json")), 2_000)
    expect(guardLevelOf(next)).toBe(level)
    expect(next.levelChanges ?? []).toEqual([])
  }
})

// AC-8

test('AC-8: a push to a target that is not permitted is denied in the PR phase at both levels with the same reason', () => {
  expectDenyAtBothLevels(bash('git push origin main'), ctxFor(PR))
})

for (const command of ['gh pr merge 7', 'gh pr ready 7', 'gh pr review 7']) {
  test(`AC-8: ${command} is denied in the PR phase at both levels with key pullRequest`, () => {
    const { strict, review } = expectDenyAtBothLevels(bash(command), ctxFor(PR))
    expect(strict.key).toBe('pullRequest')
    expect(review.key).toBe('pullRequest')
  })
}

test('AC-8: at review, a denied gh pr merge is listed and the PR phase goes on', () => {
  const next = afterDenial(makeRun('review', { phase: PR }), deniedFor(bash('gh pr merge 7'), PR), 2_000)
  expect(next.state).toBe('running')
  expect(next.phase).toBe(PR)
  expect(next.deniedCalls?.[0]?.key).toBe('pullRequest')
  expect(next.deniedCalls?.[0]?.command).toBe('gh pr merge 7')
})

// AC-9

test('AC-9: the run record holds the level of the run', () => {
  expect(makeRun('review').guardLevel).toBe('review')
  expect(makeRun('strict').guardLevel).toBe('strict')
  expect(makeRun(undefined).guardLevel).toBe('strict')
})

test('AC-9: the band of a review run shows the level', () => {
  expect(bandText(makeRun('review'), WIDE)).toContain('review')
})

test('AC-9: the band of a strict run is exactly as before and does not say review', () => {
  const run = makeRun('strict')
  expectBandAsBefore(run)
  expect(bandText(run, WIDE)).not.toContain('review')
})

test('AC-9: the level line names the level of the run', () => {
  expect(levelLine(makeRun('review'))).toBe('Guard level: review')
  expect(levelLine(makeRun('strict'))).toBe('Guard level: strict')
})

test('AC-9: a record with no level or an unknown value is restored as strict', () => {
  expect(guardLevelOf({})).toBe('strict')
  expect(guardLevelOf({ guardLevel: 'strict' })).toBe('strict')
  expect(guardLevelOf({ guardLevel: 'review' })).toBe('review')
  expect(guardLevelOf({ guardLevel: 'REVIEW' })).toBe('strict')
  expect(guardLevelOf({ guardLevel: 'lenient' })).toBe('strict')
  expect(guardLevelOf({ guardLevel: 1 })).toBe('strict')
  expect(guardLevelOf({ guardLevel: null })).toBe('strict')
  expect(levelLine({})).toBe('Guard level: strict')
  expect(levelLine({ guardLevel: 'other' })).toBe('Guard level: strict')
})

test('AC-9: a run restored from its run record after a restart keeps its level and its denied calls', () => {
  const run = afterDenial(makeRun('review'), deniedFor(READ_ENV), 2_000)
  const restored = JSON.parse(JSON.stringify(run)) as Run
  expect(guardLevelOf(restored)).toBe('review')
  expect(restored.deniedCalls).toEqual(run.deniedCalls)
  expect(bandText(restored, WIDE)).toContain('review')
})

// AC-10

for (const state of ACTIVE_STATES) {
  test(`AC-10: a switch from review to strict on a run that is ${state} is recorded and leaves the state as it is`, () => {
    const run = makeRun('review', { state })
    const next = switchLevel(run, 'strict', 5_000)
    const expected: LevelChange[] = [{ at: 5_000, from: 'review', to: 'strict' }]
    expect(next.guardLevel).toBe('strict')
    expect(next.levelChanges).toEqual(expected)
    expect(next.state).toBe(state)
    expect(next.reason).toBe(run.reason)
    expect(levelLine(next)).toBe('Guard level: strict')
  })
}

test('AC-10: a switch to the same level leaves the run unchanged', () => {
  const run = makeRun('review')
  expect(switchLevel(run, 'review', 5_000)).toEqual(run)
})

test('AC-10: a switch on a run that is not active leaves the run unchanged', () => {
  const run = makeRun('review', { state: 'done' as Run['state'] })
  expect(switchLevel(run, 'strict', 5_000)).toEqual(run)
})

test('AC-10: each switch is recorded in order with its time and from and to', () => {
  let run = makeRun('strict')
  run = switchLevel(run, 'review', 5_000)
  run = switchLevel(run, 'strict', 6_000)
  expect(run.levelChanges).toEqual([
    { at: 5_000, from: 'strict', to: 'review' },
    { at: 6_000, from: 'review', to: 'strict' },
  ])
})

test('AC-10: after a switch to strict the next denial of an environment file blocks the run', () => {
  const run = switchLevel(makeRun('review'), 'strict', 5_000)
  const denied = deniedFor(READ_ENV)
  const next = afterDenial(run, denied, 6_000)
  expect(next.state).toBe('blocked')
  expect(next.reason).toBe(denied.reason)
})

test('AC-10: after a switch to review the next denial of an environment file lets the run go on', () => {
  const run = switchLevel(makeRun('strict'), 'review', 5_000)
  const next = afterDenial(run, deniedFor(READ_ENV), 6_000)
  expect(next.state).toBe('running')
  expect(next.deniedCalls).toHaveLength(1)
})

test('AC-10: after a switch the band shows the new level', () => {
  const toReview = switchLevel(makeRun('strict'), 'review', 5_000)
  expect(bandText(toReview, WIDE)).toContain('review')
  const toStrict = switchLevel(makeRun('review'), 'strict', 5_000)
  expectBandAsBefore(toStrict)
  expect(bandText(toStrict, WIDE)).not.toContain('review')
})

test('AC-10: a switch while the run waits at a gate takes effect for the next guard call after the run goes on', () => {
  const atGate = switchLevel(makeRun('review', { state: 'gate' }), 'strict', 5_000)
  expect(atGate.state).toBe('gate')
  expect(guardLevelOf(atGate)).toBe('strict')
  const resumed: Run = { ...atGate, state: 'running' }
  expect(afterDenial(resumed, deniedFor(READ_ENV), 6_000).state).toBe('blocked')
})

test('AC-10: a switch on a blocked run leaves it blocked with its reason', () => {
  const blocked = afterDenial(makeRun('strict'), deniedFor(READ_ENV), 2_000)
  expect(blocked.state).toBe('blocked')
  const switched = switchLevel(blocked, 'review', 3_000)
  expect(switched.state).toBe('blocked')
  expect(switched.reason).toBe(blocked.reason)
  expect(switched.guardLevel).toBe('review')
})

test('AC-10: a switch from review to strict leaves the denied calls and the count in the run record', () => {
  let run = makeRun('review')
  run = afterDenial(run, deniedFor(READ_ENV), 2_000)
  run = afterDenial(run, deniedFor(WEB_FETCH), 2_001)
  const switched = switchLevel(run, 'strict', 3_000)
  expect(switched.deniedCalls).toEqual(run.deniedCalls)
  expect(switched.deniedCalls).toHaveLength(2)
  expect(switched.deniedCount).toBe(2)
  expect(switched.denials).toEqual(run.denials)
})

test('AC-10: the level command is parsed in any case and with any spaces', () => {
  expect(parseArgs('level strict')).toEqual({ kind: 'level', level: 'strict' })
  expect(parseArgs('level review')).toEqual({ kind: 'level', level: 'review' })
  expect(parseArgs('  LEVEL   Review  ')).toEqual({ kind: 'level', level: 'review' })
  expect(parseArgs('Level STRICT')).toEqual({ kind: 'level', level: 'strict' })
})

test('AC-10: the level command alone or with an unknown word is refused as subcommand words', () => {
  expect(parseArgs('level').kind).toBe('subcommand words')
  expect(parseArgs('level lenient').kind).toBe('subcommand words')
  expect(parseArgs('level review now').kind).toBe('subcommand words')
})

// AC-11

test('AC-11: at review the run record lists each denied call in order with phase, key, tool and time', () => {
  let run = makeRun('review')
  run = afterDenial(run, deniedFor(READ_ENV), 2_000)
  run = afterDenial(run, deniedFor(WRITE_STEERING), 2_001)
  run = afterDenial({ ...run, phase: TEST }, deniedFor(WEB_FETCH, TEST), 2_002)
  const calls: DeniedCall[] = run.deniedCalls ?? []
  expect(calls.map(entry => entry.key)).toEqual(['envFile', 'steeringFile', 'outbound'])
  expect(calls.map(entry => entry.tool)).toEqual(['Read', 'Write', 'WebFetch'])
  expect(calls.map(entry => entry.at)).toEqual([2_000, 2_001, 2_002])
  expect(String(calls[0]?.phase)).toMatch(/build/i)
  expect(String(calls[2]?.phase)).toMatch(/test/i)
  expect(run.deniedCount).toBe(3)
})

test('AC-11: the band of a review run shows the count of denials', () => {
  let run = makeRun('review')
  expect(bandText(run, WIDE)).not.toContain('denied')
  run = afterDenial(run, deniedFor(READ_ENV), 2_000)
  run = afterDenial(run, deniedFor(WEB_FETCH), 2_001)
  run = afterDenial(run, deniedFor(MCP_WRITE), 2_002)
  expect(bandText(run, WIDE)).toContain('3 denied')
})

test('AC-11: the band of a strict run with denials is exactly as before', () => {
  expectBandAsBefore(makeRun('strict', { deniedCount: 2 }))
})

test('AC-11: the last three denials are kept as phase and key', () => {
  let run = makeRun('review')
  ;[READ_ENV, WRITE_STEERING, WEB_FETCH, MCP_WRITE].forEach((call, i) => {
    run = afterDenial(run, deniedFor(call), 2_000 + i)
  })
  expect((run.denials ?? []).map(entry => entry.key)).toEqual(['steeringFile', 'outbound', 'mcpWrite'])
})

test('AC-11: the command text of a denied call goes through the secret scan', () => {
  const secret = token()
  const command = `curl -H 'Authorization: token ${secret}' https://example.test/`
  const outbound = denyOf(guardAt(WEB_FETCH, ctxFor(BUILD), 'strict'))
  const run = afterDenial(makeRun('review'), { reason: outbound.reason, key: 'outbound', tool: 'Bash', command }, 2_000)
  const stored = run.deniedCalls?.[0]?.command ?? ''
  expect(stored).toBe(redactSecrets(command))
  expect(stored).toContain('<removed: token>')
  expect(stored).not.toContain(secret)
  expect(JSON.stringify(run)).not.toContain(secret)
})

test('AC-11: the secret scan replaces a token and leaves other text unchanged', () => {
  const secret = token()
  expect(redactSecrets(`echo ${secret} done`)).toBe('echo <removed: token> done')
  expect(redactSecrets('gh pr merge 7')).toBe('gh pr merge 7')
})

test('AC-11: the list holds at most 200 entries, after that only the count rises', () => {
  expect(MAX_DENIED_CALLS).toBe(200)
  const denied = deniedFor(READ_ENV)
  let run = makeRun('review')
  for (let i = 0; i < 205; i++) run = afterDenial(run, denied, 10_000 + i)
  expect(run.deniedCount).toBe(205)
  expect(run.deniedCalls).toHaveLength(MAX_DENIED_CALLS)
  expect(run.deniedCalls?.[0]?.at).toBe(10_000)
  expect(run.deniedCalls?.[199]?.at).toBe(10_199)
  expect(run.state).toBe('running')
})

test('AC-11: a denial on a run that is not active leaves the run unchanged', () => {
  const run = makeRun('review', { state: 'done' as Run['state'] })
  expect(afterDenial(run, deniedFor(READ_ENV), 2_000)).toEqual(run)
})

// AC-12

for (const [name, call, key] of [
  ['an environment file', READ_ENV, 'envFile'],
  ['a credential store', READ_NETRC, 'credentialStore'],
  ['a steering file', WRITE_STEERING, 'steeringFile'],
  ['an outbound tool', WEB_FETCH, 'outbound'],
  ['an MCP write tool', MCP_WRITE, 'mcpWrite'],
] as const) {
  test(`AC-12: at strict, a denial of ${name} has the guard's verdict and reason and blocks the run`, () => {
    const result = denyOf(guardAt(call, ctxFor(BUILD), 'strict'))
    expect(result.key).toBe(key)
    expect(reasonKeyOf(result.reason)).toBe(result.key)
    expect(Object.keys(REASONS)).toContain(key)
    expect(result.blocks).toBe(true)
    expectSameReasonAsGuard(call, ctxFor(BUILD), result)
    const next = afterDenial(makeRun('strict'), deniedFor(call), 2_000)
    expect(next.state).toBe('blocked')
    expect(next.reason).toBe(result.reason)
    expect(next.deniedCalls).toBeUndefined()
  })
}

test('AC-12: at strict, a denial whose reason does not block today leaves the run running', () => {
  const merge = denyOf(guardAt(bash('gh pr merge 7'), ctxFor(PR), 'strict'))
  expect(merge.blocks).toBe(false)
  const next = afterDenial(makeRun('strict', { phase: PR }), deniedFor(bash('gh pr merge 7'), PR), 2_000)
  expect(next.state).toBe('running')
  expect(next.deniedCount).toBe(1)
})

test('AC-12: at strict, a call the guard passes still passes', () => {
  const result = guardAt(bash('gh api repos/o/r/pulls'), ctxFor(BUILD), 'strict')
  expect(result.verdict).toBe('pass')
  expect(result.blocks).toBe(false)
})

test('AC-12: a run started with strict asked for shows its level as strict', () => {
  const run = makeRun(startLevel(startArgs('--strict fix the login')))
  expect(run.guardLevel).toBe('strict')
  expect(levelLine(run)).toBe('Guard level: strict')
  expectBandAsBefore(run)
})

// AC-13

test('AC-13: --strict as the first word starts a run with strict asked for', () => {
  expect(parseArgs('--strict fix the login')).toEqual({ kind: 'start', input: 'fix the login', strict: true })
  expect(parseArgs('--strict --base develop fix the login')).toEqual({ kind: 'start', input: 'fix the login', base: 'develop', strict: true })
  expect(parseArgs('--base develop --strict fix the login')).toEqual({ kind: 'start', input: 'fix the login', base: 'develop', strict: true })
  expect(startArgs('--strict ABC-1').strict).toBe(true)
})

test('AC-13: a start line without --strict asks for nothing', () => {
  expect(startArgs('fix the login').strict).toBeUndefined()
  expect(startArgs('--base develop fix the login').strict).toBeUndefined()
})

for (const text of ['--strict', '--strict next', '--strict status', '--strict level review', '--strict=yes', 'ABC-1 --strict']) {
  test(`AC-13: a misplaced --strict is refused and no run begins: ${text}`, () => {
    expect(parseArgs(text).kind).toBe('misplaced strict')
  })
}

test('AC-13: --strict inside free text is plain text of the request', () => {
  const args = startArgs('fix the --strict flag in the parser')
  expect(args.strict).toBeUndefined()
  expect(args.input).toContain('--strict')
})

test('AC-13: the start level is strict when asked for and review otherwise', () => {
  expect(startLevel({ strict: true })).toBe('strict')
  expect(startLevel({})).toBe('review')
  expect(startLevel(startArgs('--strict fix the login'))).toBe('strict')
  expect(startLevel(startArgs('fix the login'))).toBe('review')
})

test('AC-13: the band and the run record show the start level from the start', () => {
  const review = makeRun(startLevel(startArgs('fix the login')))
  expect(review.guardLevel).toBe('review')
  expect(bandText(review, WIDE)).toContain('review')
  const strict = makeRun(startLevel(startArgs('--strict fix the login')))
  expect(strict.guardLevel).toBe('strict')
  expect(bandText(strict, WIDE)).not.toContain('review')
})

// AC-14

test('AC-14: the notice text is exact', () => {
  expect(LEVEL_NOTICE).toBe('Guard level: review. Add --strict to the start line for a measured run.')
})

test('AC-14: a run at review gives one toast and one log line with the notice and does not wait', () => {
  const toast = spy()
  const log = spy()
  announceLevel({ toast: toast.fn, log: log.fn }, startLevel(startArgs('fix the login')))
  expect(toast.calls).toEqual([[LEVEL_NOTICE]])
  expect(log.calls).toEqual([[LEVEL_NOTICE]])
})

test('AC-14: a run at strict gives no notice', () => {
  const toast = spy()
  const log = spy()
  announceLevel({ toast: toast.fn, log: log.fn }, 'strict')
  expect(toast.calls).toHaveLength(0)
  expect(log.calls).toHaveLength(0)
})

// AC-15

const IO = 1_500

test('AC-15: the first line of the end summary shows the level beside the measurements', () => {
  for (const level of LEVELS) {
    const head = TEXTS.summaryHead('ABC-1', 600_000, IO, 14, level)
    expect(head).toContain(`Guard level: ${level}`)
    expect(head).toContain('ABC-1')
  }
})

test('AC-15: the end summary without a level is as before', () => {
  expect(TEXTS.summaryHead('ABC-1', 600_000, IO, 14)).not.toContain('Guard level')
})

const BOOK: Parameters<typeof formatUsage>[0] = {
  schema: 'usage-1',
  rows: { Build: { models: { 'claude-sonnet-5-5': { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 } }, turns: 3, ms: 120_000 } },
}
const FOOTER = 'Counted from turn.complete.'

test('AC-15: the usage text starts with the level line and a blank line, then the same table', () => {
  const plain = formatUsage(BOOK, FOOTER)
  expect(plain).not.toContain('Guard level')
  for (const level of LEVELS) {
    const withLevel = formatUsage(BOOK, FOOTER, level)
    const lines = withLevel.split('\n')
    expect(lines[0]).toBe(`Guard level: ${level}`)
    expect(lines[1]).toBe('')
    expect(lines.slice(2)).toEqual(plain.split('\n'))
  }
})
