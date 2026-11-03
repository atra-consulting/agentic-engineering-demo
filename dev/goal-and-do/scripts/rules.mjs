// This repository's CLAUDE.md rules for the goal-and-do plugin, as plain checks: a skill's description, an agent's
// front matter, and no em-dash or en-dash. Prints one line per finding, `file:line rule: message`, and exits 1 on any.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DESCRIPTION_LIMIT = 1024
const AGENT_KEYS = ['name', 'description', 'model', 'color']
const DASHES = /[\u2013\u2014]/
const TEXT_FILES = /\.(md|ts|tsx|mjs|js|json|jsonc|ya?ml)$/

// Paths, relative to the repository root, that the rules skip: records and word-for-word copies, generated files.
const SKIPPED = [/^plugins\/goal-and-do\/docs\/reviews\//, /(^|\/)node_modules\//, /^dev\/goal-and-do\/package-lock\.json$/, /^dev\/goal-and-do\/types\//]

// The front matter's keys and values, with the line each key starts on; undefined when the file has none.
export function frontMatter(text) {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return undefined
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return undefined
  const fields = {}
  let current
  for (let index = 1; index < end; index++) {
    const line = lines[index] ?? ''
    const match = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line)
    if (match) {
      const [, key, raw] = match
      const value = raw.trim()
      current = { value: /^[>|][+-]?$/.test(value) ? '' : unquote(value), line: index + 1 }
      fields[key] = current
    } else if (current && /^\s+\S/.test(line)) {
      current.value = (current.value ? current.value + ' ' : '') + line.trim()
    }
  }
  return fields
}

function unquote(value) {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted ? quoted[2] : value
}

export function checkSkill(text, file) {
  const fields = frontMatter(text)
  if (!fields) return [{ file, line: 1, rule: 'skill-front-matter', message: 'no front matter' }]
  const description = fields.description
  if (!description || description.value === '') return [{ file, line: 1, rule: 'skill-description', message: 'no description' }]
  const findings = []
  if (!description.value.startsWith('Use when')) findings.push({ file, line: description.line, rule: 'skill-description', message: 'does not start with "Use when"' })
  if (description.value.length >= DESCRIPTION_LIMIT)
    findings.push({ file, line: description.line, rule: 'skill-description', message: `${description.value.length} characters, limit ${DESCRIPTION_LIMIT}` })
  return findings
}

export function checkAgent(text, file) {
  const fields = frontMatter(text)
  if (!fields) return [{ file, line: 1, rule: 'agent-front-matter', message: 'no front matter' }]
  const findings = AGENT_KEYS.filter(key => !fields[key] || fields[key].value === '').map(key => ({
    file,
    line: 1,
    rule: 'agent-front-matter',
    message: `no ${key}`,
  }))
  const description = fields.description
  if (description && description.value.length >= DESCRIPTION_LIMIT)
    findings.push({ file, line: description.line, rule: 'agent-front-matter', message: `description ${description.value.length} characters, limit ${DESCRIPTION_LIMIT}` })
  return findings
}

export function checkDashes(text, file) {
  return text.split('\n').flatMap((line, index) =>
    DASHES.test(line) ? [{ file, line: index + 1, rule: 'no-dashes', message: 'em-dash or en-dash; use a comma, parentheses or a colon' }] : []
  )
}

// Every finding under the plugin and this folder, paths relative to the repository root.
export function checkRepository(root) {
  const findings = []
  for (const file of [...walk(root, 'plugins/goal-and-do'), ...walk(root, 'dev/goal-and-do')]) {
    if (!TEXT_FILES.test(file)) continue
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    if (/^plugins\/goal-and-do\/skills\/(.+\/)?SKILL\.md$/.test(file)) findings.push(...checkSkill(text, file))
    if (/^plugins\/goal-and-do\/agents\/[^/]+\.md$/.test(file)) findings.push(...checkAgent(text, file))
    findings.push(...checkDashes(text, file))
  }
  return findings
}

function walk(root, folder) {
  const files = []
  const visit = relative => {
    if (SKIPPED.some(pattern => pattern.test(relative + '/')) || SKIPPED.some(pattern => pattern.test(relative))) return
    const full = path.join(root, relative)
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && !SKIPPED.some(pattern => pattern.test(child))) files.push(child)
    }
  }
  if (fs.existsSync(path.join(root, folder))) visit(folder)
  return files
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(import.meta.dirname, '../../..')
  const findings = checkRepository(root)
  for (const finding of findings) console.log(`${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`)
  process.exitCode = findings.length > 0 ? 1 : 0
}
