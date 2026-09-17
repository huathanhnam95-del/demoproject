/* BEL identity concept generator — edit params, re-run: node _generate.js */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'svg');

const P = {
  stepframe: { id:'stepframe', name:'Stepframe',
    ink:'#13211C', primary:'#0E5C41', metal:'#E9EEEB', accent:'#B14A18', page:'#FAFBFA',
    sw:11, rx:2, gap:9, topW:20, botW:24, eGap:0, midW:19, armW:21, footW:17, armR:2 },
  underline: { id:'underline', name:'Underline',
    ink:'#14181A', primary:'#0B6B4A', metal:'#E7E4DC', accent:'#B4430F', page:'#FBF9F4',
    sw:9.5, rx:1, gap:13, topW:21, botW:21, eGap:0, midW:18, armW:20, footW:16, armR:1 },
  retour: { id:'return', name:'The Return',
    ink:'#0D2128', primary:'#0A5B66', metal:'#E6EDEF', accent:'#A94C19', page:'#F9FBFB',
    sw:12, rx:6, gap:9, topW:22, botW:22, eGap:0, midW:19, armW:21, footW:18, armR:5.5 },
  belcut:    { id:'belcut', name:'BEL Cut',
    ink:'#111A17', primary:'#0F6547', metal:'#DCE3DF', accent:'#A8471A', page:'#FFFFFF',
    sw:11, rx:1.5, gap:10, topW:22, botW:22, eGap:4.5, midW:15, armW:21, footW:17, armR:1.5 },
};

const n = v => Math.round(v*100)/100;
const rect = (x,y,w,h,r=0) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r?` rx="${n(r)}"`:''}/>`;
// rect rounded on the right side only (bowl of a B)
const bowl = (x0,y0,x1,y1) => { const r=(y1-y0)/2;
  return `<path d="M${n(x0)} ${n(y0)}H${n(x1-r)}a${n(r)} ${n(r)} 0 0 1 0 ${n(r*2)}H${n(x0)}Z"/>`; };

/* --- geometric BEL wordmark: cap height 48, top y=8, baseline y=56 --- */
function wordmark(p, x0=0){
  const {sw,rx,gap,topW,botW,armW,footW,midW,eGap,armR}=p; let x=x0, s=[];
  // B
  s.push(rect(x,8,sw,48,rx));
  s.push(bowl(x+sw,8,x+sw+topW,31));
  s.push(bowl(x+sw,33,x+sw+botW,56));
  const bW = sw + Math.max(topW,botW); x += bW + gap;
  // E  (eGap detaches the middle arm — the BEL Cut signature detail)
  s.push(rect(x,8,sw,48,rx));
  s.push(rect(x+sw,8,armW,11,armR));
  s.push(rect(x+sw+eGap,28.5,midW,10,armR));
  s.push(rect(x+sw,45,armW,11,armR));
  x += sw + armW + gap;
  // L
  s.push(rect(x,8,sw,48,rx));
  s.push(rect(x+sw,45,footW,11,armR));
  x += sw + footW;
  return { markup:s.join(''), width:x-x0 };
}

/* --- symbols, each drawn inside a 64x64 box --- */
const symbols = {
  // two stacked modules; the lower one reaches one step further right
  stepframe: c => `<g fill="${c.solid||c.ink}">${rect(12,8,11,48,2)}${bowl(23,8,41,29)}</g>`
                 + `<g fill="${c.solid||c.primary}">${bowl(23,35,52,56)}</g>`,
  // a line of text with one segment marked and a caret pointing at it
  underline: c => `<g fill="${c.solid||c.ink}">${rect(11,15,42,8.5,4.25)}${rect(11,31,15,8.5,4.25)}</g>`
                 + `<g fill="${c.solid||c.primary}">${rect(30,31,23,8.5,4.25)}${rect(30,45,23,5,2.5)}</g>`,
  // an open loop that steps outward: you come back, but a little further on
  retour: c => {
    const cx=32, cy=32, turns=1.0, r0=12.5, r1=24, N=160, pts=[];
    for(let i=0;i<=N;i++){ const t=i/N, th=-Math.PI*0.55 + t*turns*2*Math.PI, r=r0+(r1-r0)*t;
      pts.push(`${Math.round((cx+r*Math.cos(th))*100)/100} ${Math.round((cy+r*Math.sin(th))*100)/100}`); }
    const start=pts[0].split(' ');
    return `<path d="M${pts.join('L')}" fill="none" stroke="${c.solid||c.primary}" stroke-width="9" stroke-linecap="round"/>`
         + `<circle cx="${start[0]}" cy="${start[1]}" r="5" fill="${c.solid||c.accent}"/>`;
  },
  // the E alone — the glyph that carries the gap detail
  belcut: c => { const p=P.belcut;
    return `<g fill="${c.solid||c.ink}">${rect(16,8,p.sw,48,p.rx)}${rect(16+p.sw,8,p.armW,11,p.armR)}${rect(16+p.sw,45,p.armW,11,p.armR)}</g>`
         + `<g fill="${c.solid||c.primary}">${rect(16+p.sw+p.eGap,28.5,p.midW,10,p.armR)}</g>`; },
};

const svg = (vb, body, title) =>
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}">
<title>${title}</title>
${body}
</svg>
`;

