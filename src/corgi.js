import * as THREE from 'three';

/**
 * ウェルシュ・コーギー（ペンブローク）の「こむぎ」。庭と公園に放し飼いにしてある。
 *
 * 見た目：胴長で脚が短い。大きな立ち耳、きつね顔、赤茶に白（胸・口のまわり・脚・おなか・額の筋）、
 * ふわふわのお尻（しっぽは短い）。体高 0.3m・体長 0.6m。
 *
 * ふるまい（ひとつずつ切り替える）
 *   wander  … 近くの芝生をとことこ歩く。着いたら、においをかぐ・座る・伏せる
 *   zoomies … ときどき急に全力で、ぐるぐる大きな輪を描いて走りまわる（「走りまわってる」）
 *   chase   … キャッチボールの球が飛んだり転がったりしたら、追いかける（くわえはしない）
 *   greet   … プレイヤーが近くに来ると、寄ってきて前に座り、お尻を振って見上げる
 *   follow  … ときどき女の子のあとをついて歩く
 *   happy   … なでられた（VR は手を頭に近づける、PC はクリック）。お尻を振って「ワン！」
 * 歩ける範囲（world.js の clampToBounds）の中だけを動き、池・柵・建物は避ける（ぶつかったら行き先を替える）。
 */

const BARK_COOLDOWN = 4;

function createBark() {
  let ctx = null;
  function ensure() {
    if (ctx) return ctx;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { ctx = new AudioContextClass(); } catch { return null; }
    return ctx;
  }
  /** 「ワン」をひとつ。at は遅らせる秒、volume は距離で小さくした大きさ */
  function woof(at, volume) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.13);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 1100;
    formant.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(formant).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
  return {
    bark(times, volume) {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      for (let i = 0; i < times; i++) woof(i * 0.24, volume);
    },
  };
}

/** こむぎの模型。+Z が前、原点は足元 */
function createModel() {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const red = new THREE.MeshStandardMaterial({ color: 0xd4843a, roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.4 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xe8a0a0, roughness: 0.8 });
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  const shade = (m) => { m.castShadow = true; return m; };
  const blob = (mat, sx, sy, sz, x, y, z, parent = bodyPivot) => {
    const m = shade(new THREE.Mesh(sphere, mat));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // 胴（長い）・胸（白）・おなか（白）・お尻（ふわふわ）
  blob(red, 0.13, 0.12, 0.3, 0, 0.27, -0.02);
  blob(white, 0.1, 0.1, 0.1, 0, 0.25, 0.2);
  blob(white, 0.1, 0.06, 0.24, 0, 0.19, -0.02);
  const butt = blob(red, 0.13, 0.13, 0.12, 0, 0.29, -0.25);
  blob(white, 0.08, 0.07, 0.05, 0, 0.26, -0.34, butt.parent);
  const tail = blob(red, 0.04, 0.04, 0.05, 0, 0.34, -0.37);
  // 首と頭
  const neck = new THREE.Group();
  neck.position.set(0, 0.33, 0.22);
  bodyPivot.add(neck);
  blob(red, 0.09, 0.1, 0.09, 0, 0.02, 0.02, neck);
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.08);
  neck.add(head);
  blob(red, 0.1, 0.09, 0.1, 0, 0, 0, head);
  // 口先：上は赤茶、下あごのまわりだけ白（大きな白い口先にすると、正面から卵のように見えた）
  blob(red, 0.05, 0.04, 0.075, 0, -0.02, 0.085, head);
  blob(white, 0.045, 0.03, 0.065, 0, -0.045, 0.09, head);
  blob(dark, 0.02, 0.016, 0.016, 0, -0.012, 0.158, head);
  blob(white, 0.014, 0.05, 0.012, 0, 0.045, 0.092, head);    // 額の白い筋
  for (const side of [-1, 1]) {
    blob(dark, 0.017, 0.02, 0.012, side * 0.045, 0.025, 0.085, head);
    // 大きな立ち耳（外は赤茶、内は桃色）
    const ear = new THREE.Group();
    ear.position.set(side * 0.055, 0.075, -0.01);
    ear.rotation.z = -side * 0.35;
    head.add(ear);
    const outer = shade(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), red));
    outer.position.y = 0.05;
    outer.scale.z = 0.35;
    ear.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), pink);
    inner.position.set(0, 0.04, 0.012);
    inner.scale.z = 0.25;
    ear.add(inner);
  }
  // 舌（走っているときに出す）
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.05), pink);
  tongue.position.set(0, -0.07, 0.13);
  tongue.rotation.x = 0.5;
  tongue.visible = false;
  head.add(tongue);
  // 短い脚（白い足先）
  const legs = [];
  for (const [x, z] of [[0.07, 0.17], [-0.07, 0.17], [0.07, -0.2], [-0.07, -0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.2, z);
    bodyPivot.add(hip);
    const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.16, 8), red));
    leg.position.y = -0.08;
    hip.add(leg);
    const paw = shade(new THREE.Mesh(sphere, white));
    paw.scale.set(0.035, 0.025, 0.045);
    paw.position.set(0, -0.17, 0.01);
    hip.add(paw);
    legs.push({ hip, front: z > 0, side: x > 0 ? 1 : -1 });
  }
  return { root, bodyPivot, neck, head, tail, butt, legs, tongue };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(x: number, z: number, inset: number, from?: {x,z}) => {x,z}} o.clamp 歩ける範囲へ寄せる
 * @param {(x: number, z: number) => number} o.groundHeight
 * @param {() => THREE.Vector3} o.playerPosition 目の位置（カメラ）
 * @param {() => THREE.Vector3|null} o.girlPosition
 * @param {THREE.Object3D} o.ball キャッチボールの球
 * @param {() => THREE.Object3D[]} o.hands VR の手（なでる）
 */
