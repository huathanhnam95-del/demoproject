
import os

file_path = r'c:\Cursor AI\style.css'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the blocks to find (using exact newlines from what we saw, but assuming \n)
# We'll use replace() on the string which is simpler if we match the block.

old_block_visible = """.srs-writing-modal.visible {
  display: flex;
  opacity: 1;
  background-color: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
}"""

new_block_visible = """.srs-writing-modal.visible {
  display: flex;
  opacity: 1;
  background-color: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}"""

old_block_content = """.srs-writing-content {
  background: white;
  width: 600px;
  max-width: 90%;
  border-radius: 20px;
  padding: 32px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
  text-align: center;
  transform: scale(0.9) translateY(30px);
  opacity: 0;
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.2);
}"""

new_block_content = """.srs-writing-content {
  background: white;
  width: 600px;
  max-width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  text-align: center;
  transform: scale(0.9) translateY(30px);
  opacity: 0;
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.2);
}"""

# Normalize line endings just in case? Or just try direct replace
if old_block_visible in content:
    content = content.replace(old_block_visible, new_block_visible)
    print("Replaced .srs-writing-modal.visible")
else:
    print("Could not find .srs-writing-modal.visible block")
    # Try loosening the match if needed, but let's see.

if old_block_content in content:
    content = content.replace(old_block_content, new_block_content)
    print("Replaced .srs-writing-content")
else:
    print("Could not find .srs-writing-content block")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
