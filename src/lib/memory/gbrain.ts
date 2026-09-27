// Minimal GBrain MCP client over streamable HTTP (stateless JSON-RPC).
// Uses the memory verbs: remember / recall / forget.

const ENDPOINT = process.env.GBRAIN_MCP_URL || 'https://gbrain.io/mcp'
export const GBRAIN_ENTITY = 'scout-renter'

export function gbrainToken(): string | null {
  const raw = process.env.GBRAIN_API_KEY?.trim()
  if (!raw) return null
  // Tolerate a pasted "Authorization: Bearer gbu_c_..." line
  return raw.replace(/^Authorization:\s*/i, '').replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '') || null
}

async function callTool<T>(name: string, args: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const token = gbrainToken()
  if (!token) throw new Error('GBRAIN_API_KEY not set')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`GBrain ${name} HTTP ${res.status}`)

  // Response may be plain JSON or an SSE stream whose last data: line is the result
  const raw = await res.text()
  const dataLines = [...raw.matchAll(/^data: (.*)$/gm)].map((m) => m[1])
  const msg = JSON.parse(dataLines.length ? dataLines[dataLines.length - 1] : raw)
  if (msg.error) throw new Error(`GBrain ${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`)
  if (msg.result?.isError) throw new Error(`GBrain ${name} tool error: ${msg.result.content?.[0]?.text ?? ''}`)
  const structured = msg.result?.structuredContent
  if (structured) return structured as T
  const text = msg.result?.content?.find((c: { type: string }) => c.type === 'text')?.text
  return JSON.parse(text) as T
}

export async function gbrainRemember(fact: string, provenance: string): Promise<string | null> {
  const out = await callTool<{ id?: string | number; status?: string }>('remember', {
    fact,
    kind: 'preference',
    entity: GBRAIN_ENTITY,
    provenance: provenance.slice(0, 500),
  })
  return out.id != null ? String(out.id) : null
}

export async function gbrainForget(id: string): Promise<void> {
  await callTool('forget', { id, reason: 'removed by user in Scout Autopilot' })
}

export async function gbrainRecallCount(): Promise<number> {
  const out = await callTool<{ facts?: unknown[] }>('recall', { entity: GBRAIN_ENTITY, limit: 100 }, 4000)
  return out.facts?.length ?? 0
}

// Facts don't render on GBrain's Memory page, so we also keep one human-
// readable page summarizing everything Scout has learned. Rewritten whole on
// every change (put_page replaces the page).
export const GBRAIN_PAGE_SLUG = 'projects/scout-housing-search'

export async function gbrainWriteSummaryPage(input: {
  preferences: { statement: string; utterance: string | null; createdAt: string }[]
  rules: { reason: string; description: string; utterance: string; memorableSteps: number | null }[]
}): Promise<void> {
  const prefLines = input.preferences.length
    ? input.preferences.map((p) => `- **${p.statement}**${p.utterance ? ` — from: "${p.utterance}"` : ''} (${p.createdAt.slice(0, 10)})`).join('\n')
    : '_Nothing learned yet._'
  const ruleLines = input.rules.length
    ? input.rules.map((r) => `- **${r.reason}** — \`${r.description}\`${r.memorableSteps ? ` · Memorable procedure (${r.memorableSteps} steps)` : ''} — from: "${r.utterance}"`).join('\n')
    : '_No learned rules yet._'

  const content = `---
type: project
title: Scout housing search
tags: [scout, housing]
---

# Scout housing search

What Scout Autopilot has learned about how this renter searches for apartments in San Francisco. Updated automatically whenever the renter corrects Scout.

## Preferences

${prefLines}

## Learned ranking rules

${ruleLines}
`
  await callTool('put_page', { slug: GBRAIN_PAGE_SLUG, content, allow_empty: true })
}
