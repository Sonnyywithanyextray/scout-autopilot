// Turns a natural-language correction into structured, persistent changes:
//   preference updates (durable facts → GBrain) and learned rules (→ Memorable).
// Claude only proposes changes inside a constrained schema; everything is
// validated/clamped here before it touches the ranker.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { LearnedRule, Listing, Preferences, PreferencePatch, RuleValue } from '../types'
import { RULE_EFFECTS, RULE_FIELDS, RULE_OPERATORS, WEIGHT_KEYS } from '../types'
import { describeRule } from '../ranker'

const MODEL = 'claude-opus-5'

const WeightsSchema = z.object(
  Object.fromEntries(WEIGHT_KEYS.map((k) => [k, z.number().nullable()])) as Record<(typeof WEIGHT_KEYS)[number], z.ZodNullable<z.ZodNumber>>,
)

const CorrectionSchema = z.object({
  reply: z.string().describe('One short sentence to the user confirming what Scout learned, first person.'),
  preferences: z.array(
    z.object({
      statement: z.string().describe('Durable fact about the renter, e.g. "Transit access matters more than apartment size".'),
      budgetMax: z.number().nullable(),
      maxCommuteMinutes: z.number().nullable(),
      ownBathRequired: z.boolean().nullable(),
      neighborhoodsAdd: z.array(z.string()).nullable(),
      neighborhoodsRemove: z.array(z.string()).nullable(),
      avoidNeighborhoodsAdd: z.array(z.string()).nullable(),
      weights: WeightsSchema.nullable().describe('New absolute weights (0-60) for ranking components that should change; null for unchanged ones.'),
    }),
  ),
  rules: z.array(
    z.object({
      field: z.enum(RULE_FIELDS),
      operator: z.enum(RULE_OPERATORS),
      value: z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]),
      effect: z.enum(RULE_EFFECTS),
      magnitude: z.number().describe('Score points 5-40 for penalty/boost; 0 for reject/flag.'),
      reason: z.string().describe('Short human-readable reason, e.g. "Over 10 min walk to rapid transit".'),
    }),
  ),
})

export type Interpretation = {
  reply: string
  preferences: { statement: string; patch: PreferencePatch }[]
  rules: Omit<LearnedRule, 'id' | 'createdAt' | 'timesApplied' | 'source'>[]
  engine: 'claude' | 'fallback'
}

const SYSTEM = `You are Scout, an apartment-search agent for a renter in San Francisco.
The user is correcting how you rank listings. Convert their feedback into structured changes that a deterministic ranker will apply on every future search.

Two kinds of output:
1. preferences — durable facts about the renter (budget, commute cap, neighborhoods, and relative importance of ranking components). Ranking components and their weights: budget, neighborhood, transit (walk to BART/Muni), space (sq ft), moveIn, legitimacy. When the user signals a priority shift ("X matters more than Y", or rejects a listing for a reason tied to a component), raise that component's weight and lower the competing one so the change is visible.
2. rules — concrete, reusable procedures learned from the correction, as field/operator/value → effect. Prefer a penalty over reject unless the user states a dealbreaker. Use magnitude 20-30 for "rank much lower", 10-15 for mild dislikes.

Rule fields: price ($/mo), walkToTransitMinutes, commuteMinutes (to FiDi), sqft, bedrooms, neighborhood (string, or string[] with in/not_in), ownBathroom, petsAllowed, legitimacyScore (0-1), postedDaysAgo, source.
Only encode what the user actually said or clearly implied. Do not repeat a rule or preference that already exists. Return empty arrays if nothing should change.`

export async function interpretCorrection(input: {
  utterance: string
  listing: Listing | null
  prefs: Preferences
  existingRules: LearnedRule[]
}): Promise<Interpretation> {
  if (!process.env.ANTHROPIC_API_KEY) return heuristic(input.utterance, input.listing)
  try {
    return await withClaude(input)
  } catch (err) {
    console.error('[interpret] Claude failed, using fallback parser', err)
    return heuristic(input.utterance, input.listing)
  }
}

