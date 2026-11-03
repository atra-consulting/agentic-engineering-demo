import type { GuardLevel, Run } from '../types'
import { BLOCKING_REASONS, guard, reasonKeyOf } from './guard'
import { PHASES, isActive } from './phases'
import { redactSecrets } from './scan'

// The guard level of a run. The guard judges a call the same way at both levels; the level decides only whether a denial of a
// blocking kind ends the run (strict) or the run goes on with the call refused, counted and listed (review).

export const MAX_DENIED_CALLS = 200

export const LEVEL_NOTICE = 'Guard level: review. Add --strict to the start line for a measured run.'

// Only the exact value 'review' is review; no field, another value or another type is strict.
export function guardLevelOf(run: { guardLevel?: unknown }): GuardLevel {
  return run.guardLevel === 'review' ? 'review' : 'strict'
}

export type GuardResult = { verdict: 'pass' | 'push'; blocks: false } | { verdict: 'deny'; reason: string; key: string | undefined; blocks: boolean }

// The mod's own blocks among the denial keys: they end a run at both levels. A guard that fails can't say what it refused.
const MOD_BLOCKS: ReadonlySet<string> = new Set(['guardFailed'])

// A denial with this key ends a run: a blocking key at the strict level, and one of the mod's own blocks at both.
function blocksAt(level: GuardLevel, key: string | undefined): boolean {
  if (key !== undefined && MOD_BLOCKS.has(key)) return true
  return level === 'strict' && key !== undefined && (BLOCKING_REASONS as ReadonlySet<string>).has(key)
}

// The guard's verdict for a call, with the reason keyed, and whether a denial blocks the run at this level.
export function guardAt(call: { tool: string; input: Record<string, unknown> }, ctx: Parameters<typeof guard>[1], level: GuardLevel): GuardResult {
  const verdict = guard(call, ctx)
  if (verdict.verdict !== 'deny') return { verdict: verdict.verdict, blocks: false }
  const key = reasonKeyOf(verdict.reason)
  return { verdict: 'deny', reason: verdict.reason, key, blocks: blocksAt(level, key) }
}

// A guard denial of an active run: counted, the last three kept for the pane, listed at review, and at strict a blocking
// key ends a running run with the denial's reason.
export function afterDenial(run: Run, denied: { reason: string; key: string; tool: string; command?: string }, at: number): Run {
  if (!isActive(run)) return run
  const level = guardLevelOf(run)
  const phase = PHASES[run.phase] ?? PHASES[0]
  const listed = run.deniedCalls ?? []
  const next: Run = {
    ...run,
    denials: [...(run.denials ?? []), { phase, key: denied.key }].slice(-3),
    deniedCount: (run.deniedCount ?? 0) + 1,
  }
  if (level === 'review' && listed.length < MAX_DENIED_CALLS) {
    const entry = { phase, key: denied.key, tool: denied.tool, at, ...(denied.command === undefined ? {} : { command: redactSecrets(denied.command) }) }
    next.deniedCalls = [...listed, entry]
  }
  if (run.state === 'running' && blocksAt(level, denied.key)) return { ...next, state: 'blocked', reason: denied.reason }
  return next
}

// A switch of an active run to the other level, logged with its time. State, reason and the denial records stay as they are.
export function switchLevel(run: Run, to: GuardLevel, at: number): Run {
  if (!isActive(run)) return run
  const from = guardLevelOf(run)
  if (from === to) return run
  return { ...run, guardLevel: to, levelChanges: [...(run.levelChanges ?? []), { at, from, to }] }
}

// A start line asks for strict with --strict; otherwise the run is at review.
export function startLevel(args: { strict?: true }): GuardLevel {
  return args.strict === true ? 'strict' : 'review'
}

export function levelLine(run: { guardLevel?: unknown }): string {
  return `Guard level: ${guardLevelOf(run)}`
}

// One toast and one log line at review; nothing at strict, and nothing waits for an answer.
export function announceLevel(ui: { toast(text: string): unknown; log(text: string): unknown }, level: GuardLevel): void {
  if (level !== 'review') return
  void ui.toast(LEVEL_NOTICE)
  void ui.log(LEVEL_NOTICE)
}
