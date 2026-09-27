import { interpretCorrection } from '@/lib/agent/interpret'
import { DEMO_PROFILE } from '@/lib/data/seed'
import { newId } from '@/lib/memory/local-store'
import {
  isGbrainLive,
  isMemorableLive,
  localPreferenceStore,
  localRuleStore,
  pushPreferenceToGbrain,
  pushRuleToMemorable,
  syncGbrainPage,
} from '@/lib/memory/providers'
import { applyPreferenceMemories } from '@/lib/ranker'
import { loadListings } from '@/lib/run'
import type { LearnedRule, PreferenceMemory } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Streams newline-delimited JSON so the UI can show each learning step as it
// actually completes:
//   {"type":"step","id":"interpret"|"gbrain"|"memorable","status":"active"|"done"|"skipped"|"error","detail"?}
//   {"type":"result", reply, engine, preferences, rules}
export async function POST(req: Request) {
  const { utterance, listingId, source } = await req.json()
  if (typeof utterance !== 'string' || !utterance.trim()) {
    return Response.json({ error: 'utterance is required' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      const step = (id: string, status: string, detail?: string) => send({ type: 'step', id, status, detail })

      try {
        // 1. Claude interprets the correction
        step('interpret', 'active')
        const [memories, rules, listings] = await Promise.all([
          localPreferenceStore.list(),
          localRuleStore.list(),
          listingId ? loadListings(source === 'supabase' ? 'supabase' : 'seed') : Promise.resolve([]),
        ])
        const listing = listings.find((l) => l.id === listingId) ?? null
        const prefs = applyPreferenceMemories(DEMO_PROFILE, memories)
        const result = await interpretCorrection({ utterance, listing, prefs, existingRules: rules })
        const now = new Date().toISOString()

        const newPrefs: PreferenceMemory[] = result.preferences.map((p) => ({
          id: newId('pref'), statement: p.statement, patch: p.patch, source: 'correction', utterance, createdAt: now,
        }))
        const newRules: LearnedRule[] = result.rules.map((r) => ({
          ...r, id: newId('rule'), createdAt: now, timesApplied: 0,
          source: { kind: 'correction', utterance, listingId: listing?.id ?? null },
        }))
        for (const p of newPrefs) await localPreferenceStore.add(p)
        for (const r of newRules) await localRuleStore.add(r)
        step('interpret', 'done', [
          `${newPrefs.length} preference${newPrefs.length === 1 ? '' : 's'}, ${newRules.length} rule${newRules.length === 1 ? '' : 's'}`,
          result.engine === 'fallback' ? 'offline keyword parser' : null,
        ].filter(Boolean).join(' · '))

        // 2. Durable preferences → GBrain (fact + summary page)
        if (!isGbrainLive()) {
          step('gbrain', 'skipped', 'GBrain offline — kept in local memory')
        } else if (!newPrefs.length && !newRules.length) {
          step('gbrain', 'skipped', 'nothing new to remember')
        } else {
          step('gbrain', 'active')
          const factIds: string[] = []
          for (const p of newPrefs) {
            const id = await pushPreferenceToGbrain(p)
            if (id) { factIds.push(id); p.gbrainFactId = id }
          }
          const pageOk = await syncGbrainPage()
          const failed = factIds.length < newPrefs.length
          step('gbrain', failed && !pageOk ? 'error' : 'done', [
            factIds.length ? `fact ${factIds.map((id) => `#${id}`).join(', ')}` : null,
            pageOk ? '“Scout housing search” page updated' : null,
            failed ? 'some writes failed — kept locally' : null,
          ].filter(Boolean).join(' · '))
        }

        // 3. Learned rules → Memorable procedures
        if (!isMemorableLive()) {
          step('memorable', 'skipped', 'Memorable offline — kept in local memory')
        } else if (!newRules.length) {
          step('memorable', 'skipped', 'no new rule to capture')
        } else {
          step('memorable', 'active')
          let captured = 0
          let stepsTotal = 0
          for (const r of newRules) {
            const draft = await pushRuleToMemorable(r)
            if (draft) { captured++; stepsTotal += draft.steps.length; r.memorable = draft }
          }
          if (captured) await syncGbrainPage() // page mentions the procedure
          step('memorable', captured ? 'done' : 'error',
            captured ? `${captured} procedure${captured === 1 ? '' : 's'} captured · ${stepsTotal} steps` : 'capture failed — kept locally')
        }

        send({ type: 'result', reply: result.reply, engine: result.engine, preferences: newPrefs, rules: newRules })
      } catch (err) {
        console.error('[feedback] failed', err)
        send({ type: 'error', message: err instanceof Error ? err.message : 'Learning failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}
