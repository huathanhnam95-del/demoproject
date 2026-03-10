#!/usr/bin/env python3
"""
Generate two CSV files for vowel teaching:
1. vowel_word_bank.csv - Words from Oxford 5000 + Academic Collocations with binary vowel labels
2. pte_reading_paragraphs.csv - 20 PTE-style reading paragraphs (~60 words each)
"""

import csv
import json
import re
import pronouncing

# =============================================================================
# ARPAbet → Target Vowel Mapping
# =============================================================================
# CMU dict uses ARPAbet. We map to our 10 target vowels.
# ARPAbet vowels have optional stress markers (0=unstressed, 1=primary, 2=secondary)

ARPABET_TO_VOWEL = {
    'AA': 'AH_ɑ',      # father
    'AH0': 'UH_ə',     # about (unstressed → schwa)
    'AH1': 'UH_ʌ',     # cup (primary stress → wedge)
    'AH2': 'UH_ʌ',     # secondary stress → wedge
    'IY': 'EE_i',      # see
    'IH': 'IH_ɪ',      # sit
    'EH': 'EH_ɛ',      # bed
    'AE': 'AA_æ',      # cat
    'ER': 'UR_ɜ',      # bird
    'UW': 'OO_u',      # food
    'AO': 'AW_ɔ',      # law
}

VOWEL_COLUMNS = [
    'AH_ɑ', 'UH_ʌ', 'EE_i', 'IH_ɪ', 'EH_ɛ',
    'AA_æ', 'UR_ɜ', 'UH_ə', 'OO_u', 'AW_ɔ'
]


def get_vowels_for_word(word):
    """Look up a word in CMUdict and return set of target vowel column names."""
    phones_list = pronouncing.phones_for_word(word.lower().strip())
    if not phones_list:
        return set()

    vowels = set()
    # Use first pronunciation
    phones = phones_list[0].split()
    for phone in phones:
        # Strip stress digits for base lookup, but keep for AH special case
        base = re.sub(r'\d', '', phone)
        stress = re.search(r'\d', phone)
        stress_num = stress.group() if stress else None

        if base == 'AH' and stress_num is not None:
            key = f'AH{stress_num}'
            if key in ARPABET_TO_VOWEL:
                vowels.add(ARPABET_TO_VOWEL[key])
        elif base in ARPABET_TO_VOWEL:
            vowels.add(ARPABET_TO_VOWEL[base])

    return vowels


def get_vowels_for_phrase(phrase):
    """Get combined vowels for a multi-word phrase."""
    vowels = set()
    words = re.findall(r"[a-zA-Z']+", phrase)
    for word in words:
        vowels.update(get_vowels_for_word(word))
    return vowels


# =============================================================================
# TASK 1: Generate Vowel Word Bank CSV
# =============================================================================

