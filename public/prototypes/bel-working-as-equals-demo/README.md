# Working as Equals at BEL — desktop Chrome demo

This standalone prototype uses four views in one Chrome profile: presenter p0 and participants p1–p3. Open the presenter URL, create a session, then use Presenter → Open participant links. Keep all four windows visible. Profiles, world progress, saved notes and the ETA origin persist on the same browser origin. It does not provide remote multiplayer across computers or profiles.

## Run from this checkout

```powershell
node scripts/bel-demo/serve.cjs 4178
```

Open `http://127.0.0.1:4178`. The server verifies every external source/art file against `presentation/source-manifest.json` before listening. Source paths must exist. The authored presentation also requires its original React/ReactDOM CDN and Google Fonts dependencies. No credentials or Firebase services are used.

## Produce a portable static site

```powershell
node scripts/bel-demo/package.cjs C:\path\outside-repository\new-bel-package
python -m http.server 4178 --bind 127.0.0.1 --directory C:\path\outside-repository\new-bel-package
```

Open `http://127.0.0.1:4178/site/`. The packager refuses an existing destination and verifies all input bytes before writing. `site/` contains runtime code and only the enumerated assets. The sibling `package-manifest.json` records each source and output SHA-256. The package supports a nested hosting path. Keep the package manifest private to the release evidence: it contains local source paths. Deploy only the `site/` contents. Publishing is a separate user-authorized release operation.

## Play and present

- WASD moves; F or a nearby click interacts. Clicks do not move players. E releases a handhold. Another player must accept a handhold invitation.
- Start in private Homes; ride or walk through Street to Reception and A. After source slides 1–3, participants enter their B1/B2/B3 route. Carry each shape to its matching pedestal and read its exact source text. Gather in C for source 4–9, visit the five Gallery portraits in D, then E for 10–16.
- F: the presenter starts 60 seconds of preparation, then a 30-second team attempt. Place six thoughts in order. Failure gives 10 seconds of review and resets the crossing. Skip builds an explicitly assisted bridge; everyone must still walk across. Reset is available until G's presentation starts. G presents 17–18.
- I: each of six statements has a 3-second opening and a 5-second choice, with 10-second intervals between statements. Stand fully in Do or Don't. Wrong or absent choices reverse WASD for 20 seconds without stacking. Source 19 is available as recap; source 20 requires activity completion.
- J: two nearby players each carry one cube and interact to match. Conduct/Literature review, Gather/Stakeholders' opinions, and Identify/Learning needs reveal three source objectives. All three are required before the presenter starts source 21.
- The closing sequence uses the original Determine and ETA nodes. Reveal ETA/Next starts one shared countdown; Previous or R returns to Determine. Returning to ETA, reload and R preserve that origin. Native Reset means navigation, not a countdown restart.
- Notes stay editable during presentations. The slide refits beside a compact notebook. Another person's saved pages are read-only. Closing or reloading a view pauses the group; rejoin through its original window/invitation and let the presenter resume when everyone is ready.

## Verification

```powershell
node scripts/bel-demo/verify.mjs
python -B tests/browser/bel-demo/run.py --stage A --evidence C:\external\evidence
python -B tests/browser/bel-demo/activities.py --stage final --evidence C:\external\evidence
```

Browser scripts attach to headed Chrome at `http://127.0.0.1:9228` (`--cdp` overrides it). Launch Chrome through Playwright with `channel="chrome"`, a dedicated external persistent profile, and the remote-debugging port. Use normal timer/visibility behavior: no background throttling bypass. The scripts use real mouse/keyboard input and observation-only snapshots; they expect the original four participant windows already open.

`run.py` provides arrival, reception, A, B, C, D, E, G and recovery stages. It is a staged rehearsal, not a fresh-session one-command suite. Each stage requires the corresponding physical entry checkpoint. `activities.py --stage F` waits for the next genuine review period, stages the three carriers sequentially, and builds with fixed collisions and the unmodified 30-second clock. Presenter p0 must remain at F's lower entry (350,375). `--stage I` expects p0 by its monitor (631,175), p1 in Don't, p2 in Do and p3 in the neutral area before starting. `--stage final` expects an active completed J presentation and preserves the existing ETA origin.

J rehearsal: verify a wrong pair retains both objects; drop them using Put down; match two distinct carriers for each correct pair, closing any social panel before moving. Verify a carrier reload returns its cube to safe floor, rejoin/resume, and reclaim it. Check that matching all three reveals the full objectives but does not automatically start a presentation. Gather all four and start from the monitor.

Unit coverage includes authority, replay receipts, save validation, readiness, clocks, collision, stale activity actions, F Skip/Reset, I choices/reversal and J matching. Browser evidence and fixture coverage are separate: a green unit run does not establish production behavior. The development evidence includes same-session F normal completion, all I decisions, J completion and four-view native ETA. F Skip/Reset require fresh live verification before G starts; their development verification is unit-level.

This prototype intentionally retains original source wording, including source-21 spelling. Original deck, design system, authored handlers, photos and approved concept files are read-only. Only the served/packaged HTML copy receives the app-owned frame adapter.
