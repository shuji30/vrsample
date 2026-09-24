import * as THREE from 'three';

/**
 * 女の子の声。
 *
 * ブラウザの音声合成（Web Speech API）で短い台詞をしゃべらせ、台詞の仮名の
 * 母音に合わせて口を動かす（VRM の aa / ih / ou / ee / oh）。頭の横に吹き出しも
 * 出すので、日本語の声が入っていない端末や、音を出せない場面でも伝わる。
 *
 * 声の種類は端末しだい。Windows の Edge なら Nanami（Natural）、Chrome なら
 * Google 日本語や Haruka / Ayumi、Mac なら Kyoko などが入っている。
 * 若い女性の自然な声を名前で選び、声ごとに高さと速さを合わせる。どの声も一律に
 * ピッチを上げると、自然な声（ニューラル音声）ほど機械っぽく割れて聞こえた。
 * V キーで入っている声を順に試せる（選んだ声は覚えておく）。
 *
 * 台詞は仮名で書く。口の形を母音から決めるためで、漢字だと読みが分からない。
 */

/** 場面ごとの台詞。同じ場面でも毎回違うものを選ぶ */
export const LINES = {
  playerCatch: ['ナイスキャッチ！', 'わぁ、じょうず！', 'やったね！', 'いいかんじ！', 'ばっちり！'],
  herCatch: ['とれたっ！', 'ナイスボール！', 'よしっ！', 'えへへ、とれた！'],
  fumble: ['あっ、ごめん！', 'わわっ！', 'おとしちゃった…'],
  playerMiss: ['ドンマイ！', 'ごめん、それちゃった！', 'あれれ？'],
  rally: ['{n}かい、つづいたね！', '{n}かい！すごいすごい！', 'れんぞく{n}かい！'],
  unreachable: ['とどかないよー', 'あそこにはいっちゃった…', 'とってきてー'],
  invite: ['ねえねえ、キャッチボールしよ！', 'おそとであそぼ！', 'まってー、いまいくね！'],
  goIn: ['またあそぼうね！', 'たのしかったね！'],
  wake: ['ふぁ…よくねた', 'んー…ねちゃってた', 'おはよ…'],
  greet: ['なあに？', 'どうしたの？', 'えへへ', 'いいてんきだね'],
  tennisInvite: ['テニスしよ！', 'わたしもラケットとってくるね！', 'テニス？やるやる！'],
  kartInvite: ['わたしもカートにのるね！', 'カート？まけないよー！', 'よーし、きょうそうだ！'],
  /** シーソー：乗りにいく / 座った / 自分の側が下りた・上がった / 高い / けってと言う */
  seesawInvite: ['シーソーしよ！', 'わたし、あっちにすわるね！'],
  seesawReady: ['いくよー！', 'せーの！'],
  seesawDown: ['ギッコン！', 'よいしょ！'],
  seesawUp: ['バッタン！', 'わーい！'],
  seesawHigh: ['たかーい！', 'きゃー、たのしい！'],
  seesawKick: ['じめんをけって！', 'そっちもけってー！'],
  /** ポケバイ：見にいく / ラップ（{n} は秒）/ ベスト / 応援 */
  bikeInvite: ['ポケバイ？みててあげる！', 'タイムはかってあげるね！', 'がんばってー！'],
  bikeLap: ['{n}びょう！', 'いまのは{n}びょう！'],
  bikeBest: ['ベストタイム！{n}びょう！', 'はやーい！{n}びょう！', 'きろくこうしん！{n}びょう！'],
  bikeCheer: ['がんばれー！', 'かっこいい！', 'はやいはやい！', 'きをつけてねー！'],
  /** レース：スタートの枠に並んだ / 合図 / 抜いた・抜かれた / 最後の周 / 結果 */
  raceGrid: ['スタートのところにならんでね！', 'はやくならんで！レースしよ！'],
  raceReady: ['いくよー！', 'じゅんびはいい？', 'よーい…'],
  raceGo: ['スタート！', 'それーっ！', 'いっくよー！'],
  racePass: ['おさきにー！', 'ぬいちゃった！', 'えへへ、まえにでたよ！'],
  raceOvertaken: ['あっ、ぬかれた！', 'まってー！', 'はやーい！'],
  raceLastLap: ['ラストいっしゅう！', 'あといっしゅうだよ！'],
  raceHerWin: ['やったー！わたしのかち！', 'いちばんだー！', 'かっちゃった！えへへ'],
  racePlayerWin: ['まけちゃった…つぎはまけないよ！', 'はやいねー！くやしい！', 'すごーい！いちばんだね！'],
  /** プレイヤーのいい球が入った */
  tennisNice: ['ナイスショット！', 'いいたま！', 'うまーい！', 'はやーい！'],
  /** 自分が打った（たまに） */
  tennisHit: ['えいっ！', 'それっ！', 'よいしょ！'],
  tennisRally: ['{n}かい、つづいたよ！', 'ラリー{n}かい！', '{n}かい！すごいすごい！'],
  /** プレイヤーの球がネット / アウト */
  tennisNet: ['あー、ネット！', 'おしいっ！', 'ネットだー'],
  tennisOut: ['アウトー！', 'ちょっとながかったね', 'おそとだよー'],
  /** 自分の球がネット / アウト */
  tennisMyNet: ['ごめん、ネットだー', 'あちゃー、かかっちゃった'],
  tennisMyOut: ['あっ、アウトだ…', 'ごめん、ながすぎた！'],
  /** 自分が届かなかった / プレイヤーが返せなかった */
  tennisMiss: ['とどかなかったー！', 'はやすぎるよー！', 'あーん、まけた！'],
  tennisPlayerMiss: ['ドンマイ！', 'もういっかい！', 'いまのはむずかしかったね'],
};

