/**
 * 足音の合成。
 *
 * 外部アセットを持たない方針なので、音もコードで作る。木の床を踏んだ音は
 * ざっくり 3 つの成分でできている。
 *
 * 1. 打撃  … 低い正弦波の一撃。床板そのものが鳴る「ドッ」
 * 2. 減衰ノイズ … ローパスした広帯域ノイズ。靴底と板が当たる「タッ」
 * 3. 擦れ  … 高めの帯域をごく小さく。重心が移るときの「シュッ」
 *
 * これを 1 歩ごとに少しずつ変えて鳴らす。まったく同じ音が続くと、
 * 逆に「録音を貼っている」感じになって不自然になる。
 */

const NOISE_SECONDS = 0.4;

export function createFootsteps({ muted = false, volume = 0.5 } = {}) {
  let context = null;
  let noiseBuffer = null;
  let master = null;

  /** AudioContext はユーザー操作のあとでないと鳴らないので、最初の 1 歩で作る。 */
  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;

    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);

    // ホワイトノイズは 1 本作って使い回す。毎回作ると歩くたびに GC が走る。
    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * NOISE_SECONDS), context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    return context;
  }

  /** 減衰するノイズを 1 発鳴らす。 */
  function burst(now, { type, frequency, Q, gain, attack, decay, offset = 0 }) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    // 毎回違うところから読むと、同じ音の繰り返しに聞こえない
    source.playbackRate.value = 0.9 + Math.random() * 0.25;

    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;

    const envelope = context.createGain();
    const start = now + offset;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

    source.connect(filter).connect(envelope).connect(master);
    source.start(start, Math.random() * (NOISE_SECONDS - 0.2));
    source.stop(start + attack + decay + 0.02);
  }

  /** 床板が鳴る低い一撃。 */
  function thump(now, { frequency, gain, decay }) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    // わずかに下がると「詰まった」打撃に聞こえる
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.7, now + decay);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    oscillator.connect(envelope).connect(master);
    oscillator.start(now);
    oscillator.stop(now + decay + 0.02);
  }

  /**
   * 1 歩ぶん鳴らす。
   * @param {number} [intensity] 0〜1。歩く速さに応じて小さくする
   */
  function step(intensity = 1) {
    if (muted || !ensureContext()) return;
    if (context.state === 'suspended') context.resume();

    const now = context.currentTime;
    const strength = Math.max(0.15, Math.min(1, intensity));
    const variation = 0.85 + Math.random() * 0.3;

    thump(now, {
      frequency: 78 + Math.random() * 26,
      gain: 0.36 * strength * variation,
      decay: 0.075 + Math.random() * 0.03,
    });

    burst(now, {
      type: 'lowpass',
      frequency: 620 + Math.random() * 380,
      Q: 1.1,
      gain: 0.30 * strength * variation,
      attack: 0.003,
      decay: 0.085 + Math.random() * 0.04,
    });

    // 擦れはごく小さく、わずかに遅らせる。重心が移る間合いが出る
    burst(now, {
      type: 'bandpass',
      frequency: 2600 + Math.random() * 1400,
      Q: 0.8,
      gain: 0.07 * strength,
      attack: 0.004,
      decay: 0.05 + Math.random() * 0.03,
      offset: 0.012 + Math.random() * 0.012,
    });
  }

  return {
    step,
    setMuted(value) { muted = value; },
    get muted() { return muted; },
  };
}

/**
 * 球が当たる音。ラケットで打った「ポコン」、弾んだ「トン」、ネットの「バサッ」。
 *
 * ラケットの音は、張った弦が鳴る 500〜600Hz あたりの短い響きと、フェルトの
 * 球がつぶれる「ポッ」というノイズの組み合わせ。足音と同じく、毎回少しずつ
 * 変えて鳴らす。AudioContext は最初に鳴らすときに作る（ユーザー操作のあと）。
 */
