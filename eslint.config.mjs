import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    // Plain-JS Node scripts (build helpers, smoke tests) use Node globals such as
    // `process`/`console`. TS files get undefined-checking from the type-checker,
    // but .mjs/.cjs are linted as plain JS, so declare the Node globals for them.
    files: ['**/*.{mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', 'packages/python-sidecar/**'],
  }
)
