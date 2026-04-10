"""
Generate ElevenLabs audio for Read Aloud questions with pause tags.

Reads ANSWER CHUNKED column from RA.xlsx and translates chunk markers:
  - ` / `  → <break time="0.8s" />  (0.8s pause — phrase break)
  - ` // ` → <break time="0.4s" />  (0.4s pause — brief breath)

Each question gets:
  - 1 male voice × 2 speeds (100%, 80%)
  - 1 female voice × 2 speeds (100%, 80%)
  = 4 MP3 files per question

Usage:
  # Test on 10 questions first
  python scripts/generate_ra_audio.py --test

  # Generate all
  python scripts/generate_ra_audio.py

  # Resume after interruption (skips already-generated files)
  python scripts/generate_ra_audio.py
"""

import os
import sys
import json
import time
import random
import argparse
import requests
import openpyxl
from dotenv import load_dotenv

# ── Config ───────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.join(SCRIPT_DIR, '..')
load_dotenv(os.path.join(PROJECT_ROOT, '.env'))

RA_XLSX = os.path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'RA.xlsx')
VOICES_XLSX = os.path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'Voice', 'Voices.xlsx')
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'Voice', 'audio')
PROGRESS_FILE = os.path.join(PROJECT_ROOT, '_tmp', 'ra_audio_progress.json')
MANIFEST_FILE = os.path.join(OUTPUT_DIR, 'manifest.json')

API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech'
SPEEDS = [1.0, 0.80]
SPEED_LABELS = {1.0: '100', 0.80: '80'}
MODEL_ID = 'eleven_v3'
OUTPUT_FORMAT = 'mp3_44100_128'
DELAY_BETWEEN_CALLS = 0.5  # seconds, to respect rate limits


# ── Load voices ──────────────────────────────────────────────────────
def load_voices():
    wb = openpyxl.load_workbook(VOICES_XLSX)
    ws = wb.active
    male_voices = []
    female_voices = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        name, voice_id, gender, style = row[0], row[1], row[2], row[3]
        entry = {'name': name, 'id': voice_id, 'style': style}
        if gender and gender.strip().lower() == 'male':
            male_voices.append(entry)
        elif gender and gender.strip().lower() == 'female':
            female_voices.append(entry)
    return male_voices, female_voices


# ── Chunk marker → pause tag translation ────────────────────────────
def translate_chunks_to_pauses(chunked_text, plain_text):
    """Convert chunk markers to ElevenLabs pause tags.
    Order matters: // must be replaced before / to avoid partial matches.
    """
    if not chunked_text or not str(chunked_text).strip():
        return str(plain_text).strip()  # fallback to clean text
    text = str(chunked_text).strip()
    text = text.replace(' // ', ' <break time="0.3s" /> ')
    text = text.replace(' / ', ' <break time="0.6s" /> ')
    return text


# ── Load RA questions ────────────────────────────────────────────────
def load_questions():
    wb = openpyxl.load_workbook(RA_XLSX)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    required_headers = ['ID', 'ANSWER FOR COMPARE OR TRANSCRIPT']
    header_positions = {}

    for index, header in enumerate(headers):
        if header in header_positions:
            raise ValueError(f'Duplicate workbook header found: {header}')
        header_positions[header] = index

    missing_headers = [header for header in required_headers if header not in header_positions]
    if missing_headers:
        raise ValueError(f'Missing required workbook headers: {", ".join(missing_headers)}')

    # ANSWER CHUNKED is the 6th column (index 5)
    chunked_col = header_positions.get('ANSWER CHUNKED', None)

    questions = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        q_id = row[header_positions['ID']]
        clean_text = row[header_positions['ANSWER FOR COMPARE OR TRANSCRIPT']]
        chunked_text = row[chunked_col] if chunked_col is not None else None
        if q_id is not None and clean_text:
            tts_text = translate_chunks_to_pauses(chunked_text, clean_text)
            questions.append({
                'id': int(q_id),
                'text': tts_text,
                'has_pauses': chunked_text is not None and str(chunked_text).strip() != ''
            })
    return questions


# ── Deterministic voice assignment ───────────────────────────────────
def assign_voice(q_id, voice_pool):
    """Pick a voice deterministically based on question ID."""
    rng = random.Random(q_id)
    return rng.choice(voice_pool)


# ── Progress tracking ────────────────────────────────────────────────
def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, 'r') as f:
            return set(json.load(f))
    return set()


def save_progress(completed):
    os.makedirs(os.path.dirname(PROGRESS_FILE), exist_ok=True)
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(list(completed), f)


# ── TTS generation via REST API ──────────────────────────────────────
MAX_RETRIES = 3
REQUEST_TIMEOUT = 60  # seconds

def generate_single(api_key, text, voice_id, speed, output_path):
    """Call ElevenLabs TTS REST API with speed control and save to file."""
    url = f'{API_BASE}/{voice_id}?output_format={OUTPUT_FORMAT}'
    req_headers = {
        'Content-Type': 'application/json',
        'xi-api-key': api_key,
        'Accept': 'audio/mpeg',
    }
    payload = {
        'text': text,
        'model_id': MODEL_ID,
        'speed': speed,
    }

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(url, json=payload, headers=req_headers, stream=True, timeout=REQUEST_TIMEOUT)

            if response.status_code != 200:
                raise Exception(f'API error {response.status_code}: {response.text}')

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=4096):
                    if chunk:
                        f.write(chunk)
            return  # success
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            wait = 2 ** attempt
            print(f'    Retry {attempt}/{MAX_RETRIES} after {type(e).__name__}, waiting {wait}s...')
            time.sleep(wait)
        except Exception as e:
            raise  # non-retryable errors

    raise Exception(f'Failed after {MAX_RETRIES} retries: {last_error}')


