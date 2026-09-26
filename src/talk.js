import * as THREE from 'three';

/**
 * 女の子との会話（座って並んだとき・向かい合ったとき）。選ぶ形の会話。
 *
 * - 話題を 3 つ出す（その場所・夜かどうかに合うもの。さっき話したものは出さない）。選ぶとプレイヤーの言葉が出て、
 *   女の子が答える（声と吹き出し。台詞は voice.js の LINES の talk*）
 * - ときどき（2 回に 1 回くらい）女の子のほうから聞いてくる。答えを 3 つから選ぶと、女の子が返事をする
 * - 4 つめはいつも「そろそろいこうか」（立つ。E と同じ）
 * - 選ばずに 30 秒たつと、女の子がひとりごとを言う（その場所の台詞）
 *
 * 選び方：PC は 1〜4 キーか、画面の下の札をクリック。パッドは十字キーの左・下・右で 1〜3。
 * VR は目の前の札をレーザーで指してトリガー（座っているあいだも、この札だけは指せる）。
 */

/** プレイヤーから聞く話題。where は出す場所（無ければどこでも）、night は夜だけ */
const TOPICS = [
  { id: 'today', q: 'きょう、なにしてた？', key: 'talkToday' },
  { id: 'food', q: '好きな食べものは？', key: 'talkFood' },
  { id: 'play', q: '好きな遊びは？', key: 'talkPlay' },
  { id: 'corgi', q: 'こむぎって、かわいいね', key: 'talkCorgi', smile: true },
  { id: 'thanks', q: 'いつもありがとう', key: 'talkThanks', smile: true },
  { id: 'sleepy', q: '眠くない？', key: 'talkSleepy' },
  { id: 'dream', q: '夢ってある？', key: 'talkDream' },
  { id: 'story', q: 'なにか話して', key: 'talkStory' },
  { id: 'hungry', q: 'おなかすいた？', key: 'talkHungry', where: ['house'] },
  { id: 'room', q: 'この部屋、好き？', key: 'talkRoom', where: ['house'] },
  { id: 'garden', q: 'いい庭だね', key: 'talkGarden', where: ['garden'] },
  { id: 'sea', q: '海、きれいだね', key: 'talkSea', where: ['beach'], smile: true },
  { id: 'swim', q: '泳ぐ？', key: 'talkSwim', where: ['beach'] },
  { id: 'stars', q: '星、きれいだね', key: 'talkStars', night: true, smile: true },
];

/** 女の子から聞いてくること。answers は [プレイヤーの答え, 女の子の返事の台詞, 笑う？] */
const ASKS = [
  { id: 'seaMountain', key: 'talkAskSeaMountain', answers: [['海', 'talkLikeSea', true], ['山', 'talkLikeMountain'], ['どっちも', 'talkLikeBoth', true]] },
  { id: 'next', key: 'talkAskNext', answers: [['テニス', 'talkNextTennis'], ['カート', 'talkNextKart'], ['観覧車', 'talkNextFerris', true]] },
  { id: 'me', key: 'talkAskMe', answers: [['かわいい', 'talkMeCute', true], ['いっしょだと楽しい', 'talkMeFun', true], ['ないしょ', 'talkMeSecret']] },
  { id: 'fun', key: 'talkAskFun', answers: [['楽しかった', 'talkFunYes', true], ['まあまあ', 'talkFunSoSo'], ['これから', 'talkFunLater']] },
  { id: 'sweet', key: 'talkAskSweet', answers: [['甘いもの', 'talkSweetYes', true], ['しょっぱいもの', 'talkSweetNo'], ['どっちも', 'talkSweetBoth']] },
];
const LEAVE = 'そろそろいこうか（立つ）';

