import * as THREE from 'three';
import { CIRCUIT, CIRCUIT_LENGTH, circuitFrame, circuitCurvature } from './circuit.js';
import { createGT3Model, GT3, GT3_SEAT } from './gt3.js';

/**
 * GT3 のレース（女の子の車と、流れ）。
 *
 * 女の子もピンクの GT3 で走る。車はコースの上を「曲がれる速さ」で走らせる：
 *   1m ごとの曲がり具合から、ダウンフォース込みで曲がれる速さを出し、手前からのブレーキ（14m/s²）と
 *   加速（速いほど弱い）で詰めた速さの表を前もって作る。走るときは、その表 × 腕前（skill）に向けて加減速する。
 *   走る線は、先のカーブの内側へ少し寄せる。前にプレイヤーがいたら、横へよけて抜く（よけられなければ待つ）。
 *
 * 流れ：グリッド（2.5 秒）→ 赤いランプが 5 つ点いて消えたらスタート → 3 周 → 結果。
 * そのあとは流して走る。プレイヤーがグリッドに止まって 2 秒待つと、もう一回。
 *
 * 女の子は運転席に座り、両手でハンドルを握る（屋根のある車なので、スカートは見えない）。
 */

const SEAT_TOP = 0.42;
const AI_LAT = 1.45 * 1.44 / GT3.mass;   // 速さの 2 乗あたりの、ダウンフォースで増える横の力（/m）

/** 1m ごとの、女の子が出せる速さの表 */
/**
 * 女の子の車の速さ。コースの曲がり具合から、曲がれる速さ（AI_CORNER 倍）・手前のブレーキ（AI_BRAKE m/s²）・
 * 加速の限界（aiAccel）で速度表を作り、腕前（AI_SKILL）を掛けて走る。1 周 55 秒ほどに合わせた
 * （前は 1 周 67 秒で、遅すぎると言われた）
 */
const AI_CORNER = 1.0;
const AI_BRAKE = 17;
const AI_SKILL = 1.0;
const aiAccel = (v) => Math.max(2.6, 12.8 - v * 0.13);

function speedTable() {
  const n = Math.round(CIRCUIT_LENGTH);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(circuitCurvature(i, 8));
    const R = 1 / Math.max(k, 1e-5);
    const denom = 1 - R * AI_LAT;
    const vmax = denom <= 0.05 ? GT3.maxSpeed : Math.sqrt((R * GT3.mu * 9.8) / denom);
    v[i] = Math.min(GT3.maxSpeed * 0.96, vmax * AI_CORNER);
  }
  // 手前からブレーキ（うしろ向きに 2 周ぶん回して、つなぎ目もなめらかに）
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * AI_BRAKE * 1));
    }
  }
  // 加速の限界（前向きに）
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = v[(i - 1 + n) % n];
      const acc = aiAccel(prev);
      v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * acc * 1));
    }
  }
  return v;
}

