const crypto = require('crypto');

const TEST_VERSION = 'entrance_test_36plus_v1';

function normalizeSpaces(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeWordText(text) {
    return normalizeSpaces(text)
        .toLowerCase()
        .replace(/[\u2019']/g, "'")
        .replace(/[^a-z0-9'\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeWords(text) {
    const normalized = normalizeWordText(text);
    if (!normalized) return [];
    return normalized.split(' ').filter(Boolean);
}

function wordEditDistance(aWords, bWords) {
    const aLen = aWords.length;
    const bLen = bWords.length;
    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;

    // DP with rolling arrays
    const prev = new Array(bLen + 1);
    const curr = new Array(bLen + 1);
    for (let j = 0; j <= bLen; j++) prev[j] = j;

    for (let i = 1; i <= aLen; i++) {
        curr[0] = i;
        for (let j = 1; j <= bLen; j++) {
            const cost = aWords[i - 1] === bWords[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,      // deletion
                curr[j - 1] + 1,  // insertion
                prev[j - 1] + cost // substitution
            );
        }
        for (let j = 0; j <= bLen; j++) prev[j] = curr[j];
    }

    return prev[bLen];
}

function computeWordAccuracyPercent(expectedText, transcriptText) {
    const expectedWords = tokenizeWords(expectedText);
    const transcriptWords = tokenizeWords(transcriptText);
    const distance = wordEditDistance(expectedWords, transcriptWords);
    const expectedCount = expectedWords.length;
    const transcriptCount = transcriptWords.length;
    const raw = expectedCount === 0 ? 0 : (expectedCount - distance) / expectedCount;
    const percent = Math.max(0, Math.min(1, raw)) * 100;
    return {
        percent: Math.round(percent * 10) / 10,
        expectedCount,
        transcriptCount,
        distance
    };
}

function extensionFromContentType(contentType) {
    const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (ct === 'audio/webm') return 'webm';
    if (ct === 'audio/ogg') return 'ogg';
    if (ct === 'audio/mpeg' || ct === 'audio/mp3') return 'mp3';
    if (ct === 'audio/wav' || ct === 'audio/wave' || ct === 'audio/x-wav') return 'wav';
    if (ct === 'audio/flac' || ct === 'audio/x-flac') return 'flac';
    if (ct === 'audio/mp4' || ct === 'audio/m4a' || ct === 'audio/x-m4a') return 'm4a';
    return 'bin';
}

function hashTokenToTestId(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function makeDeterministicRngBytes(seed) {
    return crypto.createHash('sha256').update(String(seed || '')).digest();
}

function shuffleDeterministic(items, seed) {
    const arr = Array.from(items || []);
    const bytes = makeDeterministicRngBytes(seed);
    let k = 0;
    for (let i = arr.length - 1; i > 0; i--) {
        // Convert 4 bytes to uint32
        const b0 = bytes[k % bytes.length];
        const b1 = bytes[(k + 1) % bytes.length];
        const b2 = bytes[(k + 2) % bytes.length];
        const b3 = bytes[(k + 3) % bytes.length];
        k += 4;
        const r = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
        const j = r % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function parseMultipleChoiceParagraph(raw, questionId) {
    const text = String(raw || '');
    const parts = [];
    const blanks = [];
    let cursor = 0;
    let blankIndex = 0;

    while (cursor < text.length) {
        const start = text.indexOf('__', cursor);
        if (start === -1) break;
        const end = text.indexOf('__', start + 2);
        if (end === -1) break;

        const before = text.slice(cursor, start);
        if (before) parts.push({ type: 'text', text: before });

        const inside = text.slice(start + 2, end);
        const rawOptions = inside.split('/').map(s => normalizeSpaces(s));
        const options = rawOptions.filter(s => s.length > 0);
        const correctAnswer = options[0] || '';
        blankIndex++;
        const blankId = `${questionId}__b${blankIndex}`;

        parts.push({
            type: 'blank',
            blankId,
            options
        });
        blanks.push({
            blankId,
            options,
            correctAnswer
        });

        cursor = end + 2;
    }

    const after = text.slice(cursor);
    if (after) parts.push({ type: 'text', text: after });

    return { parts, blanks };
}

function parseFillInParagraph(raw, questionId) {
    const text = String(raw || '');
    const parts = [];
    const blanks = [];
    let cursor = 0;
    let blankIndex = 0;

    while (cursor < text.length) {
        const start = text.indexOf('__', cursor);
        if (start === -1) break;
        const end = text.indexOf('__', start + 2);
        if (end === -1) break;

        const before = text.slice(cursor, start);
        if (before) parts.push({ type: 'text', text: before });

        const inside = normalizeSpaces(text.slice(start + 2, end));
        blankIndex++;
        const blankId = `${questionId}__b${blankIndex}`;

        parts.push({
            type: 'blank',
            blankId
        });
        blanks.push({
            blankId,
            expectedAnswer: inside || null
        });

        cursor = end + 2;
    }

    const after = text.slice(cursor);
    if (after) parts.push({ type: 'text', text: after });

    return { parts, blanks };
}

const SPEAKING_INSTRUCTION_VI =
    'Hãy đọc đoạn văn dưới đây thành tiếng, lưu ý đọc rõ ràng và trôi chảy nhất có thể. Bạn có thể tập đọc trước cho quen rồi hãy bắt đầu thu âm nhé.';

const VOCAB_INSTRUCTION_VI =
    'Hãy đọc thật kỹ đoạn văn rồi dựa vào ý nghĩa của câu và của các lựa chọn để chọn từ thích hợp nhất cho ô trống.';

const GRAMMAR_INSTRUCTION_VI =
    'Hãy đọc thật kỹ đoạn văn rồi dựa vào ý nghĩa và cấu trúc ngữ pháp của câu và của các lựa chọn để chọn từ thích hợp nhất cho ô trống.';

const LISTEN_WRITE_INSTRUCTION_VI =
    'Hãy điền từ phù hợp vào các ô trống. Sau khi hoàn thành, nhấn “Submit” để chuyển sang câu tiếp theo.';

const TEST_36PLUS = {
    version: TEST_VERSION,
    title: 'Entrance Test 36+',
    sections: [
        {
            id: 'speaking',
            titleVi: 'I. Speaking (ĐỌC & NÓI)',
            instructionVi: SPEAKING_INSTRUCTION_VI,
            questions: [
                {
                    id: 'speaking_q1',
                    promptNumber: 1,
                    expectedText: 'Scientists make observations, make assumptions, and do experiments. After these have been done, they get their results. Then there is a lot of data from scientists. The scientists around the world have a picture of the world.'
                },
                {
                    id: 'speaking_q2',
                    promptNumber: 2,
                    expectedText: 'Statistics are indicators of change and allow meaningful comparisons to be made. While it may be the issues rather than the statistics that grab people\'s attention, it should be recognised that it is the statistics that inform the issues. Statistical literacy, then, is the ability to accurately understand, interpret and evaluate the data that inform these issues.'
                },
                {
                    id: 'speaking_q3',
                    promptNumber: 3,
                    expectedText: 'The numbers on US student debt, after all, are truly staggering. The average 2015 US university graduate who took out loans to help pay for tuition enters the workforce with $35,000 in student debt. In the US, total student debt exceeds $1.15 trillion - dwarfing, for instance, the nation\'s credit card debt.'
                }
            ]
        },
        {
            id: 'vocab',
            titleVi: 'II. Vocab (TỪ VỰNG)',
            instructionVi: VOCAB_INSTRUCTION_VI,
            questions: [
                {
                    id: 'vocab_q1',
                    raw: 'Most groups of animals have their specialist feeders adapted to a very limited type of food. Among __reptiles/insects/mammals/primates__, perhaps the most extraordinary is an African egg-eating snake. Many snakes eat eggs as part of a varied __diet/habit/tradition/plan__ but the egg eater eats exclusively eggs. Small, soft-shelled eggs are __easy/hard/slow/difficult__ to eat, as they can be quickly opened by the snake’s teeth. Larger, hard-shelled eggs such as those laid by birds need special treatment. However, some types of egg-eating snakes eat only birds’ eggs which they swallow whole as they have few teeth. They have tooth-like spines that stick down from the backbone and crack open the egg as it passes down the snake’s __throat/eyes/lungs/nose__.'
                },
                {
                    id: 'vocab_q2',
                    raw: 'Used in a variety of courses in various disciplines, Asking The Right Questions helps students __bridge/widen/spoil/leak__ the gap between simply memorizing or blindly accepting information, and the greater challenge of critical analysis and synthesis. Specifically, this concise text teaches students to think __critically/importantly/crucially/essentially__ by exploring the components of arguments - issues, conclusions, reasons, evidence, assumptions, language - and on how to spot fallacies, manipulations, and obstacles to critical thinking in both written and visual communication. It teaches them to respond to alternative points of view and develop a solid foundation for making personal choices about what to accept and what to __reject/reflect/remake/respond__.'
                },
                {
                    id: 'vocab_q3',
                    raw: 'A creature may have fine __physical/mental/chemical/spiritual__ defenses such as hard armor or sharp spines. It may have powerful chemical defenses such as an __appalling/appealing/attractive/appetizing__ smell or foul-tasting flesh. But none of these defenses is much used in a struggle for survival unless the animal also has the right behavior to go with it. Evolution shapes a living creature\'s size, colour, and other features. It also shapes an animal’s actions and behavior patterns. The most important behaviors are __instinctive/acquired/extrinsic/intuitive__ and inbuilt. In other words, the creature can perform the action without having to learn what to do and how to do it by __trial/effort/attempt/encouragement__ and error.'
                },
                {
                    id: 'vocab_q4',
                    raw: 'DNA is a molecule that does two things. First, it acts as the __hereditary/building/metabolic/nutritional__ material, which is passed __down/out/around/by__ from generation to generation. Second, it directs, to a considerable extent, the construction of our bodies, telling our cells what kinds of molecules to make and guiding our development from a single-celled zygote to a fully formed adult. These two things are, of course, connected. The DNA sequences that construct the best bodies are more likely to get passed down to the next generation because well-constructed bodies are more likely to __survive/exist/wither/multiply__ and thus to reproduce. This is Darwin’s __theory/hypothesis/statement/thesis__ of natural selection stated in the language of DNA.'
                }
            ]
        },
        {
            id: 'grammar',
            titleVi: 'III. Grammar (NGỮ PHÁP)',
            instructionVi: GRAMMAR_INSTRUCTION_VI,
            questions: [
                {
                    id: 'grammar_q1',
                    raw: 'Philosophy for Children is __designed/design/designing/designs__ to help children become more willing and able to question, reason, construct arguments, and collaborate. Dialogues are based on concepts such as ‘truth’, ‘fairness’, or ‘bullying’. In a typical lesson, pupils and teachers sit together in a circle and the teacher begins by presenting a stimulus, __which/what/who/why__ could be a video clip, image or newspaper article to provoke pupils’ interest. This is generally followed by some silent thinking time before the class splits into groups to think of questions that __interest/interests/interesting/interestingly__ them. A certain question with philosophical potential is then selected by the group to stimulate a whole-class discussion. These discussions are supported by activities __to/for/by/in__ develop children’s skills __in/on/around/to__ reasoning and their understanding of concepts.'
                },
                {
                    id: 'grammar_q2',
                    raw: 'Traditionally, the analysis of music is a solitary activity, completed by individual theorists, performers, or conductors before their interpretations are disseminated through writing, presentation, or performance. A similar model is often used for teaching analysis: students are given the context in which a piece was composed, taught the most appropriate analytical approaches, and then asked to complete their analysis on their own, usually outside of class time as a homework assignment. __However/Therefore/Moreover/Additionally__, recent research into cognitive science has found that students learn better in a group than __individually/individuals/individualized/individual__, coining the concept “collective general intelligence” to describe a group’s ability to perform better on complex tasks such as solving puzzles, making moral judgments, and brainstorming. In education fields, this concept has been applied to “peer learning” in __which/what/who/where__ students learn from other students by participating in communal activities, discussions, and tasks and this has also been shown to result in more effective learning than the traditional solitary method of learning. These more active and collaborative forms of learning are able to better provide conceptual understanding and long-term knowledge retention __because/and/so/however__ students are placed at the center of their own learning.'
                },
                {
                    id: 'grammar_q3',
                    raw: 'Colorful poison frogs in the Amazon owe their great diversity to ancestors that leapt into the region from the Andes Mountains several times during the last 10 million years, a new study from The University of Texas at Austin suggests. This is the first study to show that the Andes __have been/has been/had been/will be__ a major source of diversity for the Amazon basin, one of the largest reservoirs of __biological/biology/biologically/biologist__ diversity on Earth. The finding runs counter thoroughly to the idea that Amazonian diversity is the result of evolution only within the tropical forest itself.'
                },
                {
                    id: 'grammar_q4',
                    raw: 'Dogs make great listeners. And that may be because man and man\'s best friend use analogous brain regions to process voices. Researchers collected almost 200 sound samples, including human and canine vocalizations, as well as environmental noises and silence. They __played/play/will play/have played__ these clips to 22 people and 11 dogs while the subjects\' brains __were undergoing/underwent/will undergo/undergo__ functional MRI scans. Human brains tuned in most to vocal sounds. Dog brains were most sensitive to environmental noises. __Nevertheless/In conclusion/Similarly/Consquently__, they still had a lot in common. A dedicated brain area reacted strongly to the vocalizations of their own species. That area also responded to the voices of the other species. Meanwhile, a different brain region noted emotion in a voice, with a strong response to cheery sounds like laughter and a weaker reaction to unhappy noises like canine whining. The study is in the journal Current Biology. It seems that thousands of years of domestication __have made/will make/made/has made__ our furry friends sensitive to the same vocal cues we are. You can confide in Fido.'
                }
            ]
        },
        {
            id: 'listen_write',
            titleVi: 'IV. Nghe & Viết',
            instructionVi: LISTEN_WRITE_INSTRUCTION_VI,
            questions: [
                {
                    id: 'listen_write_q1',
                    raw: 'So every year influenza does strike. It __causes__ seasonal flu outbreaks and that\'s caused by new influenza strains. It affects about 5 to 20% of US residents, and 200,000 people become __sick__ each year and 36,000 people die from flu. And sometimes, flu viruses can actually __mutate__ to form novel viruses. We worry about novel influenza subtypes because they can cause pandemics and a pandemic is a __global__ __outbreak__ of a disease. The most severe influenza pandemic in the last century occurred in 1918. And it was caused by a flu virus called H1N1. It began in the United States around September 14, and within five weeks, it’d __spread__ __throughout__ the entire United States. It\'s estimated that 20 to 100 million people died worldwide from this disease that year and it included 500,000 Americans.',
                    audioUrl: 'database/Entrance Test/Listening Q1.mp3'
                },
                {
                    id: 'listen_write_q2',
                    raw: 'The term that\'s __increasingly__ __used__ now is post-antibiotic era. And I guess the question is, what does that mean? To put it in __context__, in the 1920s and 30s, we didn\'t have antibiotics so if people got seriously __ill__ they either survived because of their own immunity or they died. And we call that the pre-antibiotic era. What has actually happened is that we got a lot of antibiotics, particularly in the 50s but 60s, 70s, 80s. So much so that a US Secretary of Health or Surgeon General said that the era of __infections__ was over because we have all these drugs to cure all these things. Well, what has actually happened is we\'ve gone into a post-antibiotic era with some __bacteria__. For a lot of people with very __common__ infections, we\'re back in the 1920s because we don\'t have effective antibiotics that __worked__.',
                    audioUrl: 'database/Entrance Test/Listening Q2.mp3'
                }
            ]
        }
    ]
};

function getCanonicalTest() {
    // Attach parsed structures lazily (without mutating the original constant)
    const sections = TEST_36PLUS.sections.map(section => {
        if (section.id === 'vocab' || section.id === 'grammar') {
            const questions = section.questions.map(q => {
                const parsed = parseMultipleChoiceParagraph(q.raw, q.id);
                return {
                    ...q,
                    parts: parsed.parts,
                    blanks: parsed.blanks
                };
            });
            return { ...section, questions };
        }
        if (section.id === 'listen_write') {
            const questions = section.questions.map(q => {
                const parsed = parseFillInParagraph(q.raw, q.id);
                return {
                    ...q,
                    parts: parsed.parts,
                    blanks: parsed.blanks
                };
            });
            return { ...section, questions };
        }
        return section;
    });
    return { ...TEST_36PLUS, sections };
}

function buildPublicSession(testId) {
    const canonical = getCanonicalTest();
    const sections = canonical.sections.map(section => {
        if (section.id === 'speaking') {
            return {
                id: section.id,
                titleVi: section.titleVi,
                instructionVi: section.instructionVi,
                questions: section.questions.map((q, idx) => ({
                    type: 'speaking',
                    sectionId: section.id,
                    questionId: q.id,
                    questionNumber: idx + 1,
                    instructionVi: section.instructionVi,
                    text: q.expectedText
                }))
            };
        }

        if (section.id === 'vocab' || section.id === 'grammar') {
            return {
                id: section.id,
                titleVi: section.titleVi,
                instructionVi: section.instructionVi,
                questions: section.questions.map((q, idx) => ({
                    type: 'mc',
                    sectionId: section.id,
                    questionId: q.id,
                    questionNumber: idx + 1,
                    instructionVi: section.instructionVi,
                    parts: q.parts.map(part => {
                        if (part.type !== 'blank') return part;
                        const seed = `${testId}:${part.blankId}`;
                        const options = shuffleDeterministic(part.options, seed);
                        return {
                            type: 'blank',
                            blankId: part.blankId,
                            options
                        };
                    })
                }))
            };
        }

        if (section.id === 'listen_write') {
            return {
                id: section.id,
                titleVi: section.titleVi,
                instructionVi: section.instructionVi,
                questions: section.questions.map((q, idx) => ({
                    type: 'fill',
                    sectionId: section.id,
                    questionId: q.id,
                    questionNumber: idx + 1,
                    instructionVi: section.instructionVi,
                    audioUrl: q.audioUrl || null,
                    parts: q.parts.map(part => {
                        if (part.type !== 'blank') return part;
                        return { type: 'blank', blankId: part.blankId };
                    })
                }))
            };
        }

        return section;
    });

    return {
        version: canonical.version,
        title: canonical.title,
        sections
    };
}

function scoreMultipleChoiceSection(section, responses) {
    const responseObj = responses && typeof responses === 'object' ? responses : {};
    const graded = {
        questions: [],
        correctTotal: 0,
        blanksTotal: 0
    };

    for (const q of section.questions) {
        const userAnswers = Array.isArray(responseObj[q.id]) ? responseObj[q.id] : [];
        const blanks = q.blanks || [];
        let correct = 0;

        const blankDetails = blanks.map((b, idx) => {
            const actualRaw = userAnswers[idx];
            const actual = normalizeSpaces(actualRaw);
            const expected = normalizeSpaces(b.correctAnswer);
            const isCorrect = actual.length > 0 && expected.length > 0 && actual === expected;
            if (isCorrect) correct++;
            return {
                blankId: b.blankId,
                expected,
                actual: actual || null,
                isCorrect
            };
        });

        graded.questions.push({
            questionId: q.id,
            correct,
            total: blanks.length,
            blanks: blankDetails
        });
        graded.correctTotal += correct;
        graded.blanksTotal += blanks.length;
    }

    return graded;
}

function scoreFillInSection(section, responses) {
    const responseObj = responses && typeof responses === 'object' ? responses : {};
    const graded = {
        questions: [],
        correctTotal: 0,
        blanksTotal: 0,
        unscoredTotal: 0
    };

    for (const q of section.questions) {
        const userAnswers = Array.isArray(responseObj[q.id]) ? responseObj[q.id] : [];
        const blanks = q.blanks || [];
        let correct = 0;
        let scoredTotal = 0;
        let unscored = 0;

        const blankDetails = blanks.map((b, idx) => {
            const actualRaw = userAnswers[idx];
            const actual = normalizeSpaces(actualRaw);
            const expected = normalizeSpaces(b.expectedAnswer);
            const scored = !!expected;
            if (!scored) unscored++;
            if (scored) {
                scoredTotal++;
                const isCorrect = normalizeWordText(actual) === normalizeWordText(expected);
                if (isCorrect) correct++;
                return {
                    blankId: b.blankId,
                    expected,
                    actual: actual || null,
                    scored: true,
                    isCorrect
                };
            }
            return {
                blankId: b.blankId,
                expected: null,
                actual: actual || null,
                scored: false,
                isCorrect: null
            };
        });

        graded.questions.push({
            questionId: q.id,
            correct,
            total: scoredTotal,
            unscored,
            blanks: blankDetails
        });
        graded.correctTotal += correct;
        graded.blanksTotal += scoredTotal;
        graded.unscoredTotal += unscored;
    }

    return graded;
}

function scoreSubmission(responses) {
    const canonical = getCanonicalTest();
    const responseRoot = responses && typeof responses === 'object' ? responses : {};

    const vocabSection = canonical.sections.find(s => s.id === 'vocab');
    const grammarSection = canonical.sections.find(s => s.id === 'grammar');
    const listenWriteSection = canonical.sections.find(s => s.id === 'listen_write');

    const vocab = vocabSection ? scoreMultipleChoiceSection(vocabSection, responseRoot.vocab) : null;
    const grammar = grammarSection ? scoreMultipleChoiceSection(grammarSection, responseRoot.grammar) : null;
    const listenWrite = listenWriteSection ? scoreFillInSection(listenWriteSection, responseRoot.listen_write) : null;

    const overall = {
        scoredCorrect: (vocab?.correctTotal || 0) + (grammar?.correctTotal || 0) + (listenWrite?.correctTotal || 0),
        scoredTotal: (vocab?.blanksTotal || 0) + (grammar?.blanksTotal || 0) + (listenWrite?.blanksTotal || 0),
        unscoredTotal: listenWrite?.unscoredTotal || 0
    };

    return {
        version: canonical.version,
        vocab,
        grammar,
        listenWrite,
        overall
    };
}

module.exports = {
    TEST_VERSION,
    TEST_36PLUS,
    hashTokenToTestId,
    extensionFromContentType,
    computeWordAccuracyPercent,
    buildPublicSession,
    scoreSubmission
};