async function withClaude(input: Parameters<typeof interpretCorrection>[0]): Promise<Interpretation> {
  const client = new Anthropic()
  const context = {
    currentPreferences: input.prefs,
    existingRules: input.existingRules.map((r) => describeRule(r)),
    listingBeingCorrected: input.listing && {
      title: input.listing.title,
      price: input.listing.price,
      neighborhood: input.listing.neighborhood,
      sqft: input.listing.sqft,
      walkToTransitMinutes: input.listing.transit?.walkMinutes ?? null,
      station: input.listing.transit?.station ?? null,
      commuteMinutes: input.listing.transit?.commuteMinutes ?? null,
    },
  }

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(CorrectionSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\nUser feedback: ${input.utterance}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`No structured output (stop_reason=${response.stop_reason})`)
  }
  const out = response.parsed_output

  return {
    engine: 'claude',
    reply: out.reply,
    preferences: out.preferences.map((p) => ({
      statement: p.statement,
      patch: cleanPatch({
        budgetMax: p.budgetMax,
        maxCommuteMinutes: p.maxCommuteMinutes,
        ownBathRequired: p.ownBathRequired,
        neighborhoodsAdd: p.neighborhoodsAdd,
        neighborhoodsRemove: p.neighborhoodsRemove,
        avoidNeighborhoodsAdd: p.avoidNeighborhoodsAdd,
        weights: p.weights
          ? Object.fromEntries(Object.entries(p.weights).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, clamp(v as number, 0, 60)]))
          : null,
      }),
    })),
    rules: out.rules.map((r) => ({
      field: r.field,
      operator: r.operator,
      value: coerceValue(r.value, r.operator),
      effect: r.effect,
      magnitude: r.effect === 'penalty' || r.effect === 'boost' ? clamp(Math.round(r.magnitude), 5, 40) : 0,
      reason: r.reason.slice(0, 120),
    })),
  }
}

function cleanPatch(p: PreferencePatch): PreferencePatch {
  return Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)),
  ) as PreferencePatch
}

function coerceValue(v: RuleValue, op: string): RuleValue {
  if ((op === 'in' || op === 'not_in') && !Array.isArray(v)) return [String(v)]
  if (['>', '>=', '<', '<='].includes(op) && typeof v === 'string' && !Number.isNaN(Number(v))) return Number(v)
  return v
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ── Keyword fallback: keeps the demo alive with no API key / network ───────

function heuristic(utterance: string, listing: Listing | null): Interpretation {
  const u = utterance.toLowerCase()
  const out: Interpretation = { engine: 'fallback', reply: '', preferences: [], rules: [] }
  const minutes = u.match(/(\d+)\s*(?:-|\s)?\s*min/)
  const transitWords = /(bart|transit|muni|train|station|subway)/.test(u)

  if (transitWords && /(more than|over|rather than|than)\s.*(size|space|sq|square)/.test(u)) {
    out.preferences.push({ statement: 'Transit access matters more than apartment size', patch: { weights: { transit: 25, space: 10 } } })
  }
  if (transitWords && minutes) {
    const n = Number(minutes[1])
    out.rules.push({ field: 'walkToTransitMinutes', operator: '>', value: n, effect: 'penalty', magnitude: 25, reason: `Over ${n} min walk to rapid transit` })
    if (!out.preferences.length) {
      out.preferences.push({ statement: 'Walkable rapid transit is a top priority', patch: { weights: { transit: 25, space: 10 } } })
    }
  } else if (transitWords && /(far|too long|walk)/.test(u) && listing?.transit) {
    const n = Math.max(5, listing.transit.walkMinutes - 5)
    out.rules.push({ field: 'walkToTransitMinutes', operator: '>', value: n, effect: 'penalty', magnitude: 25, reason: `Over ${n} min walk to rapid transit` })
  }
  const commute = u.match(/commute.*?(\d+)\s*min|(\d+)\s*min.*commute/)
  if (commute) {
    const n = Number(commute[1] ?? commute[2])
    out.preferences.push({ statement: `Commute should be under ${n} minutes`, patch: { maxCommuteMinutes: n } })
    out.rules.push({ field: 'commuteMinutes', operator: '>', value: n, effect: 'penalty', magnitude: 20, reason: `Commute over ${n} min` })
  }
  const budget = u.match(/\$\s?(\d[\d,]{2,})/)
  if (budget && /(max|under|below|budget|no more)/.test(u)) {
    const n = Number(budget[1].replace(/,/g, ''))
    out.preferences.push({ statement: `Max rent is $${n.toLocaleString()}`, patch: { budgetMax: n } })
  }
  if (/(shared bath|own bath|private bath)/.test(u)) {
    out.preferences.push({ statement: 'Needs a private bathroom', patch: { ownBathRequired: true } })
  }

  out.reply = out.preferences.length || out.rules.length
    ? `Got it — I'll apply ${[...out.preferences.map((p) => p.statement.toLowerCase()), ...out.rules.map((r) => r.reason.toLowerCase())].join('; ')} from now on.`
    : "I couldn't turn that into a rule yet — try something like \"anything over 10 min from BART should rank lower\"."
  return out
}
