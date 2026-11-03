// The count of fix pushes and the cap on them. A fix push is a push that went through and holds at least one new commit whose
// subject starts with fix(<id>):. The count and the cap live on the run (Run.fixPushes, Run.fixCap) and change only through
// afterPush (a push that went through) and choose (the person's choice at the stuck state).

export const FIX_CAP_START = 3
export const FIX_CAP_STEP = 3
export const FIX_CAP_MAX = 9

export interface FixState {
  fixPushes: number
  fixCap: number
}

// The subjects of the new commits of one push, and whether the push went through.
export interface PushRecord {
  went: boolean
  subjects: string[]
}

export function isFixSubject(subject: string, id: string): boolean {
  return subject.startsWith(`fix(${id}):`)
}

// Each push that went through with at least one fix subject counts once, however many it holds and whoever made them.
export function countFixPushes(pushes: PushRecord[], id: string): number {
  return pushes.filter(push => push.went && push.subjects.some(subject => isFixSubject(subject, id))).length
}

// A run saved without the fields reads as no fix push and the starting cap.
export function fixStateOf(run: { fixPushes?: number; fixCap?: number }): FixState {
  return { fixPushes: run.fixPushes ?? 0, fixCap: run.fixCap ?? FIX_CAP_START }
}

export type FixVerdict = { allowed: true } | { allowed: false; reason: string }

// Whether a blocked run's reason is the one fixPushVerdict gives: the stuck state of the cap, where the person's choices apply.
export function isFixCapReason(reason: string | undefined): boolean {
  return /^The cap of \d+ fix pushes is reached/.test(reason ?? '')
}

// At the cap a push with a fix subject is refused, the record commit inside or not; a push without one passes at any count, and
// so does any push below the cap.
export function fixPushVerdict(state: FixState, subjects: string[], id: string): FixVerdict {
  if (state.fixPushes < state.fixCap || !subjects.some(subject => isFixSubject(subject, id))) return { allowed: true }
  return {
    reason: `The cap of ${state.fixCap} fix pushes is reached (${state.fixPushes} counted). A push with a commit that starts with fix(${id}): is refused until a person reruns, resets the count or raises the cap.`,
    allowed: false,
  }
}

// The state after a push that went through: one more fix push when a subject is a fix subject. The cap never changes here.
export function afterPush(state: FixState, subjects: string[], id: string): FixState {
  return subjects.some(subject => isFixSubject(subject, id)) ? { ...state, fixPushes: state.fixPushes + 1 } : state
}

export type StuckChoice = 'rerun' | 'reset count' | 'raise cap'

// What the person may pick at the stuck state of the cap: raising the cap is left out when one more step would pass the maximum.
export function stuckChoices(state: FixState): StuckChoice[] {
  return state.fixCap + FIX_CAP_STEP > FIX_CAP_MAX ? ['rerun', 'reset count'] : ['rerun', 'reset count', 'raise cap']
}

// The only function that changes the numbers by a person's choice. A rerun leaves them as they are; an unavailable choice
// leaves the state unchanged.
export function choose(state: FixState, choice: StuckChoice): FixState {
  if (!stuckChoices(state).includes(choice)) return state
  switch (choice) {
    case 'rerun':
      return state
    case 'reset count':
      return { ...state, fixPushes: 0 }
    case 'raise cap':
      return { ...state, fixCap: state.fixCap + FIX_CAP_STEP }
  }
}