# ── Main ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Generate ElevenLabs audio for RA questions')
    parser.add_argument('--test', action='store_true', help='Only generate for 10 questions')
    parser.add_argument('--gender', choices=['male', 'female'], default=None, help='Only generate for this gender')
    parser.add_argument('--speed', type=int, choices=[100, 80], default=None, help='Only generate for this speed (100 or 80)')
    args = parser.parse_args()

    api_key = os.getenv('ELEVENLABS_API_KEY')
    if not api_key:
        print('ERROR: ELEVENLABS_API_KEY not found in .env')
        sys.exit(1)

    print('Loading voices...')
    male_voices, female_voices = load_voices()
    print(f'  Male voices: {len(male_voices)}, Female voices: {len(female_voices)}')

    print('Loading questions...')
    questions = load_questions()
    with_pauses = sum(1 for q in questions if q.get('has_pauses'))
    print(f'  Total questions: {len(questions)} ({with_pauses} with pause tags, {len(questions) - with_pauses} plain text fallback)')

    if args.test:
        questions = questions[:10]
        print(f'  TEST MODE: Processing only {len(questions)} questions')

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    completed = load_progress()
    manifest = {}

    # Load existing manifest if present
    if os.path.exists(MANIFEST_FILE):
        with open(MANIFEST_FILE, 'r') as f:
            manifest = json.load(f)

    # Build filtered gender/speed combos
    gender_filter = [args.gender] if args.gender else ['male', 'female']
    speed_filter = [int(args.speed)] if args.speed else [int(s * 100) for s in SPEEDS]
    active_speeds = [s for s in SPEEDS if int(s * 100) in speed_filter]

    total_tasks = len(questions) * len(gender_filter) * len(active_speeds)
    done_count = 0
    skipped_count = 0
    print(f'  Generating: genders={gender_filter}, speeds={[SPEED_LABELS[s] for s in active_speeds]}, total_tasks={total_tasks}')

    for q in questions:
        q_id = q['id']
        text = q['text']

        male_voice = assign_voice(q_id, male_voices)
        female_voice = assign_voice(q_id + 10000, female_voices)  # offset seed for female

        q_manifest = manifest.get(str(q_id), {
            'male': {'voiceId': male_voice['id'], 'voiceName': male_voice['name'], 'files': {}},
            'female': {'voiceId': female_voice['id'], 'voiceName': female_voice['name'], 'files': {}}
        })

        for gender, voice in [('male', male_voice), ('female', female_voice)]:
            if gender not in gender_filter:
                continue
            for speed in active_speeds:
                speed_label = SPEED_LABELS[speed]
                filename = f'RA_{q_id}_{gender}_{speed_label}.mp3'
                file_key = f'{q_id}_{gender}_{speed_label}'

                if file_key in completed:
                    skipped_count += 1
                    done_count += 1
                    q_manifest[gender]['files'][speed_label] = filename
                    continue

                output_path = os.path.join(OUTPUT_DIR, filename)

                offset = 0
                while True:
                    if offset > 0:
                        voice_pool = male_voices if gender == 'male' else female_voices
                        voice = assign_voice(q_id + offset, voice_pool)

                    try:
                        print(f'  [{done_count + 1}/{total_tasks}] Generating {filename} with voice {voice["name"]}...')
                        generate_single(api_key, text, voice['id'], speed, output_path)
                        completed.add(file_key)
                        q_manifest[gender]['files'][speed_label] = filename
                        # update manifest for final assigned voice
                        q_manifest[gender]['voiceId'] = voice['id']
                        q_manifest[gender]['voiceName'] = voice['name']
                        
                        done_count += 1

                        # Save progress periodically
                        if done_count % 10 == 0:
                            save_progress(completed)

                        time.sleep(DELAY_BETWEEN_CALLS)
                        break # success, exit retry loop
                        
                    except Exception as e:
                        err_str = str(e).lower()
                        if "library voices" in err_str or "payment_required" in err_str or "paid_plan_required" in err_str or "402" in err_str:
                            print(f'  Warning: Voice {voice["name"]} requires paid plan. Trying fallback...')
                            offset += 100
                            if offset > 1000:
                                print('  ERROR: All voices exhausted.')
                                save_progress(completed)
                                sys.exit(1)
                            continue

                        print(f'  ERROR generating {filename}: {e}')
                        save_progress(completed)
                        # Update manifest with what we have so far
                        manifest[str(q_id)] = q_manifest
                        with open(MANIFEST_FILE, 'w') as f:
                            json.dump(manifest, f, indent=2)
                        print(f'  Progress saved. Re-run to resume.')
                        sys.exit(1)

        manifest[str(q_id)] = q_manifest

    # Final save
    save_progress(completed)
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f'\nDone! Generated: {done_count - skipped_count}, Skipped: {skipped_count}, Total: {done_count}')
    print(f'Manifest saved to: {MANIFEST_FILE}')


if __name__ == '__main__':
    main()
