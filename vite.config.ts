import { defineConfig } from 'vitest/config'

// Single config for both the dev/build server and the test runner.
// The engine is environment-agnostic; tests run in 'node' to keep the
// simulation honest about having no DOM dependency.
export default defineConfig({
  build: {
    rollupOptions: {
      // Entry pages. launcher = the front door (Aya's presentation shell);
      // main = the full run; battle = the single-skirmish sandbox; campaign =
      // the strategic map. The launcher routes to campaign.html / battle.html.
      input: {
        launcher: 'launcher.html',
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
