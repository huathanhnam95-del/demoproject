export const HEADINGS = ['The thought', 'Why it happened', 'The shift'];
export const GROUPS = { A: [1, 3], C: [4, 9], E:[10,16], G:[17,18], I:[19,20], J:[21,21] };
export const VOICES = ['Chet Faliszek','Josh Weier','Mike Morasky','Erik Wolpaw','Rich Geldreich'];
export const normalize = text => text.replace(/\s+/g, ' ').trim();
export async function loadSource() {
  const deckUrl = new URL('../native/deck.html', import.meta.url);
  const response = await fetch(deckUrl);
  if (!response.ok) throw Error('Native source unavailable');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const slides = n => doc.querySelector(`section[data-screen-label="${String(n).padStart(2,'0')}"]`);
  const routes = Object.fromEntries([4,5,6].map((n,i) => {
    const s = slides(n), ps = [...s.querySelectorAll('p')];
    if (ps.length !== 4) throw Error(`Unexpected slide ${n} source structure`);
    return [`B${i+1}`, { slide:n, title:normalize(s.querySelector('h2').textContent), sections:ps.slice(0,3).map(p=>normalize(p.textContent)) }];
  }));
  const gallery = VOICES.map((name,i) => {
    const s=slides(10+i);
    if (s.dataset.label !== name || s.querySelector('img').alt !== name) throw Error('Portrait attribution mismatch');
    return {name,slide:10+i,image:new URL(s.querySelector('img').getAttribute('src'),deckUrl).href,
      quote:normalize(s.querySelector('blockquote').textContent),
      paragraphs:[...s.querySelectorAll('p')].map(p=>normalize(p.textContent)),
      attribution:normalize(s.querySelector('img').nextElementSibling.textContent)};
  });
  const objectives=[...slides(21).querySelectorAll('h3')].slice(0,3).map(h=>({title:normalize(h.previousElementSibling.textContent+' '+h.textContent),detail:normalize(h.nextElementSibling.textContent)}));
  if(objectives.length!==3)throw Error('Unexpected source objective structure');
  return {routes,gallery,objectives};
}
