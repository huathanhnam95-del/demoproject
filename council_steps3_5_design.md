# 3-Local-LLM Council Consensus Specification: Guided Write Essay Steps 3–5

**Date**: 2026-09-04 22:07:10

## 1. DeepSeek-R1 (Architectural & Cognitive Flow Proposal)

### Redesign Proposal for Steps 3, 4, and 5

#### Step 3: Language Kit
**Objective:** Create an interactive "Toolbelt" that provides quick access to vocabulary, collocations, sentence patterns, and linking words without nested boxes or walls of text.

**UI Architecture:**
- **Toolbelt Layout:** A horizontal scrollable bar at the top of the screen containing quick-access icons for each language component (Vocabulary, Collocations, Sentence Patterns, Linking Words).
- **Interactive Chips:** Each icon is a chip that, when clicked, opens a small, floating window with:
  - **Example Sentences:** Bilingual (English/Vietnamese) with target terms bolded.
  - **Toggleable Explanations:** A casual, contextual explanation of the term or pattern, with a lightbulb icon to expand/collapse.
  - **Practice Section:** Interactive exercises (e.g., fill-in-the-blanks, sentence completion) to reinforce learning.

**DOM Structure:**
```html
<div class="language-kit">
  <div class="toolbelt">
    <div class="chip vocabulary">Vocabulary</div>
    <div class="chip collocations">Collocations</div>
    <div class="chip patterns">Patterns</div>
    <div class="chip linking">Linking</div>
  </div>
  <div class="floating-info">
    <div class="info-window">
      <div class="example">
        <p><strong>Example:</strong> "The <span style="font-weight: bold;">efficient</span> use of time..." (Tiếng Việt: "Sử dụng <span style="font-weight: bold;">hiệu quả</span> thời gian...")</p>
      </div>
      <div class="explanation">
        <p><strong>Explanation:</strong> "Efficient" means...</p>
      </div>
      <div class="practice">
        <p>Complete the sentence: "It's important to be ______ in meetings."</p>
      </div>
    </div>
  </div>
</div>
```

#### Step 4: Make a Plan
**Objective:** Design an interactive visual roadmap that connects essay sections (Intro, Body 1, Body 2, Conclusion) with user ideas from Step 2.

**UI Architecture:**
- **Flowchart Layout:** A draggable and resizable flowchart where each section (Intro, Body 1, Body 2, Conclusion) is a node.
- **Visual Connectors:** Lines or arrows connecting the nodes to show the flow of ideas.
- **Interactive Badges:** Each node contains badges representing selected ideas from Step 2, with visual indicators of their relevance.

**DOM Structure:**
```html
<div class="essay-plan">
  <div class="flowchart">
    <div class="node intro">Intro</div>
    <div class="node body1">Body 1</div>
    <div class="node body2">Body 2</div>
    <div class="node conclusion">Conclusion</div>
    <div class="connector intro-body1"></div>
    <div class="connector body1-body2"></div>
    <div class="connector body2-conclusion"></div>
  </div>
  <div class="badges">
    <div class="badge idea1">Idea 1</div>
    <div class="badge idea2">Idea 2</div>
  </div>
</div>
```

#### Step 5: Sentence Builder
**Objective:** Create an interactive workshop where sentences flow into the essay draft, with a focus on seamless drafting.

**UI Architecture:**
- **Two-Column Layout:** Left column for sentence construction, right column for essay draft.
- **Sentence Construction Area:** A slot-filling card where users build sentences by dragging and dropping words or phrases.
- **Visual Flow:** Sentences transition from the construction area to the essay draft, with visual connectors showing the flow.

