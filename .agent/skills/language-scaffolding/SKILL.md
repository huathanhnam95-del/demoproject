---
name: language-scaffolding
description: Pedagogical patterns for supporting English language learners through scaffolding, ZPD-based design, and effective practice activities. Use when building vocabulary, pronunciation, or dictation features.
---

# Language Scaffolding Skill

This skill covers **pedagogical techniques** for designing effective English learning features based on language acquisition research and Vygotsky's Zone of Proximal Development (ZPD).

---

## Core Concept: Zone of Proximal Development

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│     Too Hard (Frustration Zone)                     │
│     ═══════════════════════════                     │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │   ZPD: Zone of Proximal Development           │  │
│  │   (Learning happens HERE with support)        │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│     Current Ability (Comfort Zone)                  │
│     ══════════════════════════════                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key principle**: Effective learning occurs when tasks are slightly above the learner's current ability, with appropriate support (scaffolding) that is gradually removed.

---

## Scaffolding Types

### 1. Verbal Scaffolds

| Technique | Implementation |
|-----------|---------------|
| **Model pronunciation** | Play native audio before user attempts |
| **Slow, clear speech** | Adjustable playback speed (0.75x, 1x) |
| **Think-alouds** | Show IPA breakdown while audio plays |
| **Contextual definitions** | Display word in example sentence |

### 2. Procedural Scaffolds

| Technique | Implementation |
|-----------|---------------|
| **Visual aids** | Mouth diagrams, IPA symbols, stress marks |
| **Graphic organizers** | Syllable breakdown, word stress patterns |
| **Sentence frames** | "The word ___means___" |
| **Wait time** | 3-5 second pause before showing answer |

### 3. Instructional Scaffolds

| Technique | Implementation |
|-----------|---------------|
| **Pre-teach vocabulary** | Show word + definition before dictation |
| **Activate prior knowledge** | "You know 'phone', this has same root" |
| **Chunk content** | Break long sentences into phrases |
| **Gradual release** | I do → We do → You do |

---

## Gradual Release Model

```javascript
// Progressive difficulty levels
const scaffoldingLevels = {
    // Level 1: Maximum support ("I Do")
    guided: {
        showWord: true,
        showIPA: true,
        showDefinition: true,
        playbackSpeed: 0.75,
        hintsAvailable: 3,
        attemptsAllowed: 5
    },
    
    // Level 2: Shared practice ("We Do")
    supported: {
        showWord: false,
        showIPA: true,
        showDefinition: true,
        playbackSpeed: 1.0,
        hintsAvailable: 1,
        attemptsAllowed: 3
    },
    
    // Level 3: Independent ("You Do")
    independent: {
        showWord: false,
        showIPA: false,
        showDefinition: false,
        playbackSpeed: 1.0,
        hintsAvailable: 0,
        attemptsAllowed: 1
    }
};
```

---

## Vocabulary Scaffolding Patterns

### Pre-Teaching New Words

```javascript
function preTeachWord(word) {
    return {
        // 1. Visual: Show word clearly
        display: word.text,
        
        // 2. Audio: Native pronunciation
        audio: word.audioUrl,
        
        // 3. Definition: Clear, simple language
        definition: word.definition,
        
        // 4. Context: Example sentence
        example: word.exampleSentence,
        
        // 5. Connection: Related known words
        related: word.collocations.slice(0, 3),
        
        // 6. Visual aid: Image if available
        image: word.imageUrl
    };
}
```

### Word Stress Visualization

```javascript
function visualizeStress(word, stressPattern) {
    // Example: "anonymous" → "a-NON-y-mous"
    const syllables = splitSyllables(word);
    return syllables.map((syl, i) => ({
        text: syl,
        isStressed: stressPattern[i] === 1,
        // Visual emphasis for stressed syllable
        style: stressPattern[i] === 1 
            ? 'text-lg font-bold text-accent' 
            : 'text-sm text-muted'
    }));
}
```

---

## Pronunciation Practice Activities

### 1. Minimal Pairs

```javascript
const minimalPairExercise = {
    type: 'minimal-pair',
    target: '/θ/ vs /ð/',
    pairs: [
        { a: 'thin', b: 'then' },
        { a: 'bath', b: 'bathe' },
        { a: 'breath', b: 'breathe' }
    ],
    activity: 'Listen and tap the word you hear'
};
```

### 2. Shadowing Exercise

