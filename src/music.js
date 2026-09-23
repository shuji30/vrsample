/**
 * BGM。外部の音源は使わず、WebAudio で曲を組み立てて鳴らす。
 *
 * 「庭で過ごす午後」を想定した、へ長調・76BPM のオルゴール風の曲。
 *   旋律   … ベル（正弦波に倍音を少し足し、すぐ減衰させる）
 *   伴奏   … 和音を 8 分音符で分散させたベル（小さく）
 *   パッド … 三角波を少しずらして重ね、ローパスで丸めた和音
 *   ベース … 正弦波で根音だけ
 * 8 小節ずつの A・B 2 部（約 50 秒）でループし、軽く残響をかける。
 *
 * 音を先に予約して鳴らす（先読みスケジューリング）。毎フレーム update() で
 * 0.3 秒先までの音を AudioContext の時計で予約するので、描画が少し
 * もたついても音はずれない。
 *
 * ブラウザはユーザーの操作があるまで音を出させないので、最初のクリック・
 * キー・VR 開始で AudioContext を作る（または再開する）。
 */

const BPM = 76;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// 和音（MIDI 番号）と、そのときのベースの根音
const CHORDS = {
  F: { notes: [53, 57, 60], bass: 41 },
  C: { notes: [52, 55, 60], bass: 36 },
  Dm: { notes: [50, 53, 57], bass: 38 },
  Bb: { notes: [50, 53, 58], bass: 46 },
  Gm: { notes: [50, 55, 58], bass: 43 },
  Am: { notes: [52, 57, 60], bass: 45 },
};

// 小節ごとの和音と旋律（[拍, MIDI, 長さ（拍）]）
const SONG = [
  // A
  ['F', [[0, 72, 1], [1, 69, 1], [2, 72, 1], [3, 74, 1]]],
  ['C', [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 2]]],
  ['Dm', [[0, 74, 1], [1, 72, 1], [2, 69, 1], [3, 72, 1]]],
  ['Bb', [[0, 70, 2], [2, 69, 1], [3, 67, 1]]],
  ['F', [[0, 69, 1], [1, 72, 1], [2, 77, 1.5], [3.5, 76, 0.5]]],
  ['Gm', [[0, 74, 1], [1, 70, 1], [2, 74, 1], [3, 76, 1]]],
  ['C', [[0, 77, 1], [1, 76, 1], [2, 74, 1], [3, 72, 1]]],
  ['C', [[0, 72, 3]]],
  // B
  ['Bb', [[0, 74, 1.5], [1.5, 72, 0.5], [2, 70, 2]]],
  ['C', [[0, 72, 1.5], [1.5, 70, 0.5], [2, 69, 2]]],
  ['Am', [[0, 69, 1], [1, 72, 1], [2, 76, 2]]],
  ['Dm', [[0, 74, 3], [3, 72, 1]]],
  ['Gm', [[0, 70, 1], [1, 74, 1], [2, 77, 1], [3, 76, 1]]],
  ['C', [[0, 74, 2], [2, 72, 1], [3, 70, 1]]],
  ['F', [[0, 69, 1], [1, 72, 1], [2, 77, 2]]],
  ['F', [[0, 77, 3]]],
];
export const SONG_SECONDS = SONG.length * BAR;

/** 分散和音の並び（和音の何番目を鳴らすか）。8 分音符 8 つで 1 小節 */
const ARPEGGIO = [0, 1, 2, 1, 0, 1, 2, 1];

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** 残響の響き（インパルス応答）。減衰するノイズで作る */
function makeImpulse(ctx, seconds = 2.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
  }
  return buffer;
}

/**
 * 曲そのもの。AudioContext（オフラインでもよい）と出力先を受け取り、
 * schedule(from, to) で [from, to) 秒（曲の頭からの時間）の音を予約する。
 * start は曲の頭に当たる AudioContext の時刻。
 */
