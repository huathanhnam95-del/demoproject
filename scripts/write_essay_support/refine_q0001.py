#!/usr/bin/env python3
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

PACK_DIR = 'public/database/Write Essay/support/v1/packs'
MANIFEST_PATH = 'public/database/Write Essay/support/v1/manifest.json'

# Find current q0001 file
q0001_files = [f for f in os.listdir(PACK_DIR) if f.startswith('q0001.') and f.endswith('.json')]
if not q0001_files:
    raise FileNotFoundError("Could not find q0001 pack file")
current_pack_file = os.path.join(PACK_DIR, q0001_files[0])

with open(current_pack_file, 'r', encoding='utf-8') as f:
    pack = json.load(f)

# 1. hardVocabulary
pack['common']['hardVocabulary'] = [
    {
        "term": "interferes",
        "enGloss": "obstructs, hinders, or negatively disrupts a natural process",
        "viGloss": "gây cản trở, làm gián đoạn hoặc tác động tiêu cực đến"
    },
    {
        "term": "learning",
        "enGloss": "the personal acquisition of knowledge, critical understanding, and inquiry",
        "viGloss": "quá trình tiếp thu và tự khám phá tri thức"
    },
    {
        "term": "education",
        "enGloss": "formal schooling, standardized curricula, and institutional instruction",
        "viGloss": "hệ thống giáo dục và trường lớp chính quy"
    },
    {
        "term": "Einstein",
        "enGloss": "Albert Einstein, theoretical physicist who critiqued rigid schooling",
        "viGloss": "nhà bác học Albert Einstein"
    },
    {
        "term": "correct",
        "enGloss": "accurate, valid, and well-founded in observation or reasoning",
        "viGloss": "đúng đắn, xác đáng và có cơ sở thực tiễn"
    }
]

# 2. requirements
pack['common']['requirements'] = [
    {
        "id": "answer",
        "required": True,
        "en": "State how far you agree or disagree.",
        "vi": "Nêu rõ mức độ đồng ý hoặc không đồng ý."
    },
    {
        "id": "reasons",
        "required": True,
        "en": "Support your position with two clear reasons.",
        "vi": "Bảo vệ quan điểm bằng 2 lý do rõ ràng."
    },
    {
        "id": "examples",
        "required": True,
        "en": "Use relevant examples when they strengthen an idea.",
        "vi": "Sử dụng các dẫn chứng thực tế thuyết phục để củng cố luận điểm."
    }
]

# 3. faq
pack['common']['faq'] = [
    {
        "questionEn": "What is this question asking?",
        "questionVi": "Đề này đang hỏi điều gì?",
        "answerEn": "Break the prompt into its direct requirements before choosing ideas.",
        "answerVi": "Hãy phân tích đề thành các vế yêu cầu cụ thể trước khi chọn hướng viết."
    },
    {
        "questionEn": "How many main ideas should I use?",
        "questionVi": "Tôi nên dùng bao nhiêu ý chính?",
        "answerEn": "Use two developed points with explanation and relevant examples.",
        "answerVi": "Dùng hai luận điểm trọng tâm, được phát triển bằng giải thích và ví dụ cụ thể."
    },
    {
        "questionEn": "Can I use a personal example?",
        "questionVi": "Tôi có thể dùng ví dụ cá nhân không?",
        "answerEn": "Yes, if it directly supports the point and remains relevant to the prompt.",
        "answerVi": "Có, nếu ví dụ hỗ trợ trực tiếp cho luận điểm và bám sát chủ đề bài viết."
    },
    {
        "questionEn": "What should I avoid?",
        "questionVi": "Tôi nên tránh điều gì?",
        "answerEn": "Avoid memorised general sentences and any idea that does not answer the task.",
        "answerVi": "Tránh dùng các câu văn mẫu học thuộc lòng chung chung và các ý lạc đề."
    }
]

# 4. common.angles deduplication (Agree 6 title)
if len(pack.get('common', {}).get('angles', [])) > 5:
    pack['common']['angles'][5]['titleVi'] = "Dập tắt hứng thú học tập"
    pack['common']['angles'][5]['pointVi'] = "Bài tập bắt buộc và cách đánh giá ép buộc khiến việc học trở thành nghĩa vụ, làm mất đi hứng thú học tập suốt đời."
    pack['common']['angles'][5]['vi'] = "Dập tắt hứng thú: Bài tập bắt buộc và cách đánh giá ép buộc khiến việc học trở thành nghĩa vụ, làm mất đi hứng thú học tập suốt đời."

# 5. Collocations for all 3 levels
refined_collocations = [
    {
        "term": "rote memorization",
        "enGloss": "Learning facts or information through repetition without deep comprehension.",
        "viGloss": "Học vẹt máy móc, chỉ nhớ tạm thời mà không hiểu bản chất vấn đề."
    },
    {
        "term": "intellectual curiosity",
        "enGloss": "A genuine, active desire to explore concepts and discover truth independently.",
        "viGloss": "Trí tò mò ham học hỏi và niềm say mê tự khám phá tri thức."
    },
    {
        "term": "standardized testing",
        "enGloss": "Uniform, rigid examinations that often reward memorization over critical creativity.",
        "viGloss": "Thi cử chuẩn hóa, dễ khiến học sinh học đối phó thay vì tư duy sáng tạo."
    },
    {
        "term": "critical inquiry",
        "enGloss": "Disciplined habit of methodically questioning premises, evidence, and assumptions.",
        "viGloss": "Tư duy phản biện và tinh thần chủ động truy vấn, phân tích vấn đề."
    }
]

