// Provider abstractions for the two memory roles:
//   durable preferences/facts   → GBrain
//   learned rules/procedures    → Memorable
// Local JSON is always the source of truth for the ranker. Sponsor services are
// write-through mirrors: when configured they receive every write (and the
// remote id/draft is kept for cleanup + display); a failure there is logged,
// never surfaced as a broken demo.

import type { LearnedRule, PreferenceMemory, ProviderStatus } from '../types'
import { gbrainForget, gbrainRemember, gbrainToken, gbrainWriteSummaryPage } from './gbrain'
import { readState, updateState } from './local-store'
import { memorableExtract } from './memorable'
import { describeRule } from '../ranker'

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

// A mirror returns whatever remote handle it created so we can clean it up later.
interface Mirror<T, Handle> {
  name: string
  enabled: boolean
  add(item: T): Promise<Handle | null>
  remove(item: T): Promise<void>
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

const gbrainMirror: Mirror<PreferenceMemory, string> = {
  name: 'GBrain',
  enabled: !!gbrainToken(),
  async add(m) {
    const provenance = m.utterance ? `Scout Autopilot correction: "${m.utterance}"` : 'Scout Autopilot'
    return gbrainRemember(`Housing search: ${m.statement}`, provenance)
  },
  async remove(m) {
    if (m.gbrainFactId) await gbrainForget(m.gbrainFactId)
  },
}

const memorableMirror: Mirror<LearnedRule, NonNullable<LearnedRule['memorable']>> = {
  name: 'Memorable',
  enabled: !!process.env.MEMORABLE_API_KEY?.trim(),
  add: (r) => memorableExtract(r),
  // Memorable has no delete endpoint; the procedure is retired locally.
  async remove() {},
}

async function safeMirror<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[${label}] mirror call failed, continuing on local store`, err)
    return null
  }
}

function withPrefMirror(base: PreferenceStore, mirror: Mirror<PreferenceMemory, string>): PreferenceStore {
  if (!mirror.enabled) return base
  return {
    ...base,
    async add(m) {
      await base.add(m)
      const factId = await safeMirror(mirror.name, () => mirror.add(m))
      if (factId) await updateState((s) => { const p = s.preferences.find((x) => x.id === m.id); if (p) p.gbrainFactId = factId })
      await syncGbrainPage()
    },
    async remove(id) {
      const m = (await base.list()).find((x) => x.id === id)
      await base.remove(id)
      if (m) await safeMirror(mirror.name, () => mirror.remove(m))
      await syncGbrainPage()
    },
  }
}

function withRuleMirror(base: RuleStore, mirror: Mirror<LearnedRule, NonNullable<LearnedRule['memorable']>>): RuleStore {
  if (!mirror.enabled) return base
  return {
    ...base,
    async add(r) {
      await base.add(r)
      const draft = await safeMirror(mirror.name, () => mirror.add(r))
      if (draft) await updateState((s) => { const x = s.rules.find((y) => y.id === r.id); if (x) x.memorable = draft })
      await syncGbrainPage()
    },
    async remove(id) {
      const r = (await base.list()).find((x) => x.id === id)
      await base.remove(id)
      if (r) await safeMirror(mirror.name, () => mirror.remove(r))
      await syncGbrainPage()
    },
  }
}

// Rewrites the "Scout housing search" page in GBrain from local state.
export async function syncGbrainPage(): Promise<void> {
  if (!gbrainMirror.enabled) return
  const { preferences, rules } = await readState()
  await safeMirror('GBrain page', () =>
    gbrainWriteSummaryPage({
      preferences: preferences.map((p) => ({ statement: p.statement, utterance: p.utterance, createdAt: p.createdAt })),
      rules: rules.map((r) => ({ reason: r.reason, description: describeRule(r), utterance: r.source.utterance, memorableSteps: r.memorable?.steps.length ?? null })),
    }),
  )
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
