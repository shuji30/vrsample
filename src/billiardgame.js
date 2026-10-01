import * as THREE from 'three';
import { ROOM, ANNEX, EAST_DOOR } from './room.js';
import { gardenPath } from './catchball.js';
import { BALL_R, TABLE, POCKETS, HEAD_SPOT, tableToWorld, detourAnnex, HOUSE_EAST } from './billiards.js';
import { girlName, escapeHtml, onGirlNameChange } from './girlname.js';

/**
 * ビリヤード（ナインボール・かんたんルール）を女の子と交互に。
 *
 * 流れ：プレイヤーがビリヤードの部屋に入ると、女の子が来る（本の部屋から東の壁の出入り口を通って）。
 * はじめはプレイヤーのブレイク。球が止まったら次の番：
 *   - 手球以外を落とした → 同じ人がもう一度
 *   - 手球を落とした（スクラッチ）→ 相手の番。手球はヘッドスポットへ（9 番も一緒に落ちたら 9 番は戻す）
 *   - 9 番を落とした（スクラッチでない）→ 落とした人の勝ち。6 秒後に並べ直して、負けた人のブレイクでもう一回
 *   - どれも落ちない → 相手の番
 * 部屋を出て 4 秒たつと終わり（女の子はほかの遊びへ）。
 *
 * プレイヤーの突き方
 *   - PC：自分の番になると、視点が手球の後ろ（台の上 0.42m）へ。ドラッグで回して狙う（視点 → 手球の向き）。
 *     スペースを押しているあいだ力をため（1.2 秒で最大）、離すと突く。狙いの線と、最初に当たる球の位置（うすい輪）を出す
 *   - VR：右手にキュー。左手を右手の前（80cm 以内）に出すと、キューは右手 → 左手の向き（左手がブリッジ）。
 *     出さなければコントローラーの前へ。キューの先が手球に前向きに当たると、その速さで突く（0.2〜7m/s）
 * 女の子
 *   - 狙い：落とせる球とポケットの組を全部見て（手球 → 当てる所、的球 → ポケットの道に、ほかの球が無い）、
 *     切れ角・距離・立てる所で点をつけ、いちばん良いものを選ぶ。当てる所は「的球からポケットと反対へ 2R」。
 *     少しだけ狙いがずれる（標準 0.9°）。無ければ、いちばん近い球へまっすぐ
 *   - 立つ所：手球から狙いと反対へたどって、台の外（木枠から 0.3m）。壁に近すぎれば、少し横へずらす
 *   - かまえ：前へかがみ（setBend）、左手は手球の 22cm 手前の羅紗の上（ブリッジ）、右手はキューの後ろを持つ。
 *     2 回素振りしてから、引いて突く
 */
const WALK = 1.3;
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const CUE_LEN = 1.45;
const L = TABLE.halfL;
const Wd = TABLE.halfW;
const RAIL_OUT = TABLE.rail + 0.3;
const STAND_SIDE = 0.17;
const STAND_OUT = 0.17;
const inAnnex = (x, z) => x > ANNEX.minX && x < ANNEX.maxX && z > ANNEX.minZ && z < ANNEX.maxZ;

function makeCue() {
  const g = new THREE.Group();
  // 先（+Y の端 = 0）から後ろ（-Y）へ。先は細く、後ろは太い
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0145, CUE_LEN, 12), new THREE.MeshStandardMaterial({ color: 0xe2c79a, roughness: 0.45 }));
  shaft.position.y = -CUE_LEN / 2;
  g.add(shaft);
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0142, 0.0152, 0.42, 12), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.5 }));
  butt.position.y = -CUE_LEN + 0.21;
  g.add(butt);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0066, 0.0066, 0.012, 10), new THREE.MeshStandardMaterial({ color: 0x3a6fb0, roughness: 0.8 }));
  tip.position.y = -0.006;
  g.add(tip);
  g.visible = false;
  return g;
}

