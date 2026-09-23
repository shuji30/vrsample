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
