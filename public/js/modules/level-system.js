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
        word_ghost: ['hintLadderUnlocked'],
        first_letter_peek: ['hintLadderUnlocked'],
        hint_reveal: ['hintLadderUnlocked'],
        typo_shield: ['hintLadderUnlocked'],
        dict_peek: ['vocabularyBookUnlocked'],
        pron_rune: ['phonemeCoachUnlocked', 'pronunciationAnalyzerUnlocked'],
        shadow_mode: ['shadowingModeUnlocked'],
        second_take: ['prosodyCoachUnlocked']
    };
    const LEGACY_MODE_SKILL_UNLOCKS = {
        length_filter: 'lengthFilter',
        difficulty_filter: 'difficultyFilter'
    };

    const BRANCH_LAYOUT = {
        listening: ['length_filter', 'difficulty_filter', 'slow_audio', 'frugal_listener_1', 'echo_loop', 'audio_engineer', 'chunking', 'frugal_listener_2', 'transcript_glimpse', 'transcript_permit', 'clean_streak_saver', 'frugal_listener_3', 'streak_shield'],
        reading: ['dict_peek', 'frugal_reader_1', 'evidence_highlight', 'mode_license_watch', 'summary_scroll', 'frugal_reader_2', 'no_reveal_rebate', 'mode_license_extended', 'frugal_reader_3'],
        writing: ['word_ghost', 'frugal_writer_1', 'first_letter_peek', 'hint_kit', 'hint_reveal', 'typo_shield', 'frugal_writer_2', 'coupon_book', 'combo_coupon', 'frugal_writer_3'],
        speaking: ['pron_rune', 'frugal_speaker_1', 'shadow_mode', 'breath_control', 'frugal_speaker_2', 'second_take', 'second_take_insurance', 'mode_license_speak', 'frugal_speaker_3']
    };

    const SKILL_ICONS = {
        length_filter: 'straighten',
        difficulty_filter: 'filter_list',
        slow_audio: 'slow_motion_video',
        echo_loop: 'repeat_one',
        chunking: 'segment',
        transcript_glimpse: 'subtitles',
        word_ghost: 'password',
        first_letter_peek: 'spellcheck',
        hint_reveal: 'visibility',
        typo_shield: 'shield',
        dict_peek: 'auto_stories',
        evidence_highlight: 'find_in_page',
        summary_scroll: 'summarize',
        pron_rune: 'record_voice_over',
        shadow_mode: 'interpreter_mode',
        second_take: 'restart_alt',
        streak_shield: 'workspace_premium',
        frugal_listener_1: 'savings',
        audio_engineer: 'equalizer',
        frugal_listener_2: 'savings',
        transcript_permit: 'description',
        clean_streak_saver: 'bolt',
        frugal_listener_3: 'savings',
        frugal_writer_1: 'savings',
        hint_kit: 'inventory_2',
        frugal_writer_2: 'savings',
        coupon_book: 'local_activity',
        combo_coupon: 'auto_awesome',
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

        const legacyModeId = LEGACY_MODE_SKILL_UNLOCKS[skillId];
        const legacyModes = userProfile.unlockedModes && Array.isArray(userProfile.unlockedModes) ? userProfile.unlockedModes : [];
        if (legacyModeId && legacyModes.includes(legacyModeId)) return true;

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
            root_listening: { x: 50, y: 10 },
            length_filter: { x: 18, y: 22 },
            difficulty_filter: { x: 18, y: 34 },
            slow_audio: { x: 50, y: 24 },
            frugal_listener_1: { x: 78, y: 36 },
            echo_loop: { x: 30, y: 46 },
            audio_engineer: { x: 78, y: 48 },
            chunking: { x: 30, y: 58 },
            frugal_listener_2: { x: 78, y: 60 },
            transcript_glimpse: { x: 30, y: 70 },
            transcript_permit: { x: 50, y: 80 },
            clean_streak_saver: { x: 30, y: 88 },
            frugal_listener_3: { x: 78, y: 88 },
            streak_shield: { x: 50, y: 92 }
        },
        writing: {
            root_writing: { x: 50, y: 10 },
            word_ghost: { x: 50, y: 24 },
            frugal_writer_1: { x: 72, y: 36 },
            first_letter_peek: { x: 30, y: 36 },
            hint_kit: { x: 72, y: 48 },
            hint_reveal: { x: 30, y: 60 },
            typo_shield: { x: 72, y: 60 },
            frugal_writer_2: { x: 50, y: 72 },
            coupon_book: { x: 30, y: 82 },
            combo_coupon: { x: 72, y: 82 },
            frugal_writer_3: { x: 50, y: 92 }
        },
        reading: {
            root_reading: { x: 50, y: 10 },
            dict_peek: { x: 50, y: 24 },
            frugal_reader_1: { x: 72, y: 36 },
            evidence_highlight: { x: 30, y: 36 },
            mode_license_watch: { x: 72, y: 48 },
            summary_scroll: { x: 30, y: 48 },
            frugal_reader_2: { x: 50, y: 60 },
            no_reveal_rebate: { x: 72, y: 72 },
            mode_license_extended: { x: 50, y: 82 },
            frugal_reader_3: { x: 50, y: 92 }
        },
        speaking: {
            root_speaking: { x: 50, y: 10 },
            pron_rune: { x: 50, y: 24 },
            frugal_speaker_1: { x: 72, y: 36 },
            shadow_mode: { x: 30, y: 36 },
            breath_control: { x: 72, y: 48 },
            frugal_speaker_2: { x: 30, y: 48 },
            second_take: { x: 50, y: 60 },
            second_take_insurance: { x: 30, y: 72 },
            mode_license_speak: { x: 72, y: 72 },
            frugal_speaker_3: { x: 50, y: 84 }
        }
    };

    const TREE_EDGES_MOCK = {
        listening: [
            // Root -> trunk + branches
            ['root_listening', 'slow_audio'],
            ['root_listening', 'length_filter'],
            ['length_filter', 'difficulty_filter'],
            // Branch left & right from trunk
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
            ['root_writing', 'word_ghost'],
            ['word_ghost', 'first_letter_peek'],
            ['word_ghost', 'frugal_writer_1'],
            ['first_letter_peek', 'hint_reveal'],
            ['frugal_writer_1', 'hint_kit'],
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
            ['frugal_reader_2', 'no_reveal_rebate'],
            ['frugal_reader_2', 'mode_license_extended'],
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
            useCost: isActive ? num(skillData.baseCost, 0) : null,
            comingSoon: !!skillData.comingSoon
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
            const primaryParentSet = new Set();
            edges.forEach(([fromId, toId]) => {
                const toNode = byId[toId];
                if (!toNode) return;

                if (!Array.isArray(toNode.parentIds)) toNode.parentIds = [];
                if (!toNode.parentIds.includes(fromId)) {
                    toNode.parentIds.push(fromId);
                }

                // Use the first edge we see as the primary parentId to keep the
                // detail panel consistent with the actual graph topology.
                if (!primaryParentSet.has(toId)) {
                    toNode.parentId = fromId;
                    primaryParentSet.add(toId);
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

    window.__skillIconFallback = function (img, id, matIcon, sizeClass) {
        const fallbacks = [
            `assets/skill-icons/custom/${id}.svg`,
            `assets/skill-icons/painted/${id}.png`,
            `assets/skill-icons/vector/${id}.svg`
        ];
        let idx = parseInt(img.dataset.fallbackIdx || '0', 10);
        if (idx < fallbacks.length) {
            img.dataset.fallbackIdx = idx + 1;
            img.src = fallbacks[idx];
        } else {
            if (img.parentNode) {
                img.parentNode.innerHTML = `<span class="material-symbols-outlined ${sizeClass}">${matIcon || 'star'}</span>`;
            }
        }
    };

    function getSkillIconHtml(node, size = 'normal') {
        const customPng = `assets/skill-icons/custom/${node.id}.png`;
        const sizeClass = size === 'large' ? 'rpg-icon-large' : 'rpg-icon';
        const matIcon = node.icon || 'star';

        return `<img src="${customPng}" class="${sizeClass}" alt="${esc(node.title)}" onerror="window.__skillIconFallback(this, '${node.id}', '${matIcon}', '${sizeClass}')" />`;
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
        const ZOOM_MIN = 0.5;
        const ZOOM_MAX = 1.5;
        const ZOOM_STEP = 0.1;
        const ZOOM_EPSILON = 0.0001;
        const PINCH_MIN_DISTANCE = 8;
        const PAN_INERTIA_MIN_SPEED = 0.08;
        const PAN_INERTIA_STOP_SPEED = 0.01;
        const PAN_INERTIA_FRICTION = 0.9;
        const createDefaultViewportState = () => ({ scale: 1, x: 0, y: 0 });
        const viewportStateByBranch = BRANCH_ORDER.reduce((acc, branch) => {
            acc[branch] = createDefaultViewportState();
            return acc;
        }, {});
        const viewportDirtyByBranch = BRANCH_ORDER.reduce((acc, branch) => {
            acc[branch] = false;
            return acc;
        }, {});

        const clampZoom = (value) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
        const getViewportState = (branch) => {
            if (!viewportStateByBranch[branch]) {
                viewportStateByBranch[branch] = createDefaultViewportState();
            }
            return viewportStateByBranch[branch];
        };
        const getBranchBounds = (branch) => {
            const points = Object.values(TREE_LAYOUT_MOCK[branch] || {});
            if (!points.length) {
                return { minX: 10, maxX: 90, minY: 10, maxY: 90 };
            }
            return points.reduce((bounds, point) => ({
                minX: Math.min(bounds.minX, num(point.x, 50)),
                maxX: Math.max(bounds.maxX, num(point.x, 50)),
                minY: Math.min(bounds.minY, num(point.y, 50)),
                maxY: Math.max(bounds.maxY, num(point.y, 50))
            }), { minX: 100, maxX: 0, minY: 100, maxY: 0 });
        };

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
            const scene = container.querySelector('.rpg-tree-scene');
            if (!scene) return;
            const width = scene.clientWidth;
            const height = scene.clientHeight;
            const edges = TREE_EDGES_MOCK[branch] || [];
            const nodes = treeData.nodesByBranch[branch] || [];

            svg.innerHTML = '';
            edges.forEach(edge => {
                const fromEl = container.querySelector(`.rpg-node[data-id="${edge[0]}"]`);
                const toEl = container.querySelector(`.rpg-node[data-id="${edge[1]}"]`);
                if (!fromEl || !toEl) return;

                const fromPos = TREE_LAYOUT_MOCK[branch][edge[0]];
                const toPos = TREE_LAYOUT_MOCK[branch][edge[1]];

                const ax = fromPos.x * width / 100;
                const ay = fromPos.y * height / 100;
                const bx = toPos.x * width / 100;
                const by = toPos.y * height / 100;

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
                detailArea.classList.remove('active'); // Close panel
                detailArea.innerHTML = `
                    <div class="rpg-empty">
                        <div class="rpg-empty-title">Select a skill</div>
                        <div class="rpg-empty-sub">Pick a node in the tree to view its details and unlock requirements.</div>
                    </div>`;
                return;
            }

            // Open panel on mobile
            detailArea.classList.add('active');

            const state = getNodeState(node, safeProfile);
            const branchLabel = BRANCH_META[node.branch]?.label || titleCase(node.branch);
            const isComingSoon = !!node.comingSoon;
            const canBuy = !isComingSoon && node.kind !== 'root' && !state.unlocked && state.available && coins >= node.cost;

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

            // Build Panel Content
            detailArea.innerHTML = `
                <button class="rpg-close-detail" onclick="document.getElementById('rpg-detail-panel').classList.remove('active')">×</button>
                <div class="rpg-detail-header">
                    <div class="rpg-detail-icon-large ${state.unlocked ? 'unlocked' : ''}">
                        ${getSkillIconHtml(node)}
                    </div>
                    <div class="rpg-detail-title-row">
                        <div class="rpg-detail-name">${esc(node.title)}${isComingSoon ? ' <span class="rpg-coming-soon-badge">Coming Soon</span>' : ''}</div>
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
                    ? (isComingSoon
                        ? `<button class="rpg-action-btn btn-disabled" type="button" disabled>Coming Soon</button>`
                        : (!state.unlocked
                            ? `<button class="rpg-action-btn ${canBuy ? 'btn-active' : 'btn-disabled'}" id="btn-unlock-${node.id}" type="button" ${canBuy ? '' : 'disabled'}>Unlock Skill</button>`
                            : `<button class="rpg-action-btn btn-mastered" type="button" disabled>Already Unlocked</button>`))
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
                    <div class="rpg-tree-toolbar">
                        <div class="rpg-tree-gesture-hint">Pinch/scroll to zoom • Drag to pan</div>
                        <button class="rpg-zoom-btn" type="button" data-zoom-action="out" aria-label="Zoom out">-</button>
                        <span class="rpg-zoom-value" data-zoom-value>100%</span>
                        <button class="rpg-zoom-btn" type="button" data-zoom-action="in" aria-label="Zoom in">+</button>
                        <button class="rpg-zoom-reset" type="button" data-zoom-action="reset">Reset</button>
                    </div>
                    <div class="rpg-tree-viewport" data-tree-viewport>
                        <div class="rpg-tree-scene" data-tree-scene>
                            <div class="rpg-tree-grid"></div>
                            <div class="rpg-tree-svg-container">
                                <svg class="rpg-links-svg" width="100%" height="100%" style="position:absolute; inset:0; pointer-events:none;"></svg>
                            </div>
                            <div class="rpg-tree-nodes"></div>
                        </div>
                    </div>
                </div>
                <div class="rpg-detail-panel" id="rpg-detail-panel">
                    <div class="rpg-detail-empty">Select a skill to view details</div>
                </div>
            </div>`;

        const treeViewport = container.querySelector('[data-tree-viewport]');
        const treeScene = container.querySelector('[data-tree-scene]');
        const zoomValueEl = container.querySelector('[data-zoom-value]');
        const zoomButtons = container.querySelectorAll('[data-zoom-action]');
        let dragging = false;
        let dragPointerId = null;
        let dragLastX = 0;
        let dragLastY = 0;
        let suppressNodeClickUntil = 0;
        let pinching = false;
        let pinchStartDistance = 0;
        let pinchStartScale = 1;
        const activePointers = new Map();
        let panVelocityX = 0;
        let panVelocityY = 0;
        let panLastMoveTime = 0;
        let inertiaFrameId = null;
        let inertiaLastTimestamp = 0;

        const isCompactViewport = () => !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
        const getPointerPair = () => Array.from(activePointers.values()).slice(0, 2);
        const getPointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const getPointerMidpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

        const createFittedViewportState = (branch) => {
            if (!treeViewport) return createDefaultViewportState();

            const rect = treeViewport.getBoundingClientRect();
            if (!rect.width || !rect.height) return createDefaultViewportState();

            const bounds = getBranchBounds(branch);
            const compact = isCompactViewport();
            const branchWidth = Math.max(18, bounds.maxX - bounds.minX);
            const branchHeight = Math.max(18, bounds.maxY - bounds.minY);
            const branchWidthPx = (branchWidth / 100) * rect.width;
            const branchHeightPx = (branchHeight / 100) * rect.height;

            const horizontalPadding = rect.width * (compact ? 0.22 : 0.14);
            const verticalPadding = rect.height * (compact ? 0.24 : 0.16);
            const fitScaleX = (rect.width - horizontalPadding) / Math.max(1, branchWidthPx);
            const fitScaleY = (rect.height - verticalPadding) / Math.max(1, branchHeightPx);
            const preferredMaxScale = compact ? 0.9 : 1;
            const scale = clampZoom(Math.min(preferredMaxScale, fitScaleX, fitScaleY));

            const centerPercentX = (bounds.minX + bounds.maxX) / 2;
            const centerPercentY = (bounds.minY + bounds.maxY) / 2;
            const centerX = (centerPercentX / 100) * rect.width;
            const centerY = (centerPercentY / 100) * rect.height;
            const verticalBias = compact ? -(rect.height * 0.04) : -(rect.height * 0.02);

            return {
                scale,
                x: (rect.width / 2) - (centerX * scale),
                y: (rect.height / 2) - (centerY * scale) + verticalBias
            };
        };

        const updateIdleViewportStates = () => {
            BRANCH_ORDER.forEach((branch) => {
                if (viewportDirtyByBranch[branch]) return;
                viewportStateByBranch[branch] = createFittedViewportState(branch);
            });
        };

        const cancelPanInertia = (resetVelocity = true) => {
            if (inertiaFrameId !== null) {
                window.cancelAnimationFrame(inertiaFrameId);
                inertiaFrameId = null;
            }
            inertiaLastTimestamp = 0;
            treeViewport?.classList.remove('is-gliding');
            if (resetVelocity) {
                panVelocityX = 0;
                panVelocityY = 0;
            }
        };

        const startPanInertia = () => {
            if (!treeViewport || dragging || pinching) {
                cancelPanInertia(true);
                return;
            }

            const initialSpeed = Math.hypot(panVelocityX, panVelocityY);
            if (!Number.isFinite(initialSpeed) || initialSpeed < PAN_INERTIA_MIN_SPEED) {
                cancelPanInertia(true);
                return;
            }

            cancelPanInertia(false);
            viewportDirtyByBranch[activeBranch] = true;
            suppressNodeClickUntil = Date.now() + 260;
            treeViewport.classList.add('is-gliding');
            const state = getViewportState(activeBranch);

            const tick = (timestamp) => {
                if (dragging || pinching) {
                    cancelPanInertia(true);
                    return;
                }

                const elapsedMs = inertiaLastTimestamp
                    ? Math.min(34, Math.max(8, timestamp - inertiaLastTimestamp))
                    : 16;
                inertiaLastTimestamp = timestamp;

                state.x += panVelocityX * elapsedMs;
                state.y += panVelocityY * elapsedMs;
                applyViewportTransform();

                const decay = Math.pow(PAN_INERTIA_FRICTION, elapsedMs / 16);
                panVelocityX *= decay;
                panVelocityY *= decay;

                const speed = Math.hypot(panVelocityX, panVelocityY);
                if (!Number.isFinite(speed) || speed <= PAN_INERTIA_STOP_SPEED) {
                    cancelPanInertia(true);
                    return;
                }

                inertiaFrameId = window.requestAnimationFrame(tick);
            };

            inertiaFrameId = window.requestAnimationFrame(tick);
        };

        const applyViewportTransform = () => {
            if (!treeScene) return;
            const state = getViewportState(activeBranch);
            treeScene.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
            if (zoomValueEl) {
                zoomValueEl.textContent = `${Math.round(state.scale * 100)}%`;
            }
        };

        const setZoom = (requestedZoom, anchorX = null, anchorY = null, markDirty = true) => {
            if (!treeViewport) return;
            if (markDirty) {
                cancelPanInertia(true);
            }

            const state = getViewportState(activeBranch);
            const nextZoom = clampZoom(requestedZoom);
            if (Math.abs(nextZoom - state.scale) < ZOOM_EPSILON) {
                applyViewportTransform();
                return;
            }

            const rect = treeViewport.getBoundingClientRect();
            const localX = anchorX !== null ? (anchorX - rect.left) : (rect.width / 2);
            const localY = anchorY !== null ? (anchorY - rect.top) : (rect.height / 2);
            const worldX = (localX - state.x) / state.scale;
            const worldY = (localY - state.y) / state.scale;

            state.scale = nextZoom;
            state.x = localX - worldX * state.scale;
            state.y = localY - worldY * state.scale;
            if (markDirty) {
                viewportDirtyByBranch[activeBranch] = true;
            }
            applyViewportTransform();
        };

        const resetViewport = () => {
            cancelPanInertia(true);
            viewportStateByBranch[activeBranch] = createFittedViewportState(activeBranch);
            viewportDirtyByBranch[activeBranch] = false;
            applyViewportTransform();
        };

        const stopDrag = (pointerId = null) => {
            if (!dragging) return;
            if (pointerId !== null && dragPointerId !== pointerId) return;
            const capturedPointerId = dragPointerId;
            dragging = false;
            dragPointerId = null;
            treeViewport?.classList.remove('is-grabbing');
            if (treeViewport && capturedPointerId !== null && treeViewport.hasPointerCapture(capturedPointerId)) {
                treeViewport.releasePointerCapture(capturedPointerId);
            }
        };

        const endPinch = () => {
            if (!pinching) return;
            pinching = false;
            pinchStartDistance = 0;
            pinchStartScale = getViewportState(activeBranch).scale;
            cancelPanInertia(true);
            treeViewport?.classList.remove('is-pinching');
            suppressNodeClickUntil = Date.now() + 220;
        };

        const clearPointer = (pointerId) => {
            activePointers.delete(pointerId);
            if (treeViewport && treeViewport.hasPointerCapture(pointerId)) {
                treeViewport.releasePointerCapture(pointerId);
            }
        };

        const clearAllPointers = () => {
            Array.from(activePointers.keys()).forEach((pointerId) => clearPointer(pointerId));
        };

        const tryStartPinch = () => {
            if (!treeViewport || activePointers.size < 2) return false;
            const [firstPointer, secondPointer] = getPointerPair();
            if (!firstPointer || !secondPointer) return false;

            const distance = getPointerDistance(firstPointer, secondPointer);
            if (!Number.isFinite(distance) || distance < PINCH_MIN_DISTANCE) return false;

            stopDrag();
            cancelPanInertia(true);
            pinching = true;
            pinchStartDistance = distance;
            pinchStartScale = getViewportState(activeBranch).scale;
            suppressNodeClickUntil = Date.now() + 220;
            treeViewport.classList.add('is-pinching');
            return true;
        };

        const updatePinch = () => {
            if (!pinching || activePointers.size < 2 || pinchStartDistance < PINCH_MIN_DISTANCE) return;
            const [firstPointer, secondPointer] = getPointerPair();
            if (!firstPointer || !secondPointer) return;

            const distance = getPointerDistance(firstPointer, secondPointer);
            if (!Number.isFinite(distance) || distance < PINCH_MIN_DISTANCE) return;

            const midpoint = getPointerMidpoint(firstPointer, secondPointer);
            const scaleRatio = distance / pinchStartDistance;
            setZoom(pinchStartScale * scaleRatio, midpoint.x, midpoint.y, true);
        };

        zoomButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.zoomAction;
                const state = getViewportState(activeBranch);
                if (action === 'in') {
                    setZoom(state.scale + ZOOM_STEP);
                } else if (action === 'out') {
                    setZoom(state.scale - ZOOM_STEP);
                } else if (action === 'reset') {
                    resetViewport();
                }
            });
        });

        if (treeViewport) {
            treeViewport.addEventListener('wheel', (event) => {
                event.preventDefault();
                const state = getViewportState(activeBranch);
                const direction = event.deltaY < 0 ? 1 : -1;
                setZoom(state.scale + (direction * ZOOM_STEP), event.clientX, event.clientY, true);
            }, { passive: false });

            treeViewport.addEventListener('pointerdown', (event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                cancelPanInertia(true);
                activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                treeViewport.setPointerCapture(event.pointerId);

                if (activePointers.size >= 2) {
                    if (tryStartPinch()) {
                        event.preventDefault();
                    }
                    return;
                }

                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (event.target.closest('.rpg-node')) return;

                event.preventDefault();
                dragging = true;
                dragPointerId = event.pointerId;
                dragLastX = event.clientX;
                dragLastY = event.clientY;
                panVelocityX = 0;
                panVelocityY = 0;
                panLastMoveTime = performance.now();
                treeViewport.classList.add('is-grabbing');
            });

            treeViewport.addEventListener('pointermove', (event) => {
                if (activePointers.has(event.pointerId)) {
                    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                }

                if (pinching) {
                    event.preventDefault();
                    updatePinch();
                    return;
                }

                if (!dragging || dragPointerId !== event.pointerId) return;
                event.preventDefault();
                const state = getViewportState(activeBranch);
                const deltaX = event.clientX - dragLastX;
                const deltaY = event.clientY - dragLastY;
                const now = performance.now();
                const elapsedMs = panLastMoveTime ? Math.max(1, now - panLastMoveTime) : 16;
                const instantVx = deltaX / elapsedMs;
                const instantVy = deltaY / elapsedMs;

                dragLastX = event.clientX;
                dragLastY = event.clientY;
                panLastMoveTime = now;
                panVelocityX = (panVelocityX * 0.65) + (instantVx * 0.35);
                panVelocityY = (panVelocityY * 0.65) + (instantVy * 0.35);
                state.x += deltaX;
                state.y += deltaY;
                viewportDirtyByBranch[activeBranch] = true;
                if (Math.abs(deltaX) + Math.abs(deltaY) > 1) {
                    suppressNodeClickUntil = Date.now() + 220;
                }
                applyViewportTransform();
            });

            const handlePointerEnd = (event) => {
                const wasDraggingPointer = dragging && dragPointerId === event.pointerId;
                stopDrag(event.pointerId);
                clearPointer(event.pointerId);

                if (pinching) {
                    if (activePointers.size < 2) {
                        endPinch();
                        return;
                    }
                    const [firstPointer, secondPointer] = getPointerPair();
                    if (!firstPointer || !secondPointer) {
                        endPinch();
                        return;
                    }
                    const distance = getPointerDistance(firstPointer, secondPointer);
                    if (!Number.isFinite(distance) || distance < PINCH_MIN_DISTANCE) {
                        endPinch();
                        return;
                    }
                    pinchStartDistance = distance;
                    pinchStartScale = getViewportState(activeBranch).scale;
                    return;
                }

                if (wasDraggingPointer && activePointers.size === 0) {
                    startPanInertia();
                }
            };

            treeViewport.addEventListener('pointerup', handlePointerEnd);
            treeViewport.addEventListener('pointercancel', handlePointerEnd);
            treeViewport.addEventListener('pointerleave', handlePointerEnd);
            treeViewport.addEventListener('lostpointercapture', handlePointerEnd);
        }

        // Interactivity
        const sidebar = container.querySelector('.rpg-sidebar');
        sidebar.querySelectorAll('.rpg-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                cancelPanInertia(true);
                stopDrag();
                endPinch();
                clearAllPointers();
                sidebar.querySelectorAll('.rpg-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeBranch = btn.dataset.branch;
                container.querySelector('.rpg-tree-nodes').innerHTML = renderTreeCanvas(activeBranch);
                renderLinks(activeBranch, container);
                renderDetailPanel(null);
                attachNodeClicks();
                applyViewportTransform();
            });
        });

        const attachNodeClicks = () => {
            container.querySelectorAll('.rpg-node').forEach(el => {
                el.addEventListener('click', () => {
                    if (Date.now() < suppressNodeClickUntil) return;
                    cancelPanInertia(true);
                    container.querySelectorAll('.rpg-node').forEach(n => n.classList.remove('node-selected'));
                    el.classList.add('node-selected');
                    const node = treeData.byId[el.dataset.id];
                    renderDetailPanel(node);
                });
            });
        };

        updateIdleViewportStates();
        container.querySelector('.rpg-tree-nodes').innerHTML = renderTreeCanvas(activeBranch);
        attachNodeClicks();
        renderLinks(activeBranch, container);
        applyViewportTransform();
        renderDetailPanel(null); // Show the empty state on initial load

        // Resize observer to re-render links on container resize
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(() => {
                cancelPanInertia(true);
                renderLinks(activeBranch, container);
                updateIdleViewportStates();
                applyViewportTransform();
            });
            if (treeViewport) {
                observer.observe(treeViewport);
            } else {
                observer.observe(container);
            }
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
