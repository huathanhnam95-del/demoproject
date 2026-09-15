export function createPresentationAdapter({ model }) {
  const slide = action => model.command('world', { action: 'slide', payload: { action } });
  return {
    open() { return model.command('presentation', { action: 'open' }); },
    next() { return slide('next'); },
    previous() { return slide('previous'); }
  };
}
