// Deterministic ranker, ported from Scout's listing-ranker (v1) and extended
// with a transit/space component, tunable weights, and a learned-rule layer.
// Claude never scores listings directly — it only edits the weights and rules
// this file consumes.

import type {
  Check,
  ComponentPoints,
  LearnedRule,
  Listing,
  Preferences,
  PreferencePatch,
  PreferenceMemory,
  Ranked,
  RuleField,
  Tradeoff,
  RuleHit,
  RuleValue,
  WeightKey,
} from './types'
import { WEIGHT_KEYS } from './types'

export const RANKER_VERSION = 'autopilot-v1'
export const MATCH_THRESHOLD = 70
const LEGITIMACY_FLAG_BELOW = 0.5

export const DEFAULT_WEIGHTS: Record<WeightKey, number> = {
  budget: 25,
  neighborhood: 20,
  transit: 10,
  space: 25,
  moveIn: 5,
  legitimacy: 15,
}

// ── Preferences ─────────────────────────────────────────────────────────────

export function applyPreferenceMemories(base: Preferences, memories: PreferenceMemory[]): Preferences {
  const prefs: Preferences = {
    ...base,
    neighborhoods: [...base.neighborhoods],
    avoidNeighborhoods: [...base.avoidNeighborhoods],
    weights: { ...base.weights },
  }
  for (const m of memories) applyPatch(prefs, m.patch)
  return prefs
}

function applyPatch(prefs: Preferences, p: PreferencePatch) {
  if (p.budgetMax != null) prefs.budgetMax = p.budgetMax
  if (p.budgetFlex != null) prefs.budgetFlex = p.budgetFlex
  if (p.maxCommuteMinutes != null) prefs.maxCommuteMinutes = p.maxCommuteMinutes
  if (p.ownBathRequired != null) prefs.ownBathRequired = p.ownBathRequired
  if (p.petsHave != null) prefs.petsHave = p.petsHave
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase())
  if (p.neighborhoodsAdd) {
    for (const n of p.neighborhoodsAdd) if (!lower(prefs.neighborhoods).includes(n.toLowerCase())) prefs.neighborhoods.push(n)
  }
  if (p.neighborhoodsRemove) {
    const rm = lower(p.neighborhoodsRemove)
    prefs.neighborhoods = prefs.neighborhoods.filter((n) => !rm.includes(n.toLowerCase()))
  }
  if (p.avoidNeighborhoodsAdd) {
    for (const n of p.avoidNeighborhoodsAdd) if (!lower(prefs.avoidNeighborhoods).includes(n.toLowerCase())) prefs.avoidNeighborhoods.push(n)
  }
  if (p.weights) {
    for (const k of WEIGHT_KEYS) {
      const w = p.weights[k]
      if (typeof w === 'number' && Number.isFinite(w)) prefs.weights[k] = Math.max(0, Math.min(60, w))
    }
  }
}

// ── Components (each 0..1, then weighted) ───────────────────────────────────

export function budgetRatio(prefs: Preferences, price: number | null): number {
  if (price === null) return 0.5
  return price <= prefs.budgetMax ? 0.7 + 0.3 * Math.min(1, (prefs.budgetMax - price) / 500) : 0.3
}

function componentRatios(prefs: Preferences, l: Listing): Record<WeightKey, number> {
  const inList = (xs: string[]) => !!l.neighborhood && xs.some((n) => n.toLowerCase() === l.neighborhood!.toLowerCase())

  const budget = budgetRatio(prefs, l.price)

  const neighborhood = inList(prefs.avoidNeighborhoods) ? 0 : inList(prefs.neighborhoods) ? 1 : 0.4

  let transit = 0.4
  if (l.transit) {
    const w = l.transit.walkMinutes
    transit = w <= 5 ? 1 : w <= 10 ? 0.8 : w <= 15 ? 0.5 : w <= 20 ? 0.3 : 0.1
  }

  const space = l.sqft === null ? 0.5 : Math.max(0.1, Math.min(1, (l.sqft - 300) / 600))

  let moveIn = 0.6
  if (prefs.moveInDate && l.moveInDate) {
    const days = Math.abs(Date.parse(l.moveInDate) - Date.parse(prefs.moveInDate)) / 86_400_000
    moveIn = days <= prefs.moveInFlexDays ? 1 : 0.3
  }

  return { budget, neighborhood, transit, space, moveIn, legitimacy: l.legitimacyScore }
}