export function createGT3Race({ scene, character, playerCar, circuit, voice = null }) {
  const table = speedTable();
  const her = createGT3Model({ color: 0xf06aa8, accent: 0xffffff, number: '23' });
  her.root.name = 'gt3Her';
  scene.add(her.root);
  her.root.visible = false;
  const body = character.body;
  const driver = { get state() { return `gt3:${state}`; } };

  let state = 'off';      // off / grid / lights / race / done / free
  let timer = 0;
  let lightsHold = 0;
  let herS = 0;
  let herV = 0;
  let herLat = 0;
  let herLap = 0;
  let herFinish = null;
  let playerLap = 0;
  let playerFinish = null;
  let playerPrevS = 0;
  let herPrevS = 0;
  let playerProgress = 0;
  let herProgress = 0;
  let clock = 0;
  let lapStart = 0;
  let bestLap = null;
  let lastLap = null;
  let skill = 0.93;
  let lastPos = 0;
  let stillFor = 0;
  let lastLapSaid = false;
  const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() };
  const seat = new THREE.Vector3();
  const lh = new THREE.Vector3();
  const rh = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  // 画面の右上の表示（PC）
  // 文字の下に、コースの地図（自分 青・女の子 ピンク）
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:12px;right:12px;padding:8px 12px;background:rgba(10,14,24,.72);color:#fff;font:600 15px/1.5 sans-serif;border-radius:8px;display:none;z-index:5';
  const hudText = document.createElement('div');
  hudText.style.whiteSpace = 'pre';
  const hudMap = document.createElement('canvas');
  hudMap.width = 240;
  hudMap.height = 170;
  hudMap.style.cssText = 'display:block;margin:6px auto 0;width:240px;height:170px';
  hud.append(hudText, hudMap);
  document.body.appendChild(hud);
  let hudMapIn = 0;

  const wrapD = (d) => ((d + CIRCUIT_LENGTH / 2) % CIRCUIT_LENGTH + CIRCUIT_LENGTH) % CIRCUIT_LENGTH - CIRCUIT_LENGTH / 2;
  const fmt = (t) => (t === null ? '--' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);

  function gridSlots() {
    return { her: { s: CIRCUIT.startAt - 10, lat: 3 }, player: { s: CIRCUIT.startAt - 14, lat: -3 } };
  }

  function placeHer(s, lat) {
    herS = s;
    herLat = lat;
    herV = 0;
    herPrevS = s;
    poseHer(0);
  }

  function poseHer(steer) {
    circuitFrame(herS, f);
    her.root.position.copy(f.p).addScaledVector(f.n, herLat);
    her.root.rotation.set(0, Math.atan2(f.t.x, f.t.z), 0);
    for (const w of her.wheels) {
      w.spin.rotation.x += 0;
      if (w.front) w.hold.rotation.y = steer * 0.4;
    }
    her.steering.rotation.z = -steer * 1.2;
    her.root.updateMatrixWorld(true);
  }

  /** 始める（プレイヤーが GT3 に乗った）。女の子を運転席へ */
  function start() {
    const slots = gridSlots();
    playerCar.placeOnCircuit(slots.player.s, slots.player.lat);
    placeHer(slots.her.s, slots.her.lat);
    her.root.visible = true;
    body.drive(driver);
    body.setAttend(false);
    body.reach(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setSeat(1, 'kart');
    sitInCar();
    newRace();
    voice?.say('gt3Invite');
  }

  function newRace() {
    state = 'grid';
    timer = 0;
    herLap = 0;
    playerLap = 0;
    herFinish = null;
    playerFinish = null;
    herProgress = 0;
    playerProgress = 0;
    playerPrevS = playerCar.state.s;
    herPrevS = herS;
    lastLapSaid = false;
    circuit.setLights(0);
    playerCar.locked = true;
  }

  function stop() {
    if (state === 'off') return;
    state = 'off';
    her.root.visible = false;
    circuit.setLights(0);
    playerCar.locked = false;
    hud.style.display = 'none';
    body.reachHands(null);
    body.setGrip(0);
    body.setSeat(0, 'kart');
  }

  function sitInCar() {
    her.root.updateMatrixWorld(true);
    her.root.localToWorld(seat.set(GT3_SEAT.x, body.seatRootY(SEAT_TOP), GT3_SEAT.z));
    body.position.copy(seat);
    body.setYaw(her.root.rotation.y);
    body.setSeat(1, 'kart');
    her.steering.updateMatrixWorld(true);
    her.steering.localToWorld(lh.set(0.155, 0, 0));
    her.steering.localToWorld(rh.set(-0.155, 0, 0));
    axis.set(0, 1, 0).transformDirection(her.steering.matrixWorld);
    body.reachHands({ left: { target: lh, amount: 1, grip: axis }, right: { target: rh, amount: 1, grip: axis } });
    body.setGrip(1);
    // 前（と、ときどき横のプレイヤー）を見る
    gaze.position.copy(her.root.position).add(new THREE.Vector3(Math.sin(her.root.rotation.y) * 20, 1.1, Math.cos(her.root.rotation.y) * 20));
    character.watch(gaze);
  }

  /** 女の子の車を 1 フレーム進める */
  function driveHer(dt, go) {
    const ps = playerCar.state.s;
    const pl = playerCar.state.lateral;
    // 腕前：離れすぎたら少し追いつく / 待つ
    const gap = wrapD(herProgress - playerProgress + (herS - ps) * 0);
    const lead = (herProgress - playerProgress);
    // ふだんは 1 周 55 秒ほど。大きく離したときだけ少し待ち、離されたら少し追う
    skill = THREE.MathUtils.clamp(AI_SKILL + (lead > 150 ? -0.05 : lead < -60 ? 0.03 : 0), 0.85, 1.03);
    let want = go ? table[Math.floor(herS) % table.length] * skill : 0;
    // 走る線：先のカーブの内側へ
    const k = circuitCurvature(herS + 25, 12);
    let lineLat = THREE.MathUtils.clamp(k * 260, -4, 4);
    // 前のプレイヤー
    const ahead = wrapD(ps - herS);
    if (go && ahead > 0 && ahead < 14 && Math.abs(pl - herLat) < 2.6) {
      const other = pl > 0 ? pl - 3.4 : pl + 3.4;
      if (Math.abs(other) < CIRCUIT.width / 2 - 0.8) lineLat = other;
      else want = Math.min(want, Math.max(0, playerCar.state.speed - 0.5));
    }
    herLat += THREE.MathUtils.clamp(lineLat - herLat, -2.2 * dt, 2.2 * dt);
    const acc = aiAccel(herV);
    herV += THREE.MathUtils.clamp(want - herV, -13 * dt, acc * dt);
    herS = (herS + herV * dt) % CIRCUIT_LENGTH;
    poseHer(THREE.MathUtils.clamp(-k * 18, -1, 1));
    for (const w of her.wheels) w.spin.rotation.x += (herV / GT3.wheelRadius) * dt;
    void gap;
  }

  function progress(prevS, s) { return wrapD(s - prevS); }
  function crossedStart(prevS, s) {
    const a = wrapD(prevS - CIRCUIT.startAt);
    const b = wrapD(s - CIRCUIT.startAt);
    return a < 0 && b >= 0 && b - a < 50;
  }

  function update(dt) {
    if (state === 'off') return;
    clock += dt;
    timer += dt;
    const go = state === 'race' || state === 'done' || state === 'free';
    driveHer(dt, go);
    sitInCar();
    const ps = playerCar.state.s;
    playerProgress += progress(playerPrevS, ps);
    herProgress += progress(herPrevS, herS);
    const playerCrossed = crossedStart(playerPrevS, ps);
    const herCrossed = crossedStart(herPrevS, herS);
    playerPrevS = ps;
    herPrevS = herS;

    switch (state) {
      case 'grid':
        if (timer > 2.5) { state = 'lights'; timer = 0; lightsHold = 0.6 + Math.random() * 0.8; voice?.say('gt3Grid'); }
        break;
      case 'lights': {
        const n = Math.min(5, Math.floor(timer / 0.8) + 1);
        circuit.setLights(n);
        if (timer > 4 + lightsHold) {
          circuit.setLights(0);
          state = 'race';
          timer = 0;
          lapStart = clock;
          playerCar.locked = false;
          voice?.say('gt3Go');
        }
        break;
      }
      case 'race': {
        if (playerCrossed && timer > 5) {
          playerLap++;
          lastLap = clock - lapStart;
          if (playerLap > 0 && (bestLap === null || lastLap < bestLap)) bestLap = lastLap;
          lapStart = clock;
          if (playerLap >= CIRCUIT.laps && playerFinish === null) playerFinish = clock;
          if (playerLap === CIRCUIT.laps - 1 && !lastLapSaid) { voice?.say('gt3LastLap'); lastLapSaid = true; }
        }
        if (herCrossed && timer > 5) {
          herLap++;
          if (herLap >= CIRCUIT.laps && herFinish === null) herFinish = clock;
        }
        // 抜いた・抜かれた
        const pos = herProgress > playerProgress ? 2 : 1;
        if (lastPos && pos !== lastPos) voice?.say(pos === 2 ? 'gt3Pass' : 'gt3Overtaken', { chance: 0.8 });
        lastPos = pos;
        if (playerFinish !== null && (herFinish !== null || clock - playerFinish > 12)) {
          const won = herFinish === null || playerFinish < herFinish;
          voice?.say(won ? 'gt3Lose' : 'gt3Win');
          state = 'done';
          timer = 0;
        }
        break;
      }
      case 'done':
        if (timer > 6) state = 'free';
        break;
      case 'free': {
        // グリッドに止まって 2 秒で、もう一回
        const d = wrapD(ps - CIRCUIT.startAt);
        stillFor = d < -4 && d > -40 && Math.abs(playerCar.state.speed) < 1 ? stillFor + dt : 0;
        if (stillFor > 2) {
          stillFor = 0;
          const slots = gridSlots();
          placeHer(slots.her.s, slots.her.lat);
          newRace();
          voice?.say('gt3Again');
        }
        break;
      }
      default:
        break;
    }
    // 表示
    const pos = herProgress > playerProgress ? 2 : 1;
    const lapText = state === 'grid' || state === 'lights' ? 'スタート前' : state === 'race' ? `周 ${Math.min(CIRCUIT.laps, playerLap + 1)}/${CIRCUIT.laps}` : 'ゴール';
    playerCar.setHud(lapText, state === 'race' ? `${pos}位` : '');
    hud.style.display = '';
    // 地図（車内の画面と PC の右上）。女の子の車はコースにいるあいだだけ
    playerCar.setMapCars(her.root.visible ? [{ s: herS, color: '#ff6ab0' }] : []);
    hudMapIn -= dt;
    if (hudMapIn < 0) {
      hudMapIn = 0.1;
      const c = hudMap.getContext('2d');
      c.clearRect(0, 0, hudMap.width, hudMap.height);
      playerCar.circuitMap.draw(c, 0, 0, hudMap.width, hudMap.height, [
        ...(her.root.visible ? [{ s: herS, color: '#ff6ab0' }] : []),
        { s: playerCar.state.s, color: '#3a8aff', me: true },
      ]);
    }
    hudText.textContent = `GT3 レース　${lapText}　${state === 'race' ? `${pos}位` : ''}\n`
      + `いまの周 ${state === 'race' ? fmt(clock - lapStart) : '--'}　前の周 ${fmt(lastLap)}　ベスト ${fmt(bestLap)}\n`
      + `${playerCar.state.reverse ? 'R' : playerCar.state.gear} 速　${Math.round(Math.abs(playerCar.state.speed) * 3.6)} km/h　${playerCar.state.auto ? 'AT（Q で MT）' : 'MT（Q で AT）'}`
      + (state === 'free' ? '\nグリッドに止まって 2 秒待つと、もう一回' : '');
  }

  return {
    start,
    stop,
    update,
    get state() { return state; },
    get active() { return state !== 'off'; },
    get locked() { return state === 'grid' || state === 'lights'; },
    get herCar() { return her; },
    get herS() { return herS; },
    get herSpeed() { return herV; },
    get laps() { return { player: playerLap, her: herLap }; },
    get position() { return herProgress > playerProgress ? 2 : 1; },
    /** 検証用 */
    get table() { return table; },
    debugSkipLights() { if (state === 'grid' || state === 'lights') { timer = 99; state = 'lights'; lightsHold = 0; } },
  };
}
