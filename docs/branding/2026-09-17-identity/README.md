# BEL — Identity exploration and rationale

**Prepared:** 17 September 2026 · **For:** Nam · **Brand:** Better English Learning (BEL)
**Status:** Concept work. Nothing here is approved, trademark-cleared, or user-tested.

This document is the written rationale. The visual boards live in the companion design canvas; the editable artwork lives in [`svg/`](svg/). Nothing important is trapped inside an image.

---

## 0. What you are getting, and what you are not

**Delivered**

- A four-pillar (Bát Tự) chart derived by calculation, with the method and its verification stated — §1.
- Four genuinely different identity directions, each with an editable SVG mark, a lockup, a compact version, a one-colour fallback and an app tile — §3.
- Per-direction palettes with **measured** contrast ratios, not asserted ones — §3, §4.
- Typography proposals chosen for Vietnamese coverage — §5.
- A comparison and a single reasoned recommendation — §6.
- Honest weaknesses for every direction — in each direction's own section and again in §6.

**Not delivered, and not claimed**

- No trademark or design search of any kind. Several of these forms are simple geometry; simple geometry collides often. Clearance is required before any of this is used commercially.
- No user testing, no live-app usability test, no full accessibility audit. Contrast ratios in §4 are computed against the WCAG 2.x formula for the listed pairs only. That is one criterion, not an audit.
- No claim that any colour will produce luck, income, or learning outcomes.
- No verification that every feature named in the repository documentation is live. Marketing copy proposed here must be checked against the feature actually shipped.

---

## 1. The birth information, calculated rather than asserted

### 1.1 What I computed and how

**Inputs (as supplied):** 20 July 1995, 09:30 local clock time, Ho Chi Minh City, Viet Nam.

**Conventions used — stated up front, because they change the answer:**

| Decision | What I used | Why it is safe here |
|---|---|---|
| Calendar | The supplied date treated as Gregorian | As the brief instructs |
| Time zone | UTC+7 (Indochina Time) | Viet Nam has been on UTC+7 continuously since 1975; July 1995 carries no historical zone ambiguity |
| Year boundary | Lập Xuân (early February), not 1 January | 20 July is months clear of the boundary, so no edge case |
| Month boundary | Solar terms (tiết khí), not lunar month number | 20 July falls between Tiểu Thử (~7 July) and Lập Thu (~8 August) → the Mùi month |
| Day pillar | Derived from the Julian Day Number | Verified against a known anchor: 1 January 2000 = Mậu Ngọ. The formula reproduces it exactly |
| Hour pillar | Two-hour branch from local time | 09:30 falls in the Tỵ hour (09:00–11:00) |

**True solar time check.** Ho Chi Minh City sits at roughly 106.7°E while the UTC+7 zone meridian is 105°E, worth about **+6.8 minutes**. The equation of time on 20 July is about **−6.0 minutes**. The two nearly cancel: apparent solar time is about **09:31**. That is the middle of the Tỵ hour, not near either edge — so the hour pillar survives both the correction and the fact that no exact hospital or coordinates were supplied. This is the one place the missing precision could have mattered, and it does not.

### 1.2 The chart

| | Hour | Day | Month | Year |
|---|---|---|---|---|
| **Heavenly stem** | Ất (Yin Wood) | **Nhâm (Yang Water)** | Quý (Yin Water) | Ất (Yin Wood) |
| **Earthly branch** | Tỵ (Fire) | Tý (Water) | Mùi (Earth) | Hợi (Water) |

**Day Master: Nhâm — Yang Water.**

Hidden stems: Hợi holds Nhâm and Giáp · Mùi holds Kỷ, Đinh and Ất · Tý holds Quý · Tỵ holds Bính, Canh and Mậu.

Notable interactions: **Tỵ–Hợi clash** (xung), **Tý–Mùi harm** (hại), and Hợi + Mùi form two thirds of the Hợi–Mão–Mùi Wood frame.

**This supersedes the earlier reasoning.** Previous responses in your project reached green and orange from the *birth year alone* — "Ất Hợi / Sơn Đầu Hỏa", therefore Fire, therefore warm colours. That is one pillar out of four, and the nạp âm (Sơn Đầu Hỏa) is a separate labelling layer from the element balance of the chart. The birth year is correctly Ất Hợi. Everything built on top of it was over-extended.

### 1.3 What the chart says — and where practitioners genuinely disagree

