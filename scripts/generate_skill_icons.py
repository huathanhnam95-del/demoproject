import os
import time
import requests
import base64
import argparse
from io import BytesIO
from google import genai
from google.genai.types import GenerateContentConfig, Modality, Part
from PIL import Image

# --- CONFIGURATION ---
# Corrected Keys based on user context
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"
API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
PROJECT_ID = "gen-lang-client-0677756745"

# Model Selection
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"  # Layer 1: Nano Banana Pro
MODEL_ID_VERTEX_FLASH = "gemini-2.5-flash-lite" # Layer 2
MODEL_ID_VERTEX_IMAGEN = "imagen-4.0-generate-preview-06-06" # Layer 3

# Output & Reference
OUTPUT_DIR = "public/assets/skill-icons/custom"
REFERENCE_IMAGE_PATH = "public/assets/skill-icons/variations_vault_retro/vault_retro_v1.png"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load the reference image once
if os.path.exists(REFERENCE_IMAGE_PATH):
    print(f"Loading reference image: {REFERENCE_IMAGE_PATH}")
    REFERENCE_IMAGE = Image.open(REFERENCE_IMAGE_PATH)
    print(f"  Reference image loaded: {REFERENCE_IMAGE.size}")
else:
    print(f"WARNING: Reference image not found at {REFERENCE_IMAGE_PATH}. Generation might be less consistent.")
    REFERENCE_IMAGE = None

# Character description (Vault Boy Retro)
CHARACTER_DESC = "The character in the attached reference image is a Vault Boy style mascot with JET BLACK hair (not blonde) and wearing a vibrant EMERALD GREEN body suit with yellow trim. He has a hyper-positive, winking expression with large expressive eyes. Keep his appearance EXACTLY the same as the reference image, especially the winking and eye details."

# Style suffix
STYLE_SUFFIX = "1950s atomic age retro-cartoon animation style, Fallout Vault Boy aesthetic, vector art, thick bold outline, cell shaded, high contrast, vibrant green and yellow colors, funny happy deterministic positive expression, winning smile, solid white background, no text, no UI border. High quality 2D illustration, 512x512 resolution."

