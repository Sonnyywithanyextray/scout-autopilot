// Counterfactual explanations, computed by the deterministic ranker: vary one
// feature at a time, re-score the listing (everything else fixed), and find the
// smallest realistic change that moves it up the ranking.

import { rankListing } from './ranker'
import type { Counterfactual, LearnedRule, Listing, Preferences, Ranked } from './types'

type Lever = {
  id: Counterfactual['lever']
  // Candidate modified listings, smallest change first
  steps: (l: Listing) => { listing: Listing; change: string }[]
}

const LEVERS: Lever[] = [
  {
    id: 'price',
    steps: (l) => {
      if (l.price === null) return []
      const out = []
      for (let d = 25; d <= 500 && l.price - d > 800; d += 25) {
        out.push({ listing: { ...l, price: l.price - d }, change: `rent were $${d} lower ($${(l.price - d).toLocaleString()})` })
      }
      return out
    },
  },
  {
    id: 'walk',
    steps: (l) => {
      if (!l.transit) return []
      const out = []
      for (let w = l.transit.walkMinutes - 1; w >= 2; w--) {
        out.push({ listing: { ...l, transit: { ...l.transit, walkMinutes: w } }, change: `the walk to ${l.transit.station} were ${w} min instead of ${l.transit.walkMinutes}` })
      }
      return out
    },
  },
  {
    id: 'commute',
    steps: (l) => {
      if (!l.transit) return []
      const out = []
      for (let c = l.transit.commuteMinutes - 1; c >= Math.max(8, l.transit.commuteMinutes - 30); c--) {
        out.push({ listing: { ...l, transit: { ...l.transit, commuteMinutes: c } }, change: `the commute were ${c} min instead of ${l.transit.commuteMinutes}` })
      }
      return out
    },
  },
]

export function computeCounterfactual(
  prefs: Preferences,
  rules: LearnedRule[],
  target: Ranked,
  allRanked: Ranked[],
): Counterfactual | null {
  const others = allRanked.filter((r) => r.status === 'match' && r.listing.id !== target.listing.id)
  // Conservative: to take a spot you must strictly beat whoever holds it
  const rankFor = (score: number) => 1 + others.filter((o) => o.score >= score).length
  const currentRank = target.status === 'match' ? target.rank ?? rankFor(target.score) : null
  if (currentRank === 1) return holdOnTop(prefs, rules, target, others)

  // What would count as a meaningful improvement
  const improves = (r: Ranked) => {
    if (r.status !== 'match') return false
    return currentRank === null || rankFor(r.score) < currentRank
  }

  const candidates: Counterfactual[] = []
  for (const lever of LEVERS) {
    let first: Counterfactual | null = null
    let best: Counterfactual | null = null
    for (const { listing, change } of lever.steps(target.listing)) {
      const r = rankListing(prefs, rules, listing)
      if (!improves(r)) continue
      const cf: Counterfactual = {
        lever: lever.id,
        change,
        fromRank: currentRank,
        toRank: rankFor(r.score),
        fromScore: target.score,
        toScore: r.score,
        responsible: null,
        sentence: '',
      }
      if (!first) first = cf
      if (!best || cf.toRank < best.toRank) best = cf
      if (cf.toRank === 1) break
    }
    // Prefer the smallest change; report reaching #1 only if it's the same lever step or close
    if (first) candidates.push(best && best.toRank === 1 ? best : first)
  }
  // Learned rules costing this listing points (the "why" behind the gap)
  const hurting = [...target.ruleHits].filter((h) => h.delta < 0).sort((a, b) => a.delta - b.delta)[0]
  const responsible = hurting ? `Your learned rule “${hurting.label}” costs it ${pts(-hurting.delta)}` : null
  if (!candidates.length) return explainGap(target, others, currentRank, responsible)

  const leverForRule = (label: string) =>
    /walk|transit|bart|muni/i.test(label) ? 'walk' : /commute/i.test(label) ? 'commute' : /price|rent|\$/i.test(label) ? 'price' : null

  // Choose: the lever that undoes the hurting rule if there is one, else the best rank reached
  const preferred = hurting ? candidates.find((c) => c.lever === leverForRule(hurting.label)) : undefined
  const pick = preferred ?? [...candidates].sort((a, b) => a.toRank - b.toRank)[0]

  pick.responsible = responsible
  const where =
    pick.fromRank === null ? `it would become a match at #${pick.toRank}` : `it would move from #${pick.fromRank} to #${pick.toRank}`
  pick.sentence = `If ${pick.change}, ${where} (${pick.fromScore} → ${pick.toScore}).`
  return pick
}

// For the #1 listing: how much worse could it get before losing the top spot?
function holdOnTop(prefs: Preferences, rules: LearnedRule[], target: Ranked, others: Ranked[]): Counterfactual | null {
  const runnerUp = others.reduce<Ranked | null>((best, o) => (!best || o.score > best.score ? o : best), null)
  if (!runnerUp || target.listing.price === null) return null
  for (let d = 25; d <= 600; d += 25) {
    const r = rankListing(prefs, rules, { ...target.listing, price: target.listing.price + d })
    if (r.status !== 'match' || r.score <= runnerUp.score) {
      return {
        lever: 'price',
        change: `rent were $${d} higher ($${(target.listing.price + d).toLocaleString()})`,
        fromRank: 1,
        toRank: 2,
        fromScore: target.score,
        toScore: r.score,
        responsible: null,
        sentence: `Holds #1 by ${pts(target.score - runnerUp.score)} over “${runnerUp.listing.title}”. If rent were $${d} higher, it would lose the top spot (${target.score} → ${r.score}).`,
      }
    }
  }
  return {
    lever: 'price', change: 'rent up to $600 higher', fromRank: 1, toRank: 1, fromScore: target.score, toScore: target.score,
    responsible: null, sentence: `Holds #1 by ${pts(target.score - runnerUp.score)} — it would stay on top even at $600 more rent.`,
  }
}

const pts = (n: number) => `${n} pt${Math.abs(n) === 1 ? '' : 's'}`

const COMPONENT_NAME: Record<string, string> = {
  budget: 'budget fit', neighborhood: 'neighborhood', transit: 'transit access', space: 'space', moveIn: 'move-in timing', legitimacy: 'legitimacy',
}

// No single small change moves it up: say what it trails on, from the score breakdown.
function explainGap(target: Ranked, others: Ranked[], currentRank: number | null, responsible: string | null): Counterfactual | null {
  const ahead = [...others].sort((a, b) => b.score - a.score)
  const rival = currentRank === null ? ahead[ahead.length - 1] : ahead[Math.max(0, currentRank - 2)]
  if (!rival) return null
  const worst = (Object.keys(target.components) as (keyof Ranked['components'])[])
    .map((k) => ({ k, diff: Math.round(target.components[k] - rival.components[k]) }))
    .sort((a, b) => a.diff - b.diff)[0]
  const rivalRank = currentRank === null ? ahead.length : currentRank - 1
  const gap = rival.score - target.score
  return {
    lever: 'price', change: '', fromRank: currentRank, toRank: currentRank ?? rivalRank,
    fromScore: target.score, toScore: target.score, responsible,
    sentence: `No single small change moves it up: it trails #${rivalRank} “${rival.listing.title}” by ${pts(gap)}, mostly on ${COMPONENT_NAME[worst.k]} (${pts(worst.diff)}).`,
  }
}
