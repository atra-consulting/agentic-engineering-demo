import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The guard reads the body of a shell heredoc as shell words, so a glob or a name in the text of a file written that way can be
// refused as a read of an environment file. Each phase skill tells Claude to write file contents with the Write or Edit tool.
const skills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'goal-and-do', 'skills')

const always = text => {
  const section = /^## Always\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? ''
  return section.split('\n').filter(line => /^\d+\. /.test(line))
}

test('the six phase skills name the Write or Edit tool and forbid a shell heredoc in their Always rules', () => {
  const names = fs.readdirSync(skills).sort()
  assert.equal(names.length, 6)
  for (const name of names) {
    const rules = always(fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8'))
    const rule = rules.find(line => /Write or Edit tool/.test(line))
    assert.ok(rule, `${name}: no Always rule names the Write or Edit tool`)
    assert.match(rule, /never with a shell heredoc/, `${name}: the rule does not forbid a shell heredoc`)
    assert.match(rule, /cat > file <<EOF/, `${name}: the rule does not name cat > file <<EOF`)
    assert.match(rule, /`tee`/, `${name}: the rule does not name tee`)
  }
})

test('the Always rules of each skill stay numbered 1 to 10 in order', () => {
  for (const name of fs.readdirSync(skills).sort()) {
    const rules = always(fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8'))
    assert.deepEqual(
      rules.map(line => Number(/^(\d+)\./.exec(line)?.[1])),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      name
    )
  }
})