let manifest = {};
for (const key of Object.keys(P)) {
  const p = P[key];
  const wmColors = { primary:p.primary, ink:p.ink };
  const wm = wordmark(p, 0);
  const SYM = symbols[key];

  const files = {
    // symbol only
    [`${p.id}-symbol.svg`]: svg('0 0 64 64', SYM({primary:p.primary, ink:p.ink, metal:p.metal, accent:p.accent}), `BEL ${p.name} symbol`),
    // one-colour fallback
    [`${p.id}-symbol-mono.svg`]: svg('0 0 64 64', SYM({solid:'currentColor'}), `BEL ${p.name} symbol, one colour`),
    // compact: wordmark only
    [`${p.id}-wordmark.svg`]: svg(`0 0 ${n(wm.width)} 64`, `<g fill="${p.ink}">${wm.markup}</g>`, `BEL wordmark, ${p.name}`),
    // primary horizontal lockup (wordmark-first directions drop the symbol)
    [`${p.id}-lockup.svg`]: key==='belcut'
      ? svg(`0 0 ${n(wm.width)} 64`, `<g fill="${p.ink}">${wordmark({...p, eGap:0, midW:19}).markup}</g>`
          .replace(wordmark({...p, eGap:0, midW:19}).markup, wm.markup), `Better English Learning, ${p.name} lockup`)
      : svg(`0 0 ${n(64+18+wm.width)} 64`,
        SYM({primary:p.primary, ink:p.ink, metal:p.metal, accent:p.accent})
      + `<g fill="${p.ink}" transform="translate(${n(82)},0)">${wm.markup}</g>`,
        `Better English Learning, ${p.name} lockup`),
    // one-colour lockup
    [`${p.id}-lockup-mono.svg`]: key==='belcut'
      ? svg(`0 0 ${n(wm.width)} 64`, `<g fill="currentColor">${wm.markup}</g>`, `Better English Learning, ${p.name} lockup, one colour`)
      : svg(`0 0 ${n(64+18+wm.width)} 64`,
        SYM({solid:'currentColor'})
      + `<g fill="currentColor" transform="translate(${n(82)},0)">${wm.markup}</g>`,
        `Better English Learning, ${p.name} lockup, one colour`),
    // app tile / favicon
    [`${p.id}-tile.svg`]: svg('0 0 64 64',
        `<rect width="64" height="64" rx="14" fill="${p.primary}"/>`
      + `<g transform="translate(6.4,6.4) scale(0.8)">${SYM({solid:'#FFFFFF'})}</g>`,
        `BEL app tile, ${p.name}`),
  };
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(OUT,f), body, 'utf8');
  manifest[key] = { ...p, wordmarkWidth:n(wm.width), files:Object.keys(files) };
}
fs.writeFileSync(path.join(__dirname,'_manifest.json'), JSON.stringify(manifest,null,2));
console.log('wrote', fs.readdirSync(OUT).length, 'svg files');
