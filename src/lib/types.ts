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

export interface LearnedRule {
  id: string
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
  effect: RuleEffect
  delta: number // points added (negative for penalties)
  label: string
}

export interface Check {
  label: string
  ok: boolean
  estimated?: boolean
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
}

export interface ScoreDelta {
  listingId: string
  title: string
  before: number
  after: number
  statusBefore: Ranked['status']
  statusAfter: Ranked['status']
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