export function createSong(ctx, destination, start = ctx.currentTime) {
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  dry.connect(destination);
  wet.connect(reverb).connect(destination);
  const bus = ctx.createGain();
  bus.connect(dry);
  bus.connect(wet);

  /** ベルの 1 音。基音に 2 倍・3 倍の倍音を少し足し、すぐに減衰させる */
  function bell(t, midi, beats, gain) {
    const f = midiToHz(midi);
    const env = ctx.createGain();
    const tail = beats * BEAT + 1.1;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    env.connect(bus);
    for (const [ratio, level] of [[1, 1], [2, 0.28], [3.01, 0.08]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + tail + 0.05);
    }
  }

  /** パッドの和音。ゆっくり立ち上がって、次の和音と重なりながら消える */
  function pad(t, notes, seconds, gain) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.6);
    env.gain.setValueAtTime(gain, t + seconds - 0.1);
    env.gain.linearRampToValueAtTime(0.0001, t + seconds + 0.8);
    filter.connect(env).connect(bus);
    for (const midi of notes) {
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiToHz(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + seconds + 0.9);
      }
    }
  }

  function bass(t, midi, seconds, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.04);
    env.gain.exponentialRampToValueAtTime(gain * 0.4, t + seconds * 0.8);
    env.gain.linearRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(bus);
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  }

  /** 曲の頭からの時刻 [from, to) にある音を予約する（ループをまたいでもよい） */
  function schedule(from, to) {
    // 小節単位で見ていく。ループの何周目かも含めた通し番号
    const firstBar = Math.floor(from / BAR);
    const lastBar = Math.floor(to / BAR);
    for (let n = firstBar; n <= lastBar; n++) {
      const [chordName, melody] = SONG[((n % SONG.length) + SONG.length) % SONG.length];
      const chord = CHORDS[chordName];
      const barTime = n * BAR;
      const events = [];
      events.push([barTime, () => pad(start + barTime, chord.notes, BAR, 0.035)]);
      events.push([barTime, () => bass(start + barTime, chord.bass, BAR, 0.075)]);
      ARPEGGIO.forEach((k, i) => {
        const t = barTime + i * BEAT * 0.5;
        events.push([t, () => bell(start + t, chord.notes[k] + 12, 0.5, 0.035)]);
      });
      for (const [beat, midi, beats] of melody) {
        const t = barTime + beat * BEAT;
        events.push([t, () => bell(start + t, midi, beats, 0.11)]);
      }
      for (const [t, play] of events) if (t >= from && t < to) play();
    }
  }

  return { schedule };
}

/**
 * 実際に鳴らす BGM。update(dt, { ducked }) を毎フレーム呼ぶ。
 * @param {{ volume?: number, enabled?: boolean }} options
 */
export function createMusic({ volume = 0.35, enabled = true } = {}) {
  let ctx = null;
  let master = null;
  let song = null;
  let songStart = 0;
  let scheduledUntil = 0;
  let on = enabled;
  const LOOKAHEAD = 0.3;

  /** ユーザー操作のあとで呼ぶ。AudioContext を作る / 再開する */
  function unlock() {
    if (!on) return;
    try {
      if (!ctx) {
        const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioContextClass) return;
        ctx = new AudioContextClass();
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
        song = createSong(ctx, master, ctx.currentTime + 0.1);
        songStart = ctx.currentTime + 0.1;
        scheduledUntil = 0;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {
      // 音が出せない環境でも、ほかは止めない
    }
  }

  const events = ['pointerdown', 'keydown', 'touchstart'];
  for (const name of events) window.addEventListener(name, unlock, { passive: true });

  function update(dt, { ducked = false } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime - songStart;
    // 0.3 秒先まで予約する。止めているあいだは予約しない（再開は今の位置から）
    if (on) {
      if (scheduledUntil < now) scheduledUntil = now;
      const until = now + LOOKAHEAD;
      if (until > scheduledUntil) {
        song.schedule(scheduledUntil, until);
        scheduledUntil = until;
      }
    }
    // しゃべっているあいだは下げる。オンオフもここでなめらかに
    const target = on ? volume * (ducked ? 0.35 : 1) : 0;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  }

  return {
    unlock,
    update,
    /** オン / オフを切り替える。オンにしたときは操作の中から呼ばれるので、ここで鳴らし始められる */
    toggle() {
      on = !on;
      if (on) unlock();
      return on;
    },
    get on() { return on; },
    /** 検証用 */
    get context() { return ctx; },
    get level() { return master ? master.gain.value : 0; },
  };
}