**DOM Structure:**
```html
<div class="sentence-builder">
  <div class="split-pane">
    <div class="left construction">
      <div class="sentence-template">
        <p>Topic: [Topic]</p>
        <p>Claim: [Claim]</p>
        <p>Example: [Example]</p>
      </div>
    </div>
    <div class="right draft">
      <div class="essay-editor">
        <p>Essay Draft:</p>
        <div class="draft

## 2. Qwen3 (Linguistic & Natural Vietnamese Phrasing Proposal)

**LINGUISTIC & NATURAL VIETNAMESE OVERHAUL FOR STEPS 3–5**  
*(Following all constraints: no nested boxes, no AI-robot phrases, bold/highlighted terms in both languages, real-world essay examples)*  

---

### **STEP 3: Language Kit**  
**Banned Phrases to Replace:**  
- ❌ "Công cụ lập luận" → ✅ "Từ vựng chính" / "Từ ghép thường gặp" / "Mẫu câu chuẩn" / "Từ nối linh hoạt"  
- ❌ "Khung hỗ trợ dàn ý" → ✅ "Từ vựng chính" / "Từ ghép thường gặp" / "Mẫu câu chuẩn" / "Từ nối linh hoạt"  
- ❌ "Chiến lược câu" → ✅ "Mẫu câu chuẩn" / "Cấu trúc câu phổ biến"  

**Natural Vietnamese Alternatives for Headers/Tabs:**  
- **Vocabulary** → **Từ vựng chính**  
- **Collocations** → **Từ ghép thường gặp**  
- **Grammar Models** → **Mẫu câu chuẩn**  
- **Linking Words** → **Từ nối linh hoạt**  

**<?> Toggle Explanations (Casual, Contextual):**  
- **"Từ vựng chính":**  
  - *English:* "Use **bold** terms like **'sustainable'** to show depth."  
  - *Vietnamese:* "Dùng **từ khóa mạnh** như **'bền vững'** để thể hiện góc nhìn sâu."  
- **"Từ ghép thường gặp":**  
  - *English:* "**'In addition'** works better than **'also'** in formal writing."  
  - *Vietnamese:* "**'Hơn nữa'** nghe trang trọng hơn **'còn'** trong bài luận."  
- **"Mẫu câu chuẩn":**  
  - *English:* "Try **'It is widely believed that...'** to start a paragraph."  
  - *Vietnamese:* "Dùng **'Người ta tin rằng...'** để mở đầu một đoạn."  
- **"Từ nối linh hoạt":**  
  - *English:* "**'However'** connects **'opposing views'** smoothly."  
  - *Vietnamese:* "**'Tuy nhiên'** giúp **'các quan điểm đối lập'** liên kết tự nhiên."  

**Bold/Highlight Rules for Step 3:**  
- **English terms** must be **bolded** (e.g., **'sustainable'**, **'In addition'**).  
- **Vietnamese terms** must be **highlighted** (e.g., **'bền vững'**, **'Hơn nữa'**).  
- **Both languages** must be **visually aligned** (e.g., **bold** in English, **highlighted** in Vietnamese).  

**Example Sentence (Real 79+ Essay Style):**  
- *English:* "The **benefits** of **renewable energy** are **clear** and **irrefutable**."  
- *Vietnamese:* "Lợi ích của **năng lượng tái tạo** là **rõ ràng** và **không thể chối cãi**."  

---

### **STEP 4: Make a Plan**  
**Banned Phrases to Replace:**  
- ❌ "Cán cân lập luận" → ✅ "Lập luận chính" / "Điểm mấu chốt" / "Cấu trúc bài luận"  
- ❌ "Mô hình hoá" → ✅ "Lập trình bài luận" / "Kế hoạch viết"  

**Natural Vietnamese Alternatives for Headers/Milestones:**  
- **Thesis** → **Lập luận chính**  
- **Body 1** → **Điểm mấu chốt 1**  
- **Body 2** → **Điểm mấu chốt 2**  
- **Conclusion** → **Kết luận**  

**Interactive Roadmap/Flowchart Design:**  
- **Visual Flow:**  
  - **Intro** (Lập luận chính) → **Body 1** (Điểm mấu chốt 1) → **Body 2** (Điểm mấu chốt 2) → **Conclusion** (Kết luận)  
- **Interactive Elements:**  
  - **Drag-and-drop** icons for **"Lập luận chính"** and **"Điểm mấu chốt"**.  
  - **Color-coded** connectors (e.g., **blue** for **Intro**, **green** for **Body 1**, **orange** for **Conclusion**).  

**Example Milestone (Real 79+ Essay Style):**  
- *English:* "Start with **'The most pressing issue...'** to set the **main argument**."  
- *Vietnamese:* "Bắt đầu bằng **'Vấn đề cấp bách nhất...'** để nêu **điểm chính**."  

---

### **STEP 5: Sentence Builder / Further**  
**Banned Phrases to Replace:**  
- ❌ "Khung hỗ trợ dàn ý" → ✅ "Xưởng câu" / "Khuôn mẫu câu"  
- ❌ "Chiến lược câu" → ✅ "Cấu trúc câu phổ biến" / "Mẫu câu chuẩn"  

**Natural Vietnamese Alternatives for Cues/Placeholders:**  
- **Fill-in-the-blank prompts:**  
  - *English:* "Use **'However'** to contrast **'previous point'** with **'new evidence'**."  
  - *Vietnamese:* "Dùng **'Tuy nhiên'** để đối lập **'điểm trước'** với **'bằng chứng mới'**."  
- **Action Buttons:**  
  - **"Thêm câu"** (Add sentence) → **"Thêm đoạn"** (Add paragraph)  
  - **"Tối ưu hoá"** (Optimize) → **"Làm mượt"** (Smooth it out)  

**Clean Interactive Workshop Design:**  
- **Visual Flow:**  
  - **Sentence builder** (Xưởng câu) → **Draft essay** (Bài luận nháp)  
- **

## 3. Gemma4 (Instructional Scaffolding & Learner UX Proposal)

As an expert in Instructional Scaffolding and Learner UX, I have designed the following interactive flow for the **Guided Write Essay** module. 

The core philosophy here is **"Action-Oriented Learning"**: we are moving the student from a passive reader of instructions to an active builder of an essay. We will replace "reading" with "selecting," "planning" with "mapping," and "drafting" with "assembling."

---

### Step 3: The "Toolbelt" (Language Kit)
*Goal: Move from a static dictionary to a curated "shopping list" of high-impact vocabulary.*

**UX Design & Interaction:**
*   **The Layout:** Instead of a list, use a **Horizontal Scroll or Grid of "Chips"** for categories (e.g., *Vocabulary, Collocations, Sentence Patterns*).
*   **The Interaction:**
    *   **Selection Mode:** When a user clicks a "Collocation" chip, it expands into a clean card. They can "Star" or "Pin" specific terms they intend to use. This creates a "Personalized Toolbelt" for the essay.
    *   **The <?> Toggle (The "Quick Peek"):** Instead of a pop-up, use a **hover-state or a small inline toggle**. 
        *   *Example:* "The **detrimental effects** (tác động tiêu cực) of social media..." 
        *   *Interaction:* Clicking `[?]` reveals a small, non-intrusive tooltip: *"Dùng cái này thay cho 'bad things' để nghe chuyên nghiệp hơn."* (Use this instead of 'bad things' to sound more professional).
    *   **Formula Slot Preview:** For sentence patterns, use a **"Plug-and-Play" visual**. 
        *   *Visual:* `[Subject] + [Verb] + [Object]`. 
        *   *Interaction:* Clicking a "Sentence Pattern" highlights the specific part of the sentence that is the "formula" (e.g., "It is often argued that...").

**Micro-interactions:**
*   **Commit Meter:** As users "Star" items, a small progress bar at the top of the screen fills up, signaling they are "arming" their vocabulary for the next step.
*   **Highlighting:** All target terms are **bolded and underlined** in both languages.

---

### Step 4: The "Blueprint" (Make a Plan)
*Goal: Transform a static outline into a visual logic flow.*

**UX Design & Interaction:**
*   **The Layout:** A **Linear Roadmap/Flowchart**. Instead of a list, the user sees a path: `Intro` $\rightarrow$ `Body 1` $\rightarrow$ `Body 2` $\rightarrow$ `Conclusion`.
*   **The Interaction:**
    *   **Node Exploration:** Each "Node" (e.g., Body 1) is a clickable circle. Clicking it expands a small, clean overlay (no extra boxes) showing the specific arguments.
    *   **Argument Logic:** Instead of "Argument 1," use **"Point & Support"** icons. 
        *   *Example:* [Point: Environment] $\rightarrow$ [Support: Plastic Waste].
    *   **The "Ready" Check:** Once a user clicks a node, they can tap a "Confirm" button. The node changes color (e.g., from grey to blue), and a small checkmark appears.
*   **Vietnamese Tone:** Use "Lên khung" (Set the frame) or "Sắp xếp ý" (Arrange ideas) instead of "Lập kế hoạch" (Make a plan).

**Micro-interactions:**
*   **Path Animation:** As a user confirms a node, a "pulse" animation travels along the line to the next node, visually guiding them through the essay structure.
*   **1-Click Copy:** A small icon next to each argument allows them to "copy" the core idea to their mental "clipboard" for the writing phase.

---

### Step 5: The "Workshop" (Sentence Builder)
*Goal: A seamless transition from "training wheels" to "full speed" writing.*

**UX Design & Interaction:**
*   **The Layout:** A **Split

## 4. Final Council Consensus & Implementation Blueprint

# Unified Consensus Design Specification for Steps 3, 4, and 5

## 1. Step 3: Language Kit

### Consensus UI & Interactions

#### Layout Structure:
- **Toolbelt Layout**: A horizontal scrollable bar at the top of the screen containing category pills (Vocabulary, Collocations, Sentence Patterns).
- **Interactive Chips**: Each chip expands into a clean card upon selection, displaying terms with natural Vietnamese translations and examples.
- **Inline Highlight Markup**: Target terms are bolded and underlined in both languages.
- **Formula Slot Preview**: Sentence patterns are visualized with placeholders (e.g., `[Subject] + [Verb] + [Object]`).

#### Micro-interactions:
- **Commit Meter**: A progress bar fills as users select terms, preparing their vocabulary for writing.
- **Hover States**: Clicking `[?]` reveals tooltips with natural Vietnamese explanations.
- **Plug-and-Play Visual**: Sentence patterns highlight specific parts (e.g., "It is often argued that...").

### Natural Vietnamese Phrasing Dictionary:
| Old Term | Approved Natural Term |
|----------|------------------------|
| Công cụ lập luận | Từ vựng chính         |
| Lập kế hoạch | Sắp xếp ý             |
| Tối ưu hóa | Làm mượt              |

---

## 2. Step 4: Make a Plan

### Consensus UI & Interactions

#### Visual Roadmap/Flowchart Layout:
- **Linear Roadmap**: A flowchart displaying `Intro → Body 1 → Body 2 → Conclusion`.
- **Node Exploration**: Each node (e.g., Body 1) is a clickable circle, expanding into an overlay with arguments.
- **Argument Logic**: Uses "Point & Support" icons (e.g., [Point: Environment] → [Support: Plastic Waste]).

#### Micro-interactions:
- **Path Animation**: Confirmed nodes change color and show a pulse animation guiding the user through the essay structure.
- **1-Click Copy**: Arguments can be copied to a mental clipboard for later use.

### Natural Vietnamese Phrasing Dictionary:
| Old Term | Approved Natural Term |
|----------|------------------------|
| Lập kế hoạch | Lên khung              |
| Argument 1 | Ý chính 1             |

---

## 3. Step 5: Sentence Builder

### Consensus UI & Interactions

#### Workshop Layout:
- **Split Layout**: Two columns with a sentence builder on the left and a draft editor on the right.
- **Blank-Filling Interaction**: Users fill sentence slots with selected terms, auto-syncing to the draft editor.
- **Seamless Transition**: The builder provides linguistic examples and auto-saves progress.

### Natural Vietnamese Phrasing Dictionary:
| Old Term | Approved Natural Term |
|----------|------------------------|
| Khung hỗ trợ dàn ý | Xưởng câu            |
| Chiến lược câu | Cấu trúc câu         |

---

## 4. Implementation Checklist

### Code Changes:
- **JavaScript**: Implement the commit meter, node exploration, and path animations in `public/write-essay-mode.js`.
- **CSS**: Style the new UI elements, including the toolbelt, flowchart, and sentence builder in `public/write-essay-mode.css`.

### Additional Notes:
- Ensure all interactions are responsive and user-friendly.
- Test linguistic phrasing for clarity and natural flow in Vietnamese.

This specification ensures a cohesive, user-centric design that integrates linguistic, structural, and UX improvements.
