import { gbrainForget } from '@/lib/memory/gbrain'
import { updateState } from '@/lib/memory/local-store'
import { syncGbrainPage } from '@/lib/memory/providers'

export const dynamic = 'force-dynamic'

// Wipes hackathon-local state (learned prefs, rules, last run) and expires the
// matching GBrain facts. Never touches Scout's production data.
export async function POST() {
  const factIds = await updateState((s) => {
    const ids = s.preferences.map((p) => p.gbrainFactId).filter((x): x is string => !!x)
    s.preferences = []
    s.rules = []
    s.lastRun = null
    return ids
  })
  await Promise.all(factIds.map((id) => gbrainForget(id).catch((err) => console.error('[reset] GBrain forget failed', err))))
  await syncGbrainPage()
  return Response.json({ ok: true })
}
