import { DEMO_PROFILE } from '@/lib/data/seed'
import { preferenceStore, providerStatuses, ruleStore } from '@/lib/memory/providers'
import { applyPreferenceMemories, describeRule } from '@/lib/ranker'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [preferences, rules] = await Promise.all([preferenceStore.list(), ruleStore.list()])
  return Response.json({
    profile: DEMO_PROFILE,
    effective: applyPreferenceMemories(DEMO_PROFILE, preferences),
    preferences,
    rules: rules.map((r) => ({ ...r, description: describeRule(r) })),
    providers: providerStatuses(),
    links: {
      gbrain: process.env.GBRAIN_DASHBOARD_URL || 'https://gbrain.io/memory',
      memorable: process.env.MEMORABLE_DASHBOARD_URL || 'https://www.memorable.sh/dash',
    },
  })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const id = url.searchParams.get('id')
  if (!id || (kind !== 'preference' && kind !== 'rule')) {
    return Response.json({ error: 'kind (preference|rule) and id are required' }, { status: 400 })
  }
  if (kind === 'preference') await preferenceStore.remove(id)
  else await ruleStore.remove(id)
  return Response.json({ ok: true })
}
