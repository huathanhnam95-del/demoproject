# Avatar Preparation Studio

A standalone local capture tool for preparing your own photo, video and bilingual voice references. It does not connect to CRM/Firebase, run a model, synthesize a voice, upload to a provider, or render an avatar.

## Start and open

Requires Node.js 20 or newer and desktop Chrome. No runtime packages or model downloads are needed. From the repository root:

```powershell
node tools/avatar_preparation/server.cjs
```

Open **http://127.0.0.1:8796** in Chrome. The server binds only to that loopback address. Leave the terminal/server running while using the studio; Ctrl+C stops it. It does not start the repository app server or any worker. A busy port produces an error; stop the other instance or use an explicitly different port:

```powershell
node tools/avatar_preparation/server.cjs --port 8797
```

On Windows, the default data folder is beneath the launching process's `LOCALAPPDATA`. Desktop app containers can redirect that variable and filesystem access. The page shows the actual, natively resolved folder under Review.

The running handoff requested `C:\Users\Admin\AppData\Local\BEL\AvatarPreparation`. Windows resolves that alias to **`C:\Users\Admin\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\BEL\AvatarPreparation`** in this Codex environment. Both names currently refer to the same files; the session endpoint reports the physical path. To restart from any shell against exactly that same store, use its physical path:

```powershell
node tools/avatar_preparation/server.cjs --data-dir 'C:\Users\Admin\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\BEL\AvatarPreparation'
```

To use another local folder outside the repository:

```powershell
node tools/avatar_preparation/server.cjs --data-dir 'D:\AvatarPreparation'
```

Keep this folder local if you want to avoid automatic third-party folder syncing. One server owns a data folder at a time, including when different ports are used. The tool itself makes only same-origin loopback requests. The documentation link opens MuseTalk's public documentation only when you click it.

## Capture workflow

1. Create a project. Start with the photo shots, then steady video, voice references and optional expressive practice.
2. Select a camera and microphone. Enable devices explicitly and accept Chrome's permissions. Device names may appear only after permission. Refresh devices after plugging in new hardware.
3. Read the current cue. Directions describe expression, intensity, eye contact, posture, head/hands, pauses and target pacing. Directions are not part of the spoken script. Auto cues use target durations; they are not transcript alignment. Manual previous/next and larger text are available.
4. Record or capture a photo after the countdown. Stop whenever you want. Recording automatically stops at three minutes or 128 MiB; save a take before recording another. Existing files up to 512 MiB can also be imported into a matching scene.
5. Play back or inspect the unsaved preview. Save it, retake explicitly, or download its original bytes if saving fails. Changing sessions or closing the page warns about unsaved material.
6. Review saved takes. The expected script is frozen with the take. Transcript review is optional and does not affect core completeness. If you choose to add a transcript, copy the expected script as a starting point if useful, then correct it against what you said. Later script edits do not alter earlier take transcripts. Select a preferred take or archive one; archival retains original media. Use Show archived to review or unarchive it.
7. Saved, selected source assets count toward core completeness immediately; transcript review is not required. Review your own lighting/sound checks if useful. Export the whole project folder for backup and later transfer.

Camera preview is mirrored for comfort. Photos save an unmirrored PNG at the negotiated frame dimensions; video records the browser's original encoded stream. These are browser capture originals, not sensor RAW. The selected camera/microphone remain enabled until disabled, a session changes, or the page exits. No recording starts just because a device is enabled.

Imported originals are byte-preserved. Video audio stays synchronized and unprocessed. Audio-only takes also pass through the existing read-only `public/js/audio-dsp-pipeline.js`; a successful processed WAV is stored as a separate asset linked to its original and processing stats. Raw fallback is never labeled enhanced. Enhancement failure does not invalidate a saved original.

The input meter indicates activity and possible peak clipping. Actual MIME, dimensions/frame rate where available, and file size are shown. Listen to recordings yourself; this tool does not automatically verify transcript accuracy, noise quality, facial visibility, pronunciation, emotion or likeness.

## Files, backup and recovery

The data folder contains:

- `projects/<id>/manifest.json` and `media/`: versioned project metadata and immutable original/derived assets.
- `drafts/<id>/`: staged uploads/imports. Interrupted work can remain here for diagnosis. Successfully committed media is retained in the project, with small draft metadata kept for retry identity.
- `exports/<project-id>-<unique-id>/`: complete portable project folders. The manifest is written last after file hashes are checked.

Export creates a new folder; it never overwrites a previous export. Copy the displayed path into File Explorer. Keep `manifest.json` and the entire `media` folder together. Import by choosing that exported folder in the studio's Import control. The importer checks schema, safe relative paths, file presence, size and SHA-256 before exposing the restored project. It creates a separate project, preserving source asset/take IDs and recording its source project ID.

Limits are 300 assets (including DSP derivatives), 512 MiB per imported media file, and 8 MiB per formatted project manifest. Filesystem capacity still applies. A failed save keeps the current browser preview available for retry/download; do not close that preview before recovering it. Previously saved projects remain independent. Revision conflicts report that another window changed the project: preserve/download unsaved media and text, reload, then retry. Incomplete draft files are not automatically promoted to valid recordings and may not be playable. There is no automatic recovery promise for a browser crash during an unsaved recording.

Metadata updates use revision checks, serialized per-project writes and atomic manifest replacement. Export/import packages contain no required localhost URL or Firebase identifier. The browser `StorageClient` is the boundary for a future authenticated cloud adapter; capture code and schema are separate. Future cloud migration, model selection, commercial licensing, rendering and quality evaluation are separate work.

The authored pack has seven photo shots and ten paired Vietnamese/English sessions. Steady source footage is separate from an expressive archive. MuseTalk accepts source video/images and audio, with upstream 25fps guidance; cameras negotiate their actual capabilities. Collecting expressive takes does not teach MuseTalk gestures or emotional performance. See [MuseTalk](https://github.com/TMElyralab/MuseTalk). Existing F5-TTS infrastructure is not called; its [official pretrained weights have a noncommercial license](https://github.com/SWivid/F5-TTS#license).

## Focused verification

From the repository root:

```powershell
node tools/avatar_preparation/run-checks.cjs
node tools/avatar_preparation/run-checks.cjs --browser
```

The first command runs the isolated Node schema, authored-pack, filesystem, portable-package and server checks. `--browser` additionally launches installed Chrome with generated synthetic video and microphone fixtures through the real MediaRecorder and DSP path. It never opens a physical device. Tests write fixtures, screenshots, media, logs and provenance under `C:\Users\Admin\.codex\avatar-preparation-task\verification` by default, or the explicitly supplied `AVATAR_EVIDENCE_DIR`.

For the isolated Codex worktree, use the already installed primary-workspace Playwright dependency read-only (no installation):

```powershell
$env:NODE_PATH = 'C:\Cursor AI\node_modules'
node tools/avatar_preparation/run-checks.cjs --browser
```

The browser check exercises an unmirrored camera photo, canceled retake, failed-save retry, playable encoded video/audio, separate real DSP output, exact Unicode script/transcript independence, server/browser reload, fresh-profile/fresh-directory portable import, supplemental media import, cue controls, denied-permission recovery, layout and local-only requests. Filesystem failure injection is not a claim that the physical disk was filled. Synthetic capture is not a real camera/microphone quality test.

Physical hardware acceptance is user-operated: open the page in Chrome, enable the PC camera/mic, capture a short video and photo, record one short Vietnamese and English take, save, reload and play them back. Check the actual connected device, orientation, framing and sound. No CRM login is needed. Any later CRM integration verification must follow `C:\Cursor AI\.local\browser-test-credentials.md` without copying its credentials here.

## Ownership and scope

Source ownership is this standalone tool and its exact dedicated tests; the parent project's `agent_docs/project_structure.md` remains the repository authority. No existing CRM shell, root package, Firebase configuration or production source is changed. The shared DSP script is a read-only dependency served by an exact allowlist, without loading its original page.

The external task contract and before snapshot are under `C:\Users\Admin\.codex\avatar-preparation-task`. The isolated worktree has older structure documentation, so the current primary-workspace checker/policy are used read-only for focused placement and snapshot/index-delta verification. Governance files are not copied or changed to make this feature pass. Keep the retained evidence with the exact source SHA/file hashes; no user-camera media belongs in tracked tests or evidence.