export function createImpactSound({ muted = false, volume = 0.6 } = {}) {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensureContext() {
    if (context) return context;
    // 操作の前に作ると、止まったままの AudioContext ができて警告が出る
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);
    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.2), context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function tone(now, frequency, gain, decay, type = 'sine') {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.85, now + decay);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    oscillator.connect(envelope).connect(master);
    oscillator.start(now);
    oscillator.stop(now + decay + 0.02);
  }

  function noise(now, frequency, Q, gain, decay) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = Q;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    source.connect(filter).connect(envelope).connect(master);
    source.start(now);
    source.stop(now + decay + 0.02);
  }

  /**
   * @param {'racket' | 'bounce' | 'net'} kind
   * @param {number} strength 0〜1
   */
  function play(kind, strength = 1) {
    if (muted || strength < 0.02 || !ensureContext()) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    if (context.state !== 'running') return;
    const now = context.currentTime;
    const s = Math.min(1, strength);
    const vary = 0.92 + Math.random() * 0.16;
    if (kind === 'racket') {
      tone(now, 560 * vary, 0.35 * s, 0.09, 'triangle');
      tone(now, 1180 * vary, 0.12 * s, 0.05);
      noise(now, 1800 * vary, 1.2, 0.5 * s, 0.035);
    } else if (kind === 'bounce') {
      tone(now, 210 * vary, 0.3 * s, 0.07);
      noise(now, 900 * vary, 1.0, 0.25 * s, 0.03);
    } else {
      noise(now, 700 * vary, 0.6, 0.3 * s, 0.12);
    }
  }

  return {
    play,
    setMuted(value) { muted = value; },
  };
}

/**
 * カートのエンジン音。のこぎり波と矩形波を少しずらして重ね、ローパスで丸める。
 * 回転（rpm 0..1）で高さとこもり具合、アクセルで大きさを変える。
 */
export function createEngineSound({ volume = 0.5 } = {}) {
  let context = null;
  let nodes = null;

  function ensure() {
    if (context) return context;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { context = new AudioContextClass(); } catch { return null; }
    return context;
  }

  return {
    start() {
      if (nodes || !ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.connect(master);
      const a = context.createOscillator();
      a.type = 'sawtooth';
      const b = context.createOscillator();
      b.type = 'square';
      const bGain = context.createGain();
      bGain.gain.value = 0.35;
      a.connect(filter);
      b.connect(bGain).connect(filter);
      a.start();
      b.start();
      nodes = { master, filter, a, b };
    },
    /** @param {number} rpm 0..1  @param {number} throttle 0..1 */
    update(rpm, throttle) {
      if (!nodes) return;
      const now = context.currentTime;
      const f = 38 + rpm * 110;
      nodes.a.frequency.setTargetAtTime(f, now, 0.05);
      nodes.b.frequency.setTargetAtTime(f * 1.51, now, 0.05);
      nodes.filter.frequency.setTargetAtTime(500 + rpm * 1600 + throttle * 400, now, 0.05);
      nodes.master.gain.setTargetAtTime(volume * (0.05 + throttle * 0.06 + rpm * 0.04), now, 0.08);
    },
    stop() {
      if (!nodes) return;
      const n = nodes;
      nodes = null;
      n.master.gain.setTargetAtTime(0, context.currentTime, 0.1);
      setTimeout(() => { try { n.a.stop(); n.b.stop(); n.master.disconnect(); } catch { /* 止まっている */ } }, 600);
    },
  };
}

/**
 * レースのスタートの合図の音（ピッ・ピッ・ピッ・ポーン）。beep(high) で 1 回鳴らす。
 * high は緑になったときの高い長い音。AudioContext はユーザー操作のあとに作る。
 */
export function createSignalSound({ volume = 0.35 } = {}) {
  let context = null;
  function ensure() {
    if (context) return context;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { context = new AudioContextClass(); } catch { return null; }
    return context;
  }
  return {
    beep(high = false) {
      if (!ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      const now = context.currentTime;
      const length = high ? 0.7 : 0.18;
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = high ? 1320 : 660;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.01);
      gain.gain.setValueAtTime(volume, now + length - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + length);
      osc.connect(gain).connect(context.destination);
      osc.start(now);
      osc.stop(now + length + 0.02);
    },
  };
}
