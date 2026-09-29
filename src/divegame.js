import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { DIVE_STAND } from './diving.js';

/**
 * スキューバダイビングの女の子：プレイヤーが潜ると、いっしょに潜る（画面が暗くなるあいだに、道具をつけて水の中へ）。
 *
 * - 道具：背中のタンク（黄色）と背板、マスク、口のレギュレーター、足のフィン。潜っているあいだだけ付ける
 * - 泳ぐ：うつ伏せのばた足（character.setSwim）。プレイヤーの右前（前 1.8m・右 1.4m・少し下）へ寄る。
 *   ときどき（10〜16 秒ごと）近くの根（サンゴの山）へ泳いでいって、しばらく眺めてから戻る
 * - 見る：ふだんはプレイヤー、根へ行ったらサンゴ、近くに魚がいれば魚
 * - 泡：3.5〜4.5 秒ごとに口から
 * - 声：水の中では「（ぶくぶく）…」とつぶやく（クマノミのイソギンチャクの近くでは 1 回だけ「クマノミだ！」）
 * - 上がる：プレイヤーが浜へ戻ると、道具を外して受付の前（浜）に立つ
 */
export function createDiveGame({ character, diving, reef, fish = null, voice = null, playerHead = null }) {
  const body = character.body;
  let state = 'off';           // off / dive
  let playerRiding = false;
  let onFinish = null;
  const driver = { get state() { return `dive:${state}`; } };
  const tmp = new THREE.Vector3();
  const target = new THREE.Vector3();
  const swimPos = new THREE.Vector3();    // 腰の位置
  const vel = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  const head = new THREE.Vector3();
  let phase = 0;
  let bubbleIn = 2;
  let visitIn = 12;
  let visit = null;           // 見に行く根 { x, y, z, until }
  let talkIn = 8;
  let saidClown = false;
  let gear = null;

  // --- 道具 ------------------------------------------------------------------------
  function makeGear() {
    const humanoid = character.vrm?.humanoid;
    if (!humanoid) return null;
    const bone = (n) => humanoid.getNormalizedBoneNode(n);
    const parts = [];
    const add = (parent, obj) => { if (parent) { parent.add(obj); parts.push(obj); } };
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c012, roughness: 0.35, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f7fd0, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 });
    // タンクと背板（胸の骨の後ろ。正規化ボーンは休止姿勢で +Z が前）
    const tank = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.56, 14), yellow);
    tank.add(cyl);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.07, 8), black);
    valve.position.y = 0.31;
    tank.add(valve);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), black);
    plate.position.z = 0.1;
    tank.add(plate);
    tank.position.set(0, -0.04, -0.2);
    add(bone('chest') ?? bone('upperChest') ?? bone('spine'), tank);
    // マスク（目の前のガラスと黒いふち）とレギュレーター
    const mask = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.03), black);
    mask.add(frame);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.055, 0.012), glass);
    lens.position.z = 0.017;
    mask.add(lens);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 20), black);
    strap.rotation.x = Math.PI / 2;
    strap.position.z = -0.08;
    mask.add(strap);
    mask.position.set(0, 0.075, 0.1);
    add(bone('head'), mask);
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.05, 8), black);
    reg.rotation.x = Math.PI / 2;
    reg.position.set(0, 0.015, 0.11);
    add(bone('head'), reg);
    // フィン（つま先の前へ長く）
    for (const side of ['left', 'right']) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.46), blue);
      fin.position.set(0, -0.05, 0.25);
      add(bone(`${side}Foot`), fin);
    }
    return parts;
  }
  function removeGear() {
    for (const p of gear ?? []) p.parent?.remove(p);
    gear = null;
  }

  /** プレイヤーの右前（水の中の、女の子の腰の行き先） */
  function besidePlayer(out) {
    const p = diving.position;
    const y = diving.state.yaw;
    const fx = Math.sin(y);
    const fz = Math.cos(y);
    return out.set(p.x + fx * 1.8 - fz * 1.4, p.y - 0.35, p.z + fz * 1.8 + fx * 1.4);
  }

  function start() {
    if (state !== 'off') return;
    state = 'dive';
    body.drive(driver);
    body.setAttend(false);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setSeat(0, 'upright');
    body.setGrip(0);
    body.setFootFloor(null);
    removeGear();
    gear = makeGear();
    besidePlayer(swimPos);
    vel.set(0, 0, 0);
    phase = 0;
    visit = null;
    visitIn = 12;
    talkIn = 6;
    saidClown = false;
    body.setSwim(true, 0, 0.6);
    body.position.set(swimPos.x, swimPos.y - body.hipsHeight, swimPos.z);
    voice?.say('diveStart');
    body.smile(2.5, 1);
  }

  function finish() {
    if (state === 'off') return;
    state = 'off';
    removeGear();
    body.setSwim(false);
    body.setAttend(true);
    // 受付の前（浜）に立つ
    body.position.set(DIVE_STAND.x + 1.1, 0, DIVE_STAND.z + 1.8);
    body.position.y = diving.side(tmp).y;
    voice?.say('diveEnd');
    body.smile(2.5, 1);
    onFinish?.();
  }

  function update(dt) {
    if (!body.loaded) return;
    if (state === 'off') return;
    if (!playerRiding) { finish(); return; }
    dt = Math.min(dt, 0.05);
    // 行き先：ふだんはプレイヤーの右前。ときどき近くの根へ見に行く
    visitIn -= dt;
    if (!visit && visitIn <= 0) {
      const p = diving.position;
      const near = reef.heads.filter((h) => Math.hypot(h.x - p.x, h.z - p.z) < 12);
      const h = near[Math.floor(Math.random() * near.length)];
      if (h) visit = { x: h.x + (Math.random() - 0.5) * 1.5, y: h.y + h.size * 0.75 + 0.9, z: h.z + (Math.random() - 0.5) * 1.5, until: 7 + Math.random() * 4 };
      visitIn = 10 + Math.random() * 6;
    }
    if (visit) {
      target.set(visit.x, visit.y, visit.z);
      visit.until -= dt;
      // プレイヤーから離れすぎたら戻る
      if (visit.until <= 0 || target.distanceTo(diving.position) > 9) visit = null;
    }
    if (!visit) besidePlayer(target);
    // 泳ぐ：行き先へ（近いほどゆっくり）
    tmp.subVectors(target, swimPos);
    const d = tmp.length();
    const want = tmp.multiplyScalar(Math.min(1.9, d * 0.9) / Math.max(d, 1e-3));
    vel.lerp(want, Math.min(1, dt * 1.6));
    swimPos.addScaledVector(vel, dt);
    const floor = reef.floorAt(swimPos.x, swimPos.z) + 0.45;
    if (swimPos.y < floor) swimPos.y = floor;
    if (swimPos.y > SEA_LEVEL - 0.45) swimPos.y = SEA_LEVEL - 0.45;
    body.position.set(swimPos.x, swimPos.y - body.hipsHeight, swimPos.z);
    // 向き：進んでいれば進む向き、止まっていればプレイヤーの向き
    const sp = Math.hypot(vel.x, vel.z);
    const yaw = sp > 0.25 ? Math.atan2(vel.x, vel.z) : diving.state.yaw;
    body.turnTowards(yaw, dt * 2);
    // ばた足：速いほど速く大きく
    phase += dt * (2.2 + sp * 3.5);
    body.setSwim(true, phase, 0.35 + Math.min(1, sp / 1.2) * 0.65);
    // 見る
    head.set(swimPos.x + Math.sin(yaw) * 0.6, swimPos.y + 0.1, swimPos.z + Math.cos(yaw) * 0.6);
    if (visit) gaze.position.set(visit.x, visit.y - 0.6, visit.z);
    else if (fish && fish.nearest(head, tmp) < 2.5) gaze.position.copy(tmp);
    else if (playerHead) playerHead(gaze.position);
    character.watch(gaze);
    // 泡
    bubbleIn -= dt;
    if (bubbleIn <= 0) { bubbleIn = 3.5 + Math.random(); diving.blow(head, 10); }
    // 声
    talkIn -= dt;
    if (!saidClown && reef.anemones.some((a) => a.distanceTo(swimPos) < 2.5)) { saidClown = true; voice?.say('diveClown'); talkIn = Math.max(talkIn, 10); body.smile(2.5, 1); }
    else if (talkIn <= 0) { talkIn = 18 + Math.random() * 12; voice?.say('diveFun', { chance: 0.85 }); body.smile(2, 0.8); }
  }

  return {
    start,
    update,
    finish,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    /** 女の子の腰の位置（魚が逃げる相手） */
    get position() { return swimPos; },
  };
}
