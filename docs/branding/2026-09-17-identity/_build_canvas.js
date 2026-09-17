/* Builds the design-canvas artboards from the generated SVGs. node _build_canvas.js */
const fs = require('fs'), path = require('path');
const SVG = path.join(__dirname, 'svg');
const ROOT = process.argv[2];
const PROJ = path.join(ROOT, 'project');
fs.mkdirSync(PROJ, { recursive: true });

const raw = f => fs.readFileSync(path.join(SVG, f), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '').trim();
// inline an svg file at a given rendered height
const at = (f, h) => raw(f).replace('<svg ', `<svg style="height:${h}px;width:auto;display:block" `);

const D = {
  stepframe: {
    n: '01', name: 'Stepframe', idea: 'A clearer next step.',
    ink:'#13211C', primary:'#0E5C41', metal:'#E9EEEB', page:'#FAFBFA', muted:'#586B63', accent:'#B14A18',
    font: 'Be Vietnam Pro', head: 'Be Vietnam Pro',
    link: 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap',
    fontNote: 'Be Vietnam Pro · SIL OFL · Vietnamese-first',
    swatches: [
      ['Ink','#13211C','16.6:1 on card'], ['Primary','#0E5C41','8.00:1 on card'],
      ['Metal','#E9EEEB','quiet surface'], ['Page','#FAFBFA','background'],
      ['Card','#FFFFFF','practice areas'], ['Muted','#586B63','5.68:1 on card'],
      ['Accent','#B14A18','5.44:1 reversed'],
    ],
  },
  underline: {
    n: '02', name: 'Underline', idea: 'See what to improve.',
    ink:'#14181A', primary:'#0B6B4A', metal:'#E7E4DC', page:'#FBF9F4', muted:'#5C625F', accent:'#B4430F',
    font: 'Be Vietnam Pro', head: 'Newsreader',
    link: 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap',
    fontNote: 'Newsreader + Be Vietnam Pro · SIL OFL',
    swatches: [
      ['Ink','#14181A','17.9:1 on card'], ['Primary','#0B6B4A','6.53:1 on card'],
      ['Metal','#E7E4DC','quiet surface'], ['Page','#FBF9F4','warm paper'],
      ['Card','#FFFFFF','practice areas'], ['Muted','#5C625F','6.24:1 on card'],
      ['Accent','#B4430F','5.60:1 reversed'],
    ],
  },
  return: {
    n: '03', name: 'The Return', idea: 'Come back to what needs more practice.',
    ink:'#0D2128', primary:'#0A5B66', metal:'#E6EDEF', page:'#F9FBFB', muted:'#516168', accent:'#A94C19',
    font: 'Lexend', head: 'Lexend',
    link: 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap',
    fontNote: 'Lexend · SIL OFL · readability-motivated',
    swatches: [
      ['Ink','#0D2128','16.6:1 on card'], ['Primary','#0A5B66','7.77:1 on card'],
      ['Metal','#E6EDEF','quiet surface'], ['Page','#F9FBFB','background'],
      ['Card','#FFFFFF','practice areas'], ['Muted','#516168','6.44:1 on card'],
      ['Accent','#A94C19','5.62:1 reversed'],
    ],
  },
  belcut: {
    n: '04', name: 'BEL Cut', idea: 'Better English. Clearer progress.',
    ink:'#111A17', primary:'#0F6547', metal:'#DCE3DF', page:'#FFFFFF', muted:'#5B6660', accent:'#A8471A',
    font: 'IBM Plex Sans', head: 'IBM Plex Sans',
    link: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
    fontNote: 'IBM Plex Sans · SIL OFL · wordmark drawn, not set',
    swatches: [
      ['Ink','#111A17','17.7:1 on card'], ['Primary','#0F6547','7.06:1 on card'],
      ['Metal','#DCE3DF','rails, dividers'], ['Page','#FFFFFF','background'],
      ['Card','#FFFFFF','practice areas'], ['Muted','#5B6660','5.98:1 on card'],
      ['Accent','#A8471A','5.86:1 reversed'],
    ],
  },
};

