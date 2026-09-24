import * as THREE from 'three';
import { KART } from './kart.js';
import { KART_TRACK, TRACK_LENGTH, trackPoint, trackTangent } from './karttrack.js';

/**
 * カートを自動で走らせる（女の子の運転）。
 *
 * ハンドル：コースの中心線の少し先（速いほど遠く）を狙う（ピュアパーシュート）。
 *   曲がりの内側へ少し寄せた線を走る（コーナーの手前で外、頂点で内）。
 * 速さ：14m 先までの曲がり具合を見て、曲がれる速さ（横の加速度がグリップの 8 割）に
 *   ブレーキで間に合うように落とす。
 *
 * skill（0..1）で、出す速さ（最高速の何割か）と、曲がりで欲張る度合いを変える。
 */
export function createKartAI(kart, { skill = 0.85 } = {}) {
  const target = new THREE.Vector3();
  const tangentA = new THREE.Vector3();
  const tangentB = new THREE.Vector3();
  let level = skill;

  /** u での曲がり具合（1/m、左曲がりが +） */
  function curvature(u) {
    const du = 1 / TRACK_LENGTH;
    trackTangent(u - du, tangentA);
    trackTangent(u + du, tangentB);
    // 向きが +Z から +X へ回る（yaw が増える）のが左曲がり。そのとき、この外積は正
    const cross = tangentA.z * tangentB.x - tangentA.x * tangentB.z;
    const angle = Math.asin(THREE.MathUtils.clamp(cross, -1, 1));
    return angle / 2;   // 2m で曲がった角度 / 2m
  }

  function update() {
    const s = kart.state;
    const speed = Math.abs(s.speed);
    const u = s.u;

    // --- ハンドル：先の点を狙う（曲がりの内側へ少し寄せる）
    const look = 2.4 + speed * 0.35;
    const aheadU = u + look / TRACK_LENGTH;
    trackPoint(aheadU, target);
    const k = curvature(u + (look + 3) / TRACK_LENGTH);
    const inside = THREE.MathUtils.clamp(k * 6, -1, 1) * (KART_TRACK.width / 2 - 0.75) * (0.4 + 0.6 * level);
    trackTangent(aheadU, tangentA);
    // 進む向きに対して左は (t.z, -t.x)（右が (-t.z, t.x)）
    target.x += tangentA.z * inside;
    target.z += -tangentA.x * inside;
    const dx = target.x - kart.group.position.x;
    const dz = target.z - kart.group.position.z;
    let alpha = Math.atan2(dx, dz) - s.yaw;
    while (alpha > Math.PI) alpha -= Math.PI * 2;
    while (alpha < -Math.PI) alpha += Math.PI * 2;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const delta = Math.atan((2 * Math.sin(alpha) * KART.wheelBase) / dist);
    const limit = KART.steerMax + (KART.steerMaxFast - KART.steerMax) * Math.min(1, speed / KART.maxSpeed);
    const steer = THREE.MathUtils.clamp(delta / limit, -1, 1);

    // --- 速さ：先の曲がりに間に合う速さ
    const top = KART.maxSpeed * (0.72 + 0.26 * level);
    const grip = KART.grip * (0.7 + 0.15 * level);
    let want = top;
    for (let d = 1; d <= 14; d += 1) {
      const kk = Math.abs(curvature(u + d / TRACK_LENGTH));
      if (kk < 1e-3) continue;
      const corner = Math.sqrt(grip / kk);
      // その曲がりまでにブレーキで落とせる速さ（v² = v0² + 2ad）
      want = Math.min(want, Math.sqrt(corner * corner + 2 * KART.brake * 0.7 * d));
    }
    // 大きくずれている（コースの外、向きが違う）ときは、ゆっくり戻る
    if (Math.abs(alpha) > 0.8 || s.onGrass) want = Math.min(want, 3.0);
    let throttle = THREE.MathUtils.clamp((want - speed) * 1.2 + 0.2, 0, 1);
    let brake = speed > want + 0.4 ? THREE.MathUtils.clamp((speed - want) * 0.8, 0, 1) : 0;
    if (brake > 0) throttle = 0;
    return { steer, throttle, brake };
  }

  return {
    update,
    get skill() { return level; },
    set skill(v) { level = THREE.MathUtils.clamp(v, 0, 1); },
  };
}
