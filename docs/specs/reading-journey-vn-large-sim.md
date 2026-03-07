# Reading Journey — Vietnam Adult (A2–B1) Large Simulation (2026-03-06)

## Goal

Create a Vietnam-focused, classroom-safe keyword dataset (≥200 entries) and a large-scale Reading Journey simulation runner that:

- Generates **≥300 unique initial stories** (unique cached outlines / `outlineId`), ideally **1000**.
- Simulates user choices across the interactive flow and produces branched story variants.
- Writes reproducible audit artifacts under `docs/audits/` for later review.

Target audience: **Vietnamese adult learners**, CEFR **A2–B1**.

## Why

Vietnamese adult learners tend to engage more with stories seeded by familiar, practical topics (work, travel, money, health, daily life). A larger simulation run helps:

- Populate caches for common VN topics (reducing model cost later).
- Reveal weak cohesion/coherence patterns across many outlines.
- Provide a repeatable dataset for regression checks when prompts/models change.

## Inputs

### Dataset: VN adult-safe topics (≥200)

File: `scripts/data/2025-vn-adult-topics.json`

Each entry:

```json
{
  "topic": "Đà Lạt",
  "category": "YIS2025VN - Du lịch",
  "language": "vi",
  "sourceUrls": ["https://trends.withgoogle.com/year-in-search/2025/vn/"]
}
```

Dataset composition:

- **Google Trends “Year in Search 2025” Vietnam** categories (curated + filtered).
- **Curated adult-relevant topics** (work, finance, health, travel, family, food, technology, English learning).

Filtering rules (dataset must satisfy):

- No explicit sexual content, illegal drugs, gambling, hate/harassment.
- Avoid politics/current political controversies (Reading Journey prompt forbids politics).
- Avoid real-person names where possible (Reading Journey prompt forbids real celebrities).

### Keyword sets for story setup

The runner forms keyword sets of **2–3 topics** per outline attempt, drawn from the dataset.

## Simulation runner requirements

Script: `scripts/simulate-reading-journey-vn-branching.js`

### Outline generation targets

- Default: **300 unique outlines** (`outlineId`), split across A2 and B1.
- Optional: **1000** unique outlines.

Uniqueness rule:

- Only count a story as “unique initial story” when `outlineId` has not been seen in this run/output root.

### Branching modes

To balance completeness vs cost:

- **`branchMode=mcq` (default)**: fully branch only MCQ beats; open beats are advanced with a deterministic single choice per outline+beat.
- **`branchMode=all`**: branch all beats (including open beats) by forcing each canonical intent via production text for open beats.

Canonical intent IDs (server-enforced): `investigate`, `ask`, `wait`.

### Output artifacts

Default output root:

`docs/audits/reading-journey-vn-sim/YYYY-MM-DD/` (local date)

Artifacts:

- `run-<runId>.json`: run metadata + high-level counters.
- `summary-<runId>.json`: aggregate counts + errors.
- `outlines/<outlineId>/outline.json`: outline metadata, keywords used, topicTags.
- `outlines/<outlineId>/variants.jsonl`: one JSON object per branched story path (title + path + storyText).

### Reliability and controls

Runner must support:

- `--resume` (skip outlines already present in output root).
- `--seed` (reproducible sampling).
- bounded concurrency and retry on 429s.
- `--no-server` / `--start-server` to optionally manage the local server.

## Acceptance criteria

- Dataset file exists and contains **≥200** entries meeting filtering rules.
- Runner dry-run succeeds:
  - generates ≥2 unique outlines
  - produces variants for each outline for the configured branching mode
  - writes artifacts to `docs/audits/reading-journey-vn-sim/YYYY-MM-DD/`
- Runner is capable of collecting **≥300** unique outlines via `--count-outlines 300` (time/cost depends on model quotas).
