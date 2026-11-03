import { expect, test } from 'claude-code/testing'
import {
  FIX_CAP_MAX,
  FIX_CAP_START,
  FIX_CAP_STEP,
  afterPush,
  choose,
  countFixPushes,
  fixPushVerdict,
  fixStateOf,
  isFixSubject,
  stuckChoices,
} from './fixpushes'
import type { FixState, PushRecord } from './fixpushes'
import { afterStatus, countTurn, newRun, rerun, restored, stop } from './phases'

const ID = 'CH-20261102-sample-change'
const FIX = `fix(${ID}): unit-tests`
const RECORD = `docs(${ID}): pr record`

function went(...subjects: string[]): PushRecord {
  return { went: true, subjects }
}

function refused(...subjects: string[]): PushRecord {
  return { went: false, subjects }
}

function freshRun() {
  return newRun({ id: ID, input: 'sample input', source: 'freeform', base: 'main', now: 1_700_000_000_000, env: {} as never })
}

// AC-3

test('AC-3: at the cap, a push whose new commits include a fix commit is refused, and the reason names the cap', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  const verdict = fixPushVerdict(state, [`feat(${ID}): add parser`, FIX], ID)
  expect(verdict.allowed).toBe(false)
  if (!verdict.allowed) {
    expect(verdict.reason.length).toBeGreaterThan(0)
    expect(verdict.reason).toContain('3')
  }
})

test('AC-3: the count stays at three after the refused fourth push', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  const pushes = [went(FIX), went(FIX, FIX), went(`feat(${ID}): x`, FIX), refused(FIX)]
  expect(countFixPushes(pushes, ID)).toBe(3)
  expect(fixPushVerdict(state, [FIX], ID).allowed).toBe(false)
  expect(state).toEqual({ fixPushes: 3, fixCap: 3 })
})

test('AC-3: below the cap, a fix push is allowed, and after it went through the count goes up by one', () => {
  const state: FixState = { fixPushes: 2, fixCap: 3 }
  expect(fixPushVerdict(state, [FIX], ID)).toEqual({ allowed: true })
  expect(afterPush(state, [FIX], ID)).toEqual({ fixPushes: 3, fixCap: 3 })
})

test('AC-3: at the cap, a push without a fix commit is allowed, the cap is not a gate on pushes without a fix commit', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  expect(fixPushVerdict(state, [`feat(${ID}): add parser`], ID)).toEqual({ allowed: true })
  expect(fixPushVerdict(state, [], ID)).toEqual({ allowed: true })
})

test('AC-3: at the cap, a fix commit refuses the push even with the record commit inside', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  expect(fixPushVerdict(state, [RECORD, FIX], ID).allowed).toBe(false)
  expect(fixPushVerdict(state, [FIX, RECORD], ID).allowed).toBe(false)
})

test('AC-3: a count above the cap also refuses a fix push', () => {
  expect(fixPushVerdict({ fixPushes: 4, fixCap: 3 }, [FIX], ID).allowed).toBe(false)
})

test('AC-3: a subject is a fix subject when it starts with fix(<id>):, for this id only', () => {
  expect(isFixSubject(FIX, ID)).toBe(true)
  expect(isFixSubject(`fix(${ID}): `, ID)).toBe(true)
  expect(isFixSubject(`fix(CH-20261102-other-change): unit-tests`, ID)).toBe(false)
  expect(isFixSubject(`feat(${ID}): fix(${ID}): inside`, ID)).toBe(false)
  expect(isFixSubject(RECORD, ID)).toBe(false)
  expect(isFixSubject('', ID)).toBe(false)
})

// AC-4

test('AC-4: at the cap, the record push passes and the count does not change', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  expect(fixPushVerdict(state, [RECORD], ID)).toEqual({ allowed: true })
  expect(afterPush(state, [RECORD], ID)).toEqual({ fixPushes: 3, fixCap: 3 })
})

test('AC-4: the record push never counts, below the cap or above it', () => {
  expect(afterPush({ fixPushes: 1, fixCap: 3 }, [RECORD], ID)).toEqual({ fixPushes: 1, fixCap: 3 })
  expect(afterPush({ fixPushes: 0, fixCap: 3 }, [RECORD], ID)).toEqual({ fixPushes: 0, fixCap: 3 })
  expect(countFixPushes([went(RECORD)], ID)).toBe(0)
})

test('AC-4: a push with the record commit next to a non-fix commit passes at the cap and does not count', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  const subjects = [`docs(${ID}): update notes`, RECORD]
  expect(fixPushVerdict(state, subjects, ID)).toEqual({ allowed: true })
  expect(afterPush(state, subjects, ID)).toEqual({ fixPushes: 3, fixCap: 3 })
})

// AC-10

test('AC-10: a push with only fix commits counts once, however many fix commits it holds', () => {
  expect(countFixPushes([went(FIX)], ID)).toBe(1)
  expect(countFixPushes([went(FIX, FIX, `fix(${ID}): lint`)], ID)).toBe(1)
})