// --- 仮名 → 母音 -----------------------------------------------------------

const VOWEL_ROWS = {
  a: 'あかさたなはまやらわがざだばぱぁゃ',
  i: 'いきしちにひみりぎじぢびぴぃ',
  u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  e: 'えけせてねへめれげぜでべぺぇ',
  o: 'おこそとのほもよろをごぞどぼぽぉょ',
};
const VOWEL_OF = new Map();
for (const [v, chars] of Object.entries(VOWEL_ROWS)) for (const c of chars) VOWEL_OF.set(c, v);
const SMALL = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);

/** カタカナをひらがなへ */
const toHiragana = (c) => {
  const code = c.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
};

/** 口の形の重み。o や a は大きく、i や e は横に開く */
const SHAPE = {
  a: { aa: 0.85 },
  i: { ih: 0.7 },
  u: { ou: 0.7 },
  e: { ee: 0.7 },
  o: { oh: 0.8 },
  n: { ou: 0.18 },
};

/**
 * 台詞を拍（モーラ）の並びにする。1 拍 = { shape, length（拍の数） }。
 * 小さい ゃゅょ は前の拍にくっつけて母音だけ差し替える。ー は前の母音を伸ばす。
 * っ と句読点は口を閉じた間にする。
 */
export function toMorae(text) {
  const morae = [];
  for (const raw of text) {
    const c = toHiragana(raw);
    if (SMALL.has(c) && morae.length) {
      const last = morae[morae.length - 1];
      if (last.vowel) last.vowel = VOWEL_OF.get(c) ?? last.vowel;
      continue;
    }
    if (c === 'ー' && morae.length) { morae[morae.length - 1].length += 1; continue; }
    if (c === 'ん') { morae.push({ vowel: 'n', length: 1 }); continue; }
    if (c === 'っ') { morae.push({ vowel: null, length: 0.7 }); continue; }
    if ('、。！？!?…,. 　'.includes(c)) { morae.push({ vowel: null, length: c === '…' ? 2.2 : 1.4 }); continue; }
    const v = VOWEL_OF.get(c);
    // 漢字や記号は読みが分からないので「あ」の口にしておく
    morae.push({ vowel: v ?? 'a', length: 1 });
  }
  return morae;
}

// --- 吹き出し ----------------------------------------------------------------

function createBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.72, 0.225, 1);
  sprite.visible = false;
  sprite.renderOrder = 4;

  function draw(text) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(40, 40, 60, 0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(10, 10, canvas.width - 20, canvas.height - 44, 40);
    ctx.fill();
    ctx.stroke();
    // しっぽ（左下、女の子の顔のほうへ）
    ctx.beginPath();
    ctx.moveTo(70, canvas.height - 36);
    ctx.lineTo(44, canvas.height - 8);
    ctx.lineTo(110, canvas.height - 36);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#34303a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 60;
    ctx.font = `bold ${size}px sans-serif`;
    while (ctx.measureText(text).width > canvas.width - 70 && size > 30) {
      size -= 4;
      ctx.font = `bold ${size}px sans-serif`;
    }
    ctx.fillText(text, canvas.width / 2, (canvas.height - 34) / 2 + 6);
    texture.needsUpdate = true;
  }

  return { sprite, material, draw };
}