def generate_word_bank():
    print("=" * 60)
    print("GENERATING VOWEL WORD BANK CSV")
    print("=" * 60)

    rows = []
    word_id = 0
    seen_words = set()

    # --- Read Oxford 5000 ---
    print("\nReading The_Oxford_5000.csv...")
    with open('The_Oxford_5000.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = row['word'].strip().strip('"')
            level = row['level'].strip().strip('"')
            # Skip duplicates (same word with different forms)
            if word.lower() in seen_words:
                continue
            seen_words.add(word.lower())

            vowels = get_vowels_for_phrase(word)
            if not vowels:
                continue  # Skip words not in CMUdict

            word_id += 1
            entry = {
                'word_id': word_id,
                'word': word,
                'source': 'Oxford5000',
                'level': level,
            }
            for col in VOWEL_COLUMNS:
                entry[col] = 1 if col in vowels else 0
            rows.append(entry)

    oxford_count = word_id
    print(f"  Found {oxford_count} Oxford 5000 words with vowel data")

    # --- Read Academic Collocations ---
    print("Reading collocations.json...")
    with open('public/collocations.json', 'r', encoding='utf-8-sig') as f:
        collocations = json.load(f)

    colloc_phrases = set()
    for key, phrases in collocations.items():
        for phrase in phrases:
            colloc_phrases.add(phrase.strip())

    for phrase in sorted(colloc_phrases):
        if phrase.lower() in seen_words:
            continue
        seen_words.add(phrase.lower())

        vowels = get_vowels_for_phrase(phrase)
        if not vowels:
            continue

        word_id += 1
        entry = {
            'word_id': word_id,
            'word': phrase,
            'source': 'AcademicCollocation',
            'level': 'Academic',
        }
        for col in VOWEL_COLUMNS:
            entry[col] = 1 if col in vowels else 0
        rows.append(entry)

    colloc_count = word_id - oxford_count
    print(f"  Found {colloc_count} academic collocations with vowel data")

    # --- Write CSV ---
    output_file = 'vowel_word_bank.csv'
    fieldnames = ['word_id', 'word', 'source', 'level'] + VOWEL_COLUMNS
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✅ Wrote {len(rows)} entries to {output_file}")

    # --- Vowel coverage stats ---
    print("\nVowel coverage:")
    for col in VOWEL_COLUMNS:
        count = sum(1 for r in rows if r[col] == 1)
        print(f"  {col}: {count} words")

    return rows


# =============================================================================
# TASK 2: Generate PTE Reading Paragraphs CSV
# =============================================================================

PARAGRAPHS = [
    {
        "paragraph_id": 1,
        "topic": "Economic Growth",
        "paragraph_text": "Economic growth remains a fundamental objective for developing nations striving to reduce poverty and improve living standards. Governments must adopt comprehensive policies that balance fiscal responsibility with investment in infrastructure and education. Sustained economic progress often depends on stable institutions, transparent governance, and the capacity to adapt to rapidly changing global market conditions and technological disruption.",
        "target_vowels": "AH_ɑ|UH_ʌ|AA_æ"
    },
    {
        "paragraph_id": 2,
        "topic": "Climate Change",
        "paragraph_text": "Climate change poses a significant threat to environmental stability across the globe. Rising temperatures contribute to more frequent natural disasters, altered weather patterns, and loss of biological diversity. Addressing this crisis requires urgent collective action, including the transition to renewable energy sources, adoption of sustainable agricultural practices, and meaningful international cooperation to reduce harmful carbon emissions substantially.",
        "target_vowels": "EE_i|IH_ɪ|EH_ɛ"
    },
    {
        "paragraph_id": 3,
        "topic": "Higher Education",
        "paragraph_text": "Higher education institutions play a crucial role in preparing individuals for professional careers and lifelong learning. Universities must continually adapt their curricula to reflect emerging industry demands and technological advances. Research conducted within academic settings drives innovation and contributes significantly to broader societal development. Access to quality education remains an essential factor in achieving greater social equality and upward mobility.",
        "target_vowels": "EE_i|UH_ə|UR_ɜ"
    },
    {
        "paragraph_id": 4,
        "topic": "Public Health",
        "paragraph_text": "Public health policy has undergone substantial transformation in recent decades, shifting from purely reactive approaches to proactive disease prevention strategies. Modern health systems emphasize community education, regular screening programmes, and early intervention to combat chronic conditions. Effective public health infrastructure demands sustained government funding and strong collaboration between medical professionals, researchers, and local community organizations.",
        "target_vowels": "UH_ʌ|AA_æ|EH_ɛ"
    },
    {
        "paragraph_id": 5,
        "topic": "Technological Innovation",
        "paragraph_text": "Technological innovation has fundamentally altered how societies function and communicate. Digital platforms facilitate rapid information exchange, while artificial intelligence transforms industries ranging from healthcare to manufacturing. However, the accelerating pace of technological development also raises important ethical questions about privacy, employment, and the broader social implications of increasingly autonomous systems operating without sufficient human oversight.",
        "target_vowels": "IH_ɪ|EE_i|AH_ɑ"
    },
    {
        "paragraph_id": 6,
        "topic": "Urban Development",
        "paragraph_text": "Urban development demands careful strategic planning to accommodate growing populations while preserving environmental quality. Modern city planners must address challenges including affordable housing, efficient public transport, and adequate green spaces. Successful urban growth balances economic opportunity with sustainable infrastructure, creating communities where residents can thrive. Mixed-use developments and smart technology integration offer promising approaches for building liveable metropolitan areas.",
        "target_vowels": "UH_ʌ|UR_ɜ|AA_æ"
    },
    {
        "paragraph_id": 7,
        "topic": "Cultural Diversity",
        "paragraph_text": "Cultural diversity enriches societies by introducing a broad spectrum of perspectives, traditions, and creative expressions. Multicultural communities often demonstrate greater adaptability and innovation, drawing upon diverse knowledge systems and approaches to problem solving. Educational institutions bear particular responsibility for fostering intercultural understanding and ensuring that all students, regardless of background, feel valued within the learning environment.",
        "target_vowels": "UR_ɜ|IH_ɪ|UH_ə"
    },
    {
        "paragraph_id": 8,
        "topic": "Scientific Research",
        "paragraph_text": "Scientific research methodology requires rigorous adherence to established protocols that ensure the reliability and validity of findings. Peer review processes serve as fundamental quality control mechanisms within academic communities. Researchers must accurately report data, acknowledge limitations, and consider the broader ethical implications of their work. Transparent communication of results strengthens public trust in the scientific enterprise and informs evidence-based policy decisions.",
        "target_vowels": "EH_ɛ|IH_ɪ|AH_ɑ"
    },
    {
        "paragraph_id": 9,
        "topic": "Social Inequality",
        "paragraph_text": "Social inequality persists as a major challenge confronting modern democratic societies. Disparities in income, educational attainment, and access to healthcare resources affect millions of individuals worldwide. Scholars argue that structural factors, rather than personal shortcomings, primarily drive persistent inequality. Addressing these complex issues demands coordinated policy interventions targeting housing, employment, and social welfare systems at both national and local levels.",
        "target_vowels": "AA_æ|EH_ɛ|IH_ɪ"
    },
    {
        "paragraph_id": 10,
        "topic": "International Relations",
        "paragraph_text": "International relations in the contemporary era are shaped by an intricate web of economic interdependence, security concerns, and cultural exchange. Diplomatic negotiations require careful consideration of diverse national interests and historical contexts. Multilateral organizations facilitate cooperation on global challenges such as arms control, trade regulation, and environmental protection. Effective diplomacy balances assertive national positioning with genuine commitment to collaborative problem resolution.",
        "target_vowels": "AH_ɑ|EH_ɛ|AW_ɔ"
    },
    {
        "paragraph_id": 11,
        "topic": "Environmental Conservation",
        "paragraph_text": "Environmental conservation efforts have intensified as awareness of ecological degradation grows worldwide. Protected natural areas serve as vital refuges for endangered species and help maintain broader ecosystem functions. Conservation strategies increasingly incorporate indigenous knowledge alongside modern scientific approaches, recognizing that local communities often possess invaluable understanding of sustainable resource management developed over many centuries of careful observation.",
        "target_vowels": "AW_ɔ|UR_ɜ|UH_ə"
    },
    {
        "paragraph_id": 12,
        "topic": "Digital Communication",
        "paragraph_text": "Digital communication technologies have transformed interpersonal interactions and fundamentally reshaped how information flows through society. Social media platforms enable rapid dissemination of ideas but also raise concerns about misinformation and reduced attention spans. Organizations must develop sophisticated digital literacy programmes that empower users to critically evaluate online content, distinguish credible sources from unreliable ones, and engage constructively in virtual public discourse.",
        "target_vowels": "EE_i|IH_ɪ|OO_u"
    },
    {
        "paragraph_id": 13,
        "topic": "Food Security",
        "paragraph_text": "Food security represents a critical global challenge as populations expand and agricultural land faces increasing pressure from development and climate variability. Sustainable farming practices, advanced crop science, and improved distribution networks all contribute to addressing hunger and malnutrition. Governments should prioritize food system resilience through strategic investment, international cooperation, and policies that support small-scale farmers who produce a substantial portion of the global food supply.",
        "target_vowels": "OO_u|UH_ʌ|AH_ɑ"
    },
    {
        "paragraph_id": 14,
        "topic": "Mental Health",
        "paragraph_text": "Mental health awareness has grown considerably in recent years, prompting institutions to reconsider their approach to psychological wellbeing. Research demonstrates that early intervention and accessible counselling services significantly reduce the burden of mental illness on individuals and communities. Workplace programmes promoting stress management, work-life balance, and supportive team environments prove particularly effective in preventing burnout and sustaining long-term employee productivity and satisfaction.",
        "target_vowels": "EH_ɛ|UH_ə|AA_æ"
    },
    {
        "paragraph_id": 15,
        "topic": "Renewable Energy",
        "paragraph_text": "Renewable energy adoption has accelerated dramatically as costs decline and environmental urgency grows. Solar and wind power installations now provide a substantial share of electricity generation in numerous countries. However, transitioning from fossil fuels requires enormous investment in grid infrastructure, energy storage, and workforce training. Governments must establish clear regulatory frameworks that incentivize clean energy while ensuring affordable power for all consumers.",
        "target_vowels": "OO_u|UR_ɜ|AW_ɔ"
    },
    {
        "paragraph_id": 16,
        "topic": "Artificial Intelligence",
        "paragraph_text": "Artificial intelligence continues to advance at a remarkable pace, raising profound questions about the future of human labour and decision making. Machine learning algorithms now surpass human performance in specific tasks including medical diagnosis, language translation, and pattern recognition. Policymakers must thoughtfully navigate the balance between encouraging innovation and establishing appropriate safeguards against potential misuse of these increasingly powerful and autonomous computational systems.",
        "target_vowels": "IH_ɪ|EE_i|AH_ɑ"
    },
    {
        "paragraph_id": 17,
        "topic": "Democratic Governance",
        "paragraph_text": "Democratic governance depends upon an informed and engaged citizenry that actively participates in political processes. Free and transparent elections, independent judiciary systems, and robust civil society organizations form the foundation of functioning democracies. Scholars observe that erosion of public trust in governmental institutions threatens democratic stability. Strengthening civic education, promoting media literacy, and ensuring accountable leadership all contribute to preserving democratic values across generations.",
        "target_vowels": "AA_æ|UH_ʌ|EH_ɛ"
    },
    {
        "paragraph_id": 18,
        "topic": "Migration Patterns",
        "paragraph_text": "Migration patterns have shifted considerably due to globalization, economic disparity, and regional conflicts. Contemporary migration involves complex movements of people seeking better employment opportunities, education, or refuge from persecution. Host countries face challenges integrating newcomers while maintaining social cohesion. Comprehensive immigration policies must balance humanitarian obligations with practical considerations regarding labour market demands, cultural adaptation, and the provision of essential public services.",
        "target_vowels": "AH_ɑ|EH_ɛ|UH_ə"
    },
    {
        "paragraph_id": 19,
        "topic": "Water Resource Management",
        "paragraph_text": "Water resource management has become an urgent priority as freshwater scarcity affects communities across all continents. Sustainable water governance requires integrated approaches that consider agricultural irrigation, industrial consumption, and domestic household needs simultaneously. Advanced purification technologies, rainwater harvesting systems, and conservation awareness campaigns offer practical solutions. International cooperation on transboundary water resources remains essential for preventing conflict and ensuring equitable access for future generations.",
        "target_vowels": "AW_ɔ|OO_u|UR_ɜ"
    },
    {
        "paragraph_id": 20,
        "topic": "Childhood Development",
        "paragraph_text": "Childhood development research demonstrates that early experiences profoundly shape cognitive abilities, emotional regulation, and social competence throughout life. Quality early education programmes, nurturing family environments, and adequate nutrition all contribute substantially to healthy developmental outcomes. Policymakers increasingly recognize that investment in early childhood services yields significant long-term returns through reduced healthcare costs, improved academic performance, and stronger community participation in subsequent adult years.",
        "target_vowels": "UH_ʌ|AA_æ|IH_ɪ"
    },
]


def generate_paragraphs():
    print("\n" + "=" * 60)
    print("GENERATING PTE READING PARAGRAPHS CSV")
    print("=" * 60)

    output_file = 'pte_reading_paragraphs.csv'
    fieldnames = ['paragraph_id', 'topic', 'paragraph_text', 'target_vowels', 'word_count']

    rows = []
    for p in PARAGRAPHS:
        word_count = len(p['paragraph_text'].split())
        rows.append({
            'paragraph_id': p['paragraph_id'],
            'topic': p['topic'],
            'paragraph_text': p['paragraph_text'],
            'target_vowels': p['target_vowels'],
            'word_count': word_count,
        })
        print(f"  Paragraph {p['paragraph_id']:2d} ({p['topic']:30s}): {word_count} words")

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✅ Wrote {len(rows)} paragraphs to {output_file}")

    # Validation
    issues = []
    for r in rows:
        if r['word_count'] < 55 or r['word_count'] > 65:
            issues.append(f"  ⚠️  Paragraph {r['paragraph_id']}: {r['word_count']} words (target: 55-65)")
    if issues:
        print("\nWord count warnings:")
        for i in issues:
            print(i)
    else:
        print("\n✅ All paragraphs within 55-65 word range")

    return rows


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    word_bank = generate_word_bank()
    paragraphs = generate_paragraphs()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  vowel_word_bank.csv:       {len(word_bank)} entries")
    print(f"  pte_reading_paragraphs.csv: {len(paragraphs)} paragraphs")
    print("\nDone! ✅")
