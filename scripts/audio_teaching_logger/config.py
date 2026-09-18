import os
import re
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output" / "teaching_sessions"

def load_env_file():
    """Load environment variables from .env file in root if present."""
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
        except Exception as e:
            print(f"[Config] Warning: Could not read .env: {e}")

load_env_file()

# Ollama settings for Pipeline B
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
_base_ollama_url = OLLAMA_URL.replace("/api/generate", "").replace("/api/chat", "").rstrip("/")
OLLAMA_EMBED_URL = f"{_base_ollama_url}/api/embed"
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

DEFAULT_LOCAL_MODELS = {
    "qwen": os.getenv("LOCAL_QWEN_MODEL", os.getenv("TEACHING_LOGGER_QWEN_MODEL", "qwen3:14b")),
    "deepseek": os.getenv("LOCAL_DEEPSEEK_MODEL", os.getenv("TEACHING_LOGGER_DEEPSEEK_MODEL", "deepseek-r1:14b")),
    "gemma": os.getenv("LOCAL_GEMMA_MODEL", os.getenv("TEACHING_LOGGER_GEMMA_MODEL", "gemma4:12b"))
}

# Gemini API settings for Pipeline A (100% Free Tier)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_GEMINI_MODEL = os.getenv("TEACHING_LOGGER_GEMINI_MODEL", "gemini-3.7-flash")
FALLBACK_GEMINI_MODELS = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.1-pro-preview"]

# 5-Part Pedagogical Schema Template for Teacher Pre-Class Briefing (Professional Pedagogical Bilingual)
PEDAGOGICAL_PROMPT_REQUIREMENTS = """
Bạn là một trợ lý sư phạm chuyên nghiệp đồng hành cùng Giáo viên dạy 1-1 tiếng Anh (IELTS/PTE/Academic English).
Nhiệm vụ của bạn là phân tích file ghi âm/transcript buổi dạy song ngữ Việt-Anh giữa Giáo viên và Học viên để tạo ra "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)".

YÊU CẦU VỀ GIỌNG ĐIỆU & VĂN PHONG (TIẾNG VIỆT SƯ PHẠM CHUYÊN NGHIỆP & CHUẨN XÁC):
- Sử dụng văn phong sư phạm chuẩn mực, súc tích, mạch lạc và mang tính ứng dụng thực tế cao (như sổ tay ghi chú giảng dạy của giáo viên chuyên nghiệp).
- KHÔNG dùng từ ngữ suồng sã, tiếng lóng hay văn nói quá đà (tránh: "gò tật", "huề vốn", "sượng trân", "đá nhau", "ổn áp").
- KHÔNG dùng văn phong dịch máy hoặc văn bản hành chính cứng nhắc (tránh câu rườm rà như: "Học viên được hướng dẫn chuyên sâu...", "Mang tính chất thừa thãi...").
- Diễn đạt khúc chiết, chỉ rõ bản chất ngôn ngữ và phương pháp sư phạm:
  + Ví dụ Recap: "Buổi học tập trung hoàn thiện kỹ năng liên kết câu đoạn (Lexical Cohesion) và tính mạch lạc trong bài viết. Trọng tâm là khắc phục xu hướng lạm dụng từ đồng nghĩa gượng ép, đồng thời chuẩn hóa cách phát triển ý theo cấu trúc Tổng - Phân (Hypernym - Hyponym) và lựa chọn từ vựng đúng ngữ cảnh."
  + Ví dụ Phân tích lỗi: "Chỉ rõ lỗi dư thừa thông tin (redundancy) và dùng sai thuật ngữ 'open spaces'. Khi đã diễn đạt xe lấp kín các làn đường, việc thêm mệnh đề đối lập trở nên thừa ý."
  + Ví dụ Sửa lỗi: "Giải thích sự khác biệt về sắc thái thời gian: 'bucket list' dùng cho mục tiêu cả cuộc đời, còn kế hoạch trong năm cần dùng 'wish list'."
- Giữ nguyên các thuật ngữ tiếng Anh chuyên môn, câu trích dẫn của học viên (quotes), collocations, quy tắc ngữ pháp và câu sửa mẫu bằng TIẾNG ANH.

Đầu ra là một "THẺ CHUẨN BỊ BÀI HỌC" hoàn chỉnh, giúp giáo viên đọc nhanh trong 60 giây trước khi bắt đầu buổi học tiếp theo.

Hãy xuất JSON chuẩn theo schema sau:
"""

