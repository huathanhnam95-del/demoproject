/**
 * Entrance Test UI — internal design review.
 *
 * Displays Demo D and collects five ratings on each of eight screens.
 * Historical designs and their saved rating/font data remain compatible.
 * Up to two font picks per language are shared historical votes.
 *
 * Everyone signs in on the same CRM account, so the rater is the name they
 * type on entry; that name slugs to their document id, which means re-entering
 * the same name resumes their scores instead of starting a second set.
 *
 * Rating and font picking are both required. Results stay locked until a rater
 * has finished their own scoring, so nobody is anchored by someone else's.
 */
(function () {
  'use strict';

  const COLLECTION = 'entranceTestUiRatings';
  const RATER_KEY = 'crm_et_ui_rater_v1';
  const MAX_FONT_PICKS = 2;

  const SKINS = [
    { id: 'd', label: 'D · Signal Noto', hint: 'Nền trắng, Noto Sans, đọc liền mạch' }
  ];

  const PAGES = [
    { id: 'intro', label: 'Màn hình chào' },
    { id: 'miccheck', label: 'Kiểm tra micro' },
    { id: 'speaking', label: 'Đọc & Nói' },
    { id: 'vocab', label: 'Từ vựng' },
    { id: 'grammar', label: 'Ngữ pháp' },
    { id: 'listening', label: 'Nghe & Viết' },
    { id: 'review', label: 'Xem lại bài làm' },
    { id: 'done', label: 'Đã nộp bài' }
  ];

  // Five, deliberately non-overlapping. Anything a rater could answer with the
  // same word as another row would just be the same score counted twice.
  const CRITERIA = [
    { id: 'visual', label: 'Thẩm mỹ', hint: 'Nhìn có đẹp và hiện đại không?' },
    { id: 'readability', label: 'Dễ đọc', hint: 'Cỡ chữ, độ dài dòng, độ tương phản.' },
    { id: 'usability', label: 'Dễ thao tác', hint: 'Có biết ngay phải làm gì không?' },
    { id: 'clarity', label: 'Rõ ràng', hint: 'Biết mình đang ở đâu, còn bao nhiêu?' },
    { id: 'trust', label: 'Chuyên nghiệp', hint: 'Có tạo cảm giác tin cậy không?' }
  ];

  const NEED_RATINGS = SKINS.length * PAGES.length * CRITERIA.length;

  const state = {
    rater: null,
    loaded: false,
    generation: 0,
    pending: [],
    saving: false,
    skin: 'd',
    page: 'intro',
    tab: 'rate',                 // rate | results
    ratings: {},                 // "skin:page:criterion" -> 1..5
    fonts: { vn: [], en: [] },   // up to MAX_FONT_PICKS ids each
    preview: { vn: '', en: '' }, // historical A/B/C preview
    previewD: { vn: '', en: '' }, // Demo D stays on its Noto defaults until explicitly previewed
    all: [],
    saveTimer: null,
    status: '',
    notice: ''
  };

  let root = null;
  let booted = false;
  let annotationController = null;
  let mountGeneration = 0;

  // ── helpers ──────────────────────────────────────────────────────────────

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function slugify(name) {
    return String(name || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function key(skin, page, criterion) { return skin + ':' + page + ':' + criterion; }

  function db() {
    return (window.firebase && firebase.firestore) ? firebase.firestore() : null;
  }

  function catalogue() {
    return window.ENTRANCE_TEST_UI_FONTS || { vn: [], en: [], ensure: function () {} };
  }

  // ── progress and gating ──────────────────────────────────────────────────

  function validScore(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }

  function pageComplete(skin, pageId) {
    return CRITERIA.every(c => validScore(state.ratings[key(skin, pageId, c.id)]));
  }

  function pagesDone(skin) { return PAGES.filter(p => pageComplete(skin, p.id)).length; }

  function ratingsDone() {
    let n = 0;
    SKINS.forEach(s => PAGES.forEach(p => CRITERIA.forEach(c => {
      if (validScore(state.ratings[key(s.id, p.id, c.id)])) n += 1;
    })));
    return n;
  }

  function completion() {
    const have = ratingsDone();
    const vn = state.fonts.vn.length;
    const en = state.fonts.en.length;
    return {
      have: have,
      need: NEED_RATINGS,
      ratingsOk: have >= NEED_RATINGS,
      vnOk: vn >= 1,
      enOk: en >= 1,
      done: have >= NEED_RATINGS && vn >= 1 && en >= 1
    };
  }

  // ── persistence ──────────────────────────────────────────────────────────

  function normaliseFonts(raw) {
    // An earlier draft stored one id per language; keep those readable.
    const out = { vn: [], en: [] };
    if (!raw || typeof raw !== 'object') return out;
    ['vn', 'en'].forEach((k) => {
      const v = raw[k];
      if (Array.isArray(v)) out[k] = v.filter(Boolean).slice(0, MAX_FONT_PICKS);
      else if (typeof v === 'string' && v) out[k] = [v];
    });
    return out;
  }

  async function loadRater(id) {
    const generation = ++state.generation;
    state.loaded = false;
    const store = db();
    try {
      if (!store) throw new Error('Firebase unavailable');
      const snap = await store.collection(COLLECTION).doc(id).get();
      if (generation !== state.generation || state.rater?.id !== id) return;
      const data = snap.exists ? (snap.data() || {}) : {};
      state.ratings = data.ratings && typeof data.ratings === 'object' ? data.ratings : {};
      state.fonts = normaliseFonts(data.fonts);
      state.loaded = true;
      state.status = '';
    } catch (e) {
      if (generation !== state.generation || state.rater?.id !== id) return;
      state.status = 'Không tải được điểm đã lưu. Thử lại: ' + e.message;
    }
    state.previewD = { vn: '', en: '' };
    render();
  }

  function scheduleSave(change) {
    if (!state.loaded || !state.rater || !change) return;
    state.pending.push({ ...change, rater: { ...state.rater }, generation: state.generation });
    state.status = 'Đang lưu…';
    updateStatusLine();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 600);
  }

  async function save() {
    const store = db();
    if (!store || state.saving) return;
    state.saving = true;
    try {
      while (state.pending.length) {
        const change = state.pending[0];
        if (change.generation !== state.generation || change.rater.id !== state.rater?.id) { state.pending.shift(); continue; }
        const ref = store.collection(COLLECTION).doc(change.rater.id);
        await store.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (change.generation !== state.generation || change.rater.id !== state.rater?.id) throw new Error('Reviewer changed');
          const data = snap.exists ? snap.data() : { name: change.rater.name, ratings: {}, fonts: {}, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
          const next = { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
          if (change.kind === 'rating') {
            next.ratings = { ...(data.ratings || {}) };
            if (change.value) next.ratings[change.key] = change.value;
            else delete next.ratings[change.key];
          } else next.fonts = { ...(data.fonts || {}), [change.language]: change.value };
          tx.set(ref, next);
        });
        state.pending.shift();
      }
      state.status = 'Đã lưu';
    } catch (e) { state.status = 'Lỗi lưu — Thử lại: ' + e.message; }
    finally { state.saving = false; updateStatusLine(); }
  }

  async function loadAll() {
    const store = db();
    if (!store) return;
    try {
      const snap = await store.collection(COLLECTION).get();
      state.all = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
      state.status = 'Không tải được kết quả: ' + (e && e.message ? e.message : e);
      state.all = [];
    }
    render();
  }

  // ── iframe bridge ────────────────────────────────────────────────────────

  function frame() { return document.getElementById('et-ui-frame'); }

  function frameUrl() {
    if (state.skin === 'd') return '/entrance-test-ui/?revisionId=academic-noto-v1';
    const p = new URLSearchParams({ skin: state.skin });
    if (state.preview.vn) p.set('vn', state.preview.vn);
    if (state.preview.en) p.set('en', state.preview.en);
    return 'entrance-test-ui-lab.html?' + p.toString();
  }

  function post(msg) {
    const f = frame();
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage(msg, new URL(f.src, window.location.href).origin); } catch (e) { /* not ready */ }
  }

  function pushPreview() {
    if (state.skin === 'd') {
      post({ type: 'etui:fonts', skin: 'd', revisionId: 'academic-noto-v1', vn: state.previewD.vn, en: state.previewD.en });
      return;
    }
    post({ type: 'etlab:fonts', vn: state.preview.vn, en: state.preview.en });
  }

  window.addEventListener('message', (ev) => {
    if (!frame() || ev.origin !== new URL(frame().src, window.location.href).origin || ev.source !== frame().contentWindow) return;
    const msg = ev.data;
    if (!msg || !['etlab:page', 'etui:page'].includes(msg.type)) return;
    if (msg.type === 'etui:page' && (msg.revisionId !== 'academic-noto-v1' || msg.skin !== 'd')) return;
    if (msg.skin !== state.skin) return;      // stale frame during a skin swap
    if (!PAGES.some(p => p.id === msg.page)) return;
    if (msg.page === state.page) return;
    state.page = msg.page;
    if (state.tab === 'rate') { renderRatingColumn(); refreshChrome(); }
  });

  // ── name gate ────────────────────────────────────────────────────────────

  function renderGate() {
    return '<div class="et-gate">' +
      '<div class="et-gate-card">' +
        '<div class="et-gate-eyebrow">ĐÁNH GIÁ GIAO DIỆN BÀI KIỂM TRA ĐẦU VÀO</div>' +
        '<h2 class="et-gate-title">Bạn tên là gì?</h2>' +
        '<p class="et-gate-lead">Cả nhóm dùng chung một tài khoản CRM, nên hãy nhập tên của bạn để điểm được ghi riêng. Nhập lại đúng tên này lần sau để chấm tiếp từ chỗ đang dở.</p>' +
        '<div class="et-gate-row">' +
          '<input id="et-ui-name" class="crm-input" type="text" maxlength="80" placeholder="Ví dụ: Nguyễn Thị Lan" autocomplete="off">' +
          '<button id="et-ui-enter" class="crm-btn crm-btn-primary" type="button">Bắt đầu</button>' +
        '</div>' +
        '<div id="et-ui-gate-error" class="et-gate-error"></div>' +
      '</div>' +
    '</div>';
  }

  // ── guidance + requirement strip ─────────────────────────────────────────

  function renderSteps() {
    const c = completion();

    const steps = [
      ['1', 'Chọn mẫu thiết kế', 'Đánh giá Demo D · Signal Noto.'],
      ['2', 'Xem hết 8 trang', 'Bấm từng nút trang, hoặc thao tác thẳng trong bản mẫu.'],
      ['3', 'Chấm 5 tiêu chí', 'Ở cột bên phải. Bấm lại đúng ngôi sao đó để xoá điểm.'],
      ['4', 'Chọn font', 'Làm 1 lần cho cả bài test, tối đa 2 font mỗi ngôn ngữ.']
    ].map(([n, t, d]) => (
      '<li class="et-step">' +
        '<span class="et-step-n">' + n + '</span>' +
        '<span class="et-step-body"><b>' + esc(t) + '</b><span>' + esc(d) + '</span></span>' +
      '</li>'
    )).join('');

    const checks = [
      [c.ratingsOk, 'Chấm điểm', c.have + '/' + c.need + ' tiêu chí'],
      [c.vnOk, 'Font tiếng Việt', state.fonts.vn.length + '/' + MAX_FONT_PICKS],
      [c.enOk, 'Font tiếng Anh', state.fonts.en.length + '/' + MAX_FONT_PICKS]
    ].map(([ok, label, detail]) => (
      '<span class="et-req' + (ok ? ' is-ok' : '') + '">' +
        '<span class="et-req-mark">' + (ok ? '✓' : '!') + '</span>' +
        esc(label) + ' <b>' + esc(detail) + '</b>' +
      '</span>'
    )).join('');

    return '<section class="et-guide' + (c.done ? ' is-done' : '') + '">' +
      '<ol class="et-steps">' + steps + '</ol>' +
      '<div class="et-reqbar">' +
        '<span class="et-reqbar-label">' + (c.done
          ? 'Đã hoàn tất — cảm ơn bạn. Tab Kết quả đã mở.'
          : 'Bắt buộc xong cả bốn mục mới xem được Kết quả:') + '</span>' +
        checks +
      '</div>' +
    '</section>';
  }

  // ── toolbar / skin / page rows ───────────────────────────────────────────

  function renderToolbar() {
    const c = completion();

    const tabs = [['rate', 'Chấm điểm', true], ['results', 'Kết quả', c.done]].map(([id, label, enabled]) => (
      '<button class="et-tab' + (state.tab === id ? ' is-on' : '') + (enabled ? '' : ' is-locked') + '" ' +
        'type="button" data-tab="' + id + '"' +
        (enabled ? '' : ' disabled title="Hãy chấm xong và chọn font trước"') + '>' +
        esc(label) + (enabled ? '' : ' <span class="et-lock">🔒</span>') +
      '</button>'
    )).join('');

    return '<div class="et-toolbar">' +
      '<div class="et-toolgroup">' +
        '<span class="et-toollabel">Khu vực</span>' +
        '<div class="et-tabs">' + tabs + '</div>' +
      '</div>' +
      '<div class="et-who">' +
        '<span class="et-who-name">' + esc(state.rater.name) + '</span>' +
        '<button class="et-link" type="button" data-action="switch-rater">đổi người</button>' +
      '</div>' +
    '</div>';
  }

  function renderSkinBar() {
    const btns = SKINS.map((s) => {
      const done = pagesDone(s.id);
      return '<button class="et-skin' + (s.id === state.skin ? ' is-on' : '') +
        (done === PAGES.length ? ' is-complete' : '') + '" type="button" data-skin="' + s.id + '">' +
        '<span class="et-skin-top">' +
          '<span class="et-skin-label">' + esc(s.label) + '</span>' +
          '<span class="et-skin-prog">' + done + '/' + PAGES.length + '</span>' +
        '</span>' +
        '<span class="et-skin-hint">' + esc(s.hint) + '</span>' +
      '</button>';
    }).join('');

    return '<div class="et-row">' +
      '<span class="et-rowlabel"><b>Bước 1 — Mẫu thiết kế</b><em>Demo D · 8 trang</em></span>' +
      '<div class="et-skins">' + btns + '</div>' +
    '</div>';
  }

  function renderPageBar() {
    const chips = PAGES.map((p) => {
      const complete = pageComplete(state.skin, p.id);
      return '<button class="et-chip' + (p.id === state.page ? ' is-on' : '') + (complete ? ' is-done' : '') + '" ' +
        'type="button" data-goto="' + p.id + '">' +
        '<span class="et-chip-mark">' + (complete ? '✓' : '') + '</span>' + esc(p.label) +
      '</button>';
    }).join('');

    return '<div class="et-row">' +
      '<span class="et-rowlabel"><b>Bước 2 — Trang</b><em>' + pagesDone(state.skin) + '/' + PAGES.length + ' đã chấm xong</em></span>' +
      '<div class="et-pagebar">' + chips + '</div>' +
    '</div>';
  }

  // ── font bar, sitting directly above the live preview ────────────────────
  // Preview and vote are separate actions on purpose: you have to try all six
  // on a real page before you can sensibly pick two.

  function renderFontRow(kind, label, note) {
    const cat = catalogue();
    const list = cat[kind] || [];
    list.forEach(f => cat.ensure && cat.ensure(f.google));

    const picked = state.fonts[kind] || [];
    const preview = state.skin === 'd' ? state.previewD : state.preview;

    const defaultChip = kind === 'en'
      ? '<span class="et-fontchip' + (!preview.en ? ' is-previewing' : '') + '">' +
          '<button class="et-fontchip-name" type="button" data-preview="en" data-font="" ' +
            'title="Dùng font mặc định của mẫu">Mặc định</button>' +
        '</span>'
      : '';

    const chips = list.map((f) => {
      const isPreview = preview[kind] === f.id;
      const isPicked = picked.indexOf(f.id) !== -1;
      return '<span class="et-fontchip' + (isPreview ? ' is-previewing' : '') + (isPicked ? ' is-picked' : '') + '">' +
        '<button class="et-fontchip-name" type="button" data-preview="' + kind + '" data-font="' + esc(f.id) + '" ' +
          'style="font-family: ' + f.stack + ';" title="Xem thử trên bản mẫu">' + esc(f.name) + '</button>' +
        '<button class="et-fontchip-vote" type="button" data-vote="' + kind + '" data-font="' + esc(f.id) + '" ' +
          'title="' + (isPicked ? 'Bỏ chọn font này' : 'Chọn font này') + '" ' +
          'aria-pressed="' + (isPicked ? 'true' : 'false') + '">' + (isPicked ? '★' : '☆') + '</button>' +
      '</span>';
    }).join('');

    return '<div class="et-fontrow">' +
      '<span class="et-rowlabel"><b>' + esc(label) + '</b><em>' + esc(note) + '</em></span>' +
      '<div class="et-fontchips">' + defaultChip + chips + '</div>' +
      '<span class="et-fontcount' + (picked.length ? ' is-ok' : '') + '">' + picked.length + '/' + MAX_FONT_PICKS + '</span>' +
    '</div>';
  }

  function renderFontBar() {
    return '<section class="et-fontbar">' +
      '<div class="et-fontbar-head">' +
        '<b>Font chữ</b>' +
        '<span class="et-fontbar-scope">chọn 1 lần cho cả bài test, không theo từng trang</span>' +
        '<span>Bấm <u>tên font</u> để xem ngay trên bản mẫu bên dưới · bấm <u>☆</u> để chọn (tối đa ' + MAX_FONT_PICKS + ' mỗi ngôn ngữ)</span>' +
      '</div>' +
      renderFontRow('vn', 'Tiếng Việt', 'toàn bộ giao diện') +
      renderFontRow('en', 'Tiếng Anh', 'đoạn văn bài đọc') +
      '<div class="et-fontnotice" id="et-ui-fontnotice">' + esc(state.notice) + '</div>' +
    '</section>';
  }

  // ── rating column ────────────────────────────────────────────────────────

  function starRow(pageId, criterion) {
    const k = key(state.skin, pageId, criterion.id);
    const value = Number(state.ratings[k]) || 0;
    const stars = [1, 2, 3, 4, 5].map(n => (
      '<button class="et-star' + (n <= value ? ' is-on' : '') + '" type="button" ' +
      'data-rate="' + esc(criterion.id) + '" data-value="' + n + '" ' +
      'aria-label="' + n + ' sao cho ' + esc(criterion.label) + '" title="' + n + ' sao">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z"/></svg>' +
      '</button>'
    )).join('');

    return '<div class="et-crit' + (value ? '' : ' is-missing') + '" data-crit="' + esc(criterion.id) + '">' +
      '<div class="et-crit-head">' +
        '<span class="et-crit-label">' + esc(criterion.label) + '</span>' +
        '<span class="et-crit-value">' + (value ? value + '/5' : 'chưa chấm') + '</span>' +
      '</div>' +
      '<div class="et-crit-hint">' + esc(criterion.hint) + '</div>' +
      '<div class="et-stars" role="group">' + stars + '</div>' +
    '</div>';
  }

  function renderRatingColumn() {
    const host = document.getElementById('et-ui-rating-col');
    if (!host) return;

    const page = PAGES.find(p => p.id === state.page) || PAGES[0];
    const skin = SKINS.find(s => s.id === state.skin);
    const done = CRITERIA.filter(c => state.ratings[key(state.skin, page.id, c.id)] > 0).length;

    host.innerHTML =
      '<div class="et-rate-head">' +
        '<div class="et-rate-eyebrow">BƯỚC 3 — ĐANG CHẤM TRANG</div>' +
        '<div class="et-rate-page">' + esc(page.label) + '</div>' +
        '<div class="et-rate-sub">' + esc(skin ? skin.label : state.skin) +
          ' · <b>' + done + '/' + CRITERIA.length + '</b> tiêu chí</div>' +
      '</div>' +
      CRITERIA.map(c => starRow(page.id, c)).join('') +
      '<button type="button" data-action="retry-ratings">Thử lại tải/lưu điểm</button><div class="et-rate-foot"><span id="et-ui-status">' + esc(state.status || '') + '</span></div>';
  }

  function updateStatusLine() {
    const el = document.getElementById('et-ui-status');
    if (el) el.textContent = state.status || '';
  }

  // Repaint everything that reflects progress, without touching the iframe.
  function refreshChrome() {
    root.querySelectorAll('.et-chip').forEach((chip) => {
      const id = chip.dataset.goto;
      const complete = pageComplete(state.skin, id);
      chip.classList.toggle('is-on', id === state.page);
      chip.classList.toggle('is-done', complete);
      const mark = chip.querySelector('.et-chip-mark');
      if (mark) mark.textContent = complete ? '✓' : '';
    });

    root.querySelectorAll('.et-skin').forEach((btn) => {
      const done = pagesDone(btn.dataset.skin);
      const prog = btn.querySelector('.et-skin-prog');
      if (prog) prog.textContent = done + '/' + PAGES.length;
      btn.classList.toggle('is-complete', done === PAGES.length);
    });

    const pagebar = root.querySelector('.et-pagebar');
    if (pagebar && pagebar.previousElementSibling) {
      const em = pagebar.previousElementSibling.querySelector('em');
      if (em) em.textContent = pagesDone(state.skin) + '/' + PAGES.length + ' đã chấm xong';
    }

    const sub = root.querySelector('.et-rate-sub');
    if (sub) {
      const done = CRITERIA.filter(c => state.ratings[key(state.skin, state.page, c.id)] > 0).length;
      const skin = SKINS.find(s => s.id === state.skin);
      sub.innerHTML = esc(skin ? skin.label : state.skin) + ' · <b>' + done + '/' + CRITERIA.length + '</b> tiêu chí';
    }

    const guide = root.querySelector('.et-guide');
    if (guide) guide.outerHTML = renderSteps();

    const resultsTab = root.querySelector('.et-tab[data-tab="results"]');
    if (resultsTab) {
      const c = completion();
      resultsTab.disabled = !c.done;
      resultsTab.classList.toggle('is-locked', !c.done);
      resultsTab.innerHTML = 'Kết quả' + (c.done ? '' : ' <span class="et-lock">🔒</span>');
      if (c.done) resultsTab.removeAttribute('title');
      else resultsTab.setAttribute('title', 'Hãy chấm xong và chọn font trước');
    }

    updateStatusLine();
  }

  function renderRateTab() {
    return renderSteps() +
      renderSkinBar() +
      renderPageBar() +
      renderFontBar() +
      '<div class="et-stage">' +
        '<div class="et-frame-wrap">' +
          '<div class="et-frame-cap">Bản mẫu thật — bấm, gõ và thao tác trực tiếp trong khung này</div>' +
          '<div id="et-annotations-mount"></div>' +
          '<iframe id="et-ui-frame" src="' + esc(frameUrl()) + '" title="Bản mẫu giao diện bài kiểm tra"></iframe>' +
        '</div>' +
        '<aside id="et-ui-rating-col" class="et-rating-col"></aside>' +
      '</div>';
  }

  // ── results ──────────────────────────────────────────────────────────────

  function renderResultsTab() {
    const raters = state.all.filter(r => r && r.ratings);
    if (!raters.length) {
      return '<div class="et-results"><p class="crm-muted">Chưa có ai chấm điểm xong.</p></div>';
    }

    const totals = SKINS.map((s) => {
      let sum = 0, count = 0;
      raters.forEach((r) => {
        PAGES.flatMap(p => CRITERIA.map(c => key(s.id, p.id, c.id))).forEach((k) => {
          const v = r.ratings[k];
          if (validScore(v)) { sum += v; count += 1; }
        });
      });
      return { skin: s, sum: sum, count: count, avg: count ? sum / count : 0 };
    });
    const best = totals.reduce((a, b) => (b.avg > a.avg ? b : a), totals[0]);

    const cards = totals.map(t => (
      '<div class="et-total' + (t.skin.id === best.skin.id && t.count ? ' is-best' : '') + '">' +
        '<div class="et-total-label">' + esc(t.skin.label) + '</div>' +
        '<div class="et-total-sum">' + t.sum + '<span>sao</span></div>' +
        '<div class="et-total-avg">' + (t.count ? t.avg.toFixed(2) : '—') + ' TB · ' + t.count + ' lượt chấm</div>' +
      '</div>'
    )).join('');

    function avgTable(rowDefs, keysFor) {
      const rows = rowDefs.map((row) => {
        const cells = SKINS.map((s) => {
          let sum = 0, n = 0;
          raters.forEach((r) => {
            keysFor(row, s).forEach((k) => {
              const v = r.ratings[k];
              if (validScore(v)) { sum += v; n += 1; }
            });
          });
          return '<td>' + (n ? (sum / n).toFixed(2) : '—') + '</td>';
        }).join('');
        return '<tr><th scope="row">' + esc(row.label) + '</th>' + cells + '</tr>';
      }).join('');
      return '<table class="et-table"><thead><tr><th></th>' +
        SKINS.map(s => '<th>' + esc(s.label) + '</th>').join('') +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function fontTally(kind) {
      const cat = catalogue();
      const counts = {};
      raters.forEach((r) => {
        normaliseFonts(r.fonts)[kind].forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      });
      const list = cat[kind].map(f => ({ f: f, n: counts[f.id] || 0 })).sort((x, y) => y.n - x.n);
      const top = list[0] && list[0].n ? list[0].f.id : null;
      return list.map(item => (
        '<li' + (item.f.id === top ? ' class="is-top"' : '') + '>' +
          '<span style="font-family:' + item.f.stack + '">' + esc(item.f.name) + '</span>' +
          '<b>' + item.n + '</b>' +
        '</li>'
      )).join('');
    }

    return '<div class="et-results">' +
      '<div class="et-totals">' + cards + '</div>' +
      '<h3 class="et-results-title">Điểm trung bình theo trang</h3>' +
      avgTable(PAGES, (p, s) => CRITERIA.map(c => key(s.id, p.id, c.id))) +
      '<h3 class="et-results-title">Điểm trung bình theo tiêu chí</h3>' +
      avgTable(CRITERIA, (c, s) => PAGES.map(p => key(s.id, p.id, c.id))) +
      '<h3 class="et-results-title">Bình chọn font lịch sử, qua các thiết kế (mỗi người tối đa ' + MAX_FONT_PICKS + ')</h3>' +
      '<div class="et-fontvotes">' +
        '<div><h4>Tiếng Việt</h4><ul>' + fontTally('vn') + '</ul></div>' +
        '<div><h4>Tiếng Anh</h4><ul>' + fontTally('en') + '</ul></div>' +
      '</div>' +
      '<p class="et-results-who">' + raters.length + ' người đã chấm: ' +
        raters.map(r => esc(r.name || r.id)).join(', ') + '</p>' +
    '</div>';
  }

  function render() {
    if (!root) return;
    annotationController?.destroy(); annotationController = null;
    const generation = ++mountGeneration;
    if (!state.rater) { root.innerHTML = renderGate(); return; }

    const body = state.tab === 'results' ? renderResultsTab() : renderRateTab();
    root.innerHTML = renderToolbar() + '<div class="et-body">' + body + '</div>';

    if (state.tab === 'rate') {
      renderRatingColumn();
      const f = frame();
      if (f) f.addEventListener('load', pushPreview, { once: true });
      if (f && window.firebase?.auth && state.loaded) import('./entrance-test-ui/annotations-controller.js').then(({ createAnnotationsController }) => {
        if (generation !== mountGeneration || !f.isConnected) return;
        annotationController = createAnnotationsController({ mount: document.getElementById('et-annotations-mount'), frame: f, getRater: () => state.rater });
      }).catch(error => { const m = document.getElementById('et-annotations-mount'); if (m) m.textContent = 'Feedback unavailable: ' + error.message; });
    }
  }

  // ── events ───────────────────────────────────────────────────────────────

  function enterRater(nameRaw) {
    const name = String(nameRaw || '').trim().replace(/\s+/g, ' ');
    const errEl = document.getElementById('et-ui-gate-error');
    if (name.length < 2) {
      if (errEl) errEl.textContent = 'Hãy nhập tên ít nhất 2 ký tự.';
      return;
    }
    const id = slugify(name);
    if (!id) {
      if (errEl) errEl.textContent = 'Tên không hợp lệ, hãy dùng chữ cái tiếng Việt hoặc tiếng Anh.';
      return;
    }
    state.rater = { id: id, name: name };
    try { localStorage.setItem(RATER_KEY, JSON.stringify(state.rater)); } catch (e) { /* ignore */ }
    render();
    loadRater(id);
  }

  function notice(text) {
    state.notice = text || '';
    const el = document.getElementById('et-ui-fontnotice');
    if (el) el.textContent = state.notice;
    if (text) {
      setTimeout(function () {
        state.notice = '';
        const e2 = document.getElementById('et-ui-fontnotice');
        if (e2) e2.textContent = '';
      }, 3600);
    }
  }

  function repaintFontBar() {
    const bar = root.querySelector('.et-fontbar');
    if (bar) bar.outerHTML = renderFontBar();
  }

  function onClick(ev) {
    const t = ev.target.closest(
      '#et-ui-enter,[data-tab],[data-skin],[data-goto],[data-rate],[data-preview],[data-vote],[data-action]'
    );
    if (!t || !root.contains(t) || t.disabled) return;

    if (t.id === 'et-ui-enter') {
      const input = document.getElementById('et-ui-name');
      enterRater(input ? input.value : '');
      return;
    }

    if ((t.dataset.action === 'switch-rater' || t.dataset.tab) && annotationController && !annotationController.canLeave()) return;

    if (t.dataset.action === 'switch-rater') {
      if (state.pending.length || state.saving) { notice('Hãy lưu điểm trước khi đổi người.'); return; }
      clearTimeout(state.saveTimer);
      state.generation += 1;
      state.loaded = false;
      state.rater = null;
      state.ratings = {};
      state.fonts = { vn: [], en: [] };
      state.previewD = { vn: '', en: '' };
      try { localStorage.removeItem(RATER_KEY); } catch (e) { /* ignore */ }
      render();
      return;
    }

    if (t.dataset.tab) {
      if (t.dataset.tab === 'results' && !completion().done) return;
      state.tab = t.dataset.tab;
      render();
      if (state.tab === 'results') loadAll();
      return;
    }

    if (t.dataset.skin) {
      if (t.dataset.skin !== 'd' || t.dataset.skin === state.skin) return;
      state.skin = t.dataset.skin;
      state.page = 'intro';
      render();
      return;
    }

    if (t.dataset.goto) {
      // Re-rendering here would rebuild the iframe and bounce it back to the
      // intro; drive the existing frame instead and repaint just the chrome.
      state.page = t.dataset.goto;
      post(state.skin === 'd'
        ? { type: 'etui:goto', skin: 'd', revisionId: 'academic-noto-v1', page: state.page }
        : { type: 'etlab:goto', page: state.page });
      renderRatingColumn();
      refreshChrome();
      return;
    }

    if (t.hasAttribute('data-preview')) {
      const preview = state.skin === 'd' ? state.previewD : state.preview;
      preview[t.dataset.preview] = t.dataset.font || '';
      pushPreview();          // live restyle, no reload, current page keeps its state
      repaintFontBar();
      return;
    }

    if (t.dataset.action === 'retry-ratings') { if (state.pending.length) save(); else loadRater(state.rater.id); return; }

    if ((t.dataset.vote || t.dataset.rate) && !state.loaded) return;

    if (t.dataset.vote) {
      const kind = t.dataset.vote;
      const id = t.dataset.font;
      const list = state.fonts[kind];
      const at = list.indexOf(id);

      if (at !== -1) {
        list.splice(at, 1);
      } else if (list.length >= MAX_FONT_PICKS) {
        notice('Đã chọn đủ ' + MAX_FONT_PICKS + ' font ' + (kind === 'vn' ? 'tiếng Việt' : 'tiếng Anh') +
          '. Bỏ chọn một font trước khi chọn font khác.');
        return;
      } else {
        list.push(id);
        (state.skin === 'd' ? state.previewD : state.preview)[kind] = id;   // choosing it is also a reason to show it
        pushPreview();
      }

      repaintFontBar();
      refreshChrome();
      scheduleSave({ kind: 'font', language: kind, value: list.slice() });
      return;
    }

    if (t.dataset.rate) {
      const value = Number(t.dataset.value);
      const critId = t.dataset.rate;
      const k = key(state.skin, state.page, critId);
      // Clicking the same star again clears it, so a mis-tap is recoverable.
      state.ratings[k] = (state.ratings[k] === value) ? 0 : value;
      if (!state.ratings[k]) delete state.ratings[k];

      // Repaint only the row that changed. Re-rendering the whole column
      // swaps out every button, which loses the pointer mid-interaction.
      const block = root.querySelector('.et-crit[data-crit="' + critId + '"]');
      const criterion = CRITERIA.find(c => c.id === critId);
      if (block && criterion) {
        const fresh = document.createElement('div');
        fresh.innerHTML = starRow(state.page, criterion);
        block.replaceWith(fresh.firstChild);
      }

      refreshChrome();
      scheduleSave({ kind: 'rating', key: k, value: state.ratings[k] || 0 });
      return;
    }
  }

  function onKeydown(ev) {
    if (ev.key !== 'Enter') return;
    if (ev.target && ev.target.id === 'et-ui-name') {
      ev.preventDefault();
      enterRater(ev.target.value);
    }
  }

  // ── boot ─────────────────────────────────────────────────────────────────

  function boot() {
    root = document.getElementById('entrance-test-ui-root');
    if (!root) return;
    if (booted) { if (!annotationController) render(); return; }
    booted = true;

    try {
      const saved = JSON.parse(localStorage.getItem(RATER_KEY) || 'null');
      if (saved && saved.id && saved.name) state.rater = saved;
    } catch (e) { /* ignore */ }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);

    render();
    if (state.rater) loadRater(state.rater.id);
  }

  // Booted by crm-admin.js the first time the tab is opened, so the embedded
  // prototype never loads on any other CRM page.
  window.CrmEntranceTestUiLab = { boot: boot, canLeave: () => !annotationController || annotationController.canLeave(), dispose: () => { mountGeneration += 1; annotationController?.destroy(); annotationController = null; } };
})();
