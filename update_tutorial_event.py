
import os

file_path = r'c:\Cursor AI\tutorial.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Step 3 fix (wait for event)
step3_search = """            {
                target: '#watch-player-wrapper',
                icon: '👀',
                title: 'Step 3: Watching',
                text: 'Watch carefully! The first question will pop up automatically in about 20 seconds...',
                position: 'bottom',
                nextLabel: null,
                interactive: false,
                autoAdvance: 23000, // Wait 23 seconds for video to play to the first question
            },"""

step3_new = """            {
                target: '#watch-player-wrapper',
                icon: '👀',
                title: 'Step 3: Watching',
                text: 'Watch carefully! The video will pause when a question appears.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'watch-question-triggered'
            },"""

# Step 4 fix (remove mock trigger)
step4_search_start = """            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Step 4: Pop-up Questions',"""
                
step4_new_content = """            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Step 4: Pop-up Questions',
                text: 'Look! A question appeared. This happens automatically when you reach a key moment in the video.',
                position: 'left',
                nextLabel: 'How to Answer →',
                beforeShow: () => {
                   // The question is already triggered by the real video event in Step 3!
                }
            },"""

if step3_search in content:
    content = content.replace(step3_search, step3_new)
    print("Replaced Step 3")
else:
    print("Step 3 search block not found exactly. Trying simpler replace.")
    # Fallback to simple replace of autoAdvance line if block fails
    content = content.replace("autoAdvance: 23000, // Wait 23 seconds for video to play to the first question", "interactive: true,\n                waitForEvent: 'watch-question-triggered'")
    content = content.replace("text: 'Watch carefully! The first question will pop up automatically in about 20 seconds...',", "text: 'Watch carefully! The video will pause when a question appears.',")


# For Step 4, we need to be careful with the function body. 
# We'll just look for the beforeShow block and empty it if it contains triggerTutorialQuestion
import re
step4_regex = r"(title: 'Step 4: Pop-up Questions'.*?beforeShow: \(\) => \{)([\s\S]*?)(\})"
match = re.search(step4_regex, content, re.DOTALL)
if match:
    # Check if inside contains triggerTutorialQuestion
    if "triggerTutorialQuestion" in match.group(2):
        new_step4 = match.group(1) + "\n                   // Question triggered by event\n                " + match.group(3)
        content = content.replace(match.group(0), new_step4)
        print("Updated Step 4 beforeShow")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