refined_vocab = [
    {
        "term": "rote memorization",
        "collocation": "rely on rote memorization",
        "level": "B2",
        "meaningEn": "learning factual details through repetition rather than understanding the underlying concepts",
        "meaningVi": "học vẹt, chỉ ghi nhớ máy móc thay vì thấu hiểu bản chất",
        "example": "Over-reliance on rote memorization prevents students from applying theoretical knowledge to unfamiliar real-world problems.",
        "exampleVi": "Việc quá phụ thuộc vào học vẹt khiến học sinh khó vận dụng kiến thức lý thuyết vào các tình huống thực tế mới lạ."
    },
    {
        "term": "intellectual curiosity",
        "collocation": "stimulate intellectual curiosity",
        "level": "B2",
        "meaningEn": "a passionate desire to learn, explore, and question fundamental principles",
        "meaningVi": "trí tò mò ham học hỏi và khao khát khám phá chân lý",
        "example": "Einstein believed that formal academic curricula frequently extinguish the delicate spark of intellectual curiosity in young learners.",
        "exampleVi": "Einstein tin rằng chương trình học gò bó thường dập tắt tính tò mò và niềm say mê tìm tòi tự nhiên của học sinh."
    },
    {
        "term": "standardized curriculum",
        "collocation": "rigid standardized curriculum",
        "level": "B2",
        "meaningEn": "a uniform course of study mandated across all schools regardless of individual student aptitudes",
        "meaningVi": "chương trình khung áp dụng đồng loạt cho mọi học sinh",
        "example": "A rigid standardized curriculum treats students as identical components rather than cultivating their unique creative capabilities.",
        "exampleVi": "Chương trình học chuẩn hóa quá cứng nhắc dễ xem học sinh như những khuôn mẫu giống nhau thay vì nuôi dưỡng năng khiếu riêng."
    },
    {
        "term": "holistic education",
        "collocation": "embrace holistic education",
        "level": "C1",
        "meaningEn": "an educational philosophy focusing on the complete intellectual, emotional, and social development of a person",
        "meaningVi": "giáo dục toàn diện cả về trí tuệ, cảm xúc lẫn kỹ năng sống",
        "example": "Advocates argue that progressive institutions must embrace holistic education to balance academic knowledge with character formation.",
        "exampleVi": "Các chuyên gia khẳng định nhà trường cần áp dụng mô hình giáo dục toàn diện để cân bằng giữa kiến thức học thuật và bồi dưỡng nhân cách."
    },
    {
        "term": "critical inquiry",
        "collocation": "foster critical inquiry",
        "level": "C1",
        "meaningEn": "the practice of methodically analyzing, questioning, and evaluating claims rather than accepting them passively",
        "meaningVi": "tư duy phản biện và tinh thần chủ động đặt câu hỏi",
        "example": "True scholarship begins when classrooms encourage critical inquiry instead of demanding unquestioning obedience to textbooks.",
        "exampleVi": "Học thuật thực thụ chỉ bắt đầu khi lớp học khuyến khích học sinh phản biện thay vì đòi hỏi sự tuân phục một chiều."
    },
    {
        "term": "pedagogical rigidity",
        "collocation": "suffer from pedagogical rigidity",
        "level": "C1",
        "meaningEn": "inflexible teaching methods that stifle adaptation and diverse learning styles",
        "meaningVi": "phương pháp giảng dạy cứng nhắc, thiếu linh hoạt",
        "example": "Einstein's primary grievance was rooted in pedagogical rigidity, which punished nonconformist students for asking challenging questions.",
        "exampleVi": "Điều khiến Einstein bức xúc nhất là phương pháp dạy học cứng nhắc, trừng phạt học sinh chỉ vì dám đặt ra những câu hỏi gai góc."
    },
    {
        "term": "autonomous learning",
        "collocation": "promote autonomous learning",
        "level": "B2",
        "meaningEn": "self-directed study driven by personal interest and independent research",
        "meaningVi": "tự học độc lập xuất phát từ đam mê cá nhân",
        "example": "The digital era empowers autonomous learning, allowing individuals to acquire specialized skills far beyond institutional boundaries.",
        "exampleVi": "Thời đại số mở ra nhiều cơ hội tự học, giúp người học phát triển các kỹ năng chuyên sâu ngoài khuôn khổ trường lớp."
    },
    {
        "term": "academic conformity",
        "collocation": "discourage academic conformity",
        "level": "C1",
        "meaningEn": "pressuring students to align strictly with standard institutional viewpoints and conventions",
        "meaningVi": "sự gò ép học sinh phải tuân theo các quan điểm và khuôn mẫu sẵn có",
        "example": "Groundbreaking discoveries emerge from daring hypothesis testing, whereas academic conformity merely reinforces existing paradigms.",
        "exampleVi": "Những phát minh đột phá luôn bắt nguồn từ sự dám thử nghiệm, trong khi lối dạy gò ép theo khuôn mẫu chỉ củng cố những định kiến cũ."
    }
]

