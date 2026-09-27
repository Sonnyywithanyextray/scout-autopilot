import { interpretCorrection } from '@/lib/agent/interpret'
import { DEMO_PROFILE } from '@/lib/data/seed'
import { newId } from '@/lib/memory/local-store'
import { preferenceStore, ruleStore } from '@/lib/memory/providers'
import { applyPreferenceMemories } from '@/lib/ranker'
import { loadListings } from '@/lib/run'
import type { LearnedRule, PreferenceMemory } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { utterance, listingId, source } = await req.json()
  if (typeof utterance !== 'string' || !utterance.trim()) {
    return Response.json({ error: 'utterance is required' }, { status: 400 })
  }

  const [memories, rules, listings] = await Promise.all([
    preferenceStore.list(),
    ruleStore.list(),
    listingId ? loadListings(source === 'supabase' ? 'supabase' : 'seed') : Promise.resolve([]),
  ])
  const listing = listings.find((l) => l.id === listingId) ?? null
  const prefs = applyPreferenceMemories(DEMO_PROFILE, memories)

  const result = await interpretCorrection({ utterance, listing, prefs, existingRules: rules })
  const now = new Date().toISOString()

  const newPrefs: PreferenceMemory[] = result.preferences.map((p) => ({
    id: newId('pref'), statement: p.statement, patch: p.patch, source: 'correction', utterance, createdAt: now,
  }))
  const newRules: LearnedRule[] = result.rules.map((r) => ({
    ...r, id: newId('rule'), createdAt: now, timesApplied: 0,
    source: { kind: 'correction', utterance, listingId: listing?.id ?? null },
  }))

  for (const p of newPrefs) await preferenceStore.add(p)
  for (const r of newRules) await ruleStore.add(r)

  return Response.json({ reply: result.reply, engine: result.engine, preferences: newPrefs, rules: newRules })
}
