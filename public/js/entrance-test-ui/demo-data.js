/*
 * Demo D content fixture.
 *
 * This is a browser-safe snapshot of buildPublicSession() from
 * functions/src/entrance-test/test36plus.js at the execution base SHA. It is
 * content only: Demo D has no scoring or answer-submission path.
 */

const text = (value) => ({ type: 'text', text: value });
const blank = (blankId, options) => ({
  type: 'blank',
  blankId,
  ...(options ? { options: [...options] } : {})
});

const mc = (sectionId, questionId, questionNumber, parts) => ({
  type: 'mc', sectionId, questionId, questionNumber, parts
});

const fill = (sectionId, questionId, questionNumber, audioUrl, parts) => ({
  type: 'fill', sectionId, questionId, questionNumber, audioUrl, parts
});

const speaking = (questionId, questionNumber, value) => ({
  type: 'speaking',
  sectionId: 'speaking',
  questionId,
  questionNumber,
  text: value
});

const SPEAKING_INSTRUCTION =
  'Hãy đọc đoạn văn dưới đây thành tiếng, lưu ý đọc rõ ràng và trôi chảy nhất có thể. Bạn có thể tập đọc trước cho quen rồi hãy bắt đầu thu âm nhé.';
const VOCAB_INSTRUCTION =
  'Hãy đọc thật kỹ đoạn văn rồi dựa vào ý nghĩa của câu và của các lựa chọn để chọn từ thích hợp nhất cho ô trống.';
const GRAMMAR_INSTRUCTION =
  'Hãy đọc thật kỹ đoạn văn rồi dựa vào ý nghĩa và cấu trúc ngữ pháp của câu và của các lựa chọn để chọn từ thích hợp nhất cho ô trống.';
const LISTEN_INSTRUCTION =
  'Hãy điền từ phù hợp vào các ô trống. Sau khi hoàn thành, nhấn “Submit” để chuyển sang câu tiếp theo.';