# Full Skill Prompt Library
SKILLS = [
    # --- CORE SKILLS (4 Roots) ---
    {"id": "root_listening", "action": "wearing large vintage headphones and giving a big thumbs up."},
    {"id": "root_writing", "action": "holding a giant quill and writing on a large parchment scroll."},
    {"id": "root_reading", "action": "sitting and reading a giant oversized dictionary, holding the book correctly with both hands, happy expression."},
    {"id": "root_speaking", "action": "standing confidently in front of a vintage radio microphone, mouth open as if singing or speaking."},
    
    # Listening Branch
    {"id": "slow_audio", "action": "relaxed next to a melting clock (Salvador Dali style), leaning back comfortably."},
    {"id": "echo_loop", "action": "listening to sound waves emanating from a glowing circular icon with loop arrows, look of curiosity, NO parrots."},
    {"id": "chunking", "action": "using a giant kitchen cleaver to chop a long 'Sentence' scroll into small cubes."},
    {"id": "transcript_glimpse", "action": "depict a scrying mirror or crystal lens with blue mist and a brief glowing rune-line appearing inside it."},
    {"id": "streak_shield", "action": "depict a blue warded aegis crest guarding a small flame/chain emblem."},
    {"id": "frugal_listener_1", "action": "depict a warm golden coin charm stamped with an ear/ripple rune."},
    {"id": "audio_engineer", "action": "depict a gold tuning fork relic emitting symmetrical resonance rings."},
    {"id": "frugal_listener_2", "action": "depict an upgraded coin charm, ear/ripple rune stronger, with radiant bloom."},
    {"id": "transcript_permit", "action": "depict a gold-stamped parchment permit with a wax seal and radiant glow."},
    {"id": "clean_streak_saver", "action": "depict a golden vial or medal holding captured lightning."},
    {"id": "frugal_listener_3", "action": "depict a crowned gold coin with ear/ripple rune, ornate filigree."},
    
    # Writing Branch
    {"id": "hint_wc", "action": "counting on a wooden abacus where the beads are floating colorful letters."},
    {"id": "hint_fl", "action": "as a magician pulling a giant rabbit (which is shaped like the letter 'A') out of a top hat."},
    {"id": "hint_reveal", "action": "depict a forbidden grimoire with a broken clasp, releasing a bright blue-white beam."},
    {"id": "punct_ghost", "action": "high-fiving a friendly glowing ghost character that is shaped exactly like a comma."},
    {"id": "typo_shield", "action": "depict a small shield talisman with a blue barrier aura and a single visible scratch marks."},
    {"id": "frugal_writer_1", "action": "depict a warm gold seal coin half-dipped in ink, with quill engraving."},
    {"id": "hint_kit", "action": "depict a leather satchel spilling rune note cards with warm golden glow."},
    {"id": "frugal_writer_2", "action": "depict an ornate gold quill-seal coin with radiant aura."},
    {"id": "coupon_book", "action": "depict a small coupon tome with glowing tabs and warm gold light."},
    {"id": "combo_coupon", "action": "depict two golden tickets crossed like blades."},
    {"id": "frugal_writer_3", "action": "depict a royal signet ring stamping a glowing wax seal."},

    # Reading Branch
    {"id": "dict_peek", "action": "hiding behind an oversized dictionary book, peeking curiously from the side with one eye showing, looking at the viewer."},
    {"id": "time_freeze", "action": "depict a clock or hourglass partially frozen in ice with blue frost aura."},
    {"id": "evidence_highlight", "action": "as a detective pointing a bright yellow flashlight at a specific word on a giant page."},
    {"id": "summary_scroll", "action": "holding a tiny, short golden scroll while standing on top of a mountain of thousands of books."},
    {"id": "frugal_reader_1", "action": "depict a warm golden coin pierced by a ribbon bookmark."},
    {"id": "mode_license_watch", "action": "depict an eye sigil inside a frame-like charm with warm gold glow."},
    {"id": "frugal_reader_2", "action": "depict a gold magnifier gem with radiant aura."},
    {"id": "no_reveal_rebate", "action": "depict a gold coin arcing back into a pouch with a warm glow trail."},
    {"id": "mode_license_extended", "action": "depict a library/archive permit with a glowing gold stamp seal."},
    {"id": "frugal_reader_3", "action": "depict an ornate golden lens with maximum polish and radiant bloom."},

    # Speaking Branch
    {"id": "pron_rune", "action": "holding a glowing rune stone with a mouth symbol, focused on correct pronunciation, ensuring eyes match reference."},
    {"id": "shadow_mode", "action": "speaking into a desk microphone, with a semi-transparent 'ghostly echo' of himself standing right behind him, copying his pose and expression exactly. Both have visible sound waves radiating from their mouths."},
    {"id": "second_take", "action": "jumping in the air with excitement while holding a movie clapperboard that says 'Take 2!', high energy pose."},
    {"id": "frugal_speaker_1", "action": "depict a warm golden coin engraved with a wind spiral."},
    {"id": "breath_control", "action": "depict a gold wind totem charm emitting airflow trails."},
    {"id": "frugal_speaker_2", "action": "depict an ornate gold coin with wind swirl and resonance lines."},
    {"id": "second_take_insurance", "action": "depict a gold shield protecting a microphone relic."},
    {"id": "mode_license_speak", "action": "depict a charter scroll with a mouth seal emblem."},
    {"id": "frugal_speaker_3", "action": "depict a crowned crystal gem with wind/voice rune."}
]

def build_prompt(skill):
    """Build the full text prompt for a skill, combining character desc + action + style."""
    return f"Generate an image of BEL 'The Professor' (the character shown in the attached reference image). {CHARACTER_DESC}\n\nScene: BEL is {skill['action']}.\n\nStyle: {STYLE_SUFFIX}"


