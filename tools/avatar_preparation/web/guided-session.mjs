export class GuidedSession {
  constructor(text, directions, counter) { this.text = text; this.directions = directions; this.counter = counter; this.index = 0; }
  load(scene, language, draft) {
    this.pause(); this.index = 0;
    const authored = scene.cues?.[language] || [];
    this.cues = draft === undefined ? authored : [{ spokenText: draft, ...scene.performance, instruction: 'Your saved script draft. Read naturally; use manual cue control.' }];
    if (scene.kind === 'photo') this.cues = [{ spokenText: '', ...scene.performance, instruction: scene.description }];
    this.render();
  }
  render() {
    const cue = this.cues[this.index];
    this.text.textContent = cue?.spokenText || 'Settle into your pose. Breathe, relax your shoulders, and look toward the lens.';
    this.directions.textContent = cue ? `${cue.instruction || ''} • ${cue.emotion || 'Natural'}, intensity ${cue.intensity || 2}/5 • ${cue.expression || ''} • Eyes: ${cue.eyeContact || 'toward the lens'} • ${cue.posture || 'upright, relaxed shoulders'} • Head: ${cue.head || 'steady'} • Hands: ${cue.hands || 'resting below chest'} • Pause ${cue.pauseMs / 1000 || 1}s` : '';
    this.counter.textContent = `${Math.min(this.index + 1, this.cues.length)} / ${this.cues.length}`;
  }
  move(delta) { this.index = Math.max(0, Math.min(this.cues.length - 1, this.index + delta)); this.render(); }
  play() { this.pause(); this.running = true; const next = () => { const cue = this.cues[this.index]; this.timer = setTimeout(() => { if (this.index < this.cues.length - 1) { this.move(1); next(); } else this.pause(); }, (cue?.durationTargetSeconds || 15) * 1000); }; next(); }
  pause() { clearTimeout(this.timer); this.running = false; }
}
