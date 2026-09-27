'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LearnedRule, PreferenceMemory, Preferences, ProviderStatus, Ranked, RunResult, WeightKey } from '@/lib/types'
import { WEIGHT_KEYS } from '@/lib/types'

type Source = 'seed' | 'supabase'
type Learned = { reply: string; engine: string; preferences: PreferenceMemory[]; rules: LearnedRule[] }
type StepId = 'interpret' | 'gbrain' | 'memorable' | 'rerank'
type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error'
type LearnStep = { id: StepId; status: StepStatus; detail?: string; startedAt?: number; ms?: number }
type Learning = { utterance: string; listingId: string | null; steps: LearnStep[]; result: Learned | null; error: string | null }

const STEP_LABEL: Record<StepId, { active: string; done: string }> = {
  interpret: { active: 'Claude is interpreting your feedback', done: 'Claude interpreted your feedback' },
  gbrain: { active: 'Saving preferences to GBrain', done: 'Saved to GBrain' },
  memorable: { active: 'Capturing the procedure in Memorable', done: 'Procedure captured in Memorable' },
  rerank: { active: 'Re-ranking listings with what Scout learned', done: 'Re-ranked listings' },
}
type Memory = {
  profile: Preferences
  effective: Preferences
  preferences: PreferenceMemory[]
  rules: (LearnedRule & { description: string })[]
  providers: ProviderStatus[]
  links: { gbrain: string; memorable: string }
}

export default function Home() {
  const [tab, setTab] = useState<'run' | 'learned'>('run')
  const [source, setSource] = useState<Source>('seed')
  const [run, setRun] = useState<RunResult | null>(null)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [running, setRunning] = useState(false)
  const [learning, setLearning] = useState<Learning | null>(null)
  const [teaching, setTeaching] = useState(false)
  const [memory, setMemory] = useState<Memory | null>(null)

  const loadMemory = useCallback(async () => {
    setMemory(await (await fetch('/api/memory')).json())
  }, [])

  useEffect(() => { loadMemory() }, [loadMemory])

  const runScout = useCallback(async (): Promise<RunResult> => {
    setRunning(true)
    setVisibleSteps(0)
    try {
      const res: RunResult = await (await fetch('/api/run', { method: 'POST', body: JSON.stringify({ source }) })).json()
      setRun(res)
      for (let i = 1; i <= res.trace.length; i++) {
        await new Promise((r) => setTimeout(r, 220))
        setVisibleSteps(i)
      }
      return res
    } finally {
      setRunning(false)
    }
  }, [source])

  const teach = useCallback(async (utterance: string, listingId?: string) => {
    setTeaching(true)
    const update = (id: StepId, status: StepStatus, detail?: string) =>
      setLearning((l) => l && {
        ...l,
        steps: l.steps.map((st) => {
          if (st.id !== id) return st
          const now = Date.now()
          if (status === 'active') return { ...st, status, detail, startedAt: now }
          return { ...st, status, detail, ms: st.startedAt ? now - st.startedAt : undefined }
        }),
      })

    setLearning({
      utterance,
      listingId: listingId ?? null,
      result: null,
      error: null,
      steps: (['interpret', 'gbrain', 'memorable', 'rerank'] as StepId[]).map((id) => ({ id, status: 'pending' })),
    })

    try {
      const res = await fetch('/api/feedback', { method: 'POST', body: JSON.stringify({ utterance, listingId, source }) })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }

      // Read the NDJSON progress stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let result: Learned | null = null
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line)
          if (ev.type === 'step') update(ev.id, ev.status, ev.detail)
          else if (ev.type === 'result') {
            result = ev
            setLearning((l) => l && { ...l, result: ev })
          } else if (ev.type === 'error') throw new Error(ev.message)
        }
      }
      if (!result) throw new Error('Learning ended without a result')

      await loadMemory()
      update('rerank', 'active')
      const next = await runScout()
      update('rerank', 'done', summarizeMovers(next))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Learning failed'
      setLearning((l) => l && {
        ...l,
        error: message,
        steps: l.steps.map((st) => (st.status === 'active' ? { ...st, status: 'error' } : st)),
      })
    } finally {
      setTeaching(false)
    }
  }, [source, loadMemory, runScout])

  const remove = async (kind: 'preference' | 'rule', id: string) => {
    await fetch(`/api/memory?kind=${kind}&id=${id}`, { method: 'DELETE' })
    await loadMemory()
  }

  const reset = async () => {
    await fetch('/api/reset', { method: 'POST' })
    setRun(null)
    setLearning(null)
    await loadMemory()
  }

  const providers = run?.providers ?? memory?.providers ?? []

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Scout Autopilot</h1>
          <span>learns how you search, then does the searching</span>
        </div>
        <div className="tabs">
          <button className={tab === 'run' ? 'on' : ''} onClick={() => setTab('run')}>Run Scout</button>
          <button className={tab === 'learned' ? 'on' : ''} onClick={() => { setTab('learned'); loadMemory() }}>
            What Scout has learned{memory ? ` (${memory.preferences.length + memory.rules.length})` : ''}
          </button>
        </div>
      </header>

      <div className="pills" style={{ marginBottom: 16 }}>
        {providers.map((p) => (
          <span key={p.role} className={`pill ${p.mode === 'live' ? 'live' : ''}`}>
            {p.role}: <b>{p.name}</b>{p.mode === 'fallback' && p.note ? ` · ${p.note}` : ''}
          </span>
        ))}
      </div>

      {tab === 'run' ? (
        <RunView
          run={run} visibleSteps={visibleSteps} running={running} teaching={teaching} learning={learning}
          source={source} setSource={setSource} onRun={runScout} onTeach={teach} links={memory?.links ?? null}
        />
      ) : (
        <LearnedView memory={memory} onRemove={remove} onReset={reset} />
      )}
    </main>
  )
}

