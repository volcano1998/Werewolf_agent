// ---------------- dramatic music: made live with the browser's synthesizer, no audio files ----------------
const Music = (() => {
  let ctx = null, master = null, bus = null, group = null, timers = [], mode = null, ducked = false;
  let enabled = store.get("ww-music", true);
  const level = () => (enabled ? (ducked ? 0.2 : 0.5) : 0);
  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = level(); master.connect(ctx.destination);
      bus = ctx.createGain(); bus.connect(master);
      // a little echo gives the room a big, spooky feel
      const d = ctx.createDelay(1); d.delayTime.value = 0.42; const fb = ctx.createGain(); fb.gain.value = 0.38; const wet = ctx.createGain(); wet.gain.value = 0.35;
      bus.connect(wet); wet.connect(d); d.connect(fb); fb.connect(d); d.connect(master);
    }
    if (ctx.state === "suspended") ctx.resume();
    if (enabled && !mode && pending) play(pending);
  }
  let pending = null;
  const ramp = (param, v, t = 0.4) => { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(v, ctx.currentTime, t / 3); };
  function osc(type, f, g, dest, detune = 0) { const o = ctx.createOscillator(), a = ctx.createGain(); o.type = type; o.frequency.value = f; o.detune.value = detune; a.gain.value = g; o.connect(a); a.connect(dest); o.start(); return o; }
  function env(dest, f, type, peak, dur, attack = 0.01) {
    const o = ctx.createOscillator(), a = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.value = f; a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(peak, t + attack); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest); o.start(t); o.stop(t + dur + 0.1);
  }
  function pad(freqs, cutoff, dest, lfoHz = 0.07) {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff; f.Q.value = 2; f.connect(dest);
    const l = osc("sine", lfoHz, cutoff * 0.5, f.frequency); // slow breathing of the filter
    const nodes = [l];
    freqs.forEach(([hz, type, g], i) => { nodes.push(osc(type, hz, g, f), osc(type, hz, g * 0.6, f, i % 2 ? 7 : -7)); });
    return nodes;
  }
  function boom(dest) { const t = ctx.currentTime, o = ctx.createOscillator(), a = ctx.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 2); a.gain.setValueAtTime(0.6, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 2.6); o.connect(a); a.connect(dest); o.start(t); o.stop(t + 2.7); }
  function howl(dest) {
    const t = ctx.currentTime, o = ctx.createOscillator(), a = ctx.createGain(), f = ctx.createBiquadFilter(), v = ctx.createOscillator(), vg = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(640, t + 1.3); o.frequency.exponentialRampToValueAtTime(420, t + 3.2);
    v.frequency.value = 5.5; vg.gain.value = 14; v.connect(vg); vg.connect(o.frequency);
    f.type = "lowpass"; f.frequency.value = 1400;
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(0.09, t + 1.1); a.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    o.connect(f); f.connect(a); a.connect(dest); o.start(t); v.start(t); o.stop(t + 3.5); v.stop(t + 3.5);
  }
  function thump(dest, g = 0.5) { const t = ctx.currentTime, o = ctx.createOscillator(), a = ctx.createGain(); o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18); a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(a); a.connect(dest); o.start(t); o.stop(t + 0.35); }
  const every = (ms, fn, first = 0) => { timers.push(setTimeout(fn, first)); timers.push(setInterval(fn, ms)); };

  const MODES = {
    night(g) { const n = pad([[55, "sawtooth", 0.07], [82.4, "sawtooth", 0.05], [110, "triangle", 0.05], [130.8, "triangle", 0.035]], 360, g); every(7200, () => boom(g), 400); every(26000, () => howl(g), 5000); return n; },
    day(g) { const n = pad([[73.4, "triangle", 0.07], [110, "sine", 0.06], [146.8, "triangle", 0.045], [174.6, "sine", 0.035]], 1100, g, 0.05); const sc = [293.7, 349.2, 392, 440, 523.3, 587.3]; every(2600, () => env(g, sc[Math.floor(Math.random() * sc.length)], "triangle", 0.1, 1.6), 1500); return n; },
    vote(g) { const n = pad([[55, "sawtooth", 0.05], [77.8, "triangle", 0.05], [116.5, "triangle", 0.035]], 520, g, 0.12); n.push(osc("sine", 932, 0.012, g)); every(900, () => { thump(g, 0.55); setTimeout(() => thump(g, 0.35), 230); }); return n; },
    win(g) { const n = pad([[130.8, "triangle", 0.07], [164.8, "triangle", 0.06], [196, "sine", 0.06], [261.6, "sine", 0.05]], 2400, g, 0.04); [523, 659, 784, 1047].forEach((f, i) => timers.push(setTimeout(() => env(g, f, "sine", 0.1, 2.4), 400 + i * 350))); return n; },
    lose(g) { const n = pad([[65.4, "sawtooth", 0.06], [77.8, "sawtooth", 0.05], [138.6, "triangle", 0.05]], 300, g, 0.06); boom(g); every(9000, () => boom(g), 4000); return n; },
  };
  function stopCurrent() {
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = [];
    if (group) { const old = group; ramp(old.g.gain, 0, 2.5); setTimeout(() => { old.nodes.forEach((n) => { try { n.stop(); } catch {} }); try { old.g.disconnect(); } catch {} }, 3500); group = null; }
  }
  function play(m) {
    pending = m;
    if (!ctx) return;
    if (m === mode) return;
    stopCurrent(); mode = m;
    if (!m || !MODES[m]) return;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(bus); ramp(g.gain, 1, 2.5);
    const nodes = MODES[m](g);
    group = { g, nodes };
    if (m === "night") setTimeout(() => boom(g), 100);
  }
  function gong() {
    if (!ctx || !enabled) return;
    [70, 141, 212, 283].forEach((f, i) => env(bus, f, "sine", 0.32 / (i + 1), 4.5, 0.005));
  }
  function duck(on) { ducked = on; if (ctx) ramp(master.gain, level(), 0.4); }
  function toggle() { enabled = !enabled; store.set("ww-music", enabled); init(); if (ctx) ramp(master.gain, level(), 0.3); paint(); }
  function paint() { $("musicBtn").textContent = enabled ? t("musicOn") : t("musicOff"); }
  $("musicBtn").onclick = toggle; paint();
  return { init, play, gong, duck, paint };
})();
