const fs = require('fs');

try {
    let html = fs.readFileSync('public/index.html', 'utf8');

    const searchTarget = /<div class="question-filters-row">\s*<div class="status-filter-dropdown" id="status-filter-container-notes">/;

    if (!searchTarget.test(html)) {
        console.error("Target NOT FOUND in HTML");
        process.exit(1);
    }

    const replacement = `<div class="question-filters-row">
            <!-- Difficulty Filter -->
            <div id="difficulty-filter-container-notes" class="difficulty-filter-dropdown" style="display: none;">
              <button id="difficulty-filter-btn-notes" class="difficulty-filter-btn" type="button">
                <span id="difficulty-filter-label-notes">Filter by Difficulty</span>
                <span class="filter-arrow">▼</span>
              </button>
              <div id="difficulty-filter-menu-notes" class="difficulty-filter-menu" style="display: none;">
                <div class="filter-option selected" data-value="all">
                  <span class="filter-option-icon">📋</span>
                  <span class="filter-option-text">All Levels</span>
                </div>
                <div class="filter-option" data-value="1">
                  <span class="filter-option-icon">🟢</span>
                  <span class="filter-option-text">Level 1 <span class="difficulty-tag easy">Easy</span></span>
                </div>
                <div class="filter-option" data-value="2">
                  <span class="filter-option-icon">🟡</span>
                  <span class="filter-option-text">Level 2 <span class="difficulty-tag medium">Medium</span></span>
                </div>
                <div class="filter-option" data-value="3">
                  <span class="filter-option-icon">🔴</span>
                  <span class="filter-option-text">Level 3 <span class="difficulty-tag hard">Hard</span></span>
                </div>
              </div>
            </div>

            <div class="status-filter-dropdown" id="status-filter-container-notes">`;

    html = html.replace(searchTarget, replacement);
    fs.writeFileSync('public/index.html', html);
    console.log("SUCCESS");
} catch (e) {
    console.error(e);
}