ANALYSIS_JSON_SCHEMA = {
    "title": "Thẻ Chuẩn Bị Bài Học (Teacher's Pre-Class Briefing)",
    "lesson_summary": {
        "focus_skill": "Writing / Speaking / Reading / Listening / Grammar",
        "core_topic": "Tên chủ đề bài học chuẩn xác (VD: Academic Writing: Lexical Cohesion & Paragraph Logic)",
        "quick_recap_60s": "2-3 câu súc tích, chuẩn mực tóm tắt trọng tâm buổi dạy, khó khăn chính của học viên và mức độ tiến bộ để giáo viên nắm nhanh trước giờ lên lớp.",
        "student_readiness_level": "Đã Nắm Vững (Mastered) / Khá (Good) / Trung Bình (Developing) / Cần Củng Cố (Needs Reinforcement)"
    },
    "what_taught": [
        {
            "category": "Chiến Thuật / Từ Vựng / Ngữ Pháp / Phát Âm / Tính Liên Kết",
            "topic": "Tên khái niệm (kèm thuật ngữ Anh-Việt)",
            "key_rule": "Nguyên lý sư phạm / Quy tắc cốt lõi đã dạy (diễn đạt rõ ràng, chuẩn xác)",
            "examples": ["Ví dụ mục tiêu 1", "Ví dụ 2"]
        }
    ],
    "student_problems_and_solutions": [
        {
            "problem_id": "P1",
            "severity": "🔴 Nghiêm trọng / 🟡 Trung bình / 🟢 Nhẹ",
            "issue_summary": "Tên lỗi ngắn gọn, chuẩn xác",
            "student_error": "Trích dẫn nguyên văn câu/từ chưa chuẩn của học viên (English quote)",
            "teacher_fix": "Phân tích của giáo viên: Bản chất lỗi sai + Hướng dẫn sửa chuẩn xác",
            "student_outcome": "Đã Nắm Vững (Mastered) / Cải Thiện Một Phần (Partially Improved) / Cần Củng Cố Thêm (Needs Practice)",
            "outcome_evidence": "Bằng chứng ngắn từ phản hồi của học viên trong buổi học"
        }
    ],
    "next_lesson_briefing": {
        "warmup_quiz_questions": [
            "1-2 câu hỏi hoặc bài tập ngắn đầu giờ để kiểm tra nhanh mức độ ghi nhớ kiến thức của học viên"
        ],
        "teacher_followup_focus": [
            "Nội dung hoặc kỹ năng giáo viên cần tiếp tục theo dõi và củng cố trong buổi học tiếp theo"
        ],
        "student_homework_checklist": [
            "Nhiệm vụ bài tập về nhà cụ thể cần kiểm tra đầu giờ"
        ]
    }
}

# Mermaid Unified Prompt: single-pass generation of both mindmap and flowchart as JSON
MERMAID_UNIFIED_PROMPT = """
Bạn là một trợ lý trực quan hóa dữ liệu sư phạm song ngữ Việt-Anh chuyên nghiệp.

Từ dữ liệu JSON phân tích buổi dạy, hãy tạo ĐỒNG THỜI 2 sơ đồ Mermaid:
1. "mindmap": Sơ đồ Mindmap bao quát toàn bộ buổi học theo chuẩn Mermaid mindmap syntax:
   - Bắt đầu bằng: mindmap
   - Root: root(("Tên chủ đề bài học"))
   - Nhánh 1: 🎯 Kiến Thức Đã Dạy - Knowledge Taught (gồm category, topic, ví dụ tiêu biểu)
   - Nhánh 2: ⚠️ Lỗi Học Viên - Student Errors (gồm severity, problem_id, tên lỗi, quote sai ngắn, outcome)
   - Nhánh 3: 📋 Buổi Sau - Next Lesson Briefing (gồm Warmup Quiz, Teacher Followup, Homework)
   - KHÔNG dùng ký tự gây lỗi cú pháp Mermaid trong node: tránh (, ), [, ], {, }, #, &, ;, <, >, `, *, |
   - Giữ mỗi dòng súc tích (< 60 ký tự), thụt lề 2 spaces mỗi cấp.

2. "flowchart": Sơ đồ Flowchart luồng bài học theo chuẩn Mermaid graph TD syntax:
   - Bắt đầu bằng: graph TD
   - Luồng logic: Start (Chủ đề) --> Khái niệm 1 --> Khái niệm 2 ... --> Kế hoạch buổi sau --> Quiz / Bài tập
   - Tại các khái niệm có lỗi, liên kết nhánh lỗi (dùng :::critical cho 🔴, :::warning cho 🟡, :::success cho đã nắm vững, :::action cho hành động tiếp theo)
   - Luôn kèm classDef ở cuối:
     classDef critical fill:#ff6b6b,stroke:#c92a2a,color:#fff;
     classDef warning fill:#ffd43b,stroke:#e67700,color:#333;
     classDef success fill:#51cf66,stroke:#2b8a3e,color:#fff;
     classDef action fill:#74c0fc,stroke:#1864ab,color:#fff;

Hãy trả về DUY NHẤT một JSON Object chuẩn theo định dạng sau (KHÔNG thêm markdown wrapper bên ngoài):
{
  "mindmap": "mindmap\\n  root((\\"...\\"))\\n...",
  "flowchart": "graph TD\\n  START[\\"...\\"]\\n..."
}

JSON DATA:
"""

