# RMCMA Explanation Logic Audit

Date: May 21, 2026

## Scope

This audit covers the Reading -> MCMA practice mode source workbook:

- `public/database/RMCMA/RMCMA/RMCMA.xlsx`
- 67 total workbook rows audited: IDs 1-53 and 106-119
- Checked each row for passage support, answer-key alignment, explanation logic, and learner-facing ambiguity

The UI/browser flow was already verified in the preceding pass. This report focuses on the content and explanation logic for every question.

## Method

1. Parsed the workbook directly and confirmed every row has a non-empty explanation.
2. Checked each passage, prompt, selected answers, rejected answers, and explanation.
3. Flagged cases where the AI explanation defends an answer that is not actually supported by the passage, is too strict, or is worded in a way that could mislead learners.
4. Separated answer-key logic issues from lower-risk wording and UX-quality issues.

## Summary

| Original audit category | Count | Rows |
| --- | ---: | --- |
| Resolved high-risk issue from the earlier pass | 1 | 22 |
| High-risk answer-key or explanation-logic issues found before GemmaAI resolution | 3 | 20, 25, 28 |
| Medium-risk ambiguity or over-strict explanation issues | 5 | 14, 19, 35, 113, 118 |
| Low-risk wording or learner-clarity issues | 9 | 7, 17, 33, 43, 45, 106, 108, 109, 116 |
| Clean or acceptable after review | 49 | All other audited rows |

Main pattern encountered: when an option is already marked correct in the workbook, the generated explanation sometimes tries to justify it with a broad inference instead of rejecting it. This is most visible in rows 20, 25, and 28.

## GemmaAI Resolution Pass

Update: A local Gemma4/Ollama pass was run against the flagged rows after this audit. The workbook was then patched so the answer keys, option wording, and explanations match the passage evidence more directly.

Rows updated in `public/database/RMCMA/RMCMA/RMCMA.xlsx`:

| ID | Resolution |
| ---: | --- |
| 7 | Explanation clarified the difference between ambient temperature and cooled air around the snowflake. |
| 14 | Rewrote the overbroad travel option to "with the Union armies" and aligned the explanation. |
| 17 | Fixed broken option grammar while preserving the supported key. |
| 19 | Removed weak "feeding locations" answer; only "skull shapes" remains correct. |
| 20 | Removed unsupported "complete evolution" answer. |
| 22 | Kept the corrected one-answer key and refreshed the explanation. |
| 25 | Removed unsupported clock-utility answer. |
| 28 | Removed unsupported party-preference answer and cleaned the option wording. |
| 33 | Fixed broken bone-use option grammar and refreshed the explanation. |
| 35 | Removed the Denmark/California context option from the definition answer. |
| 43 | Removed the meta "passage does not tell" answer from the positive-fact question. |
| 45 | Rewrote the prompt to avoid the misleading "respectively" wording. |
| 106 | Fixed broken glucocorticoid wording and aligned the receptor-impact option with the passage. |
| 108 | Rewrote "The normal operation" as "Remain undamaged and operational after a high-impact crash." |
| 109 | Rewrote "sympathize" to "empathize" and refreshed the false-statement explanation. |
| 113 | Rewrote the priority statement to match "critical priority" and marked it correct. |
| 116 | Rewrote the emotional well-being option to use "a leading cause" and kept the incorrect-statement key logical. |
| 118 | Rewrote the calorie option to "similar" and marked it correct. |

## High-Risk Findings

### #20 Ancient Whale

Severity: High

Problem option currently marked correct:

- "The discovery allowed scientists to reconstruct a complete evolution of the whale."

Passage support:

- The passage says the Ambulocetus fossil included hind legs, showed functional movement on land and sea, and linked life on land with life at sea.
- It does not say the discovery allowed scientists to reconstruct a complete evolution of the whale.

Why this is a problem:

- "Complete evolution" is too strong. The passage supports an important transitional insight, not a complete reconstruction.
- The explanation over-defends the option by treating "complete evolution" as if it meant "important evolutionary evidence."

Recommended correction:

- Mark this option incorrect.
- Keep "The legs provided important information about the evolution of cetaceans" as correct.
- Rewrite the explanation to say the fossil filled an important gap, but did not reconstruct the complete evolutionary history of whales.

### #25 Craftsmanship

Severity: High

Problem option currently marked correct:

- "argue that clocks were more useful in factories than ever before."

Passage support:

