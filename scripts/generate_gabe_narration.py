import os
import sys
import subprocess
import time
import json
import urllib.request
import soundfile as sf
import numpy as np

kokoro_dir = r"C:\Cursor AI\Kokoro-FastAPI"
python_exe = os.path.join(kokoro_dir, ".venv", "Scripts", "python.exe")
espeak_dll = os.path.join(kokoro_dir, ".venv", "Lib", "site-packages", "espeakng_loader", "espeak-ng.dll")
espeak_data = os.path.join(kokoro_dir, ".venv", "Lib", "site-packages", "espeakng_loader", "espeak-ng-data")

out_dir = r"C:\Cursor AI\exported_slides\narration_audio"
os.makedirs(out_dir, exist_ok=True)

beats = [
    {
        "id": "beat_01_founder",
        "title": "The Founder's Vision & Economic Logic",
        "text": (
            "Before we hear from the creators who lived this model every day at Valve, "
            "let's look at the founder behind this philosophy: Gabe Newell. "
            "Why did a multi-billion dollar company decide, from day one, to eliminate managers, job titles, and approval chains? "
            "Newell rooted this entire structure in profound economic logic, "
            "specifically Ronald Coase's Nobel Prize-winning work on the Nature of the Firm."
        )
    },
    {
        "id": "beat_02_transaction_costs",
        "title": "Pillar 1: Transaction Costs",
        "text": (
            "In 1937, Coase explained that corporations exist to reduce transaction costs. "
            "Hierarchies worked well for twentieth-century factory floors, where physical tasks were repetitive. "
            "But Gabe made a crucial realization: in creative knowledge work, corporate hierarchy does the exact opposite. "
            "Middle managers become the single largest source of friction and delay, "
            "trapping great ideas in weeks of review."
        )
    },
    {
        "id": "beat_03_creative_leverage",
        "title": "Pillar 2: Creative Leverage",
        "text": (
            "This leads directly to human leverage. "
            "When supervisors dictate daily tasks to masters of their craft, creative output is permanently capped at whatever one manager can imagine. "
            "But when educators own their curriculum directly, impact multiplies. "
            "Teachers spot subtle student confusions, craft engaging pronunciation games, "
            "and take personal pride in every outcome."
        )
    },
    {
        "id": "beat_04_learner_first",
        "title": "Pillar 3: Learner First",
        "text": (
            "And third, eliminating office politics. "
            "In corporate ladders, people waste half their mental energy managing impressions, defending turf, and pleasing supervisors. "
            "In Flatland, that entire wasteful layer simply evaporates. "
            "There is only one true north star: Does this genuinely help our students learn?"
        )
    },
    {
        "id": "beat_05_bridge_takeaway",
        "title": "Empowering Our Teaching Team",
        "text": (
            "We aren't making video games, but educational design is deeply creative knowledge work. "
            "In our team, you never need an administrator's permission slip to make a lesson better. "
            "When we trust each other as equals, our students receive the very best learning experience we can possibly give them."
        )
    }
]

def is_server_ready():
    try:
        req = urllib.request.urlopen("http://127.0.0.1:8880/v1/audio/voices", timeout=2)
        return req.status == 200
    except Exception:
        return False

def ensure_kokoro_server():
    if is_server_ready():
        print("Kokoro TTS server is already active on http://127.0.0.1:8880")
        return None, None
        
    print("Starting Kokoro TTS server...")
    env = os.environ.copy()
    env["PHONEMIZER_ESPEAK_LIBRARY"] = espeak_dll
    env["ESPEAK_DATA_PATH"] = espeak_data
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env["PROJECT_ROOT"] = kokoro_dir
    env["USE_GPU"] = "false"
    env["PYTHONPATH"] = f"{kokoro_dir};{os.path.join(kokoro_dir, 'api')}"
    env["MODEL_DIR"] = "src/models"
    env["VOICES_DIR"] = "src/voices/v1_0"
    env["WEB_PLAYER_PATH"] = os.path.join(kokoro_dir, "web")

    log_path = os.path.join(kokoro_dir, "narration_server.log")
    log_file = open(log_path, "w", encoding="utf-8")

    cmd = [python_exe, "-m", "uvicorn", "api.src.main:app", "--host", "127.0.0.1", "--port", "8880"]
    proc = subprocess.Popen(cmd, cwd=kokoro_dir, env=env, stdout=log_file, stderr=subprocess.STDOUT)

    for i in range(45):
        time.sleep(1)
        if is_server_ready():
            print(f"Kokoro server ready in {i+1}s!")
            return proc, log_file

    print("Kokoro server failed to start within 45s.")
    proc.kill()
    log_file.close()
    sys.exit(1)

