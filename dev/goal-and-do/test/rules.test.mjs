import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkAgent, checkDashes, checkRepository, checkSkill, frontMatter } from '../scripts/rules.mjs'

const skill = description => `---\nname: a-skill\ndescription: ${description}\n---\n\nBody.\n`
const agent = fields => `---\n${fields.join('\n')}\n---\n\nBody.\n`
const FULL_AGENT = ['name: an-agent', 'description: Reviews a change.', 'model: opus', 'color: magenta']

test('a skill whose description starts with "Use when" and stays short passes', () => {
  assert.deepEqual(checkSkill(skill('Use when a goal says so'), 'SKILL.md'), [])
})

test('a skill description that does not start with "Use when" is a finding on its line', () => {
  const findings = checkSkill(skill('Writes the intent'), 'SKILL.md')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'skill-description')
  assert.equal(findings[0].line, 3)
})

test('a skill description of 1,024 characters or more is a finding', () => {
  const findings = checkSkill(skill('Use when ' + 'x'.repeat(1015)), 'SKILL.md')
  assert.match(findings[0]?.message ?? '', /1024 characters, limit 1024/)
})

test('a quoted or folded description counts as its text', () => {
  assert.deepEqual(checkSkill(skill('"Use when quoted"'), 'SKILL.md'), [])
  const folded = '---\nname: a-skill\ndescription: >\n  Use when folded\n  over two lines\n---\n'
  assert.equal(frontMatter(folded)?.description?.value, 'Use when folded over two lines')
  assert.deepEqual(checkSkill(folded, 'SKILL.md'), [])
})

test('a skill with no front matter or no description is a finding', () => {
  assert.equal(checkSkill('# A skill\n', 'SKILL.md')[0]?.rule, 'skill-front-matter')
  assert.equal(checkSkill('---\nname: a-skill\n---\n', 'SKILL.md')[0]?.message, 'no description')
})

test('an agent with name, description, model and color passes', () => {
  assert.deepEqual(checkAgent(agent(FULL_AGENT), 'agent.md'), [])
})

test('an agent without one of the four keys is a finding naming the key', () => {
  for (const key of ['name', 'description', 'model', 'color']) {
    const findings = checkAgent(agent(FULL_AGENT.filter(line => !line.startsWith(key + ':'))), 'agent.md')
    assert.deepEqual(
      findings.map(finding => finding.message),
      [`no ${key}`]
    )
  }
})

test('an agent description of 1,024 characters or more is a finding', () => {
  const fields = FULL_AGENT.map(line => (line.startsWith('description:') ? 'description: ' + 'x'.repeat(1024) : line))
  assert.match(checkAgent(agent(fields), 'agent.md')[0]?.message ?? '', /limit 1024/)
})

test('an em-dash and an en-dash are findings on their lines; a hyphen is not', () => {
  const text = 'one - two\nthree \u2014 four\nfive \u2013 six\n'
  assert.deepEqual(
    checkDashes(text, 'a.md').map(finding => finding.line),
    [2, 3]
  )
})

test('the repository walk checks skills, agents and dashes, and skips docs/reviews/ and node_modules/', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'))
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  write('plugins/goal-and-do/skills/write-intent/SKILL.md', skill('Writes the intent'))
  write('plugins/goal-and-do/agents/reviewer.md', agent(FULL_AGENT.slice(0, 3)))
  write('plugins/goal-and-do/hooks/guard.ts', 'const a = 1 // one \u2014 two\n')
  write('plugins/goal-and-do/docs/reviews/2026/REPORT.md', 'quoted \u2014 text\n')
  write('dev/goal-and-do/node_modules/x/README.md', 'vendor \u2014 text\n')
  write('dev/goal-and-do/scripts/check.mjs', 'clean\n')
  const findings = checkRepository(root)
  fs.rmSync(root, { recursive: true })
  assert.deepEqual(
    findings.map(finding => `${finding.file}:${finding.line} ${finding.rule}`).sort(),
    [
      'plugins/goal-and-do/agents/reviewer.md:1 agent-front-matter',
      'plugins/goal-and-do/hooks/guard.ts:1 no-dashes',
      'plugins/goal-and-do/skills/write-intent/SKILL.md:3 skill-description',
    ]
  )
})