// --- 本体 --------------------------------------------------------------------

/** 1 拍の長さ（秒）。日本語の会話は 1 秒に 7〜8 拍 */
const MORA = 0.13;
/** 同じ場面の台詞を続けて言わない間（秒） */
const COOLDOWN = { default: 3, seesawDown: 5, seesawUp: 5, seesawHigh: 9, seesawKick: 8, bikeLap: 1, bikeBest: 1, racePass: 6, raceOvertaken: 6, raceGrid: 20, greet: 25, herCatch: 6, rally: 1, tennisHit: 8, tennisRally: 1, tennisNice: 5 };

/**
 * 声の選び方。名前に含まれる語で点をつける。
 *   自然な声（Natural / Online / Neural / Enhanced / Premium）を優先
 *   若い女性の声（Aoi / Mayu / Shiori / Nanami）を優先
 *   男性の声（Ichiro / Keita / Otoya / Hattori / Daichi / Naoki）は使わない
 */
function voiceScore(name) {
  let score = 0;
  if (/natural|online|neural|enhanced|premium/i.test(name)) score += 3;
  if (/aoi|mayu|shiori/i.test(name)) score += 3;
  if (/nanami/i.test(name)) score += 2;
  if (/haruka|ayumi|sayaka|kyoko|o-ren|mizuki|female|女性/i.test(name)) score += 1;
  if (/google/i.test(name)) score += 1.5;
  if (/ichiro|keita|otoya|hattori|daichi|naoki|male|男性/i.test(name) && !/female/i.test(name)) score -= 10;
  return score;
}

/**
 * 声ごとの高さ（pitch）と速さ（rate）。音声合成の pitch は 1 が既定で、上げすぎると
 * 声が割れて機械っぽくなる。自然な声は控えめに、昔からの合成音声は少し多めに上げる。
 * 子どもらしさは高さより、少し速めの話し方のほうが効く
 */
const VOICE_TUNING = {
  natural: { pitch: 1.18, rate: 1.1 },
  google: { pitch: 1.3, rate: 1.12 },
  classic: { pitch: 1.35, rate: 1.08 },
  default: { pitch: 1.3, rate: 1.08 },
};
function tuningFor(name) {
  const base = /natural|online|neural|enhanced|premium/i.test(name) ? VOICE_TUNING.natural
    : /google/i.test(name) ? VOICE_TUNING.google
      : /haruka|ayumi|sayaka|kyoko|o-ren|mizuki/i.test(name) ? VOICE_TUNING.classic
        : VOICE_TUNING.default;
  // URL で試せるように（?voicepitch=1.4&voicerate=1.1）
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const pitch = Number(params?.get('voicepitch'));
  const rate = Number(params?.get('voicerate'));
  return { pitch: pitch > 0 ? pitch : base.pitch, rate: rate > 0 ? rate : base.rate };
}

const clampNumber = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const VOICE_KEY = 'vrsample.voice';
function readSavedVoice() {
  try { return localStorage.getItem(VOICE_KEY); } catch { return null; }
}
function saveVoice(name) {
  try { localStorage.setItem(VOICE_KEY, name); } catch { /* 覚えられなくても続ける */ }
}

/**
 * @param {object} options
 * @param {ReturnType<import('./character.js').createCharacter>} options.character
 * @param {THREE.Scene} options.scene
 * @param {THREE.Camera} options.camera
 * @param {boolean} [options.muted] 声を出さない（吹き出しと口だけ）
 */