- The quotation from the mill worker complains about obeying the bell and feeling like a machine.
- The surrounding paragraph says the first generation of factory workers did not adopt the new attitudes easily.

Why this is a problem:

- The quote supports worker difficulty adjusting to factory discipline.
- It does not argue that clocks were more useful than before.
- The explanation invents a factory-management perspective to justify the answer, but that is not what the quotation is doing.

Recommended correction:

- Mark this option incorrect.
- Keep "support the idea that it was difficult for workers to adjust to working in factories" as correct.
- Rewrite the explanation to reject the clock-utility option as background context, not the function of the quotation.

### #28 Whig Party

Severity: High

Problem option currently marked correct:

- "One of the groups might be not in favor of Whig party and Democrats"

Passage support:

- The passage says Democrats viewed bankers and investors as a greedy "paper money aristocracy."
- It does not say bankers and investors were opposed to both Whigs and Democrats.
- The passage is describing the Democrats' view of bankers and investors, not the bankers' political preference.

Why this is a problem:

- The option is grammatically unclear and logically unsupported.
- The explanation admits it requires inference, then stretches beyond the text.
- The correct answer should identify bankers and investors as people Democrats claimed were unfairly gaining wealth.

Recommended correction:

- Mark this option incorrect.
- Keep "The people that Democrats claimed were unfairly becoming rich" as correct.
- Rewrite the explanation so it does not speculate about the group's party preference.

## Resolved High-Risk Finding

### #22 MCM-R

Severity: High, already corrected before this report

Original problem:

- The workbook previously marked "contrast their operational modes and commercial focuses with those of Kinetoscope parlors" as correct.

Passage support:

- The passage said Kinetoscope parlors were modeled after phonograph parlors and functioned in a similar way.
- It did not support a contrast in operational mode or commercial focus.

Correction already applied:

- Only "describe the model used to design Kinetoscope parlors" remains correct.
- The explanation was rewritten to reject the unsupported contrast option.

## Medium-Risk Findings

### #14 MCM-R

Issue:

- "He was given permission to travel anywhere in the US" is marked correct.

Why it is risky:

- The passage says Lincoln granted Brady permission to travel anywhere "with the Union armies."
- "Anywhere in the US" is broader than the passage.

Recommended correction:

- Rewrite the option to "He was given permission to travel anywhere with the Union armies."
- If the option is not rewritten, the explanation should stop saying this was effectively anywhere in the US.

### #19 Pakicetus

Issue:

- "feeding locations" is marked correct as a similarity between Pakicetus and modern cetaceans.

Why it is risky:

- The passage says Pakicetus fed on fish in shallow water and was not adapted for open-ocean life.
- Modern cetaceans are aquatic, but the passage does not directly compare their feeding locations.

Recommended correction:

- Rewrite the option to "aquatic feeding environments" if it should remain correct.
- Otherwise mark it incorrect and keep "skull shapes" as the only strong similarity.

### #35 Wind Farms

Issue:

- Both "Types of power plant common in Denmark and California" and "Collections of wind turbines producing electric power" are marked correct.

Why it is risky:

- The prompt asks what best explains the term "wind farms."
- "Collections of wind turbines producing electric power" is the direct definition.
- "Types of power plant common in Denmark and California" is contextual information, not a definition.

Recommended correction:

- Mark only "Collections of wind turbines producing electric power" as correct, or rewrite the prompt so it asks for all true statements about wind farms rather than the best explanation of the term.

### #113 Amazon Protection

Issue:

- "Protecting the rainforest is a vital top priority" is marked incorrect.

Why it is risky:

- The passage says safeguarding the rainforest is a "critical priority."
- The explanation rejects the option because "top priority" is stronger than "critical priority."

Recommended correction:

- Either mark it correct as a reasonable paraphrase, or rewrite the option to make the overstatement clearer.
- If kept incorrect, the explanation should explicitly state that the issue is the word "top," not "vital priority."

### #118 Taste Sensitivity

Issue:

- "In the experiment, the researchers made sure the total calories in all three diets were the same" is marked incorrect.

Why it is risky:

- The passage says the diets were "similar in total calorie content."
- The explanation rejects "same" as stricter than "similar."

Recommended correction:

- This is defensible if the test is strict, but learner-facing wording is too subtle.
- Rewrite the option to "exactly the same" if it should remain incorrect, or rewrite it to "similar in total calorie content" and mark it correct.

## Low-Risk Wording And Clarity Findings

### #7 Snow

Issue:

- The explanation rejects "Falling snow melts because of warm air around it" by focusing on the cooled air immediately around the snowflake.

Why it matters:

- The passage also says snow begins to melt when temperature rises above freezing, so learners may see "warm air" as a plausible shorthand.

Recommendation:

- Keep the key if desired, but clarify the difference between ambient temperature and the cooled immediate air around the snowflake.

### #17 MCM-R

Issue:

- Option wording: "they began using a material that much stronger"

Recommendation:

- Rewrite as "they began using a much stronger material."

### #33 Prehistoric Paintings

Issue:

- Option wording: "Bones were not only relate to food"

Recommendation:

- Rewrite as "The bones were used for more than food-related purposes."

### #43 Fuller

Issue:

- "The passage does not tell whether It ceased to operate as a theater after Fuller died" is marked correct.

Why it matters:

- This is a meta statement about what the passage does not say, while the prompt asks what was true of Fuller's theater.
- It may train learners to select "not told" options in a positive-fact question.

Recommendation:

- Replace with a positive passage-supported fact or change the prompt to explicitly ask which statements are true or not contradicted.

### #45 MCM-R

Issue:

- The prompt uses "respectively," but the multi-select answer format does not require ordered answers.

Recommendation:

- Remove "respectively" or rewrite the prompt as two clauses: northern Europe was tied to land, southern Europe was tied to public life.

### #106 Bone Protection

Issue:

- Option wording: "Glucocorticoids work so bad for arthritis."

Recommendation:

- Rewrite as "Glucocorticoids work poorly for arthritis" if intended as a false statement.

### #108 Traffic Lights

Issue:

- Option wording: "The normal operation."

Why it matters:

- The passage supports that the traffic lights remain operational after impact, but the option is a sentence fragment.

Recommendation:

- Rewrite as "Remain operational after a high-impact crash."

### #109 Creativity

Issue:

- The option uses "sympathize" while the passage uses "empathize."

Why it matters:

- The explanation treats them as close enough, but PTE reading questions often rely on precise wording.

Recommendation:

- Use "empathize" in the option if the statement is intended to be true.

### #116 Wound Healing

Issue:

- "main reason" is treated as equivalent to the passage phrase "a leading cause."

Why it matters:

- The explanation is reasonable, but "main reason" is stronger than "a leading cause."

Recommendation:

- Rewrite the option to use "a leading cause" or keep the current wording but explain the inference more cautiously.

## Full Question Status Table

