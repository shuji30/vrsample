import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { REEF } from './reef.js';

/**
 * スキューバダイビング：浜の西のダイビングの受付（タンクの台と看板）で E（VR はトリガー）を押すと、
 * 沖のサンゴ礁（reef.js）の上の水の中へ。泳いで、サンゴと熱帯魚を見る。もう一度 E（VR は左グリップ 0.5 秒）で浜へ戻る。
 * kartdrive.js から乗り物と同じ窓口で使う（kind 'diver'）。
 *
 * 泳ぎ方
 *   PC        … W / S 前へ・後ろへ（見ている向きへ）、A / D 向きを変える、スペース 上へ、Shift・G 下へ、
 *                R / F 見上げる・見下ろす。C で後ろからの視点
 *   VR        … 右トリガーで、見ている向き（上下も）へ進む。左トリガーで後ろへ。左スティックで向きを変える、
 *                右スティックの上下で上がる・下がる。体は起こしたまま（酔いにくいように）
 *   スマホ     … 右下の「進む」（W）・「上へ」（スペース）・「下へ」（G）、左下の ◀ ▶ で向き、画面をなぞって見まわす（上下も）、「浜へ」（E）
 *   ゲームパッド … 左スティック、RB で上へ、LB で下へ
 * 水面（の 35cm 下）より上・海の底や根より下へは行かない。サンゴ礁のまわり 30m より外へは出られない。
 *
 * 水の中：霧を青緑に濃くし（見通し 30m）、空も同じ色に。水面は下から見ると明るい波の天井。
 * まわりに漂う白い粒（マリンスノー）、息を吐くたびに上がる泡（吸う音・泡の音）。
 * 水の中らしい見え方は world.js が setUnderwater で入れる（ここでは onUnderwater を呼ぶだけ）
 */
export const DIVE_STAND = { x: -36, z: -83.2 };
const MAX_SPEED = 1.5;
const AREA_R = REEF.r + 30;

