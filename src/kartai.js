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

  /**
   * @param {{ speedCap?: number, target?: { x: number, z: number } }} [options]
   *   speedCap は出す速さの上限（m/s）。target を渡すと、コースの線でなくその点を狙う
   *   （スタートの枠へ戻るときの最後の寄せ）
   */
  function update({ speedCap = Infinity, target: aim = null, rival = null } = {}) {
    const s = kart.state;
    const speed = Math.abs(s.speed);
    const u = s.u;

    // --- ハンドル：先の点を狙う（曲がりの内側へ少し寄せる）
    const look = 2.4 + speed * 0.35;
    const aheadU = u + look / TRACK_LENGTH;
    trackPoint(aheadU, target);
    const k = curvature(u + (look + 3) / TRACK_LENGTH);
    let inside = THREE.MathUtils.clamp(k * 6, -1, 1) * (KART_TRACK.width / 2 - 0.75) * (0.4 + 0.6 * level);
    // 前に相手のカートがいたら、横へずれて抜きにかかる（同じ線のまま追突し続けないように）。
    // lateral は右が +、この寄せ（inside）は左が +
    let rivalAhead = Infinity;
    if (rival) {
      let du = rival.state.u - u;
      du -= Math.round(du);
      rivalAhead = du * TRACK_LENGTH;
      // 追いついてきたときだけ（こちらが速い、またはすぐ後ろ）。遠くからよけると遠回りで遅くなる
      const closing = speed > Math.abs(rival.speed) + 0.2 || rivalAhead < 2.5;
      // 止まっている・遅い相手は、早めによける
      const reach = Math.abs(rival.speed) < 2 ? 8 : 4.5;
      if (rivalAhead > 0 && rivalAhead < reach && closing) {
        const rivalLeft = -rival.state.lateral;
        const room = KART_TRACK.width / 2 - 0.4;
        if (Math.abs(inside - rivalLeft) < 1.2) {
          const left = rivalLeft + 1.25;
          const right = rivalLeft - 1.25;
          inside = Math.abs(left) <= room ? (Math.abs(right) <= room && Math.abs(right - inside) < Math.abs(left - inside) ? right : left)
            : Math.max(-room, right);
        }
      }
    }
    trackTangent(aheadU, tangentA);
    // 進む向きに対して左は (t.z, -t.x)（右が (-t.z, t.x)）
    target.x += tangentA.z * inside;
    target.z += -tangentA.x * inside;
    if (aim) target.set(aim.x, 0, aim.z);
    const dx = target.x - kart.group.position.x;
    const dz = target.z - kart.group.position.z;
    let alpha = Math.atan2(dx, dz) - s.yaw;
    while (alpha > Math.PI) alpha -= Math.PI * 2;
    while (alpha < -Math.PI) alpha += Math.PI * 2;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const delta = Math.atan((2 * Math.sin(alpha) * KART.wheelBase) / dist);
    const perf = s.perf ?? { top: 1, grip: 1 };
    const fullSpeed = KART.maxSpeed * perf.top;
    const limit = KART.steerMax + (KART.steerMaxFast - KART.steerMax) * Math.min(1, speed / fullSpeed);
    const steer = THREE.MathUtils.clamp(delta / limit, -1, 1);

    // --- 速さ：先の曲がりに間に合う速さ
    const top = KART.maxSpeed * perf.top * (0.72 + 0.26 * level) * (s.boost ?? 1);
    const grip = KART.grip * perf.grip * (0.7 + 0.25 * level);
    let want = Math.min(top, speedCap);
    for (let d = 1; d <= 14; d += 1) {
      const kk = Math.abs(curvature(u + d / TRACK_LENGTH));
      if (kk < 1e-3) continue;
      // 曲がれる速さ：横のグリップと、ハンドルの切れ角（速いほど切れない）の小さいほう
      let corner = Math.sqrt(grip / kk);
      const needed = Math.atan(kk * KART.wheelBase) * 1.1;
      if (needed >= KART.steerMax) corner = Math.min(corner, 1.5);
      else if (needed > KART.steerMaxFast) {
        corner = Math.min(corner, ((KART.steerMax - needed) / (KART.steerMax - KART.steerMaxFast)) * fullSpeed);
      }
      // その曲がりまでにブレーキで落とせる速さ（v² = v0² + 2ad）
      want = Math.min(want, Math.sqrt(corner * corner + 2 * KART.brake * 0.7 * d));
    }
    // すぐ前に相手がいて、横へ出きれていないあいだは、相手の速さまで待つ
    // （止まっている相手のうしろで待つと、いつまでも抜けないので、相手が走っているときだけ）
    if (rivalAhead > 0 && rivalAhead < 1.5 && Math.abs(rival.speed) > 2 && Math.abs(rival.state.lateral - s.lateral) < 0.8) {
      want = Math.min(want, Math.abs(rival.speed) + 0.3);
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
