// JSON-file state for the hackathon app. Deliberately separate from Scout's
// production Supabase — nothing here ever writes to prod tables.

import { promises as fs } from 'fs'
import path from 'path'
import type { LearnedRule, PreferenceMemory, Ranked } from '../types'

export interface RunSnapshot {
  runId: string
  at: string
  byListing: Record<string, { score: number; status: Ranked['status']; title: string; components: Ranked['components']; ruleHits: Ranked['ruleHits'] }>
  weights: Record<string, number>
}

export interface LocalState {
  preferences: PreferenceMemory[]
  rules: LearnedRule[]
  lastRun: RunSnapshot | null
}

const FILE = path.join(process.cwd(), '.data', 'state.json')
const EMPTY: LocalState = { preferences: [], rules: [], lastRun: null }

// Serialize writes so concurrent requests can't interleave read-modify-write.
let queue: Promise<unknown> = Promise.resolve()

export async function readState(): Promise<LocalState> {
  try {
    return { ...EMPTY, ...JSON.parse(await fs.readFile(FILE, 'utf8')) }
  } catch {
    return structuredClone(EMPTY)
  }
}

export function updateState<T>(fn: (s: LocalState) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const s = await readState()
    const result = await fn(s)
    await fs.mkdir(path.dirname(FILE), { recursive: true })
    await fs.writeFile(FILE, JSON.stringify(s, null, 2))
    return result
  })
  queue = next.catch(() => undefined)
  return next
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
