import { updateState } from '@/lib/memory/local-store'

export const dynamic = 'force-dynamic'

// Wipes hackathon-local state only (learned prefs, rules, last run).
export async function POST() {
  await updateState((s) => {
    s.preferences = []
    s.rules = []
    s.lastRun = null
  })
  return Response.json({ ok: true })
}
