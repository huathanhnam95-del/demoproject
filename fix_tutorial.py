
import os

file_path = r'c:\Cursor AI\tutorial.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Step 2 fix
step2_old = """            {
                target: '#watch-player-wrapper',
                icon: '▶️',
                title: 'Step 2: Watch & Listen',
                text: 'The video will play automatically. Pay attention to what is being said!',
                position: 'bottom',
                nextLabel: 'Next →',
                beforeShow: () => {
                    // Simulate selecting the first video
                    const firstCard = document.querySelector('.watch-video-card');
                    if (firstCard) {
                        firstCard.click();
                    } else if (window.WatchMode && window.WatchMode.selectVideo) {
                        // Fallback if DOM not ready
                        window.WatchMode.selectVideo('video-0');
                    }
                }
            },"""

step2_new = """            {
                target: '#watch-player-wrapper',
                icon: '▶️',
                title: 'Step 2: Watch & Listen',
                text: 'Click <strong>Play</strong> to start watching. Questions will pop up automatically!',
                position: 'bottom',
                nextLabel: 'Next →',
                beforeShow: () => {
                    // Simulate selecting the first video
                    const firstCard = document.querySelector('.watch-video-card');
                    if (firstCard) {
                        firstCard.click();
                    } else if (window.WatchMode && window.WatchMode.selectVideo) {
                        // Fallback if DOM not ready
                        window.WatchMode.selectVideo('video-0');
                    }
                }
            },"""

# Step 3 fix
step3_old = """            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Step 3: Pop-up Questions',
                text: 'Questions will appear automatically at key moments. Let\\'s try a practice question now!',
                position: 'left',
                nextLabel: 'Try It →',
                beforeShow: () => {
                   // Ensure panel is hidden first to show the "pop-up" effect
                   const panel = document.getElementById('watch-question-panel');
                   if (panel) panel.style.display = 'none';
                }
            },"""

step3_new = """            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Step 3: Pop-up Questions',
                text: 'Look! A question appeared. This happens automatically when you reach a key moment in the video.',
                position: 'left',
                nextLabel: 'How to Answer →',
                beforeShow: () => {
                   // Trigger simulated question NOW to ensure the panel (target) is visible
                   if (window.WatchMode && window.WatchMode.triggerTutorialQuestion) {
                        window.WatchMode.triggerTutorialQuestion({
                            id: 'tutorial-q1',
                            questionText: 'What falls from the sky during a storm?',
                            questionType: 'multiple_choice',
                            options: ['Rain', 'Cats', 'Pianos'],
                            correctAnswer: 0,
                            allowSkip: false
                        });
                    }
                }
            },"""

if step2_old in content:
    content = content.replace(step2_old, step2_new)
    print("Replaced Step 2")
else:
    print("Step 2 not found")

if step3_old in content:
    content = content.replace(step3_old, step3_new)
    print("Replaced Step 3")
else:
    print("Step 3 not found")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
