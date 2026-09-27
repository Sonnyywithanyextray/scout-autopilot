// ── Listings ────────────────────────────────────────────────────────────────

export interface TransitEstimate {
  station: string
  walkMinutes: number
  commuteMinutes: number
  // Always true today — derived from a neighborhood lookup, not a routing API.
  estimated: true
}

export interface Listing {
  id: string
  title: string
  source: string
  url: string | null
  price: number | null
  city: string
  neighborhood: string | null
  bedrooms: number | null
  sqft: number | null
  ownBathroom: boolean | null
  petsAllowed: boolean | null
  moveInDate: string | null
  legitimacyScore: number // 0..1
  postedDaysAgo: number
  transit: TransitEstimate | null
}

// ── Durable preferences (GBrain) ────────────────────────────────────────────

export const WEIGHT_KEYS = ['budget', 'neighborhood', 'transit', 'space', 'moveIn', 'legitimacy'] as const
export type WeightKey = (typeof WEIGHT_KEYS)[number]
export type Weights = Record<WeightKey, number>

export interface Preferences {
  city: string
  budgetMax: number
  budgetFlex: number
  neighborhoods: string[]
  avoidNeighborhoods: string[]
  moveInDate: string | null
  moveInFlexDays: number
  petsHave: boolean
  ownBathRequired: boolean
  maxCommuteMinutes: number | null
  weights: Weights
}

export interface PreferencePatch {
  budgetMax?: number | null
  budgetFlex?: number | null
  maxCommuteMinutes?: number | null
  ownBathRequired?: boolean | null
  petsHave?: boolean | null
  neighborhoodsAdd?: string[] | null
  neighborhoodsRemove?: string[] | null
  avoidNeighborhoodsAdd?: string[] | null
  weights?: Partial<Weights> | null
}

export interface PreferenceMemory {
  id: string
  statement: string // human-readable, e.g. "Transit matters more than apartment size"
  patch: PreferencePatch
  source: 'onboarding' | 'correction'
  utterance: string | null
  createdAt: string
  gbrainFactId?: string | null
}

// ── Learned rules (Memorable) ───────────────────────────────────────────────

export const RULE_FIELDS = [
  'price',
  'walkToTransitMinutes',
  'commuteMinutes',
  'sqft',
  'bedrooms',
  'neighborhood',
  'ownBathroom',
  'petsAllowed',
  'legitimacyScore',
  'postedDaysAgo',
  'source',
] as const
export type RuleField = (typeof RULE_FIELDS)[number]

export const RULE_OPERATORS = ['>', '>=', '<', '<=', '==', '!=', 'in', 'not_in'] as const
export type RuleOperator = (typeof RULE_OPERATORS)[number]

export const RULE_EFFECTS = ['penalty', 'boost', 'reject', 'flag'] as const
export type RuleEffect = (typeof RULE_EFFECTS)[number]

export type RuleValue = number | string | boolean | string[]

// Exchange-rate tradeoff: "I'll pay up to $maxDollars more, at $dollarsPerUnit
// per unit of improvement in gainField below/above baseline."
export const TRADEOFF_GAIN_FIELDS = ['commuteMinutes', 'walkToTransitMinutes', 'sqft'] as const
export type TradeoffGainField = (typeof TRADEOFF_GAIN_FIELDS)[number]

export interface Tradeoff {
  gainField: TradeoffGainField
  baseline: number // improvement is measured from here (e.g. 45-min commute)
  dollarsPerUnit: number // e.g. $7.50 per minute saved
  maxDollars: number // cap on extra rent the renter will accept
}

export interface LearnedRule {
  id: string
  kind?: 'threshold' | 'tradeoff' // absent = threshold (field/operator/value)
  tradeoff?: Tradeoff
  field: RuleField
  operator: RuleOperator
  value: RuleValue
  effect: RuleEffect
  magnitude: number // points, ignored for reject/flag
  reason: string
  source: { kind: 'correction'; utterance: string; listingId: string | null }
  createdAt: string
  timesApplied: number
  memorable?: { requestId: string | null; title: string; steps: { seq: number; action: string; activity_class?: string }[] } | null
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export type ComponentPoints = Record<WeightKey, number>

export interface RuleHit {
  ruleId: string
  effect: RuleEffect | 'tradeoff'
  delta: number // points added (negative for penalties)
  label: string
}

export interface Check {
  label: string
  ok: boolean
  estimated?: boolean
}

export interface Counterfactual {
  lever: 'price' | 'walk' | 'commute'
  change: string // e.g. "rent were $125 lower ($2,600)"
  fromRank: number | null // null = not currently a match
  toRank: number
  fromScore: number
  toScore: number
  responsible: string | null // learned rule costing it points, if any
  sentence: string
}

export interface Ranked {
  listing: Listing
  score: number
  status: 'match' | 'rejected' | 'flagged' | 'duplicate'
  rejectReason: string | null
  components: ComponentPoints
  ruleHits: RuleHit[]
  reasons: string[]
  concerns: string[]
  checks: Check[]
  rank?: number | null // position among matches (set by the run)
  counterfactual?: Counterfactual | null
}

export interface ScoreDelta {
  listingId: string
  title: string
  before: number
  after: number
  statusBefore: Ranked['status']
  statusAfter: Ranked['status']
  rankBefore: number | null // position among matches, 1-based
  rankAfter: number | null
  causes: { label: string; delta: number }[]
}

export interface TraceStep {
  label: string
  detail?: string
}

export interface RunResult {
  runId: string
  at: string
  source: 'seed' | 'supabase'
  trace: TraceStep[]
  stats: {
    loaded: number
    duplicates: number
    rejected: number
    rejectedByRules: number
    flagged: number
    matches: number
    preferencesRecalled: number
    rulesApplied: number
  }
  matches: Ranked[]
  nearMisses: Ranked[] // next-best listings, with what would lift them
  flagged: Ranked[]
  movers: ScoreDelta[]
  providers: ProviderStatus[]
}

export interface ProviderStatus {
  role: 'preferences' | 'rules' | 'reasoning' | 'inventory'
  name: string
  mode: 'live' | 'fallback'
  note?: string
}