| ID | Title | Status | Note |
| ---: | --- | --- | --- |
| 1 | #1 Wooden Sculptures | Clean | Explanation aligns with passage and key. |
| 2 | #2 MCM-R | Clean | Explanation aligns with passage and key. |
| 3 | #3 Old Man of Lake | Clean | Explanation aligns with passage and key. |
| 4 | #4 Dark Soil | Clean | Explanation aligns with passage and key. |
| 5 | #5 Flax | Clean | Explanation aligns with passage and key. |
| 6 | #6 Neue National Gallery | Clean | Explanation aligns with passage and key. |
| 7 | #7 Snow | Low | Explanation could better distinguish ambient warmth from immediate cooled air. |
| 8 | #8 MCM-R | Clean | Explanation aligns with passage and key. |
| 9 | #9 Walk in Town | Clean | Explanation aligns with passage and key. |
| 10 | #10 Intellectuals | Clean | Explanation aligns with passage and key. |
| 11 | #11 Xhosa Bride | Clean | Explanation aligns with passage and key. |
| 12 | #12 Furniture | Clean | Explanation aligns with passage and key. |
| 13 | #13 MCM-R | Clean | Explanation aligns with passage and key. |
| 14 | #14 MCM-R | Medium | "Anywhere in the US" is broader than "with the Union armies." |
| 15 | #15 MCM-R | Clean | Explanation aligns with passage and key. |
| 16 | #16 MCM-R | Clean | Explanation aligns with passage and key. |
| 17 | #17 MCM-R | Low | Correct logic, but one option has grammar problems. |
| 18 | #18 MCM-R | Clean | Explanation aligns with passage and key. |
| 19 | #19 Pakicetus | Medium | "feeding locations" is a weak similarity unless rewritten more precisely. |
| 20 | #20 Ancient Whale | High | "Complete evolution" is unsupported and should not be correct. |
| 21 | #21 MCM-R | Clean | Explanation aligns with passage and key. |
| 22 | #22 MCM-R | Resolved | Prior answer-key issue already corrected. |
| 23 | #23 MCM-R | Clean | Explanation aligns with passage and key. |
| 24 | #24 MCM-R | Clean | Explanation aligns with passage and key. |
| 25 | #25 Craftsmanship | High | Clock-utility answer is unsupported by the quotation. |
| 26 | #26 Worker Organization | Clean | Explanation aligns with passage and key. |
| 27 | #27 Engineering of Fish | Clean | Explanation aligns with passage and key. |
| 28 | #28 Whig Party | High | Party-preference answer is unsupported and speculative. |
| 29 | #29 MCM-R | Clean | Explanation aligns with passage and key. |
| 30 | #30 Facial Expressions | Clean | Explanation aligns with passage and key. |
| 31 | #31 Himalayas | Clean | Explanation aligns with passage and key. |
| 32 | #32 Oak Longevity | Clean | Explanation aligns with passage and key. |
| 33 | #33 Prehistoric Paintings | Low | Correct logic, but option grammar is poor. |
| 34 | #34 Paintings | Clean | Explanation aligns with passage and key. |
| 35 | #35 MCM-R | Medium | One correct option is context, not the best definition of "wind farms." |
| 36 | #36 Birds Killed | Clean | Explanation aligns with passage and key. |
| 37 | #37 MCM-R | Clean | Explanation aligns with passage and key. |
| 38 | #38 MCM-R | Clean | Explanation aligns with passage and key. |
| 39 | #39 MCM-R | Clean | Explanation aligns with passage and key. |
| 40 | #40 MCM-R | Clean | Explanation aligns with passage and key. |
| 41 | #41 Fuller's Dance | Clean | Explanation aligns with passage and key. |
| 42 | #42 MCM-R | Clean | Explanation aligns with passage and key. |
| 43 | #43 Fuller | Low | Correctness is a meta "not told" statement in a positive-fact prompt. |
| 44 | #44 Iceberg | Clean | Explanation aligns with passage and key. |
| 45 | #45 MCM-R | Low | "Respectively" is awkward for a multi-select answer format. |
| 46 | #46 Southern Europe | Clean | Explanation aligns with passage and key. |
| 47 | #47 Carbon Dioxide | Clean | Explanation aligns with passage and key. |
| 48 | #48 Dennett | Clean | Explanation aligns with passage and key. |
| 49 | #49 Avalanche | Clean | Explanation aligns with passage and key. |
| 50 | #50 Decision | Clean | Explanation aligns with passage and key. |
| 51 | #51 Andalucia | Clean | Explanation aligns with passage and key. |
| 52 | #52 History of Sleep | Clean | Explanation aligns with passage and key. |
| 53 | #53 X-ray | Clean | Explanation aligns with passage and key. |
| 106 | #106 Bone Protection | Low | Correct logic, but one option is ungrammatical. |
| 107 | #107 Regent Honeyeater | Clean | Explanation aligns with passage and key. |
| 108 | #108 Traffic Lights | Low | Correct logic, but one answer option is a fragment. |
| 109 | #109 Creativity | Low | "Sympathize" versus "empathize" may be too imprecise. |
| 110 | #110 Skin Cancer | Clean | Explanation aligns with passage and key. |
| 111 | #111 Forgiveness | Clean | Explanation aligns with passage and key. |
| 112 | #112 Hydropower | Clean | Explanation aligns with passage and key. |
| 113 | #113 Amazon Protection | Medium | "Critical priority" versus "vital top priority" is overly subtle. |
| 114 | #114 Persistent Back Pain | Clean | Explanation aligns with passage and key. |
| 115 | #115 Smartphone-based Treatments | Clean | Explanation aligns with passage and key. |
| 116 | #116 Wound Healing | Low | "Main reason" is stronger than "a leading cause." |
| 117 | #117 Ancient DNA | Clean | Explanation aligns with passage and key. |
| 118 | #118 Taste Sensitivity | Medium | "Same calories" versus "similar calories" is very strict and should be clearer. |
| 119 | #119 Television | Clean | Explanation aligns with passage and key. |

## Recommended Fix Order

1. Patch high-risk rows first: 20, 25, 28.
2. Confirm whether medium-risk rows should be strict PTE wording traps or clearer learner-facing questions: 14, 19, 35, 113, 118.
3. Clean low-risk wording issues so learners are not punished for interpreting broken or ambiguous option text.
4. Re-run the RMCMA browser check after workbook edits to confirm the answer key, scoring, explanation rendering, retry, and picker still work.
