// Provider abstractions for the two memory roles:
//   durable preferences/facts   → GBrain
//   learned rules/procedures    → Memorable
// Local JSON is always the source of truth for the demo. Sponsor services are
// write-through mirrors: when configured they receive every write, and a
// failure there is logged, never surfaced as a broken demo.

import type { LearnedRule, PreferenceMemory, ProviderStatus } from '../types'
import { readState, updateState } from './local-store'

export interface PreferenceStore {
  list(): Promise<PreferenceMemory[]>
  add(m: PreferenceMemory): Promise<void>
  remove(id: string): Promise<void>
}

export interface RuleStore {
  list(): Promise<LearnedRule[]>
  add(r: LearnedRule): Promise<void>
  remove(id: string): Promise<void>
  recordApplied(ids: string[]): Promise<void>
}

interface Mirror<T> {
  name: string
  enabled: boolean
  add(item: T): Promise<void>
  remove(id: string): Promise<void>
}

// ── Local implementations ───────────────────────────────────────────────────

const localPreferences: PreferenceStore = {
  async list() { return (await readState()).preferences },
  async add(m) { await updateState((s) => { s.preferences.push(m) }) },
  async remove(id) { await updateState((s) => { s.preferences = s.preferences.filter((p) => p.id !== id) }) },
}

const localRules: RuleStore = {
  async list() { return (await readState()).rules },
  async add(r) { await updateState((s) => { s.rules.push(r) }) },
  async remove(id) { await updateState((s) => { s.rules = s.rules.filter((r) => r.id !== id) }) },
  async recordApplied(ids) {
    if (!ids.length) return
    const counts = new Map<string, number>()
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    await updateState((s) => { for (const r of s.rules) r.timesApplied += counts.get(r.id) ?? 0 })
  },
}

// ── Sponsor mirrors ─────────────────────────────────────────────────────────
// TODO(gbrain): replace the body with the real GBrain MCP/API write once we
// have docs + keys from the sponsor table. Shape: one memory per statement,
// tagged `scout:preference`, carrying the structured patch as metadata.
const gbrainMirror: Mirror<PreferenceMemory> = {
  name: 'GBrain',
  enabled: !!process.env.GBRAIN_API_KEY,
  async add(m) { console.log('[gbrain] would store preference', m.statement) },
  async remove(id) { console.log('[gbrain] would forget preference', id) },
}

// TODO(memorable): replace with the real Memorable call. Shape: the corrected
// trajectory (utterance + listing + resulting rule) as a reusable procedure.
const memorableMirror: Mirror<LearnedRule> = {
  name: 'Memorable',
  enabled: !!process.env.MEMORABLE_API_KEY,
  async add(r) { console.log('[memorable] would store procedure', r.reason) },
  async remove(id) { console.log('[memorable] would retire procedure', id) },
}

async function safeMirror(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    console.error(`[${label}] mirror write failed, continuing on local store`, err)
  }
}

function withPrefMirror(base: PreferenceStore, mirror: Mirror<PreferenceMemory>): PreferenceStore {
  if (!mirror.enabled) return base
  return {
    ...base,
    async add(m) { await base.add(m); await safeMirror(mirror.name, () => mirror.add(m)) },
    async remove(id) { await base.remove(id); await safeMirror(mirror.name, () => mirror.remove(id)) },
  }
}

function withRuleMirror(base: RuleStore, mirror: Mirror<LearnedRule>): RuleStore {
  if (!mirror.enabled) return base
  return {
    ...base,
    async add(r) { await base.add(r); await safeMirror(mirror.name, () => mirror.add(r)) },
    async remove(id) { await base.remove(id); await safeMirror(mirror.name, () => mirror.remove(id)) },
  }
}

export const preferenceStore = withPrefMirror(localPreferences, gbrainMirror)
export const ruleStore = withRuleMirror(localRules, memorableMirror)

export function providerStatuses(): ProviderStatus[] {
  return [
    { role: 'preferences', name: 'GBrain', mode: gbrainMirror.enabled ? 'live' : 'fallback', note: gbrainMirror.enabled ? undefined : 'local memory' },
    { role: 'rules', name: 'Memorable', mode: memorableMirror.enabled ? 'live' : 'fallback', note: memorableMirror.enabled ? undefined : 'local memory' },
    { role: 'reasoning', name: 'Claude', mode: process.env.ANTHROPIC_API_KEY ? 'live' : 'fallback', note: process.env.ANTHROPIC_API_KEY ? undefined : 'keyword parser' },
  ]
}
