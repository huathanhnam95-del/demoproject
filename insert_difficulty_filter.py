"""Insert difficulty filter HTML into index.html - Line-by-line approach"""

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The HTML to insert (Type mode)
difficulty_filter_type = """
            <!-- Unlockable Difficulty Filter (Type mode) -->
            <div id="difficulty-filter-container-type" class="difficulty-filter-dropdown" style="display: none;">
              <button id="difficulty-filter-btn-type" class="difficulty-filter-btn" type="button">
                <span id="difficulty-filter-label-type">Filter by Difficulty</span>
                <span class="filter-arrow">▼</span>
              </button>
              <div id="difficulty-filter-menu-type" class="difficulty-filter-menu" style="display: none;">
                <div class="filter-option selected" data-value="all">
                  <span class="filter-option-icon">🎚️</span>
                  <span class="filter-option-text">All Levels</span>
                </div>
                <div class="filter-option" data-value="1">
                  <span class="filter-option-icon">🥉</span>
                  <span class="filter-option-text">Level 1 <span class="difficulty-tag easy">Easy</span></span>
                </div>
                <div class="filter-option" data-value="2">
                  <span class="filter-option-icon">🥈</span>
                  <span class="filter-option-text">Level 2 <span class="difficulty-tag medium">Medium</span></span>
                </div>
                <div class="filter-option" data-value="3">
                  <span class="filter-option-icon">🥇</span>
                  <span class="filter-option-text">Level 3 <span class="difficulty-tag hard">Hard</span></span>
                </div>
              </div>
            </div>
"""

# The HTML to insert (Speak mode)
difficulty_filter_speak = """
            <!-- Unlockable Difficulty Filter (Speak mode) -->
            <div id="difficulty-filter-container-speak" class="difficulty-filter-dropdown" style="display: none;">
              <button id="difficulty-filter-btn-speak" class="difficulty-filter-btn" type="button">
                <span id="difficulty-filter-label-speak">Filter by Difficulty</span>
                <span class="filter-arrow">▼</span>
              </button>
              <div id="difficulty-filter-menu-speak" class="difficulty-filter-menu" style="display: none;">
                <div class="filter-option selected" data-value="all">
                  <span class="filter-option-icon">🎚️</span>
                  <span class="filter-option-text">All Levels</span>
                </div>
                <div class="filter-option" data-value="1">
                  <span class="filter-option-icon">🥉</span>
                  <span class="filter-option-text">Level 1 <span class="difficulty-tag easy">Easy</span></span>
                </div>
                <div class="filter-option" data-value="2">
                  <span class="filter-option-icon">🥈</span>
                  <span class="filter-option-text">Level 2 <span class="difficulty-tag medium">Medium</span></span>
                </div>
                <div class="filter-option" data-value="3">
                  <span class="filter-option-icon">🥇</span>
                  <span class="filter-option-text">Level 3 <span class="difficulty-tag hard">Hard</span></span>
                </div>
              </div>
            </div>
"""

# Find insertion points by searching for the length-filter closing divs
# We search for the line containing the closing tag of the length filter container

new_lines = []
i = 0
type_inserted = False
speak_inserted = False

while i < len(lines):
    line = lines[i]
    new_lines.append(line)
    
    # For Type mode: look for the closing </div> of length-filter-container-type
    if not type_inserted and 'id="length-filter-container-type"' in line:
        # Found the start, now find where it closes (after the menu closes)
        j = i + 1
        div_count = 1  # We're inside the container
        while j < len(lines) and div_count > 0:
            new_lines.append(lines[j])
            if '<div' in lines[j]:
                div_count += 1
            if '</div>' in lines[j]:
                div_count -= 1
            j += 1
        # Now j is after the closing </div>, insert the difficulty filter
        new_lines.append(difficulty_filter_type)
        type_inserted = True
        i = j - 1  # Continue from where we left off
        print(f"✅ Inserted difficulty filter for Type mode after line {j}")
    
    # For Speak mode: look for the closing </div> of length-filter-container-speak
    if not speak_inserted and 'id="length-filter-container-speak"' in line:
        # Found the start, now find where it closes
        j = i + 1
        div_count = 1
        while j < len(lines) and div_count > 0:
            new_lines.append(lines[j])
            if '<div' in lines[j]:
                div_count += 1
            if '</div>' in lines[j]:
                div_count -= 1
            j += 1
        # Insert the difficulty filter
        new_lines.append(difficulty_filter_speak)
        speak_inserted = True
        i = j - 1
        print(f"✅ Inserted difficulty filter for Speak mode after line {j}")
    
    i += 1

if not type_inserted:
    print("❌ Could not find length-filter-container-type")
if not speak_inserted:
    print("❌ Could not find length-filter-container-speak")

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Done!")