// ── Rules ───────────────────────────────────────────────────────────────────

export function fieldValue(l: Listing, field: RuleField): RuleValue | null {
  switch (field) {
    case 'price': return l.price
    case 'walkToTransitMinutes': return l.transit?.walkMinutes ?? null
    case 'commuteMinutes': return l.transit?.commuteMinutes ?? null
    case 'sqft': return l.sqft
    case 'bedrooms': return l.bedrooms
    case 'neighborhood': return l.neighborhood
    case 'ownBathroom': return l.ownBathroom
    case 'petsAllowed': return l.petsAllowed
    case 'legitimacyScore': return l.legitimacyScore
    case 'postedDaysAgo': return l.postedDaysAgo
    case 'source': return l.source
  }
}

export function ruleMatches(rule: LearnedRule, l: Listing): boolean {
  if (rule.kind === 'tradeoff') return false // applied separately, see tradeoffCredit
  const actual = fieldValue(l, rule.field)
  if (actual === null || actual === undefined) return false
  const v = rule.value
  const norm = (x: RuleValue) => (typeof x === 'string' ? x.toLowerCase() : x)
  switch (rule.operator) {
    case '>': return typeof actual === 'number' && actual > Number(v)
    case '>=': return typeof actual === 'number' && actual >= Number(v)
    case '<': return typeof actual === 'number' && actual < Number(v)
    case '<=': return typeof actual === 'number' && actual <= Number(v)
    case '==': return norm(actual) === norm(v)
    case '!=': return norm(actual) !== norm(v)
    case 'in': return Array.isArray(v) && v.map((x) => x.toLowerCase()).includes(String(actual).toLowerCase())
    case 'not_in': return Array.isArray(v) && !v.map((x) => x.toLowerCase()).includes(String(actual).toLowerCase())
  }
}

const FIELD_LABEL: Record<RuleField, string> = {
  price: 'price',
  walkToTransitMinutes: 'walk to transit (min)',
  commuteMinutes: 'commute (min)',
  sqft: 'sq ft',
  bedrooms: 'bedrooms',
  neighborhood: 'neighborhood',
  ownBathroom: 'own bathroom',
  petsAllowed: 'pets allowed',
  legitimacyScore: 'legitimacy',
  postedDaysAgo: 'days since posted',
  source: 'source',
}

export function describeRule(r: Pick<LearnedRule, 'field' | 'operator' | 'value' | 'effect' | 'magnitude' | 'kind' | 'tradeoff'>): string {
  if (r.kind === 'tradeoff' && r.tradeoff) return describeTradeoff(r.tradeoff)
  const val = Array.isArray(r.value) ? r.value.join(', ') : String(r.value)
  const cond = `${FIELD_LABEL[r.field]} ${r.operator.replace('_', ' ')} ${val}`
  const eff = r.effect === 'penalty' ? `−${r.magnitude}` : r.effect === 'boost' ? `+${r.magnitude}` : r.effect
  return `${cond} → ${eff}`
}

// ── Tradeoffs (exchange rate: improvement in one field buys extra rent) ─────

const GAIN_UNIT: Record<Tradeoff['gainField'], { unit: string; better: 'lower' | 'higher'; noun: string }> = {
  commuteMinutes: { unit: 'min', better: 'lower', noun: 'commute' },
  walkToTransitMinutes: { unit: 'min', better: 'lower', noun: 'walk to transit' },
  sqft: { unit: 'sq ft', better: 'higher', noun: 'space' },
}