// ── Run view ────────────────────────────────────────────────────────────────

function RunView(props: {
  run: RunResult | null; visibleSteps: number; running: boolean; teaching: boolean; learning: Learning | null
  source: Source; setSource: (s: Source) => void; onRun: () => void; onTeach: (u: string, id?: string) => void
  links: Memory['links'] | null
}) {
  const { run, visibleSteps, running, teaching, learning } = props
  const [draft, setDraft] = useState('')
  const busy = running || teaching
  const traceDone = run && visibleSteps >= run.trace.length

  return (
    <>
      <section className="panel">
        <div className="row">
          <button className="btn primary" onClick={props.onRun} disabled={busy}>
            {running ? 'Scout is working…' : 'Run Scout'}
          </button>
          <div className="seg">
            <button className={props.source === 'seed' ? 'on' : ''} onClick={() => props.setSource('seed')}>Demo inventory</button>
            <button className={props.source === 'supabase' ? 'on' : ''} onClick={() => props.setSource('supabase')}>Live Scout listings</button>
          </div>
          <form
            className="row grow"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { props.onTeach(draft.trim()); setDraft('') } }}
          >
            <input
              className="field grow" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy}
              placeholder='Tell Scout… e.g. "I care way more about transit than apartment size"'
            />
            <button className="btn" disabled={busy || !draft.trim()}>{teaching ? 'Learning…' : 'Teach'}</button>
          </form>
        </div>
      </section>

      {run && traceDone && learning?.result && run.movers.length > 0 && (
        <DeltaHero key={run.runId} run={run} rejectedId={learning.listingId} newRules={learning.result.rules} />
      )}
      {learning && <LearningPanel learning={learning} links={props.links} />}

      {!run ? (
        <div className="empty" style={{ marginTop: 16 }}>Hit <b>Run Scout</b> to have Scout work through today&apos;s listings.</div>
      ) : (
        <div className="grid">
          <aside className="panel">
            <p className="h">Agent trace</p>
            <ol className="trace">
              {run.trace.slice(0, visibleSteps).map((s, i) => (
                <li key={`${run.runId}-${i}`}>
                  <span className="dot">{i + 1}</span>
                  <span>{s.label}{s.detail && <small>{s.detail}</small>}</span>
                </li>
              ))}
            </ol>
          </aside>

          <section>
            {traceDone && run.movers.length > 0 && <Movers run={run} />}

            {traceDone && (
              <>
                <p className="h" style={{ marginTop: run.movers.length ? 20 : 0 }}>Top matches</p>
                <div className="cards">
                  {run.matches.map((r, i) => (
                    <ListingCard key={r.listing.id} r={r} rank={i + 1} busy={busy} onTeach={props.onTeach} />
                  ))}
                  {run.matches.length === 0 && <div className="empty">No listings cleared your bar this run.</div>}
                </div>
                {run.nearMisses.length > 0 && (
                  <>
                    <p className="h" style={{ marginTop: 20 }}>Just missed — click to see what would change Scout&apos;s mind</p>
                    <div className="panel near">
                      {run.nearMisses.map((r) => <NearMissRow key={r.listing.id} r={r} />)}
                    </div>
                  </>
                )}
                {run.flagged.length > 0 && (
                  <>
                    <p className="h" style={{ marginTop: 20 }}>Flagged as questionable</p>
                    <div className="panel">
                      {run.flagged.map((r) => (
                        <div key={r.listing.id} className="row" style={{ padding: '4px 0' }}>
                          <span className="flag">flagged</span>
                          <span className="grow">{r.listing.title}</span>
                          <span className="meta">{r.listing.price ? `$${r.listing.price.toLocaleString()}` : ''} · {r.listing.source}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function summarizeMovers(run: RunResult): string {
  if (!run.movers.length) return 'no ranking changes'
  const fell = run.movers.filter((m) => m.after < m.before).sort((a, b) => (a.after - a.before) - (b.after - b.before))[0]
  const rose = run.movers.filter((m) => m.after > m.before).sort((a, b) => (b.after - b.before) - (a.after - a.before))[0]
  const short = (t: string) => (t.length > 28 ? `${t.slice(0, 26)}…` : t)
  return [fell && `${short(fell.title)} ${fell.before} → ${fell.after}`, rose && `${short(rose.title)} ${rose.before} → ${rose.after}`]
    .filter(Boolean)
    .join(' · ')
}

function LearningPanel({ learning, links }: { learning: Learning; links: Memory['links'] | null }) {
  const { result, steps, error } = learning
  const nothing = result && !result.preferences.length && !result.rules.length
  return (
    <div className="learned">
      <div className="said">You told Scout: “{learning.utterance}”</div>
      <ol className="steps">
        {steps.map((st) => {
          const label = STEP_LABEL[st.id]
          const text = st.status === 'done' ? label.done : label.active
          return (
            <li key={st.id} className={`step ${st.status}`}>
              <span className="icon">
                {st.status === 'active' ? <span className="spin" /> : st.status === 'done' ? '✓' : st.status === 'skipped' ? '–' : st.status === 'error' ? '!' : ''}
              </span>
              <span className="grow">
                {text}{st.status === 'active' ? '…' : ''}
                {st.detail && <small>{st.detail}</small>}
              </span>
              {st.status === 'done' && links && st.id === 'gbrain' && <ExtLink href={links.gbrain}>GBrain</ExtLink>}
              {st.status === 'done' && links && st.id === 'memorable' && <ExtLink href={links.memorable}>Memorable</ExtLink>}
              {st.ms !== undefined && st.status !== 'pending' && <span className="ms">{(st.ms / 1000).toFixed(1)}s</span>}
            </li>
          )
        })}
      </ol>

      {result && (
        <div className="outcome">
          <div className="reply">🧠 {result.reply}</div>
          {!nothing && (
            <div>
              {result.preferences.map((p) => (
                <span key={p.id} className="chip"><span className="tag">GBrain · preference</span>{p.statement}</span>
              ))}
              {result.rules.map((r) => (
                <span key={r.id} className="chip"><span className="tag">Memorable · {r.kind === 'tradeoff' ? 'tradeoff' : 'rule'}</span>{r.reason}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <div className="status-note" style={{ color: 'var(--down)' }}>Something went wrong: {error}</div>}
    </div>
  )
}

// ── Counterfactuals ─────────────────────────────────────────────────────────

function CounterfactualBox({ cf }: { cf: NonNullable<Ranked['counterfactual']> }) {
  return (
    <div className="cf">
      <div className="cf-h">What would change Scout&apos;s mind</div>
      <div className="cf-s">{cf.sentence}</div>
      {cf.responsible && <div className="cf-r">{cf.responsible}</div>}
      <div className="cf-note">Computed by re-scoring this listing with one feature changed — not a guess.</div>
    </div>
  )
}

function NearMissRow({ r }: { r: Ranked }) {
  const [open, setOpen] = useState(false)
  const l = r.listing
  const status = r.status === 'match' ? `#${r.rank}` : 'not a match'
  return (
    <div className={`nm ${open ? 'open' : ''}`}>
      <button className="nm-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="nm-score">{r.score}%</span>
        <span className="nm-title">{l.title}</span>
        <span className="nm-meta">
          {l.price ? `$${l.price.toLocaleString()}` : ''}{l.transit ? ` · ${l.transit.walkMinutes} min walk · ${l.transit.commuteMinutes} min commute` : ''}
        </span>
        <span className={`nm-status ${r.status === 'match' ? '' : 'out'}`}>{status}</span>
        <span className="nm-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="nm-body">
          {r.ruleHits.length > 0 && (
            <div className="nm-hits">
              {r.ruleHits.map((h) => (
                <span key={h.ruleId} className={`cause ${h.delta < 0 ? 'neg' : 'pos'}`}>{h.label} {h.delta > 0 ? '+' : ''}{h.delta}</span>
              ))}
            </div>
          )}
          {r.counterfactual ? <CounterfactualBox cf={r.counterfactual} /> : <div className="meta">No single change moves this one meaningfully.</div>}
        </div>
      )}
    </div>
  )
}

// ── Before/after centerpiece ────────────────────────────────────────────────

function useCountTo(from: number, to: number, ms = 1100) {
  const [value, setValue] = useState(from)
  useEffect(() => {
    let raf = 0
    let t0 = 0
    const tick = (now: number) => {
      if (!t0) t0 = now
      const p = Math.min(1, (now - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    // Brief hold on the "before" number so the change is visible
    const hold = setTimeout(() => { raf = requestAnimationFrame(tick) }, 450)
    return () => { clearTimeout(hold); cancelAnimationFrame(raf) }
  }, [from, to, ms])
  return value
}

function DeltaHero({ run, rejectedId, newRules }: { run: RunResult; rejectedId: string | null; newRules: LearnedRule[] }) {
  const worse = (m: RunResult['movers'][number]) => m.after < m.before || (m.rankAfter ?? 99) > (m.rankBefore ?? 99)
  const better = (m: RunResult['movers'][number]) => m.after > m.before && (m.rankAfter ?? 99) <= (m.rankBefore ?? 99)
  const rankGain = (m: RunResult['movers'][number]) => (m.rankBefore ?? 99) - (m.rankAfter ?? 99)
  const newTopId = run.matches[0]?.listing.id
  const topIds = new Set(run.matches.map((r) => r.listing.id))

  const drops = run.movers.filter(worse)
  const dropped =
    drops.find((m) => m.listingId === rejectedId) ??
    [...drops].sort((a, b) => (a.after - a.before) - (b.after - b.before) || rankGain(a) - rankGain(b))[0]
  const rises = run.movers.filter(better)
  const rose =
    rises.find((m) => m.listingId === newTopId && m.rankBefore !== 1) ??
    rises.find((m) => topIds.has(m.listingId) && (m.rankBefore === null || m.rankBefore > run.matches.length)) ??
    [...rises].sort((a, b) => rankGain(b) - rankGain(a) || (b.after - b.before) - (a.after - a.before))[0]
  if (!dropped && !rose) return null

  // For a listing that fell only in rank: who passed it?
  const overtakers = dropped
    ? run.movers.filter((m) =>
        m.listingId !== dropped.listingId &&
        (m.rankBefore ?? 99) > (dropped.rankBefore ?? 99) &&
        (m.rankAfter ?? 99) < (dropped.rankAfter ?? 99))
    : []

  const because = newRules.map((r) => r.reason)
  const fallbackCause = (dropped ?? rose)!.causes[0]?.label
  return (
    <section className="hero-delta">
      <div className="hero-head">
        <span className="hero-kicker">Scout learned — and changed its mind</span>
        {(because.length > 0 || fallbackCause) && (
          <span className="hero-because">Because: {because.length ? because.join(' · ') : fallbackCause}</span>
        )}
      </div>
      <div className="hero-tiles">
        {dropped && <DeltaTile m={dropped} kind="down" overtakenBy={overtakers.map((m) => m.title)} note={
          dropped.statusAfter !== 'match' ? 'dropped out of your matches'
            : topIds.has(dropped.listingId) ? 'ranked lower' : 'pushed out of your top 3'} />}
        {rose && <DeltaTile m={rose} kind="up" note={
          rose.listingId === newTopId ? 'now your #1 match'
            : rose.statusBefore !== 'match' ? 'newly surfaced as a match'
            : topIds.has(rose.listingId) ? 'moved into your top 3' : 'ranked higher'} />}
      </div>
    </section>
  )
}

function DeltaTile({ m, kind, note, overtakenBy = [] }: { m: RunResult['movers'][number]; kind: 'up' | 'down'; note: string; overtakenBy?: string[] }) {
  // Show the score when it moved the same way as the story; otherwise the rank is the story
  const scoreAgrees = kind === 'down' ? m.after < m.before : m.after > m.before
  const rankStory = !scoreAgrees && m.rankBefore !== m.rankAfter
  const value = useCountTo(m.before, m.after)
  const delta = Math.abs(m.after - m.before)
  const rank = (r: number | null) => (r === null ? '—' : `#${r}`)
  const top = m.causes.slice(0, 2)
  return (
    <div className={`tile ${kind}`}>
      <div className="tile-title" title={m.title}>{m.title}</div>
      {rankStory ? (
        <div className="tile-score">
          <span className="from">{rank(m.rankBefore)}</span>
          <span className="arrow">→</span>
          <span className="to">{rank(m.rankAfter)}</span>
          <span className="badge">{m.before}→{m.after} pts</span>
        </div>
      ) : (
        <div className="tile-score">
          <span className="from">{m.before}</span>
          <span className="arrow">→</span>
          <span className="to">{value}</span>
          <span className="badge">{kind === 'down' ? '▼' : '▲'}{delta}</span>
        </div>
      )}
      <div className="tile-note">
        {note}
        {!rankStory && m.rankBefore !== m.rankAfter && <span className="tile-rank"> · {rank(m.rankBefore)} → {rank(m.rankAfter)}</span>}
      </div>
      {rankStory && overtakenBy.length > 0 ? (
        <div className="tile-causes">
          <span className="cause neg">
            Overtaken by {overtakenBy.slice(0, 2).join(' and ')}{overtakenBy.length > 2 ? ` +${overtakenBy.length - 2} more` : ''}
          </span>
        </div>
      ) : top.length > 0 && (
        <div className="tile-causes">
          {top.map((c, i) => (
            <span key={i} className={`cause ${c.delta < 0 ? 'neg' : 'pos'}`}>{c.label} {c.delta > 0 ? '+' : ''}{c.delta}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function Movers({ run }: { run: RunResult }) {
  return (
    <div className="panel movers">
      <p className="h">All ranking changes</p>
      {run.movers.map((m) => {
        const up = m.after > m.before
        const fell = m.statusBefore === 'match' && m.statusAfter !== 'match'
        const rose = m.statusBefore !== 'match' && m.statusAfter === 'match'
        return (
          <div key={m.listingId} className="mover">
            <div>
              <div className="title">{m.title}</div>
              {fell && <div className="status-note">dropped out of your matches</div>}
              {rose && <div className="status-note">newly surfaced as a match</div>}
            </div>
            <div className={`delta ${up ? 'up' : 'down'}`}>
              <span className="from">{m.before}</span> → {m.after} {up ? '▲' : '▼'}{Math.abs(m.after - m.before)}
            </div>
            <div className="causes">
              {m.causes.map((c, i) => (
                <span key={i} className={`cause ${c.delta < 0 ? 'neg' : 'pos'}`}>
                  {c.label} {c.delta > 0 ? '+' : ''}{c.delta}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListingCard({ r, rank, busy, onTeach }: { r: Ranked; rank: number; busy: boolean; onTeach: (u: string, id?: string) => void }) {
  const [open, setOpen] = useState(rank === 1)
  const [rejecting, setRejecting] = useState(false)
  const [why, setWhy] = useState('')
  const l = r.listing

  return (
    <article className="card">
      <div className="card-top">
        <div className="score"><div><b>{r.score}%</b><small>match</small></div></div>
        <div className="grow">
          <h3>{l.title}</h3>
          <div className="meta">
            {l.price ? `$${l.price.toLocaleString()}/mo` : 'Price n/a'} · {l.neighborhood ?? 'Unknown area'} · {l.source}
            {l.sqft ? ` · ${l.sqft} sq ft` : ''}
          </div>
        </div>
      </div>

      <ul className="checks">
        {r.checks.map((c, i) => (
          <li key={i}>
            <span className={c.ok ? 'ok' : 'no'}>{c.ok ? '✓' : '✗'}</span> {c.label}
            {c.estimated && <span className="est">est.</span>}
          </li>
        ))}
      </ul>

      {open && (
        <div className="why">
          <b>Why Scout chose this</b>
          <ul>
            {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
            {r.ruleHits.map((h) => (
              <li key={h.ruleId} className={h.effect === 'tradeoff' ? 'tradeoff-line' : undefined}>
                {h.effect === 'tradeoff' ? h.label : `Learned rule: ${h.label}`} ({h.delta > 0 ? '+' : ''}{h.delta})
              </li>
            ))}
            {r.concerns.map((x, i) => <li key={`c${i}`} style={{ color: 'var(--down)' }}>{x}</li>)}
          </ul>
          {r.counterfactual && <CounterfactualBox cf={r.counterfactual} />}
        </div>
      )}

      <div className="actions">
        <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide reasoning' : 'Why Scout chose this'}</button>
        <span className="grow" />
        {!rejecting ? (
          <button className="btn small danger" onClick={() => setRejecting(true)} disabled={busy}>Not for me</button>
        ) : (
          <form
            className="row grow"
            onSubmit={(e) => { e.preventDefault(); if (why.trim()) { onTeach(why.trim(), l.id); setRejecting(false); setWhy('') } }}
          >
            <input
              autoFocus className="field grow" value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="What's wrong with it? Scout will learn from this."
            />
            <button className="btn small" disabled={busy || !why.trim()}>Teach Scout</button>
            <button type="button" className="btn small" onClick={() => setRejecting(false)}>Cancel</button>
          </form>
        )}
      </div>
    </article>
  )
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="extlink" href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  )
}

// ── Learned view ────────────────────────────────────────────────────────────

const WEIGHT_LABEL: Record<WeightKey, string> = {
  budget: 'Budget', neighborhood: 'Neighborhood', transit: 'Transit', space: 'Space', moveIn: 'Move-in', legitimacy: 'Legitimacy',
}

function LearnedView({ memory, onRemove, onReset }: { memory: Memory | null; onRemove: (k: 'preference' | 'rule', id: string) => void; onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false)
  if (!memory) return <div className="empty">Loading…</div>
  const maxW = Math.max(...WEIGHT_KEYS.map((k) => memory.effective.weights[k]), 1)

  return (
    <>
      <div className="mem-grid">
        <section className="panel">
          <div className="h-row">
            <p className="h">Preferences · stored in GBrain</p>
            <ExtLink href={memory.links.gbrain}>Open in GBrain</ExtLink>
          </div>
          {memory.preferences.length === 0 && <div className="meta">Nothing yet — correct Scout and it will remember.</div>}
          {memory.preferences.map((p) => (
            <div key={p.id} className="mem">
              <div>
                <div className="s">{p.statement}</div>
                {p.utterance && <div className="u">from: “{p.utterance}”</div>}
                {p.gbrainFactId && (
                  <div className="u" style={{ color: 'var(--brain)' }}>
                    synced to GBrain · fact #{p.gbrainFactId} · see “Scout housing search” under Projects ·{' '}
                    <a href={memory.links.gbrain} target="_blank" rel="noreferrer">view ↗</a>
                  </div>
                )}
              </div>
              <button className="btn small danger" onClick={() => onRemove('preference', p.id)}>Forget</button>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="h-row">
            <p className="h">Learned rules · stored in Memorable</p>
            <ExtLink href={memory.links.memorable}>Open Memorable</ExtLink>
          </div>
          {memory.rules.length === 0 && <div className="meta">No learned rules yet.</div>}
          {memory.rules.map((r) => (
            <div key={r.id} className="mem">
              <div>
                <div className="s">{r.kind === 'tradeoff' && <span className="kind-tag">tradeoff</span>}{r.reason}</div>
                <div><code>{r.description}</code></div>
                <div className="u">from: “{r.source.utterance}” · applied {r.timesApplied}×</div>
                {r.memorable && (
                  <div className="u" style={{ color: 'var(--brain)' }}>
                    Memorable procedure: {r.memorable.steps.map((s) => s.action).join(' → ')} ·{' '}
                    <a href={memory.links.memorable} target="_blank" rel="noreferrer">view ↗</a>
                  </div>
                )}
              </div>
              <button className="btn small danger" onClick={() => onRemove('rule', r.id)}>Remove</button>
            </div>
          ))}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <p className="h">How Scout weighs listings for you</p>
        <div className="bars">
          {WEIGHT_KEYS.map((k) => {
            const w = memory.effective.weights[k]
            const changed = w !== memory.profile.weights[k]
            return (
              <div key={k} className="bar">
                <span>{WEIGHT_LABEL[k]}</span>
                <div className="track"><div className={`fill ${changed ? 'changed' : ''}`} style={{ width: `${(w / maxW) * 100}%` }} /></div>
                <span className="meta">{w}{changed ? '*' : ''}</span>
              </div>
            )
          })}
        </div>
        <p className="meta" style={{ marginBottom: 0 }}>
          Budget ${memory.effective.budgetMax.toLocaleString()} (+${memory.effective.budgetFlex} flex) ·
          {' '}{memory.effective.neighborhoods.join(', ')}
          {memory.effective.maxCommuteMinutes ? ` · commute ≤ ${memory.effective.maxCommuteMinutes} min` : ''}
          {' '}· <span style={{ color: 'var(--brain)' }}>* learned from your corrections</span>
        </p>
      </section>

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        {confirmReset ? (
          <>
            <span className="meta">Forget everything Scout learned?</span>
            <button className="btn small danger" onClick={() => { onReset(); setConfirmReset(false) }}>Yes, reset</button>
            <button className="btn small" onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn small" onClick={() => setConfirmReset(true)}>Reset demo</button>
        )}
      </div>
    </>
  )
}
