import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import { guard } from './guard'
import { SKILL_GIT } from './skill-git'

const SKILL_PHASES: Record<string, PhaseName> = {
  'write-intent': 'Intent',
  'write-spec': 'Spec',
  'plan-change': 'Plan',
  'build-change': 'Build',
  'test-change': 'Test',
  'open-pr': 'PR',
}

const fill = (command: string): string =>
  command
    .replaceAll('<id>', 'ABC-1')
    .replaceAll('<base>', 'main')
    .replaceAll('<test-paths>', 'tests/acceptance')
    .replaceAll('<locked-at>', '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345')

const commands = SKILL_GIT.trim()
  .split('\n')
  .map(line => line.split(' | '))
  .map(([skill = '', phase = '', ...rest]) => ({ skill, phase, command: rest.join(' | ') }))

// The project lists no environment file, tracked or not: a project that tracks one is in reach.acceptance.test.ts.
const context = (phase: PhaseName) => ({
  active: true,
  phase,
  id: 'ABC-1',
  base: 'main',
  lockedPaths: [] as string[],
  root: '/repo',
  home: '/home/dev',
  envFiles: [] as string[],
  envFilesReachable: [] as string[],
})

test('the git commands of the six skills name the phase of their skill', () => {
  expect(commands.length).toBeGreaterThan(15)
  for (const { skill, phase } of commands) expect(SKILL_PHASES[skill], skill).toBe(phase)
})

test('every git command a SKILL.md names passes the guard in the phase its skill runs in, on a project with no environment file', () => {
  for (const { skill, phase, command } of commands) {
    const result = guard({ tool: 'Bash', input: { command: fill(command) } }, context(phase as PhaseName))
    expect(result.verdict, `${skill} (${phase}): ${fill(command)}${result.verdict === 'deny' ? `: ${result.reason}` : ''}`).not.toBe('deny')
  }
})

test('a git push of the PR phase reaches the push check', () => {
  for (const { command } of commands.filter(one => one.command.startsWith('git push'))) {
    expect(guard({ tool: 'Bash', input: { command: fill(command) } }, context('PR')).verdict, command).toBe('push')
  }
})

test('on a project that tracks an environment file, the PR diff is refused until it excludes the file, and the refusal says how', () => {
  const tracked = { ...context('PR'), envFiles: ['.env'], envFilesReachable: ['.env'] }
  const diff = commands.find(one => one.command.startsWith('git diff origin/'))?.command ?? ''
  const refused = guard({ tool: 'Bash', input: { command: fill(diff) } }, tracked)
  expect(refused.verdict).toBe('deny')
  if (refused.verdict === 'deny') expect(refused.reason).toContain(':(exclude,glob)**/.env*')
  expect(guard({ tool: 'Bash', input: { command: `${fill(diff)} -- . ':(exclude,glob)**/.env*'` } }, tracked).verdict).toBe('pass')
  // The skill's other commands carry no patch and still pass.
  for (const { command } of commands.filter(one => one.skill === 'open-pr' && !one.command.startsWith('git diff'))) {
    expect(guard({ tool: 'Bash', input: { command: fill(command) } }, tracked).verdict, command).not.toBe('deny')
  }
})