test('AC-10: a push with fix commits mixed with other commits counts once', () => {
  expect(countFixPushes([went(`feat(${ID}): add parser`, FIX, `docs(${ID}): notes`, `fix(${ID}): lint`)], ID)).toBe(1)
})

test('AC-10: fix commits made by a person count like any other fix commit', () => {
  // the count reads subjects only, the author plays no part: a person made this fix commit by hand
  expect(countFixPushes([went(`fix(${ID}): typo found by a reviewer`)], ID)).toBe(1)
  expect(countFixPushes([went(`fix(${ID}): typo found by a reviewer`), went(FIX)], ID)).toBe(2)
})

test('AC-10: a push without a commit that starts with fix(<id>): does not count', () => {
  expect(countFixPushes([went(`feat(${ID}): add parser`), went(RECORD), went()], ID)).toBe(0)
  expect(countFixPushes([went(`fix(CH-20261102-other-change): lint`)], ID)).toBe(0)
})

test('AC-10: a push the guard refused does not count, even with a fix commit', () => {
  expect(countFixPushes([refused(FIX)], ID)).toBe(0)
  expect(countFixPushes([went(FIX), refused(FIX, FIX), refused(`feat(${ID}): x`, FIX)], ID)).toBe(1)
})

test('AC-10: every case together counts each push that went through with a fix commit once', () => {
  const pushes = [
    went(FIX),
    went(`feat(${ID}): add parser`, FIX, `fix(${ID}): lint`),
    went(`fix(${ID}): typo found by a person`),
    went(`feat(${ID}): another feature`),
    went(RECORD),
    refused(FIX),
  ]
  expect(countFixPushes(pushes, ID)).toBe(3)
})

test('AC-10: no pushes give a count of zero', () => {
  expect(countFixPushes([], ID)).toBe(0)
})

test('AC-10: the guard and the cap read this one count, a round is a fix push', () => {
  const pushes = [went(FIX), went(FIX), went(FIX)]
  const count = countFixPushes(pushes, ID)
  expect(count).toBe(3)
  expect(fixPushVerdict({ fixPushes: count, fixCap: FIX_CAP_START }, [FIX], ID).allowed).toBe(false)
  expect(fixPushVerdict({ fixPushes: count - 1, fixCap: FIX_CAP_START }, [FIX], ID).allowed).toBe(true)
})

test('AC-10: afterPush counts a mixed push once and never changes the cap', () => {
  const state: FixState = { fixPushes: 1, fixCap: 6 }
  expect(afterPush(state, [`feat(${ID}): x`, FIX, FIX], ID)).toEqual({ fixPushes: 2, fixCap: 6 })
  expect(afterPush(state, [`feat(${ID}): x`], ID)).toEqual({ fixPushes: 1, fixCap: 6 })
})

// AC-11

test('AC-11: the cap starts at 3, grows by 3 and never passes 9', () => {
  expect(FIX_CAP_START).toBe(3)
  expect(FIX_CAP_STEP).toBe(3)
  expect(FIX_CAP_MAX).toBe(9)
})

test('AC-11: a run without the fields reads as a count of zero and the start cap', () => {
  expect(fixStateOf({})).toEqual({ fixPushes: 0, fixCap: FIX_CAP_START })
  expect(fixStateOf(freshRun())).toEqual({ fixPushes: 0, fixCap: FIX_CAP_START })
  expect(fixStateOf({ fixPushes: 2 })).toEqual({ fixPushes: 2, fixCap: FIX_CAP_START })
})

test('AC-11: a run restored from its saved state keeps the count and the cap from before the restore', () => {
  const run = { ...freshRun(), fixPushes: 2, fixCap: 6 }
  const back = restored(run)
  expect(back.state).toBe('interrupted')
  expect(back.fixPushes).toBe(2)
  expect(back.fixCap).toBe(6)
  expect(fixStateOf(back)).toEqual({ fixPushes: 2, fixCap: 6 })
})

test('AC-11: after the restore the next fix push is refused at the cap and the raised cap is the one from before', () => {
  const atCap = restored({ ...freshRun(), fixPushes: 3, fixCap: 3 })
  expect(fixPushVerdict(fixStateOf(atCap), [FIX], ID).allowed).toBe(false)

  const raised = restored({ ...freshRun(), fixPushes: 4, fixCap: 6 })
  expect(fixStateOf(raised)).toEqual({ fixPushes: 4, fixCap: 6 })
  expect(fixPushVerdict(fixStateOf(raised), [FIX], ID)).toEqual({ allowed: true })
})

