import type { TransitEstimate } from './types'

// Hand-estimated walk-to-rapid-transit (BART / Muni Metro) and commute-to-FiDi
// times per SF neighborhood. Deliberately coarse — every value surfaces in the
// UI labeled "est." Listings can override walkMinutes with a closer estimate.
const TABLE: Record<string, Omit<TransitEstimate, 'estimated'>> = {
  'mission': { station: '16th St Mission BART', walkMinutes: 6, commuteMinutes: 22 },
  'bernal heights': { station: '24th St Mission BART', walkMinutes: 16, commuteMinutes: 36 },
  'noe valley': { station: '24th St Mission BART', walkMinutes: 14, commuteMinutes: 34 },
  'hayes valley': { station: 'Civic Center BART', walkMinutes: 8, commuteMinutes: 20 },
  'soma': { station: 'Powell St BART', walkMinutes: 7, commuteMinutes: 15 },
  'dogpatch': { station: '3rd St Muni (T)', walkMinutes: 5, commuteMinutes: 28 },
  'potrero hill': { station: '16th St Mission BART', walkMinutes: 20, commuteMinutes: 38 },
  'glen park': { station: 'Glen Park BART', walkMinutes: 5, commuteMinutes: 26 },
  'castro': { station: 'Castro Muni Metro', walkMinutes: 4, commuteMinutes: 24 },
  'lower haight': { station: 'Church St Muni Metro', walkMinutes: 7, commuteMinutes: 26 },
  'inner sunset': { station: 'Irving & 9th Muni (N)', walkMinutes: 5, commuteMinutes: 40 },
  'outer sunset': { station: 'Judah Muni (N)', walkMinutes: 9, commuteMinutes: 52 },
  'inner richmond': { station: 'Geary 38R (bus)', walkMinutes: 22, commuteMinutes: 42 },
  'outer richmond': { station: 'Geary 38R (bus)', walkMinutes: 28, commuteMinutes: 55 },
  'marina': { station: 'Montgomery St BART', walkMinutes: 35, commuteMinutes: 35 },
  'nob hill': { station: 'Powell St BART', walkMinutes: 12, commuteMinutes: 18 },
  'tenderloin': { station: 'Civic Center BART', walkMinutes: 5, commuteMinutes: 14 },
  'excelsior': { station: 'Balboa Park BART', walkMinutes: 15, commuteMinutes: 38 },
  'bayview': { station: '3rd St Muni (T)', walkMinutes: 8, commuteMinutes: 40 },
  'duboce triangle': { station: 'Church St Muni Metro', walkMinutes: 5, commuteMinutes: 22 },
}

export function estimateTransit(neighborhood: string | null, walkOverride?: number): TransitEstimate | null {
  if (!neighborhood) return null
  const row = TABLE[neighborhood.trim().toLowerCase()]
  if (!row) return null
  return { ...row, walkMinutes: walkOverride ?? row.walkMinutes, estimated: true }
}
