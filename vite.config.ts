import { defineConfig } from 'vitest/config'

// Single config for both the dev/build server and the test runner.
// The engine is environment-agnostic; tests run in 'node' to keep the
// simulation honest about having no DOM dependency.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
