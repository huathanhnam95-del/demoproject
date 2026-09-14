export function createPresentationAdapter({ model }) {
  return {
    open(room, slide = 1) { return model.command('slide', { room, slide }); },
    next(room, slide) { return model.command('slide', { room, slide: slide + 1 }); },
    previous(room, slide) { return model.command('slide', { room, slide: Math.max(1, slide - 1) }); }
  };
}
