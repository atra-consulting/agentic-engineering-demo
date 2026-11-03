import { expect, test } from 'claude-code/testing'
import { byHandLine, classifyFailures, fixCommitSubject, fixRoundsAfter, isJenkinsCheck, parsePatterns, readChecks } from './prchecks'
import type { CheckRow } from './prchecks'

const ID = 'CH-20261102-sample-change'

function row(name: string, bucket: string, state: string, link = 'https://ci.example.test/run/1'): CheckRow {
  return { name, bucket, state, link }
}

const JENKINS_LINK = 'https://jenkins.example.test/job/app/job/PR-12/7/'

// AC-1

test('AC-1: the result of each check comes from bucket and state, a pass counts as passed and only the fail check may start a fix round', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('lint', 'fail', 'FAILURE'), row('integration', 'pending', 'IN_PROGRESS')])
  expect(reading.passed).toEqual(['unit-tests'])
  expect(reading.failed).toEqual(['lint'])
})

test('AC-1: the pending check is shown as waiting, never as passed or failed', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('lint', 'fail', 'FAILURE'), row('integration', 'pending', 'IN_PROGRESS')])
  expect(reading.waiting).toEqual(['integration'])
  expect(reading.passed).not.toContain('integration')
  expect(reading.failed).not.toContain('integration')
})

test('AC-1: checks is not passed while a check is pending', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('integration', 'pending', 'QUEUED')])
  expect(reading.checks).toBe('waiting')
  expect(reading.checks).not.toBe('passed')
  expect(reading.stuck).toBe(false)
  expect(reading.toDo).toEqual([])
})

test('AC-1: a read with a failed check and a pending check at once lets the failed one start a fix round and keeps the pending one waiting', () => {
  const reading = readChecks([row('lint', 'fail', 'FAILURE'), row('integration', 'pending', 'PENDING')])
  expect(reading.failed).toEqual(['lint'])
  expect(reading.waiting).toEqual(['integration'])
  expect(reading.checks).toBe('failed')
})

test('AC-1: checks is passed when every check passed, and a skipped check counts as passed', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('docs', 'skipping', 'SKIPPED')])
  expect(reading.passed).toEqual(['unit-tests', 'docs'])
  expect(reading.failed).toEqual([])
  expect(reading.waiting).toEqual([])
  expect(reading.checks).toBe('passed')
  expect(reading.stuck).toBe(false)
})

test('AC-1: any other bucket is waiting, never passed or failed', () => {
  const reading = readChecks([row('odd-check', 'unknown-bucket', 'SOMETHING')])
  expect(reading.waiting).toEqual(['odd-check'])
  expect(reading.passed).toEqual([])
  expect(reading.failed).toEqual([])
  expect(reading.checks).toBe('waiting')
})

test('AC-1: the reading follows the order of the rows for each list', () => {
  const reading = readChecks([
    row('b-check', 'pass', 'SUCCESS'),
    row('a-check', 'pass', 'SUCCESS'),
    row('d-check', 'fail', 'FAILURE'),
    row('c-check', 'fail', 'FAILURE'),
  ])
  expect(reading.passed).toEqual(['b-check', 'a-check'])
  expect(reading.failed).toEqual(['d-check', 'c-check'])
})

// AC-2

test('AC-2: a failure that matches an entry of the pattern list is by hand, starts no fix round and the round count does not change', () => {
  const patterns = ['connection reset by peer', 'no space left on device']
  const classified = classifyFailures([{ name: 'unit-tests', log: 'step 4 failed: No space left on device while writing the cache' }], patterns)
  expect(classified.fix).toEqual([])
  expect(classified.byHand).toEqual([{ name: 'unit-tests', pattern: 'no space left on device' }])
  expect(fixRoundsAfter(2, classified)).toBe(2)
  expect(fixRoundsAfter(0, classified)).toBe(0)
})

test('AC-2: the To Do line names the check, says re-run by hand and names the pattern entry that matched', () => {
  const line = byHandLine({ name: 'jenkins/build', pattern: 'connection reset by peer' })
  expect(line).toContain('jenkins/build')
  expect(line).toContain('re-run by hand')
  expect(line).toContain('connection reset by peer')
})

test('AC-2: the first matching entry in list order wins', () => {
  const classified = classifyFailures(
    [{ name: 'lint', log: 'agent lost: connection reset by peer, no space left on device' }],
    ['no space left on device', 'connection reset by peer']
  )
  expect(classified.byHand).toEqual([{ name: 'lint', pattern: 'no space left on device' }])
})

