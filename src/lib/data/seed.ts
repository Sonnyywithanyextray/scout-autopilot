// Deterministic demo inventory. The hero listings are tuned so the scripted
// corrections produce a visible ranking flip:
//   - "Transit matters more than size"      → transit-heavy studios rise
//   - "Over 10 min walk to BART is too far" → the big Bernal 1BR falls out
//   - "I'll pay $150 more to save 20+ min of commute" → the Rincon Hill 1BR
//     ($125 over budget, 12-min commute) jumps past cheaper, farther places
// Filler is generated from a fixed-seed PRNG so every run is identical.

import { DEFAULT_WEIGHTS } from '../ranker'
import { estimateTransit } from '../transit'
import type { Listing, Preferences } from '../types'

export const DEMO_PROFILE: Preferences = {
  city: 'San Francisco',
  budgetMax: 2600,
  budgetFlex: 150,
  neighborhoods: ['Mission', 'Bernal Heights', 'Noe Valley', 'Hayes Valley', 'SoMa', 'Dogpatch'],
  avoidNeighborhoods: [],
  moveInDate: '2026-11-01',
  moveInFlexDays: 14,
  petsHave: false,
  ownBathRequired: false,
  maxCommuteMinutes: 45,
  weights: { ...DEFAULT_WEIGHTS },
}

type SeedInput = Omit<Listing, 'transit' | 'city' | 'url'> & { walk?: number; commute?: number }

function make(s: SeedInput): Listing {
  const { walk, commute, ...rest } = s
  const transit = estimateTransit(s.neighborhood, walk)
  return { ...rest, city: 'San Francisco', url: null, transit: transit && commute !== undefined ? { ...transit, commuteMinutes: commute } : transit }
}

const HEROES: SeedInput[] = [
  { id: 'hero-bernal', title: 'Sunny 1BR with bay views + in-unit laundry', source: 'facebook', price: 2350, neighborhood: 'Bernal Heights', bedrooms: 1, sqft: 850, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.92, postedDaysAgo: 1, walk: 18 },
  { id: 'hero-mission', title: 'Bright studio 4 min from 16th St BART', source: 'roomies', price: 2485, neighborhood: 'Mission', bedrooms: 0, sqft: 480, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-05', legitimacyScore: 0.9, postedDaysAgo: 2, walk: 4 },
  { id: 'hero-hayes', title: 'Hayes Valley jr 1BR, walk to Civic Center', source: 'craigslist', price: 2550, neighborhood: 'Hayes Valley', bedrooms: 1, sqft: 560, ownBathroom: true, petsAllowed: false, moveInDate: '2026-10-28', legitimacyScore: 0.88, postedDaysAgo: 3, walk: 6 },
  { id: 'hero-noe', title: 'Noe Valley garden 1BR, quiet street', source: 'facebook', price: 2495, neighborhood: 'Noe Valley', bedrooms: 1, sqft: 780, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.9, postedDaysAgo: 4, walk: 15 },
  { id: 'hero-soma', title: 'SoMa loft studio near Powell BART', source: 'roomies', price: 2590, neighborhood: 'SoMa', bedrooms: 0, sqft: 520, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-10', legitimacyScore: 0.86, postedDaysAgo: 1, walk: 5 },
  // Tradeoff hero: $125 over budget but a 12-min commute. "I'll pay $150 more
  // if it saves me 20+ min of commute" should lift it past cheaper, longer-commute places.
  { id: 'hero-rincon', title: 'Rincon Hill 1BR, walk to the office', source: 'roomies', price: 2725, neighborhood: 'SoMa', bedrooms: 1, sqft: 610, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.9, postedDaysAgo: 1, walk: 4, commute: 12 },
  { id: 'hero-potrero', title: 'Huge Potrero Hill 1BR with private deck', source: 'craigslist', price: 2300, neighborhood: 'Potrero Hill', bedrooms: 1, sqft: 950, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.85, postedDaysAgo: 2, walk: 20 },
]

// Small fixed-seed PRNG (mulberry32)
function prng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FILLER_HOODS = ['Mission', 'Bernal Heights', 'Noe Valley', 'SoMa', 'Dogpatch', 'Outer Sunset', 'Inner Richmond', 'Outer Richmond', 'Marina', 'Excelsior', 'Tenderloin', 'Nob Hill', 'Castro', 'Lower Haight', 'Bayview']
const FILLER_TITLES = ['Room in 3BR flat', 'Cozy studio', '1BR apartment', 'Private room, shared bath', 'Top-floor studio', 'Renovated 1BR', 'Room in Victorian', 'Junior 1BR']
const SOURCES = ['facebook', 'roomies', 'craigslist', 'reddit']

function filler(): SeedInput[] {
  const rand = prng(42)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const out: SeedInput[] = []
  for (let i = 0; i < 30; i++) {
    const hood = pick(FILLER_HOODS)
    const title = `${pick(FILLER_TITLES)} — ${hood}`
    const overBudget = rand() < 0.4
    const price = overBudget ? 2800 + Math.round(rand() * 12) * 100 : 2150 + Math.round(rand() * 9) * 50
    const sharedRoom = title.startsWith('Room') || title.startsWith('Private room')
    out.push({
      id: `f${i}`,
      title,
      source: pick(SOURCES),
      price,
      neighborhood: hood,
      bedrooms: sharedRoom ? 3 : 1,
      sqft: sharedRoom ? 140 + Math.round(rand() * 80) : 380 + Math.round(rand() * 250),
      ownBathroom: !sharedRoom,
      petsAllowed: rand() > 0.3,
      moveInDate: rand() > 0.75 ? '2026-11-01' : '2026-12-15',
      legitimacyScore: 0.52 + rand() * 0.3,
      postedDaysAgo: Math.floor(rand() * 20),
    })
  }
  return out
}

const QUESTIONABLE: SeedInput[] = [
  { id: 'q1', title: 'LUXURY 2BR $1200 wire deposit to hold!!', source: 'facebook', price: 1200, neighborhood: 'Mission', bedrooms: 2, sqft: 900, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.12, postedDaysAgo: 0 },
  { id: 'q2', title: 'Owner overseas, keys by mail — SoMa 1BR', source: 'craigslist', price: 1450, neighborhood: 'SoMa', bedrooms: 1, sqft: 700, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.2, postedDaysAgo: 1 },
  { id: 'q3', title: 'Hayes studio, no viewing, Zelle only', source: 'reddit', price: 1600, neighborhood: 'Hayes Valley', bedrooms: 0, sqft: 500, ownBathroom: true, petsAllowed: true, moveInDate: '2026-11-01', legitimacyScore: 0.3, postedDaysAgo: 2 },
]

// Cross-posted copies of real listings → exercised by dedup
const DUPLICATES: SeedInput[] = [
  { ...HEROES[0], id: 'dup-bernal-cl', source: 'craigslist' },
  { ...HEROES[1], id: 'dup-mission-fb', source: 'facebook' },
  { ...HEROES[3], id: 'dup-noe-rd', source: 'reddit' },
]

export function seedListings(): Listing[] {
  return [...HEROES, ...filler(), ...QUESTIONABLE, ...DUPLICATES].map(make)
}