```javascript
async function shadowingExercise(audio, transcript) {
    // 1. Play model audio
    await playAudio(audio);
    
    // 2. Brief pause (500ms)
    await wait(500);
    
    // 3. Record user's shadowing
    const userAudio = await recordUser();
    
    // 4. Compare with Praat analysis
    const comparison = await analyzeComparison(audio, userAudio);
    
    // 5. Provide scaffolded feedback
    return generateFeedback(comparison);
}
```

### 3. Progressive Dictation

```javascript
const dictationLevels = [
    {
        level: 1,
        name: 'Word Level',
        scaffold: 'Single words, shown spelling, multiple replays'
    },
    {
        level: 2,
        name: 'Phrase Level',
        scaffold: 'Short phrases (3-4 words), first letter hints'
    },
    {
        level: 3,
        name: 'Sentence Level',
        scaffold: 'Full sentences, no visual hints'
    },
    {
        level: 4,
        name: 'Passage Level',
        scaffold: 'Connected speech, natural speed'
    }
];
```

---

## Feedback Scaffolding

### Constructive Error Correction

```javascript
function generateScaffoldedFeedback(expected, actual, attempt) {
    const errors = findErrors(expected, actual);
    
    // First attempt: Gentle hint
    if (attempt === 1) {
        return {
            type: 'hint',
            message: `Almost! Listen again to the ${errors[0].position} part.`,
            highlight: errors[0].position
        };
    }
    
    // Second attempt: More specific
    if (attempt === 2) {
        return {
            type: 'specific',
            message: `The word "${errors[0].word}" starts with "${errors[0].expected[0]}".`,
            showFirstLetter: true
        };
    }
    
    // Third attempt: Show correct answer with explanation
    return {
        type: 'reveal',
        message: `The correct word is "${errors[0].expected}".`,
        showAnswer: true,
        playSlowAudio: true
    };
}
```

---

## Adaptive Difficulty

### ZPD-Based Progression

```javascript
function adjustDifficulty(performance) {
    const recentAccuracy = calculateRecentAccuracy(performance, 10);
    
    if (recentAccuracy > 0.85) {
        // Learner is in comfort zone - increase challenge
        return 'increase';
    } else if (recentAccuracy < 0.60) {
        // Learner is frustrated - add more support
        return 'decrease';
    } else {
        // Learner is in ZPD - maintain
        return 'maintain';
    }
}

function applyDifficultyAdjustment(currentLevel, adjustment) {
    switch (adjustment) {
        case 'increase':
            return {
                ...currentLevel,
                hintsAvailable: Math.max(0, currentLevel.hintsAvailable - 1),
                playbackSpeed: Math.min(1.25, currentLevel.playbackSpeed + 0.1)
            };
        case 'decrease':
            return {
                ...currentLevel,
                hintsAvailable: currentLevel.hintsAvailable + 1,
                playbackSpeed: Math.max(0.75, currentLevel.playbackSpeed - 0.1)
            };
        default:
            return currentLevel;
    }
}
```

---

## Sentence Frames for Practice

### Speaking Practice

```javascript
const sentenceFrames = {
    definition: "The word '___' means '___'.",
    pronunciation: "I hear the sound /___/ in the word '___'.",
    comparison: "'___' sounds like '___' but starts with /___/.",
    usage: "I can use '___' when I want to say '___'."
};
```

### Writing Challenge Starters

```javascript
const writingPrompts = {
    beginner: {
        prompt: "Complete the sentence using '{word}':",
        starter: "The ___",  // Minimal scaffold
        wordBank: true
    },
    intermediate: {
        prompt: "Write a sentence using '{word}':",
        starter: null,  // No scaffold
        wordBank: false
    },
    advanced: {
        prompt: "Use '{word}' and '{collocation}' in a sentence:",
        starter: null,
        wordBank: false
    }
};
```

---

## Implementation Checklist

- [ ] Pre-teach vocabulary before challenging activities
- [ ] Provide audio at multiple speeds (0.75x, 1x, 1.25x)
- [ ] Show IPA/phonetic breakdown for difficult words
- [ ] Use progressive hints (gentle → specific → reveal)
- [ ] Track accuracy to detect ZPD and adjust difficulty
- [ ] Offer sentence frames for speaking/writing practice
- [ ] Connect new words to known vocabulary
- [ ] Allow sufficient wait time before revealing answers
- [ ] Celebrate small wins to build confidence
