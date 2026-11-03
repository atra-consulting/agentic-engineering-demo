import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// plugins/goal-and-do/hooks/skill-git.ts lists the git commands the six skills name; the engine test skill-git.test.ts
// runs each through the guard. This test keeps the list equal to the SKILL.md files.
const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'goal-and-do')

// Named in a rule against them, or as a word of prose: not commands to run.
const NOT_RUN = new Set(['git add -A', 'git push'])

const listed = () => {
  const source = fs.readFileSync(path.join(plugin, 'hooks', 'skill-git.ts'), 'utf8')
  const body = /SKILL_GIT = `\n([\s\S]*?)`/.exec(source)?.[1] ?? ''
  return body
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.split(' | '))
    .map(([skill, , ...rest]) => `${skill} | ${rest.join(' | ')}`)
}

const named = () =>
  fs
    .readdirSync(path.join(plugin, 'skills'))
    .sort()
    .flatMap(skill => {
      const text = fs.readFileSync(path.join(plugin, 'skills', skill, 'SKILL.md'), 'utf8')
      return [...text.matchAll(/`((?:GIT_TERMINAL_PROMPT=0 )?git [^`]*)`/g)].map(match => `${skill} | ${match[1]}`).filter(entry => !NOT_RUN.has(entry.split(' | ')[1] ?? ''))
    })

test('the git commands that skill-git.ts lists are the ones the SKILL.md files name, skill by skill', () => {
  const unique = list => [...new Set(list)].sort()
  assert.deepEqual(unique(listed()), unique(named()))
})

test('the list is not empty and names all six skills with a command or a rule against git add -A', () => {
  assert.ok(listed().length > 15)
  assert.equal(fs.readdirSync(path.join(plugin, 'skills')).length, 6)
})
