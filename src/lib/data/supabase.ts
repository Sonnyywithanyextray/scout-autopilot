// Read-only view of Scout's production `listings` table. Only `.select()` is
// ever called here — hackathon state lives in the local store, not prod.

import { createClient } from '@supabase/supabase-js'
import { estimateTransit } from '../transit'
import type { Listing } from '../types'

export function supabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
}

type Row = {
  id: string
  title: string | null
  source: string | null
  source_url: string | null
  price: number | null
  city: string | null
  neighborhood: string | null
  bedrooms: number | null
  own_bathroom: boolean | null
  pets_allowed: boolean | null
  move_in_date: string | null
  legitimacy_score: number | null
  first_seen_at: string | null
}

export async function fetchSupabaseListings(limit = 200): Promise<Listing[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
  const db = createClient(process.env.SUPABASE_URL!, key, { auth: { persistSession: false } })
  const { data, error } = await db
    .from('listings')
    .select('id, title, source, source_url, price, city, neighborhood, bedrooms, own_bathroom, pets_allowed, move_in_date, legitimacy_score, first_seen_at')
    .eq('is_active', true)
    .or('expires_at.is.null,expires_at.gt.now()')
    .order('first_seen_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Supabase read failed: ${error.message}`)

  return ((data as Row[]) ?? []).map((r) => {
    const legit = r.legitimacy_score ?? 0.7
    return {
      id: r.id,
      title: r.title ?? 'Untitled listing',
      source: r.source ?? 'unknown',
      url: r.source_url,
      price: r.price,
      city: /^(sf|san francisco)$/i.test(r.city ?? '') ? 'San Francisco' : r.city ?? '',
      neighborhood: r.neighborhood,
      bedrooms: r.bedrooms,
      sqft: null,
      ownBathroom: r.own_bathroom,
      petsAllowed: r.pets_allowed,
      moveInDate: r.move_in_date,
      legitimacyScore: legit > 1 ? legit / 100 : legit,
      postedDaysAgo: r.first_seen_at ? Math.floor((Date.now() - Date.parse(r.first_seen_at)) / 86_400_000) : 0,
      transit: estimateTransit(r.neighborhood),
    }
  })
}
