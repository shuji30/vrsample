import * as THREE from 'three';

/**
 * 観覧車。家の左の芝生の奥（池とメリーゴーランドのあいだの南）に立つ、高さ 30m の観覧車。
 *
 * 車輪は南北（z）の向きに立ち（x = 一定の面の中で回る）、ゴンドラ 16 台はいつも真下を向いて吊られる。
 * ゴンドラの中はベンチが南北に 2 つで、向かい合わせに座る。プレイヤーは南のベンチで北（海の見える向き）を、
 * 女の子は北のベンチで南（プレイヤー）を向く。女の子のうしろの窓の向こうに海が見える。
 * （短いスカートの中が正面から見えないよう、女の子は膝をそろえて、スカートを腿に沿わせ、手を膝の上に置く）
 *
 * 乗り物の窓口（kartdrive.js）。乗り場で E / トリガー → いちばん下のゴンドラに乗る（world.js が暗くして、
 * そのゴンドラをちょうど乗り場に合わせる）。女の子が乗ったら（来ないなら 3 秒で）回りはじめ、1 周 180 秒で
 * 乗り場へ戻って止まる。途中で降りたときは、world.js が暗くして乗り場へ戻す。
 * 乗っていないときは、ゆっくり回り続ける（無人のゴンドラ）。夜は車輪のふちの電球が光る。
 */
export const FERRIS = {
  x: -24,
  z: 4,
  hub: 15.62,         // いちばん下のゴンドラの床が、乗り場の床（0.07m）と同じ高さ
  radius: 13,
  gondolas: 16,
  rimGap: 1.5,         // 車輪（2 枚）の、真ん中からの間
  period: 180,         // 1 周の秒数（ゆっくり。外周で 0.45m/s）
};
const STEP = (Math.PI * 2) / FERRIS.gondolas;
/** ゴンドラの中（ローカル。原点は床の真ん中、-Z が北の窓） */
// 戸は東。女の子があとから乗るので、戸に近い東が女の子、奥の西がプレイヤー。
// 向かい合わせだが、少し斜めにずらす（真正面だと膝と膝がぶつかる。ゴンドラの奥行きは 1.5m）
const SEAT = { playerX: -0.28, girlX: 0.28, z: 0.42, girlZ: -0.42, top: 0.45 };

/** 歩けない所か（脚と、乗り場の手すり） */
export function ferrisBlocks(x, z, margin = 0) {
  for (const dz of [-6.5, 6.5]) {
    for (const dx of [-2.6, 2.6]) {
      if (Math.abs(x - (FERRIS.x + dx)) < 0.5 + margin && Math.abs(z - (FERRIS.z + dz)) < 0.5 + margin) return true;
    }
  }
  // いちばん下を通るゴンドラ（床が低いあいだの前後）
  if (Math.abs(x - FERRIS.x) < 1.2 + margin && Math.abs(z - FERRIS.z) < 2.2 + margin) return true;
  return false;
}

function gondolaModel(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8ea, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const W = 1.9;
  const D = 1.5;
  const floor = shade(new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D), paint));
  floor.position.y = -0.04;
  g.add(floor);
  // 腰の高さまでの壁（北の窓側は低く、景色が見える）と、その上のガラス
  const walls = [
    [W, 0.55, 0.05, 0, 0.275, -D / 2],        // 北（前）
    [W, 0.9, 0.05, 0, 0.45, D / 2],            // 南（ベンチの背）
    [0.05, 0.75, 0.35, W / 2, 0.375, -0.575],  // 東（戸の両わき）
    [0.05, 0.75, 0.35, W / 2, 0.375, 0.575],
    [0.05, 0.75, D, -W / 2, 0.375, 0],         // 西
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint));
    m.position.set(x, y, z);
    g.add(m);
  }
  // 東の戸（乗り場に止まっているあいだだけ、外側へ滑らせて開ける）
  const door = shade(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.8), white));
  door.position.set(W / 2 + 0.03, 0.375, 0);
  g.add(door);
  g.userData.door = door;
  const glassBox = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 1.2, D - 0.04), glass);
  glassBox.position.y = 1.35;
  g.add(glassBox);
  const roof = shade(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.25, 8), white));
  roof.scale.z = D / W;
  roof.position.y = 2.05;
  g.add(roof);
  // ベンチ（南の壁ぎわで北を向く・北の壁ぎわで南を向く、の 2 つ。向かい合わせ）
  for (const side of [1, -1]) {
    const bench = shade(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.42), white));
    bench.position.set(0, SEAT.top - 0.04, side * (SEAT.z + 0.08));
    g.add(bench);
    const benchBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, SEAT.top - 0.08, 0.36), paint);
    benchBase.position.set(0, (SEAT.top - 0.08) / 2, side * (SEAT.z + 0.1));
    g.add(benchBase);
  }
  // 窓の下の手すり（握れる）
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, W - 0.2, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 }));
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.62, -D / 2 + 0.08);
  g.add(rail);
  // 吊り金具
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.4 }));
  hanger.position.y = 2.35;
  g.add(hanger);
  return g;
}

