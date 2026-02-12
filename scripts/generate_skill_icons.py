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
API_KEY_STUDIO = "AIzaSyAc5K9UirxaZcP52JiGb1TE33HQ9MLgloY"

# Model Selection
MODEL_ID_STUDIO = "gemini-3-pro-image-preview"

# Output & Reference
OUTPUT_DIR = "public/assets/skill-icons/custom"
REFERENCE_IMAGE_PATH = "public/assets/skill-icons/variations_vault_retro/vault_retro_v1.png"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load the reference image once
print(f"Loading reference image: {REFERENCE_IMAGE_PATH}")
REFERENCE_IMAGE = Image.open(REFERENCE_IMAGE_PATH)
print(f"  Reference image loaded: {REFERENCE_IMAGE.size}")

# Character description (Vault Boy Retro)
CHARACTER_DESC = "The character in the attached reference image is a Vault Boy style mascot with JET BLACK hair (not blonde) and wearing a vibrant EMERALD GREEN body suit with yellow trim. He has a hyper-positive, winking expression with large expressive eyes. Keep his appearance EXACTLY the same as the reference image, especially the winking and eye details."

# Style suffix
STYLE_SUFFIX = "1950s atomic age retro-cartoon animation style, Fallout Vault Boy aesthetic, vector art, thick bold outline, cell shaded, high contrast, vibrant green and yellow colors, funny happy deterministic positive expression, winning smile, solid white background, no text, no UI border. High quality 2D illustration."

# Full Skill Prompt Library
# Each prompt describes the ACTION/SCENE. The character reference is injected automatically.
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

    # Reading Branch
    {"id": "dict_peek", "action": "hiding behind an oversized dictionary book, peeking curiously from the side with one eye showing, looking at the viewer."},
    {"id": "evidence_highlight", "action": "as a detective pointing a bright yellow flashlight at a specific word on a giant page."},
    {"id": "summary_scroll", "action": "holding a tiny, short golden scroll while standing on top of a mountain of thousands of books."},

    # Writing Branch
    {"id": "hint_wc", "action": "counting on a wooden abacus where the beads are floating colorful letters."},
    {"id": "hint_fl", "action": "as a magician pulling a giant rabbit (which is shaped like the letter 'A') out of a top hat."},
    {"id": "punct_ghost", "action": "high-fiving a friendly glowing ghost character that is shaped exactly like a comma."},

    # Speaking Branch
    {"id": "pron_rune", "action": "holding a glowing rune stone with a mouth symbol, focused on correct pronunciation, ensuring eyes match reference."},
    {"id": "shadow_mode", "action": "speaking into a desk microphone, with a semi-transparent 'ghostly echo' of himself standing right behind him, copying his pose and expression exactly. Both have visible sound waves radiating from their mouths."},
    {"id": "second_take", "action": "jumping in the air with excitement while holding a movie clapperboard that says 'Take 2!', high energy pose."},
]


def build_prompt(skill):
    """Build the full text prompt for a skill, combining character desc + action + style."""
    return f"Generate an image of BEL 'The Professor' (the character shown in the attached reference image). {CHARACTER_DESC}\n\nScene: BEL is {skill['action']}.\n\nStyle: {STYLE_SUFFIX}"


def generate_with_reference(skill):
    """Generate an icon using the reference image + text prompt via Gemini multimodal API."""
    print(f"  Trying AI Studio (with reference image)...")
    client = genai.Client(api_key=API_KEY_STUDIO)
    
    prompt_text = build_prompt(skill)
    
    try:
        # Send both the reference image AND the text prompt
        response = client.models.generate_content(
            model=MODEL_ID_STUDIO,
            contents=[REFERENCE_IMAGE, prompt_text],
            config=GenerateContentConfig(response_modalities=[Modality.TEXT, Modality.IMAGE]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return Image.open(BytesIO(part.inline_data.data))
        print(f"    No image in response")
        return None
    except Exception as e:
        print(f"    AI Studio Error: {e}")
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
    """Main entry point to generate an icon with fallbacks and post-processing."""
    file_path = os.path.join(OUTPUT_DIR, f"{skill['id']}.png")
    # If the file exists and we are not doing a specific skill, skip
    if os.path.exists(file_path) and not os.environ.get("OVERWRITE"):
        print(f"Skipping {skill['id']} (exists). Set OVERWRITE=1 to regenerate.")
        return True

    print(f"Generating: {skill['id']}...")
    
    # Try up to 2 times
    for attempt in range(2):
        if attempt > 0:
            print(f"  Retry attempt {attempt + 1}...")
            time.sleep(3)
        
        image = generate_with_reference(skill)
        if image:
            # Post-process: Remove background
            image = make_transparent(image)
            image.save(file_path)
            print(f"  SUCCESS Saved -> {file_path}")
            return True
    
    print(f"  ALL ATTEMPTS FAILED for {skill['id']}")
    return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Limit number of icons to generate")
    parser.add_argument("--skill", type=str, default=None, help="Generate only a specific skill by ID")
    args = parser.parse_args()
    
    count = 0
    for skill in SKILLS:
        if args.skill and skill['id'] != args.skill:
            continue
        if args.limit and count >= args.limit:
            break
        
        if generate_icon(skill):
            count += 1
            time.sleep(2)  # Rate limiting between successful generations
    
    print(f"\nDone! Generated {count} icons.")
