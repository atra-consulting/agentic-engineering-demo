import { expect, test } from 'claude-code/testing'
import { afterDenial } from './level'
import { newRun } from './phases'

const ENV = { claudeCode: '2.1.316', plugin: '0.9.0', provider: 'anthropic', permissionMode: 'default' }

// PR 50's second review: a guard that fails is one of the mod's own blocks, so it ends the run at both levels.
test('a failed guard ends a running run at review and at strict', () => {
  for (const guardLevel of ['review', 'strict'] as const) {
    const run = newRun({ id: 'ABC-1', input: 'x', source: 'freeform', base: 'main', now: 1, env: ENV, level: guardLevel })
    const next = afterDenial(run, { reason: 'goal-and-do: the guard failed, so the call is blocked. See the debug log.', key: 'guardFailed', tool: 'Bash' }, 2)
    expect(next.state, guardLevel).toBe('blocked')
  }
})