export function describeTradeoff(t: Tradeoff): string {
  const g = GAIN_UNIT[t.gainField]
  const dir = g.better === 'lower' ? `below ${t.baseline} ${g.unit}` : `above ${t.baseline} ${g.unit}`
  return `each ${g.unit} of ${g.noun} ${dir} is worth $${t.dollarsPerUnit.toFixed(2).replace(/\.00$/, '')}, up to $${t.maxDollars} more rent`
}

// How many dollars of extra rent this listing's advantage is worth, and why.
export function tradeoffCredit(t: Tradeoff, l: Listing): { credit: number; gain: number; label: string } | null {
  const g = GAIN_UNIT[t.gainField]
  const value = t.gainField === 'sqft' ? l.sqft : t.gainField === 'commuteMinutes' ? l.transit?.commuteMinutes : l.transit?.walkMinutes
  if (value == null) return null
  const gain = g.better === 'lower' ? t.baseline - value : value - t.baseline
  if (gain <= 0) return null
  const credit = Math.round(Math.min(t.maxDollars, gain * t.dollarsPerUnit))
  const adj = g.better === 'lower' ? 'shorter' : 'more'
  return { credit, gain, label: `Tradeoff: ${gain} ${g.unit} ${adj} ${g.noun} worth $${credit}` }
}

// ── Rank one listing ────────────────────────────────────────────────────────

export function rankListing(prefs: Preferences, rules: LearnedRule[], l: Listing): Ranked {
  const zero = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])) as ComponentPoints
  const checks = buildChecks(prefs, l)
  const reject = (reason: string): Ranked => ({
    listing: l, score: 0, status: 'rejected', rejectReason: reason,
    components: zero, ruleHits: [], reasons: [], concerns: [reason], checks,
  })

  // Learned tradeoffs: dollars of extra rent this listing's advantages are worth
  const tradeoffs = rules
    .filter((r) => r.kind === 'tradeoff' && r.tradeoff)
    .map((r) => ({ rule: r, hit: tradeoffCredit(r.tradeoff!, l) }))
    .filter((x): x is { rule: LearnedRule; hit: NonNullable<ReturnType<typeof tradeoffCredit>> } => !!x.hit && x.hit.credit > 0)
  const credit = tradeoffs.reduce((s, x) => s + x.hit.credit, 0)
  const effectivePrice = l.price === null ? null : l.price - credit

  // Hard eliminators from the profile (budget uses the tradeoff-adjusted price)
  if (l.city.toLowerCase() !== prefs.city.toLowerCase()) return reject('Wrong city')
  if (effectivePrice !== null && effectivePrice > prefs.budgetMax + prefs.budgetFlex) return reject(`Over budget ($${l.price})`)
  if (l.petsAllowed === false && prefs.petsHave) return reject('No pets allowed')
  if (l.ownBathroom === false && prefs.ownBathRequired) return reject('Shared bathroom')

  const ratios = componentRatios(prefs, l)
  const totalWeight = WEIGHT_KEYS.reduce((s, k) => s + prefs.weights[k], 0) || 1
  const components = { ...zero }
  for (const k of WEIGHT_KEYS) components[k] = (ratios[k] * prefs.weights[k] * 100) / totalWeight

  let score = WEIGHT_KEYS.reduce((s, k) => s + components[k], 0)

  // Tradeoff bonus = budget points at the adjusted price minus budget points at
  // the real price. Kept out of `components` so it is attributed explicitly.
  const ruleHits: RuleHit[] = []
  if (credit > 0 && l.price !== null) {
    const bonus = ((budgetRatio(prefs, effectivePrice) - budgetRatio(prefs, l.price)) * prefs.weights.budget * 100) / totalWeight
    // Split across tradeoffs in proportion to the credit each contributed
    for (const { rule, hit } of tradeoffs) {
      const delta = Math.round((bonus * hit.credit) / credit)
      if (delta === 0) continue
      score += delta
      ruleHits.push({ ruleId: rule.id, effect: 'tradeoff', delta, label: hit.label })
    }
  }

  // Learned rules
  let flagged = false
  for (const r of rules) {
    if (!ruleMatches(r, l)) continue
    const label = r.reason || describeRule(r)
    if (r.effect === 'reject') {
      return { ...reject(`Learned rule: ${label}`), ruleHits: [{ ruleId: r.id, effect: 'reject', delta: 0, label }] }
    }
    if (r.effect === 'flag') {
      flagged = true
      ruleHits.push({ ruleId: r.id, effect: 'flag', delta: 0, label })
      continue
    }
    const delta = r.effect === 'penalty' ? -r.magnitude : r.magnitude
    score += delta
    ruleHits.push({ ruleId: r.id, effect: r.effect, delta, label })
  }

  score = Math.round(Math.max(0, Math.min(99, score)))

  const concerns: string[] = []
  if (l.legitimacyScore < LEGITIMACY_FLAG_BELOW) {
    flagged = true
    concerns.push('Looks questionable — verify before reaching out')
  }
  if (l.price !== null && l.price > prefs.budgetMax) {
    concerns.push(`$${l.price - prefs.budgetMax} over budget${credit > 0 ? ` — offset by $${credit} tradeoff` : ' (within flex)'}`)
  }
  if (l.transit && l.transit.walkMinutes > 10) concerns.push(`${l.transit.walkMinutes} min walk to ${l.transit.station} (est.)`)
  for (const h of ruleHits) if (h.delta < 0) concerns.push(h.label)

  const reasons = WEIGHT_KEYS
    .filter((k) => ratios[k] >= 0.8 && prefs.weights[k] > 0)
    .sort((a, b) => components[b] - components[a])
    .slice(0, 3)
    .map((k) => reasonFor(k, l, prefs))

  const status: Ranked['status'] = flagged ? 'flagged' : score < MATCH_THRESHOLD ? 'rejected' : 'match'
  return {
    listing: l, score, status,
    rejectReason: status === 'rejected' ? (ruleHits.some((h) => h.delta < 0) ? 'Scored low after learned rules' : 'Low overall fit') : null,
    components, ruleHits, reasons, concerns, checks,
  }
}

