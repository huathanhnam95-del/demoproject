export function createPresentationAdapter({ model }) {
  const sequence = [['A', 1, 3], ['C', 4, 9], ['E', 10, 16], ['G', 17, 18], ['I', 19, 20], ['J', 21, 21]];
  function step(room, slide, direction) {
    const index = Math.max(0, sequence.findIndex(item => item[0] === room));
    const current = sequence[index];
    if (direction > 0) { if (slide < current[2]) return { room, slide: slide + 1 }; const next = sequence[Math.min(sequence.length - 1, index + 1)]; return { room: next[0], slide: next[1] }; }
    if (slide > current[1]) return { room, slide: slide - 1 }; const previous = sequence[Math.max(0, index - 1)]; return { room: previous[0], slide: previous[2] };
  }
  return {
    open(room, slide = 1) { return model.command('slide', { room, slide }); },
    next(room, slide) { return model.command('slide', step(room, slide, 1)); },
    previous(room, slide) { return model.command('slide', step(room, slide, -1)); }
  };
}