refined_grammar = [
    {
        "id": "q1-complex-1",
        "patternName": "Complex Concession (Although / While)",
        "band": "B2",
        "focus": "Thừa nhận giá trị của giáo dục chính quy nhưng nhấn mạnh mặt trái đối với óc sáng tạo.",
        "patternEn": "While formal education delivers indispensable foundational literacy, it frequently stifles the autonomous curiosity essential for genuine innovation.",
        "patternVi": "Mặc dù trường học trang bị nền tảng học vấn quan trọng, chương trình gò bó thường làm thui chột tính tò mò cần thiết cho sự sáng tạo đích thực.",
        "cue": "Use this structure in your Topic Sentence of Body Paragraph 1 to frame a balanced yet critical perspective."
    },
    {
        "id": "q1-complex-2",
        "patternName": "Causal Participle / Condition (Given that / Provided that)",
        "band": "C1",
        "focus": "Liên kết giữa áp lực thi cử và sự suy giảm khả năng ghi nhớ dài hạn.",
        "patternEn": "Given that standardized testing incentivizes rote memorization over critical comprehension, a substantial proportion of students retain little practical knowledge post-examination.",
        "patternVi": "Do thi cử chuẩn hóa chú trọng học vẹt hơn là thấu hiểu bản chất, nhiều học sinh nhanh chóng quên hết kiến thức ngay sau kỳ thi.",
        "cue": "Deploy this complex causal sentence in Body Paragraph 1 when analyzing the mechanism of educational interference."
    },
    {
        "id": "q1-complex-3",
        "patternName": "Negative Inversion (Not only... but also)",
        "band": "C1",
        "focus": "Nhấn mạnh tác hại kép: vừa triệt tiêu sáng tạo vừa gieo rắc nỗi sợ thất bại.",
        "patternEn": "Not only does pedagogical rigidity suppress unconventional thinking, but it also instills a paralyzing fear of failure that deters intellectual risk-taking.",
        "patternVi": "Phương pháp dạy học cứng nhắc không chỉ kìm hãm tư duy sáng tạo, mà còn tạo ra nỗi sợ sai khiến học sinh ngại tìm tòi, khám phá.",
        "cue": "Employ inversion as your high-impact concluding observation in the Agree paragraph to maximize grammatical range scores."
    }
]

for lvl_key in ['a2_b1', 'b2', 'c1']:
    lvl = pack['levels'][lvl_key]
    lvl['languageKit']['collocations'] = refined_collocations
    lvl['languageKit']['vocabulary'] = refined_vocab
    lvl['languageKit']['grammar'] = refined_grammar
    lvl['recycling']['instructionVi'] = "Áp dụng linh hoạt tối đa 2 mục tiêu phù hợp từ bài tập trước."
    
    # Deduplicate Agree 6 candidatePoints
    for plan in lvl.get('plans', []):
        if plan.get('stance') == 'agree':
            for cp in plan.get('candidatePoints', []):
                if cp.get('id') == 'q1-agree-6':
                    cp['titleVi'] = "Dập tắt hứng thú học tập"
                    cp['pointVi'] = "Bài tập bắt buộc và cách đánh giá ép buộc khiến việc học trở thành nghĩa vụ, làm mất đi hứng thú học tập suốt đời."
            for pt in plan.get('points', []):
                if pt.get('id') == 'q1-agree-6':
                    pt['titleVi'] = "Dập tắt hứng thú học tập"
                    pt['pointVi'] = "Bài tập bắt buộc và cách đánh giá ép buộc khiến việc học trở thành nghĩa vụ, làm mất đi hứng thú học tập suốt đời."

# Re-serialize with stable indent
raw_content = json.dumps(pack, ensure_ascii=False, indent=2) + "\n"
sha256_hash = hashlib.sha256(raw_content.encode('utf-8')).hexdigest()
new_filename = f"q0001.{sha256_hash[:16]}.json"
new_path = os.path.join(PACK_DIR, new_filename)

with open(new_path, 'w', encoding='utf-8') as f:
    f.write(raw_content)

# Remove old q0001 file(s)
for f in q0001_files:
    old_fpath = os.path.join(PACK_DIR, f)
    if os.path.abspath(old_fpath) != os.path.abspath(new_path):
        os.remove(old_fpath)
        print(f"Removed old file: {f}")

# Update manifest
with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

manifest['questions']['1']['url'] = f"/database/Write Essay/support/v1/packs/{new_filename}"
manifest['questions']['1']['sha256'] = sha256_hash

with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(f"SUCCESS: q0001 refined! New file: {new_filename}, sha256: {sha256_hash}")