function reasonFor(k: WeightKey, l: Listing, prefs: Preferences): string {
  switch (k) {
    case 'budget': return l.price !== null ? `$${prefs.budgetMax - l.price} under budget` : 'Price fits'
    case 'neighborhood': return `In ${l.neighborhood}, one of your neighborhoods`
    case 'transit': return l.transit ? `${l.transit.walkMinutes} min to ${l.transit.station} (est.)` : 'Near transit'
    case 'space': return `${l.sqft} sq ft`
    case 'moveIn': return 'Move-in date lines up'
    case 'legitimacy': return 'Verified-looking listing'
  }
}

function buildChecks(prefs: Preferences, l: Listing): Check[] {
  const checks: Check[] = []
  if (l.price !== null) checks.push({ label: `$${l.price.toLocaleString()}`, ok: l.price <= prefs.budgetMax })
  if (l.transit) {
    checks.push({ label: `${l.transit.walkMinutes} min to ${l.transit.station}`, ok: l.transit.walkMinutes <= 10, estimated: true })
    checks.push({
      label: `${l.transit.commuteMinutes} min commute to FiDi`,
      ok: prefs.maxCommuteMinutes === null || l.transit.commuteMinutes <= prefs.maxCommuteMinutes,
      estimated: true,
    })
  }
  if (l.neighborhood) {
    const ok = prefs.neighborhoods.some((n) => n.toLowerCase() === l.neighborhood!.toLowerCase())
    checks.push({ label: ok ? `${l.neighborhood} — in your neighborhoods` : `${l.neighborhood}`, ok })
  }
  if (l.sqft !== null) checks.push({ label: `${l.sqft} sq ft`, ok: l.sqft >= 450 })
  return checks
}

// ── Dedup ───────────────────────────────────────────────────────────────────

export function dedupeKey(l: Listing): string {
  const t = l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return `${t}|${l.price ?? ''}|${(l.neighborhood ?? '').toLowerCase()}`
}
