// The result of the hook check for the "moved to the background" line (AC-14 and AC-15). The check is repeated at the start of Build,
// at the Claude Code version then in use. hook 'none' means AC-15 applies and nothing is built for AC-14.
export const BACKGROUND_CHECK: { claudeCode: string; hook: 'none' | 'found'; checkedFor: string } = {
  claudeCode: '2.1.316',
  hook: 'none',
  checkedFor:
    'the line "Your conversation moved to the background": session.attach and session.detach (a remote client joins or leaves; the terminal raises nothing), ' +
    'and the InfoNotice render component (the status line under the logo). The line is drawn as plain dim text by the background list screen, ' +
    'outside every render component',
}

// The gap for the Claude Code team, for the PR body and docs/goal-and-do-findings.md. The version comes from the check it is given.
export function backgroundGapNote(check: typeof BACKGROUND_CHECK): string {
  if (check.hook === 'found') {
    return `A hook that reaches the "moved to the background" line was found at Claude Code ${check.claudeCode} (${check.checkedFor}), so there is no gap to report.`
  }
  return [
    `For the Claude Code team: at Claude Code ${check.claudeCode} no hook reaches the line Claude Code prints when a session is moved to the background.`,
    `Checked: ${check.checkedFor}.`,
    'Request: an event or a render component for that line, so a plugin can make it hard to miss while a run is active. A tester who misses the line believes the run has stopped.',
  ].join('\n')
}