export const DEMO_DATA = {
  version: 'entrance_test_36plus_v1',
  title: 'Entrance Test 36+',
  provenance: {
    source: 'functions/src/entrance-test/test36plus.js',
    sourceRevision: 'd188648e36ef0c505951fdb622536654051adb82',
    testId: 'entrance-test-ui-demo',
    purpose: 'Demo D UI evaluation fixture; not a scoring or submission source'
  },
  sections: [
    {
      id: 'speaking', titleVi: 'I. Speaking (ĐỌC & NÓI)', instructionVi: SPEAKING_INSTRUCTION,
      questions: [
        speaking('speaking_q1', 1, 'Scientists make observations, make assumptions, and do experiments. After these have been done, they get their results. Then there is a lot of data from scientists. The scientists around the world have a picture of the world.'),
        speaking('speaking_q2', 2, "Statistics are indicators of change and allow meaningful comparisons to be made. While it may be the issues rather than the statistics that grab people's attention, it should be recognised that it is the statistics that inform the issues. Statistical literacy, then, is the ability to accurately understand, interpret and evaluate the data that inform these issues."),
        speaking('speaking_q3', 3, "The numbers on US student debt, after all, are truly staggering. The average 2015 US university graduate who took out loans to help pay for tuition enters the workforce with $35,000 in student debt. In the US, total student debt exceeds $1.15 trillion - dwarfing, for instance, the nation's credit card debt.")
      ]
    },
    {
      id: 'vocab', titleVi: 'II. Vocab (TỪ VỰNG)', instructionVi: VOCAB_INSTRUCTION,
      questions: [
        mc('vocab', 'vocab_q1', 1, [
          text('Most groups of animals have their specialist feeders adapted to a very limited type of food. Among '),
          blank('vocab_q1__b1', ['primates', 'mammals', 'insects', 'reptiles']),
          text(', perhaps the most extraordinary is an African egg-eating snake. Many snakes eat eggs as part of a varied '),
          blank('vocab_q1__b2', ['plan', 'diet', 'habit', 'tradition']),
          text(' but the egg eater eats exclusively eggs. Small, soft-shelled eggs are '),
          blank('vocab_q1__b3', ['easy', 'hard', 'slow', 'difficult']),
          text(' to eat, as they can be quickly opened by the snake’s teeth. Larger, hard-shelled eggs such as those laid by birds need special treatment. However, some types of egg-eating snakes eat only birds’ eggs which they swallow whole as they have few teeth. They have tooth-like spines that stick down from the backbone and crack open the egg as it passes down the snake’s '),
          blank('vocab_q1__b4', ['throat', 'nose', 'lungs', 'eyes']),
          text('.')
        ]),
        mc('vocab', 'vocab_q2', 2, [
          text('Used in a variety of courses in various disciplines, Asking The Right Questions helps students '),
          blank('vocab_q2__b1', ['widen', 'bridge', 'leak', 'spoil']),
          text(' the gap between simply memorizing or blindly accepting information, and the greater challenge of critical analysis and synthesis. Specifically, this concise text teaches students to think '),
          blank('vocab_q2__b2', ['crucially', 'importantly', 'essentially', 'critically']),
          text(' by exploring the components of arguments - issues, conclusions, reasons, evidence, assumptions, language - and on how to spot fallacies, manipulations, and obstacles to critical thinking in both written and visual communication. It teaches them to respond to alternative points of view and develop a solid foundation for making personal choices about what to accept and what to '),
          blank('vocab_q2__b3', ['respond', 'reject', 'reflect', 'remake']),
          text('.')
        ]),
        mc('vocab', 'vocab_q3', 3, [
          text('A creature may have fine '),
          blank('vocab_q3__b1', ['mental', 'chemical', 'physical', 'spiritual']),
          text(' defenses such as hard armor or sharp spines. It may have powerful chemical defenses such as an '),
          blank('vocab_q3__b2', ['attractive', 'appealing', 'appetizing', 'appalling']),
          text(" smell or foul-tasting flesh. But none of these defenses is much used in a struggle for survival unless the animal also has the right behavior to go with it. Evolution shapes a living creature's size, colour, and other features. It also shapes an animal’s actions and behavior patterns. The most important behaviors are "),
          blank('vocab_q3__b3', ['intuitive', 'instinctive', 'acquired', 'extrinsic']),
          text(' and inbuilt. In other words, the creature can perform the action without having to learn what to do and how to do it by '),
          blank('vocab_q3__b4', ['effort', 'trial', 'attempt', 'encouragement']),
          text(' and error.')
        ]),
        mc('vocab', 'vocab_q4', 4, [
          text('DNA is a molecule that does two things. First, it acts as the '),
          blank('vocab_q4__b1', ['nutritional', 'metabolic', 'hereditary', 'building']),
          text(' material, which is passed '),
          blank('vocab_q4__b2', ['down', 'around', 'by', 'out']),
          text(' from generation to generation. Second, it directs, to a considerable extent, the construction of our bodies, telling our cells what kinds of molecules to make and guiding our development from a single-celled zygote to a fully formed adult. These two things are, of course, connected. The DNA sequences that construct the best bodies are more likely to get passed down to the next generation because well-constructed bodies are more likely to '),
          blank('vocab_q4__b3', ['multiply', 'exist', 'survive', 'wither']),
          text(' and thus to reproduce. This is Darwin’s '),
          blank('vocab_q4__b4', ['thesis', 'hypothesis', 'statement', 'theory']),
          text(' of natural selection stated in the language of DNA.')
        ])
      ]
    },
    {
      id: 'grammar', titleVi: 'III. Grammar (NGỮ PHÁP)', instructionVi: GRAMMAR_INSTRUCTION,
      questions: [
        mc('grammar', 'grammar_q1', 1, [
          text('Philosophy for Children is '),
          blank('grammar_q1__b1', ['designed', 'designs', 'design', 'designing']),
          text(' to help children become more willing and able to question, reason, construct arguments, and collaborate. Dialogues are based on concepts such as ‘truth’, ‘fairness’, or ‘bullying’. In a typical lesson, pupils and teachers sit together in a circle and the teacher begins by presenting a stimulus, '),
          blank('grammar_q1__b2', ['why', 'which', 'what', 'who']),
          text(' could be a video clip, image or newspaper article to provoke pupils’ interest. This is generally followed by some silent thinking time before the class splits into groups to think of questions that '),
          blank('grammar_q1__b3', ['interestingly', 'interesting', 'interests', 'interest']),
          text(' them. A certain question with philosophical potential is then selected by the group to stimulate a whole-class discussion. These discussions are supported by activities '),
          blank('grammar_q1__b4', ['in', 'for', 'to', 'by']),
          text(' develop children’s skills '),
          blank('grammar_q1__b5', ['in', 'around', 'on', 'to']),
          text(' reasoning and their understanding of concepts.')
        ]),
        mc('grammar', 'grammar_q2', 2, [
          text('Traditionally, the analysis of music is a solitary activity, completed by individual theorists, performers, or conductors before their interpretations are disseminated through writing, presentation, or performance. A similar model is often used for teaching analysis: students are given the context in which a piece was composed, taught the most appropriate analytical approaches, and then asked to complete their analysis on their own, usually outside of class time as a homework assignment. '),
          blank('grammar_q2__b1', ['Moreover', 'However', 'Therefore', 'Additionally']),
          text(', recent research into cognitive science has found that students learn better in a group than '),
          blank('grammar_q2__b2', ['individualized', 'individuals', 'individually', 'individual']),
          text(', coining the concept “collective general intelligence” to describe a group’s ability to perform better on complex tasks such as solving puzzles, making moral judgments, and brainstorming. In education fields, this concept has been applied to “peer learning” in '),
          blank('grammar_q2__b3', ['who', 'what', 'where', 'which']),
          text(' students learn from other students by participating in communal activities, discussions, and tasks and this has also been shown to result in more effective learning than the traditional solitary method of learning. These more active and collaborative forms of learning are able to better provide conceptual understanding and long-term knowledge retention '),
          blank('grammar_q2__b4', ['and', 'because', 'however', 'so']),
          text(' students are placed at the center of their own learning.')
        ]),
        mc('grammar', 'grammar_q3', 3, [
          text('Colorful poison frogs in the Amazon owe their great diversity to ancestors that leapt into the region from the Andes Mountains several times during the last 10 million years, a new study from The University of Texas at Austin suggests. This is the first study to show that the Andes '),
          blank('grammar_q3__b1', ['had been', 'have been', 'will be', 'has been']),
          text(' a major source of diversity for the Amazon basin, one of the largest reservoirs of '),
          blank('grammar_q3__b2', ['biologically', 'biologist', 'biology', 'biological']),
          text(' diversity on Earth. The finding runs counter thoroughly to the idea that Amazonian diversity is the result of evolution only within the tropical forest itself.')
        ]),
        mc('grammar', 'grammar_q4', 4, [
          text("Dogs make great listeners. And that may be because man and man's best friend use analogous brain regions to process voices. Researchers collected almost 200 sound samples, including human and canine vocalizations, as well as environmental noises and silence. They "),
          blank('grammar_q4__b1', ['will play', 'played', 'have played', 'play']),
          text(" these clips to 22 people and 11 dogs while the subjects' brains "),
          blank('grammar_q4__b2', ['will undergo', 'were undergoing', 'underwent', 'undergo']),
          text(' functional MRI scans. Human brains tuned in most to vocal sounds. Dog brains were most sensitive to environmental noises. '),
          blank('grammar_q4__b3', ['Similarly', 'In conclusion', 'Consquently', 'Nevertheless']),
          text(", they still had a lot in common. A dedicated brain area reacted strongly to the vocalizations of their own species. That area also responded to the voices of the other species. Meanwhile, a different brain region noted emotion in a voice, with a strong response to cheery sounds like laughter and a weaker reaction to unhappy noises like canine whining. The study is in the journal Current Biology. It seems that thousands of years of domestication "),
          blank('grammar_q4__b4', ['will make', 'has made', 'made', 'have made']),
          text(' our furry friends sensitive to the same vocal cues we are. You can confide in Fido.')
        ])
      ]
    },
    {
      id: 'listen_write', titleVi: 'IV. Nghe & Viết', instructionVi: LISTEN_INSTRUCTION,
      questions: [
        fill('listen_write', 'listen_write_q1', 1, 'database/Entrance Test/Listening Q1.mp3', [
          text('So every year influenza does strike. It '),
          blank('listen_write_q1__b1'),
          text(" seasonal flu outbreaks and that's caused by new influenza strains. It affects about 5 to 20% of US residents, and 200,000 people become "),
          blank('listen_write_q1__b2'),
          text(' each year and 36,000 people die from flu. And sometimes, flu viruses can actually '),
          blank('listen_write_q1__b3'),
          text(' to form novel viruses. We worry about novel influenza subtypes because they can cause pandemics and a pandemic is a '),
          blank('listen_write_q1__b4'),
          text(' '),
          blank('listen_write_q1__b5'),
          text(" of a disease. The most severe influenza pandemic in the last century occurred in 1918. And it was caused by a flu virus called H1N1. It began in the United States around September 14, and within five weeks, it’d "),
          blank('listen_write_q1__b6'),
          text(' '),
          blank('listen_write_q1__b7'),
          text(" the entire United States. It's estimated that 20 to 100 million people died worldwide from this disease that year and it included 500,000 Americans.")
        ]),
        fill('listen_write', 'listen_write_q2', 2, 'database/Entrance Test/Listening Q2.mp3', [
          text("The term that's "),
          blank('listen_write_q2__b1'),
          text(' '),
          blank('listen_write_q2__b2'),
          text(' now is post-antibiotic era. And I guess the question is, what does that mean? To put it in '),
          blank('listen_write_q2__b3'),
          text(", in the 1920s and 30s, we didn't have antibiotics so if people got seriously "),
          blank('listen_write_q2__b4'),
          text(' they either survived because of their own immunity or they died. And we call that the pre-antibiotic era. What has actually happened is that we got a lot of antibiotics, particularly in the 50s but 60s, 70s, 80s. So much so that a US Secretary of Health or Surgeon General said that the era of '),
          blank('listen_write_q2__b5'),
          text(" was over because we have all these drugs to cure all these things. Well, what has actually happened is we've gone into a post-antibiotic era with some "),
          blank('listen_write_q2__b6'),
          text('. For a lot of people with very '),
          blank('listen_write_q2__b7'),
          text(" infections, we're back in the 1920s because we don't have effective antibiotics that "),
          blank('listen_write_q2__b8'),
          text('.')
        ])
      ]
    }
  ]
};

export function normalizeDemoData(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) {
    throw new TypeError('Demo D content fixture is invalid');
  }
  return {
    ...raw,
    sections: raw.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => ({
        ...question,
        instructionVi: question.instructionVi || section.instructionVi,
        parts: question.parts
          ? question.parts.map((part) => ({ ...part, options: part.options ? [...part.options] : part.options }))
          : question.parts
      }))
    }))
  };
}

export const NORMALIZED_DEMO_DATA = normalizeDemoData(DEMO_DATA);
