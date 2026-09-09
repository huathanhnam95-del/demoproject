/**
 * Entrance Test UI — internal design review.
 *
 * Hosts the three candidate skins (public/entrance-test-ui-lab.html) in an
 * iframe and collects staff ratings against them.
 *
 * Shape of the exercise:
 *   - Three MODES (skins A / B / C), identical behaviour, different looks.
 *   - Eight PAGES per mode, the distinct screens of the test.
 *   - Five CRITERIA per page, the same five everywhere so totals compare.
 *   - Two FONT votes, made once for the whole test rather than per page.
 *
 * Everyone signs in on the same CRM account, so the rater is the name they
 * type on entry; that name slugs to their document id, which means re-entering
 * the same name resumes their scores instead of starting a second set.
 */
(function () {
  'use strict';

  const COLLECTION = 'entranceTestUiRatings';
  const RATER_KEY = 'crm_et_ui_rater_v1';

  const SKINS = [
    { id: 'a', label: 'A · Editorial', hint: 'Giấy ấm, serif, kẻ mảnh, không đổ bóng' },
    { id: 'b', label: 'B · Instrument', hint: 'Chrome đen, lưới chặt, số mono, xanh tín hiệu' },
    { id: 'c', label: 'C · Signal', hint: 'Khối màu phẳng, viền 2px, bóng cứng' }
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

  const MAX_PER_PAGE = CRITERIA.length * 5;
  const MAX_PER_SKIN = PAGES.length * MAX_PER_PAGE;

  const state = {
    rater: null,          // { id, name }
    skin: 'b',
    page: 'intro',
    tab: 'rate',          // rate | fonts | results
    ratings: {},          // "skin:page:criterion" -> 1..5
    fonts: { vn: '', en: '' },
    all: [],              // every rater doc, for the results tab
    loading: false,
    saveTimer: null,
    dirty: false,
    status: ''
  };

  let root = null;
  let booted = false;

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

  function fontCatalogue() { return window.ENTRANCE_TEST_UI_FONTS || { vn: [], en: [] }; }

  // ── persistence ──────────────────────────────────────────────────────────

  async function loadRater(id) {
    const store = db();
    if (!store) return;
    state.loading = true;
    render();
    try {
      const snap = await store.collection(COLLECTION).doc(id).get();
      const data = snap.exists ? (snap.data() || {}) : {};
      state.ratings = data.ratings && typeof data.ratings === 'object' ? data.ratings : {};
      state.fonts = data.fonts && typeof data.fonts === 'object'
        ? { vn: data.fonts.vn || '', en: data.fonts.en || '' }
        : { vn: '', en: '' };
    } catch (e) {
      state.status = 'Không tải được điểm đã lưu: ' + (e && e.message ? e.message : e);
    } finally {
      state.loading = false;
      render();
      pushFontsToFrame();
    }
  }

  function scheduleSave() {
    state.dirty = true;
    state.status = 'Đang lưu…';
    updateStatusLine();
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 600);
  }

  async function save() {
    const store = db();
    if (!store || !state.rater) return;
    try {
      await store.collection(COLLECTION).doc(state.rater.id).set({
        name: state.rater.name,
        ratings: state.ratings,
        fonts: state.fonts,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      state.dirty = false;
      state.status = 'Đã lưu';
    } catch (e) {
      state.status = 'Lỗi lưu: ' + (e && e.message ? e.message : e);
    }
    updateStatusLine();
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
    const p = new URLSearchParams({ skin: state.skin });
    if (state.fonts.vn) p.set('vn', state.fonts.vn);
    if (state.fonts.en) p.set('en', state.fonts.en);
    return 'entrance-test-ui-lab.html?' + p.toString();
  }

  function pushFontsToFrame() {
    const f = frame();
    if (!f || !f.contentWindow) return;
    try {
      f.contentWindow.postMessage(
        { type: 'etlab:fonts', vn: state.fonts.vn, en: state.fonts.en },
        window.location.origin
      );
    } catch (e) { /* frame not ready */ }
  }

  function gotoPage(pageId) {
    const f = frame();
    if (!f || !f.contentWindow) return;
    try {
      f.contentWindow.postMessage({ type: 'etlab:goto', page: pageId }, window.location.origin);
    } catch (e) { /* frame not ready */ }
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!msg || msg.type !== 'etlab:page') return;
    if (msg.skin !== state.skin) return;      // stale frame during a skin swap
    if (msg.page === state.page) return;
    state.page = msg.page;
    if (state.tab === 'rate') renderRatingColumn();
  });

  // ── progress ─────────────────────────────────────────────────────────────

  function skinTotals(ratings) {
    const out = {};
    SKINS.forEach((s) => { out[s.id] = { sum: 0, count: 0 }; });
    Object.keys(ratings || {}).forEach((k) => {
      const skin = k.split(':')[0];
      const v = Number(ratings[k]);
      if (out[skin] && v >= 1 && v <= 5) { out[skin].sum += v; out[skin].count += 1; }
    });
    return out;
  }

  function pagesDone(skin) {
    return PAGES.filter(p => CRITERIA.every(c => state.ratings[key(skin, p.id, c.id)] > 0)).length;
  }

  // ── rendering ────────────────────────────────────────────────────────────

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

    return '<div class="et-crit" data-crit="' + esc(criterion.id) + '">' +
      '<div class="et-crit-head">' +
        '<span class="et-crit-label">' + esc(criterion.label) + '</span>' +
        '<span class="et-crit-value">' + (value ? value + '/5' : '—') + '</span>' +
      '</div>' +
      '<div class="et-crit-hint">' + esc(criterion.hint) + '</div>' +
      '<div class="et-stars" role="group">' + stars + '</div>' +
    '</div>';
  }

  function renderRatingColumn() {
    const host = document.getElementById('et-ui-rating-col');
    if (!host) return;

    const page = PAGES.find(p => p.id === state.page) || PAGES[0];
    const done = CRITERIA.filter(c => state.ratings[key(state.skin, page.id, c.id)] > 0).length;
    const skin = SKINS.find(s => s.id === state.skin);

    host.innerHTML =
      '<div class="et-rate-head">' +
        '<div class="et-rate-eyebrow">ĐANG CHẤM</div>' +
        '<div class="et-rate-page">' + esc(page.label) + '</div>' +
        '<div class="et-rate-sub">' + esc(skin ? skin.label : state.skin) + ' · ' + done + '/' + CRITERIA.length + ' tiêu chí</div>' +
      '</div>' +
      CRITERIA.map(c => starRow(page.id, c)).join('') +
      '<div class="et-rate-foot">' +
        '<span id="et-ui-status">' + esc(state.status || '') + '</span>' +
      '</div>';
  }

  // Chip ticks, the active chip and the progress count, without touching the
  // iframe or the star buttons.
  function refreshPageProgress() {
    root.querySelectorAll('.et-chip').forEach((chip) => {
      const id = chip.dataset.goto;
      chip.classList.toggle('is-on', id === state.page);
      const complete = CRITERIA.every(c => state.ratings[key(state.skin, id, c.id)] > 0);
      const tick = chip.querySelector('.et-chip-done');
      if (complete && !tick) chip.insertAdjacentHTML('beforeend', '<span class="et-chip-done">✓</span>');
      if (!complete && tick) tick.remove();
    });

    const sub = root.querySelector('.et-rate-sub');
    if (sub) {
      const done = CRITERIA.filter(c => state.ratings[key(state.skin, state.page, c.id)] > 0).length;
      const skin = SKINS.find(s => s.id === state.skin);
      sub.textContent = (skin ? skin.label : state.skin) + ' · ' + done + '/' + CRITERIA.length + ' tiêu chí';
    }

    updateStatusLine();
  }

  function updateStatusLine() {
    const el = document.getElementById('et-ui-status');
    if (el) el.textContent = state.status || '';
    const prog = document.getElementById('et-ui-progress');
    if (prog) prog.textContent = pagesDone(state.skin) + '/' + PAGES.length + ' trang xong';
  }

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

  function renderToolbar() {
    const skinBtns = SKINS.map(s => (
      '<button class="et-skin' + (s.id === state.skin ? ' is-on' : '') + '" type="button" data-skin="' + s.id + '" title="' + esc(s.hint) + '">' +
        '<span class="et-skin-label">' + esc(s.label) + '</span>' +
      '</button>'
    )).join('');

    const tabs = [['rate', 'Chấm điểm'], ['fonts', 'Font chữ'], ['results', 'Kết quả']].map(([id, label]) => (
      '<button class="et-tab' + (state.tab === id ? ' is-on' : '') + '" type="button" data-tab="' + id + '">' + label + '</button>'
    )).join('');

    return '<div class="et-toolbar">' +
      '<div class="et-tabs">' + tabs + '</div>' +
      '<div class="et-skins">' + skinBtns + '</div>' +
      '<div class="et-who">' +
        '<span id="et-ui-progress">' + pagesDone(state.skin) + '/' + PAGES.length + ' trang xong</span>' +
        '<span class="et-who-name">' + esc(state.rater.name) + '</span>' +
        '<button class="et-link" type="button" data-action="switch-rater">đổi người</button>' +
      '</div>' +
    '</div>';
  }

  function renderRateTab() {
    const chips = PAGES.map(p => (
      '<button class="et-chip' + (p.id === state.page ? ' is-on' : '') + '" type="button" data-goto="' + p.id + '">' +
        esc(p.label) +
        (CRITERIA.every(c => state.ratings[key(state.skin, p.id, c.id)] > 0) ? '<span class="et-chip-done">✓</span>' : '') +
      '</button>'
    )).join('');

    return '<div class="et-pagebar">' + chips + '</div>' +
      '<div class="et-stage">' +
        '<div class="et-frame-wrap">' +
          '<iframe id="et-ui-frame" src="' + esc(frameUrl()) + '" title="Bản mẫu giao diện bài kiểm tra"></iframe>' +
        '</div>' +
        '<aside id="et-ui-rating-col" class="et-rating-col"></aside>' +
      '</div>';
  }

  function fontCard(kind, font) {
    const chosen = state.fonts[kind] === font.id;
    const sample = kind === 'vn'
      ? 'Hãy đọc thật kỹ đoạn văn rồi chọn từ thích hợp nhất cho ô trống.'
      : 'Most groups of animals have their specialist feeders adapted to a very limited type of food.';

    return '<button class="et-font' + (chosen ? ' is-on' : '') + '" type="button" data-font-kind="' + kind + '" data-font-id="' + esc(font.id) + '">' +
      '<div class="et-font-head">' +
        '<span class="et-font-name">' + esc(font.name) + '</span>' +
        '<span class="et-font-note">' + esc(font.note) + '</span>' +
      '</div>' +
      '<div class="et-font-sample" style="font-family: ' + font.stack + ';">' + esc(sample) + '</div>' +
    '</button>';
  }

  function renderFontsTab() {
    const cat = fontCatalogue();
    cat.vn.forEach(f => cat.ensure && cat.ensure(f.google));
    cat.en.forEach(f => cat.ensure && cat.ensure(f.google));

    return '<div class="et-fonts">' +
      '<p class="et-fonts-lead">Chọn <strong>một</strong> font cho toàn bộ bài test, không chọn riêng từng trang. Lựa chọn sẽ áp dụng ngay vào bản mẫu ở tab Chấm điểm.</p>' +
      '<div class="et-fonts-grid">' +
        '<section>' +
          '<h3 class="et-fonts-title">Chữ tiếng Việt <span>(toàn bộ giao diện)</span></h3>' +
          cat.vn.map(f => fontCard('vn', f)).join('') +
        '</section>' +
        '<section>' +
          '<h3 class="et-fonts-title">Chữ tiếng Anh <span>(đoạn văn bài đọc)</span></h3>' +
          cat.en.map(f => fontCard('en', f)).join('') +
        '</section>' +
      '</div>' +
    '</div>';
  }

  function renderResultsTab() {
    const raters = state.all.filter(r => r && r.ratings);

    if (!raters.length) {
      return '<div class="et-results"><p class="crm-muted">Chưa có ai chấm điểm. Nhấn <strong>Kết quả</strong> lại sau khi mọi người đã chấm.</p></div>';
    }

    // Totals per skin
    const totals = SKINS.map((s) => {
      let sum = 0, count = 0;
      raters.forEach((r) => {
        const t = skinTotals(r.ratings)[s.id];
        sum += t.sum; count += t.count;
      });
      return { skin: s, sum, count, avg: count ? sum / count : 0 };
    });
    const best = totals.reduce((a, b) => (b.avg > a.avg ? b : a), totals[0]);

    const cards = totals.map(t => (
      '<div class="et-total' + (t.skin.id === best.skin.id && t.count ? ' is-best' : '') + '">' +
        '<div class="et-total-label">' + esc(t.skin.label) + '</div>' +
        '<div class="et-total-sum">' + t.sum + '<span>sao</span></div>' +
        '<div class="et-total-avg">' + (t.count ? t.avg.toFixed(2) : '—') + ' TB · ' + t.count + ' lượt chấm</div>' +
      '</div>'
    )).join('');

    // Per page × skin average
    const rows = PAGES.map((p) => {
      const cells = SKINS.map((s) => {
        let sum = 0, n = 0;
        raters.forEach((r) => {
          CRITERIA.forEach((c) => {
            const v = Number(r.ratings[key(s.id, p.id, c.id)]);
            if (v >= 1 && v <= 5) { sum += v; n += 1; }
          });
        });
        return '<td>' + (n ? (sum / n).toFixed(2) : '—') + '</td>';
      }).join('');
      return '<tr><th scope="row">' + esc(p.label) + '</th>' + cells + '</tr>';
    }).join('');

    // Per criterion × skin average
    const critRows = CRITERIA.map((c) => {
      const cells = SKINS.map((s) => {
        let sum = 0, n = 0;
        raters.forEach((r) => {
          PAGES.forEach((p) => {
            const v = Number(r.ratings[key(s.id, p.id, c.id)]);
            if (v >= 1 && v <= 5) { sum += v; n += 1; }
          });
        });
        return '<td>' + (n ? (sum / n).toFixed(2) : '—') + '</td>';
      }).join('');
      return '<tr><th scope="row">' + esc(c.label) + '</th>' + cells + '</tr>';
    }).join('');

    // Font votes
    const cat = fontCatalogue();
    function fontTally(kind) {
      const counts = {};
      raters.forEach((r) => {
        const id = r.fonts && r.fonts[kind];
        if (id) counts[id] = (counts[id] || 0) + 1;
      });
      const list = cat[kind].map(f => ({ f, n: counts[f.id] || 0 })).sort((x, y) => y.n - x.n);
      const top = list[0] && list[0].n ? list[0] : null;
      return list.map(item => (
        '<li' + (top && item.f.id === top.f.id ? ' class="is-top"' : '') + '>' +
          '<span style="font-family:' + item.f.stack + '">' + esc(item.f.name) + '</span>' +
          '<b>' + item.n + '</b>' +
        '</li>'
      )).join('');
    }

    const who = raters.map(r => esc(r.name || r.id)).join(', ');

    return '<div class="et-results">' +
      '<div class="et-totals">' + cards + '</div>' +

      '<h3 class="et-results-title">Điểm trung bình theo trang</h3>' +
      '<table class="et-table"><thead><tr><th>Trang</th>' +
        SKINS.map(s => '<th>' + esc(s.label) + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +

      '<h3 class="et-results-title">Điểm trung bình theo tiêu chí</h3>' +
      '<table class="et-table"><thead><tr><th>Tiêu chí</th>' +
        SKINS.map(s => '<th>' + esc(s.label) + '</th>').join('') +
      '</tr></thead><tbody>' + critRows + '</tbody></table>' +

      '<h3 class="et-results-title">Bình chọn font</h3>' +
      '<div class="et-fontvotes">' +
        '<div><h4>Tiếng Việt</h4><ul>' + fontTally('vn') + '</ul></div>' +
        '<div><h4>Tiếng Anh</h4><ul>' + fontTally('en') + '</ul></div>' +
      '</div>' +

      '<p class="et-results-who">' + raters.length + ' người đã chấm: ' + who + '</p>' +
      '<p class="crm-muted">Tối đa ' + MAX_PER_SKIN + ' sao mỗi mode (' + PAGES.length + ' trang × ' + CRITERIA.length + ' tiêu chí × 5).</p>' +
    '</div>';
  }

  function render() {
    if (!root) return;

    if (!state.rater) { root.innerHTML = renderGate(); return; }

    let body = '';
    if (state.tab === 'rate') body = renderRateTab();
    else if (state.tab === 'fonts') body = renderFontsTab();
    else body = renderResultsTab();

    root.innerHTML = renderToolbar() + '<div class="et-body">' + body + '</div>';

    if (state.tab === 'rate') {
      renderRatingColumn();
      const f = frame();
      if (f) f.addEventListener('load', pushFontsToFrame, { once: true });
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
    state.rater = { id, name };
    try { localStorage.setItem(RATER_KEY, JSON.stringify(state.rater)); } catch (e) { /* ignore */ }
    render();
    loadRater(id);
  }

  function onClick(ev) {
    const t = ev.target.closest(
      '#et-ui-enter,[data-tab],[data-skin],[data-goto],[data-rate],[data-font-kind],[data-action]'
    );
    if (!t || !root.contains(t)) return;

    if (t.id === 'et-ui-enter') {
      const input = document.getElementById('et-ui-name');
      enterRater(input ? input.value : '');
      return;
    }

    if (t.dataset.action === 'switch-rater') {
      state.rater = null;
      state.ratings = {};
      try { localStorage.removeItem(RATER_KEY); } catch (e) { /* ignore */ }
      render();
      return;
    }

    if (t.dataset.tab) {
      state.tab = t.dataset.tab;
      render();
      if (state.tab === 'results') loadAll();
      return;
    }

    if (t.dataset.skin) {
      if (t.dataset.skin === state.skin) return;
      state.skin = t.dataset.skin;
      state.page = 'intro';
      render();
      return;
    }

    if (t.dataset.goto) {
      // Re-rendering here would rebuild the iframe and bounce it back to the
      // intro; drive the existing frame instead and repaint just the chrome.
      state.page = t.dataset.goto;
      gotoPage(state.page);
      renderRatingColumn();
      refreshPageProgress();
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

      refreshPageProgress();
      scheduleSave();
      return;
    }

    if (t.dataset.fontKind) {
      const kind = t.dataset.fontKind;
      state.fonts[kind] = (state.fonts[kind] === t.dataset.fontId) ? '' : t.dataset.fontId;
      render();
      scheduleSave();
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
    if (!root || booted) return;
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
  window.CrmEntranceTestUiLab = { boot: boot };
})();
