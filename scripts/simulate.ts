import { seedListings, DEMO_PROFILE } from '../src/lib/data/seed'
import { rankListing, applyPreferenceMemories } from '../src/lib/ranker'
import type { LearnedRule, PreferenceMemory } from '../src/lib/types'

const listings = seedListings()
const show = (label: string, prefsMem: PreferenceMemory[], rules: LearnedRule[]) => {
  const prefs = applyPreferenceMemories(DEMO_PROFILE, prefsMem)
  const ranked = listings.map((l) => rankListing(prefs, rules, l)).sort((a, b) => b.score - a.score)
  console.log(`\n== ${label}`)
  for (const r of ranked.slice(0, 8)) console.log(r.score.toString().padStart(3), r.status.padEnd(8), r.listing.id.padEnd(14), r.listing.title)
  console.log('counts', Object.entries(ranked.reduce((m: any, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})))
}
const pref: PreferenceMemory = { id: 'p1', statement: 'transit > size', patch: { weights: { transit: 25, space: 10 } }, source: 'correction', utterance: null, createdAt: '' }
const rule: LearnedRule = { id: 'r1', field: 'walkToTransitMinutes', operator: '>', value: 10, effect: 'penalty', magnitude: 25, reason: 'Over 10 min walk to rapid transit', source: { kind: 'correction', utterance: '', listingId: null }, createdAt: '', timesApplied: 0 }
show('baseline', [], [])
show('after transit pref', [pref], [])
show('after rule', [pref], [rule])
