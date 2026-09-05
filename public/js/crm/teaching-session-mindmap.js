/**
 * CRM Teaching Session Interactive Mindmap Module
 * Builds high-fidelity structured Mermaid mindmaps from normalized reports,
 * resolves problem-to-concept assignments, fits SVG labels post-render,
 * and manages interactive node inspection, outcome filtering, search, and audio seek.
 */
(function (global) {
    const STOPWORDS = new Set([
        'la', 'va', 'cua', 'cho', 'trong', 'cac', 'nhung', 'co', 'duoc', 'voi', 've', 'o', 'tai', 'de', 'tu',
        'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'by', 'that'
    ]);

    function stripDiacritics(str) {
        if (!str) return '';
        return String(str)
            .replace(/\u0111/g, 'd')
            .replace(/\u0110/g, 'D')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function extractContentWords(str) {
        if (!str) return new Set();
        const normalized = stripDiacritics(str);
        const tokens = normalized.split(/[^a-z0-9]+/);
        const words = new Set();
        for (const token of tokens) {
            if (token.length >= 2 && !STOPWORDS.has(token)) {
                words.add(token);
            }
        }
        return words;
    }

    function diceCoefficient(setA, setB) {
        if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
        let intersection = 0;
        for (const item of setA) {
            if (setB.has(item)) intersection++;
        }
        return (2 * intersection) / (setA.size + setB.size);
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeMermaidText(str, fallback) {
        const defaultFallback = fallback || 'Mục 1';
        if (str == null) return defaultFallback;
        let s = String(str);
        // Strip control characters
        // eslint-disable-next-line no-control-regex
        s = s.replace(/[\x00-\x1F\x7F]/g, ' ');
        // Strip comments and class selectors that break Mermaid mindmap parser
        s = s.replace(/%%/g, ' ');
        s = s.replace(/:::[a-zA-Z0-9_-]+/g, ' ');
        // Strip characters that break Mermaid mindmap syntax: ()[]{}#&;<>\`*|"\
        s = s.replace(/[()[\]{}#&;<>`*|"\\/]/g, ' ');
        // Collapse whitespace
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) return defaultFallback;
        // Truncate to 40 chars with …
        if (s.length > 40) {
            s = s.slice(0, 39).trim() + '…';
        }
        return s;
    }

    function classifySeverity(str) {
        if (!str) return 'minor';
        const s = String(str).toLowerCase();
        if (s.includes('critical') || s.includes('nghiêm trọng') || s.includes('🔴') || s.includes('high') || s.includes('p1') || s.includes('cao')) return 'critical';
        if (s.includes('warning') || s.includes('trung bình') || s.includes('🟡') || s.includes('medium') || s.includes('p2') || s.includes('p3') || s.includes('vừa')) return 'warning';
        return 'minor';
    }

    function classifyOutcome(str) {
        if (!str) return 'practice';
        const s = String(str).toLowerCase();
        if (s.includes('mastered') || s.includes('nắm vững') || s.includes('thành thạo')) return 'mastered';
        if (s.includes('partial') || s.includes('một phần') || s.includes('tiến bộ')) return 'partial';
        return 'practice';
    }

    function formatTimestamp(seconds) {
        const sec = Number(seconds);
        if (Number.isNaN(sec) || sec < 0) return '';
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    /**
     * Pure function to assign problems to their most relevant teaching concept.
     * Blends time signal (0.6) and text keyword Dice coefficient (0.4).
     */
    function assignProblemsToConcepts(whatTaught, problems) {
        const concepts = Array.isArray(whatTaught) ? whatTaught : [];
        const rawProblems = Array.isArray(problems) ? problems : [];

        const conceptProblems = concepts.map(() => []);
        const unassignedProblems = [];

        if (concepts.length === 0) {
            rawProblems.forEach((p) => {
                unassignedProblems.push({ ...p, assignedConceptIndex: -1 });
            });
            return {
                conceptProblems,
                unassignedProblems,
                assignments: new Map([[-1, unassignedProblems]])
            };
        }

        // Precompute concept words
        const conceptWordSets = concepts.map((c) => {
            const combined = `${c.topic || ''} ${c.category || ''} ${c.key_rule || ''}`;
            return extractContentWords(combined);
        });

        rawProblems.forEach((prob, pIdx) => {
            const pSec = prob.approx_start_sec != null && !isNaN(Number(prob.approx_start_sec))
                ? Number(prob.approx_start_sec)
                : null;

            const probWords = extractContentWords(
                `${prob.issue_summary || ''} ${prob.teacher_fix || prob.teacher_solution || ''} ${prob.student_error || prob.student_error_quote || ''}`
            );

            let bestConceptIdx = -1;
            let bestScore = -1;

            // 1. Time signal: greatest approx_start_sec <= pSec, or nearest distance if preceding all
            let bestTimePrecedingIdx = -1;
            let maxPrecedingSec = -Infinity;
            let nearestDistIdx = -1;
            let minDistance = Infinity;
            let hasConceptTimestamps = false;

            if (pSec != null) {
                concepts.forEach((c, cIdx) => {
                    if (c.approx_start_sec != null && !isNaN(Number(c.approx_start_sec))) {
                        hasConceptTimestamps = true;
                        const cSec = Number(c.approx_start_sec);
                        if (cSec <= pSec && cSec >= maxPrecedingSec) {
                            maxPrecedingSec = cSec;
                            bestTimePrecedingIdx = cIdx;
                        }
                        const dist = Math.abs(cSec - pSec);
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestDistIdx = cIdx;
                        }
                    }
                });
            }

            const hasTimeSignal = pSec != null && hasConceptTimestamps;
            const chosenTimeConceptIdx = bestTimePrecedingIdx !== -1 ? bestTimePrecedingIdx : nearestDistIdx;

            // 2. Score candidate concepts
            concepts.forEach((c, cIdx) => {
                let timeScore = 0;
                if (hasTimeSignal) {
                    if (chosenTimeConceptIdx === cIdx) {
                        timeScore = 1.0;
                    } else if (c.approx_start_sec != null) {
                        const diff = Math.abs(Number(c.approx_start_sec) - pSec);
                        timeScore = Math.max(0, 1 - diff / 300); // Gradual decay over 5 mins
                    }
                }

                const textScore = diceCoefficient(probWords, conceptWordSets[cIdx]);

                let blended = 0;
                if (hasTimeSignal && probWords.size > 0) {
                    blended = 0.6 * timeScore + 0.4 * textScore;
                } else if (hasTimeSignal) {
                    blended = timeScore;
                } else {
                    blended = textScore;
                }

                if (blended > bestScore) {
                    bestScore = blended;
                    bestConceptIdx = cIdx;
                }
            });

            // Minimum floor to assign to a concept
            const ASSIGNMENT_FLOOR = 0.12;
            if (bestScore >= ASSIGNMENT_FLOOR && bestConceptIdx >= 0) {
                const assigned = { ...prob, assignedConceptIndex: bestConceptIdx, assignmentScore: bestScore };
                conceptProblems[bestConceptIdx].push(assigned);
            } else {
                const unassigned = { ...prob, assignedConceptIndex: -1, assignmentScore: bestScore };
                unassignedProblems.push(unassigned);
            }
        });

        const assignments = new Map();
        conceptProblems.forEach((list, idx) => {
            assignments.set(idx, list);
        });
        assignments.set(-1, unassignedProblems);

        return {
            conceptProblems,
            unassignedProblems,
            assignments
        };
    }

    /**
     * Builds the complete Mermaid mindmap string and an aligned preorder descriptor array.
     * Guaranteed pure function (no DOM dependencies).
     */
    function buildMindmapModel(normalizedReport, options) {
        if (!normalizedReport || typeof normalizedReport !== 'object') {
            return null;
        }

        const opts = options || {};
        const collapsed = opts.collapsed || new Set();

        const summary = normalizedReport.summary || normalizedReport.lesson_summary || {};
        const whatTaught = normalizedReport.whatTaught || normalizedReport.what_taught || [];
        const problems = normalizedReport.problems || normalizedReport.student_problems_and_solutions || [];
        const nextBriefing = normalizedReport.nextBriefing || normalizedReport.next_lesson_briefing || {};

        const coreTopic = summary.core_topic || summary.coreTopic || 'Buổi Dạy';
        const sanitizedRoot = sanitizeMermaidText(coreTopic, 'Buổi Dạy');

        const lines = ['mindmap'];
        const descriptors = [];

        // 1. Root Node (Indent: 2 spaces)
        lines.push(`  root(( ${sanitizedRoot} ))`);
        descriptors.push({
            id: 'ts-node-root',
            kind: 'root',
            label: sanitizedRoot,
            fullText: coreTopic,
            approx_start_sec: null,
            rawItem: summary
        });

        // Resolve problem assignments to concepts
        const { conceptProblems, unassignedProblems } = assignProblemsToConcepts(whatTaught, problems);

        // 2. Concepts & Nested Problems (Indent: 4, 6, 8 spaces)
        whatTaught.forEach((concept, cIdx) => {
            const conceptId = `concept-${cIdx}`;
            const isCollapsed = collapsed.has(conceptId);
            const conceptTitle = (concept.category ? `${concept.category} - ` : '') + (concept.topic || `Chủ đề ${cIdx + 1}`);
            const sanitizedConcept = sanitizeMermaidText(conceptTitle, `Chủ đề ${cIdx + 1}`);
            const displayLabel = isCollapsed ? `${sanitizedConcept} [+]` : sanitizedConcept;

            lines.push(`    ${displayLabel}`);
            descriptors.push({
                id: conceptId,
                kind: 'concept',
                label: displayLabel,
                fullText: conceptTitle,
                category: concept.category || null,
                topic: concept.topic || null,
                key_rule: concept.key_rule || null,
                examples: concept.examples || [],
                approx_start_sec: concept.approx_start_sec != null ? Number(concept.approx_start_sec) : null,
                rawItem: concept,
                conceptIndex: cIdx,
                isCollapsed
            });

            if (!isCollapsed) {
                // Nested Rule if present
                if (concept.key_rule) {
                    const ruleLabel = `Rule: ${concept.key_rule}`;
                    const sanitizedRule = sanitizeMermaidText(ruleLabel, 'Quy tắc trọng tâm');
                    lines.push(`      ${sanitizedRule}`);
                    descriptors.push({
                        id: `${conceptId}-rule`,
                        kind: 'rule',
                        label: sanitizedRule,
                        fullText: concept.key_rule,
                        approx_start_sec: concept.approx_start_sec != null ? Number(concept.approx_start_sec) : null,
                        rawItem: concept,
                        conceptIndex: cIdx
                    });
                }

                // Nested Problems for this concept
                const assignedProbs = conceptProblems[cIdx] || [];
                assignedProbs.forEach((prob, pIdx) => {
                    const probId = `${conceptId}-prob-${pIdx}`;
                    const issueText = prob.issue_summary || prob.student_error || 'Vấn đề học viên';
                    const sanitizedIssue = sanitizeMermaidText(issueText, 'Vấn đề học viên');
                    lines.push(`      ${sanitizedIssue}`);
                    descriptors.push({
                        id: probId,
                        kind: 'problem',
                        label: sanitizedIssue,
                        fullText: issueText,
                        severity: prob.severity || null,
                        outcome: prob.student_outcome || null,
                        student_error: prob.student_error || prob.student_error_quote || null,
                        teacher_fix: prob.teacher_fix || prob.teacher_solution || null,
                        outcome_evidence: prob.outcome_evidence || null,
                        approx_start_sec: prob.approx_start_sec != null ? Number(prob.approx_start_sec) : null,
                        rawItem: prob,
                        conceptIndex: cIdx,
                        problemIndex: pIdx
                    });

                    // Nested Outcome under Problem
                    if (prob.student_outcome) {
                        const sanitizedOutcome = sanitizeMermaidText(prob.student_outcome, 'Kết quả');
                        lines.push(`        ${sanitizedOutcome}`);
                        descriptors.push({
                            id: `${probId}-outcome`,
                            kind: 'outcome',
                            label: sanitizedOutcome,
                            fullText: prob.student_outcome,
                            outcome: prob.student_outcome,
                            severity: prob.severity || null,
                            rawItem: prob,
                            conceptIndex: cIdx,
                            problemIndex: pIdx
                        });
                    }
                });
            }
        });

        // 3. Unassigned Problems Bucket (if any)
        if (unassignedProblems.length > 0) {
            const unassignedId = 'unassigned-bucket';
            const isCollapsed = collapsed.has(unassignedId);
            const unassignedLabel = isCollapsed ? 'Chưa phân loại [+]' : 'Chưa phân loại';
            lines.push(`    ${unassignedLabel}`);
            descriptors.push({
                id: unassignedId,
                kind: 'unassigned_bucket',
                label: unassignedLabel,
                fullText: 'Các lỗi chưa phân loại vào chủ đề',
                approx_start_sec: null,
                rawItem: unassignedProblems,
                isCollapsed
            });

            if (!isCollapsed) {
                unassignedProblems.forEach((prob, pIdx) => {
                    const probId = `unassigned-prob-${pIdx}`;
                    const issueText = prob.issue_summary || prob.student_error || 'Vấn đề học viên';
                    const sanitizedIssue = sanitizeMermaidText(issueText, 'Vấn đề học viên');
                    lines.push(`      ${sanitizedIssue}`);
                    descriptors.push({
                        id: probId,
                        kind: 'problem',
                        label: sanitizedIssue,
                        fullText: issueText,
                        severity: prob.severity || null,
                        outcome: prob.student_outcome || null,
                        student_error: prob.student_error || prob.student_error_quote || null,
                        teacher_fix: prob.teacher_fix || prob.teacher_solution || null,
                        outcome_evidence: prob.outcome_evidence || null,
                        approx_start_sec: prob.approx_start_sec != null ? Number(prob.approx_start_sec) : null,
                        rawItem: prob,
                        conceptIndex: -1,
                        problemIndex: pIdx
                    });

                    if (prob.student_outcome) {
                        const sanitizedOutcome = sanitizeMermaidText(prob.student_outcome, 'Kết quả');
                        lines.push(`        ${sanitizedOutcome}`);
                        descriptors.push({
                            id: `${probId}-outcome`,
                            kind: 'outcome',
                            label: sanitizedOutcome,
                            fullText: prob.student_outcome,
                            outcome: prob.student_outcome,
                            rawItem: prob,
                            conceptIndex: -1,
                            problemIndex: pIdx
                        });
                    }
                });
            }
        }

        // 4. Next Lesson Briefing Branch
        const warmups = nextBriefing.warmup_quiz_questions || nextBriefing.warmup_tasks || [];
        const followups = nextBriefing.teacher_followup_focus || nextBriefing.followup_error_focus || [];
        const homework = nextBriefing.student_homework_checklist || nextBriefing.recommended_homework || [];

        if (warmups.length > 0 || followups.length > 0 || homework.length > 0) {
            const nextId = 'next-lesson-bucket';
            const isCollapsed = collapsed.has(nextId);
            const nextLabel = isCollapsed ? 'Buổi sau [+]' : 'Buổi sau';
            lines.push(`    ${nextLabel}`);
            descriptors.push({
                id: nextId,
                kind: 'next_lesson',
                label: nextLabel,
                fullText: 'Kế hoạch buổi học tiếp theo',
                rawItem: nextBriefing,
                isCollapsed
            });

            if (!isCollapsed) {
                if (warmups.length > 0) {
                    lines.push('      Khởi động');
                    descriptors.push({
                        id: 'next-warmup',
                        kind: 'briefing_category',
                        label: 'Khởi động',
                        fullText: 'Câu hỏi / Bài tập khởi động',
                        rawItem: warmups
                    });
                    warmups.slice(0, 3).forEach((w, wIdx) => {
                        const sw = sanitizeMermaidText(w, `Khởi động ${wIdx + 1}`);
                        lines.push(`        ${sw}`);
                        descriptors.push({
                            id: `next-warmup-${wIdx}`,
                            kind: 'briefing_item',
                            label: sw,
                            fullText: w,
                            rawItem: w
                        });
                    });
                }

                if (homework.length > 0) {
                    lines.push('      Bài tập');
                    descriptors.push({
                        id: 'next-homework',
                        kind: 'briefing_category',
                        label: 'Bài tập',
                        fullText: 'Bài tập về nhà',
                        rawItem: homework
                    });
                    homework.slice(0, 3).forEach((hw, hIdx) => {
                        const shw = sanitizeMermaidText(hw, `Bài tập ${hIdx + 1}`);
                        lines.push(`        ${shw}`);
                        descriptors.push({
                            id: `next-homework-${hIdx}`,
                            kind: 'briefing_item',
                            label: shw,
                            fullText: hw,
                            rawItem: hw
                        });
                    });
                }
            }
        }

        return {
            mermaidText: lines.join('\n'),
            descriptors
        };
    }

    /**
     * Refits diagram labels to eliminate text clipping when fonts take time to load
     * or when labels naturally exceed Mermaid's estimated bounding boxes.
     */
    function refitDiagramLabels(svgEl) {
        if (!svgEl) return;
        const nodes = svgEl.querySelectorAll('g.mindmap-node');
        let needsViewBoxCheck = false;

        nodes.forEach((nodeG) => {
            const fo = nodeG.querySelector('foreignObject');
            if (!fo) return;
            const textContainer = fo.querySelector('.nodeLabel') || fo.querySelector('div');
            if (!textContainer) return;

            const currentFoW = parseFloat(fo.getAttribute('width')) || 0;
            // Get measured natural width of the label content
            let naturalW = 0;
            if (typeof textContainer.getBoundingClientRect === 'function') {
                try {
                    const rect = textContainer.getBoundingClientRect();
                    if (rect && rect.width > 0) naturalW = Math.ceil(rect.width);
                } catch (err) {
                    void err;
                }
            }
            if (textContainer.scrollWidth && textContainer.scrollWidth > naturalW) {
                naturalW = textContainer.scrollWidth;
            }

            if (naturalW > currentFoW) {
                const delta = (naturalW - currentFoW) + 6;
                const newFoW = currentFoW + delta;
                fo.setAttribute('width', String(newFoW));
                needsViewBoxCheck = true;

                // Shift horizontal centering to keep text neatly aligned
                const gLabel = nodeG.querySelector('g.label');
                if (gLabel) {
                    const tMatch = (gLabel.getAttribute('transform') || '').match(/translate\(\s*(-?\d+(?:\.\d+)?)(?:px)?(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)(?:px)?\s*\)/);
                    if (tMatch) {
                        const tx = parseFloat(tMatch[1]);
                        const ty = tMatch[2];
                        gLabel.setAttribute('transform', `translate(${tx - delta / 2}, ${ty})`);
                    }
                } else {
                    const curX = parseFloat(fo.getAttribute('x')) || 0;
                    fo.setAttribute('x', String(curX - delta / 2));
                }

                // Root node circle resizing
                const circle = nodeG.querySelector('circle.label-container');
                if (circle) {
                    const r = parseFloat(circle.getAttribute('r')) || 0;
                    if (newFoW / 2 + 12 > r) {
                        circle.setAttribute('r', String(Math.ceil(newFoW / 2 + 12)));
                    }
                }

                // Branch node path resizing (rounded rect background)
                const path = nodeG.querySelector('path.node-bkg');
                if (path) {
                    const d = path.getAttribute('d');
                    if (d) {
                        const match = d.match(/^M\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)([\s\S]*?)[hH]\s*(\d+(?:\.\d+)?)([\s\S]*?)[hH]\s*-?(\d+(?:\.\d+)?)([\s\S]*)$/);
                        if (match) {
                            const origStartX = parseFloat(match[1]);
                            const startY = match[2];
                            const segment1 = match[3];
                            const origW = parseFloat(match[4]);
                            const segment2 = match[5];
                            const segment3 = match[7];
                            const newStartX = origStartX - delta / 2;
                            const newW = origW + delta;
                            path.setAttribute('d', `M${newStartX} ${startY}${segment1}h${newW}${segment2}h-${newW}${segment3}`);
                        }
                    }
                }

                // Branch baseline underline if present
                const line = nodeG.querySelector('line.node-line-');
                if (line) {
                    const x1 = parseFloat(line.getAttribute('x1')) || 0;
                    const x2 = parseFloat(line.getAttribute('x2')) || 0;
                    line.setAttribute('x1', String(x1 - delta / 2));
                    line.setAttribute('x2', String(x2 + delta / 2));
                }
            }
        });

        // Flowchart node compatibility
        const flowchartNodes = svgEl.querySelectorAll('g.node:not(.mindmap-node), g.flowchart-node');
        flowchartNodes.forEach((nodeG) => {
            const fo = nodeG.querySelector('foreignObject');
            if (!fo) return;
            const textContainer = fo.querySelector('.nodeLabel') || fo.querySelector('div');
            if (!textContainer) return;
            const currentFoW = parseFloat(fo.getAttribute('width')) || 0;
            let naturalW = 0;
            if (typeof textContainer.getBoundingClientRect === 'function') {
                try {
                    const rect = textContainer.getBoundingClientRect();
                    if (rect && rect.width > 0) naturalW = Math.ceil(rect.width);
                } catch (err) {
                    void err;
                }
            }
            if (textContainer.scrollWidth && textContainer.scrollWidth > naturalW) {
                naturalW = textContainer.scrollWidth;
            }

            if (naturalW > currentFoW) {
                const delta = (naturalW - currentFoW) + 6;
                const newFoW = currentFoW + delta;
                fo.setAttribute('width', String(newFoW));
                needsViewBoxCheck = true;

                const gLabel = nodeG.querySelector('g.label');
                if (gLabel) {
                    const tMatch = (gLabel.getAttribute('transform') || '').match(/translate\(\s*(-?\d+(?:\.\d+)?)(?:px)?(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)(?:px)?\s*\)/);
                    if (tMatch) {
                        const tx = parseFloat(tMatch[1]);
                        const ty = tMatch[2];
                        gLabel.setAttribute('transform', `translate(${tx - delta / 2}, ${ty})`);
                    }
                } else {
                    const curX = parseFloat(fo.getAttribute('x')) || 0;
                    fo.setAttribute('x', String(curX - delta / 2));
                }

                const rect = nodeG.querySelector('rect');
                if (rect) {
                    const rW = parseFloat(rect.getAttribute('width')) || 0;
                    const rX = parseFloat(rect.getAttribute('x')) || 0;
                    rect.setAttribute('width', String(rW + delta));
                    rect.setAttribute('x', String(rX - delta / 2));
                }
            }
        });

        // Widen viewBox if contents overflowed
        if (needsViewBoxCheck && svgEl.viewBox && svgEl.viewBox.baseVal && typeof svgEl.getBBox === 'function') {
            try {
                const bbox = svgEl.getBBox();
                const vb = svgEl.viewBox.baseVal;
                let minX = vb.x;
                let minY = vb.y;
                let width = vb.width;
                let height = vb.height;
                let changed = false;

                if (bbox.x < minX) {
                    const diff = minX - bbox.x;
                    minX = bbox.x - 12;
                    width += diff + 12;
                    changed = true;
                }
                if (bbox.x + bbox.width > minX + width) {
                    width = (bbox.x + bbox.width) - minX + 24;
                    changed = true;
                }
                if (bbox.y < minY) {
                    const diff = minY - bbox.y;
                    minY = bbox.y - 12;
                    height += diff + 12;
                    changed = true;
                }
                if (bbox.y + bbox.height > minY + height) {
                    height = (bbox.y + bbox.height) - minY + 24;
                    changed = true;
                }

                if (changed) {
                    svgEl.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
                }
            } catch (err) {
                void err;
            }
        }
    }

    /**
     * Injects scoped styles directly as the last child of the rendered SVG.
     * Ensures outcome rings, hover effects, and dimming win over Mermaid internal specificity.
     */
    function injectSvgStyles(svgEl, svgId) {
        if (!svgEl) return;
        const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleEl.textContent = `
            /* Outcome rings for mindmap nodes */
            #${svgId} g.mindmap-node[data-ts-outcome="mastered"] > path.node-bkg { stroke: #10b981 !important; stroke-width: 3.5px !important; }
            #${svgId} g.mindmap-node[data-ts-outcome="mastered"] > circle.label-container { stroke: #10b981 !important; stroke-width: 3.5px !important; }

            #${svgId} g.mindmap-node[data-ts-outcome="partial"] > path.node-bkg { stroke: #f59e0b !important; stroke-width: 3.5px !important; }
            #${svgId} g.mindmap-node[data-ts-outcome="partial"] > circle.label-container { stroke: #f59e0b !important; stroke-width: 3.5px !important; }

            #${svgId} g.mindmap-node[data-ts-outcome="practice"] > path.node-bkg { stroke: #ef4444 !important; stroke-width: 3.5px !important; }
            #${svgId} g.mindmap-node[data-ts-outcome="practice"] > circle.label-container { stroke: #ef4444 !important; stroke-width: 3.5px !important; }

            /* Interactive cursor & hover drop-shadow */
            #${svgId} g.mindmap-node { cursor: pointer; }
            #${svgId} g.mindmap-node:hover > path.node-bkg,
            #${svgId} g.mindmap-node:hover > circle.label-container {
                filter: drop-shadow(0 3px 8px rgba(0,0,0,0.18));
            }

            /* Selected Node highlight */
            #${svgId} g.mindmap-node.is-selected > path.node-bkg,
            #${svgId} g.mindmap-node.is-selected > circle.label-container {
                stroke: #6366f1 !important;
                stroke-width: 4px !important;
                filter: drop-shadow(0 0 10px rgba(99, 102, 241, 0.5));
            }

            /* Currently playing audio node highlight */
            #${svgId} g.mindmap-node.is-playing > path.node-bkg,
            #${svgId} g.mindmap-node.is-playing > circle.label-container {
                stroke: #0284c7 !important;
                stroke-width: 4px !important;
                filter: drop-shadow(0 0 10px rgba(2, 132, 199, 0.6));
            }

            /* Filter & Search dimming */
            .crm-diagram-stage[data-ts-filter] #${svgId} g.mindmap-node:not([data-ts-match="true"]),
            .crm-diagram-stage[data-ts-search] #${svgId} g.mindmap-node:not([data-ts-match="true"]) {
                opacity: 0.22 !important;
            }
            .crm-diagram-stage[data-ts-filter] #${svgId} path.edge,
            .crm-diagram-stage[data-ts-filter] #${svgId} .edge-path,
            .crm-diagram-stage[data-ts-filter] #${svgId} line,
            .crm-diagram-stage[data-ts-search] #${svgId} path.edge,
            .crm-diagram-stage[data-ts-search] #${svgId} .edge-path,
            .crm-diagram-stage[data-ts-search] #${svgId} line {
                opacity: 0.22 !important;
            }
        `;
        svgEl.appendChild(styleEl);
    }

    function stampNodeDescriptor(nodeG, desc) {
        if (!nodeG || !desc) return;
        nodeG.dataset.tsNodeId = desc.id;
        nodeG.dataset.tsKind = desc.kind;
        if (desc.approx_start_sec != null) nodeG.dataset.tsSec = String(desc.approx_start_sec);
        if (desc.severity) nodeG.dataset.tsSeverity = classifySeverity(desc.severity);
        nodeG._tsDescriptor = desc;
        nodeG._crmDescriptor = desc;

        if (desc.outcome) {
            const outcomeCls = classifyOutcome(desc.outcome);
            nodeG.dataset.tsOutcome = outcomeCls;
            const bkgPath = nodeG.querySelector('path.node-bkg');
            if (bkgPath) {
                if (outcomeCls === 'mastered') {
                    bkgPath.style.stroke = '#10b981';
                    bkgPath.style.strokeWidth = '3.5px';
                } else if (outcomeCls === 'partial') {
                    bkgPath.style.stroke = '#f59e0b';
                    bkgPath.style.strokeWidth = '3.5px';
                } else if (outcomeCls === 'practice') {
                    bkgPath.style.stroke = '#ef4444';
                    bkgPath.style.strokeWidth = '3.5px';
                }
            }
        }
    }

    /**
     * Binds DOM SVG nodes to model descriptors.
     * Stamped data attributes: data-ts-node-id, data-ts-kind, data-ts-outcome, data-ts-severity, data-ts-sec.
     */
    function bindNodesToDescriptors(svgEl, descriptors) {
        if (!svgEl || !Array.isArray(descriptors)) return false;
        const domNodes = Array.from(svgEl.querySelectorAll('g.mindmap-node'));

        if (domNodes.length === descriptors.length) {
            domNodes.forEach((nodeG, idx) => {
                stampNodeDescriptor(nodeG, descriptors[idx]);
            });
            return true;
        }

        // Fallback: match by normalized label text
        const usedIndices = new Set();
        let matchedCount = 0;
        domNodes.forEach((nodeG) => {
            const rawText = nodeG.textContent?.trim() || '';
            const stripped = stripDiacritics(rawText);
            if (!stripped) return;

            // Try exact label match first
            let bestIdx = descriptors.findIndex((d, i) => !usedIndices.has(i) && stripDiacritics(d.label) === stripped);
            // Fallback to substring match for truncated labels
            if (bestIdx === -1 && stripped.length >= 3) {
                bestIdx = descriptors.findIndex((d, i) => {
                    if (usedIndices.has(i)) return false;
                    const dLabel = stripDiacritics(d.label);
                    return dLabel.length >= 3 && (stripped.includes(dLabel) || dLabel.includes(stripped));
                });
            }

            if (bestIdx !== -1) {
                usedIndices.add(bestIdx);
                stampNodeDescriptor(nodeG, descriptors[bestIdx]);
                matchedCount++;
            }
        });

        return matchedCount === domNodes.length;
    }

    /**
     * Renders the interactive mindmap inside the container.
     */
    async function renderInteractiveMindmap(container, session, options) {
        if (!container) return;
        const opts = options || {};
        const onAudioSeek = opts.seekSessionAudio || (window.CrmTeachingSessions?.seekSessionAudio);

        // Preload Be Vietnam Pro font if available
        if (typeof document !== 'undefined' && document.fonts) {
            try {
                await document.fonts.load("600 14px 'Be Vietnam Pro'");
                await document.fonts.ready;
            } catch (err) {
                console.warn('[Teaching Sessions] font preload failed', err);
            }
        }

        const stageEl = container.closest('.crm-diagram-stage');
        const currentSid = session.id || session.sessionId || 'default';
        if (container._tsSessionId !== currentSid) {
            container._tsSessionId = currentSid;
            container._tsCollapsedSet = new Set();
        }
        let collapsed = container._tsCollapsedSet || new Set();
        container._tsCollapsedSet = collapsed;

        // Obtain normalized report
        let norm = null;
        if (window.CrmTeachingSessions && typeof window.CrmTeachingSessions.normalizeReport === 'function') {
            norm = window.CrmTeachingSessions.normalizeReport(session);
        }

        // Fallback to static mermaid string if report normalization is unavailable
        if (!norm) {
            if (session.mermaidMindmap && window.CrmTeachingSessions?.renderMermaid) {
                await window.CrmTeachingSessions.renderMermaid(container, session.mermaidMindmap, 'mindmap');
            } else {
                container.innerHTML = '<div style="text-align:center;color:var(--crm-text-muted);padding:32px;">Không có dữ liệu sơ đồ tư duy cho buổi dạy này.</div>';
            }
            return;
        }

        let model = null;
        try {
            model = buildMindmapModel(norm, { collapsed });
            container._tsDescriptors = model.descriptors;
        } catch (err) {
            console.error('[Teaching Sessions Mindmap] Model build error:', err);
            if (session.mermaidMindmap && window.CrmTeachingSessions?.renderMermaid) {
                await window.CrmTeachingSessions.renderMermaid(container, session.mermaidMindmap, 'mindmap');
            }
            return;
        }

        if (!window.mermaid) {
            container.innerHTML = `<pre style="background:var(--crm-surface-dim);padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${model.mermaidText}</pre>`;
            return;
        }

        try {
            const uniqueId = `mermaid-ts-mindmap-${Date.now()}`;
            const { svg } = await window.mermaid.render(uniqueId, model.mermaidText);

            // Clear any pending search debounce timer
            const oldSearchInput = stageEl?.querySelector('.crm-ts-mm-search-input');
            if (oldSearchInput && oldSearchInput._debounceTimer) {
                clearTimeout(oldSearchInput._debounceTimer);
                oldSearchInput._debounceTimer = null;
            }

            // Reset pane view state and toolbar search/filter for fresh renders (skip when toggling collapse/expand)
            if (!opts.preserveViewState) {
                if (stageEl) {
                    stageEl.removeAttribute('data-ts-filter');
                    stageEl.removeAttribute('data-ts-search');
                    const filterBtns = stageEl.querySelectorAll('.crm-ts-mm-filter-btn');
                    filterBtns.forEach((b) => {
                        b.classList.remove('active', 'is-active');
                        if (b.dataset.filter === 'all') {
                            b.classList.add('active', 'is-active');
                        }
                    });
                    if (oldSearchInput) oldSearchInput.value = '';
                }
                if (window.CrmTeachingSessions?.resetDiagramViewState && stageEl) {
                    const owningPane = stageEl.closest('.teaching-session-view-pane');
                    if (owningPane) window.CrmTeachingSessions.resetDiagramViewState(owningPane.id);
                }
            }

            container.innerHTML = `<div class="diagram-transform-wrapper">${svg}</div>`;
            const svgEl = container.querySelector('svg');

            if (svgEl) {
                refitDiagramLabels(svgEl);
                injectSvgStyles(svgEl, uniqueId);
                bindNodesToDescriptors(svgEl, model.descriptors);
            }

            // Setup toolbar controls, tooltip, and detail panel
            if (stageEl && svgEl) {
                setupToolbarControls(stageEl, svgEl, model.descriptors);
                setupInteractiveBehaviors(stageEl, svgEl, container, session, onAudioSeek);

                // If preserving view state across branch collapse/expand, re-apply active filter & search
                if (opts.preserveViewState) {
                    const activeFilter = stageEl.getAttribute('data-ts-filter');
                    if (activeFilter && activeFilter !== 'all') {
                        svgEl.querySelectorAll('g.mindmap-node').forEach((node) => {
                            const matches = node.dataset.tsOutcome === activeFilter;
                            node.setAttribute('data-ts-match', matches ? 'true' : 'false');
                        });
                    }
                    const curSearchInput = stageEl.querySelector('.crm-ts-mm-search-input');
                    const query = curSearchInput ? stripDiacritics(curSearchInput.value.trim()) : '';
                    if (query) {
                        stageEl.setAttribute('data-ts-search', 'true');
                        svgEl.querySelectorAll('g.mindmap-node').forEach((node) => {
                            const desc = node._tsDescriptor;
                            const fullText = stripDiacritics(desc?.fullText || node.textContent || '');
                            node.setAttribute('data-ts-match', fullText.includes(query) ? 'true' : 'false');
                        });
                    }
                }

                if (window.CrmTeachingSessions?.attachDiagramPanZoom) {
                    window.CrmTeachingSessions.attachDiagramPanZoom(stageEl);
                }
            }
        } catch (err) {
            console.error('[Teaching Sessions Mindmap] Render error:', err);
            // Fallback to session.mermaidMindmap
            if (session.mermaidMindmap && window.CrmTeachingSessions?.renderMermaid) {
                await window.CrmTeachingSessions.renderMermaid(container, session.mermaidMindmap, 'mindmap');
            } else {
                container.innerHTML = `
                    <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:12px;color:#92400e;font-size:13px;width:100%;">
                        <div>⚠️ Visual render issue: ${escapeHtml(err?.message || 'Syntax error')}</div>
                        <pre style="background:#ffffff;border:1px solid #fde68a;padding:8px;border-radius:4px;font-size:11px;margin-top:8px;overflow:auto;">${escapeHtml(model.mermaidText)}</pre>
                    </div>
                `;
            }
        }
    }

    /**
     * Initializes outcome filter segmented buttons and debounced search in the toolbar.
     */
    function setupToolbarControls(stageEl, svgEl, descriptors) {
        const toolbar = stageEl.querySelector('.crm-diagram-toolbar');
        if (!toolbar) return;

        // Ensure Mindmap toolbar extensions exist
        let mmControls = toolbar.querySelector('.crm-ts-mm-toolbar-group');
        if (!mmControls) {
            mmControls = document.createElement('div');
            mmControls.className = 'crm-ts-mm-toolbar-group';
            mmControls.innerHTML = `
                <div class="crm-ts-mm-filter-segmented" role="group" aria-label="Lọc theo kết quả">
                    <button type="button" class="crm-ts-mm-filter-btn active is-active" data-filter="all" title="Hiện tất cả">Tất cả</button>
                    <button type="button" class="crm-ts-mm-filter-btn" data-filter="mastered" title="Đã nắm vững">✅ Nắm vững</button>
                    <button type="button" class="crm-ts-mm-filter-btn" data-filter="partial" title="Tiến bộ một phần">🟡 Tiến bộ</button>
                    <button type="button" class="crm-ts-mm-filter-btn" data-filter="practice" title="Cần luyện tập">🔴 Cần luyện</button>
                </div>
                <div class="crm-ts-mm-search-box">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" class="crm-ts-mm-search-input" placeholder="Tìm kiếm sơ đồ..." aria-label="Tìm kiếm sơ đồ" />
                </div>
                <div class="crm-ts-mm-divider"></div>
            `;
            toolbar.prepend(mmControls);
        }

        // 1. Filter buttons
        const filterBtns = mmControls.querySelectorAll('.crm-ts-mm-filter-btn');
        filterBtns.forEach((btn) => {
            btn.onclick = () => {
                filterBtns.forEach((b) => {
                    b.classList.remove('active');
                    b.classList.remove('is-active');
                });
                btn.classList.add('active');
                btn.classList.add('is-active');
                const filter = btn.dataset.filter;

                if (filter === 'all') {
                    stageEl.removeAttribute('data-ts-filter');
                    svgEl?.querySelectorAll('g.mindmap-node').forEach((node) => {
                        node.removeAttribute('data-ts-match');
                    });
                } else {
                    stageEl.setAttribute('data-ts-filter', filter);
                    svgEl?.querySelectorAll('g.mindmap-node').forEach((node) => {
                        const matches = node.dataset.tsOutcome === filter;
                        node.setAttribute('data-ts-match', matches ? 'true' : 'false');
                    });
                }
            };
        });

        // 2. Search input (debounced ~120ms)
        const searchInput = mmControls.querySelector('.crm-ts-mm-search-input');
        if (searchInput) {
            if (searchInput._debounceTimer) {
                clearTimeout(searchInput._debounceTimer);
                searchInput._debounceTimer = null;
            }
            searchInput.oninput = () => {
                if (searchInput._debounceTimer) {
                    clearTimeout(searchInput._debounceTimer);
                }
                searchInput._debounceTimer = setTimeout(() => {
                    searchInput._debounceTimer = null;
                    const query = stripDiacritics(searchInput.value.trim());
                    if (!query) {
                        stageEl.removeAttribute('data-ts-search');
                        svgEl?.querySelectorAll('g.mindmap-node').forEach((node) => {
                            node.removeAttribute('data-ts-match');
                        });
                        return;
                    }

                    stageEl.setAttribute('data-ts-search', 'true');
                    let firstMatchNode = null;

                    svgEl?.querySelectorAll('g.mindmap-node').forEach((node) => {
                        const desc = node._tsDescriptor;
                        const fullText = stripDiacritics(desc?.fullText || node.textContent || '');
                        const isMatch = fullText.includes(query);
                        node.setAttribute('data-ts-match', isMatch ? 'true' : 'false');
                        if (isMatch && !firstMatchNode) {
                            firstMatchNode = node;
                        }
                    });

                    // Auto-pan to first match if found
                    if (firstMatchNode && typeof stageEl._panToElement === 'function') {
                        stageEl._panToElement(firstMatchNode);
                    }
                }, 120);
            };
        }
    }

    /**
     * Handles tooltips, node click selection, detail panel population, and collapse/expand.
     */
    function setupInteractiveBehaviors(stageEl, svgEl, container, session, onAudioSeek) {
        if (!stageEl || !svgEl) return;

        // Tooltip element (appended directly to stageEl, outside the zoomed wrapper)
        let tooltipEl = stageEl.querySelector('.crm-ts-mm-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'crm-ts-mm-tooltip';
            tooltipEl.style.display = 'none';
            stageEl.appendChild(tooltipEl);
        }

        // Detail panel element
        let detailPanel = document.getElementById('teaching-session-mindmap-detail');
        if (!detailPanel) {
            detailPanel = document.createElement('aside');
            detailPanel.id = 'teaching-session-mindmap-detail';
            detailPanel.className = 'crm-ts-mm-detail-panel';
            detailPanel.hidden = true;
            stageEl.appendChild(detailPanel);
        }

        const nodes = svgEl.querySelectorAll('g.mindmap-node');

        nodes.forEach((nodeG) => {
            // Hover: show tooltip
            nodeG.addEventListener('mouseenter', () => {
                const desc = nodeG._tsDescriptor;
                if (!desc) return;

                const nodeRect = nodeG.getBoundingClientRect();
                const stageRect = stageEl.getBoundingClientRect();
                if (stageRect.width === 0 || stageRect.height === 0) return;

                const kindLabels = {
                    root: '🎯 Chủ đề chính',
                    concept: '📖 Khái niệm đã dạy',
                    rule: '⚖️ Quy tắc trọng tâm',
                    problem: '⚠️ Vấn đề học viên',
                    outcome: '📊 Kết quả tiếp thu',
                    unassigned_bucket: '📁 Chưa phân loại',
                    next_lesson: '📋 Buổi sau',
                    briefing_category: '📑 Nhóm nội dung',
                    briefing_item: '📌 Nhiệm vụ'
                };

                let extraHtml = '';
                if (desc.approx_start_sec != null) {
                    extraHtml += `<div class="crm-ts-mm-tip-time">⏱ ~${formatTimestamp(desc.approx_start_sec)} (Bấm để nghe)</div>`;
                }
                if (desc.teacher_fix) {
                    const fixPreview = desc.teacher_fix.slice(0, 80) + (desc.teacher_fix.length > 80 ? '…' : '');
                    extraHtml += `<div class="crm-ts-mm-tip-solution">💡 ${escapeHtml(fixPreview)}</div>`;
                }

                tooltipEl.innerHTML = `
                    <div class="crm-ts-mm-tip-header">
                        <span class="crm-ts-mm-tip-kind">${escapeHtml(kindLabels[desc.kind] || 'Nội dung')}</span>
                        ${desc.severity ? `<span class="crm-ts-mm-severity ${classifySeverity(desc.severity)}">${escapeHtml(desc.severity)}</span>` : ''}
                    </div>
                    <div class="crm-ts-mm-tip-text">${escapeHtml(desc.fullText || desc.label)}</div>
                    ${extraHtml}
                `;
                tooltipEl.style.display = 'block';

                // Position tooltip above the node
                const tipW = tooltipEl.offsetWidth || 240;
                const tipH = tooltipEl.offsetHeight || 80;
                let left = (nodeRect.left - stageRect.left) + (nodeRect.width / 2) - (tipW / 2);
                let top = (nodeRect.top - stageRect.top) - tipH - 10;

                // Clamp to stage bounds
                left = Math.max(10, Math.min(stageRect.width - tipW - 10, left));
                if (top < 10) top = (nodeRect.bottom - stageRect.top) + 10;

                tooltipEl.style.left = `${left}px`;
                tooltipEl.style.top = `${top}px`;
            });

            nodeG.addEventListener('mouseleave', () => {
                tooltipEl.style.display = 'none';
            });

            // Click: select node, seek audio, open detail panel
            nodeG.addEventListener('click', (e) => {
                e.stopPropagation();
                tooltipEl.style.display = 'none';

                // Toggle selection
                nodes.forEach((n) => n.classList.remove('is-selected'));
                nodeG.classList.add('is-selected');

                const desc = nodeG._tsDescriptor;
                if (!desc) return;

                // Seek audio if timestamp exists
                if (desc.approx_start_sec != null && typeof onAudioSeek === 'function') {
                    onAudioSeek(desc.approx_start_sec, nodeG);
                }

                // Populate detail panel
                renderNodeDetailPanel(detailPanel, desc, session, onAudioSeek, async (toggleConceptId) => {
                    const collapsedSet = container._tsCollapsedSet || new Set();
                    if (collapsedSet.has(toggleConceptId)) {
                        collapsedSet.delete(toggleConceptId);
                    } else {
                        collapsedSet.add(toggleConceptId);
                    }
                    container._tsCollapsedSet = collapsedSet;
                    await renderInteractiveMindmap(container, session, {
                        seekSessionAudio: onAudioSeek,
                        preserveViewState: true
                    });
                }, svgEl);
            });
        });

        // Stage click outside: deselect & close detail panel if clicking blank background
        if (stageEl._mindmapClickHandler) {
            stageEl.removeEventListener('click', stageEl._mindmapClickHandler);
            stageEl._mindmapClickHandler = null;
        }
        stageEl._mindmapClickHandler = (e) => {
            if (e.target.closest('g.mindmap-node') || e.target.closest('#teaching-session-mindmap-detail') || e.target.closest('.crm-diagram-toolbar')) {
                return;
            }
            nodes.forEach((n) => n.classList.remove('is-selected'));
            if (detailPanel) detailPanel.hidden = true;
        };
        stageEl.addEventListener('click', stageEl._mindmapClickHandler);
    }

    /**
     * Renders the right-docked detail panel for a selected mindmap node.
     */
    function renderNodeDetailPanel(panelEl, desc, session, onAudioSeek, onToggleCollapse, svgEl) {
        if (!panelEl) return;
        panelEl.hidden = false;

        const kindLabels = {
            root: '🎯 Chủ đề cốt lõi',
            concept: '📖 Khái niệm đã dạy',
            rule: '⚖️ Quy tắc trọng tâm',
            problem: '⚠️ Vấn đề học viên',
            outcome: '📊 Kết quả tiếp thu',
            unassigned_bucket: '📁 Chưa phân loại',
            next_lesson: '📋 Buổi sau'
        };

        let bodyHtml = '';
        const hasAudio = Boolean(session && session.audioUrl);

        // Audio seek banner if timestamp present
        if (desc.approx_start_sec != null) {
            bodyHtml += `
                <div class="crm-ts-mm-detail-time-bar">
                    <span>⏱ Thời điểm ghi âm: <strong>~${formatTimestamp(desc.approx_start_sec)}</strong></span>
                    ${hasAudio ? `
                        <button type="button" class="crm-btn-seek-audio crm-btn-secondary crm-btn-xs" data-seek="${desc.approx_start_sec}">
                            ▶ Phát đoạn này
                        </button>
                    ` : '<span style="font-size:11px;color:var(--crm-text-muted);">(Không có file âm thanh)</span>'}
                </div>
            `;
        }

        // Concept & Buckets Details
        if (desc.kind === 'concept' || desc.kind === 'unassigned_bucket' || desc.kind === 'next_lesson') {
            bodyHtml += `
                <div class="crm-ts-mm-detail-section">
                    <h4>Nội dung kiến thức</h4>
                    <div class="crm-ts-mm-detail-lead">${escapeHtml(desc.fullText || desc.label)}</div>
                    ${desc.key_rule ? `<div class="crm-ts-mm-detail-rule"><strong>Quy tắc:</strong> ${escapeHtml(desc.key_rule)}</div>` : ''}
                    ${Array.isArray(desc.examples) && desc.examples.length > 0 ? `
                        <div class="crm-ts-mm-detail-examples">
                            <strong>Ví dụ minh họa:</strong>
                            <ul>${desc.examples.map((ex) => `<li>${escapeHtml(ex)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                    <button type="button" class="crm-btn-toggle-branch crm-btn-secondary crm-btn-xs" data-concept-id="${escapeHtml(desc.id)}">
                        ${desc.isCollapsed ? 'Mở rộng nhánh [+]' : 'Thu gọn nhánh [−]'}
                    </button>
                </div>
            `;
        } else if (desc.kind === 'problem' || desc.kind === 'outcome') {
            const outCls = classifyOutcome(desc.outcome);
            const isOutCls = outCls === 'mastered' ? 'is-mastered' : (outCls === 'partial' ? 'is-in-progress' : 'is-struggled');
            bodyHtml += `
                <div class="crm-ts-mm-detail-section">
                    <h4>Chi tiết lỗi & giải pháp</h4>
                    <div class="crm-ts-mm-detail-lead">${escapeHtml(desc.fullText || desc.label)}</div>
                    
                    ${desc.student_error ? `
                        <div class="crm-ts-mm-detail-field">
                            <span class="crm-ts-mm-field-title">Câu/từ học viên nói/viết:</span>
                            <blockquote class="crm-ts-mm-quote">${escapeHtml(desc.student_error)}</blockquote>
                        </div>
                    ` : ''}

                    ${desc.teacher_fix ? `
                        <div class="crm-ts-mm-detail-field">
                            <span class="crm-ts-mm-field-title">Giáo viên sửa lại:</span>
                            <div class="crm-ts-mm-solution">${escapeHtml(desc.teacher_fix)}</div>
                        </div>
                    ` : ''}

                    ${desc.outcome ? `
                        <div class="crm-ts-mm-detail-field">
                            <span class="crm-ts-mm-field-title">Kết quả đánh giá:</span>
                            <div class="crm-ts-mm-outcome-pill ${outCls} ${isOutCls}">
                                ${escapeHtml(desc.outcome)}
                            </div>
                            ${desc.outcome_evidence ? `<div class="crm-ts-mm-evidence">${escapeHtml(desc.outcome_evidence)}</div>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            bodyHtml += `
                <div class="crm-ts-mm-detail-section">
                    <div class="crm-ts-mm-detail-lead">${escapeHtml(desc.fullText || desc.label)}</div>
                </div>
            `;
        }

        panelEl.innerHTML = `
            <div class="crm-ts-mm-detail-header">
                <div class="crm-ts-mm-detail-badge-group">
                    <span class="crm-ts-mm-kind-badge">${escapeHtml(kindLabels[desc.kind] || 'Chi tiết')}</span>
                    ${desc.severity ? `<span class="crm-ts-mm-severity ${classifySeverity(desc.severity)}">${escapeHtml(desc.severity)}</span>` : ''}
                </div>
                <button type="button" class="crm-ts-mm-detail-close" aria-label="Đóng chi tiết">✕</button>
            </div>
            <div class="crm-ts-mm-detail-body">
                ${bodyHtml}
            </div>
        `;

        // Wire close button (closes panel and clears node selection highlight)
        const closeBtn = panelEl.querySelector('.crm-ts-mm-detail-close');
        if (closeBtn) {
            closeBtn.onclick = () => {
                panelEl.hidden = true;
                svgEl?.querySelectorAll('g.mindmap-node.is-selected').forEach((n) => n.classList.remove('is-selected'));
            };
        }

        // Wire seek button
        const seekBtn = panelEl.querySelector('.crm-btn-seek-audio');
        if (seekBtn && typeof onAudioSeek === 'function') {
            seekBtn.onclick = () => {
                onAudioSeek(seekBtn.dataset.seek, seekBtn);
            };
        }

        // Wire collapse/expand button
        const toggleBranchBtn = panelEl.querySelector('.crm-btn-toggle-branch');
        if (toggleBranchBtn && typeof onToggleCollapse === 'function') {
            toggleBranchBtn.onclick = () => {
                onToggleCollapse(toggleBranchBtn.dataset.conceptId);
            };
        }
    }

    global.CrmTeachingSessionMindmap = {
        buildMindmapModel,
        assignProblemsToConcepts,
        sanitizeMermaidText,
        renderInteractiveMindmap,
        refitDiagramLabels,
        stripDiacritics
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.CrmTeachingSessionMindmap;
    }
})(typeof window !== 'undefined' ? window : globalThis);