export function createDiving({ scene, renderer, camera, reef, groundAt, beachGround }) {
  // --- 浜の受付：タンクの台・看板・ダイバーの旗 ----------------------------------------------
  const stand = new THREE.Group();
  stand.name = 'diveStand';
  const gy = beachGround(DIVE_STAND.x, DIVE_STAND.z);
  stand.position.set(DIVE_STAND.x, gy, DIVE_STAND.z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.85 });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const rack = shade(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.5), wood));
  rack.position.y = 0.55;
  stand.add(rack);
  for (const x of [-0.62, 0.62]) for (const z of [-0.2, 0.2]) {
    const leg = shade(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), wood));
    leg.position.set(x, 0.275, z);
    stand.add(leg);
  }
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xf2c012, roughness: 0.35, metalness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5 });
  for (const x of [-0.35, 0, 0.35]) {
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 16), tankMat));
    t.position.set(x, 0.59 + 0.31, 0);
    stand.add(t);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), black);
    v.position.set(x, 0.59 + 0.66, 0);
    stand.add(v);
  }
  // 看板
  const sc = document.createElement('canvas');
  sc.width = 512; sc.height = 256;
  const sx = sc.getContext('2d');
  sx.fillStyle = '#0f5c8a'; sx.fillRect(0, 0, 512, 256);
  sx.fillStyle = '#fff'; sx.textAlign = 'center';
  sx.font = 'bold 60px sans-serif'; sx.fillText('ダイビング', 256, 100);
  sx.font = '32px sans-serif'; sx.fillText('サンゴと熱帯魚の海へ', 256, 160);
  sx.font = '28px sans-serif'; sx.fillText('E / トリガー で もぐる', 256, 215);
  const signTex = new THREE.CanvasTexture(sc);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = shade(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 })));
  sign.position.set(0, 1.55, -0.02);
  stand.add(sign);
  const back = shade(new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.66, 0.03), wood));
  back.position.set(0, 1.55, -0.045);
  stand.add(back);
  for (const x of [-0.58, 0.58]) {
    const post = shade(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), wood));
    post.position.set(x, 0.95, -0.08);
    stand.add(post);
  }
  // ダイバーの旗（赤に白い斜めの帯）
  const fc = document.createElement('canvas');
  fc.width = 128; fc.height = 96;
  const fx = fc.getContext('2d');
  fx.fillStyle = '#d4202a'; fx.fillRect(0, 0, 128, 96);
  fx.strokeStyle = '#fff'; fx.lineWidth = 18;
  fx.beginPath(); fx.moveTo(0, 0); fx.lineTo(128, 96); fx.stroke();
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(fc), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.88, 2.3, -0.08);
  stand.add(flag);
  const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.5, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 })));
  pole.position.set(0.62, 1.25, -0.08);
  stand.add(pole);
  // 受付の看板は +Z（浜の奥、北）を向く。海（南、-Z）を背に
  scene.add(stand);

  // --- 水の中の見え方 ---------------------------------------------------------------------
  const under = new THREE.Group();
  under.name = 'underwater';
  under.visible = false;
  scene.add(under);
  // 下から見た水面：明るい波の天井（遠くは霧の色に溶ける）
  const rip = document.createElement('canvas');
  rip.width = rip.height = 256;
  const rx = rip.getContext('2d');
  rx.fillStyle = '#5fc8e0'; rx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 160; k++) {
    rx.strokeStyle = `rgba(230,255,255,${0.15 + Math.random() * 0.35})`;
    rx.lineWidth = 1 + Math.random() * 3;
    rx.beginPath();
    const x0 = Math.random() * 256;
    const y0 = Math.random() * 256;
    rx.ellipse(x0, y0, 6 + Math.random() * 26, 3 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
    rx.stroke();
  }
  const ripTex = new THREE.CanvasTexture(rip);
  ripTex.wrapS = ripTex.wrapT = THREE.RepeatWrapping;
  ripTex.repeat.set(270, 270);
  // 海と同じくらい広く（狭いと、水平線のすぐ上で何にも当たらず、背景の黒が帯になって見えた）
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(1800, 96), new THREE.MeshBasicMaterial({ map: ripTex, color: 0xffffff, side: THREE.DoubleSide, fog: true }));
  ceiling.rotation.x = Math.PI / 2;               // 表を下へ
  ceiling.position.set(REEF.x, SEA_LEVEL - 0.02, REEF.z);
  under.add(ceiling);
  // マリンスノー：目のまわり 8m に漂う白い粒
  const SNOW = 500;
  const snowPos = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW * 3; i++) snowPos[i] = (Math.random() - 0.5) * 16;
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dx = dot.getContext('2d');
  const grad = dx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dx.fillStyle = grad;
  dx.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dot);
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.03, color: 0xe8fbff, transparent: true, opacity: 0.55, depthWrite: false }));
  snow.frustumCulled = false;
  under.add(snow);
  // 泡：息を吐くたびに、口のあたりから上へ（女の子の泡も）
  const BUB = 400;
  const bubPos = new Float32Array(BUB * 3).fill(-1000);
  const bubVel = new Float32Array(BUB);
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  const bc = document.createElement('canvas');
  bc.width = bc.height = 32;
  const bx = bc.getContext('2d');
  bx.strokeStyle = 'rgba(255,255,255,0.95)'; bx.lineWidth = 3;
  bx.beginPath(); bx.arc(16, 16, 12, 0, Math.PI * 2); bx.stroke();
  bx.fillStyle = 'rgba(220,250,255,0.25)'; bx.fill();
  bx.fillStyle = 'rgba(255,255,255,0.9)'; bx.beginPath(); bx.arc(11, 11, 3, 0, Math.PI * 2); bx.fill();
  const bubbles = new THREE.Points(bubGeo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(bc), size: 0.05, transparent: true, depthWrite: false }));
  bubbles.frustumCulled = false;
  under.add(bubbles);
  let bubNext = 0;
  function blow(p, n = 12) {
    for (let k = 0; k < n; k++) {
      const i = bubNext;
      bubNext = (bubNext + 1) % BUB;
      bubPos[i * 3] = p.x + (Math.random() - 0.5) * 0.08;
      bubPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.05 - k * 0.012;
      bubPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.08;
      bubVel[i] = 0.5 + Math.random() * 0.5;
    }
  }

  // --- ダイバー（プレイヤー） -------------------------------------------------------------
  const group = new THREE.Group();          // ダイバーの位置（見えない）
  scene.add(group);
  const steering = new THREE.Object3D();    // ハンドルは無い（両手でハンドルを握る判定に掛からない所へ）
  steering.position.set(0, -5000, 0);
  scene.add(steering);
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const state = { yaw: Math.PI, speed: 0, steer: 0, onGrass: false, lateral: 0, travelYaw: Math.PI, pitch: 0.15 };
  const keys = new Set();
  window.addEventListener('keydown', (e) => { if (e.target?.tagName !== 'INPUT') keys.add(e.code); });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  let active = false;
  let onUnderwater = null;
  let breath = 0;
  let onBreath = null;
  const dir = new THREE.Vector3();
  const _v = new THREE.Vector3();
  let hud = null;
  const touch = () => document.body.classList.contains('touch');
  // スマホ：潜っているあいだは、画面を指でなぞると見る向き（左右・上下）が変わる（PC の R / F・A / D の代わり）
  let dragId = null;
  let dragX = 0;
  let dragY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!active || renderer.xr.isPresenting || dragId !== null) return;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId || !active) return;
    state.yaw -= (e.clientX - dragX) * 0.006;
    state.pitch = THREE.MathUtils.clamp(state.pitch + (e.clientY - dragY) * 0.006, -1.2, 1.2);
    dragX = e.clientX;
    dragY = e.clientY;
  });
  const endDrag = (e) => { if (e.pointerId === dragId) dragId = null; };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  /** 入る所：礁の北のふち、水深 3m あたり。南（礁のまん中）を向いて */
  function startPoint(out) {
    const x = REEF.x + 4;
    const z = REEF.z + REEF.r * 0.75;
    return out.set(x, Math.max(groundAt(x, z) + 1.6, SEA_LEVEL - 3), z);
  }

  function begin() {
    if (active) return;
    active = true;
    startPoint(pos);
    vel.set(0, 0, 0);
    state.yaw = Math.PI;
    state.pitch = 0.15;
    state.speed = 0;
    breath = 1.5;
    under.visible = true;
    reef.group.visible = true;
    onUnderwater?.(true);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'dive-hud';
      hud.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;background:rgba(0,40,60,0.55);color:#e8fbff;font:14px sans-serif;pointer-events:none;z-index:5;text-align:center';
      document.body.appendChild(hud);
    }
    hud.style.display = renderer.xr.isPresenting ? 'none' : '';
  }
  function end() {
    if (!active) return;
    active = false;
    under.visible = false;
    reef.group.visible = false;
    onUnderwater?.(false);
    if (hud) hud.style.display = 'none';
  }

  /** VR の右スティックの上下（上へ +） */
  function xrRise() {
    const session = renderer.xr.getSession?.();
    if (!session) return 0;
    let v = 0;
    [...session.inputSources].forEach((s, i) => {
      const hand = s.handedness === 'left' || s.handedness === 'right' ? s.handedness : i === 0 ? 'left' : 'right';
      if (hand !== 'right' || !s.gamepad) return;
      const y = Math.abs(s.gamepad.axes[3] ?? 0) > Math.abs(s.gamepad.axes[1] ?? 0) ? s.gamepad.axes[3] ?? 0 : s.gamepad.axes[1] ?? 0;
      if (Math.abs(y) > 0.2) v = -y;
    });
    return v;
  }

  const vehicle = {
    kind: 'diver',
    silent: true,
    body: stand,
    group,
    steering,
    state,
    get speed() { return state.speed; },
    get active() { return active; },
    /** 目の位置（ワールド） */
    eye(out) { return out.copy(pos); },
    /** 降りる所：受付の前（浜） */
    side(out) { return out.set(DIVE_STAND.x, beachGround(DIVE_STAND.x, DIVE_STAND.z + 1.6), DIVE_STAND.z + 1.6); },
    /** 乗り口：受付 */
    enterPoint(from, out) { return out.set(DIVE_STAND.x, gy, DIVE_STAND.z); },
    place() {},
    begin,
    end,
    set onUnderwater(fn) { onUnderwater = fn; },
    /** 息を吐いたとき（泡の音を鳴らす） */
    set onBreath(fn) { onBreath = fn; },
    blow,
    get position() { return pos; },
    /** PC の一人称：見ている向き（上下も） */
    firstView(cam) {
      cam.position.copy(pos);
      const cp = Math.cos(state.pitch);
      cam.lookAt(pos.x + Math.sin(state.yaw) * cp, pos.y - Math.sin(state.pitch), pos.z + Math.cos(state.yaw) * cp);
    },
    /** PC の後ろからの視点 */
    chase(cam) {
      const f = _v.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
      cam.position.set(pos.x - f.x * 2.6, Math.min(SEA_LEVEL - 0.3, pos.y + 0.9), pos.z - f.z * 2.6);
      cam.lookAt(pos.x + f.x * 2, pos.y - 0.2, pos.z + f.z * 2);
    },
    update(dt, input, clamp, { xr = false } = {}) {
      if (!active) begin();
      dt = Math.min(dt, 0.05);
      // 向きを変える
      state.steer = input.steer;
      state.yaw += input.steer * 1.1 * dt;
      // 進む向き：VR は頭の向き（上下も）、PC は見ている向き
      if (xr) {
        camera.getWorldDirection(dir);
      } else {
        if (keys.has('KeyR')) state.pitch -= 0.9 * dt;
        if (keys.has('KeyF')) state.pitch += 0.9 * dt;
        state.pitch = THREE.MathUtils.clamp(state.pitch, -1.2, 1.2);
        const cp = Math.cos(state.pitch);
        dir.set(Math.sin(state.yaw) * cp, -Math.sin(state.pitch), Math.cos(state.yaw) * cp);
      }
      const thrust = input.throttle - input.brake * 0.6;
      let rise = (input.handbrake ?? 0) > 0.5 || keys.has('Space') ? 1 : 0;
      if (keys.has('KeyG') || (!touch() && (keys.has('ShiftLeft') || keys.has('ShiftRight')))) rise -= 1;
      if (xr) rise += xrRise();
      _v.copy(dir).multiplyScalar(thrust * MAX_SPEED);
      _v.y += rise * 0.8;
      // 水の抵抗：ゆっくり速くなり、ゆっくり止まる
      vel.lerp(_v, Math.min(1, dt * 1.4));
      pos.addScaledVector(vel, dt);
      // 水面・海の底・根・サンゴ礁のまわりの外
      const floor = reef.floorAt(pos.x, pos.z) + 0.55;
      if (pos.y < floor) { pos.y = floor; vel.y = Math.max(0, vel.y); }
      if (pos.y > SEA_LEVEL - 0.35) { pos.y = SEA_LEVEL - 0.35; vel.y = Math.min(0, vel.y); }
      const dx = pos.x - REEF.x;
      const dz = pos.z - REEF.z;
      const d = Math.hypot(dx, dz);
      if (d > AREA_R) { pos.x = REEF.x + (dx / d) * AREA_R; pos.z = REEF.z + (dz / d) * AREA_R; }
      state.speed = Math.hypot(vel.x, vel.z) * Math.sign(thrust || 1);
      state.travelYaw = state.yaw;
      group.position.copy(pos);
      // 息：4 秒ごと（吸う 1.6 秒、吐く 2.4 秒）。吐くときに泡
      breath -= dt;
      if (breath <= 0) {
        breath = 4 + Math.random() * 0.6;
        _v.set(Math.sin(state.yaw) * 0.12, -0.12, Math.cos(state.yaw) * 0.12).add(pos);
        setTimeout(() => { if (active) { blow(_v.clone(), 14); onBreath?.('out'); } }, 1600);
        onBreath?.('in');
      }
      if (hud && !xr) {
        // スマホは水深だけ（操作は右下のボタンに名前で出ている）
        hud.textContent = touch() ? `水深 ${(SEA_LEVEL - pos.y).toFixed(1)}m`
          : `水深 ${(SEA_LEVEL - pos.y).toFixed(1)}m　W/S 進む・A/D 向き・スペース 上・Shift 下・R/F 見上げる/見下ろす・E 浜へ`;
      }
    },
    /** 毎フレーム（乗っていなくても）：泡・マリンスノー・礁 */
    tick(dt, eye) {
      if (!under.visible) return;
      reef.update(dt, eye);
      ripTex.offset.x += dt * 0.012;
      ripTex.offset.y += dt * 0.008;
      // マリンスノー：目のまわりへ回り込ませる
      const s = snowGeo.attributes.position.array;
      for (let i = 0; i < SNOW; i++) {
        s[i * 3 + 1] -= dt * 0.03;
        s[i * 3] += Math.sin((i + ripTex.offset.x * 300) * 0.1) * dt * 0.02;
        for (const [k, c] of [[0, eye.x], [1, eye.y], [2, eye.z]]) {
          const rel = s[i * 3 + k] - c;
          if (rel > 8) s[i * 3 + k] -= 16; else if (rel < -8) s[i * 3 + k] += 16;
        }
      }
      snowGeo.attributes.position.needsUpdate = true;
      // 泡：揺れながら上がって、水面で消える
      for (let i = 0; i < BUB; i++) {
        if (bubPos[i * 3 + 1] < -500) continue;
        bubPos[i * 3 + 1] += bubVel[i] * dt;
        bubPos[i * 3] += Math.sin(bubPos[i * 3 + 1] * 9 + i) * dt * 0.08;
        if (bubPos[i * 3 + 1] > SEA_LEVEL - 0.05) bubPos[i * 3 + 1] = -1000;
      }
      bubGeo.attributes.position.needsUpdate = true;
    },
  };
  stand.userData.interactive = true;
  return vehicle;
}