const page = (lang, w, h, fontLink, bodyFont, inner, props) => `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
  <link rel="stylesheet" href="${fontLink}">
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: ${bodyFont}; -webkit-font-smoothing: antialiased; }
    a { color: inherit; }
  </style>
</helmet>
${inner}
</x-dc>
<script data-dc-script data-props='${props}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;

const lbl = (t, c) => `<div style="font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: ${c};">${t}</div>`;

/* ---------- the mini interface example, one per direction ---------- */
function miniUI(k, d) {
  const chrome = `font-family: ${d.font}, system-ui, sans-serif;`;
  if (k === 'stepframe') return `
  <div style="${chrome} background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
    ${lbl('Read Aloud · result', d.muted)}
    <div style="font-size: 15px; color: ${d.ink}; line-height: 1.5;">Your pronunciation was clear. The ending sounds in <strong style="font-weight: 600;">asked</strong> and <strong style="font-weight: 600;">crossed</strong> were dropped.</div>
    <div style="height: 1px; background: ${d.metal};"></div>
    <div style="display: flex; gap: 14px; align-items: flex-start; padding-left: 20px; border-left: 3px solid ${d.primary};">
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
        ${lbl('Next step', d.primary)}
        <div style="font-size: 15px; font-weight: 600; color: ${d.ink};">Practise final consonant clusters</div>
        <div style="font-size: 13px; color: ${d.muted};">6 sentences · about 4 minutes</div>
      </div>
      <button type="button" style="${chrome} flex-shrink: 0; min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; background: ${d.primary}; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer;">Start</button>
    </div>
  </div>`;
  if (k === 'underline') return `
  <div style="${chrome} background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
    ${lbl('Write Essay · feedback', d.muted)}
    <div style="font-size: 16px; color: ${d.ink}; line-height: 1.7;">The results <span style="border-bottom: 3px solid ${d.primary}; padding-bottom: 2px;">was surprising</span> to the researchers.</div>
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <div style="flex-shrink: 0; width: 3px; align-self: stretch; background: ${d.primary}; border-radius: 2px;"></div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="font-size: 14px; font-weight: 600; color: ${d.ink};">Try: <span style="color: ${d.primary};">were surprising</span></div>
        <div style="font-size: 13px; color: ${d.muted}; line-height: 1.5;">Results is plural, so it takes were.</div>
      </div>
    </div>
    <button type="button" style="${chrome} align-self: flex-start; min-height: 44px; padding: 0 20px; border: 1px solid ${d.primary}; border-radius: 10px; background: #FFFFFF; color: ${d.primary}; font-size: 14px; font-weight: 600; cursor: pointer;">Edit and try again</button>
  </div>`;
  if (k === 'return') return `
  <div style="${chrome} background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
    ${lbl('Due for review today', d.muted)}
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; gap: 14px; align-items: center;">
        <div style="flex-shrink: 0; color: ${d.primary};">${at('return-symbol-mono.svg', 26)}</div>
        <div style="flex-grow: 1;">
          <div style="font-size: 15px; font-weight: 600; color: ${d.ink};">deteriorate</div>
          <div style="font-size: 13px; color: ${d.muted};">Returned twice · last seen 6 days ago</div>
        </div>
        <button type="button" style="${chrome} flex-shrink: 0; min-height: 44px; padding: 0 18px; border: 0; border-radius: 10px; background: ${d.primary}; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer;">Review</button>
      </div>
      <div style="height: 1px; background: ${d.metal};"></div>
      <div style="display: flex; gap: 14px; align-items: center;">
        <div style="flex-shrink: 0; color: ${d.muted};">${at('return-symbol-mono.svg', 26)}</div>
        <div style="flex-grow: 1;">
          <div style="font-size: 15px; font-weight: 600; color: ${d.ink};">Repeat Sentence · long items</div>
          <div style="font-size: 13px; color: ${d.muted};">Returned once · 5 items</div>
        </div>
      </div>
    </div>
  </div>`;
  return `
  <div style="${chrome} background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 14px;">
    ${lbl('Write from Dictation', d.muted)}
    <label for="wfd-belcut" style="font-size: 15px; color: ${d.ink};">Type the sentence you heard</label>
    <input id="wfd-belcut" type="text" value="The lecture will be held in the main hall" style="${chrome} min-height: 48px; padding: 0 14px; border: 1px solid ${d.metal}; border-radius: 10px; font-size: 15px; color: ${d.ink}; background: #FFFFFF;">
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="height: 2px; width: 28px; background: ${d.primary}; border-radius: 1px;"></div>
      <div style="font-size: 13px; color: ${d.muted};">Hints appear here, in the gap.</div>
      <div style="flex-grow: 1; height: 1px; background: ${d.metal};"></div>
    </div>
    <button type="button" style="${chrome} align-self: flex-start; min-height: 44px; padding: 0 22px; border: 0; border-radius: 10px; background: ${d.primary}; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer;">Check my answer</button>
  </div>`;
}

/* ---------- one direction board ---------- */
function board(k) {
  const d = D[k], W = 620, H = 1180, f = `${d.font}, system-ui, sans-serif`;
  const sw = d.swatches.map(([role, hex, note]) => `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="height: 54px; border-radius: 8px; background: ${hex}; ${hex === '#FFFFFF' || hex === '#FAFBFA' || hex === '#FBF9F4' || hex === '#F9FBFB' ? `border: 1px solid ${d.metal};` : ''}"></div>
        <div style="font-size: 12px; font-weight: 600; color: ${d.ink};">${role}</div>
        <div style="font-size: 11px; color: ${d.muted}; font-variant-numeric: tabular-nums;">${hex}</div>
        <div style="font-size: 10px; color: ${d.muted};">${note}</div>
      </div>`).join('');

  const inner = `