export function createVoice({ character, scene, camera, muted = false }) {
  const body = character.body;
  const synth = !muted && typeof window !== 'undefined' ? window.speechSynthesis ?? null : null;
  const bubble = createBubble();
  scene.add(bubble.sprite);

  let voice = null;
  let tuning = VOICE_TUNING.default;
  /** 日本語の声を、かわいく聞こえそうな順に並べたもの（男性の声は後ろへ） */
  function rankedVoices() {
    if (!synth) return [];
    const ja = synth.getVoices().filter((v) => /^ja/i.test(v.lang));
    return ja.map((v, i) => ({ v, score: voiceScore(v.name) - i * 0.01 }))
      .sort((a, b) => b.score - a.score)
      .map((e) => e.v);
  }
  function useVoice(v) {
    voice = v;
    tuning = tuningFor(v?.name ?? '');
  }
  /**
   * 声の状態。日本語の声が端末に無いときに、日本語以外の声（英語の声など）で
   * 読ませると、片言の外国語のように聞こえた。日本語の声が無ければ読み上げず、
   * 吹き出しと口の動きだけにして、開始画面で声の入れ方を知らせる（main.js）
   */
  let searched = false;       // 探し終えた（見つかった / 見つからないまま時間切れ）
  const statusListeners = [];
  const status = () => ({
    enabled: Boolean(synth),
    searching: Boolean(synth) && !voice && !searched,
    name: voice?.name ?? null,
    japanese: Boolean(voice),
  });
  const notify = () => { for (const fn of statusListeners) fn(status()); };
  function pickVoice() {
    const had = voice;
    const ranked = rankedVoices();
    const saved = readSavedVoice();
    useVoice(ranked.find((v) => v.name === saved) ?? ranked[0] ?? had ?? null);
    if (voice) searched = true;
    if (voice !== had) notify();
  }
  pickVoice();
  synth?.addEventListener?.('voiceschanged', pickVoice);
  // ブラウザは声の一覧をあとから読み込む（Chrome のネットの声、Edge の Natural など）。
  // voiceschanged が来ない端末もあるので、20 秒は 0.5 秒おきに見直す
  if (synth && !voice) {
    // 回数ではなく経過時間で区切る（重い端末ではタイマーが間引かれて、いつまでも終わらなかった）
    const started = performance.now();
    const timer = setInterval(() => {
      pickVoice();
      if (voice || performance.now() - started > 20000) {
        clearInterval(timer);
        searched = true;
        notify();
      }
    }, 500);
  }

  let morae = [];
  let moraIndex = 0;
  let moraTime = 0;
  let speaking = false;
  let showFor = 0;
  let clock = 0;
  const lastSaid = {};        // 場面ごとに最後にしゃべった時刻
  const lastLine = {};        // 場面ごとに最後の台詞（続けて同じのを選ばない）
  let prevState = '';
  let greetNear = false;

  /** 台詞を 1 つ言う。text はそのまま、kind は LINES から選ぶ */
  function speak(text) {
    morae = toMorae(text);
    moraIndex = 0;
    moraTime = 0;
    speaking = true;
    const duration = morae.reduce((t, m) => t + m.length * MORA, 0);
    showFor = duration + 1.4;
    bubble.draw(text);
    bubble.sprite.visible = true;

    // 日本語の声が無ければ読み上げない（外国語の声の片言になる）。吹き出しと口だけ
    if (synth && voice && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        // 声の指定だけ失敗しても（型の合わない声オブジェクトなど）、発声は続ける
        try { if (voice) u.voice = voice; } catch { /* 既定の声でしゃべる */ }
        // 声ごとの高さと速さに、台詞の気分をのせる。はずんだ台詞（！）は少し高く速く、
        // しょんぼりした台詞（…）は少し低くゆっくり
        const mood = /…|ごめん|あーん|まけた|おとしちゃった/.test(text) ? -1 : /！/.test(text) ? 1 : 0;
        u.pitch = clampNumber(tuning.pitch + mood * 0.06, 0.5, 2);
        u.rate = clampNumber(tuning.rate + mood * 0.04, 0.5, 2);
        u.volume = 1;
        synth.speak(u);
      } catch {
        // 音声合成が使えなくても、吹き出しと口の動きは続ける
      }
    }
  }

  /**
   * 場面に合った台詞を言う。直前に同じ場面でしゃべっていたら言わない。
   * @param {keyof typeof LINES} kind
   * @param {{ n?: number, chance?: number }} [options]
   */
  function say(kind, { n, chance = 1 } = {}) {
    const lines = LINES[kind];
    if (!lines || Math.random() > chance) return false;
    const wait = COOLDOWN[kind] ?? COOLDOWN.default;
    if (clock - (lastSaid[kind] ?? -Infinity) < wait) return false;
    // ほかの台詞をしゃべっている最中は、大事でない台詞は割り込まない
    if (speaking && (kind === 'greet' || kind === 'herCatch')) return false;
    const choices = lines.length > 1 ? lines.filter((l) => l !== lastLine[kind]) : lines;
    const line = choices[Math.floor(Math.random() * choices.length)];
    lastLine[kind] = line;
    lastSaid[kind] = clock;
    speak(line.replace('{n}', String(n ?? '')));
    return true;
  }

  const head = new THREE.Vector3();
  const eye = new THREE.Vector3();

  function update(dt) {
    clock += dt;

    // 口の動き。拍ごとに母音の形を入れ、拍の終わりで少し閉じる
    if (speaking) {
      moraTime += dt;
      while (moraIndex < morae.length && moraTime >= morae[moraIndex].length * MORA) {
        moraTime -= morae[moraIndex].length * MORA;
        moraIndex++;
      }
      if (moraIndex >= morae.length) {
        speaking = false;
        body.setMouth(null);
      } else {
        const m = morae[moraIndex];
        const u = moraTime / (m.length * MORA);
        // 1 拍のなかで開いて閉じる。伸ばす音（ー）は開いたまま
        const open = m.length > 1 ? Math.min(1, u * 4) : Math.sin(Math.PI * Math.min(1, u * 1.15));
        const shape = m.vowel ? SHAPE[m.vowel] : null;
        body.setMouth(shape ? Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v * (0.35 + 0.65 * open)])) : null);
      }
    }

    // 吹き出しは顔の横、少し上
    if (bubble.sprite.visible) {
      showFor -= dt;
      if (showFor <= 0) {
        bubble.sprite.visible = false;
      } else {
        bubble.material.opacity = Math.min(1, showFor / 0.4);
        const vrm = character.vrm;
        const node = vrm?.humanoid?.getNormalizedBoneNode('head');
        if (node) node.getWorldPosition(head);
        else head.copy(body.position).setY(body.headHeight);
        // 見ている人から見て右上に出す（顔に重ならないように）。遠いと読めないので、
        // 1.8m より遠ければ距離に合わせて大きくする（最大 4 倍。テニスではネットの
        // 向こう 12m 先にいる）。ずらす量も同じだけ広げて、頭の上のラリー表示と重ならないようにする
        camera.getWorldPosition(eye);
        const dx = head.x - eye.x;
        const dz = head.z - eye.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.min(4, Math.max(1, d / 1.8));
        bubble.sprite.scale.set(0.72 * k, 0.225 * k, 1);
        const side = 0.38 * k;
        bubble.sprite.position.set(head.x - (dz / d) * side, head.y + 0.05 + 0.1 * k, head.z + (dx / d) * side);
      }
    }

    // 室内の場面：昼寝から起きたとき、近くへ来て顔を見たとき
    const state = character.state;
    if (prevState === 'getUp' && state === 'sit') say('wake');
    prevState = state;
    if (!body.driven && body.loaded && state !== 'nap' && state !== 'lieDown') {
      camera.getWorldPosition(eye);
      const near = Math.hypot(eye.x - body.position.x, eye.z - body.position.z) < 1.3;
      if (near && !greetNear) say('greet', { chance: 0.7 });
      greetNear = near;
    }
  }

  return {
    say,
    speak,
    update,
    get speaking() { return speaking; },
    /**
     * 次の声に替えて、ひとこと言う（PC の V キー）。選んだ声は覚えておき、次に開いたときも使う。
     * 替えた声の名前を返す（声が 1 つも無ければ null）
     */
    cycleVoice() {
      const ranked = rankedVoices().filter((v) => voiceScore(v.name) > -5);
      if (ranked.length === 0) return null;
      const next = ranked[(ranked.indexOf(voice) + 1) % ranked.length];
      useVoice(next);
      saveVoice(next.name);
      notify();
      speak('このこえ、どうかな？');
      // 吹き出しには声の名前も出す（「Microsoft Nanami Online (Natural) - Japanese」なら Nanami）
      const short = next.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').split(/[\s(-]/)[0] || next.name;
      bubble.draw(`このこえ、どうかな？（${short}）`);
      return next.name;
    },
    /** 声の状態（{ enabled, searching, name, japanese }） */
    get status() { return status(); },
    /** 声の状態が変わったら呼ぶ（見つかった / 替えた / 探し終えた） */
    onStatus(fn) { statusListeners.push(fn); fn(status()); },
    /** 検証用 */
    get voiceName() { return voice?.name ?? null; },
    get voiceTuning() { return { ...tuning }; },
    bubble: bubble.sprite,
  };
}
