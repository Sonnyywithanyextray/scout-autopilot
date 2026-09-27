// One Scout Autopilot run: load inventory → recall preferences → apply learned
// rules → dedupe/reject/flag → return top matches, plus a score delta against
// the previous run so the UI can show *what changed because Scout learned*.

import { DEMO_PROFILE, seedListings } from './data/seed'
import { fetchSupabaseListings, supabaseConfigured } from './data/supabase'
import { gbrainRecallCount, gbrainToken } from './memory/gbrain'
import { newId, updateState, type RunSnapshot } from './memory/local-store'
import { preferenceStore, providerStatuses, ruleStore } from './memory/providers'
import { computeCounterfactual } from './counterfactual'
import { applyPreferenceMemories, dedupeKey, describeRule, rankListing } from './ranker'
import type { Listing, Ranked, RunResult, ScoreDelta, TraceStep, WeightKey } from './types'
import { WEIGHT_KEYS } from './types'

const TOP_N = 3

export async function loadListings(source: 'seed' | 'supabase'): Promise<Listing[]> {
  if (source === 'supabase' && supabaseConfigured()) return fetchSupabaseListings()
  return seedListings()
}

export async function runScout(requested: 'seed' | 'supabase' = 'seed'): Promise<RunResult> {
  const source = requested === 'supabase' && supabaseConfigured() ? 'supabase' : 'seed'
  const [listings, memories, rules, gbrainFacts] = await Promise.all([
    loadListings(source),
    preferenceStore.list(),
    ruleStore.list(),
    gbrainToken() ? gbrainRecallCount().catch(() => null) : Promise.resolve(null),
  ])
  const prefs = applyPreferenceMemories(DEMO_PROFILE, memories)

  // Dedupe first so cross-posts don't crowd the results
  const seen = new Set<string>()
  const unique: Listing[] = []
  let duplicates = 0
  for (const l of listings) {
    const k = dedupeKey(l)
    if (seen.has(k)) duplicates++
    else { seen.add(k); unique.push(l) }
  }

  const ranked = unique.map((l) => rankListing(prefs, rules, l)).sort((a, b) => b.score - a.score)
  const matchesAll = ranked.filter((r) => r.status === 'match')
  const flagged = ranked.filter((r) => r.status === 'flagged')
  const rejected = ranked.filter((r) => r.status === 'rejected')
  const rejectedByRules = rejected.filter((r) => r.ruleHits.some((h) => h.delta < 0 || h.effect === 'reject')).length
  const rulesUsed = new Set(ranked.flatMap((r) => r.ruleHits.map((h) => h.ruleId)))
  const matches = matchesAll.slice(0, TOP_N)
  matchesAll.forEach((r, i) => { r.rank = i + 1 })


  const trace: TraceStep[] = [
    { label: `Loaded ${listings.length} listings`, detail: source === 'seed' ? 'demo inventory' : 'Scout Supabase (read-only)' },
    {
      label: `Recalled ${memories.length} preference${memories.length === 1 ? '' : 's'}${gbrainFacts !== null ? ' from GBrain' : ''}`,
      detail: [memories.map((m) => m.statement).join(' · ') || 'onboarding profile only', gbrainFacts !== null ? `${gbrainFacts} facts on file in GBrain` : null].filter(Boolean).join(' — '),
    },
    {
      label: `Applied ${rulesUsed.size} learned rule${rulesUsed.size === 1 ? '' : 's'}${rules.some((r) => r.memorable) ? ' (Memorable procedures)' : ''}`,
      detail: rules.filter((r) => rulesUsed.has(r.id)).map((r) => describeRule(r)).join(' · ') || undefined,
    },
    { label: `Removed ${duplicates} duplicate${duplicates === 1 ? '' : 's'}`, detail: 'cross-posted across sources' },
    { label: `Rejected ${rejected.length}`, detail: rejectedByRules ? `${rejectedByRules} because of learned rules` : undefined },
    { label: `Flagged ${flagged.length} questionable`, detail: 'low legitimacy signals' },
    { label: `Returned ${matches.length} strong match${matches.length === 1 ? '' : 'es'}`, detail: `${matchesAll.length} passed all filters` },
  ]

  const at = new Date().toISOString()
  const runId = newId('run')
  const snapshot: RunSnapshot = {
    runId,
    at,
    weights: { ...prefs.weights },
    byListing: Object.fromEntries(
      ranked.map((r) => [r.listing.id, { score: r.score, status: r.status, title: r.listing.title, components: r.components, ruleHits: r.ruleHits }]),
    ),
  }

  const previous = await updateState((s) => {
    const prev = s.lastRun
    s.lastRun = snapshot
    return prev
  })
  await ruleStore.recordApplied(ranked.flatMap((r) => r.ruleHits.map((h) => h.ruleId)))

  // Next-best listings the renter might ask about: ones that just fell out of
  // the matches first, then remaining matches, then soft rejections.
  const justDropped = new Set(
    previous ? ranked.filter((r) => r.status !== 'match' && previous.byListing[r.listing.id]?.status === 'match').map((r) => r.listing.id) : [],
  )
  const softCandidates = ranked.filter((r) => !matches.includes(r) && (r.status === 'match' || (r.status === 'rejected' && r.score > 0)))
  const nearMisses = [
    ...softCandidates.filter((r) => justDropped.has(r.listing.id)),
    ...softCandidates.filter((r) => !justDropped.has(r.listing.id)),
  ].slice(0, 6)
  for (const r of [...matches, ...nearMisses]) r.counterfactual = computeCounterfactual(prefs, rules, r, ranked)

  return {
    runId,
    at,
    source,
    trace,
    stats: {
      loaded: listings.length,
      duplicates,
      rejected: rejected.length,
      rejectedByRules,
      flagged: flagged.length,
      matches: matches.length,
      preferencesRecalled: memories.length,
      rulesApplied: rulesUsed.size,
    },
    matches,
    nearMisses,
    flagged: flagged.slice(0, 5),
    movers: previous ? computeMovers(previous, ranked) : [],
    providers: [
      ...providerStatuses(),
      { role: 'inventory', name: source === 'seed' ? 'Demo seed' : 'Supabase', mode: source === 'seed' ? 'fallback' : 'live' },
    ],
  }
}

