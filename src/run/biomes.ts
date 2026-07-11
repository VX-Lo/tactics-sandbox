// Biome presets: named variations of the battle engine's map generator. Each is
// just a MapGenConfig, so "terrain type per encounter" reuses the existing
// generator wholesale — the run layer adds no new terrain code, only new dials.

import { DEFAULT_MAPGEN, type MapGenConfig } from '../engine/mapgen'

export type Biome = 'forest' | 'marsh' | 'highland' | 'plain'

export interface BiomeDef {
  label: string
  blurb: string
  mapConfig: MapGenConfig
}

// All presets keep the board size and terrain ids; they only move the noise
// thresholds, which is exactly how the generator distinguishes features.
const base = DEFAULT_MAPGEN

export const BIOMES: Record<Biome, BiomeDef> = {
  forest: {
    label: 'Deepwood',
    blurb: 'Dense forest — heavy cover, the elves at home.',
    mapConfig: { ...base, waterLevel: 0.26, forestThreshold: 0.5, mountainLevel: 0.82 },
  },
  marsh: {
    label: 'Mire',
    blurb: 'Waterlogged — pools split the field into channels.',
    mapConfig: { ...base, waterLevel: 0.42, forestThreshold: 0.55, mountainLevel: 0.85 },
  },
  highland: {
    label: 'Highland',
    blurb: 'Rocky heights — sparse cover, elevation decides crits.',
    mapConfig: { ...base, waterLevel: 0.2, forestThreshold: 0.72, mountainLevel: 0.66 },
  },
  plain: {
    label: 'Heath',
    blurb: 'Open ground — little cover, nowhere to hide.',
    mapConfig: { ...base, waterLevel: 0.22, forestThreshold: 0.82, mountainLevel: 0.85 },
  },
}

export const ALL_BIOMES = Object.keys(BIOMES) as Biome[]
