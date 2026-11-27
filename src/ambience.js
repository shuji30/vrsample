import { audioContext, bus } from './mixer.js';

/**
 * 環境音（ROADMAP 6）。屋外の風・丘の上の遠い波・昼の小鳥・夕方のひぐらし・夜の虫。家の中ではこもって小さく。
 *
 * ほかの音と同じく、音のファイルは使わず、その場で作る（ノイズとサイン波）。音の入れ物（AudioContext）は
 * 最初の操作のあとでできるので、できるまでは毎フレームやり直す。
 *
 *   風       … 帯域を絞ったノイズ。十数秒の周期の突風で大きさと明るさが揺れる
 *   遠い波    … 低いノイズ。9 秒ごとに寄せる。崖の縁（北）に近いほど大きい。砂浜では鳴らさない（beach.js の波がある）
 *   小鳥（昼） … 数秒おきに、高い音のさえずり（さっと上がって下がる短い音を 2〜5 回）。左右のどこかから
 *   ひぐらし（夕方）… 10〜20 秒おきに「カナカナカナ…」（高い音を小刻みに揺らしながら、だんだん下がる）
 *   虫（夜）   … コオロギ：4.3kHz の音を、細かく刻んで鳴らしつづける
 */
export function createAmbience() {
  let ctx = null;
  let out = null;        // 家の中でこもらせる（ローパス）→ 環境音のバス
  let master = null;
  let wind = null;
  let waves = null;
  let crickets = null;
  let noise = null;

  function noiseBuffer(c, seconds = 4) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    // ピンクに近いノイズ（白いノイズより耳に柔らかい）
    let b0 = 0; let b1 = 0; let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    return buf;
  }

  function loopNoise(type, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    return { filter, gain };
  }

  function ensure() {
    if (ctx) return true;
    const c = audioContext();
    const target = c && bus('ambience');
    if (!c || !target) return false;
    ctx = c;
    noise = noiseBuffer(ctx);
    out = ctx.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 18000;
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(out).connect(target);
    wind = loopNoise('bandpass', 600, 0.6);
    waves = loopNoise('lowpass', 280, 0.7);
    // コオロギ：サイン波を、速い刻み（約 30 回 / 秒）と、ひと鳴き（0.3 秒）の 2 段で切る
    const osc = ctx.createOscillator();
    osc.frequency.value = 4300;
    const chirp = ctx.createGain();
    chirp.gain.value = 0;
    const gate = ctx.createOscillator();
    gate.type = 'square';
    gate.frequency.value = 30;
    const gateDepth = ctx.createGain();
    gateDepth.gain.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0;
    gate.connect(gateDepth).connect(chirp.gain);
    osc.connect(chirp).connect(level).connect(master);
    osc.start();
    gate.start();
    crickets = { chirp, level };
    return true;
  }

  /** 短い高い音を 1 つ（小鳥のさえずりの 1 音・ひぐらしの 1 音） */
  function tone(t, f0, f1, dur, gain, pan) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    o.connect(g);
    (p ? g.connect(p) : g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function birdSong() {
    const t = ctx.currentTime + 0.02;
    const pan = Math.random() * 1.6 - 0.8;
    const base = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const up = Math.random() < 0.5;
      tone(t + i * (0.09 + Math.random() * 0.05), base * (up ? 0.85 : 1.15), base * (up ? 1.2 : 0.8), 0.07 + Math.random() * 0.05, 0.05, pan);
    }
  }

  function higurashi() {
    const t = ctx.currentTime + 0.02;
    const pan = Math.random() * 1.4 - 0.7;
    // カナカナカナ…：だんだん低く、弱く
    const count = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const k = i / count;
      const f = 4600 - k * 700;
      tone(t + i * 0.14, f, f * 0.92, 0.12, 0.05 * (1 - k * 0.7), pan);
    }
  }

  let clock = 0;
  let nextBird = 2;
  let nextCicada = 4;
  let inside = 1;

  return {
    /**
     * 毎フレーム
     * @param {number} dt
     * @param {{ theme: string, inside: boolean, eye: {x:number,y:number,z:number}, cliffZ: number }} state
     */
    update(dt, { theme, inside: isInside, eye, cliffZ }) {
      if (!ensure()) return;
      clock += dt;
      const now = ctx.currentTime;
      // 家の中：こもらせて（800Hz より上を落とす）小さく
      inside += ((isInside ? 1 : 0) - inside) * Math.min(1, dt * 3);
      out.frequency.setTargetAtTime(18000 - inside * 17200, now, 0.15);
      master.gain.setTargetAtTime(0.9 - inside * 0.65, now, 0.15);

      const beach = eye.y < -8;
      // 風：突風（2 つの周期を重ねる）
      const gust = 0.5 + 0.3 * Math.sin(clock * 0.37) + 0.2 * Math.sin(clock * 0.11 + 1.3);
      wind.gain.gain.setTargetAtTime((beach ? 0.1 : 0.07) * (0.5 + gust), now, 0.4);
      wind.filter.frequency.setTargetAtTime(380 + gust * 520, now, 0.4);
      // 遠い波：崖の縁に近いほど大きい（丘の上だけ）
      const edge = Math.max(0, 1 - Math.max(0, eye.z - cliffZ) / 45);
      const swell = 0.55 + 0.45 * Math.sin((clock / 9) * Math.PI * 2);
      waves.gain.gain.setTargetAtTime(beach ? 0 : (0.05 + 0.2 * edge) * swell, now, 0.6);
      // 虫（夜）：ひと鳴き 0.3 秒・休み 0.2 秒くらいを、刻みの上に重ねる
      const night = theme === 'night';
      const on = night && (clock % 0.55) < 0.32;
      crickets.level.gain.setTargetAtTime(on ? 0.025 : 0, now, 0.02);
      // 小鳥（昼）・ひぐらし（夕方）
      if (clock > nextBird) {
        nextBird = clock + 1.5 + Math.random() * (theme === 'day' ? 4.5 : 12);
        if (theme === 'day' || (theme === 'sunset' && Math.random() < 0.3)) birdSong();
      }
      if (clock > nextCicada) {
        nextCicada = clock + 10 + Math.random() * 10;
        if (theme === 'sunset' && !beach) higurashi();
      }
    },
    /** 検証用 */
    get ready() { return Boolean(ctx); },
    get levels() { return ctx ? { master: master.gain.value, wind: wind.gain.gain.value, waves: waves.gain.gain.value, crickets: crickets.level.gain.value, lowpass: out.frequency.value } : null; },
  };
}
