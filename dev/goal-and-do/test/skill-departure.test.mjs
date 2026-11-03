import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A gap that changes a criterion is an open point of its own that starts with "Departure AC-<n>:". The Plan gate's walk-through finds it by
// that form and writes the person's decision into spec.md (hooks/phases.ts, walkPrompt). The skill never edits spec.md.
const skill = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'goal-and-do', 'skills', 'plan-change', 'SKILL.md'),
  'utf8'
)

test('plan-change starts the open point of a gap that changes a criterion with Departure AC-<n>:', () => {
  const lines = skill.split('\n').filter(line => line.includes('Departure AC-<n>:'))
  assert.ok(lines.length >= 2, 'the Gaps found section and the checks before the status both name the form')
  assert.ok(lines.some(line => line.startsWith('- `## Gaps found`')))
  assert.ok(lines.some(line => line.startsWith('- Every gap that changes a criterion')))
})

test('plan-change never edits spec.md and says who writes the decision', () => {
  assert.match(skill, /Never edit `spec\.md` to close it: the Plan gate's walk-through writes the person's decision into `spec\.md` under that AC/)
})
