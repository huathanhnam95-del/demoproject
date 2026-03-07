# Reading Journey — VN Adult (A2–B1) Large Simulation Plan (2026-03-06)

## One-line goal

Build a VN adult-safe (A2–B1) keyword dataset (≥200) and a branching simulation runner that can generate **≥300 unique outlines** (ideally 1000) and expand story variants.

## Design decisions (locked)

- **Data source**: Seed from Google Trends “Year in Search 2025” Vietnam + curated adult topics.
- **Safety**: Filter politics/explicit content/real-person names.
- **Uniqueness**: “Unique initial story” == unique `outlineId`.
- **Branching**:
  - Default: branch MCQ beats only (`branchMode=mcq`) for affordability.
  - Optional: branch all beats (`branchMode=all`) for completeness.
- **Outputs**: Persist JSON/JSONL artifacts under `docs/audits/reading-journey-vn-sim/YYYY-MM-DD/` (local date).

## Work items

1. Create spec: `docs/specs/reading-journey-vn-large-sim.md`
2. Create dataset: `scripts/data/2025-vn-adult-topics.json` (≥200, with sources)
3. Implement runner: `scripts/simulate-reading-journey-vn-branching.js`
4. Validate with a dry run (2–3 outlines, `branchMode=mcq`)
5. Run large batch:
   - `--count-outlines 300` (default)
   - optional `--count-outlines 1000` if quotas allow

## Commands (local)

- Dry run:
  - `node scripts/simulate-reading-journey-vn-branching.js --count-outlines 3 --branch-mode mcq`
- Full:
  - `node scripts/simulate-reading-journey-vn-branching.js --count-outlines 300 --branch-mode mcq --resume`
- Full branching (expensive):
  - `node scripts/simulate-reading-journey-vn-branching.js --count-outlines 20 --branch-mode all`
