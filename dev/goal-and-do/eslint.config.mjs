// ESLint for the goal-and-do plugin's hooks. Run from the repository root with -c, so file patterns start there.
import path from 'node:path'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

const files = ['plugins/goal-and-do/hooks/**/*.{ts,tsx}']
const presets = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked]

// What blocks: every preset rule a tool fixes by itself (the baseline ran --fix), the promise rules and the mod rules.
// Every other preset rule warns; it moves to blocking when a run shows its cost or its count reaches 0.
const blocking = new Set(['@typescript-eslint/no-floating-promises', '@typescript-eslint/no-misused-promises'])
const ruleMeta = name => tseslint.plugin.rules?.[name.replace('@typescript-eslint/', '')]?.meta
const severities = {}
for (const config of presets) {
  for (const [name, setting] of Object.entries(config.rules ?? {})) {
    const level = Array.isArray(setting) ? setting[0] : setting
    if (level === 'off' || level === 0) continue
    const options = Array.isArray(setting) ? setting.slice(1) : []
    const fixable = name.startsWith('@typescript-eslint/') && ruleMeta(name)?.fixable !== undefined
    severities[name] = [fixable || blocking.has(name) ? 'error' : 'warn', ...options]
  }
}

export default tseslint.config(
  ...presets.map(config => ({ ...config, files })),
  {
    files,
    languageOptions: {
      parserOptions: { project: path.join(import.meta.dirname, 'tsconfig.check.json'), tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...severities,
      '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true, allowBoolean: true }],
      // A name led by _ is unused on purpose: a parameter a signature needs, or a key a destructuring leaves out.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Its arguments check compares each call argument with the engine's overloaded on(event, ...) signatures and takes
      // minutes on register.tsx; no-floating-promises still catches a promise nobody awaits.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      // The engine refuses a module holding import(), and the hooks run with no Node and no DOM.
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'A hooks module holding import() does not load.' }],
      'no-restricted-globals': [
        'error',
        ...['require', 'process', 'Buffer', '__dirname', '__filename', 'module', 'window', 'document'].map(name => ({
          name,
          message: 'The hooks run with no Node and no DOM; use $ instead.',
        })),
      ],
    },
  },
  { ...prettier, files }
)
