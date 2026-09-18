import os
import sys
import time
import json
import re
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://localhost:11434/api/generate"

MODELS = [
    {"name": "qwen3:14b", "alias": "Qwen 2.5 14B"},
    {"name": "deepseek-r1:14b", "alias": "DeepSeek R1 14B"},
    {"name": "gemma4:12b", "alias": "Gemma 12B"}
]

AUDIT_SCRIPT = """
SCENE 1 (0:00 - 0:25):
"For most of us, working in a regular school felt safe.
You had a syllabus to follow, a principal to make the big decisions,
and if things went wrong, you didn't have to carry the blame alone.
That kind of structure makes sense when people are doing routine, repetitive work.
But teaching isn't like that."

SCENE 2 (0:25 - 0:55):
"When you try to build something creative, that old way of working starts getting in the way.
Every extra layer of approval slows things down.
You have a great idea for a lesson, but it sits in someone's inbox for two weeks waiting for a sign-off.
After a while, you stop trusting your own gut and just wait for permission.
You start worrying about looking busy or pleasing a supervisor,
instead of focusing on the student sitting right in front of you."

SCENE 3 (0:55 - 1:30):
"Work ends up feeling like a slow handoff between strangers.
One person writes an exercise alone, sends it away, waits days for feedback,
and by the time the audio gets recorded a month later, all the excitement is gone.
Even worse, when someone else dictates every detail, you can only build what that one manager thinks of.
And when a student doesn't understand the lesson, the old habit is to say, 'Well, the student just isn't trying.'
But we know better. If a student is confused, it's never their fault.
It just means our lesson wasn't clear enough."

SCENE 4 (1:30 - 2:00):
"So what happens when you step away from all that?
Without bosses, you don't get a mess—you get partners.
Two or three teachers sitting together around one table,
working through a tricky pronunciation sound in a single morning.
Nobody waiting for permission, nobody playing politics.
Just good teachers trusting each other, testing ideas with real students,
and closing our laptops at the end of the day feeling good about what we made."
"""

AUDIT_VISUALS = """
SCENE 1: An empty school corridor with closed classroom doors. A quiet teacher's desk with stacked textbooks, a red pen, and an evaluation sheet under ceiling lights. A teacher sitting alone, marking checkboxes. Quiet wall clock ticking, a stamp hitting paper, soft lonely piano.
SCENE 2: A teacher excitedly typing a lesson game on a laptop, hesitating, deleting it, and opening a formal approval form. Later, it's dark outside, and the teacher is still at the desk in an empty room, staring at an unread email waiting for an answer. Dim evening light, screen glow.
SCENE 3: Papers passed between separate desks. A red pen crossing out an idea. In a classroom, a student looks stressed staring at a dull worksheet. The teacher sits down next to the student, smiles, and gently slides the worksheet away. Soft morning light, gentle acoustic guitar.
SCENE 4: A bright, sunlit room with wooden tables. Three teachers sitting together at one screen, laughing and trying mouth shapes for tricky vowels. One listens with headphones and closed eyes. A real student tries the activity and smiles as it clicks. 3:15 PM, laptop closes calmly, teachers walk outside into afternoon sun.
"""

def unload_model(model_name):
    try:
        requests.post(OLLAMA_URL, json={"model": model_name, "keep_alive": 0}, timeout=5)
    except Exception:
        pass

def clean_response(raw: str) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL).strip()
    cleaned = re.sub(r"</?(no_)?think>", "", cleaned).strip()
    if cleaned.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    if not (cleaned.startswith("{") or cleaned.startswith("[")):
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    return cleaned

def audit_with_model(model_info):
    name = model_info["name"]
    alias = model_info["alias"]
    print(f"[*] Starting audit with {alias} ({name})...")
    
    prompt = f"""You are a strict editorial auditor and language coach for English teachers.
Evaluate the following 2-minute spoken video script and visual storyboard designed for English language educators.
The goal is 100% natural, warm, human language with ZERO corporate jargon, ZERO academic fluff, and ZERO unnatural metaphors.

SPOKEN SCRIPT:
{AUDIT_SCRIPT}

VISUAL STORYBOARD:
{AUDIT_VISUALS}

AUDIT INSTRUCTIONS:
1. Jargon & Buzzword Check: Identify ANY remaining corporate, academic, or unnatural words (e.g. silos, vetoes, paradigms, bottlenecks, assemblies, transactional terms).
2. Spoken Naturalness: Rate how natural, warm, and authentic this script sounds when spoken aloud by an English teacher (Score 1-100).
3. Visual Groundedness: Rate whether the visual scenes feel authentic to real teachers and classrooms rather than stock footage (Score 1-100).
4. Concrete Recommendations: Any subtle phrase tweaks to make it even more natural.

Respond ONLY with valid JSON in this exact structure:
{{
  "model": "{alias}",
  "jargon_free": true,
  "flagged_words": [],
  "spoken_naturalness_score": 95,
  "visual_groundedness_score": 95,
  "verdict": "PASS",
  "critique": "Your concise assessment of the tone, flow, and authenticity",
  "recommended_tweaks": ["Specific tweak 1", "Specific tweak 2"]
}}
"""
    if "qwen" in name.lower():
        prompt = "/no_think\n\n" + prompt

    payload = {
        "model": name,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 1200,
            "num_ctx": 4096
        }
    }
    if not any(r in name.lower() for r in ["deepseek-r1", "-r1", "/r1", "reasoner", "qwq"]):
        payload["think"] = False
    if "qwen" not in name.lower():
        payload["format"] = "json"

    try:
        t0 = time.time()
        resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
        dur = time.time() - t0
        if resp.status_code == 200:
            raw = resp.json().get("response", "")
            cleaned = clean_response(raw)
            try:
                data = json.loads(cleaned)
                data["response_time_sec"] = round(dur, 2)
                data["status"] = "SUCCESS"
                print(f"[+] {alias} completed in {round(dur, 2)}s with verdict: {data.get('verdict')}")
                return data
            except Exception as pe:
                return {"model": alias, "status": "PARSE_ERROR", "raw": raw[:200], "error": str(pe)}
        else:
            return {"model": alias, "status": "HTTP_ERROR", "code": resp.status_code, "text": resp.text[:200]}
    except Exception as e:
        return {"model": alias, "status": "EXCEPTION", "error": str(e)}
    finally:
        unload_model(name)

def main():
    print("=== STARTING 3 LOCAL LLM AUDIT ===")
    out_file = r"c:\Cursor AI\docs\audit_hierarchy_video_3llm_report.json"
    results = []
    existing = {}
    if os.path.exists(out_file):
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
                for item in saved:
                    if item.get("status") == "SUCCESS" and item.get("verdict"):
                        existing[item.get("model")] = item
        except Exception:
            pass

    for m in MODELS:
        alias = m["alias"]
        if alias in existing:
            print(f"[=] Reusing existing valid audit for {alias}")
            results.append(existing[alias])
        else:
            res = audit_with_model(m)
            results.append(res)
            time.sleep(2)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n[+] Audit results saved to {out_file}")

if __name__ == "__main__":
    main()