Element presence:

- **Water** — very strong. The Day Master itself, plus Quý in the month stem, plus Tý (Water's strongest seat) and Hợi.
- **Wood** — strong. Two Ất stems, plus hidden Giáp and Ất, plus the partial Wood frame.
- **Earth** — present but single (Mùi, plus hidden Mậu and Kỷ).
- **Fire** — present but thin (Tỵ, plus hidden Đinh), and Tỵ is under clash from Hợi.
- **Metal** — **effectively absent.** It appears only as Canh hidden inside Tỵ. This is the chart's gap.

Now the honest part. **Is the Day Master strong or weak? The schools do not agree, and this chart is close to the line.**

- Born in the **Mùi month** — the hottest, most Earth-dominant period. The season does not support Water, and Earth controls Water. That argues **weak**.
- But **Tý sits in the day branch**, which is the single strongest seat Water can occupy, with **Hợi** in the year pillar behind it. That argues **rooted, near balanced**.

Two defensible readings follow:

| Reading | Basis | Favourable elements | Consequence for colour |
|---|---|---|---|
| **A — rooted / near balanced** | Tý + Hợi are real roots; the chart flows Water → Wood → Fire | Wood, then Fire | Greens lead; warm tones acceptable |
| **B — weak in season** | Month rules; Earth controls, Wood drains, Fire drains | Metal, then Water | Cool pale/metallic and deep blue-black lead |

There is also a **classical text prescription**, which I am reporting as a citation rather than as my own derivation: for a Nhâm Day Master born in the Mùi month, the *Cùng Thông Bảo Giám* (窮通寶鑑) tradition prescribes **Tân (Yin Metal)** and **Giáp (Yang Wood)** — Metal to generate the Water, Wood to loosen the Earth. Note that this names **the element the chart is missing (Metal)** and **the element the chart already has in quantity (Wood)**.

### 1.4 What survives all three readings

This is the only part I am willing to carry into the palette:

1. **Wood is favourable, or at worst neutral, in every reading.** → **Green is defensible.**
2. **Metal is what the classical prescription names and what the chart lacks.** → **A cool white / pale grey / soft silver family is defensible**, and it is not merely decorative.
3. **Water is the Day Master itself.** → **A deep ink with a blue-green cast is defensible** as the grounding neutral.
4. **Fire is Wealth in this chart, not support.** → Warm orange is **not** "good for your Fire element." It is a legitimate small accent. It is not a personal prescription, and the earlier claim that it was should not be repeated.

Five-element colour mapping used above, so you can check my work: Wood → greens · Metal → white, silver, cool pale grey · Water → deep blue-black, charcoal, deep teal · Fire → red, orange, purple · Earth → yellow, brown, beige.

### 1.5 The boundary between tradition and design

| This came from the chart | This is my design judgement, nothing more |
|---|---|
| Green as the identity family (Wood) | The exact hex values |
| A cool pale/metallic surface family (Metal) | The ratio of green to neutral on screen |
| A deep water-toned ink (Water) | Which element is the button colour |
| Orange demoted from "favourable" to "small accent" | That the accent should be small at all — that is interface hierarchy, not feng shui |
| — | Every logo form, every typeface, every layout |

**Limits.** This is meaningful personal inspiration, not a prediction. It does not guarantee luck, revenue, or learning results. Per your instruction, your date, time and place of birth appear nowhere in any public-facing asset, and they should stay out of brand boards, the website and marketing.

---

## 2. What the brand has to say, in ordinary words

From the repository documentation, the learner's loop is: attempt a task → get scored or helped → save what needs work → come back to it. The three things that make BEL worth using are that it tells you **what specifically to change**, gives you **help when a task is too hard**, and tells you **what to do next**.

That is the whole brand message. Not "AI-powered." Not "adaptive learning." Not "smart engine."

**Core positioning (proposed):**

> BEL helps you practise English, understand what to improve, and take the next step with confidence.

**Focused PTE line (proposed):**

> PTE practice for Vietnamese learners, with clear feedback and help along the way.

Each direction below takes **one** of those three ideas and makes it the whole identity, rather than trying to draw all three.

Deliberately dropped, across all four directions: **leaves, books, suns, stars, arrows, sparkles, robots, circuits, brains and gradients.** Your brief asked for at least one direction free of them. All four are. That is a real departure and it has a cost, stated in §6: none of these marks announces "education" on sight. The word "English" in the name, and the interface around it, have to do that work instead.

---

## 3. The four directions

Artwork: [`svg/`](svg/). Every mark ships as symbol, wordmark, horizontal lockup, one-colour fallback and app tile. All are flat, all survive at 16 px, none depends on gradient, glow or 3D. Re-generate or adjust any of them by editing the parameters at the top of [`_generate.js`](_generate.js) and running `node _generate.js`.

---

### Direction 1 — **Stepframe**

**Idea:** *A clearer next step.*
**Files:** [lockup](svg/stepframe-lockup.svg) · [symbol](svg/stepframe-symbol.svg) · [wordmark](svg/stepframe-wordmark.svg) · [one colour](svg/stepframe-lockup-mono.svg) · [app tile](svg/stepframe-tile.svg)

**What the symbol is.** A **B** built from two modules: an upper bowl, and a lower bowl that reaches one measured step further to the right. The letterform carries the name; the offset carries the meaning. Nothing has been added to the letter to explain it — the asymmetry *is* the message.

**Why that meaning matters for BEL.** The hardest moment in exam practice is not failing a task; it is finishing one and not knowing what to do next. The documented product answers exactly that question — recommendations, review queues, what to practise again. A B whose second half moves forward by one unit says that, and says nothing it cannot support.

**How the product's feedback and support show up in the brand.** The step offset becomes a real layout unit. The distance the lower bowl travels is one spacing token; feedback panels, "next practice" cards, and progress rails all indent by that same unit. So the logo is not decoration sitting above the app — it is the app's measuring stick.

**Palette** — Wood green primary, Metal-toned surfaces, Water ink. Ratios measured, see §4.

| Role | Hex | Use |
|---|---|---|
| Ink | `#13211C` | Body text, the letterform |
| Primary (green) | `#0E5C41` | The step, primary buttons, links |
| Metal | `#E9EEEB` | Quiet surfaces, rails, dividers |
| Page | `#FAFBFA` | Page background |
| Card | `#FFFFFF` | Reading, writing and answer areas |
| Muted | `#586B63` | Secondary text |
| Accent | `#B14A18` | Milestones and one-per-screen emphasis only |

**Typography.** **Be Vietnam Pro** throughout (SIL OFL). Chosen because it is drawn by a Vietnamese foundry with Vietnamese diacritics as a first-class concern, not an afterthought — the single most important property for this audience. One family, four weights, no display face needed: the wordmark is drawn, so the typeface only has to be an excellent interface face.

**Weaknesses — read these.**

- At a glance the offset can read as a **printing error** rather than a decision. It needs optical correction at production, and it needs the step to be unmistakably deliberate (a larger offset, not a smaller one).
- The two-tone version puts the meaning in the colour. **In one colour the step still reads, but the emphasis does not.** Check the mono lockup before committing.
- "Geometric B" is a crowded field. This specific asymmetry may be free; the family is not. **Trademark search required.**
- It says nothing about *English*. See §6.

---

### Direction 2 — **Underline**

**Idea:** *See what to improve.*
**Files:** [lockup](svg/underline-lockup.svg) · [symbol](svg/underline-symbol.svg) · [wordmark](svg/underline-wordmark.svg) · [one colour](svg/underline-lockup-mono.svg) · [app tile](svg/underline-tile.svg)

**What the symbol is.** A line of text with **exactly one segment marked and underlined**. Not a speech bubble, not a chat icon, not a face. The oldest gesture a teacher makes: *this part, here.*

**Why that meaning matters for BEL.** This is the most product-true idea of the four. Pronunciation analysis marks which sounds need attention. Writing feedback marks the phrase to change. Highlight Incorrect Words is literally this gesture as an exam task. The brand claim is narrow and completely honest: we do not say the answer is wrong, we show you *which part*.

**How the product's feedback and support show up in the brand.** The underline becomes the app's single feedback primitive — the same weight, the same offset, the same colour, everywhere something is pointed at: a mispronounced syllable, a wrong collocation, the word you saved. One gesture, used consistently, instead of a zoo of highlight styles.

**Palette** — warmer paper, graphite ink, one precise green signal.

| Role | Hex | Use |
|---|---|---|
| Ink | `#14181A` | Body text |
| Primary (green) | `#0B6B4A` | The mark, primary buttons |
| Metal | `#E7E4DC` | Quiet surfaces |
| Page | `#FBF9F4` | Warm paper background |
| Card | `#FFFFFF` | Reading and writing areas |
| Muted | `#5C625F` | Secondary text |
| Accent | `#B4430F` | Correction emphasis |

**Typography.** **Newsreader** (OFL) for headlines over **Be Vietnam Pro** for the interface. Newsreader is a text-first serif with Vietnamese coverage; a serif headline suits an identity built on marking up text, and it signals *adult* more firmly than any geometric sans. Two families, no more.

**Weaknesses — read these.**

- **The biggest risk in the set.** Horizontal bars are the visual language of a dozen interface icons: text, list, subtitles, align, filter. An earlier version of this mark read unmistakably as a *filter funnel* and had to be rebuilt. It is out of that trap now, but the neighbourhood is crowded.
- It is the only direction with **no B and no letterform at all.** In a browser tab beside 30 others, it has less to grab onto.
- At 16 px the underline can visually merge with the bar above it. Needs a size-specific variant.

---

### Direction 3 — **The Return**

**Idea:** *Come back to what needs more practice.*
**Files:** [lockup](svg/return-lockup.svg) · [symbol](svg/return-symbol.svg) · [wordmark](svg/return-wordmark.svg) · [one colour](svg/return-lockup-mono.svg) · [app tile](svg/return-tile.svg)

**What the symbol is.** An **open loop that steps outward** — one turn that does not close where it started, ending in a rounded terminal, with a small warm dot marking the point you began from. You come back to the same practice, but not at the same place.

**Why that meaning matters for BEL.** Spaced review is the part of the documented product that actually produces improvement, and it is the part learners abandon. This is the only direction that puts *returning* at the centre rather than *progressing forward* — and returning is the honest description of language learning. It is also the only direction that quietly declines the "nonstop upward improvement" story your brief warned about.

**How the product's feedback and support show up in the brand.** The open loop becomes the review indicator: a word or task you have returned to twice shows two turns. The gap in the loop is where help appears. Progress is shown as *width of the loop*, not height of a bar.

**Palette** — deepest Water lean of the four; a deep teal primary sits between Wood and Water.

| Role | Hex | Use |
|---|---|---|
| Ink | `#0D2128` | Body text |
| Primary (deep teal) | `#0A5B66` | The loop, primary buttons |
| Metal | `#E6EDEF` | Quiet surfaces |
| Page | `#F9FBFB` | Page background |
| Card | `#FFFFFF` | Reading and writing areas |
| Muted | `#516168` | Secondary text |
| Accent | `#A94C19` | The return marker, milestones |

**Typography.** **Lexend** (OFL) throughout. Lexend was designed around reading-proficiency research and has Vietnamese coverage — a defensible choice for a learning product, provided you treat "designed for readability" as a design rationale and **not** as a claim that it measurably improves your users' outcomes. I have seen no evidence for that in your context and neither should you claim it.

**Weaknesses — read these.**

- **Rings and loops are everywhere** in learning and fitness apps. This is the most category-typical form in the set, even though the outward step is unusual.
- The warm dot sits *inside* the loop and can read as a stray element rather than a marker. It is the detail most likely to need rework.
- Like Stepframe, it says nothing about English. Unlike Stepframe, it is not a B either.

---

### Direction 4 — **BEL Cut**

**Idea:** *Better English. Clearer progress.*
**Files:** [lockup / wordmark](svg/belcut-lockup.svg) · [signature E](svg/belcut-symbol.svg) · [one colour](svg/belcut-lockup-mono.svg) · [app tile](svg/belcut-tile.svg)

**What it is.** No symbol. A drawn **BEL** wordmark carrying exactly **one** designed detail: the **E's middle arm is detached from the stem**, floating in a small measured gap. One letter, one detail, repeated nowhere else.

**Why that meaning matters for BEL.** The gap is the space where help goes. E is the letter at the centre of the word and the first letter of English. Nothing has been bolted onto the wordmark to explain that this is an education product — the brief asked for exactly this restraint, and this is the direction that takes it seriously.

**How the product's feedback and support show up in the brand.** The gap is a token. Every divider, every progress rail, every stepper in the app breaks at the same measure. When a hint appears, it appears *in the gap*. The identity is a rule about spacing rather than a picture.

**Palette** — the quietest of the four; near-monochrome with one green.

| Role | Hex | Use |
|---|---|---|
| Ink | `#111A17` | The wordmark, body text |
| Primary (green) | `#0F6547` | The gap detail, primary buttons |
| Metal | `#DCE3DF` | Rails, dividers, quiet surfaces |
| Page / card | `#FFFFFF` | Everything else |
| Muted | `#5B6660` | Secondary text |
| Accent | `#A8471A` | Milestones only |

**Typography.** **IBM Plex Sans** (OFL) for the interface, with the wordmark drawn rather than set. Plex has Vietnamese coverage, reads as adult and technical without reading as corporate-generic, and — being a text face rather than a display face — it stays out of the wordmark's way.

**Weaknesses — read these.**

- **The detail disappears at small sizes.** Below roughly 24 px the E gap closes optically, and the brand becomes an ordinary geometric BEL. That is the direction's central problem.
- Consequently the app icon has to be the **E alone**, which is weak recall — a green tile with an E on it is not distinctive.
- It puts almost all the brand weight on **copy and interface craft**. If those are not excellent, the brand is invisible. That is a real operational commitment, not just a design preference.

---

## 4. Colour and contrast — measured, not asserted

Every pair below was computed with the WCAG 2.x relative-luminance formula. **AA** = 4.5:1 or better for normal text; **AAA** = 7:1 or better.

| Pair | Stepframe | Underline | The Return | BEL Cut |
|---|---|---|---|---|
| Ink on page | 16.04 AAA | 16.98 AAA | 15.98 AAA | 17.74 AAA |
| Ink on metal surface | 14.18 AAA | 14.06 AAA | 14.01 AAA | 13.60 AAA |
| Muted text on card | 5.68 AA | 6.24 AA | 6.44 AA | 5.98 AA |
| Primary on card | 8.00 AAA | 6.53 AA | 7.77 AAA | 7.06 AAA |
| Primary on metal surface | 6.81 AA | 5.14 AA | 6.56 AA | 5.41 AA |
| White on primary (buttons) | 8.00 AAA | 6.53 AA | 7.77 AAA | 7.06 AAA |
| Accent on page | 5.24 AA | 5.32 AA | 5.41 AA | 5.86 AA |
| White on accent | 5.44 AA | 5.60 AA | 5.62 AA | 5.86 AA |

Two accents in the first draft (`#C4551F` and `#C25B22`) measured **4.34** and **4.20** — below AA for normal text. Both were darkened until they passed. That is the reason to measure rather than to trust a palette that looks fine.

**What this does not establish.** Contrast is one WCAG criterion. Focus visibility, target size, motion, screen-reader semantics, and the real rendered combinations in your app are all untested. Do not describe any of these palettes as "accessible" until that work is done.

**Rules that apply to all four directions:**

- Error, warning and success colours are **separate from the brand palette** and must not be drawn from it. A green brand with a green "correct" state makes correctness invisible.
- **Never colour alone.** Every marked error also carries an underline, an icon, or text.
- The warm accent is capped at **roughly one element per screen**. It marks milestones. It is not a secondary brand colour, and — per §1.4 — it is not a personal prescription.
- Brand green is the **primary action** colour, not a background wash. Practice content sits on white.

---

## 5. Typography — and the Vietnamese requirement

Test string, used on every specimen board:

> **Luyện tập rõ ràng. Tiến bộ từng bước.**

That line is not decorative. It stacks `ệ ậ ữ ỡ ế ộ ừ ướ` — the diacritic combinations that break Latin-Extended fonts. A face that has not been drawn with Vietnamese in mind will show collisions between the tone mark and the vowel mark, or will clip them at the line height an interface uses.

| Direction | Proposal | Licence | Why |
|---|---|---|---|
| Stepframe | Be Vietnam Pro | SIL OFL | Vietnamese-first by design; the safest choice on offer |
| Underline | Newsreader + Be Vietnam Pro | SIL OFL | Serif headline suits a mark-up identity; adult tone |
| The Return | Lexend | SIL OFL | Readability-motivated design; coherent with a learning product |
| BEL Cut | IBM Plex Sans | SIL OFL | Adult and technical without reading as generic corporate |

**Verify before locking any of these.** For each candidate: confirm the licence for web and app use, render the test string at 14 px / 16 px / 24 px, and confirm the diacritics clear the ascender at your actual line height. I have proposed these on the basis of their stated coverage; I have not tested them in your build. **Be Vietnam Pro is the one I would bet on** for the audience you named.

Two further notes, both from your brief:

- The app currently ships **Outfit**. Check its Vietnamese diacritics against the test string before assuming continuity is free.
- **Vietnamese labels run longer than English ones.** Every navigation and button style needs a two-line-safe spec. Do not solve that by shrinking the type.

---

## 6. Comparison, and my recommendation

| | Stepframe | Underline | The Return | BEL Cut |
|---|---|---|---|---|
| Carries the name | **Yes — it is a B** | No | No | **Yes — it is the word** |
| Says something only BEL can say | Good | **Best** | Good | Weak |
| Survives at 16 px | **Strong** | Adequate | **Strong** | **Fails** (detail closes) |
| Survives in one colour | Meaning yes, emphasis no | Yes | Yes | Yes |
| Generates a reusable UI pattern | **Yes — a spacing unit** | **Yes — a feedback mark** | Yes — a review indicator | Yes — a gap measure |
| Risk of looking like another category | Moderate (geometric B) | **High** (interface icon) | **High** (learning/fitness ring) | Low |
| Demands excellent copy and UI to work | Moderate | Moderate | Moderate | **Total** |

### Recommendation: **Stepframe**, with Underline harvested as the interface signature.

The reasoning, not a preference:

1. **It carries the name.** BEL is an unknown three-letter brand. A mark that is literally a B does more work for recognition than an abstract symbol, and this is the only direction that is both a letter *and* an idea.
2. **Its message matches the documented product most closely.** "A clearer next step" is a promise the repository documentation supports — recommendations, review queues, hint levels. It does not require you to claim perfect feedback or guaranteed scores.
3. **It is robust where it has to be.** It holds at 16 px and in one colour, which BEL Cut does not.
4. **It pays rent in the interface.** The step offset becomes a spacing token, so the identity keeps working on every screen instead of only in the header.

**And take the Underline's idea with you.** Underline is the strongest *concept* in the set and the weakest *mark* — it risks reading as a generic text or filter icon, and it has no letterform. So do not make it the logo. Make it the single feedback gesture inside Stepframe: one underline weight, one colour, used everywhere the app points at the exact thing to fix. You get the best idea without carrying its liability in the app icon.

**Second choice, if you want the lowest risk of looking like a category cliché: BEL Cut.** It is the most adult and the least likely to be mistaken for a wellness or fitness brand. The price is memorability — and a commitment that your copy and interface carry the brand, permanently.

**Do not pick The Return** unless you specifically want to lead with spaced review as the product's headline. It is a well-made mark for a story you are not currently telling.

---

## 7. What to do next, in order

1. **Decide the direction** — or tell me which two to develop further.
2. **Trademark search** on the chosen mark, in Viet Nam and in any market you intend to enter. Do this before any further investment. Simple geometric marks collide.
3. **Optical correction pass.** These are constructed from clean geometry, which is right for a concept and wrong for production. Bowl overshoot, stem weight compensation and spacing all need drawing by eye at final size.
4. **Font decision**, tested with the Vietnamese string at real interface sizes in your build.
5. **Accessibility pass** beyond contrast: focus states, target sizes, error semantics.
6. **Then** apply it, starting with the practice screen — and protect the rules your brief set: no brand pattern behind reading passages or answer fields, no return to the cramped three-column practice layout, motion optional and light.

**Two constraints to carry forward regardless of direction.** PTE stays a **descriptor beside** the logo, never a part of it — you said the audience is current, not permanent, and the logo should not have to be redrawn when that changes. And nothing here implies Pearson endorsement or official PTE scoring; that requires authorisation and evidence, and none exists.

---

## 8. Sources and evidence boundaries

Product claims in §2 come from the repository documentation cited in your brief — `docs/specs/product.md`, `docs/specs/features/smart-difficulty-engine.md`, `docs/specs/features/writing-challenge.md` — which I have taken from the brief as given rather than re-verifying against the live app. Documentation can lag implementation; confirm any public feature promise before publishing it.

The four-pillar derivation in §1 is my own calculation, with the method stated and the day-pillar formula verified against a known anchor. The *Cùng Thông Bảo Giám* prescription in §1.3 is reported as a citation to that tradition, not as something I derived. The strong/weak disagreement is real and I have not resolved it, because resolving it honestly would require a practitioner's judgement about which school to follow — which is your call, not mine.

Contrast figures in §4 are computed. Everything else — every shape, every hex value, every typeface, the recommendation itself — is design judgement, offered as such.
