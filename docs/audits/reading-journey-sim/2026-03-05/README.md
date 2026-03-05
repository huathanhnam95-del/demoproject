# Reading Journey Simulation Audit (2026-03-05)

Latest run: `2026-03-05T02-44-43-961Z`
Model: `gemini-2.5-flash`
Base URL: `http://localhost:8787`
Stories: `50`

## Results (aggregate)
- Averages (1–5): coherence 4.90, cohesion 4.66, grammar 4.84, vocabulary 4.58
- Flags: tooHard 10, tooEasy 1, unsafe 0
- Ended early: 0
- Segment word-count issues (total): 14

## CEFR fit distribution
- A2: 9
- B1: 15
- B2: 7
- C1: 19

## Sources (2025 topic inputs)
- https://trends.withgoogle.com/year-in-search/2025/
- https://wikimediafoundation.org/news/2025/12/10/googles-year-in-search-2025-mikey-madison-justin-baldoni-the-hunting-wives-land-on-2025-trend-report/

Curated inputs: `scripts/data/2025-topics.json`

## Re-run
- `node scripts/simulate-reading-journey-50.js --count 50`

