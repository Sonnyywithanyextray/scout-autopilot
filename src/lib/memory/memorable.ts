// Memorable Extraction API: turns the correction run's tool-call trace into a
// reusable procedure draft. Memorable keeps no full copy, so the returned
// draft is stored alongside the rule on our side.

import { describeRule } from '../ranker'
import type { LearnedRule } from '../types'

const BASE = 'https://memorable-extraction-api.memorable.workers.dev'

export interface MemorableDraft {
  requestId: string | null
  title: string
  steps: { seq: number; action: string; activity_class?: string }[]
}

export async function memorableExtract(rule: LearnedRule): Promise<MemorableDraft | null> {
  const key = process.env.MEMORABLE_API_KEY?.trim()
  if (!key) throw new Error('MEMORABLE_API_KEY not set')
  const ruleText = describeRule(rule)

  // The corrected trajectory, as tool calls. Only allow-listed input fields,
  // no conversation text.
  const tool_calls = [
    { name: 'gbrain.recall', input: { query: 'renter housing preferences' }, result: { ok: true } },
    { name: 'scout.rank_listings', input: { query: 'rank inventory with learned weights' }, result: { ok: true } },
    { name: 'scout.user_rejected_listing', input: { path: rule.source.listingId ?? 'feedback' }, result: { ok: true } },
    { name: 'scout.learn_rule', input: { pattern: ruleText }, result: { ok: true } },
    { name: 'scout.rerank_listings', input: { pattern: ruleText }, result: { ok: true } },
  ]

  const res = await fetch(`${BASE}/v1/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: rule.id,
      harness: 'scout-autopilot',
      task_description: `Rank apartment listings applying learned rule: ${rule.reason}`.slice(0, 2000),
      skip_embedding: true,
      tool_calls,
    }),
    signal: AbortSignal.timeout(8000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Memorable extract HTTP ${res.status}: ${body.error ?? ''} (${body.request_id ?? 'no request id'})`)
  if (body.refused) {
    console.warn('[memorable] refused:', body.refused, body.detail)
    return null
  }
  return {
    requestId: body.request_id ?? null,
    title: body.draft?.title ?? rule.reason,
    steps: (body.draft?.steps ?? []).map((s: MemorableDraft['steps'][number]) => ({ seq: s.seq, action: s.action, activity_class: s.activity_class })),
  }
}
