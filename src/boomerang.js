import * as THREE from 'three';

/**
 * ブーメラン。部屋の食卓に置いてあり、つかんで投げる（VR はトリガーで握って振って離す、PC は F）。
 *
 * 飛び方（本物をまねた簡単な式）
 *   - 水平の速さが 3 m/s より速く手を離れたら「飛ぶ」。それより遅いと、ただの小物として落ちる
 *   - 曲がる向き：右手で投げると左へ、左手で投げると右へ（本物と同じ）。VR は手首を倒した向きが優先
 *     （手の甲の上を左へ倒すと左、右へ倒すと右）。PC は F で左、Shift を押しながら F を離すと右
 *     （data.turnSign：+1 左 / -1 右。投げる側が離す前に入れる）
 *   - 曲がる半径は速さに比例（2〜11m）。4 秒ほどで大きく輪を描き、強く投げると 20m ほど先まで飛んで、
 *     投げた人の横・うしろへ戻ってくる（PC は F の長押しで強さをためる）
 *   - 揚力で重力を打ち消す。遅くなるにつれて揚力が減って、ふわっと下りてくる
 *   - 回転（自分の面の法線まわりに 1 秒 8 回転）しながら、内側へ 25° 傾いて飛ぶ
 *   - 家の中と、地面から 1m より低いところでは、壁・柵（歩ける範囲の縁）に当たる。外の高いところでは、
 *     低い柵・生け垣・ベンチは越えて、家の壁とテニスの防球ネット（tallHit）にだけ当たる。
 *     当たるか地面に着いたら飛ぶのをやめ、ふつうの小物として跳ねて転がり、平らに寝る（world.js の小物の物理。laysFlat）
 * 落ちたあとは、コーギーのこむぎが拾って持ってくる（corgi.js の fetch / bring）。
 *
 * 模型の面は local の XY（厚みが Z）。world.js の layFlat は local Z を上へ向けて寝かせるので、それに合わせた。
 */

const FLY_MIN = 3;          // これより遅い水平の速さでは飛ばない（m/s）
const LIFT = 10.4;          // 投げた直後の揚力（m/s²。重力 9.8 より少し強く、はじめは少し上る）
const LIFT_POW = 0.6;       // 揚力は（速さ / 投げた速さ）の 0.6 乗。二乗にすると 2 秒で落ちて、戻ってこなかった
const DRAG = 0.18;          // 水平の減速（/s）
const SINK = 1.6;           // 上下の速さの減衰（/s。ふわっと滑空して下りる）
const RADIUS_K = 0.62;      // 曲がる半径 = 速さ × 0.62（2〜11m）。前は 4.2m で頭打ちにしていて、強く投げても遠くへ行かなかった
const RADIUS_MAX = 11;
const SPIN = Math.PI * 2 * 8;
const BANK = 0.44;          // 内側への傾き（rad）
const MAX_FLIGHT = 7;

function createModel() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xc58a4a, roughness: 0.55 });
  const paint = new THREE.MeshStandardMaterial({ color: 0x2f7fd6, roughness: 0.5 });
  // 腕の断面：少し丸めた薄い板（押し出した形）
  const arm = (angle) => {
    const shape = new THREE.Shape();
    const L = 0.27;
    const w = 0.028;
    shape.moveTo(0, -w);
    shape.lineTo(L - w, -w * 0.8);
    shape.absarc(L - w, 0, w * 0.8, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(0, w);
    shape.lineTo(0, -w);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 2, curveSegments: 8 });
    geometry.translate(0, 0, -0.004);
    const mesh = new THREE.Mesh(geometry, wood);
    mesh.rotation.z = angle;
    mesh.castShadow = true;
    group.add(mesh);
    // 先のほうに青い帯を 2 本
    for (const at of [0.17, 0.21]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.062, 0.0165), paint);
      band.position.set(Math.cos(angle) * at, Math.sin(angle) * at, 0);
      band.rotation.z = angle;
      group.add(band);
    }
    return mesh;
  };
  // 2 本の腕の開きは 105°。重心（肘から 0.07m ほど腕の間）を原点へ寄せる
  const half = (105 / 2) * (Math.PI / 180);
  arm(Math.PI / 2 - half);
  arm(Math.PI / 2 + half);
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.0145, 20), wood);
  elbow.rotation.x = Math.PI / 2;
  elbow.castShadow = true;
  group.add(elbow);
  for (const child of group.children) child.position.y -= 0.07;
  // つかむときの当たり（見えない板）。原点は V の内側のすき間なので、腕だけだとレーザーが抜けた
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.01;
  group.add(hit);
  return { group, wood };
}