test('AC-11: rerun of a blocked run keeps the count and the cap, so the phase is still at the cap', () => {
  const blocked = afterStatus({ ...freshRun(), fixPushes: 3, fixCap: 3 }, 'blocked', 'fix push cap of 3 reached')
  expect(blocked.state).toBe('blocked')
  expect(blocked.fixPushes).toBe(3)
  expect(blocked.fixCap).toBe(3)

  const again = rerun(blocked)
  expect(again.state).toBe('running')
  expect(again.fixPushes).toBe(3)
  expect(again.fixCap).toBe(3)
  expect(fixPushVerdict(fixStateOf(again), [FIX], ID).allowed).toBe(false)
})

test('AC-11: rerun of a capped run keeps the count and the cap', () => {
  let run = { ...freshRun(), fixPushes: 3, fixCap: 3 }
  for (let i = 0; i < 100 && run.state === 'running'; i++) run = countTurn(run)
  expect(run.state).toBe('capped')
  expect(run.fixPushes).toBe(3)
  expect(run.fixCap).toBe(3)

  const again = rerun(run)
  expect(again.state).toBe('running')
  expect(again.fixPushes).toBe(3)
  expect(again.fixCap).toBe(3)
})

test('AC-11: counting a turn, stopping and a status change keep the count and the cap', () => {
  const run = { ...freshRun(), fixPushes: 2, fixCap: 6 }
  const turned = countTurn(run)
  expect(turned.fixPushes).toBe(2)
  expect(turned.fixCap).toBe(6)

  const stopped = stop(run)
  expect(stopped.state).toBe('stopped')
  expect(stopped.fixPushes).toBe(2)
  expect(stopped.fixCap).toBe(6)

  const done = afterStatus(run, 'done')
  expect(done.fixPushes).toBe(2)
  expect(done.fixCap).toBe(6)
})

test('AC-11: no event except the person choice changes the count or the cap: choose is the only function that changes the numbers', () => {
  const state: FixState = { fixPushes: 3, fixCap: 3 }
  expect(choose(state, 'rerun')).toEqual({ fixPushes: 3, fixCap: 3 })
  expect(choose(state, 'reset count')).toEqual({ fixPushes: 0, fixCap: 3 })
  expect(choose(state, 'raise cap')).toEqual({ fixPushes: 3, fixCap: 6 })
  // the guard verdict and the stuck choices are reads: they leave the state as it was
  fixPushVerdict(state, [FIX], ID)
  stuckChoices(state)
  expect(state).toEqual({ fixPushes: 3, fixCap: 3 })
})

test('AC-11: at the stuck state the person can rerun, reset the count or raise the cap', () => {
  expect(stuckChoices({ fixPushes: 3, fixCap: 3 })).toEqual(expect.arrayContaining(['rerun', 'reset count', 'raise cap']))
  expect(stuckChoices({ fixPushes: 6, fixCap: 6 })).toContain('raise cap')
})

test('AC-11: after a reset the next fix push is allowed and the count starts from zero', () => {
  const reset = choose({ fixPushes: 3, fixCap: 3 }, 'reset count')
  expect(reset).toEqual({ fixPushes: 0, fixCap: 3 })
  expect(fixPushVerdict(reset, [FIX], ID)).toEqual({ allowed: true })
  expect(afterPush(reset, [FIX], ID)).toEqual({ fixPushes: 1, fixCap: 3 })
})

test('AC-11: after raising the cap by 3 the next fix push is allowed', () => {
  const raised = choose({ fixPushes: 3, fixCap: 3 }, 'raise cap')
  expect(raised).toEqual({ fixPushes: 3, fixCap: 6 })
  expect(fixPushVerdict(raised, [FIX], ID)).toEqual({ allowed: true })
})

test('AC-11: raise cap stops at 9: the third raise is not offered and leaves the state unchanged', () => {
  expect(choose({ fixPushes: 3, fixCap: 3 }, 'raise cap').fixCap).toBe(6)
  expect(choose({ fixPushes: 6, fixCap: 6 }, 'raise cap').fixCap).toBe(9)
  expect(stuckChoices({ fixPushes: 9, fixCap: 9 })).not.toContain('raise cap')
  expect(stuckChoices({ fixPushes: 9, fixCap: 9 })).toEqual(expect.arrayContaining(['rerun', 'reset count']))
  expect(choose({ fixPushes: 9, fixCap: 9 }, 'raise cap')).toEqual({ fixPushes: 9, fixCap: 9 })
  expect(fixPushVerdict({ fixPushes: 9, fixCap: 9 }, [FIX], ID).allowed).toBe(false)
})

test('AC-11: a cap that is not a multiple of the step is not raised past 9', () => {
  expect(stuckChoices({ fixPushes: 7, fixCap: 7 })).not.toContain('raise cap')
  expect(choose({ fixPushes: 7, fixCap: 7 }, 'raise cap')).toEqual({ fixPushes: 7, fixCap: 7 })
})

test('AC-11: afterPush and fixPushVerdict never change the cap', () => {
  const state: FixState = { fixPushes: 2, fixCap: 6 }
  expect(afterPush(state, [FIX], ID).fixCap).toBe(6)
  expect(afterPush(state, [RECORD], ID).fixCap).toBe(6)
})