<div style="width: ${W}px; height: ${H}px; box-sizing: border-box; padding: 44px 48px; background: ${d.page}; font-family: ${f}; display: flex; flex-direction: column; gap: 26px;">

  <div style="display: flex; align-items: baseline; gap: 12px;">
    <div style="font-size: 12px; font-weight: 700; color: ${d.primary}; font-variant-numeric: tabular-nums;">${d.n}</div>
    <div style="font-size: 22px; font-weight: 700; color: ${d.ink}; letter-spacing: -0.01em;">${d.name}</div>
    <div style="flex-grow: 1; height: 1px; background: ${d.metal};"></div>
  </div>

  <div style="font-family: ${d.head}, serif; font-size: 27px; font-weight: 600; color: ${d.ink}; letter-spacing: -0.015em; line-height: 1.2;">${d.idea}</div>

  <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 16px; padding: 38px 32px; display: flex; align-items: center; justify-content: center;">
    ${at(k === 'belcut' ? 'belcut-lockup.svg' : `${k}-lockup.svg`, 52)}
  </div>

  <div style="display: flex; align-items: flex-end; gap: 26px;">
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
      ${lbl('Symbol', d.muted)}
      ${at(`${k}-symbol.svg`, 46)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
      ${lbl('App tile', d.muted)}
      ${at(`${k}-tile.svg`, 46)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start; color: ${d.ink};">
      ${lbl('One colour', d.muted)}
      ${at(`${k}-symbol-mono.svg`, 46)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
      ${lbl('At 16 / 24 px', d.muted)}
      <div style="display: flex; align-items: flex-end; gap: 10px; height: 46px;">
        ${at(`${k}-symbol.svg`, 16)}${at(`${k}-symbol.svg`, 24)}
      </div>
    </div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 12px;">
    ${lbl('Palette', d.muted)}
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">${sw}</div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 8px;">
    ${lbl(d.fontNote, d.muted)}
    <div style="font-family: ${d.head}, serif; font-size: 25px; font-weight: 600; color: ${d.ink}; letter-spacing: -0.01em;">Luyện tập rõ ràng. Tiến bộ từng bước.</div>
    <div style="font-size: 14px; color: ${d.muted}; line-height: 1.55;">Practise these words, then record the sentence again. Nghe kỹ phần đuôi từ và thử lại một lần nữa.</div>
  </div>

  <div style="flex-grow: 1;"></div>
  ${miniUI(k, d)}
</div>`;
  return page('en', W, H, d.link, `${f}`, inner, `{"$preview":{"width":${W},"height":${H}}}`);
}

/* ---------- the recommended direction, full practice screen ---------- */
function practice() {
  const d = D.stepframe, W = 1280, H = 820, f = `${d.font}, system-ui, sans-serif`;
  const inner = `
<div style="width: ${W}px; height: ${H}px; box-sizing: border-box; background: ${d.page}; font-family: ${f}; display: flex; flex-direction: column;">

  <div style="flex-shrink: 0; height: 68px; box-sizing: border-box; padding: 0 32px; background: #FFFFFF; border-bottom: 1px solid ${d.metal}; display: flex; align-items: center; gap: 20px;">
    ${at('stepframe-lockup.svg', 26)}
    <div style="padding: 4px 9px; border: 1px solid ${d.metal}; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${d.muted};">PTE Practice</div>
    <div style="flex-grow: 1;"></div>
    <a href="#practice" style="font-size: 14px; font-weight: 600; color: ${d.primary}; text-decoration: none;">Practice</a>
    <a href="#review" style="font-size: 14px; color: ${d.muted}; text-decoration: none;">Review</a>
    <a href="#progress" style="font-size: 14px; color: ${d.muted}; text-decoration: none;">Progress</a>
  </div>

  <div style="flex-grow: 1; box-sizing: border-box; padding: 34px 40px; display: flex; gap: 32px;">

    <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 22px;">
      <div style="display: flex; align-items: baseline; gap: 14px;">
        <div style="font-size: 22px; font-weight: 700; color: ${d.ink}; letter-spacing: -0.015em;">Read Aloud</div>
        <div style="font-size: 13px; color: ${d.muted};">Item 4 of 6</div>
      </div>

      <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 16px; padding: 38px 40px;">
        <div style="font-size: 21px; line-height: 1.75; color: ${d.ink};">The committee <span style="border-bottom: 3px solid ${d.accent}; padding-bottom: 3px;">asked</span> for a revised proposal before the deadline, and the researchers <span style="border-bottom: 3px solid ${d.accent}; padding-bottom: 3px;">crossed</span> out the section that no longer applied.</div>
      </div>

      <div style="display: flex; align-items: center; gap: 16px;">
        <button type="button" style="font-family: ${f}; min-height: 48px; padding: 0 26px; border: 0; border-radius: 12px; background: ${d.primary}; color: #FFFFFF; font-size: 15px; font-weight: 600; cursor: pointer;">Record again</button>
        <button type="button" style="font-family: ${f}; min-height: 48px; padding: 0 22px; border: 1px solid ${d.metal}; border-radius: 12px; background: #FFFFFF; color: ${d.ink}; font-size: 15px; font-weight: 500; cursor: pointer;">Play my answer</button>
        <div style="flex-grow: 1;"></div>
        <div style="font-size: 13px; color: ${d.muted};">Two underlines mean two sounds to fix &mdash; not a low score.</div>
      </div>

      <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 16px; padding: 24px 28px; display: flex; flex-direction: column; gap: 16px;">
        ${lbl('What to change', d.muted)}
        <div style="display: flex; gap: 28px;">
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 16px; color: ${d.ink};">asked <span style="color: ${d.muted};">/ɑːskt/</span></div>
            <div style="font-size: 13px; color: ${d.muted}; line-height: 1.5;">The <strong style="font-weight: 600; color: ${d.ink};">kt</strong> at the end was dropped.</div>
          </div>
          <div style="width: 1px; background: ${d.metal};"></div>
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 16px; color: ${d.ink};">crossed <span style="color: ${d.muted};">/krɔːst/</span></div>
            <div style="font-size: 13px; color: ${d.muted}; line-height: 1.5;">The <strong style="font-weight: 600; color: ${d.ink};">st</strong> at the end was dropped.</div>
          </div>
        </div>
      </div>
    </div>

    <div style="flex-shrink: 0; width: 316px; display: flex; flex-direction: column; gap: 20px;">
      <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 16px; padding: 22px 24px; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; flex-direction: column; gap: 14px; padding-left: 20px; border-left: 3px solid ${d.primary};">
          ${lbl('Next step', d.primary)}
          <div style="font-size: 16px; font-weight: 600; color: ${d.ink}; line-height: 1.35;">Practise final consonant clusters</div>
          <div style="font-size: 13px; color: ${d.muted};">6 sentences &middot; about 4 minutes</div>
          <button type="button" style="font-family: ${f}; min-height: 44px; border: 0; border-radius: 10px; background: ${d.primary}; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer;">Start now</button>
        </div>
      </div>

      <div style="background: ${d.metal}; border-radius: 16px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px;">
        ${lbl('Need help?', d.muted)}
        <div style="font-size: 14px; color: ${d.ink}; line-height: 1.5;">Hear the two words slowly, one at a time.</div>
        <button type="button" style="font-family: ${f}; align-self: flex-start; min-height: 44px; padding: 0 18px; border: 1px solid ${d.primary}; border-radius: 10px; background: transparent; color: ${d.primary}; font-size: 14px; font-weight: 600; cursor: pointer;">Play slowly</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${lbl('This session', d.muted)}
        <div style="display: flex; gap: 6px;">
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: ${d.primary};"></div>
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: ${d.primary};"></div>
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: ${d.primary};"></div>
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: ${d.primary};"></div>
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: #FFFFFF; border: 1px solid ${d.metal}; box-sizing: border-box;"></div>
          <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: #FFFFFF; border: 1px solid ${d.metal}; box-sizing: border-box;"></div>
        </div>
        <div style="font-size: 13px; color: ${d.muted};">4 of 6 done</div>
      </div>
    </div>
  </div>
</div>`;
  return page('en', W, H, d.link, f, inner, `{"$preview":{"width":${W},"height":${H}}}`);
}

/* ---------- mobile ---------- */
function mobile() {
  const d = D.stepframe, W = 390, H = 844, f = `${d.font}, system-ui, sans-serif`;
  const inner = `
<div style="width: ${W}px; height: ${H}px; box-sizing: border-box; background: ${d.page}; font-family: ${f}; display: flex; flex-direction: column;">

  <div style="flex-shrink: 0; box-sizing: border-box; height: 60px; padding: 0 18px; background: #FFFFFF; border-bottom: 1px solid ${d.metal}; display: flex; align-items: center; gap: 12px;">
    ${at('stepframe-symbol.svg', 26)}
    <div style="font-size: 16px; font-weight: 700; color: ${d.ink}; letter-spacing: -0.01em;">Read Aloud</div>
    <div style="flex-grow: 1;"></div>
    <div style="font-size: 13px; color: ${d.muted};">4 / 6</div>
  </div>

  <div style="flex-grow: 1; box-sizing: border-box; padding: 20px 18px; display: flex; flex-direction: column; gap: 18px; overflow: hidden;">
    <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 22px 20px;">
      <div style="font-size: 18px; line-height: 1.7; color: ${d.ink};">The committee <span style="border-bottom: 3px solid ${d.accent}; padding-bottom: 2px;">asked</span> for a revised proposal before the deadline.</div>
    </div>

    <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px;">
      ${lbl('What to change', d.muted)}
      <div style="font-size: 16px; color: ${d.ink};">asked <span style="color: ${d.muted};">/ɑːskt/</span></div>
      <div style="font-size: 13px; color: ${d.muted}; line-height: 1.5;">The <strong style="font-weight: 600; color: ${d.ink};">kt</strong> at the end was dropped.</div>
    </div>

    <div style="background: #FFFFFF; border: 1px solid ${d.metal}; border-radius: 14px; padding: 18px 20px;">
      <div style="display: flex; flex-direction: column; gap: 10px; padding-left: 16px; border-left: 3px solid ${d.primary};">
        ${lbl('Next step', d.primary)}
        <div style="font-size: 16px; font-weight: 600; color: ${d.ink}; line-height: 1.35;">Practise final consonant clusters</div>
        <div style="font-size: 13px; color: ${d.muted};">6 sentences &middot; about 4 minutes</div>
      </div>
    </div>

    <div style="flex-grow: 1;"></div>

    <button type="button" style="font-family: ${f}; min-height: 52px; border: 0; border-radius: 12px; background: ${d.primary}; color: #FFFFFF; font-size: 16px; font-weight: 600; cursor: pointer;">Record again</button>
    <button type="button" style="font-family: ${f}; min-height: 52px; border: 1px solid ${d.metal}; border-radius: 12px; background: #FFFFFF; color: ${d.ink}; font-size: 16px; font-weight: 500; cursor: pointer;">Play my answer</button>
  </div>
</div>`;
  return page('en', W, H, d.link, f, inner, `{"$preview":{"width":${W},"height":${H}}}`);
}

/* ---------- small sizes, one colour, dark ---------- */
function small() {
  const d = D.stepframe, W = 1240, H = 430, f = `${d.font}, system-ui, sans-serif`;
  const keys = ['stepframe', 'underline', 'return', 'belcut'];
  const col = k => `
    <div style="display: flex; flex-direction: column; gap: 16px; align-items: flex-start;">
      <div style="font-size: 13px; font-weight: 600; color: ${d.ink};">${D[k].name}</div>
      <div style="display: flex; align-items: flex-end; gap: 14px; height: 36px;">
        ${at(`${k}-symbol.svg`, 16)}${at(`${k}-symbol.svg`, 24)}${at(`${k}-symbol.svg`, 32)}
      </div>
      <div style="display: flex; gap: 10px;">
        ${at(`${k}-tile.svg`, 32)}${at(`${k}-tile.svg`, 20)}${at(`${k}-tile.svg`, 16)}
      </div>
      <div style="color: ${d.ink};">${at(`${k}-symbol-mono.svg`, 30)}</div>
      <div style="background: ${d.ink}; border-radius: 10px; padding: 12px 16px; color: #FFFFFF;">${at(`${k}-lockup-mono.svg`, 22)}</div>
    </div>`;
  const inner = `
<div style="width: ${W}px; height: ${H}px; box-sizing: border-box; padding: 40px 44px; background: ${d.page}; font-family: ${f}; display: flex; flex-direction: column; gap: 24px;">
  <div style="display: flex; align-items: baseline; gap: 14px;">
    <div style="font-size: 20px; font-weight: 700; color: ${d.ink}; letter-spacing: -0.01em;">Small sizes, one colour, reversed</div>
    <div style="flex-grow: 1; height: 1px; background: ${d.metal};"></div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 32px;">
    ${keys.map(col).join('')}
  </div>
  <div style="flex-grow: 1;"></div>
  <div style="font-size: 13px; color: ${d.muted}; line-height: 1.5;">Rows: symbol at 16 / 24 / 32 px &middot; app tile at 32 / 20 / 16 px &middot; one-colour symbol &middot; reversed lockup. The BEL Cut gap closes below about 24 px; the other three hold.</div>
</div>`;
  return page('en', W, H, d.link, f, inner, `{"$preview":{"width":${W},"height":${H}}}`);
}

const files = {
  'Main.dc.html': board('stepframe'),
  'Underline.dc.html': board('underline'),
  'Return.dc.html': board('return'),
  'BelCut.dc.html': board('belcut'),
  'Practice.dc.html': practice(),
  'Mobile.dc.html': mobile(),
  'SmallSizes.dc.html': small(),
};
for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(PROJ, n), c, 'utf8');

const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
  title: 'BEL Identity Exploration',
  launch: { view: 'canvas' },
  pages: [],
  boards: {
    'Main.dc.html':       { x: 0,    y: 0,    w: 620,  h: 1180, title: '01 Stepframe' },
    'Underline.dc.html':  { x: 700,  y: 0,    w: 620,  h: 1180, title: '02 Underline' },
    'Return.dc.html':     { x: 1400, y: 0,    w: 620,  h: 1180, title: '03 The Return' },
    'BelCut.dc.html':     { x: 2100, y: 0,    w: 620,  h: 1180, title: '04 BEL Cut' },
    'Practice.dc.html':   { x: 0,    y: 1500, w: 1280, h: 820,  title: 'Practice screen — Stepframe' },
    'Mobile.dc.html':     { x: 1360, y: 1500, w: 390,  h: 844,  title: 'Mobile' },
    'SmallSizes.dc.html': { x: 0,    y: 2664, w: 1240, h: 430,  title: 'Small sizes' },
  },
  order: ['Main.dc.html','Underline.dc.html','Return.dc.html','BelCut.dc.html','Practice.dc.html','Mobile.dc.html','SmallSizes.dc.html'],
  notes: {
    t1: { x: 0, y: -300, text: 'Four directions', kind: 'title1', maxW: 2720 },
    t2: { x: 0, y: 1240, text: 'The recommendation, in the product', kind: 'title1', maxW: 1750 },
    t3: { x: 0, y: 2404, text: 'Small sizes, one colour, reversed', kind: 'title1', maxW: 1240 },
    n1: { x: 2820, y: 0, w: 420, text: 'Recommendation: Stepframe, with the Underline idea harvested as the interface feedback mark. Full reasoning, the four-pillar derivation and every weakness are in the rationale document, not on these boards.', color: 'green' },
  },
  designSystems: [],
};
fs.writeFileSync(path.join(PROJ, 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
console.log('wrote', Object.keys(files).length, 'artboards + canvas.json to', PROJ);