# Backwards compatible individual prompts
MERMAID_MINDMAP_PROMPT = """
Bạn là một trợ lý trực quan hóa dữ liệu sư phạm.

Từ dữ liệu JSON phân tích buổi dạy sau, hãy tạo MỘT sơ đồ Mermaid MINDMAP duy nhất.
Sơ đồ phải bao gồm:
1. Root = Chủ đề bài học (lesson_summary.core_topic)
2. Nhánh 1: 🎯 Kiến Thức Đã Dạy — liệt kê mỗi mục what_taught với category, topic, và 1-2 ví dụ tiêu biểu
3. Nhánh 2: ⚠️ Lỗi Học Viên — liệt kê mỗi student_problems_and_solutions với severity emoji, tên lỗi, student_error quote ngắn, và student_outcome
4. Nhánh 3: 📋 Buổi Sau — warmup quiz questions (rút gọn) + teacher followup focus + student homework

QUY TẮC MERMAID:
- Dùng cú pháp `mindmap` (KHÔNG dùng graph TD)
- Root node dùng ngoặc kép tròn: root(("Nội dung"))
- Các nhánh con dùng indentation (2 spaces mỗi cấp)
- KHÔNG dùng ký tự đặc biệt trong nội dung node: tránh (, ), [, ], {, }, #, &, ;, <, >, `, *, |
- Giữ mỗi node dưới 60 ký tự
- Dùng emoji ở đầu nhánh chính
- Viết song ngữ Việt-Anh tự nhiên
- Chỉ xuất ra block mermaid code thuần (bắt đầu bằng `mindmap`, KHÔNG bao bọc ```mermaid```)

JSON DATA:
"""

MERMAID_FLOWCHART_PROMPT = """
Bạn là một trợ lý trực quan hóa dữ liệu sư phạm.

Từ dữ liệu JSON phân tích buổi dạy sau, hãy tạo MỘT sơ đồ Mermaid FLOWCHART duy nhất thể hiện luồng giảng dạy:
- Bắt đầu từ Chủ đề bài học
- Đi qua từng khái niệm đã dạy (what_taught) theo thứ tự
- Tại mỗi khái niệm, phân nhánh nếu có lỗi học viên liên quan (student_problems_and_solutions)
- Kết thúc bằng các hành động buổi sau (next_lesson_briefing)

QUY TẮC MERMAID:
- Dùng cú pháp `graph TD` (top-down flowchart)
- Node ID dùng chữ viết tắt (A, B, C..., P1, P2..., N1, N2...)
- Label node dùng ngoặc vuông: A["Nội dung"]
- Dùng -->|label| cho mũi tên có chú thích
- Style severity: dùng :::critical cho 🔴, :::warning cho 🟡, :::success cho kết quả tốt
- Thêm classDef ở cuối: classDef critical fill:#ff6b6b,stroke:#c92a2a,color:#fff; classDef warning fill:#ffd43b,stroke:#e67700,color:#333; classDef success fill:#51cf66,stroke:#2b8a3e,color:#fff; classDef action fill:#74c0fc,stroke:#1864ab,color:#fff;
- Giữ mỗi label dưới 50 ký tự
- Viết song ngữ Việt-Anh tự nhiên
- Chỉ xuất ra block mermaid code thuần (bắt đầu bằng `graph TD`, KHÔNG bao bọc ```mermaid```)

JSON DATA:
"""

