import os
import json
import base64
import pandas as pd
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

# --- API Key Rotation ---
API_KEYS = [
    "AIzaSyB-7-Z_akwDLmHj40KD-5W1t6qKJbTfqZs",
    "AIzaSyAaEBXf1LdkixTExCagUVCFY-dVUFf9X9U",
]
current_key_idx = 0
client = genai.Client(api_key=API_KEYS[current_key_idx])

def rotate_key():
    """Switch to the next API key. Returns False if all keys exhausted."""
    global current_key_idx, client
    current_key_idx += 1
    if current_key_idx >= len(API_KEYS):
        return False
    print(f"  >> Rotating to API key {current_key_idx + 1}/{len(API_KEYS)}")
    client = genai.Client(api_key=API_KEYS[current_key_idx])
    return True

EXCEL_PATH = r"C:\Cursor AI\public\database\RFIB\RFIB Final ver.xlsx"
IMG_DIR = r"C:\Cursor AI\public\database\RFIB\images"
TMP_DIR = r"C:\Cursor AI\_tmp"
FAILED_FILE = r"C:\Cursor AI\failed_thumbnails.json"

os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

try:
    with open(FAILED_FILE, "r") as f:
        failed_ids = set(json.load(f))
except FileNotFoundError:
    failed_ids = set()

df = pd.read_excel(EXCEL_PATH)

START_ROW = 0
END_ROW = len(df)

# --- Council Rubric ---
COUNCIL_RUBRIC = """
You are the Council Assessor. Assess this image against the following rubric.
The image is intended to be a thumbnail representing a reading text passage.

Criteria:
1. 2D Format Adherence: Must be strictly two-dimensional (no 3D renders/isometric simulation).
2. Brightness Level: Overall luminosity must be high (no dark/somber dominance).
3. Color Richness & Variety: Vibrant, diverse, and well-balanced color palette (avoid monochromatic/bland).
4. Friendly Tone: Warmth, approachability, positive/inviting demeanor.
5. Energetic Impression: Dynamism, vitality, lively.
6. Engaging Quality: Captures attention, clear focal point.
7. Visualized Main Points/Characters: Accurately represents the core subject matter or themes of the original text.
8. No Text Adherence: The image must absolutely not contain any text, letters, words, or typography. If there is any visible text, it must Fail.

Original text: "{full_text}"

You MUST output your response in JSON format exactly like:
{{
  "verdict": "Pass" or "Fail",
  "feedback": "Your detailed reasoning here, focusing on what criteria failed and actionable advice for the next generation if it failed."
}}
"""

def generate_thumbnail(prompt_text):
    """Generates an image using Gemini Image generation."""
    for attempt in range(3):
        try:
            print(f"    [Generation] Prompting imagen API...")
            result = client.models.generate_images(
                model='imagen-4.0-fast-generate-001',
                prompt=prompt_text,
                config=types.GenerateImagesConfig(
                    output_mime_type="image/png",
                    number_of_images=1,
                    aspect_ratio="1:1"
                )
            )
            for generated_image in result.generated_images:
                return generated_image.image.image_bytes
            return None
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if rotate_key():
                    continue
                else:
                    raise SystemExit("All API keys exhausted.")
            else:
                print(f"    [Generation Error] {e}")
                return None
    return None

def assess_thumbnail(image_bytes, full_text):
    """Assesses the image using the Gemini 2.5 Flash model."""
    for attempt in range(3):
        try:
            print(f"    [Council Assessment] Asking the Council...")
            response = client.models.generate_content(
                model="gemini-2.5-pro",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type='image/png'),
                    COUNCIL_RUBRIC.format(full_text=full_text)
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            response_text = response.text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_json = json.loads(response_text.strip())
            return response_json
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if rotate_key():
                    continue
                else:
                    raise SystemExit("All API keys exhausted.")
            else:
                print(f"    [Assessment Error] {e}")
                return {"verdict": "Fail", "feedback": f"API Assessment Error: {e}"}
    return {"verdict": "Fail", "feedback": "Max API retries for assessment reached."}

def run_batch():
    completed = 0
    skipped = 0
    failed = 0

    for idx in range(START_ROW, min(END_ROW, len(df))):
        row = df.iloc[idx]
        raw_id = str(row['ID']).split('.')[0]
        question_id = raw_id.zfill(4)

        if question_id in failed_ids:
            skipped += 1
            continue

        final_img_path = os.path.join(IMG_DIR, f"{question_id}.png")
        # forced regeneration: no os.path.exists check

        full_text = row.get('Full Text', '')
        if pd.isna(full_text) or str(full_text).strip() == "":
            continue

        print(f"\n--- Processing Row {idx} (ID: {question_id}) ---")
        
        passed = False
        # Extract visual concepts to prevent text generation
        try:
            concept_response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"Extract only the raw visual themes and objects from this text. Output a short comma-separated list (max 20 words). CRITICAL: Remove all proper nouns, names, and any references to signs, books, or writing: '{str(full_text)[:300]}'"
            )
            visual_concept = concept_response.text.strip()
        except:
            visual_concept = "abstract conceptual shapes"

        for attempt in range(1, 4):
            print(f"  Attempt {attempt}/3...")
            
            prompt_text = (
                "A clean, textless, minimalist 2D vector art flat illustration. "
                "Friendly, energetic, bright, colorful flat-art. Visual elements: "
                f"{visual_concept}. "
                "CRITICAL INSTRUCTION: Use only abstract or blank symbolic elements. DO NOT include any letters, words, numbers, or typography. NO TEXT whatsoever."
            )
            if attempt > 1 and council_feedback:
                prompt_text += f"\n\nCRITICAL FIXES NEEDED from previous attempt: {council_feedback}"

            # 1. Generate Image
            image_bytes = generate_thumbnail(prompt_text)
            if not image_bytes:
                print("  Failed to generate image. Skipping to next attempt.")
                council_feedback = "Image generation failed due to API error or content policy."
                continue
            
            # Temporary save for inspection if needed
            tmp_path = os.path.join(TMP_DIR, f"tmp_{question_id}_attempt{attempt}.png")
            with open(tmp_path, "wb") as f:
                f.write(image_bytes)

            # 2. Council Assessment
            assessment = assess_thumbnail(image_bytes, str(full_text))
            verdict = assessment.get("verdict", "Fail")
            feedback = assessment.get("feedback", "No feedback provided.")
            
            print(f"    -> Council Verdict: {verdict}")
            print(f"    -> Council Feedback: {str(feedback)[:150]}...")
            
            if verdict.lower() == "pass":
                passed = True
                last_image_bytes = image_bytes
                break
            else:
                council_feedback = feedback

        if passed and last_image_bytes:
            print(f"  ✅ SUCCESS! Saving thumbnail for {question_id}.")
            with open(final_img_path, "wb") as f:
                f.write(last_image_bytes)
            completed += 1
        else:
            print(f"  ❌ FAILED after 2 attempts for {question_id}.")
            failed_ids.add(question_id)
            with open(FAILED_FILE, "w") as f:
                json.dump(list(failed_ids), f, indent=4)
            failed += 1

    print(f"\n=== Batch complete: {completed} generated, {skipped} skipped, {failed} failed ===")

if __name__ == "__main__":
    run_batch()
