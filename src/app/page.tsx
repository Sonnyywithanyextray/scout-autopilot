'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LearnedRule, PreferenceMemory, Preferences, ProviderStatus, Ranked, RunResult, WeightKey } from '@/lib/types'
import { WEIGHT_KEYS } from '@/lib/types'

type Source = 'seed' | 'supabase'
type Learned = { reply: string; engine: string; preferences: PreferenceMemory[]; rules: LearnedRule[] }
type Memory = {
  profile: Preferences
  effective: Preferences
  preferences: PreferenceMemory[]
  rules: (LearnedRule & { description: string })[]
  providers: ProviderStatus[]
}

export default function Home() {
  const [tab, setTab] = useState<'run' | 'learned'>('run')
  const [source, setSource] = useState<Source>('seed')
  const [run, setRun] = useState<RunResult | null>(null)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [running, setRunning] = useState(false)
  const [learned, setLearned] = useState<Learned | null>(null)
  const [teaching, setTeaching] = useState(false)
  const [memory, setMemory] = useState<Memory | null>(null)

  const loadMemory = useCallback(async () => {
    setMemory(await (await fetch('/api/memory')).json())
  }, [])

  useEffect(() => { loadMemory() }, [loadMemory])

  const runScout = useCallback(async () => {
    setRunning(true)
    setVisibleSteps(0)
    try {
      const res: RunResult = await (await fetch('/api/run', { method: 'POST', body: JSON.stringify({ source }) })).json()
      setRun(res)
      for (let i = 1; i <= res.trace.length; i++) {
        await new Promise((r) => setTimeout(r, 220))
        setVisibleSteps(i)
      }
    } finally {
      setRunning(false)
    }
  }, [source])

  const teach = useCallback(async (utterance: string, listingId?: string) => {
    setTeaching(true)
    try {
      const res = await (await fetch('/api/feedback', { method: 'POST', body: JSON.stringify({ utterance, listingId, source }) })).json()
      if (res.error) throw new Error(res.error)
      setLearned(res)
      await loadMemory()
      await runScout()
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
    setLearned(null)
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
          run={run} visibleSteps={visibleSteps} running={running} teaching={teaching} learned={learned}
          source={source} setSource={setSource} onRun={runScout} onTeach={teach}
        />
      ) : (
        <LearnedView memory={memory} onRemove={remove} onReset={reset} />
      )}
    </main>
  )
}

// ── Run view ────────────────────────────────────────────────────────────────

function RunView(props: {
  run: RunResult | null; visibleSteps: number; running: boolean; teaching: boolean; learned: Learned | null
  source: Source; setSource: (s: Source) => void; onRun: () => void; onTeach: (u: string, id?: string) => void
}) {
  const { run, visibleSteps, running, teaching, learned } = props
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

      {learned && <LearnedToast learned={learned} />}

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

function LearnedToast({ learned }: { learned: Learned }) {
  const nothing = !learned.preferences.length && !learned.rules.length
  return (
    <div className="learned">
      <div className="reply">🧠 {learned.reply}</div>
      {!nothing && (
        <div>
          {learned.preferences.map((p) => (
            <span key={p.id} className="chip"><span className="tag">GBrain · preference</span>{p.statement}</span>
          ))}
          {learned.rules.map((r) => (
            <span key={r.id} className="chip"><span className="tag">Memorable · rule</span>{r.reason}</span>
          ))}
        </div>
      )}
      {learned.engine === 'fallback' && <div className="status-note">interpreted with the offline keyword parser</div>}
    </div>
  )
}

function Movers({ run }: { run: RunResult }) {
  return (
    <div className="panel movers">
      <p className="h">What changed because Scout learned</p>
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
            {r.ruleHits.map((h) => <li key={h.ruleId}>Learned rule: {h.label} ({h.delta > 0 ? '+' : ''}{h.delta})</li>)}
            {r.concerns.map((x, i) => <li key={`c${i}`} style={{ color: 'var(--down)' }}>{x}</li>)}
          </ul>
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
          <p className="h">Preferences · stored in GBrain</p>
          {memory.preferences.length === 0 && <div className="meta">Nothing yet — correct Scout and it will remember.</div>}
          {memory.preferences.map((p) => (
            <div key={p.id} className="mem">
              <div>
                <div className="s">{p.statement}</div>
                {p.utterance && <div className="u">from: “{p.utterance}”</div>}
                {p.gbrainFactId && <div className="u" style={{ color: 'var(--brain)' }}>synced to GBrain · fact #{p.gbrainFactId}</div>}
              </div>
              <button className="btn small danger" onClick={() => onRemove('preference', p.id)}>Forget</button>
            </div>
          ))}
        </section>

        <section className="panel">
          <p className="h">Learned rules · stored in Memorable</p>
          {memory.rules.length === 0 && <div className="meta">No learned rules yet.</div>}
          {memory.rules.map((r) => (
            <div key={r.id} className="mem">
              <div>
                <div className="s">{r.reason}</div>
                <div><code>{r.description}</code></div>
                <div className="u">from: “{r.source.utterance}” · applied {r.timesApplied}×</div>
                {r.memorable && (
                  <div className="u" style={{ color: 'var(--brain)' }}>
                    Memorable procedure: {r.memorable.steps.map((s) => s.action).join(' → ')}
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
