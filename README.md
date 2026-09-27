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

## Layout

```
src/
  agent/        # Scout agent loop + tool definitions
  memory/       # GBrain MCP client (read/write preferences)
  apprentice/   # Memorable integration (corrections → procedures)
  ingest/       # Apify / existing listing ingestion adapters
scripts/        # seed data, demo runners
docs/           # architecture notes, pitch
```

## Setup

```bash
cp .env.example .env   # fill in keys
```

## Timeline (hacking 1:15 PM → 5:00 PM)

- [ ] 1:15–2:00 — Wire Claude agent to existing Apify + Supabase
- [ ] 2:00–2:45 — GBrain preference read/write
- [ ] 2:45–3:45 — Memorable correction loop
- [ ] 3:45–4:30 — Autopilot run + "Why Scout chose this" UI
- [ ] 4:30–5:00 — Demo polish (drop QM if not working by ~2:45)