test('AC-2: the match is a case-insensitive substring of the log', () => {
  const classified = classifyFailures([{ name: 'lint', log: 'ERROR: CONNECTION RESET BY PEER (os error 54)' }], ['connection reset by peer'])
  expect(classified.byHand).toEqual([{ name: 'lint', pattern: 'connection reset by peer' }])
  expect(classified.fix).toEqual([])
})

test('AC-2: the pattern file gives one entry per line, trimmed, without blank lines and comment lines', () => {
  const text = '# infrastructure patterns\n\n  connection reset by peer  \n\n# another comment\nno space left on device\n'
  expect(parsePatterns(text)).toEqual(['connection reset by peer', 'no space left on device'])
})

test('AC-2: an empty pattern file gives no entries, so no failure is by hand', () => {
  expect(parsePatterns('')).toEqual([])
  expect(parsePatterns('# only a comment\n\n')).toEqual([])
  const classified = classifyFailures([{ name: 'lint', log: 'anything' }], [])
  expect(classified.byHand).toEqual([])
  expect(classified.fix).toEqual(['lint'])
})

test('AC-2: with a by-hand failure and a failure of the change in one read, only the failure of the change starts the round', () => {
  const classified = classifyFailures(
    [
      { name: 'unit-tests', log: 'expected 3 but got 4' },
      { name: 'jenkins/build', log: 'agent went offline: connection reset by peer' },
    ],
    ['connection reset by peer']
  )
  expect(classified.fix).toEqual(['unit-tests'])
  expect(classified.byHand.map(item => item.name)).toEqual(['jenkins/build'])
  expect(fixRoundsAfter(1, classified)).toBe(2)
})

// AC-7

test('AC-7: a neutral check is listed by name under To Do, starts no fix round, is counted in the checks line and the phase is stuck', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('coverage', 'pass', 'NEUTRAL')])
  expect(reading.toDo).toEqual([{ name: 'coverage', reason: 'neutral' }])
  expect(reading.failed).toEqual([])
  expect(reading.passed).toEqual(['unit-tests'])
  expect(reading.checks).toBe('failed')
  expect(reading.stuck).toBe(true)
})

test('AC-7: a cancelled check is listed by name under To Do, starts no fix round, is counted in the checks line and the phase is stuck', () => {
  const reading = readChecks([row('unit-tests', 'pass', 'SUCCESS'), row('lint', 'cancel', 'CANCELLED')])
  expect(reading.toDo).toEqual([{ name: 'lint', reason: 'cancelled' }])
  expect(reading.failed).toEqual([])
  expect(reading.passed).not.toContain('lint')
  expect(reading.checks).toBe('failed')
  expect(reading.stuck).toBe(true)
})

test('AC-7: state CANCELLED gives cancelled whatever the bucket says, and state NEUTRAL gives neutral whatever the bucket says', () => {
  const reading = readChecks([row('lint', 'fail', 'CANCELLED'), row('coverage', 'fail', 'NEUTRAL'), row('docs', 'pending', 'NEUTRAL')])
  expect(reading.toDo).toEqual([
    { name: 'lint', reason: 'cancelled' },
    { name: 'coverage', reason: 'neutral' },
    { name: 'docs', reason: 'neutral' },
  ])
  expect(reading.failed).toEqual([])
  expect(reading.waiting).toEqual([])
})

test('AC-7: a skipped check counts as passed and goes under no To Do', () => {
  const reading = readChecks([row('docs', 'skipping', 'SKIPPED')])
  expect(reading.passed).toEqual(['docs'])
  expect(reading.toDo).toEqual([])
  expect(reading.stuck).toBe(false)
  expect(reading.checks).toBe('passed')
})

test('AC-7: a neutral check next to a failed check keeps the failed one in failed and the phase stuck', () => {
  const reading = readChecks([row('coverage', 'pass', 'NEUTRAL'), row('lint', 'fail', 'FAILURE')])
  expect(reading.toDo).toEqual([{ name: 'coverage', reason: 'neutral' }])
  expect(reading.failed).toEqual(['lint'])
  expect(reading.stuck).toBe(true)
  expect(reading.checks).toBe('failed')
})

// AC-8

