/**
 * Font candidates for the Entrance Test UI lab.
 *
 * Loaded by both the prototype (public/entrance-test-ui-lab.html) and the CRM
 * panel that collects votes, so the two can never drift out of sync.
 *
 * `vn` drives every piece of Vietnamese interface text; `en` drives the English
 * reading passages. Both are chosen once for the whole test rather than per
 * page — a test that changed face between screens would be unreadable.
 *
 * Every `vn` family below ships a Vietnamese subset on Google Fonts. That is
 * the entry requirement: a face without one falls back per-glyph and the
 * diacritics visibly break, which is the bug that started this exercise.
 */
(function () {
  'use strict';

  window.ENTRANCE_TEST_UI_FONTS = {
    vn: [
      {
        id: 'be-vietnam-pro',
        name: 'Be Vietnam Pro',
        note: 'Đang dùng trong CRM',
        stack: "'Be Vietnam Pro', 'Outfit', sans-serif",
        google: 'Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400'
      },
      {
        id: 'inter',
        name: 'Inter',
        note: 'Trung tính, phổ biến',
        stack: "'Inter', system-ui, sans-serif",
        google: 'Inter:wght@300;400;500;600;700'
      },
      {
        id: 'plus-jakarta',
        name: 'Plus Jakarta Sans',
        note: 'Hiện đại, hơi tròn',
        stack: "'Plus Jakarta Sans', system-ui, sans-serif",
        google: 'Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400'
      },
      {
        id: 'nunito-sans',
        name: 'Nunito Sans',
        note: 'Mềm, thân thiện',
        stack: "'Nunito Sans', system-ui, sans-serif",
        google: 'Nunito+Sans:ital,opsz,wght@0,6..12,300;0,6..12,400;0,6..12,600;0,6..12,700;1,6..12,400'
      },
      {
        id: 'lexend',
        name: 'Lexend',
        note: 'Thiết kế cho dễ đọc',
        stack: "'Lexend', system-ui, sans-serif",
        google: 'Lexend:wght@300;400;500;600;700'
      },
      {
        id: 'source-sans-3',
        name: 'Source Sans 3',
        note: 'Gọn, nhiều chữ vẫn dễ đọc',
        stack: "'Source Sans 3', system-ui, sans-serif",
        google: 'Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400'
      }
    ],

    en: [
      {
        id: 'lora',
        name: 'Lora',
        note: 'Serif, đang dùng',
        stack: "'Lora', Georgia, serif",
        google: 'Lora:ital,wght@0,400;0,600;1,400'
      },
      {
        id: 'newsreader',
        name: 'Newsreader',
        note: 'Serif báo chí, có chữ nghiêng đẹp',
        stack: "'Newsreader', Georgia, serif",
        google: 'Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400'
      },
      {
        id: 'source-serif-4',
        name: 'Source Serif 4',
        note: 'Serif hiện đại, rõ nét',
        stack: "'Source Serif 4', Georgia, serif",
        google: 'Source+Serif+4:opsz,wght@8..60,400;8..60,600'
      },
      {
        id: 'literata',
        name: 'Literata',
        note: 'Serif cho đọc dài',
        stack: "'Literata', Georgia, serif",
        google: 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400'
      },
      {
        id: 'spectral',
        name: 'Spectral',
        note: 'Serif thanh, nhiều tương phản',
        stack: "'Spectral', Georgia, serif",
        google: 'Spectral:ital,wght@0,300;0,400;0,600;1,400'
      },
      {
        id: 'archivo',
        name: 'Archivo',
        note: 'Sans — thử đoạn văn không chân',
        stack: "'Archivo', system-ui, sans-serif",
        google: 'Archivo:wght@400;500;600;700'
      }
    ]
  };

  /**
   * Adds a Google Fonts stylesheet once per family. Safe to call repeatedly.
   */
  window.ENTRANCE_TEST_UI_FONTS.ensure = function ensureFont(googleSpec) {
    if (!googleSpec) return;
    const id = 'etui-font-' + googleSpec.replace(/[^a-z0-9]/gi, '').slice(0, 40);
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + googleSpec + '&display=swap';
    document.head.appendChild(link);
  };
})();