/**
 * @param {object} o
 * @param {THREE.Vector3} o.home 置き場所（食卓の上）
 * @param {(x, z, inset, from) => {x, z}} o.clamp 歩ける範囲へ寄せる（壁に当たったかを見る）
 * @param {(x, z) => number} o.groundHeight
 */
export function createBoomerang({ home, homeYaw = 0, clamp, groundHeight = () => 0, indoors = () => false, tallHit = () => false }) {
  const { group: mesh, wood } = createModel();
  mesh.name = 'boomerang';
  const homeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, homeYaw, 'YXZ'));
  mesh.position.copy(home);
  mesh.quaternion.copy(homeQuaternion);
  mesh.userData = {
    grabbable: true,
    boomerang: true,
    label: 'ブーメラン',
    home: home.clone(),
    homeQuaternion,
    halfSize: 0.009,
    restitution: 0.25,
    drag: 0.02,
    laysFlat: true,
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    held: false,
    flying: false,       // true のあいだは world.js の小物の物理を通さない
    hoverMaterial: wood,
    baseColor: new THREE.Color(0xc58a4a),
    baseEmissive: new THREE.Color(0x000000),
  };
  const data = mesh.userData;

  let wasHeld = false;
  let flight = 0;
  let spinAngle = 0;
  let speed0 = 1;
  let radius = 4;
  let turnSign = 1;          // +1 左 / -1 右
  let restFor = 0;         // 地面で止まっている秒数
  let thrown = false;      // 投げてから、まだ誰も拾っていない
  let flights = 0;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const spinQ = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);

  function startFlight() {
    const v = data.velocity;
    const h = Math.hypot(v.x, v.z);
    // そっと置いた・落としただけなら、こむぎは拾いに来ない
    if (h < FLY_MIN) return;
    thrown = true;
    data.flying = true;
    flights++;
    flight = 0;
    speed0 = h;
    radius = THREE.MathUtils.clamp(h * RADIUS_K, 2, RADIUS_MAX);
    turnSign = data.turnSign === -1 ? -1 : 1;
    data.turnSign = undefined;
    v.y = THREE.MathUtils.clamp(v.y, -1.5, 3.5);
  }

  function endFlight() {
    data.flying = false;
    data.spin.set(0, 0, 0);
  }

  function fly(dt) {
    const v = data.velocity;
    flight += dt;
    const h = Math.hypot(v.x, v.z);
    // 左へ曲がる（上から見て反時計まわり。-z を向いて投げると -x へ）。turnSign が -1 なら右へ
    const turn = turnSign * (h / radius) * dt;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const vx = v.x * c + v.z * s;
    const vz = -v.x * s + v.z * c;
    const slow = Math.max(0, 1 - DRAG * dt);
    v.x = vx * slow;
    v.z = vz * slow;
    const ratio = Math.min(1, h / speed0);
    v.y += (-9.8 + LIFT * Math.pow(ratio, LIFT_POW)) * dt;
    v.y *= 1 - SINK * dt;
    const prevX = mesh.position.x;
    const prevZ = mesh.position.z;
    mesh.position.addScaledVector(v, dt);
    // 向き：進む向きへ、曲がる内側へ傾けて、面の法線まわりに回す
    spinAngle += SPIN * dt;
    const yaw = Math.atan2(v.x, v.z);
    e.set(-Math.PI / 2, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    // 進む向きの軸まわりに傾ける（曲がる内側が下がる）
    spinQ.setFromAxisAngle(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -BANK * turnSign);
    mesh.quaternion.copy(q).premultiply(spinQ);
    mesh.quaternion.multiply(spinQ.setFromAxisAngle(Z, spinAngle * turnSign));

    // 壁・柵：家の中か低いところは歩ける範囲の縁で、外の高いところは家の壁と防球ネットだけ
    const ground = groundHeight(mesh.position.x, mesh.position.z) + data.halfSize;
    const low = indoors(prevX, prevZ) || mesh.position.y - ground < 1.0;
    let hitX = 0;
    let hitZ = 0;
    if (low) {
      const cl = clamp(mesh.position.x, mesh.position.z, 0.12, { x: prevX, z: prevZ });
      hitX = cl.x - mesh.position.x;
      hitZ = cl.z - mesh.position.z;
      if (hitX * hitX + hitZ * hitZ > 1e-8) { mesh.position.x = cl.x; mesh.position.z = cl.z; }
    } else if (tallHit(prevX, prevZ, mesh.position.x, mesh.position.y, mesh.position.z)) {
      hitX = prevX - mesh.position.x;
      hitZ = prevZ - mesh.position.z;
      mesh.position.x = prevX;
      mesh.position.z = prevZ;
    }
    if (hitX * hitX + hitZ * hitZ > 1e-8) {
      const len = Math.hypot(hitX, hitZ);
      const along = (v.x * hitX + v.z * hitZ) / len;
      if (along < 0) {
        v.x -= 1.3 * along * (hitX / len);
        v.z -= 1.3 * along * (hitZ / len);
      }
      v.x *= 0.4;
      v.z *= 0.4;
      endFlight();
      return;
    }
    if (mesh.position.y <= ground + 0.02 || flight > MAX_FLIGHT) {
      mesh.position.y = Math.max(mesh.position.y, ground);
      v.x *= 0.5;
      v.z *= 0.5;
      endFlight();
    }
  }

  function update(dt) {
    if (data.held) {
      wasHeld = true;
      data.carried = false;   // こむぎの口から取った
      data.flying = false;
      thrown = false;
      restFor = 0;
      return;
    }
    if (wasHeld) {
      wasHeld = false;
      if (!data.carried) startFlight();
    }
    if (data.carried) return;
    if (data.flying) { fly(dt); return; }
    const still = data.velocity.lengthSq() < 0.01;
    restFor = still ? restFor + dt : 0;
  }

  function reset() {
    data.carried = false;
    data.flying = false;
    thrown = false;
    restFor = 0;
    mesh.position.copy(data.home);
    mesh.quaternion.copy(homeQuaternion);
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
  }
  data.onReset = reset;

  return {
    mesh,
    update,
    reset,
    /** 飛んでいる */
    get flying() { return data.flying; },
    /** 投げられて地面に落ち、止まっている（こむぎが拾いに行ってよい） */
    get landed() { return thrown && !data.held && !data.carried && !data.flying && restFor > 0.4; },
    get thrown() { return thrown; },
    get carried() { return !!data.carried; },
    get flights() { return flights; },
    /** いまの（最後の）飛び方で曲がる向き（+1 左 / -1 右） */
    get turnSign() { return turnSign; },
    /** こむぎがくわえる / 放す */
    carry(on) {
      data.carried = on;
      data.velocity.set(0, 0, 0);
      data.spin.set(0, 0, 0);
      if (on) { data.flying = false; restFor = 0; }
    },
    /** こむぎが持ってきて置いた（もう一度投げられるまで拾いに行かない） */
    delivered() { thrown = false; restFor = 0; },
  };
}