const COMPONENT_LABEL: Record<WeightKey, string> = {
  budget: 'Budget fit',
  neighborhood: 'Neighborhood',
  transit: 'Transit access',
  space: 'Space',
  moveIn: 'Move-in timing',
  legitimacy: 'Legitimacy',
}

// Explain each score change as component shifts (from preference/weight
// changes) plus rule hits that appeared or disappeared since the last run.
function computeMovers(prev: RunSnapshot, ranked: Ranked[]): ScoreDelta[] {
  // Rank among matches (1-based); null when not a match
  const prevOrder = Object.entries(prev.byListing)
    .filter(([, v]) => v.status === 'match')
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([id]) => id)
  const nowOrder = ranked.filter((r) => r.status === 'match').map((r) => r.listing.id)
  const rankOf = (order: string[], id: string) => { const i = order.indexOf(id); return i === -1 ? null : i + 1 }

  // The demo story is about the shortlist: what left it and what took its place.
  const prevTop = new Set(prevOrder.slice(0, TOP_N))
  const nowTop = new Set(nowOrder.slice(0, TOP_N))
  const out: ScoreDelta[] = []
  for (const r of ranked) {
    const before = prev.byListing[r.listing.id]
    if (!before) continue
    const rankBefore = rankOf(prevOrder, r.listing.id)
    const rankAfter = rankOf(nowOrder, r.listing.id)
    const moved = before.score !== r.score || before.status !== r.status || rankBefore !== rankAfter
    if (!moved) continue
    if (before.status !== 'match' && r.status !== 'match') continue // only care about movement in/out of the shortlist

    const causes: ScoreDelta['causes'] = []
    const prevRules = new Map(before.ruleHits.map((h) => [h.ruleId, h]))
    const nowRules = new Map(r.ruleHits.map((h) => [h.ruleId, h]))
    const learnedLabel = (h: Ranked['ruleHits'][number]) => (h.effect === 'tradeoff' ? h.label : `Learned rule: ${h.label}`)
    for (const [id, h] of nowRules) if (!prevRules.has(id)) causes.push({ label: learnedLabel(h), delta: h.delta })
    for (const [id, h] of prevRules) if (!nowRules.has(id)) causes.push({ label: `Removed: ${h.label}`, delta: -h.delta })
    for (const k of WEIGHT_KEYS) {
      const d = Math.round(r.components[k] - before.components[k])
      if (Math.abs(d) >= 2) causes.push({ label: `${COMPONENT_LABEL[k]} weighted ${d > 0 ? 'higher' : 'lower'}`, delta: d })
    }
    causes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    out.push({
      listingId: r.listing.id, title: r.listing.title, before: before.score, after: r.score,
      statusBefore: before.status, statusAfter: r.status, rankBefore, rankAfter, causes,
    })
  }
  const relevance = (d: ScoreDelta) => (prevTop.has(d.listingId) ? 1 : 0) + (nowTop.has(d.listingId) ? 1 : 0)
  const rankShift = (d: ScoreDelta) => Math.abs((d.rankBefore ?? 99) - (d.rankAfter ?? 99))
  return out
    .filter((d) => relevance(d) > 0)
    .sort((a, b) => relevance(b) - relevance(a) || Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || rankShift(b) - rankShift(a))
    .slice(0, 5)
}