export function createBilliardGame({ character, billiards, voice = null, scene, camera = null, playerHead }) {
  const body = character.body;
  const B = billiards;
  let controllers = null;
  let desktop = null;
  let isXR = () => false;
  let state = 'off';          // off / waitStand / toTable / play
  let turn = 'player';        // player / girl
  let phase = 'aim';          // aim / rolling / over
  let breaker = 'player';
  let breakShot = true;
  let playerHere = false;
  let awayFor = 0;
  let onFinish = null;
  let timer = 0;
  let wins = { player: 0, girl: 0 };
  let message = '';
  let path = [];
  let girlStep = 'walk';      // walk / address / stroke / back / through / watch
  let girlShot = null;        // { dirX, dirZ, speed, stand }
  let charge = 0;
  let charging = false;
  let pcTurnSet = false;
  let rollingFor = 0;
  let approached = false;
  let shooter = 'player';
  const driver = { get state() { return `billiards:${state}:${phase}:${turn}`; } };
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const qa = new THREE.Quaternion();

  // --- 道具と表示 ------------------------------------------------------------
  const playerCue = makeCue();
  const girlCue = makeCue();
  scene.add(playerCue, girlCue);
  // 狙いの線（PC）と、最初に当たる所のうすい輪
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  aimLine.visible = false;
  aimLine.renderOrder = 3;
  scene.add(aimLine);
  const ghost = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.85, BALL_R, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ghost.rotation.x = -Math.PI / 2;
  ghost.visible = false;
  scene.add(ghost);
  // VR でも見える板（北の壁の東寄り）
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 256;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
  board.position.set(ANNEX.maxX - 1.0, 1.65, ANNEX.minZ + 0.02);
  scene.add(board);
  // PC の表示（画面の上の真ん中）
  const hud = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (hud) {
    hud.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;background:rgba(16,20,28,.8);color:#fff;font:600 14px/1.5 sans-serif;border-radius:8px;z-index:15;pointer-events:none;display:none;text-align:center';
    document.body.appendChild(hud);
  }
  const remaining = () => B.balls.filter((b) => b.n > 0 && !b.pocketed).map((b) => b.n);
  const lowest = () => Math.min(...remaining());

  function drawBoard() {
    const c = boardCanvas.getContext('2d');
    c.fillStyle = '#10261a';
    c.fillRect(0, 0, 512, 256);
    c.strokeStyle = '#c9a86a';
    c.lineWidth = 8;
    c.strokeRect(4, 4, 504, 248);
    c.fillStyle = '#f2ead8';
    c.font = 'bold 30px sans-serif';
    c.textAlign = 'center';
    c.fillText('ナインボール', 256, 44);
    c.font = 'bold 26px sans-serif';
    c.fillText(`あなた ${wins.player}  -  ${wins.girl} ${girlName()}`, 256, 86, 480);
    c.fillStyle = '#ffd24a';
    c.fillText(message || (turn === 'player' ? 'あなたの番' : `${girlName()}の番`), 256, 128, 480);
    // 残っている球
    const left = remaining();
    left.forEach((n, i) => {
      const x = 256 + (i - (left.length - 1) / 2) * 44;
      c.fillStyle = ['#f7f4ea', '#f2c21b', '#1d4fbf', '#d22b25', '#6a2c91', '#ef7a1a', '#11834a', '#7a1e1e', '#141414', '#f2c21b'][n];
      c.beginPath();
      c.arc(x, 188, 18, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, 188, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#111';
      c.font = 'bold 13px sans-serif';
      c.fillText(String(n), x, 193);
    });
    boardTex.needsUpdate = true;
  }
  function showHud(extra = '') {
    if (!hud) return;
    const whose = phase === 'over' ? message : phase === 'rolling' ? '球が転がっています' : turn === 'player' ? (breakShot ? 'あなたのブレイク' : 'あなたの番') : `${girlName()}の番`;
    hud.innerHTML = `ビリヤード（ナインボール）　${escapeHtml(whose)}　<span style="opacity:.8">あなた ${wins.player} - ${wins.girl} ${escapeHtml(girlName())}</span>`
      + `<br><span style="font-weight:400;font-size:12px">のこり：${remaining().join(' ')}　${isXR() ? '' : 'ドラッグで狙う・スペース長押しで力をためて離す'}</span>${extra}`;
    hud.style.display = '';
  }

  // --- 始める / 終わる ----------------------------------------------------------
  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    B.rack();
    turn = breaker = 'player';
    breakShot = true;
    phase = 'aim';
    pcTurnSet = false;
    message = '';
    drawBoard();
  }
  onGirlNameChange(() => drawBoard());
  function finish() {
    body.reachHands(null);
    body.reach(null);
    body.setGrip(0);
    body.setBend(0);
    body.setAttend(true);
    playerCue.visible = false;
    girlCue.visible = false;
    aimLine.visible = false;
    ghost.visible = false;
    if (hud) hud.style.display = 'none';
    state = 'off';
    path = [];
    onFinish?.();
  }

  // --- 女の子の歩き ------------------------------------------------------------
  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setSeat(0, 'kart');
    const here = new THREE.Vector2(body.position.x, body.position.z);
    const doorIn = [new THREE.Vector2(ROOM.maxX - 0.7, EAST_DOOR.z), new THREE.Vector2(ANNEX.minX + 0.8, EAST_DOOR.z)];
    let lead = [];
    if (inAnnex(here.x, here.y)) lead = [];
    else if (here.y > ROOM.minZ - 0.3 && here.x > ROOM.minX - 0.3 && here.x < ROOM.maxX + 0.3) {
      // 本の部屋の中：ソファの南（節点 4）へ寄ってから東の出入り口へ
      lead = [new THREE.Vector2(0.95, 2.35), ...doorIn];
    } else {
      // 外：掃き出し窓から部屋へ入って、東の出入り口へ（家の南・東にいれば、家の横を回って庭へ）
      const around = [];
      if (here.y > OUTSIDE_Z) {
        const sideX = here.x < 0 ? ROOM.minX - 2.2 : HOUSE_EAST + 1.0;
        around.push(new THREE.Vector2(sideX, here.y), new THREE.Vector2(sideX, OUTSIDE_Z - 1.2));
      }
      const front = new THREE.Vector2(0.9, -4.5);
      const outside = detourAnnex([here, ...around, ...gardenPath(around.length ? around[around.length - 1] : here, front)]).slice(1);
      lead = [...outside, ...body.entryRoute(), new THREE.Vector2(1.05, 1.15), new THREE.Vector2(0.95, 2.35), ...doorIn];
    }
    path = lead;
    approached = false;
    voice?.say('billiardInvite');
    state = 'toTable';
  }
  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt, speed = WALK) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    // 台のそばでは、向きが 0.3rad よりずれているあいだはその場で回ってから歩く（stepTowards は 40° ずれていても
    // 前へ出るので、台の角をかすめて回り込んでいた）
    if (d > 0.05) {
      const want = Math.atan2(path[0].x - body.position.x, path[0].y - body.position.z);
      const off = Math.atan2(Math.sin(want - body.yaw), Math.cos(want - body.yaw));
      if (Math.abs(off) > 0.3) { body.turnTowards(want, dt); body.stand(dt); return false; }
    }
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, speed) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  /** 台を突き抜けないように、台のまわり（木枠から 0.35m）の角を回る道にする（from は今いる所） */
  function aroundTable(to) {
    const a = new THREE.Vector2(body.position.x, body.position.z);
    // 角を回る点は木枠から 0.42m。突き抜けるかどうかは木枠から 0.12m で見る（木枠のすぐそばから歩き出しても、
    // 道がぜんぶ「突き抜ける」にならないように）
    const hx = L + TABLE.rail + 0.42;
    const hz = Wd + TABLE.rail + 0.42;
    const R = { x0: TABLE.x - hx, x1: TABLE.x + hx, z0: TABLE.z - hz, z1: TABLE.z + hz };
    const cx = L + TABLE.rail + 0.12;
    const cz = Wd + TABLE.rail + 0.12;
    const cross = (p, q) => {
      // 5cm ごとに見る（長い道でも台の角をかすめるのを見逃さない）
      const n = Math.max(8, Math.ceil(p.distanceTo(q) / 0.05));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = p.x + (q.x - p.x) * t;
        const z = p.y + (q.y - p.y) * t;
        if (Math.abs(x - TABLE.x) < cx && Math.abs(z - TABLE.z) < cz) return true;
      }
      return false;
    };
    if (!cross(a, to)) return [to];
    const corners = [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1]].map(([x, z]) => new THREE.Vector2(x, z));
    let best = null;
    let bestLen = Infinity;
    for (let k = 0; k < 4; k++) {
      for (const list of [[corners[k]], [corners[k], corners[(k + 1) % 4]], [corners[k], corners[(k + 3) % 4]]]) {
        let p = a;
        let ok = true;
        let len = 0;
        for (const q of [...list, to]) { if (cross(p, q)) { ok = false; break; } len += p.distanceTo(q); p = q; }
        if (ok && len < bestLen) { bestLen = len; best = list; }
      }
    }
    return best ? [...best.map((c) => c.clone()), to] : [to];
  }

  /** 見ているときに立つ所：台のまわりの 4 か所のうち、プレイヤーと手球の狙いの線から遠い所 */
  function watchSpot() {
    const spots = [
      [TABLE.x, TABLE.z - Wd - RAIL_OUT - 0.25], [TABLE.x, TABLE.z + Wd + RAIL_OUT + 0.25],
      [TABLE.x - L - RAIL_OUT - 0.2, TABLE.z], [TABLE.x + L + RAIL_OUT + 0.2, TABLE.z],
    ];
    playerHead?.(tmp);
    let best = spots[0];
    let bestScore = -Infinity;
    for (const s of spots) {
      const score = Math.hypot(s[0] - tmp.x, s[1] - tmp.z);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return new THREE.Vector2(best[0], best[1]);
  }

  // --- 狙いの計算 ---------------------------------------------------------------
  /** 台のローカルで、点 p から向き d へ進んだとき最初に当たる球（手球以外）までの距離と、その球 */
  function firstHit(px, pz, dx, dz, skip = 0) {
    let best = Infinity;
    let ball = null;
    for (const b of B.balls) {
      if (b.pocketed || b.n === skip) continue;
      const ox = b.x - px;
      const oz = b.z - pz;
      const t = ox * dx + oz * dz;
      if (t <= 0) continue;
      const perp2 = ox * ox + oz * oz - t * t;
      const R2 = (BALL_R * 2) ** 2;
      if (perp2 > R2) continue;
      const hit = t - Math.sqrt(R2 - perp2);
      if (hit < best) { best = hit; ball = b; }
    }
    // クッションまで
    let wall = Infinity;
    const lim = (v, d, h) => (d > 1e-6 ? (h - BALL_R - v) / d : d < -1e-6 ? (-h + BALL_R - v) / d : Infinity);
    wall = Math.min(lim(px, dx, L), lim(pz, dz, Wd));
    return { distance: Math.min(best, wall), ball: best <= wall ? ball : null };
  }
  /** 線分 a→b のそばに（除く球以外の）球があるか */
  function blockedPath(ax, az, bx, bz, skip) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    for (const o of B.balls) {
      if (o.pocketed || skip.includes(o.n)) continue;
      const t = ((o.x - ax) * dx + (o.z - az) * dz) / (len * len);
      if (t <= 0 || t >= 1) continue;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      if (Math.hypot(o.x - cx, o.z - cz) < BALL_R * 2.05) return true;
    }
    return false;
  }
  /** 手球から狙いと反対へたどって、台の外（木枠から 0.3m）の立つ所（ワールド）。壁から 0.35m は空ける */
  function standFor(dirX, dirZ) {
    const cue = B.cue;
    // 台の縁から 17cm（太ももが縁に触れるくらい）。30cm だと、手球が奥にあるとき左手（腕は 0.38m）が
    // ブリッジの所へ届かなかった
    const ox = L + TABLE.rail + STAND_OUT;
    const oz = Wd + TABLE.rail + STAND_OUT;
    // 手球から -dir へ、台の外の矩形を出る所まで
    const tx = Math.abs(dirX) > 1e-6 ? (ox - Math.sign(-dirX) * cue.x) / Math.abs(dirX) : Infinity;
    const tz = Math.abs(dirZ) > 1e-6 ? (oz - Math.sign(-dirZ) * cue.z) / Math.abs(dirZ) : Infinity;
    const t = Math.min(tx, tz);
    let sx = TABLE.x + cue.x - dirX * t;
    let sz = TABLE.z + cue.z - dirZ * t;
    // 体はキューの線の左（17cm）に置く。キューはあごの下から右の脇・腰の横を通る。線の真上に立つと、
    // 前にかがんだ胸の高さがキュー（台の高さ）と同じになって、キューが胸に刺さっていた
    sx += dirZ * STAND_SIDE;
    sz -= dirX * STAND_SIDE;
    // ずらして台の外の矩形に入ったら、-dir へ出るまで下がる
    for (let k = 0; k < 20 && Math.abs(sx - TABLE.x) < ox && Math.abs(sz - TABLE.z) < oz; k++) {
      sx -= dirX * 0.02;
      sz -= dirZ * 0.02;
    }
    const m = 0.4;
    sx = THREE.MathUtils.clamp(sx, ANNEX.minX + m, ANNEX.maxX - m);
    sz = THREE.MathUtils.clamp(sz, ANNEX.minZ + m, ANNEX.maxZ - m);
    return { x: sx, z: sz, reach: t };
  }
  function planGirlShot() {
    const cue = B.cue;
    const low = lowest();
    let best = null;
    let bestScore = Infinity;
    if (breakShot) {
      const one = B.balls[low];
      const dx = one.x - cue.x;
      const dz = one.z - cue.z;
      const d = Math.hypot(dx, dz);
      return withError({ dirX: dx / d, dirZ: dz / d, speed: 6.0, target: low }, 0.3);
    }
    for (const b of B.balls) {
      if (b.pocketed || b.n === 0) continue;
      for (const p of POCKETS) {
        // ポケットの口の少し奥を狙う
        const px = p.x + (p.corner ? Math.sign(p.x) * 0.012 : 0);
        const pz = p.z + Math.sign(p.z) * 0.012;
        let bx = px - b.x;
        let bz = pz - b.z;
        const bd = Math.hypot(bx, bz);
        bx /= bd; bz /= bd;
        const gx = b.x - bx * BALL_R * 2;
        const gz = b.z - bz * BALL_R * 2;
        let cx = gx - cue.x;
        let cz = gz - cue.z;
        const cd = Math.hypot(cx, cz);
        if (cd < 0.02) continue;
        cx /= cd; cz /= cd;
        const cut = Math.acos(THREE.MathUtils.clamp(cx * bx + cz * bz, -1, 1));
        if (cut > THREE.MathUtils.degToRad(72)) continue;
        if (blockedPath(cue.x, cue.z, gx, gz, [0, b.n])) continue;
        if (blockedPath(b.x, b.z, px, pz, [0, b.n])) continue;
        // 真ん中のポケットへ浅い角度で入れるのは難しい
        if (!p.corner && Math.abs(bz) < 0.45) continue;
        const stand = standFor(cx, cz);
        const score = cut * 1.2 + cd * 0.35 + bd * 0.45 + (stand.reach > 1.25 ? 1.2 : 0) + (b.n === 9 ? -0.35 : 0) + b.n * 0.01;
        if (score < bestScore) {
          bestScore = score;
          const travel = cd + bd / Math.max(0.35, Math.cos(cut));
          best = { dirX: cx, dirZ: cz, speed: THREE.MathUtils.clamp(0.9 + travel * 1.25, 1.0, 4.6), target: b.n };
        }
      }
    }
    if (!best) {
      // 落とせる形が無い：いちばん番号の小さい球へまっすぐ
      const b = B.balls[low];
      const dx = b.x - cue.x;
      const dz = b.z - cue.z;
      const d = Math.hypot(dx, dz) || 1;
      best = { dirX: dx / d, dirZ: dz / d, speed: 2.2, target: low };
    }
    return withError(best, 0.9);
  }
  function withError(shot, sigmaDeg) {
    // 正規分布（Box-Muller）で少しずらす
    const g = Math.sqrt(-2 * Math.log(Math.max(1e-6, Math.random()))) * Math.cos(Math.PI * 2 * Math.random());
    const a = THREE.MathUtils.degToRad(sigmaDeg) * g;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dirX = shot.dirX * c - shot.dirZ * s;
    const dirZ = shot.dirX * s + shot.dirZ * c;
    return { ...shot, dirX, dirZ, speed: shot.speed * (0.93 + Math.random() * 0.14), stand: standFor(dirX, dirZ) };
  }

  // --- 女の子の番 ---------------------------------------------------------------
  /** 女の子のキューと手：手球の back だけ後ろにキューの先。左手はブリッジ、右手はキューの後ろ */
  const _sh = new THREE.Vector3();
  const _br = new THREE.Vector3();
  const _side = new THREE.Vector3();
  function poseGirlCue(back) {
    const cue = B.cue;
    const s = girlShot;
    const ball = tableToWorld(cue.x, cue.z, tmp);
    const dir = tmp2.set(s.dirX, 0, s.dirZ);
    // 左手（ブリッジ）：キューの線の上で、手球の 22cm 後ろから、左の肩から届く所まで下がった点。開いた手のひらを下にして
    // 羅紗の上に置く（そこが台の外なら縁の上）。以前は 24cm に決めていたので、手球が遠いと肩から 0.85m 先になり
    // （腕は 0.38m）、手が届かずにキューの上の宙に浮いていた。握りこぶしだったのも直す
    const humanoid = character.vrm?.humanoid;
    const shoulder = humanoid?.getNormalizedBoneNode('leftUpperArm');
    const reach = (humanoid?.getNormalizedBoneNode('leftLowerArm')?.position.length() ?? 0.2)
      + (humanoid?.getNormalizedBoneNode('leftHand')?.position.length() ?? 0.18);
    if (shoulder) shoulder.getWorldPosition(_sh); else _sh.copy(body.position).setY(1.1);
    const clothY = (x, z) => (Math.abs(x - TABLE.x) < TABLE.halfL - 0.02 && Math.abs(z - TABLE.z) < TABLE.halfW - 0.02 ? TABLE.height + 0.012 : TABLE.height + 0.05);
    // 手は、キューを親指と人差し指の間に載せるため、小指の側（左）へ 2.8cm ずらして置く
    _side.set(dir.z, 0, -dir.x).multiplyScalar(0.028);
    // 構えている間に決めて、素振りから突くまでは動かさない（肩は毎フレーム少し動くので、決め直すとブリッジが跳ねる）
    const search = girlStep === 'address' || s.bridgeT === undefined;
    let t = search ? 0.22 : s.bridgeT;
    for (; search && t < 0.75; t += 0.02) {
      _br.copy(ball).addScaledVector(dir, -t).add(_side);
      const wy = clothY(_br.x, _br.z);
      // 手首は手のひらの中心から 7cm 手前
      if (Math.hypot(_br.x - dir.x * 0.07 - _sh.x, wy - _sh.y, _br.z - dir.z * 0.07 - _sh.z) < reach * 0.95) break;
    }
    s.bridgeT = t;
    const bridge = ball.clone().addScaledVector(dir, -t);
    bridge.y = clothY(bridge.x, bridge.z);
    // キュー：先（手球の後ろ、球の中心の高さ）とブリッジの手の上を通す。載せるのは親指と人差し指の付け根の間
    // （手のひらの中心より親指の側へ 2.8cm、指の付け根の骨から 2cm 上）
    const rest = bridge.clone();
    rest.y += 0.024;
    const handAt = bridge.clone().add(_side);
    const tip0 = ball.clone().addScaledVector(dir, -(BALL_R + 0.012));
    const axis = new THREE.Vector3().subVectors(tip0, rest).normalize();
    const tipAt = ball.clone().addScaledVector(axis, -(BALL_R + 0.012 + back));
    girlCue.visible = true;
    girlCue.position.copy(tipAt);
    girlCue.quaternion.setFromUnitVectors(up, axis);
    // 右手：キューの後ろを、キューが拳の中を通るように握る（親指の側が先の向き）。ブリッジから 55cm 以上後ろ
    // （腰の横。肘から下が真下に垂れる）。先から 0.95m に決めていたときは、手球が遠いとブリッジのすぐ後ろ・あごの前を握っていた
    // 握る所はキューの上で決まった所（引く・突くときはキューといっしょに動く）
    const gripAlong = THREE.MathUtils.clamp(t + BALL_R + 0.012 + 0.6, 0.95, 1.3);
    const grip = tipAt.clone().addScaledVector(axis, -gripAlong);
    body.reachHands({ left: { target: handAt, amount: 1, flat: dir }, right: { target: grip, amount: 1, grip: axis } });
    body.setGrip(0, 'left');
    body.setGrip(1, 'right');
  }
  function watchBall() {
    tableToWorld(B.cue.x, B.cue.z, gaze.position);
    character.watch(gaze);
  }
  function girlTurn(dt) {
    timer += dt;
    const s = girlShot;
    switch (girlStep) {
      case 'walk': {
        body.setBend(0);
        girlCue.visible = false;
        body.reachHands(null);
        watchBall();
        if (followPath(dt) || timer > 20) { girlStep = 'address'; timer = 0; }
        break;
      }
      case 'address': {
        body.position.x += (s.stand.x - body.position.x) * Math.min(1, dt * 4);
        body.position.z += (s.stand.z - body.position.z) * Math.min(1, dt * 4);
        body.turnTowards(Math.atan2(s.dirX, s.dirZ), dt * 2.5);
        body.stand(dt);
        body.setBend(1.0);   // 深く前かがみに（0.55・0.75 では、ブリッジの左手が台まで届かなかった）
        poseGirlCue(0.05);
        watchBall();
        if (timer > 1.3) { girlStep = 'stroke'; timer = 0; }
        break;
      }
      case 'stroke': {
        // 素振り 2 回（0.55 秒で 1 往復）
        const k = timer / 0.55;
        poseGirlCue(0.05 + (1 - Math.cos(k * Math.PI * 2)) * 0.05);
        watchBall();
        if (k >= 2) { girlStep = 'back'; timer = 0; }
        break;
      }
      case 'back': {
        const k = Math.min(1, timer / 0.5);
        const pull = THREE.MathUtils.clamp(s.speed / 20, 0.08, 0.3);
        poseGirlCue(0.05 + pull * k);
        watchBall();
        if (k >= 1) { girlStep = 'through'; timer = 0; }
        break;
      }
      case 'through': {
        const k = Math.min(1, timer / 0.1);
        const pull = THREE.MathUtils.clamp(s.speed / 20, 0.08, 0.3);
        poseGirlCue((0.05 + pull) * (1 - k) - k * 0.02);
        if (k >= 1) {
          shoot('girl', s.dirX, s.dirZ, s.speed);
          girlStep = 'watch';
          timer = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  // --- プレイヤーの突き方 --------------------------------------------------------
  function hand(side) {
    if (!controllers) return null;
    return controllers.find((c) => c.userData.handedness === side) ?? controllers[side === 'right' ? 1 : 0] ?? null;
  }
  const prevTip = new THREE.Vector3();
  let hadTip = false;
  let hitCool = 0;
  const rightAt = new THREE.Vector3();
  const leftAt = new THREE.Vector3();
  const axisV = new THREE.Vector3();
  const tipV = new THREE.Vector3();
  function holdCueVR(dt) {
    const r = hand('right');
    if (!r?.visible) { playerCue.visible = false; hadTip = false; return; }
    r.updateMatrixWorld(true);
    r.getWorldPosition(rightAt);
    const l = hand('left');
    let bridged = false;
    if (l?.visible) {
      l.getWorldPosition(leftAt);
      const d = leftAt.distanceTo(rightAt);
      if (d > 0.12 && d < 0.8) { axisV.subVectors(leftAt, rightAt).normalize(); bridged = true; }
    }
    if (!bridged) { r.getWorldQuaternion(qa); axisV.set(0, 0, -1).applyQuaternion(qa); }
    // 右手はキューの後ろから 0.45m。先は右手の 1.0m 前
    tipV.copy(rightAt).addScaledVector(axisV, 1.0);
    playerCue.visible = true;
    playerCue.position.copy(tipV);
    playerCue.quaternion.setFromUnitVectors(up, axisV);
    // 自分の番に、先が手球へ前向きに当たったら突く
    hitCool = Math.max(0, hitCool - dt);
    if (hadTip && turn === 'player' && phase === 'aim' && hitCool === 0 && dt > 0 && !B.moving) {
      const ball = tableToWorld(B.cue.x, B.cue.z, tmp);
      const seg = tmp2.subVectors(tipV, prevTip);
      const L2 = seg.lengthSq();
      let t = L2 > 1e-10 ? ((ball.x - prevTip.x) * seg.x + (ball.y - prevTip.y) * seg.y + (ball.z - prevTip.z) * seg.z) / L2 : 1;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const cx = prevTip.x + seg.x * t;
      const cy = prevTip.y + seg.y * t;
      const cz = prevTip.z + seg.z * t;
      const near = Math.hypot(cx - ball.x, cy - ball.y, cz - ball.z) < BALL_R + 0.012;
      const forward = seg.dot(axisV) / dt;
      if (near && forward > 0.15) {
        const hx = axisV.x;
        const hz = axisV.z;
        const hl = Math.hypot(hx, hz) || 1;
        shoot('player', hx / hl, hz / hl, THREE.MathUtils.clamp(forward * 1.35, 0.2, 7));
        hitCool = 1;
      }
    }
    prevTip.copy(tipV);
    hadTip = true;
  }
  function pcAimDir() {
    const c = tableToWorld(B.cue.x, B.cue.z, tmp);
    camera.getWorldPosition(tmp2);
    const dx = c.x - tmp2.x;
    const dz = c.z - tmp2.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }
  function pcBehindBall() {
    if (!desktop || !camera) return;
    const c = tableToWorld(B.cue.x, B.cue.z, tmp);
    // はじめは、いちばん番号の小さい球のほう
    const t = B.balls[lowest()];
    let dx = t.x - B.cue.x;
    let dz = t.z - B.cue.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    camera.position.set(c.x - dx * 1.1, TABLE.height + 0.42, c.z - dz * 1.1);
    desktop.controls.target.set(c.x, c.y, c.z);
    desktop.controls.update();
  }
  function pcTurn(dt) {
    if (!pcTurnSet) { pcBehindBall(); pcTurnSet = true; charge = 0; charging = false; }
    if (charging) charge = Math.min(1, charge + dt * 0.85);
    const a = pcAimDir();
    // 狙いの線（最初に当たる所まで）と、当たる所の輪
    const hit = firstHit(B.cue.x, B.cue.z, a.x, a.z, 0);
    const from = tableToWorld(B.cue.x, B.cue.z, new THREE.Vector3());
    const to = tableToWorld(B.cue.x + a.x * hit.distance, B.cue.z + a.z * hit.distance, new THREE.Vector3());
    from.y = to.y = TABLE.height + 0.004;
    aimLine.geometry.setFromPoints([from, to]);
    aimLine.visible = true;
    ghost.visible = Boolean(hit.ball);
    ghost.position.set(to.x, TABLE.height + 0.003, to.z);
    // キュー（手球の後ろ。ためるほど引く）
    const ball = tableToWorld(B.cue.x, B.cue.z, new THREE.Vector3());
    const axis = new THREE.Vector3(a.x, -0.1, a.z).normalize();
    playerCue.visible = true;
    playerCue.position.copy(ball).addScaledVector(axis, -(BALL_R + 0.02 + charge * 0.25));
    playerCue.quaternion.setFromUnitVectors(up, axis);
    const bar = `<div style="margin:6px auto 0;width:220px;height:8px;background:#333;border-radius:4px;overflow:hidden"><div style="width:${Math.round(charge * 100)}%;height:100%;background:${charge > 0.8 ? '#ff5a3a' : '#ffd24a'}"></div></div>`;
    showHud(bar);
  }
  function pcRelease() {
    if (!(turn === 'player' && phase === 'aim' && charging)) { charging = false; return; }
    charging = false;
    const a = pcAimDir();
    shoot('player', a.x, a.z, 0.35 + charge ** 1.5 * 6.2);
    charge = 0;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || state !== 'play' || isXR()) return;
      // ラケットを持っているときのスペースはラケットを振る（desktop.js）
      if (desktop?.swing?.holding) return;
      if (turn === 'player' && phase === 'aim' && !B.moving) { e.preventDefault(); if (!e.repeat) charging = true; }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || state !== 'play' || isXR()) return;
      pcRelease();
    });
  }

  // --- 突く・次の番 ------------------------------------------------------------
  function shoot(who, dx, dz, speed) {
    shooter = who;
    B.shoot(dx, dz, speed);
    phase = 'rolling';
    rollingFor = 0;
    aimLine.visible = false;
    ghost.visible = false;
    if (who === 'player' && !isXR()) playerCue.visible = false;
    breakShot = false;
  }
  function afterShot() {
    const ev = B.events;
    const pocketed = [...new Set(ev.filter((e) => e.type === 'pocket').map((e) => e.n))];
    const scratch = pocketed.includes(0);
    const nine = pocketed.includes(9);
    const potted = pocketed.filter((n) => n !== 0);
    const other = shooter === 'player' ? 'girl' : 'player';
    if (nine && !scratch) {
      wins[shooter]++;
      phase = 'over';
      timer = 0;
      message = shooter === 'player' ? 'あなたの勝ち！' : `${girlName()}の勝ち！`;
      voice?.say(shooter === 'player' ? 'billiardLose' : 'billiardWin');
      if (shooter === 'girl') body.smile(3, 1);
      breaker = other;
      drawBoard();
      return;
    }
    if (nine && scratch) B.spotBall(9);
    if (scratch) {
      B.spotCue(HEAD_SPOT.x, HEAD_SPOT.z);
      voice?.say('billiardScratch');
      turn = other;
      message = 'スクラッチ（手球が落ちた）';
    } else if (potted.length) {
      voice?.say(shooter === 'player' ? 'billiardNice' : 'billiardPot', { chance: 0.85 });
      if (shooter === 'girl') body.smile(2, 1);
      turn = shooter;
      message = '';
    } else {
      if (shooter === 'girl') voice?.say('billiardMiss', { chance: 0.6 });
      turn = other;
      message = '';
    }
    phase = 'aim';
    pcTurnSet = false;
    if (turn === 'girl') {
      girlShot = planGirlShot();
      girlStep = 'walk';
      timer = 0;
      path = aroundTable(new THREE.Vector2(girlShot.stand.x, girlShot.stand.z));
      if (shooter !== 'girl') voice?.say('billiardMyTurn', { chance: 0.6 });
    } else if (shooter === 'girl') {
      voice?.say('billiardYourTurn', { chance: 0.5 });
      path = aroundTable(watchSpot());
    }
    drawBoard();
  }
  function newRack() {
    B.rack();
    turn = breaker;
    breakShot = true;
    phase = 'aim';
    pcTurnSet = false;
    message = '';
    voice?.say('billiardAgain');
    if (turn === 'girl') {
      girlShot = planGirlShot();
      girlStep = 'walk';
      timer = 0;
      path = aroundTable(new THREE.Vector2(girlShot.stand.x, girlShot.stand.z));
    }
    drawBoard();
  }

  let orbitOn = false;
  function update(dt) {
    if (!body.loaded) return;
    // PC の自分の番は、視点が球のまわりを回る（desktop.js。ふだんは目の位置のまま見回す）
    const wantOrbit = !isXR() && state === 'play' && turn === 'player' && phase === 'aim';
    if (wantOrbit !== orbitOn && desktop?.setOrbitAim) { orbitOn = wantOrbit; desktop.setOrbitAim(wantOrbit); }
    awayFor = playerHere ? 0 : awayFor + dt;
    if (state !== 'off' && awayFor > 4) { finish(); return; }
    if (state === 'off') return;
    if (isXR()) holdCueVR(dt);
    else if (!(turn === 'player' && phase === 'aim' && state === 'play')) playerCue.visible = false;
    // 球が止まったら、次の番（30 秒たっても止まらなければ止める）
    if (phase === 'rolling') {
      rollingFor += dt;
      if (rollingFor > 30) for (const b of B.balls) { b.vx = 0; b.vz = 0; }
      if (!B.moving) afterShot();
    }
    if (phase === 'over') {
      timer += dt;
      if (timer > 6) newRack();
    }
    // PC の自分の番
    if (!isXR() && state === 'play' && turn === 'player' && phase === 'aim') pcTurn(dt);
    else { aimLine.visible = false; ghost.visible = false; showHud(); }
    switch (state) {
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toTable':
        playerHead(gaze.position);
        character.watch(gaze);
        if (followPath(dt)) {
          // 部屋に入ってから、台をよけて見る所へ
          if (!approached) { approached = true; path = aroundTable(watchSpot()); } else state = 'play';
        }
        break;
      case 'play':
        body.position.y = 0;
        if (turn === 'girl' && phase === 'aim') girlTurn(dt);
        else {
          // 見ている：かまえを解いて、台のそばへ
          girlCue.visible = phase === 'rolling' && shooter === 'girl';
          if (phase !== 'rolling' || shooter !== 'girl' || timer > 0.6) {
            body.setBend(0);
            body.reachHands(null);
            body.reach(null);
            body.setGrip(0);
            girlCue.visible = false;
            followPath(dt);
          }
          timer += dt;
          // 動いている球（なければ手球）を見る
          const m = B.balls.find((b) => !b.pocketed && (b.vx || b.vz)) ?? B.cue;
          tableToWorld(m.x, m.z, gaze.position);
          character.watch(gaze);
        }
        break;
      default:
        break;
    }
  }

  return {
    update,
    start,
    set onFinish(fn) { onFinish = fn; },
    set playerHere(v) { playerHere = Boolean(v); },
    get wanted() { return playerHere; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get turn() { return turn; },
    get phase() { return phase; },
    get wins() { return wins; },
    get charging() { return charging; },
    /** main.js から：VR のコントローラー・PC の視点・VR かどうか */
    bind(o) { controllers = o.controllers ?? controllers; desktop = o.desktop ?? desktop; isXR = o.isXR ?? isXR; },
    /** 検証用 */
    debugShoot(dirX, dirZ, speed) { if (turn === 'player' && phase === 'aim') shoot('player', dirX, dirZ, speed); },
    get debug() { return { state, turn, phase, girlStep, shooter, breakShot, message, left: remaining(), pos: [+body.position.x.toFixed(2), +body.position.z.toFixed(2)], shot: girlShot && { ...girlShot, stand: girlShot.stand && { x: +girlShot.stand.x.toFixed(2), z: +girlShot.stand.z.toFixed(2), reach: +girlShot.stand.reach.toFixed(2) } } }; },
    planGirlShot: () => planGirlShot(),
    get debugPath() { return path.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]); },
    inAnnex,
  };
}