test('AC-8: a Jenkins check in bucket fail whose build is not found is listed under To Do, is neither passed nor failed and the phase is stuck', () => {
  const rows = [row('jenkins/build', 'fail', 'FAILURE', 'https://jenkins.example.test/job/app/'), row('unit-tests', 'pass', 'SUCCESS')]
  const reading = readChecks(rows, () => false)
  expect(reading.toDo).toEqual([{ name: 'jenkins/build', reason: 'build unreadable' }])
  expect(reading.passed).toEqual(['unit-tests'])
  expect(reading.passed).not.toContain('jenkins/build')
  expect(reading.failed).toEqual([])
  expect(reading.stuck).toBe(true)
  expect(reading.checks).toBe('failed')
})

test('AC-8: a Jenkins check whose build is found is a failed check like any other', () => {
  const reading = readChecks([row('jenkins/build', 'fail', 'FAILURE', JENKINS_LINK)], () => true)
  expect(reading.failed).toEqual(['jenkins/build'])
  expect(reading.toDo).toEqual([])
  expect(reading.stuck).toBe(false)
})

test('AC-8: without a build lookup every build counts as found', () => {
  const reading = readChecks([row('jenkins/build', 'fail', 'FAILURE', JENKINS_LINK)])
  expect(reading.failed).toEqual(['jenkins/build'])
  expect(reading.toDo).toEqual([])
})

test('AC-8: the build lookup is called only for a Jenkins row in bucket fail', () => {
  const asked: string[] = []
  const rows = [
    row('jenkins/build', 'fail', 'FAILURE', JENKINS_LINK),
    row('jenkins/deploy', 'pass', 'SUCCESS', JENKINS_LINK),
    row('jenkins/smoke', 'pending', 'PENDING', JENKINS_LINK),
    row('lint', 'fail', 'FAILURE', 'https://ci.example.test/run/9'),
  ]
  readChecks(rows, r => {
    asked.push(r.name)
    return true
  })
  expect(asked).toEqual(['jenkins/build'])
})

test('AC-8: a check is a Jenkins check when its link holds /job/ or its name holds jenkins in any case', () => {
  expect(isJenkinsCheck(row('build', 'fail', 'FAILURE', 'https://jenkins.example.test/job/app/3/'))).toBe(true)
  expect(isJenkinsCheck(row('Jenkins/Build', 'fail', 'FAILURE', 'https://ci.example.test/run/3'))).toBe(true)
  expect(isJenkinsCheck(row('JENKINS-smoke', 'fail', 'FAILURE', ''))).toBe(true)
  expect(isJenkinsCheck(row('unit-tests', 'fail', 'FAILURE', 'https://ci.example.test/run/3'))).toBe(false)
})

// AC-9

test('AC-9: a failure that matches no entry gets a fix round like any failure of the change', () => {
  const classified = classifyFailures([{ name: 'unit-tests', log: 'AssertionError: expected 3 but got 4' }], ['connection reset by peer'])
  expect(classified.fix).toEqual(['unit-tests'])
  expect(classified.byHand).toEqual([])
  expect(fixRoundsAfter(0, classified)).toBe(1)
  expect(fixRoundsAfter(2, classified)).toBe(3)
})

test('AC-9: the fix commit subject is fix(<id>): <check>', () => {
  expect(fixCommitSubject(ID, 'unit-tests')).toBe(`fix(${ID}): unit-tests`)
  expect(fixCommitSubject(ID, 'jenkins/build')).toBe(`fix(${ID}): jenkins/build`)
})

test('AC-9: the order of fix and byHand follows the order of the failed checks', () => {
  const classified = classifyFailures(
    [
      { name: 'z-check', log: 'real failure' },
      { name: 'b-check', log: 'timeout: no space left on device' },
      { name: 'a-check', log: 'another real failure' },
      { name: 'c-check', log: 'NO SPACE LEFT ON DEVICE' },
    ],
    ['no space left on device']
  )
  expect(classified.fix).toEqual(['z-check', 'a-check'])
  expect(classified.byHand.map(item => item.name)).toEqual(['b-check', 'c-check'])
})

test('AC-9: a read with no failed check adds no fix round', () => {
  const classified = classifyFailures([], ['connection reset by peer'])
  expect(classified.fix).toEqual([])
  expect(classified.byHand).toEqual([])
  expect(fixRoundsAfter(1, classified)).toBe(1)
})
