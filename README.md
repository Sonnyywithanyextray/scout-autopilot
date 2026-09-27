# Scout Autopilot + Agent Apprentice

> **Scout learns how you search for housing, then takes over the repetitive work.**

Built at the YC AI-native software hackathon — Sept 27, 2026 (560 20th St, SF).
Sponsors: River AI · GBrain · Memorable · QM · Superset · UFO.

## The idea

Scout isn't "AI finds apartments." It's a persistent housing agent that:

1. **Remembers** what you care about (GBrain)
2. **Learns from your corrections** and reuses the corrected procedure (Memorable)
3. **Runs on autopilot** over fresh inventory and returns only strong matches

## Architecture

```
User preference / correction
          ↓
      Scout Agent (Claude)
       ↙          ↘
 Apify/Search     GBrain
 listings         memory
       ↘          ↙
        Ranking
          ↓
  User corrects Scout
          ↓
      Memorable
 learns/reuses procedure
          ↓
 Better next search/action
```

| Layer | Service | Role |
|---|---|---|
| UI | Next.js (existing Scout UI) | Search, results, "Why Scout chose this" |
| Reasoning | Claude | Tool selection, listing evaluation, explanations |
| Inventory | Apify (existing) | Facebook / Roomies / etc. listing ingestion |
| Memory | GBrain (MCP) | Renter preferences: max rent, BART proximity, commute caps |
| Learning | Memorable | Captures corrected trajectories → reusable procedures |
| App state | Supabase (existing) | Listings, users, sessions, scores, outreach |
| Stretch | QM | Long-lived autonomous Scout task environment |

## Demo script

1. **GBrain moment** — "Actually, I care way more about transit than apartment size." → Scout stores it.
2. **Memorable moment** — Scout picks a $2,350 place 18 min from BART. User: "Anything over 10 min walking from rapid transit should rank much lower." → Scout learns the correction.
3. **Autopilot moment** — Hit **Run Scout**:
   ```
   Analyzed 43 listings
   Rejected 31 based on learned preferences
   Removed 6 duplicates
   Flagged 3 questionable listings
   Found 3 strong matches
   ```
   Click a match → *Why Scout chose this*: $2,485 ✓ · 4 min to BART ✓ · 41 min commute ✓ · learned neighborhood ✓ — **96% match**

## Run it

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, SUPABASE_URL + key (read-only use)
npm run dev                  # http://localhost:3002
```

Everything degrades gracefully: no Anthropic key → offline keyword parser; no
Supabase → deterministic demo inventory; no GBrain/Memorable keys → local
memory. Provider status pills in the header show which mode each layer is in.

## The loop

1. **Run Scout** → deterministic ranker scores inventory with the renter's weights + learned rules.
2. **Correct Scout** ("Not for me" on a card, or the Teach box) in plain English.
3. **Claude** converts it into a constrained schema:
   - durable preference / weight change → **GBrain**
   - learned rule `{ field, operator, value, effect, magnitude, reason, source }` → **Memorable**
4. **Re-run** → "What changed because Scout learned" shows each score delta and the rule/weight that caused it.
5. **What Scout has learned** tab → every preference and rule is visible and removable.

Claude never ranks listings directly; it only edits the weights and rules the ranker consumes.

## Scripted demo (seed inventory)

Start from **Reset demo** (What Scout has learned tab), then:

| # | Action | What judges see |
|---|---|---|
| 1 | **Run Scout** | Agent trace; #1 is the Bernal 1BR at 86% (big, cheap, 18 min walk to BART) |
| 2 | Type in Teach: *"I'll pay $150 more if it saves me at least 20 minutes of commute."* | Live steps: Claude → GBrain → Memorable → re-rank. Learns tradeoff `$7.50/min, up to $150` |
| 3 | (auto re-run) | Banner: **Rincon Hill 69 → 79, newly surfaced at #3**; Potrero **#3 → #7**, overtaken. Card shows "Tradeoff: 33 min shorter commute worth $150 (+10)" |
| 4 | "Not for me" on Bernal → *"Too far from BART. Anything over 10 minutes walking should rank much lower."* | Bernal **86 → ~52**, drops out; a BART-close studio becomes #1 |
| 5 | Click Bernal under **Just missed** | "If the walk were 10 min instead of 18, it would become a match at #1 (52 → 89). Your learned rule costs it 25 pts" — computed by re-scoring |
| 6 | Open GBrain ↗ / Memorable ↗ from the learning steps | "Scout housing search" page in GBrain; captured procedure in Memorable |
| 7 | What Scout has learned → Remove a rule → Run | Rankings revert; user stays in control |

`node scripts/demo-shots.mjs "<utterance>" [card|box] [prefix]` replays a flow in headless Chrome and saves screenshots to `.shots/`.
`npx tsx scripts/simulate.ts` prints the before/after rankings without the UI.

## Layout

```
src/lib/
  ranker.ts          # deterministic ranker (ported from Scout v1) + learned-rule engine
  run.ts             # one autopilot run: load → recall → apply → dedupe/reject/flag → deltas
  transit.ts         # estimated walk-to-BART/Muni + commute by neighborhood
  agent/interpret.ts # Claude: NL correction → structured prefs + rules (+ offline fallback)
  memory/            # PreferenceStore (GBrain) / RuleStore (Memorable) over local JSON
  data/seed.ts       # deterministic demo inventory tuned for the correction flip
  data/supabase.ts   # read-only view of Scout's listings table
src/app/             # Next.js UI + /api/{run,feedback,memory,reset}
```

Hackathon state lives in `.data/state.json` — never in Scout's production tables.

## Timeline (hacking 1:15 PM → 5:00 PM)

- [x] Correction loop end-to-end (ranker, rules, deltas, trace, learned view)
- [ ] Top up Anthropic credits so Claude (not the fallback parser) interprets corrections
- [ ] 1:15–2:00 — Wire Claude agent to existing Apify + Supabase
- [ ] 2:00–2:45 — GBrain preference read/write
- [ ] 2:45–3:45 — Memorable correction loop
- [ ] 3:45–4:30 — Autopilot run + "Why Scout chose this" UI
- [ ] 4:30–5:00 — Demo polish (drop QM if not working by ~2:45)
