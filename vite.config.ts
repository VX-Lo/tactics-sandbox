import { defineConfig } from 'vitest/config'

// Single config for both the dev/build server and the test runner.
// The engine is environment-agnostic; tests run in 'node' to keep the
// simulation honest about having no DOM dependency.
export default defineConfig({
  build: {
    rollupOptions: {
      // Two entry pages: the full run (index) and the single-battle sandbox.
      input: {
        main: 'index.html',
        battle: 'battle.html',
        campaign: 'campaign.html',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
