(() => {
    const log = Logger.create('LevelSystem');

    const BASE_XP_DIVISOR = 25;
    const BRANCH_ORDER = ['listening', 'reading', 'writing', 'speaking'];
    const BRANCH_META = {
        listening: { label: 'Listening', icon: 'headphones' },
        reading: { label: 'Reading', icon: 'menu_book' },
        writing: { label: 'Writing', icon: 'edit_note' },
        speaking: { label: 'Speaking', icon: 'mic' }
    };

    const STARTER_ACTIVE_FALLBACK = new Set(['slow_audio', 'echo_loop', 'hint_wc', 'hint_fl', 'hint_reveal']);
    const LEGACY_UNLOCKS = {
        slow_audio: ['slowAudioUnlocked'],
        echo_loop: ['slowAudioUnlocked', 'replayTrainerUnlocked'],
        chunking: ['chunkingModeUnlocked'],
        hint_wc: ['hintLadderUnlocked'],
        hint_fl: ['hintLadderUnlocked'],
        hint_reveal: ['hintLadderUnlocked'],
        punct_ghost: ['hintLadderUnlocked'],
        typo_shield: ['hintLadderUnlocked'],
        dict_peek: ['vocabularyBookUnlocked'],
        pron_rune: ['phonemeCoachUnlocked', 'pronunciationAnalyzerUnlocked'],
        shadow_mode: ['shadowingModeUnlocked'],
        second_take: ['prosodyCoachUnlocked']
    };

    const BRANCH_LAYOUT = {
        listening: ['slow_audio', 'frugal_listener_1', 'echo_loop', 'audio_engineer', 'chunking', 'frugal_listener_2', 'transcript_glimpse', 'transcript_permit', 'clean_streak_saver', 'frugal_listener_3', 'streak_shield'],
        reading: ['dict_peek', 'frugal_reader_1', 'evidence_highlight', 'mode_license_watch', 'summary_scroll', 'frugal_reader_2', 'time_freeze', 'no_reveal_rebate', 'mode_license_extended', 'frugal_reader_3'],
        writing: ['hint_wc', 'frugal_writer_1', 'hint_fl', 'hint_kit', 'punct_ghost', 'hint_reveal', 'typo_shield', 'frugal_writer_2', 'coupon_book', 'combo_coupon', 'frugal_writer_3'],
        speaking: ['pron_rune', 'frugal_speaker_1', 'shadow_mode', 'breath_control', 'frugal_speaker_2', 'second_take', 'second_take_insurance', 'mode_license_speak', 'frugal_speaker_3']
    };

    const SKILL_ICONS = {
        slow_audio: 'slow_motion_video',
        echo_loop: 'repeat_one',
        chunking: 'segment',
        transcript_glimpse: 'visibility',
        hint_wc: 'pin',
        hint_fl: 'text_fields',
        hint_reveal: 'ink_highlighter',
        punct_ghost: 'format_quote',
        typo_shield: 'shield',
        dict_peek: 'dictionary',
        time_freeze: 'timer_pause',
        evidence_highlight: 'plagiarism',
        summary_scroll: 'summarize',
        pron_rune: 'record_voice_over',
        shadow_mode: 'graphic_eq',
        second_take: 'replay',
        streak_shield: 'workspace_premium',
        frugal_listener_1: 'savings',
        audio_engineer: 'tune',
        frugal_listener_2: 'savings',
        transcript_permit: 'description',
        clean_streak_saver: 'bolt',
        frugal_listener_3: 'savings',
        frugal_writer_1: 'savings',
        hint_kit: 'inventory_2',
        frugal_writer_2: 'savings',
        coupon_book: 'local_activity',
        combo_coupon: 'confirmation_number',
        frugal_writer_3: 'savings',
        frugal_reader_1: 'savings',
        mode_license_watch: 'live_tv',
        frugal_reader_2: 'savings',
        no_reveal_rebate: 'currency_exchange',
        mode_license_extended: 'article',
        frugal_reader_3: 'savings',
        frugal_speaker_1: 'savings',
        breath_control: 'air',
        frugal_speaker_2: 'savings',
        second_take_insurance: 'health_and_safety',
        mode_license_speak: 'mic_external_on',
        frugal_speaker_3: 'savings'
    };

    const ACTIVE_DESC = 'Active assist skill with coin cost per use.';
    const PASSIVE_DESC = 'Passive perk that modifies assist economy.';

    function num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function titleCase(value) {
        return String(value || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function esc(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function calculateLevel(totalPoints) {
        const points = Math.max(0, num(totalPoints, 0));
        return Math.max(1, Math.floor(Math.sqrt(points / BASE_XP_DIVISOR)));
    }

    function calculateCoreLevel(skillXp) {
        const points = Math.max(0, num(skillXp, 0));
        return Math.max(1, Math.floor(Math.sqrt(points / BASE_XP_DIVISOR)));
    }

    function getXPForLevel(level) {
        const safeLevel = Math.max(1, num(level, 1));
        return BASE_XP_DIVISOR * (safeLevel * safeLevel);
    }

    function getNextLevelXP(currentLevel) {
        return getXPForLevel(currentLevel + 1);
    }

    function getProgressToNextLevel(totalPoints) {
        const points = Math.max(0, num(totalPoints, 0));
        const currentLevel = calculateLevel(points);
        const floor = getXPForLevel(currentLevel);
        const next = getXPForLevel(currentLevel + 1);
        return {
            current: points,
            next,
            percent: Math.min(100, Math.max(0, ((points - floor) / Math.max(1, next - floor)) * 100))
        };
    }

    function getCoreProgress(skillXp) {
        const xp = Math.max(0, num(skillXp, 0));
        const level = calculateCoreLevel(xp);
        const floor = getXPForLevel(level);
        const next = getXPForLevel(level + 1);
        return {
            xp,
            level,
            percent: Math.min(100, Math.max(0, ((xp - floor) / Math.max(1, next - floor)) * 100))
        };
    }

    function getCatalog() {
        if (!window.SkillCatalog || !window.SkillCatalog.DATA) return null;
        return window.SkillCatalog;
    }

    function getSkillPoints(userProfile) {
        if (!userProfile || typeof userProfile !== 'object') return {};
        return userProfile.skillPoints && typeof userProfile.skillPoints === 'object' ? userProfile.skillPoints : {};
    }

    function getTreeXp(userProfile, tree) {
        return Math.max(0, num(getSkillPoints(userProfile)[tree], 0));
    }

    function getTreeLevel(userProfile, tree) {
        return calculateCoreLevel(getTreeXp(userProfile, tree));
    }

    function hasUnlockedSkill(skillId, userProfile) {
        if (!skillId) return false;
        if (skillId.startsWith('root_')) return true;
        if (!userProfile || typeof userProfile !== 'object') return false;

        const unlockedSkills = userProfile.unlockedSkills && typeof userProfile.unlockedSkills === 'object' ? userProfile.unlockedSkills : {};
        if (unlockedSkills[skillId] === true) return true;

        const skillPassives = userProfile.skillPassives && typeof userProfile.skillPassives === 'object' ? userProfile.skillPassives : {};
        if (skillPassives[skillId]) return true;

        const legacyFields = LEGACY_UNLOCKS[skillId] || [];
        if (legacyFields.some((field) => userProfile[field] === true)) return true;

        const catalog = getCatalog();
        const isActive = !!(catalog && catalog.DATA.active && catalog.DATA.active[skillId]);
        if (isActive && Object.keys(unlockedSkills).length === 0 && STARTER_ACTIVE_FALLBACK.has(skillId)) {
            return true;
        }
        return false;
    }

    function getRequirement(skillId, kind, skillData, catalog) {
        const req = catalog && catalog.getUnlockRequirement ? catalog.getUnlockRequirement(skillId) : null;
        if (req && req.tree && req.level) return { tree: req.tree, level: Math.max(1, num(req.level, 1)) };
        if (kind === 'passive') return { tree: skillData.tree || null, level: Math.max(1, num(skillData.level, 1)) };
        return { tree: Array.isArray(skillData.tags) && skillData.tags.length > 0 ? skillData.tags[0] : null, level: 1 };
    }

    const TREE_LAYOUT_MOCK = {
        listening: {
            root_listening: { x: 50, y: 2 },
            slow_audio: { x: 50, y: 16 },
            frugal_listener_1: { x: 72, y: 30 },
            echo_loop: { x: 30, y: 30 },
            audio_engineer: { x: 72, y: 44 },
            chunking: { x: 30, y: 44 },
            frugal_listener_2: { x: 72, y: 58 },
            transcript_glimpse: { x: 30, y: 58 },
            transcript_permit: { x: 50, y: 72 },
            clean_streak_saver: { x: 30, y: 84 },
            frugal_listener_3: { x: 72, y: 84 },
            streak_shield: { x: 50, y: 96 }
        },
        writing: {
            root_writing: { x: 50, y: 2 },
            hint_wc: { x: 50, y: 16 },
            frugal_writer_1: { x: 72, y: 30 },
            hint_fl: { x: 30, y: 30 },
            hint_kit: { x: 72, y: 44 },
            punct_ghost: { x: 30, y: 44 },
            hint_reveal: { x: 30, y: 58 },
            typo_shield: { x: 72, y: 58 },
            frugal_writer_2: { x: 50, y: 72 },
            coupon_book: { x: 30, y: 84 },
            combo_coupon: { x: 72, y: 84 },
            frugal_writer_3: { x: 50, y: 96 }
        },
        reading: {
            root_reading: { x: 50, y: 2 },
            dict_peek: { x: 50, y: 16 },
            frugal_reader_1: { x: 72, y: 30 },
            evidence_highlight: { x: 30, y: 30 },
            mode_license_watch: { x: 72, y: 44 },
            summary_scroll: { x: 30, y: 44 },
            frugal_reader_2: { x: 50, y: 58 },
            time_freeze: { x: 30, y: 72 },
            no_reveal_rebate: { x: 72, y: 72 },
            mode_license_extended: { x: 50, y: 86 }, // slightly lower to separate from tier 5
            frugal_reader_3: { x: 50, y: 98 }
        },
        speaking: {
            root_speaking: { x: 50, y: 2 },
            pron_rune: { x: 50, y: 16 },
            frugal_speaker_1: { x: 72, y: 30 },
            shadow_mode: { x: 30, y: 30 },
            breath_control: { x: 72, y: 44 },
            frugal_speaker_2: { x: 30, y: 44 },
            second_take: { x: 50, y: 58 },
            second_take_insurance: { x: 30, y: 72 },
            mode_license_speak: { x: 72, y: 72 },
            frugal_speaker_3: { x: 50, y: 86 }
        }
    };

    const TREE_EDGES_MOCK = {
        listening: [
            // Root → first skill (trunk)
            ['root_listening', 'slow_audio'],
            // Branch left & right from first skill
            ['slow_audio', 'echo_loop'],
            ['slow_audio', 'frugal_listener_1'],
            // Left branch continues
            ['echo_loop', 'chunking'],
            // Right branch continues
            ['frugal_listener_1', 'audio_engineer'],
            // Second tier continues
            ['chunking', 'transcript_glimpse'],
            ['audio_engineer', 'frugal_listener_2'],
            // Converge at transcript_permit
            ['transcript_glimpse', 'transcript_permit'],
            ['frugal_listener_2', 'transcript_permit'],
            // Branch again
            ['transcript_permit', 'clean_streak_saver'],
            ['transcript_permit', 'frugal_listener_3'],
            // Converge at capstone
            ['clean_streak_saver', 'streak_shield'],
            ['frugal_listener_3', 'streak_shield']
        ],
        writing: [
            ['root_writing', 'hint_wc'],
            ['hint_wc', 'hint_fl'],
            ['hint_wc', 'frugal_writer_1'],
            ['hint_fl', 'punct_ghost'],
            ['frugal_writer_1', 'hint_kit'],
            ['punct_ghost', 'hint_reveal'],
            ['hint_kit', 'typo_shield'],
            ['hint_reveal', 'frugal_writer_2'],
            ['typo_shield', 'frugal_writer_2'],
            ['frugal_writer_2', 'coupon_book'],
            ['frugal_writer_2', 'combo_coupon'],
            ['coupon_book', 'frugal_writer_3'],
            ['combo_coupon', 'frugal_writer_3']
        ],
        reading: [
            ['root_reading', 'dict_peek'],
            ['dict_peek', 'evidence_highlight'],
            ['dict_peek', 'frugal_reader_1'],
            ['evidence_highlight', 'summary_scroll'],
            ['frugal_reader_1', 'mode_license_watch'],
            ['summary_scroll', 'frugal_reader_2'],
            ['mode_license_watch', 'frugal_reader_2'],
            ['frugal_reader_2', 'time_freeze'],
            ['frugal_reader_2', 'no_reveal_rebate'],
            ['time_freeze', 'mode_license_extended'],
            ['no_reveal_rebate', 'mode_license_extended'],
            ['mode_license_extended', 'frugal_reader_3']
        ],
        speaking: [
            ['root_speaking', 'pron_rune'],
            ['pron_rune', 'shadow_mode'],
            ['pron_rune', 'frugal_speaker_1'],
            ['shadow_mode', 'frugal_speaker_2'],
            ['frugal_speaker_1', 'breath_control'],
            ['frugal_speaker_2', 'second_take'],
            ['breath_control', 'second_take'],
            ['second_take', 'second_take_insurance'],
            ['second_take', 'mode_license_speak'],
            ['second_take_insurance', 'frugal_speaker_3'],
            ['mode_license_speak', 'frugal_speaker_3']
        ]
    };

    function buildSkillNode(skillId, fallbackBranch, parentId, catalog, active, passive) {
        const isActive = !!active[skillId];
        const skillData = isActive ? active[skillId] : passive[skillId];
        if (!skillData) return null;

        const kind = isActive ? 'active' : 'passive';
        const req = getRequirement(skillId, kind, skillData, catalog);
        const branch = BRANCH_META[req.tree] ? req.tree : fallbackBranch;
        const unlockCost = catalog && catalog.getPurchaseCost ? num(catalog.getPurchaseCost(skillId), 0) : num(skillData.cost, 0);
        const customDesc = String(skillData.desc || '').trim();
        return {
            id: skillId,
            branch,
            parentId,
            level: Math.max(1, num(req.level, 1)),
            cost: Math.max(0, unlockCost),
            title: skillData.title || titleCase(skillId),
            description: customDesc || `${skillData.title || titleCase(skillId)}. ${kind === 'active' ? ACTIVE_DESC : PASSIVE_DESC}`,
            icon: SKILL_ICONS[skillId] || (kind === 'active' ? 'flash_on' : 'auto_awesome'),
            kind,
            tier: isActive ? (skillData.tier || null) : null,
            calibMult: isActive ? num(skillData.calibMult, 1) : null,
            useCost: isActive ? num(skillData.baseCost, 0) : null
        };
    }

    function buildSkillTreeData() {
        const catalog = getCatalog();
        if (!catalog) return { missingCatalog: true, nodesByBranch: {}, byId: {}, allNodes: [] };

        const active = catalog.DATA.active || {};
        const passive = catalog.DATA.passive || {};
        const allIds = new Set([...Object.keys(active), ...Object.keys(passive)]);
        const nodesByBranch = {};
        const byId = {};
        const allNodes = [];

        BRANCH_ORDER.forEach((branch) => {
            const root = {
                id: `root_${branch}`,
                branch,
                parentId: null,
                parentIds: [],
                level: 1,
                cost: 0,
                title: `${BRANCH_META[branch].label} Core`,
                description: `Base ${BRANCH_META[branch].label.toLowerCase()} path.`,
                icon: BRANCH_META[branch].icon,
                kind: 'root',
                tier: null,
                calibMult: null,
                useCost: null
            };
            nodesByBranch[branch] = [root];
            byId[root.id] = root;
            allNodes.push(root);
        });

        const branchIds = { listening: [], reading: [], writing: [], speaking: [] };
        BRANCH_ORDER.forEach((branch) => {
            (BRANCH_LAYOUT[branch] || []).forEach((skillId) => {
                if (!allIds.has(skillId)) return;
                branchIds[branch].push(skillId);
                allIds.delete(skillId);
            });
        });

        Array.from(allIds).forEach((skillId) => {
            const isActive = !!active[skillId];
            const skillData = isActive ? active[skillId] : passive[skillId];
            if (!skillData) return;
            const req = getRequirement(skillId, isActive ? 'active' : 'passive', skillData, catalog);
            const branch = BRANCH_META[req.tree] ? req.tree : 'listening';
            branchIds[branch].push(skillId);
        });

        BRANCH_ORDER.forEach((branch) => {
            const preferredSet = new Set(BRANCH_LAYOUT[branch] || []);
            const preferred = branchIds[branch].filter((skillId) => preferredSet.has(skillId));
            const appended = branchIds[branch]
                .filter((skillId) => !preferredSet.has(skillId))
                .sort((a, b) => {
                    const aData = active[a] || passive[a];
                    const bData = active[b] || passive[b];
                    const aReq = getRequirement(a, active[a] ? 'active' : 'passive', aData || {}, catalog);
                    const bReq = getRequirement(b, active[b] ? 'active' : 'passive', bData || {}, catalog);
                    if (aReq.level !== bReq.level) return aReq.level - bReq.level;
                    return (aData?.title || a).localeCompare(bData?.title || b);
                });

            let parentId = `root_${branch}`;
            [...preferred, ...appended].forEach((skillId) => {
                const node = buildSkillNode(skillId, branch, parentId, catalog, active, passive);
                if (!node) return;
                node.parentIds = [];
                nodesByBranch[branch].push(node);
                byId[node.id] = node;
                allNodes.push(node);
                parentId = node.id;
            });
        });

        // Derive parentIds from TREE_EDGES_MOCK for branching topology
        BRANCH_ORDER.forEach((branch) => {
            const edges = TREE_EDGES_MOCK[branch] || [];
            edges.forEach(([fromId, toId]) => {
                const toNode = byId[toId];
                if (toNode && !toNode.parentIds.includes(fromId)) {
                    toNode.parentIds.push(fromId);
                }
                // Keep first parent as primary parentId for backward compat
                if (toNode && !toNode.parentId) {
                    toNode.parentId = fromId;
                }
            });
        });

        return { missingCatalog: false, nodesByBranch, byId, allNodes };
    }

    function getNodeState(node, userProfile) {
        if (!node) return { unlocked: false, parentUnlocked: false, levelMet: false, currentLevel: 1, canAfford: false, available: false };
        if (node.kind === 'root') {
            return { unlocked: true, parentUnlocked: true, levelMet: true, currentLevel: getTreeLevel(userProfile, node.branch), canAfford: true, available: false };
        }

        const unlocked = hasUnlockedSkill(node.id, userProfile);
        // For branching trees: available if ANY parent is unlocked
        const parents = node.parentIds && node.parentIds.length > 0 ? node.parentIds : (node.parentId ? [node.parentId] : []);
        const parentUnlocked = parents.length === 0 ? true : parents.some(pid => hasUnlockedSkill(pid, userProfile));
        const currentLevel = getTreeLevel(userProfile, node.branch);
        const levelMet = currentLevel >= node.level;
        const canAfford = Math.max(0, num(userProfile?.coins, 0)) >= Math.max(0, node.cost || 0);
        const available = !unlocked && parentUnlocked && levelMet;
        return { unlocked, parentUnlocked, levelMet, currentLevel, canAfford, available };
    }

    function updateHeaderLevel(userProfile) {
        if (!userProfile) return;
        const headerBadge = document.getElementById('level-header-display');
        const levelNumEl = document.getElementById('header-level-num');
        const xpBar = document.getElementById('header-xp-bar');
        if (!headerBadge || !levelNumEl || !xpBar) return;

        const totalPoints = Number.isFinite(num(userProfile.totalPoints, NaN))
            ? Math.max(0, num(userProfile.totalPoints, 0))
            : BRANCH_ORDER.reduce((sum, branch) => sum + getTreeXp(userProfile, branch), 0);
        const level = calculateLevel(totalPoints);
        const progress = getProgressToNextLevel(totalPoints);
        levelNumEl.textContent = String(level);
        xpBar.style.width = `${progress.percent}%`;
        if (headerBadge.style.display === 'none') headerBadge.style.display = 'inline-flex';
    }

    function getSkillIconHtml(node, size = 'normal') {
        const runeText = (node.title || node.id).substring(0, 2).toUpperCase();

        // Priority: PNG (Custom), then SVG (Custom), then Painted PNG, then Vector SVG, then Rune.
        const customPng = `assets/skill-icons/custom/${node.id}.png`;
        const customSvg = `assets/skill-icons/custom/${node.id}.svg`;
        const paintedPng = `assets/skill-icons/painted/${node.id}.png`;
        const vectorSvg = `assets/skill-icons/vector/${node.id}.svg`;
        const sizeClass = size === 'large' ? 'rpg-icon-large' : 'rpg-icon';

        return `<img src="${customPng}" 
                     class="${sizeClass}" 
                     alt="${esc(node.title)}"
                     onerror="this.onerror=null; this.src='${customSvg}'; this.addEventListener('error', () => { this.src='${paintedPng}'; this.addEventListener('error', () => { this.src='${vectorSvg}'; this.addEventListener('error', () => { if(this.parentNode) this.parentNode.innerHTML = '${runeText}'; }) }) })" />`;
    }

    function renderSkillTree(container, userProfile, buyCallback) {
        updateHeaderLevel(userProfile);
        if (!container) return;

        const safeProfile = userProfile && typeof userProfile === 'object' ? userProfile : {};
        const treeData = buildSkillTreeData();
        if (treeData.missingCatalog) {
            container.innerHTML = `<div class="rpg-detail-card"><h3 style="margin-top:0;">Skill Catalog Missing</h3><p>Cannot render skill tree because <code>window.SkillCatalog</code> is unavailable.</p></div>`;
            return;
        }

        const coins = num(safeProfile.coins, 0);
        const unlockedSkills = safeProfile.unlockedSkills || {};

        let activeBranch = 'listening';

        const renderTreeCanvas = (branch) => {
            const nodes = treeData.nodesByBranch[branch] || [];
            const positions = TREE_LAYOUT_MOCK[branch] || {};

            // Re-render the tree contents inside the wrap
            let htmlNodes = '';
            nodes.forEach((node) => {
                const state = getNodeState(node, safeProfile);
                const statusClass = state.unlocked ? 'acquired' : (state.available ? 'available' : 'locked');
                const kindClass = node.kind;
                const pos = positions[node.id] || { x: 50, y: 50 };

                htmlNodes += `
                    <div class="rpg-node ${statusClass} ${kindClass}" data-id="${node.id}" style="left:${pos.x}%; top:${pos.y}%;">
                        <div class="rpg-rank">${state.unlocked ? '1/1' : '0/1'}</div>
                        ${state.available ? `<div class="rpg-dot"></div>` : ''}
                        <div class="rpg-orb">
                            ${getSkillIconHtml(node)}
                        </div>
                        ${statusClass === 'available' ? `<div class="rpg-plus">+</div>` : ''}
                    </div>`;
            });
            return htmlNodes;
        };

        const renderLinks = (branch, container) => {
            const svg = container.querySelector('.rpg-links-svg');
            if (!svg) {
                log.warn('LevelSystem: SVG container not found for links');
                return;
            }
            const wrap = container.querySelector('.rpg-tree-wrap');
            if (!wrap) return;
            const rect = wrap.getBoundingClientRect();
            const edges = TREE_EDGES_MOCK[branch] || [];
            const nodes = treeData.nodesByBranch[branch] || [];

            svg.innerHTML = '';
            edges.forEach(edge => {
                const fromEl = container.querySelector(`.rpg-node[data-id="${edge[0]}"]`);
                const toEl = container.querySelector(`.rpg-node[data-id="${edge[1]}"]`);
                if (!fromEl || !toEl) return;

                const fromPos = TREE_LAYOUT_MOCK[branch][edge[0]];
                const toPos = TREE_LAYOUT_MOCK[branch][edge[1]];

                const ax = fromPos.x * rect.width / 100;
                const ay = fromPos.y * rect.height / 100;
                const bx = toPos.x * rect.width / 100;
                const by = toPos.y * rect.height / 100;

                const toNode = nodes.find(n => n.id === edge[1]);
                const klass = toNode ? toNode.kind : '';

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("class", `rpg-link ${klass}`);
                const midY = (ay + by) / 2;
                path.setAttribute("d", `M ${ax} ${ay} C ${ax} ${midY}, ${bx} ${midY}, ${bx} ${by}`);
                svg.appendChild(path);
            });
        };

        const renderDetailPanel = (node = null) => {
            const detailArea = container.querySelector('#rpg-detail-panel');
            if (!detailArea) return;

            if (!node) {
                detailArea.innerHTML = `
                    <div class="rpg-empty">
                        <div class="rpg-empty-title">Select a skill</div>
                        <div class="rpg-empty-sub">Pick a node in the tree to view its details and unlock requirements.</div>
                    </div>`;
                return;
            }

            const state = getNodeState(node, safeProfile);
            const branchLabel = BRANCH_META[node.branch]?.label || titleCase(node.branch);
            const canBuy = node.kind !== 'root' && !state.unlocked && state.available && coins >= node.cost;

            const catalog = getCatalog();
            const skillDef = catalog && typeof catalog.getSkill === 'function' ? catalog.getSkill(node.id) : null;
            // allowedModes removed — no longer displayed in simplified panel
            const tier = String(skillDef?.tier || node.tier || '').trim();
            const flatCost = !!skillDef?.flatCost;
            const useCost = Number.isFinite(num(skillDef?.baseCost, NaN)) ? num(skillDef?.baseCost, 0) : num(node.useCost, 0);
            const calibMult = Number.isFinite(num(skillDef?.calibMult, NaN)) ? num(skillDef?.calibMult, 1) : num(node.calibMult, 1);
            const parent = node.parentId ? treeData.byId[node.parentId] : null;

            // Derive all prerequisite parents from parentIds (branching tree)
            const prereqParents = (node.parentIds && node.parentIds.length > 0 ? node.parentIds : (node.parentId ? [node.parentId] : []))
                .map(pid => treeData.byId[pid]).filter(Boolean);
            const hasAnyPrereq = prereqParents.length === 0 || prereqParents.some(p => hasUnlockedSkill(p.id, safeProfile));
            const nodeLevelReq = node.level; // Using node.level as level_req

            // Build prerequisite HTML
            const prereqHtml = prereqParents.map(p => {
                const met = hasUnlockedSkill(p.id, safeProfile);
                return `
                        <div class="rpg-req-item ${met ? 'unlocked' : ''}">
                            <span class="label">Prerequisite</span>
                            <span class="val rpg-jump-link" data-jump-id="${p.id}">${esc(p.title)}</span>
                        </div>`;
            }).join('');

            detailArea.innerHTML = `
                <div class="rpg-detail-header">
                    <div class="rpg-detail-icon-wrapper">
                        ${getSkillIconHtml(node, 'large')}
                    </div>
                    <div class="rpg-detail-title-row">
                        <div class="rpg-detail-name">${esc(node.title)}</div>
                        <div class="rpg-detail-sub">${node.kind === 'root' ? 'Core' : (node.kind === 'passive' ? 'Passive Ability' : 'Active Skill')}</div>
                    </div>
                </div>
                <div class="rpg-detail-scroll">
                    <div class="rpg-req-group">
                        <div class="rpg-req-title">REQUIREMENTS</div>
                        <div class="rpg-req-item ${state.levelMet ? 'unlocked' : ''}">
                            <span class="label">${titleCase(node.branch)} Level</span>
                            <span class="val">${state.currentLevel} / ${nodeLevelReq}</span>
                        </div>
                        ${prereqHtml}
                        <div class="rpg-req-item ${canBuy ? 'unlocked' : ''}">
                            <span class="label">Unlock Cost</span>
                            <span class="val">${node.cost} Coins</span>
                        </div>
                    </div>
                    <div class="rpg-detail-section">
                        <div class="rpg-detail-sec-title">SKILL DETAILS</div>
                        
                        ${skillDef && skillDef.allowedModes ? `
                        <div class="rpg-detail-modes">
                            <span class="label">Applies to:</span>
                            <span class="val">${skillDef.allowedModes.join(', ').toUpperCase()}</span>
                        </div>` : ''}

                        <p class="rpg-detail-desc">${esc(node.description)}</p>
                        
                        ${node.kind === 'active' ? `
                            <div class="rpg-detail-stat">
                                <span class="label">Use Cost</span>
                                <span class="val">${useCost} Coins${flatCost ? '' : '/use'}</span>
                            </div>
                            
                            <div class="rpg-calib-box">
                                <div class="rpg-calib-header">
                                    <span class="label">Calibration Impact</span>
                                    <span class="val">${Math.round(calibMult * 100)}%</span>
                                </div>
                                <p class="rpg-calib-explain">
                                    Calibration represents your "Assisted Score". 
                                    Using this skill counts as <strong>${Math.round(calibMult * 100)}%</strong> of a normal correct answer for XP & Coin rewards.
                                    <br><em>(Lower impact = fewer rewards)</em>
                                </p>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="rpg-detail-footer">
                    <button class="rpg-action-btn btn-secondary" id="btn-undo-selection" type="button">Close</button>
                    ${node.kind !== 'root'
                    ? (!state.unlocked
                        ? `<button class="rpg-action-btn ${canBuy ? 'btn-active' : 'btn-disabled'}" id="btn-unlock-${node.id}" type="button" ${canBuy ? '' : 'disabled'}>Unlock Skill</button>`
                        : `<button class="rpg-action-btn btn-mastered" type="button" disabled>Already Unlocked</button>`)
                    : `<button class="rpg-action-btn btn-mastered" type="button" disabled>Core Branch</button>`}
                </div>`;

            // Event Listeners for new elements
            detailArea.querySelectorAll('.rpg-jump-link').forEach(link => {
                link.addEventListener('click', () => {
                    const targetId = link.dataset.jumpId;
                    const nodeEl = container.querySelector(`.rpg-node[data-id="${targetId}"]`);
                    if (nodeEl) {
                        // Deselect all
                        container.querySelectorAll('.rpg-node').forEach(n => n.classList.remove('node-selected'));
                        // Select target
                        nodeEl.classList.add('node-selected');
                        // Scroll to it if needed (optional but good for UX)
                        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                        // Render detail
                        const targetNode = treeData.byId[targetId];
                        renderDetailPanel(targetNode);
                    }
                });
            });

            const undoBtn = detailArea.querySelector('#btn-undo-selection');
            if (undoBtn) {
                undoBtn.addEventListener('click', () => {
                    container.querySelectorAll('.rpg-node').forEach(n => n.classList.remove('node-selected'));
                    renderDetailPanel(null);
                });
            }

            const unlockBtn = detailArea.querySelector(`#btn-unlock-${node.id}`);
            if (unlockBtn && canBuy) {
                unlockBtn.addEventListener('click', async () => {
                    unlockBtn.disabled = true;
                    unlockBtn.textContent = 'Unlocking...';
                    const result = await buyCallback(node, unlockBtn);
                    if (result === true || (result && result.success)) {
                        const refreshedProfile = result.userProfile || {
                            ...safeProfile,
                            coins: coins - node.cost,
                            unlockedSkills: { ...unlockedSkills, [node.id]: true }
                        };
                        renderSkillTree(container, refreshedProfile, buyCallback);
                    } else {
                        unlockBtn.disabled = false;
                        unlockBtn.textContent = 'Unlock Skill';
                    }
                });
            }
        };

        // Main Structure
        container.innerHTML = `
            <div class="rpg-main-layout">
                <aside class="rpg-sidebar">
                    <div class="rpg-sidebar-inner">
                        <div class="rpg-sidebar-header">SKILLS</div>
                        <div class="rpg-category-list">
                            ${BRANCH_ORDER.map(cat => `
                                <button class="rpg-cat-btn ${activeBranch === cat ? 'active' : ''}" 
                                        data-branch="${cat}">
                                    ${cat.toUpperCase()}
                                </button>
                            `).join('')}
                        </div>
                        <div class="rpg-sidebar-footer">
                            <div class="rpg-coins-display">
                                <span class="icon">🪙</span>
                                <span class="val">${userProfile.coins || 0}</span>
                            </div>
                        </div>
                    </div>
                </aside>
                <div class="rpg-tree-wrap">
                    <div class="rpg-tree-grid"></div>
                    <div class="rpg-tree-svg-container">
                        <svg class="rpg-links-svg" width="100%" height="100%" style="position:absolute; inset:0; pointer-events:none;"></svg>
                    </div>
                    <div class="rpg-tree-nodes"></div>
                </div>
                <div class="rpg-detail-panel" id="rpg-detail-panel">
                    <div class="rpg-detail-empty">Select a skill to view details</div>
                </div>
            </div>`;

        // Interactivity
        const sidebar = container.querySelector('.rpg-sidebar');
        sidebar.querySelectorAll('.rpg-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                sidebar.querySelectorAll('.rpg-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeBranch = btn.dataset.branch;
                container.querySelector('.rpg-tree-nodes').innerHTML = renderTreeCanvas(activeBranch);
                renderLinks(activeBranch, container);
                renderDetailPanel(null);
                attachNodeClicks();
            });
        });

        const attachNodeClicks = () => {
            container.querySelectorAll('.rpg-node').forEach(el => {
                el.addEventListener('click', () => {
                    container.querySelectorAll('.rpg-node').forEach(n => n.classList.remove('node-selected'));
                    el.classList.add('node-selected');
                    const node = treeData.byId[el.dataset.id];
                    renderDetailPanel(node);
                });
            });
        };

        container.querySelector('.rpg-tree-nodes').innerHTML = renderTreeCanvas(activeBranch);
        attachNodeClicks();
        renderLinks(activeBranch, container);
        renderDetailPanel(null); // Show the empty state on initial load

        // Resize observer to re-render links on container resize
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(() => renderLinks(activeBranch, container));
            observer.observe(container);
        }
    }

    window.LevelSystem = {
        calculateLevel,
        calculateCoreLevel,
        getNextLevelXP,
        getProgressToNextLevel,
        getCoreProgress,
        updateHeaderLevel,
        getUnlockables: () => buildSkillTreeData().allNodes,
        isUnlocked: (itemId, userProfile) => hasUnlockedSkill(itemId, userProfile),
        renderSkillTree
    };

    log.debug('LevelSystem module initialized.');
})();
