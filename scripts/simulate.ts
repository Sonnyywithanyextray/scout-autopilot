import { seedListings, DEMO_PROFILE } from '../src/lib/data/seed'
import { rankListing, applyPreferenceMemories, dedupeKey } from '../src/lib/ranker'
import type { LearnedRule, PreferenceMemory } from '../src/lib/types'

const all = seedListings()
const seen = new Set<string>()
const listings = all.filter((l) => (seen.has(dedupeKey(l)) ? false : (seen.add(dedupeKey(l)), true)))
const base = { source: { kind: 'correction' as const, utterance: '', listingId: null }, createdAt: '', timesApplied: 0 }

function show(label: string, mem: PreferenceMemory[], rules: LearnedRule[]) {
  const prefs = applyPreferenceMemories(DEMO_PROFILE, mem)
  const ranked = listings.map((l) => rankListing(prefs, rules, l)).sort((a, b) => b.score - a.score)
  console.log(`\n== ${label}`)
  ranked.filter((r) => r.status === 'match').slice(0, 7).forEach((r, i) =>
    console.log(`#${i + 1}`, String(r.score).padStart(3), r.listing.id.padEnd(14), `$${r.listing.price}`, `${r.listing.transit?.commuteMinutes}min`, r.ruleHits.map((h) => `${h.label} ${h.delta}`).join('; ')))
  const rincon = ranked.find((r) => r.listing.id === 'hero-rincon')!
  console.log('rincon:', rincon.score, rincon.status, rincon.rejectReason ?? '')
}

const transitPref: PreferenceMemory = { id: 'p1', statement: 'transit > size', patch: { weights: { transit: 25, space: 10 } }, source: 'correction', utterance: null, createdAt: '' }
const walkRule: LearnedRule = { ...base, id: 'r1', field: 'walkToTransitMinutes', operator: '>', value: 10, effect: 'penalty', magnitude: 25, reason: 'Over 10 min walk to rapid transit' }
const tradeoff: LearnedRule = { ...base, id: 't1', kind: 'tradeoff', tradeoff: { gainField: 'commuteMinutes', baseline: 45, dollarsPerUnit: 7.5, maxDollars: 150 }, field: 'price', operator: '>', value: 0, effect: 'boost', magnitude: 0, reason: 'Pay up to $150 more for a 20+ min shorter commute' }

show('baseline', [], [])
show('tradeoff only', [], [tradeoff])
show('BART correction', [transitPref], [walkRule])
show('BART correction + tradeoff', [transitPref], [walkRule, tradeoff])