export function createCorgi({ scene, clamp, groundHeight = () => 0, playerPosition, girlPosition, ball, voice = null, areas }) {
  let hands = () => [];
  const model = createModel();
  const group = new THREE.Group();
  group.name = 'corgi';
  group.add(model.root);
  scene.add(group);
  // なでるときにつかめる所（体のまわりの見えない箱。PC はクリック、VR はトリガー）
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45, 0.75), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.y = 0.25;
  group.add(body);
  body.userData.interactive = true;

  const barkSound = createBark();
  const pos = new THREE.Vector3(2.5, 0, -8.5);
  group.position.copy(pos);
  let yaw = 0;
  let speed = 0;
  let mode = 'wander';
  let modeTime = 0;
  let target = new THREE.Vector2(pos.x, pos.z);
  let pose = 'stand';          // stand / sit / lie / sniff
  let poseFor = 0;
  let wantSpeed = 0;
  let phase = 0;
  let clock = 0;
  let zoomLeft = 0;
  let zoomCenter = new THREE.Vector2();
  let zoomAngle = 0;
  let nextZoomies = 25 + Math.random() * 30;
  let nextFollow = 40 + Math.random() * 40;
  let lastGreet = -100;
  let lastBark = -100;
  let wag = 0;
  let stuck = 0;
  let happyFor = 0;
  const tmp = new THREE.Vector3();
  const headWorld = new THREE.Vector3();

  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const rand = (a, b) => a + Math.random() * (b - a);

  function pickWanderTarget(radius = 6) {
    // 近くの、歩ける範囲の中の点（遠くの範囲へもときどき）
    for (let k = 0; k < 12; k++) {
      let x;
      let z;
      if (Math.random() < 0.15 && areas?.length) {
        const a = areas[Math.floor(Math.random() * areas.length)];
        x = rand(a.minX, a.maxX);
        z = rand(a.minZ, a.maxZ);
      } else {
        const ang = Math.random() * Math.PI * 2;
        const r = rand(1.5, radius);
        x = pos.x + Math.cos(ang) * r;
        z = pos.z + Math.sin(ang) * r;
      }
      const c = clamp(x, z, 0.3);
      if (Math.hypot(c.x - x, c.z - z) < 0.05) { target.set(x, z); return; }
    }
    target.set(pos.x, pos.z);
  }

  function setMode(next) {
    mode = next;
    modeTime = 0;
    pose = 'stand';
  }

  function bark(times = 1) {
    if (clock - lastBark < BARK_COOLDOWN) return;
    lastBark = clock;
    const d = playerPosition().distanceTo(pos);
    barkSound.bark(times, THREE.MathUtils.clamp(0.5 / Math.max(1, d / 2), 0.04, 0.45));
  }

  /** なでられた */
  function pet() {
    setMode('happy');
    happyFor = 3.5;
    wag = 1;
    bark(2);
    voice?.say('corgiPet', { chance: 0.8 });
  }
  body.userData.onSelect = pet;

  function steerTo(x, z, dt, run) {
    const dx = x - pos.x;
    const dz = z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const want = Math.atan2(dx, dz);
      const rate = run ? 5.5 : 3.5;
      yaw += THREE.MathUtils.clamp(angleDelta(want, yaw), -rate * dt, rate * dt);
    }
    return d;
  }

  function update(dt) {
    clock += dt;
    modeTime += dt;
    const player = playerPosition();
    const girl = girlPosition?.();
    const bd = ball?.userData;
    const ballFree = bd && !bd.held;
    const ballFast = ballFree && (bd.velocity?.length?.() ?? 0) > 1.2;
    const playerNear = Math.hypot(player.x - pos.x, player.z - pos.z) < 4.5;

    // 何をするか（強いものから）
    if (mode !== 'happy' && mode !== 'chase' && ballFast && ball.position.distanceTo(pos) < 16 && Math.random() < 0.02) {
      setMode('chase');
      bark(2);
    } else if ((mode === 'wander' || mode === 'follow') && playerNear && clock - lastGreet > 35) {
      setMode('greet');
      lastGreet = clock;
    } else if (mode === 'wander' && clock > nextZoomies) {
      setMode('zoomies');
      zoomLeft = rand(6, 11);
      const c = clamp(pos.x + rand(-2, 2), pos.z + rand(-2, 2), 3.5);
      zoomCenter.set(c.x, c.z);
      zoomAngle = Math.atan2(pos.z - zoomCenter.y, pos.x - zoomCenter.x);
      nextZoomies = clock + rand(45, 90);
      bark(2);
    } else if (mode === 'wander' && girl && clock > nextFollow) {
      setMode('follow');
      nextFollow = clock + rand(50, 90);
    }

    wantSpeed = 0;
    switch (mode) {
      case 'wander': {
        if (pose !== 'stand') {
          poseFor -= dt;
          if (poseFor <= 0) { pose = 'stand'; pickWanderTarget(); }
          break;
        }
        const d = steerTo(target.x, target.y, dt, false);
        wantSpeed = d > 2.5 ? 1.5 : 0.8;
        if (d < 0.35) {
          const r = Math.random();
          pose = r < 0.35 ? 'sniff' : r < 0.7 ? 'sit' : r < 0.85 ? 'lie' : 'stand';
          poseFor = pose === 'sniff' ? rand(2, 4) : pose === 'sit' ? rand(3, 6) : pose === 'lie' ? rand(6, 12) : 0.5;
          if (pose === 'stand') pickWanderTarget();
        }
        break;
      }
      case 'zoomies': {
        // 大きな輪（半径 3.5m）を、全力で。途中で向きを変えて 8 の字に
        zoomLeft -= dt;
        zoomAngle += dt * (4.2 / 3.5) * (Math.floor(modeTime / 3) % 2 ? -1 : 1);
        const tx = zoomCenter.x + Math.cos(zoomAngle) * 3.5;
        const tz = zoomCenter.y + Math.sin(zoomAngle) * 3.5;
        steerTo(tx, tz, dt, true);
        wantSpeed = 4.2;
        if (zoomLeft <= 0) { setMode('wander'); pose = 'lie'; poseFor = rand(4, 7); }
        break;
      }
      case 'chase': {
        if (!ballFree) { setMode('wander'); pose = 'sit'; poseFor = 2; break; }
        const d = steerTo(ball.position.x, ball.position.z, dt, true);
        wantSpeed = d > 1 ? 3.8 : 0;
        if (d < 0.9) { pose = 'sit'; }
        if (modeTime > 12) setMode('wander');
        break;
      }
      case 'greet': {
        // プレイヤーの前 0.9m へ来て座り、見上げる
        const fx = player.x - pos.x;
        const fz = player.z - pos.z;
        const d = Math.hypot(fx, fz);
        if (d > 1.0 && pose === 'stand') {
          steerTo(player.x - (fx / d) * 0.9, player.z - (fz / d) * 0.9, dt, false);
          wantSpeed = d > 3 ? 2.6 : 1.4;
        } else {
          pose = 'sit';
          yaw += THREE.MathUtils.clamp(angleDelta(Math.atan2(fx, fz), yaw), -3 * dt, 3 * dt);
          wag = 1;
          if (modeTime > 1.2 && modeTime < 1.3) bark(1);
        }
        if (modeTime > 8 || d > 7) { setMode('wander'); pickWanderTarget(); }
        break;
      }
      case 'follow': {
        if (!girl) { setMode('wander'); break; }
        const d = Math.hypot(girl.x - pos.x, girl.z - pos.z);
        if (d > 1.3) { steerTo(girl.x, girl.z, dt, false); wantSpeed = d > 4 ? 2.4 : 1.2; }
        if (modeTime > 25) { setMode('wander'); pickWanderTarget(); }
        break;
      }
      case 'happy': {
        pose = 'sit';
        wag = 1;
        happyFor -= dt;
        if (happyFor <= 0) { setMode('wander'); pickWanderTarget(); }
        break;
      }
      default:
        setMode('wander');
    }

    // VR：手を頭に近づけるとなでられる
    if (mode !== 'happy') {
      model.head.getWorldPosition(headWorld);
      for (const h of hands()) {
        if (!h?.visible) continue;
        h.getWorldPosition(tmp);
        if (tmp.distanceTo(headWorld) < 0.3 || (tmp.distanceTo(group.position) < 0.35 && tmp.y < 0.6)) { pet(); break; }
      }
    }

    // 動く
    const accel = wantSpeed > speed ? 6 : 8;
    speed += THREE.MathUtils.clamp(wantSpeed - speed, -accel * dt, accel * dt);
    if (pose !== 'stand') speed = Math.max(0, speed - 8 * dt);
    const prev = { x: pos.x, z: pos.z };
    pos.x += Math.sin(yaw) * speed * dt;
    pos.z += Math.cos(yaw) * speed * dt;
    const c = clamp(pos.x, pos.z, 0.25, prev);
    const blocked = Math.hypot(c.x - pos.x, c.z - pos.z) > 1e-4;
    pos.x = c.x;
    pos.z = c.z;
    stuck = blocked && speed > 0.3 ? stuck + dt : 0;
    if (stuck > 0.4) {
      // 行き止まり：行き先を替える（走りまわっているなら、輪の真ん中を寄せる）
      stuck = 0;
      if (mode === 'zoomies') { const cc = clamp(pos.x, pos.z, 4); zoomCenter.set(cc.x, cc.z); zoomAngle += Math.PI; }
      else { yaw += Math.PI * 0.7; pickWanderTarget(4); }
    }
    pos.y = groundHeight(pos.x, pos.z);
    group.position.copy(pos);
    group.rotation.y = yaw;
    animate(dt);
  }

  function animate(dt) {
    const running = speed > 2.2;
    phase += (speed / (running ? 0.7 : 0.4)) * dt;
    const w = Math.PI * 2 * phase;
    const amp = Math.min(1, speed / 1.2);
    model.legs.forEach((leg, i) => {
      // 歩く：対角の脚がいっしょ。走る：前の 2 本・後ろの 2 本がそろう（跳ねる）
      const off = running ? (leg.front ? 0 : Math.PI) : (i === 0 || i === 3 ? 0 : Math.PI);
      leg.hip.rotation.x = Math.sin(w + off) * (running ? 0.9 : 0.55) * amp;
    });
    let bob = Math.abs(Math.sin(w)) * (running ? 0.03 : 0.012) * amp;
    let bodyPitch = running ? Math.sin(w) * 0.12 * amp : 0;
    // 座る・伏せる・においをかぐ
    let sit = 0;
    let lie = 0;
    let sniff = 0;
    if (pose === 'sit') sit = 1;
    if (pose === 'lie') lie = 1;
    if (pose === 'sniff') sniff = 1;
    // 座るときは、後ろ脚の付け根（z -0.2・高さ 0.2）を中心に体を起こす（足元を中心にすると、前が浮いた）
    const a = bodyPitch - sit * 0.5;
    const py = 0.2;
    const pz = -0.2;
    model.bodyPivot.rotation.x = a;
    model.bodyPivot.position.set(0, py - (py * Math.cos(a) - pz * Math.sin(a)) + bob - lie * 0.11 - sit * 0.1, pz - (py * Math.sin(a) + pz * Math.cos(a)));
    if (sit) {
      // 後ろ脚は前へたたみ、前脚は地面へまっすぐ（体を起こしたぶん戻す）
      model.legs[2].hip.rotation.x = -1.35 - a;
      model.legs[3].hip.rotation.x = -1.35 - a;
      model.legs[0].hip.rotation.x = -a;
      model.legs[1].hip.rotation.x = -a;
    }
    if (lie) model.legs.forEach((l) => { l.hip.rotation.x = l.front ? -1.3 : 1.3; });
    model.neck.rotation.x = sniff * 0.9 * (0.8 + 0.2 * Math.sin(clock * 9)) - sit * 0.35 + (running ? 0.15 : 0);
    // 頭：座っているときはプレイヤーを見上げる感じで少し傾ける
    model.head.rotation.z = Math.sin(clock * 0.9) * 0.08 * (1 - amp) + (sit ? 0.12 * Math.sin(clock * 0.5) : 0);
    // お尻としっぽを振る（うれしいとき・走っているとき）
    wag = Math.max(0, wag - dt * 0.2);
    const wagging = Math.max(wag, running ? 0.6 : 0.15);
    model.tail.position.x = Math.sin(clock * 16) * 0.025 * wagging;
    model.butt.rotation.y = Math.sin(clock * 16) * 0.12 * wagging;
    model.tongue.visible = running || mode === 'happy' || mode === 'greet';
  }

  return {
    group,
    body,
    update,
    pet,
    /** VR の手（なでる）。main.js がコントローラーを渡す */
    setHands(fn) { hands = fn; },
    get mode() { return mode; },
    get pose() { return pose; },
    get speed() { return speed; },
    get position() { return pos; },
    /** 検証用 */
    debugZoomies() { nextZoomies = 0; setMode('wander'); },
    debugPlace(x, z) { pos.set(x, groundHeight(x, z), z); target.set(x, z); },
  };
}
