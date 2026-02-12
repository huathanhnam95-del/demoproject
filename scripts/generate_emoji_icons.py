import os

# Output Directory
OUTPUT_DIR = "public/assets/skill-icons/custom"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Skill to Emoji/Color Mapping
SKILLS = {
    # Listening
    "slow_audio": {"emoji": "🐢", "color": "#4ade80", "bg": "#dcfce7"}, # Green Turtle
    "echo_loop": {"emoji": "🦜", "color": "#facc15", "bg": "#fef9c3"}, # Parrot
    "chunking": {"emoji": "🔪", "color": "#60a5fa", "bg": "#dbeafe"}, # Knife/Chop

    # Reading
    "dict_peek": {"emoji": "👁️", "color": "#a78bfa", "bg": "#ede9fe"}, # Eye
    "evidence_highlight": {"emoji": "🔍", "color": "#facc15", "bg": "#fef9c3"}, # Magnifying Glass
    "summary_scroll": {"emoji": "📜", "color": "#fbbf24", "bg": "#fef3c7"}, # Scroll

    # Writing
    "hint_wc": {"emoji": "🧮", "color": "#f87171", "bg": "#fee2e2"}, # Abacus
    "hint_fl": {"emoji": "🎩", "color": "#818cf8", "bg": "#e0e7ff"}, # Magician Hat
    "punct_ghost": {"emoji": "👻", "color": "#94a3b8", "bg": "#f1f5f9"}, # Ghost

    # Speaking
    "pron_rune": {"emoji": "👄", "color": "#fbbf24", "bg": "#fffbeb"}, # Mouth
    "shadow_mode": {"emoji": "🥷", "color": "#1e293b", "bg": "#cbd5e1"}, # Ninja
    "second_take": {"emoji": "🎬", "color": "#f472b6", "bg": "#fce7f3"}, # Clapperboard
}

def generate_svg(skill_id, data):
    emoji = data["emoji"]
    color = data["color"]
    bg = data["bg"]
    
    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="4" stdDeviation="3" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="5" y="5" width="90" height="90" rx="20" fill="{bg}" stroke="{color}" stroke-width="4" filter="url(#shadow)" />
  <circle cx="50" cy="50" r="35" fill="white" opacity="0.6" />
  <text x="50" y="65" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="50" text-anchor="middle" dominant-baseline="middle">{emoji}</text>
</svg>"""
    
    file_path = os.path.join(OUTPUT_DIR, f"{skill_id}.svg")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Generated {file_path}")

if __name__ == "__main__":
    print("Generating Emoji SVG Icons...")
    for skill_id, data in SKILLS.items():
        generate_svg(skill_id, data)
    print("Done!")
