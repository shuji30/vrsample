import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { BIKE_TRACK, bikeTrackPoint } from './biketrack.js';

/**
 * ポケバイ（女の子の側）。プレイヤーがポケバイに乗ると、女の子は遊びをやめてコースの横
 * （スタートの近くの芝生）まで歩いてきて、見守って応援する。周回ごとにラップタイムを
 * 計って教えてくれ、ベストが出ると喜ぶ。スタートの横のタイムの看板にも出す（VR でも見える）。
 * プレイヤーが降りてしばらくすると、キャッチボールへ戻る。
 *
 * 女の子はポケバイには乗らない。またがる姿勢は、短いスカートだとどうしても中が見えて
 * しまうため（カートは脚をダッシュボードの下へ入れて隠したが、バイクには隠す所がない）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.1;
/** 見守る場所（スタートの線の右の芝生）と、手前の遊び場から来るときの中継点 */
const SPOT = new THREE.Vector2(-6.2, -18.2);
const VIA = new THREE.Vector2(-5.6, -12.2);

const wrapDiff = (d) => d - Math.round(d);

export function createBikeGame({ character, bike, voice = null, scene = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let onFinish = null;
  const driver = { get state() { return `bike:${state}`; } };

  // --- 周回とラップ -----------------------------------------------------------
  let progress = 0;
  let prevU = 0;
  let lapStart = 0;
  let clock = 0;
  let laps = 0;
  let lastLap = null;
  let bestLap = null;
  let counting = false;

  function resetLaps() {
    prevU = bike.state.u;
    progress = wrapDiff(bike.state.u - BIKE_TRACK.startAt);
    laps = 0;
    counting = false;
  }

  function trackLaps(dt) {
    clock += dt;
    const u = bike.state.u;
    progress += wrapDiff(u - prevU);
    prevU = u;
    const lap = Math.floor(progress);
    if (lap > laps) {
      laps = lap;
      if (counting) {
        lastLap = clock - lapStart;
        const best = bestLap === null || lastLap < bestLap;
        if (best) bestLap = lastLap;
        const n = lastLap.toFixed(1);
        // 声では秒を整数に丸める（VOICEVOX の声を前もって作っておける数にする。吹き出しは 1 桁まで）
        if (state === 'watch') voice?.say(best && laps > 1 ? 'bikeBest' : 'bikeLap', { n, spoken: Math.round(lastLap) });
      }
      // スタートの線を越えたところから計りはじめる
      counting = true;
      lapStart = clock;
      drawBoard();
    }
  }

  // --- タイムの看板（スタートの横）と PC の表示 -----------------------------------
  let lastDrawn = '';
  const boardCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let boardTexture = null;
  if (boardCanvas && scene) {
    boardCanvas.width = 256;
    boardCanvas.height = 128;
    boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: boardTexture, toneMapped: false }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.64), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 }));
    back.rotation.y = Math.PI;
    back.position.z = -0.01;
    board.add(back);
    const at = bikeTrackPoint(BIKE_TRACK.startAt);
    // 表（+Z）をコースの側（-X）へ向ける。女の子の立つ所（SPOT）とは 1.5m ずらす
    board.position.set(at.x + 1.8, 1.5, at.z + 1.4);
    board.rotation.y = -Math.PI / 2 - 0.25;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }));
    post.position.set(at.x + 1.8, 0.6, at.z + 1.4);
    scene.add(board, post);
    drawBoard();
  }
  const hud = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (hud) {
    hud.id = 'bike-hud';
    hud.style.cssText = 'position:fixed;right:16px;top:14px;padding:6px 18px;border-radius:10px;background:rgba(16,20,28,0.72);'
      + 'color:#fff;font:bold 20px/1.4 sans-serif;text-align:center;pointer-events:none;z-index:15;display:none;white-space:pre-line';
    document.body.appendChild(hud);
  }
  function lines() {
    const now = counting ? (clock - lapStart).toFixed(1) : '--';
    return [
      `ラップ ${now} 秒`,
      `前の周 ${lastLap === null ? '--' : lastLap.toFixed(1)} 秒`,
      `ベスト ${bestLap === null ? '--' : bestLap.toFixed(1)} 秒`,
    ];
  }
  function drawBoard() {
    if (!boardCanvas) return;
    const text = lines();
    const key = text.join('|');
    if (key === lastDrawn) return;
    lastDrawn = key;
    const ctx = boardCanvas.getContext('2d');
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#7fd1ff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ポケバイ タイム', 128, 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    text.forEach((l, i) => ctx.fillText(l, 128, 58 + i * 26));
    boardTexture.needsUpdate = true;
  }

  // --- 女の子 -------------------------------------------------------------------
  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], VIA), [SPOT.clone()]);
    } else {
      path = gardenPath(here, VIA).concat([SPOT.clone()]);
    }
    voice?.say('bikeInvite');
    state = 'toSpot';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  let cheerIn = 6;
  function update(dt) {
    trackLaps(dt);
    if (hud) {
      hud.style.display = playerRiding ? '' : 'none';
      if (playerRiding) hud.textContent = lines().join('\n');
    }
    if (playerRiding) drawBoard();
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 4) { finish(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toSpot':
        if (followPath(dt)) state = 'watch';
        break;
      case 'watch': {
        // バイクのほうを向いて、目で追う。ときどき応援する
        const p = bike.group.position;
        body.turnTowards(Math.atan2(p.x - body.position.x, p.z - body.position.z), dt);
        body.stand(dt);
        character.watch(bike.group);
        cheerIn -= dt;
        if (cheerIn < 0) { voice?.say('bikeCheer', { chance: 0.6 }); cheerIn = 9 + Math.random() * 8; }
        break;
      }
      default:
        break;
    }
  }

  function finish() {
    body.setAttend(true);
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    stop: finish,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) {
      const was = playerRiding;
      playerRiding = Boolean(v);
      if (playerRiding && !was) resetLaps();
    },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get laps() { return { laps, lastLap, bestLap }; },
  };
}