def assemble_master_narration(re_synthesize=False):
    proc, log_file = None, None
    sample_rate = 24000
    beat_results = []
    
    # Timing architecture:
    # 2.0s intro hold (video fades in at 1.0s, audience reads slide context)
    # 1.6s pause between beat 1->2, 2->3, 3->4
    # 1.8s pause between beat 4->5 (longer pause before major takeaway)
    # 3.5s outro hold (camera widens, resolves, fades out to black over 1.5s)
    intro_dur = 2.0
    pauses = [1.6, 1.6, 1.6, 1.8]
    outro_dur = 3.5
    
    try:
        for idx, beat in enumerate(beats):
            beat_wav_path = os.path.join(out_dir, f"{beat['id']}.wav")
            need_synthesis = re_synthesize or not os.path.exists(beat_wav_path)
            
            if need_synthesis:
                if proc is None and not is_server_ready():
                    proc, log_file = ensure_kokoro_server()
                    
                print(f"\nSynthesizing Beat {idx+1}: {beat['title']}...")
                payload = {
                    "model": "kokoro",
                    "input": beat["text"],
                    "voice": "am_adam",
                    "response_format": "wav",
                    "speed": 0.93
                }
                req = urllib.request.Request(
                    "http://127.0.0.1:8880/v1/audio/speech",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=60) as response:
                    wav_bytes = response.read()
                    with open(beat_wav_path, "wb") as f:
                        f.write(wav_bytes)
            
            data, sr = sf.read(beat_wav_path)
            dur = len(data) / sr
            print(f"Beat {idx+1}: {beat['id']} ({dur:.3f}s)")
            beat_entry = dict(beat)
            beat_entry["duration"] = dur
            beat_entry["wav_path"] = beat_wav_path
            beat_results.append(beat_entry)
            
        # Build composite master narration with mathematically precise timestamps
        all_audio = []
        
        # 1. Intro silence
        intro_samples = int(sample_rate * intro_dur)
        all_audio.append(np.zeros(intro_samples, dtype=np.float32))
        
        t_cursor = intro_dur
        for idx, b in enumerate(beat_results):
            data, sr = sf.read(b["wav_path"])
            b["start"] = t_cursor
            b["end"] = t_cursor + b["duration"]
            t_cursor += b["duration"]
            all_audio.append(data.astype(np.float32))
            
            if idx < len(beat_results) - 1:
                p_dur = pauses[idx]
                p_samples = int(sample_rate * p_dur)
                all_audio.append(np.zeros(p_samples, dtype=np.float32))
                t_cursor += p_dur
            else:
                out_samples = int(sample_rate * outro_dur)
                all_audio.append(np.zeros(out_samples, dtype=np.float32))
                t_cursor += outro_dur
                
        master_audio = np.concatenate(all_audio)
        total_dur = len(master_audio) / sample_rate
        master_wav = os.path.join(out_dir, "master_narration.wav")
        sf.write(master_wav, master_audio, sample_rate)
        
        print(f"\nMaster Narration Successfully Built!")
        print(f"Total Duration: {total_dur:.3f}s ({len(master_audio)} samples @ {sample_rate}Hz)")
        print(f"File: {master_wav}")
        
        manifest = {
            "voice": "am_adam",
            "speed": 0.93,
            "sample_rate": sample_rate,
            "intro_duration": intro_dur,
            "outro_duration": outro_dur,
            "total_duration": total_dur,
            "beats": beat_results
        }
        
        manifest_path = os.path.join(out_dir, "narration_manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"Updated Manifest: {manifest_path}")
        
        for b in beat_results:
            print(f"  [{b['start']:6.2f}s - {b['end']:6.2f}s] {b['title']}")
            
    finally:
        if proc is not None:
            print("\nShutting down Kokoro server that was started by this script...")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            if log_file:
                log_file.close()

if __name__ == "__main__":
    force_resynth = "--resynth" in sys.argv
    assemble_master_narration(re_synthesize=force_resynth)
