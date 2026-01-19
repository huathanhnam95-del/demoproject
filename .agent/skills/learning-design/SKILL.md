---
name: learning-design
description: Instructional design principles for creating effective educational content and learning experiences. Use when building lessons, exercises, or educational features.
---

# Learning Design Skill

This skill covers **instructional design principles** for creating effective learning experiences in the dictation practice app.

---

## Gagne's Nine Events of Instruction

A proven framework for structuring learning activities:

| Event | Purpose | Implementation |
|-------|---------|----------------|
| 1. **Gain Attention** | Focus learner | Sound effect, animation, provocative question |
| 2. **State Objectives** | Set expectations | "By the end, you'll be able to..." |
| 3. **Recall Prior Knowledge** | Build connections | "You already know the word 'phone'..." |
| 4. **Present Content** | Deliver new info | Audio, text, visuals |
| 5. **Provide Guidance** | Support learning | Hints, scaffolding, examples |
| 6. **Elicit Practice** | Active engagement | Typing, speaking, quizzes |
| 7. **Give Feedback** | Correct errors | Immediate, specific feedback |
| 8. **Assess Performance** | Measure learning | Scores, completion rates |
| 9. **Enhance Retention** | Long-term memory | SRS, spaced practice |

---

## Lesson Structure Template

```javascript
const lessonTemplate = {
    // 1. Hook - Gain attention
    hook: {
        type: 'challenge',
        content: 'Can you spell this word?',
        audio: 'difficult-word.mp3'
    },
    
    // 2. Objectives
    objectives: [
        'Recognize the word by sound',
        'Spell the word correctly',
        'Use it in a sentence'
    ],
    
    // 3. Prior knowledge
    priorKnowledge: {
        relatedWords: ['similar', 'synonym'],
        rootWord: 'Latin root meaning...'
    },
    
    // 4. Content presentation
    content: {
        word: 'anonymous',
        pronunciation: '/əˈnɒnɪməs/',
        definition: 'not identified by name',
        examples: ['an anonymous donor']
    },
    
    // 5. Guided practice
    guidedPractice: {
        hints: 3,
        showFirstLetter: true,
        playbackSpeed: 0.75
    },
    
    // 6. Independent practice
    independentPractice: {
        hints: 0,
        attempts: 3
    },
    
    // 7-8. Assessment
    assessment: {
        type: 'spelling',
        passingScore: 80
    },
    
    // 9. Retention
    retention: {
        addToSRS: true,
        reviewIn: '1 day'
    }
};
```

---

## Active Learning Strategies

### 1. Retrieval Practice

```javascript
// Force recall rather than recognition
function testWord(word) {
    // Good: Open-ended
    playAudio(word.audio);
    promptUser('Type what you heard');
    
    // Less effective: Multiple choice
    // showOptions([word, decoy1, decoy2, decoy3]);
}
```

### 2. Interleaving

```javascript
// Mix different types of practice
function generatePracticeSession(words, mode) {
    const activities = [
        { type: 'listen-type', weight: 0.4 },
        { type: 'pronunciation', weight: 0.3 },
        { type: 'sentence-context', weight: 0.2 },
        { type: 'definition-match', weight: 0.1 }
    ];
    
    return shuffleWithWeights(words, activities);
}
```

### 3. Elaboration

```javascript
// Connect new learning to existing knowledge
function elaborateWord(newWord) {
    return {
        word: newWord,
        connections: [
            `Related to: ${findRelatedWords(newWord)}`,
            `Root meaning: ${getEtymology(newWord)}`,
            `Similar sounding: ${findSimilarSounds(newWord)}`
        ]
    };
}
```

---

## Feedback Design

### Immediate Corrective Feedback

```javascript
function provideFeedback(expected, actual, attempt) {
    const isCorrect = expected.toLowerCase() === actual.toLowerCase();
    
    if (isCorrect) {
        return {
            type: 'success',
            message: getRandomPraise(),
            points: calculatePoints(attempt)
        };
    }
    
    // Scaffolded error feedback
    const errors = findDifferences(expected, actual);
    
    if (attempt === 1) {
        return {
            type: 'hint',
            message: 'Not quite. Listen again carefully.',
            highlight: null
        };
    }
    
    if (attempt === 2) {
        return {
            type: 'specific',
            message: `Check the ${errors[0].position} of the word.`,
            highlight: errors[0].position
        };
    }
    
    return {
        type: 'reveal',
        message: `The correct answer is: ${expected}`,
        showAnswer: true,
        explanation: getExplanation(expected, errors)
    };
}
```

### Praise Variety

```javascript
const praiseMessages = {
    perfect: ['Perfect!', 'Excellent!', 'Outstanding!'],
    good: ['Great job!', 'Well done!', 'Nice work!'],
    improved: ['Getting better!', 'Improvement!', 'Progress!']
};
```

---

## Motivation Design

### Autonomy

```javascript
// Give learners control
const learnerChoices = {
    topicSelection: true,
    difficultyLevel: true,
    practiceOrder: true,
    sessionLength: [5, 10, 15, 20] // minutes
};
```

### Competence

```javascript
// Show progress and mastery
function displayProgress(user) {
    return {
        wordsLearned: user.masteredWords.length,
        currentStreak: user.streak,
        levelProgress: (user.xp % 1000) / 10, // percentage
        badges: user.achievements
    };
}
```

### Relatedness

```javascript
// Connect to personal goals
const learnerGoals = {
    pte: 'Prepare for PTE Academic exam',
    toefl: 'Practice for TOEFL listening',
    general: 'Improve English vocabulary'
};
```

---

## Cognitive Load Management

### Extraneous Load (Reduce)

- Remove decorative elements that don't aid learning
- Use consistent, simple layouts
- Minimize distractions during practice

### Intrinsic Load (Manage)

- Break complex content into chunks
- Sequence from simple to complex
- Use worked examples before practice

### Germane Load (Increase)

- Prompt learners to make connections
- Encourage self-explanation
- Vary practice contexts

---

## Checklist

- [ ] Clear learning objectives stated upfront
- [ ] Prior knowledge activated before new content
- [ ] Content chunked into manageable pieces
- [ ] Active practice opportunities provided
- [ ] Immediate, specific feedback given
- [ ] Progress visible to learner
- [ ] Content added to SRS for retention
