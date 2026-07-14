import { describe, it, expect } from 'vitest'

// The load-bearing wall (CLAUDE.md section 2): the tactics engine and the run
// layer sit BELOW the campaign layer. Neither may import from src/campaign — the
// campaign depends on them (via the resolveBattle socket and the RosterPort
// contract), never the reverse. The RosterPort contract lives in src/contracts
// precisely so the campaign can reach run-layer roster state without an import
// arrow pointing the wrong way. This test fails the build if that arrow flips.
//
// Source is read via Vite's import.meta.glob (?raw) — the same build-time file
// access names.ts uses — so this needs no @types/node.

const SOURCES = import.meta.glob('../src/{engine,run}/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const IMPORT_CAMPAIGN = /\bfrom\s+['"][^'"]*\/campaign\/[^'"]*['"]/

describe('module boundary', () => {
  it('no file under src/engine or src/run imports from src/campaign', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, content]) => IMPORT_CAMPAIGN.test(content))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('actually scanned the source tree (glob is not empty)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0)
  })
})