export function createFerrisWheel() {
  const F = FERRIS;
  const group = new THREE.Group();
  group.name = 'ferrisWheel';
  group.position.set(F.x, 0, F.z);
  const steel = new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.4, metalness: 0.5 });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // 脚（A 字の 2 組）と、真ん中の軸
  for (const dx of [-2.6, 2.6]) {
    for (const dz of [-6.5, 6.5]) {
      const a = new THREE.Vector3(dx, 0, dz);
      const b = new THREE.Vector3(Math.sign(dx) * (F.rimGap + 0.5), F.hub, 0);
      const len = a.distanceTo(b);
      const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, len, 10), steel));
      leg.position.copy(a).add(b).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      group.add(leg);
    }
  }
  const axle = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, (F.rimGap + 0.8) * 2, 16), steel));
  axle.rotation.z = Math.PI / 2;
  axle.position.y = F.hub;
  group.add(axle);

  // 回る部分（x 軸まわり）
  const wheel = new THREE.Group();
  wheel.position.y = F.hub;
  group.add(wheel);
  for (const sx of [-1, 1]) {
    const rim = shade(new THREE.Mesh(new THREE.TorusGeometry(F.radius, 0.14, 8, 96), steel));
    rim.rotation.y = Math.PI / 2;
    rim.position.x = sx * F.rimGap;
    wheel.add(rim);
    const inner = shade(new THREE.Mesh(new THREE.TorusGeometry(F.radius * 0.55, 0.1, 8, 64), steel));
    inner.rotation.y = Math.PI / 2;
    inner.position.x = sx * F.rimGap;
    wheel.add(inner);
    for (let i = 0; i < F.gondolas; i++) {
      const a = i * STEP;
      const spoke = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, F.radius, 6), steel));
      spoke.position.set(sx * F.rimGap, Math.sin(a) * F.radius / 2, Math.cos(a) * F.radius / 2);
      spoke.rotation.x = Math.PI / 2 - a;
      wheel.add(spoke);
    }
  }
  // ふちの電球
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd070, emissiveIntensity: 0.4 });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), bulbMat, 128);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 128; i++) {
    const a = (i / 64) * Math.PI * 2;
    m4.makeTranslation((i < 64 ? -1 : 1) * F.rimGap, Math.sin(a) * (F.radius + 0.2), Math.cos(a) * (F.radius + 0.2));
    bulbs.setMatrixAt(i, m4);
  }
  wheel.add(bulbs);

  // ゴンドラ（回る部分の子にせず、位置だけ合わせる。いつも真下を向く）
  const COLORS = [0xe8573a, 0xf2b33a, 0x4fb06a, 0x3a8ad8, 0x9a5ad0, 0xf06aa8, 0x3ac0c0, 0xe0e050];
  const gondolas = [];
  for (let i = 0; i < F.gondolas; i++) {
    const g = gondolaModel(COLORS[i % COLORS.length]);
    group.add(g);
    gondolas.push({ g, a0: i * STEP, swing: 0, open: 0 });
  }

  // 乗り場（いちばん下のゴンドラの東側。低い床と手すり）
  const deck = shade(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.07, 3.2), new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.85 })));
  deck.position.set(2.7, 0.035, 0);   // ゴンドラ（東の壁 x 0.95）にかからない
  group.add(deck);
  const sign = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#c8323a'; x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#fff'; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('のりば', 128, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    m.position.set(4.4, 2.2, -1.2);
    m.rotation.y = Math.PI / 2;
    return m;
  })();
  group.add(sign);
  const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.95, 8), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.6, roughness: 0.4 })));
  post.position.set(4.42, 0.975, -1.2);
  group.add(post);

  // 乗るときにつかめる所：乗り場のゴンドラのまわりの見えない箱
  // （回り続けるゴンドラに合わせると、近づいても逃げていくので、乗り場に止めておく）
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.0), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0.2, 1.3, 0);
  group.add(body);
  // 乗る前の近さの判定に使う所（ゴンドラの戸の前。座る所だと、乗り場の手すりの外から遠い）
  const STATION = new THREE.Vector3(F.x + 1.1, 1.3, F.z);
  const steering = new THREE.Object3D();

  const state = {
    speed: 0, yaw: Math.PI, travelYaw: Math.PI, steer: 0, onGrass: false, lateral: 0, u: 0,
    angle: 0,          // 車輪の角度
    omega: (Math.PI * 2) / F.period,
    phase: 'idle',     // idle / boarding / riding / arrived
  };
  let ride = null;     // 乗っているゴンドラ { index, turned }
  let girlSeated = false;
  let girlComing = false;
  let wait = 0;
  let night = false;

  // ゴンドラ i の吊り点（ワールド）。角度 0 が真下
  function pinOf(i, out = new THREE.Vector3()) {
    const a = state.angle + gondolas[i].a0;
    return out.set(F.x, F.hub - Math.cos(a) * F.radius, F.z + Math.sin(a) * F.radius);
  }
  const tmp = new THREE.Vector3();
  function pose() {
    // 車輪の x 回転は、ゴンドラの角度（真下から南→上）と逆向きの符号になる
    wheel.rotation.x = -state.angle;
    gondolas.forEach((gd, i) => {
      pinOf(i, tmp);
      gd.g.position.set(0, tmp.y - F.hub - 2.55 + F.hub, tmp.z - F.z);
      gd.g.rotation.x = gd.swing;
      const open = ride && i === ride.index && (state.phase === 'boarding' || state.phase === 'arrived') ? 1 : 0;
      gd.open += (open - gd.open) * 0.12;
      gd.g.userData.door.position.z = -gd.open * 0.72;
    });
    group.updateMatrixWorld(true);
  }
  /** いまいちばん下にあるゴンドラ */
  function lowest() {
    let best = 0;
    let bestY = Infinity;
    gondolas.forEach((_, i) => { const y = pinOf(i, tmp).y; if (y < bestY) { bestY = y; best = i; } });
    return best;
  }

  function spin(dt, omega) {
    const prev = state.omega;
    state.omega += THREE.MathUtils.clamp(omega - state.omega, -0.05 * dt, 0.05 * dt);
    state.angle += state.omega * dt;
    // 動き出し・止まりで、ゴンドラが少し揺れる
    const kick = (state.omega - prev) / Math.max(dt, 1e-3);
    for (const gd of gondolas) gd.swing += (-kick * 0.6 - gd.swing * 1.2) * dt;
    if (ride) ride.turned += state.omega * dt;
    pose();
  }
  pose();
  const glow = () => { bulbMat.emissiveIntensity = night ? 1.6 + 0.6 * Math.sin(performance.now() * 0.004) : 0.4; };

  return {
    group,
    body,
    state,
    steering,
    kind: 'ferris',
    silent: true,
    place() {},
    /** 乗る：いちばん下のゴンドラを、ちょうど乗り場に合わせて止める（world.js が暗くしてから） */
    board() {
      const i = lowest();
      // そのゴンドラの角度が真下（0）になるよう、車輪を回しておく
      const a = state.angle + gondolas[i].a0;
      state.angle -= Math.atan2(Math.sin(a), Math.cos(a));
      state.omega = 0;
      ride = { index: i, turned: 0 };
      state.phase = 'boarding';
      wait = 0;
      pose();
    },
    /** 乗っているあいだ（kartdrive.js から） */
    update(dt) {
      if (!ride) return;
      glow();
      wait += dt;
      if (state.phase === 'boarding' && (girlSeated || (!girlComing && wait > 3))) state.phase = 'riding';
      if (state.phase === 'riding') {
        // 1 周して乗り場へ戻ったら止まる（最後はゆっくり）
        const left = Math.PI * 2 - ride.turned;
        const want = left < 0.25 ? Math.max(0.004, (F.period > 0 ? (Math.PI * 2) / F.period : 0) * (left / 0.25)) : (Math.PI * 2) / F.period;
        state.omega = Math.min(state.omega + 0.05 * dt, want);
        state.angle += state.omega * dt;
        ride.turned += state.omega * dt;
        if (ride.turned >= Math.PI * 2) {
          state.angle -= ride.turned - Math.PI * 2;
          ride.turned = Math.PI * 2;
          state.omega = 0;
          state.phase = 'arrived';
        }
        for (const gd of gondolas) gd.swing *= 1 - dt;
        pose();
      } else {
        pose();
      }
    },
    /** 乗っていないとき（world.js から）：ゆっくり回り続ける */
    idle(dt) {
      if (ride) { ride = null; state.phase = 'idle'; }
      spin(dt, (Math.PI * 2) / F.period);
      glow();
    },
    /** 乗ったゴンドラの、プレイヤーの目（ベンチの西に座った高さ） */
    eye(out = new THREE.Vector3()) {
      if (!ride) return out.copy(STATION);   // 乗る前（近いかどうかの判定）は、乗り場
      const g = gondolas[ride.index].g;
      g.updateMatrixWorld(true);
      return g.localToWorld(out.set(SEAT.playerX, SEAT.top + 0.78, SEAT.z - 0.05));
    },
    /** PC の中の視点は、少し東（向かいに座る女の子の側）へ向ける。VR は体の向きのまま */
    lookYawOffset: -0.3,
    /** PC の外から見る視点：ゴンドラの東の斜め上から、ゴンドラと海を見る */
    chase(camera) {
      const i = ride ? ride.index : lowest();
      const p = gondolas[i].g.getWorldPosition(tmp);
      camera.position.set(p.x + 7, p.y + 3, p.z + 4);
      camera.lookAt(p.x, p.y + 1, p.z - 2);
    },
    /** 降りる所（乗り場の上） */
    side(out = new THREE.Vector3()) { return out.set(F.x + 2.6, 0, F.z + 0.4); },
    /** 女の子の座る所（北のベンチの東）と向き（南。プレイヤーと向かい合う） */
    girlSeat(out = new THREE.Vector3()) {
      const g = gondolas[ride ? ride.index : lowest()].g;
      g.updateMatrixWorld(true);
      return g.localToWorld(out.set(SEAT.girlX, SEAT.top, SEAT.girlZ));
    },
    girlYaw() { return 0; },
    /** 女の子が乗り込む所（乗り場の、ゴンドラの戸の前） */
    girlBoard(out = new THREE.Vector3()) { return out.set(F.x + 1.7, 0, F.z); },
    /** 女の子の床の高さ（ゴンドラの床） */
    girlFloorY() {
      const g = gondolas[ride ? ride.index : lowest()].g;
      g.updateMatrixWorld(true);
      return g.localToWorld(tmp.set(0, 0, 0)).y;
    },
    /** ゴンドラの高さ（地面から、m） */
    get height() { return ride ? pinOf(ride.index, tmp).y - 2.55 : 0; },
    /** 1 周のうちどこまで来たか（0〜1） */
    get progress() { return ride ? ride.turned / (Math.PI * 2) : 0; },
    get phase() { return state.phase; },
    get riding() { return Boolean(ride); },
    set girlSeated(v) { girlSeated = Boolean(v); },
    set girlComing(v) { girlComing = Boolean(v); },
    setNight(v) { night = Boolean(v); },
    get speed() { return 0; },
  };
}
