import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/storage',
      'packages/engine',
      'packages/server',
      'apps/console',
      'scripts/scenarios',
    ],
  },
})