export function createTalk({ voice = null, body = null, interactables = null }) {
  let picks = interactables;
  let active = false;
  let where = 'house';
  let night = false;
  let phase = 'off';          // off / wait（女の子が話し終えるのを待つ）/ choose（選ぶ）
  let waitFor = 0;
  let options = [];           // [{ text, key, smile }]
  let asking = null;          // 女の子が聞いていること
  let said = '';              // いまのプレイヤーの言葉
  let idleFor = 0;
  let turns = 0;
  let recent = [];
  let pending = null;         // 選んだあと、少しおいてから女の子が答える
  let onLeave = null;
  const log = [];

  // --- PC の札 ---
  let panel = null;
  function pcPanel() {
    if (panel || typeof document === 'undefined') return panel;
    panel = document.createElement('div');
    panel.id = 'talk';
    // 右下に小さく（真ん中に置くと、隣や向かいの女の子が隠れる）
    panel.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:25;display:none;'
      + 'width:min(270px,70vw);padding:8px 10px;background:rgba(18,22,34,.78);color:#fff;border-radius:12px;'
      + 'font:600 13px/1.45 sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.3)';
    document.body.appendChild(panel);
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => {
      const b = e.target.closest?.('button[data-i]');
      if (b) choose(Number(b.dataset.i));
    });
    return panel;
  }

  // --- VR の札（目の前、胸の下あたり） ---
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = 512; canvas.height = 288; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const vrPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.225), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: true }));
  vrPanel.name = 'talkPanel';
  vrPanel.visible = false;
  vrPanel.renderOrder = 5;
  vrPanel.userData.interactive = true;
  vrPanel.userData.seatedSelect = true;
  vrPanel.userData.onSelectHit = (hit) => {
    if (!vrPanel.visible || !hit?.uv) return;
    const row = Math.floor((1 - hit.uv.y) * canvas.height);
    const i = Math.floor((row - 70) / 54);
    if (i >= 0 && i < options.length + 1) choose(i);
  };
  function setVrPick(on) {
    if (!picks) return;
    const at = picks.indexOf(vrPanel);
    if (on && at < 0) picks.push(vrPanel);
    if (!on && at >= 0) picks.splice(at, 1);
  }

  function rows() { return [...options.map((o) => o.text), LEAVE]; }

  function draw() {
    const list = phase === 'choose' ? rows() : [];
    const head = said ? `あなた「${said}」` : (phase === 'choose' ? (asking ? '女の子が聞いています' : 'なにを話す？') : '…');
    const p = pcPanel();
    if (p) {
      p.innerHTML = `<div style="opacity:.85;margin:0 2px 6px">${head}</div>`
        + list.map((t, i) => `<button data-i="${i}" style="display:block;width:100%;text-align:left;margin:3px 0;padding:4px 8px;border:0;border-radius:7px;background:${i === list.length - 1 ? '#3a4152' : '#2d6fd8'};color:#fff;font:600 13px/1.4 sans-serif;cursor:pointer">${i + 1}　${t}</button>`).join('')
        + `<div style="opacity:.6;font-size:11px;margin-top:3px">1〜4 キー・クリック・十字キーで選ぶ／A・D 見まわす／E 立つ</div>`;
    }
    if (canvas) {
      const c = canvas.getContext('2d');
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = 'rgba(18,22,34,0.86)';
      c.beginPath();
      c.roundRect?.(0, 0, canvas.width, canvas.height, 24);
      if (!c.roundRect) c.rect(0, 0, canvas.width, canvas.height);
      c.fill();
      c.fillStyle = '#ffffff';
      c.font = 'bold 26px sans-serif';
      c.textBaseline = 'middle';
      c.fillText(head.length > 18 ? `${head.slice(0, 18)}…` : head, 22, 38);
      list.forEach((t, i) => {
        const y = 70 + i * 54;
        c.fillStyle = i === list.length - 1 ? '#3a4152' : '#2d6fd8';
        c.beginPath();
        c.roundRect?.(14, y + 4, canvas.width - 28, 46, 12);
        if (!c.roundRect) c.rect(14, y + 4, canvas.width - 28, 46);
        c.fill();
        c.fillStyle = '#ffffff';
        c.font = 'bold 25px sans-serif';
        c.fillText(`${i + 1}  ${t}`, 30, y + 28);
      });
      tex.needsUpdate = true;
    }
  }

  function fits(t) {
    if (t.where && !t.where.includes(where)) return false;
    if (t.night && !night) return false;
    return !recent.includes(t.id);
  }

  function offer() {
    said = '';
    asking = null;
    const asks = ASKS.filter((a) => !recent.includes(a.id));
    if (turns >= 1 && asks.length && Math.random() < 0.45) {
      asking = asks[Math.floor(Math.random() * asks.length)];
      recent.push(asking.id);
      voice?.say(asking.key);
      options = asking.answers.map(([text, key, smile]) => ({ text, key, smile: Boolean(smile) }));
      log.push(`ask:${asking.id}`);
    } else {
      let pool = TOPICS.filter(fits);
      if (pool.length < 3) { recent = recent.slice(-2); pool = TOPICS.filter(fits); }
      // その場所だけの話題を先に
      pool.sort(() => Math.random() - 0.5);
      pool.sort((a, b) => (b.where || b.night ? 1 : 0) - (a.where || a.night ? 1 : 0));
      const pick = [pool[0], ...pool.slice(1).sort(() => Math.random() - 0.5)].slice(0, 3);
      options = pick.map((t) => ({ text: t.q, key: t.key, smile: Boolean(t.smile), id: t.id }));
    }
    if (recent.length > 8) recent = recent.slice(-8);
    phase = 'choose';
    idleFor = 0;
    draw();
  }

  /** i 番め（0 から）を選ぶ。最後（options の数）は「立つ」 */
  function choose(i) {
    if (!active || phase !== 'choose') return false;
    if (i === options.length) { log.push('leave'); onLeave?.(); return true; }
    const o = options[i];
    if (!o) return false;
    said = o.text;
    if (o.id) recent.push(o.id);
    log.push(`choose:${o.key}`);
    phase = 'wait';
    pending = { key: o.key, smile: o.smile, in: 0.6 };
    waitFor = 2.2;
    turns++;
    draw();
    return true;
  }

  function update(dt) {
    if (!active) return;
    if (pending) {
      pending.in -= dt;
      if (pending.in <= 0) {
        voice?.say(pending.key);
        if (pending.smile) body?.smile?.(2.5, 1);
        pending = null;
      }
      return;
    }
    if (phase === 'wait') {
      waitFor -= dt;
      // 声が止まらないときも、8 秒で次へ
      if (waitFor <= 0 && (!voice?.speaking || waitFor < -8)) offer();
    } else if (phase === 'choose') {
      idleFor += dt;
      if (idleFor > 30) {
        idleFor = 0;
        voice?.say(where === 'beach' ? 'talkIdleBeach' : 'talkIdle');
      }
    }
  }

  /** 座って話しはじめる（女の子が座ったとき）。VR の札は、目 eye の前（向き yaw）に置く */
  function open(opts) {
    where = opts.where;
    night = Boolean(opts.night);
    active = true;
    turns = 0;
    said = '';
    pending = null;
    phase = 'wait';
    waitFor = 2.0;
    const p = pcPanel();
    if (p && !opts.xr) p.style.display = '';
    draw();
  }
  /** VR の札を置く（毎フレーム。頭の前、下のほう） */
  function placeVr(eye, yaw, xr) {
    if (xr && panel) panel.style.display = 'none';
    // 選ぶときだけ出す（女の子が話しているあいだは、吹き出しと声だけ）
    const show = active && xr && phase === 'choose';
    vrPanel.visible = show;
    setVrPick(show);
    if (!xr && panel && active) panel.style.display = '';   // VR を出たら PC の札に戻す
    if (!show) return;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // 目から 55cm 前・34cm 下（首を 30° ほど下へ向けると見える。食卓の上面より上）
    vrPanel.position.set(eye.x + fx * 0.55, eye.y - 0.34, eye.z + fz * 0.55);
    vrPanel.lookAt(eye.x, eye.y, eye.z);
  }
  function close() {
    if (!active) return;
    active = false;
    phase = 'off';
    options = [];
    pending = null;
    vrPanel.visible = false;
    setVrPick(false);
    if (panel) panel.style.display = 'none';
  }

  // PC のキー（1〜4）。パッドの十字キーは gamepad.js が Digit1〜3 のキーにする
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (!active || e.repeat) return;
      const m = /^Digit([1-4])$/.exec(e.code);
      if (m) choose(Number(m[1]) - 1);
    });
  }

  return {
    open,
    close,
    update,
    choose,
    placeVr,
    vrPanel,
    set onLeave(fn) { onLeave = fn; },
    /** VR のレーザーで指せる物の表（world.interactables）。札を出しているあいだだけ入れる */
    set interactables(list) { picks = list; },
    get active() { return active; },
    get phase() { return phase; },
    get options() { return rows(); },
    get asking() { return asking?.id ?? null; },
    get log() { return log; },
  };
}