def generate_via_studio(skill):
    """Layer 1: AI Studio (Gemini 3 Pro Image)"""
    print(f"  Trying Layer 1: AI Studio ({MODEL_ID_STUDIO})...")
    client = genai.Client(api_key=API_KEY_STUDIO)
    prompt_text = build_prompt(skill)
    
    contents = [prompt_text]
    if REFERENCE_IMAGE:
        contents.insert(0, REFERENCE_IMAGE)

    try:
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=contents,
            config=GenerateContentConfig(response_modalities=[Modality.TEXT, Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return Image.open(BytesIO(part.inline_data.data))
        print(f"    No image in Studio response")
        return None
    except Exception as e:
        print(f"    AI Studio Error: {e}")
        return None


def generate_via_vertex_flash(skill):
    """Layer 2: Vertex AI (Gemini 2.5 Flash Lite)"""
    print(f"  Trying Layer 2: Vertex Flash ({MODEL_ID_VERTEX_FLASH})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_FLASH}:generateContent?key={API_KEY_VERTEX}"
    
    prompt_text = build_prompt(skill)
    
    # Vertex payload construction (Text only for simplicity/robustness, or Multimodal if needed)
    # For now, we'll try Text-only if Reference Image is tricky via REST, 
    # but Gemini Flash DOES support multimodal.
    # Let's try sending the image as inline data if available.
    
    parts = [{"text": prompt_text}]
    
    if REFERENCE_IMAGE:
        # Convert PIL image to base64
        buffered = BytesIO()
        REFERENCE_IMAGE.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        parts.insert(0, {
            "inlineData": {
                "mimeType": "image/png",
                "data": img_str
            }
        })

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "image/png"}
    }
    
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "candidates" in res_json:
            for part in res_json["candidates"][0]["content"]["parts"]:
                if "inlineData" in part:
                    img_data = base64.b64decode(part["inlineData"]["data"])
                    return Image.open(BytesIO(img_data))
        # print(f"    Vertex Flash Response: {res_json}") # Debug
        return None
    except Exception as e:
        print(f"    Vertex Flash Error: {e}")
        return None


def generate_via_vertex_imagen(skill):
    """Layer 3: Vertex AI (Imagen 4.0)"""
    print(f"  Trying Layer 3: Imagen 4.0 ({MODEL_ID_VERTEX_IMAGEN})...")
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX_IMAGEN}:predict?key={API_KEY_VERTEX}"
    
    # Imagen 3/4 typically takes a "prompt" text field in instances.
    # Reference images are more complex. We will use TEXT ONLY for Imagen fallback to ensure it works.
    prompt_text = build_prompt(skill)
    
    payload = {
        "instances": [{"prompt": prompt_text}],
        "parameters": {
            "sampleCount": 1,
            "aspectRatio": "1:1"
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=90)
        res_json = response.json()
        if "predictions" in res_json:
            img_b64 = res_json["predictions"][0]["bytesBase64Encoded"]
            image_data = base64.b64decode(img_b64)
            return Image.open(BytesIO(image_data))
        else:
            print(f"    Imagen Error: {res_json}")
            return None
    except Exception as e:
        print(f"    Imagen Exception: {e}")
        return None


def make_transparent(img):
    """Convert solid white background to transparent."""
    img = img.convert("RGBA")
    datas = img.getdata()
    new_data = []
    for item in datas:
        # If it's very close to white, make it transparent
        if item[0] > 245 and item[1] > 245 and item[2] > 245:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
    img.putdata(new_data)
    return img


def generate_icon(skill):
    """Main generation loop with 3-layer fallback."""
    file_path = os.path.join(OUTPUT_DIR, f"{skill['id']}.png")
    
    # Check if exists
    if os.path.exists(file_path) and not getattr(args, 'overwrite', False) and not os.environ.get("OVERWRITE"):
        print(f"Skipping {skill['id']} (exists).")
        return True

    print(f"\nGenerating: {skill['id']} ({skill['action']})...")
    
    image = None
    
    # Layer 1
    image = generate_via_studio(skill)
    
    # Layer 2
    if not image:
        image = generate_via_vertex_flash(skill)
        
    # Layer 3
    if not image:
        image = generate_via_vertex_imagen(skill)
        
    if image:
        # Post-process
        image = make_transparent(image)
        image.save(file_path)
        print(f"  SUCCESS -> Saved to {file_path}")
        return True
    else:
        print(f"  FAILED -> All 3 providers exhausted for {skill['id']}")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Limit number of icons to generate")
    parser.add_argument("--skill", type=str, default=None, help="Generate only a specific skill by ID")
    parser.add_argument("--overwrite", action="store_true", help="Force regeneration of icons")
    args = parser.parse_args()
    
    count = 0
    for skill in SKILLS:
        if args.skill and skill['id'] != args.skill:
            continue
        if args.limit and count >= args.limit:
            break
        
        if generate_icon(skill):
            count += 1
            # Rate limiting
            time.sleep(2)
    
    print(f"\nDone! Generated {count} icons.")
