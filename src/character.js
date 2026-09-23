import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { SOFA } from './furniture.js';

/**
 * 部屋を歩きまわる VRM キャラクター。
 *
 * この部屋で唯一の「外から持ち込んだアセット」。VRM は glTF の拡張なので
 * GLTFLoader に @pixiv/three-vrm のプラグインを挿すだけで読めるが、
 * 素の glTF として読むと
 *
 * - MToon（トゥーン）マテリアルが unlit にフォールバックして部屋の光を拾わない
 * - 髪や服が揺れない（VRMC_springBone）
 * - 視線が動かない（VRMC_vrm の lookAt）
 * - T ポーズのまま立つ
 *
 * ということになる。前 3 つはプラグインが面倒を見てくれる。
 *
 * 動きのほうは**モーションデータを持っていない**（このモデルに animations は
 * 入っていないし、部屋のテクスチャと同じで外部アセットは増やしたくない）ので、
 * 歩き・立ち・座りはすべて正規化ボーンに角度を入れて作っている。
 *
 *   立ちポーズ / 座りポーズ … STAND_POSE と SIT_POSE を混ぜる
 *   歩き               … 位相 1 本の sin で脚と腕を振る
 *   ふるまい            … 経路上をうろうろし、ときどきソファに座る状態機械
 *
 * 足が滑って見えるかどうかは**位相を時間ではなく進んだ距離から進める**かで
 * 決まる。速度が変わっても歩幅が変わらないので、接地した足が流れない。
 */

export const CHARACTER = {
  url: './models/character.vrm',
  /** 歩く速さ（m/s）。小柄なモデルなので人間の 1.3m/s よりだいぶ遅い */
  speed: 0.5,
  /** 1 歩の歩幅（m）。身長 1.4m を基準に、読み込んだモデルの身長で補正する */
  stride: 0.34,
  /** 旋回の速さ（rad/s） */
  turnRate: 2.8,
};

/**
 * うろうろする経路。テーブルと椅子・ソファ・本棚を避けて、部屋を反時計回りに
 * ひとまわりする閉ループ。節点を順に辿るだけなので、経路探索も当たり判定も
 * 要らない（部屋の家具は動かないので、これで十分）。
 *
 *   6 ───── 5 ──── 4          ↑ +Z（背面・ドアと本棚）
 *   │              │
 *   0              3          ← ループの内側にテーブルと椅子、
 *   │              │             右にソファがある
 *   1 ───── 2 ─────┘
 */
const ROUTE = [
  [-1.25, -1.05],   // 0 窓のあいだ（起動時に立っている場所）
  [-1.95, 0.35],    // 1 左の窓ぎわ
  [-1.85, 1.95],    // 2 本棚の手前
  [-0.45, 2.75],    // 3 ドアの前
  [0.95, 2.35],     // 4 背面の右
  [1.05, 1.15],     // 5 ソファの脇
  [0.75, -0.25],    // 6 ソファの前
].map(([x, z]) => new THREE.Vector2(x, z));

/** 立ちポーズ。T ポーズからの差分。肩から先を段階的に曲げると自然に見える */
const STAND_POSE = {
  leftUpperArm: [0, 0, -1.18],
  rightUpperArm: [0, 0, 1.18],
  leftLowerArm: [0, -0.22, -0.16],
  rightLowerArm: [0, 0.22, 0.16],
  leftHand: [0, 0, -0.10],
  rightHand: [0, 0, 0.10],
};

/**
 * 座りポーズ。腿を前に倒して（-x）膝を曲げ（+x）、腕は少し前に置く。
 * 腰の高さは座面に合わせてルートごと下げる（sitRootY）。
 *
 * 腿は水平まで倒さず少し下げている。このモデルは身長 1.4m しかなく、大人用の
 * ソファ（座面 61cm）には足が届かない。浅く腰かけて足をぶら下げる姿勢のほうが
 * 実際の見た目に合う。
 */
const SIT_POSE = {
  // 手は腿の上に置く。座ると腕を下ろす場所が無くなるし、スカートの裾も落ち着く
  leftUpperArm: [0.05, 0, -1.02],
  rightUpperArm: [0.05, 0, 1.02],
  leftLowerArm: [-0.10, -1.05, -0.30],
  rightLowerArm: [-0.10, 1.05, 0.30],
  leftHand: [0, 0, -0.10],
  rightHand: [0, 0, 0.10],
  // 膝は閉じ気味に。腿を水平まで上げないので、スカートの裾も上がりすぎない
  leftUpperLeg: [-1.14, 0.04, 0.03],
  rightUpperLeg: [-1.14, -0.04, -0.03],
  leftLowerLeg: [1.06, 0, 0],
  rightLowerLeg: [1.06, 0, 0],
  leftFoot: [0.30, 0, 0],
  rightFoot: [0.30, 0, 0],
  spine: [-0.06, 0, 0],
  chest: [-0.05, 0, 0],
};

const POSE_BONES = [...new Set([...Object.keys(STAND_POSE), ...Object.keys(SIT_POSE)])];

/** 指を軽く握らせる。開いたままの手は VR で見ると妙に目につく */
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'].flatMap((finger) =>
  ['Proximal', 'Intermediate', 'Distal'].map((joint) => `${finger}${joint}`),
);

/**
 * 歩きのパラメータ。
 *
 * 腿と膝の角度はここには無い。以前は腿の振り幅を角度で決め打ちしていたが、
 * それだと足の可動範囲（脚長 × sin 振り幅）と歩幅が一致せず、立脚中の足が
 * 地面を滑る。いまは歩幅と脚の長さから毎フレーム逆算している（solveLeg）。
 */
const GAIT = {
  arm: 0.34,        // 腕は脚と逆位相
  ankle: 0.30,      // 蹴り出し / 着地の足首
  lift: 0.30,       // 遊脚で足を持ち上げる高さ（歩幅に対する比）
  dip: 0.014,       // 接地直後に体重が乗って沈む量（m）
  roll: 0.035,      // 腰の左右の傾き
  twist: 0.05,      // 胸の捻り
};

const TAU = Math.PI * 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
/** 角度の差を -π..π に畳む */
const angleDelta = (to, from) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** ソファのローカル座標をワールドの XZ に移す */
function sofaToWorld(localX, localZ) {
  const c = Math.cos(SOFA.yaw);
  const s = Math.sin(SOFA.yaw);
  return new THREE.Vector2(
    SOFA.center.x + localX * c + localZ * s,
    SOFA.center.z - localX * s + localZ * c,
  );
}

/**
 * 座れる場所。クッション 2 枚ぶん。`approach` はソファの前に立つ位置で、
 * ここまで歩いてから向きを変え、後ろ向きに下がって腰を下ろす。
 * `seat`（腰を下ろす点）だけはモデルの腿の長さで決まるので、読み込み後に入れる。
 */
const SEATS = SOFA.cushions.map((localX) => {
  const approach = sofaToWorld(localX, SOFA.frontZ + 0.30);
  // 経路のどの節点から入るか（いちばん近い節点）
  let via = 0;
  let best = Infinity;
  ROUTE.forEach((node, i) => {
    const d = node.distanceTo(approach);
    if (d < best) { best = d; via = i; }
  });
  return { localX, seat: sofaToWorld(localX, SOFA.seatZ), approach, via, top: SOFA.top, yaw: SOFA.yaw };
});

/**
 * 腰を下ろす点を、膝が座面の前縁あたりに来るように決める。
 * 腿が座面より短いモデル（子どもや小柄なキャラクター）が座面の奥に腰を下ろすと、
 * 脛がクッションに埋まってしまう。深さは背もたれまでで頭打ちにする。
 */
function placeSeats(thighReach) {
  // +0.08 は脛のぶんの逃げ。膝が座面の前縁より少し前に出るようにする
  const localZ = Math.max(SOFA.seatZ, SOFA.frontZ - thighReach + 0.08);
  for (const seat of SEATS) seat.seat = sofaToWorld(seat.localX, localZ);
}

/**
 * VRM を読み込んで部屋に立たせる。読み込みは非同期なので、部屋の生成は
 * 待たせない（キャラクターだけ後から現れる）。
 *
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {string} [options.url] VRM ファイルの URL
 * @param {THREE.Camera} [options.camera] 視線で追わせる相手
 * @param {boolean} [options.wander] false なら歩かせず、その場に立たせる
 */
/**
 * 足の下に敷く柔らかい影。
 *
 * 太陽の影だけに頼ると、直射日光の当たらない場所に立ったときに影がまったく
 * 出ず、床に貼り付いていないように見える。実際この部屋は窓から差す光が
 * 届く範囲が狭いので、立ち位置によっては影がゼロになる。接地感は
 * 「足の真下が暗いこと」でほとんど決まるので、別に敷いてしまう。
 */
function buildContactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  // 濃い部分を靴の下だけに置くと、その靴に隠れて何も見えない。実際これで
  // 一度失敗している（影は描かれていたが、濃い範囲が 15cm しかなく、
  // 立った姿勢では靴に覆われて画面に出てこなかった）。減衰をゆるくして
  // 履物の外側まではみ出させる。
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.32)');
  gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.10)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}

export function createCharacter(scene, { url = CHARACTER.url, camera = null, wander = true } = {}) {
  const group = new THREE.Group();
  group.name = 'character';
  group.position.set(ROUTE[0].x, 0, ROUTE[0].y);

  let yaw = -0.24;             // 正面の窓のほうへ少し体を捻って立っている
  group.rotation.y = yaw;
  scene.add(group);

  // 影はキャラクターの Group ではなくシーン直下に置く。床に貼り付いていて
  // ほしいので、体の傾きや腰の上下に引きずられないほうがよい。
  const footShadows = [buildContactShadow(), buildContactShadow()];
  for (const shadow of footShadows) {
    shadow.visible = false;
    scene.add(shadow);
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let vrm = null;
  /** @type {Record<string, THREE.Object3D>} */
  let bones = {};
  let hipsRestY = 0;      // 腰のボーンの、足元からの高さ
  let stride = CHARACTER.stride;

  // 脚の寸法。歩幅と辻褄の合う脚の角度を逆算するのに要る
  let thighLen = 0.34;    // 腰から膝
  let shinLen = 0.34;     // 膝から足首
  let legLength = 0.67;   // 伸ばしきらない脚長（特異点を避けて 98.5%）
  let ankleRestY = 0.06;  // 足首の床からの高さ
  let hipWidth = 0.06;    // 左右の脚の間隔（片側）

  // --- ふるまいの状態 -----------------------------------------------------
  let state = 'idle';
  let clock = 0;          // 読み込んでからの秒数
  let stateUntil = 4;     // idle / sit の終了時刻。最初は少し立っている
  let nodeIndex = 0;      // いま居る経路の節点
  let direction = 1;      // 経路を回る向き
  let nextSitAt = 30;     // この時刻を過ぎたら次の到着時に座りにいく
  /** @type {{point: THREE.Vector2, seat?: object}[]} */
  const queue = [];       // これから向かう地点
  let goal = null;
  let seated = null;      // 座っている（or 座りにいく）席
  let transition = 0;     // 座る / 立つの進み（0..1）

  // --- 姿勢の状態 ---------------------------------------------------------
  let phase = 0;          // 歩きの位相。進んだ距離から進める
  let gait = 0;           // 歩いている度合い（0..1）。踏み出し / 止まりを滑らかに
  let sitAmount = 0;      // 座りポーズの混ざり具合（0..1）
  let elapsed = 0;        // 呼吸とまばたきの時計
  let blinkAt = 2.5;
  let blink = 0;

  const ready = loader
    .loadAsync(url)
    .then((gltf) => {
      vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('VRM 拡張が入っていないファイルです');

      // VRM 0.x は後ろ（-Z）を向いて出てくる。1.0 なら何もしない
      VRMUtils.rotateVRM0(vrm);
      // VR は 1 フレームに 2 回描くので、無駄な頂点とスキンは落としておく
      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.combineSkeletons(vrm.scene);
      VRMUtils.combineMorphs(vrm);

      vrm.scene.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        // スキニングしたメッシュのバウンディングは当てにならない。
        // main.js のバウンディングスフィア膨張も読み込み前に済んでいるので、
        // ここだけはカリングから外す
        object.frustumCulled = false;
      });

      cacheBones(vrm.humanoid);
      curlFingers(vrm.humanoid);

      // 腰の高さと腿の長さは、座面に腰を乗せる位置に要る。歩幅も身体に合わせる
      hipsRestY = bones.hips ? bones.hips.position.y : 0.7;
      stride = CHARACTER.stride * (hipsRestY / 0.70);

      // 正規化ボーンのローカル位置は、そのまま骨の長さになっている
      thighLen = bones.leftLowerLeg ? bones.leftLowerLeg.position.length() : thighLen;
      shinLen = bones.leftFoot ? bones.leftFoot.position.length() : shinLen;
      // 脚は伸ばしきらない。腰の高さを脚長ちょうどに置くと、踏み出した足が
      // 届く / 届かないの境目に乗ってしまい、前半分だけクランプされて歩容が
      // 前後非対称になる。2% 残しておくと膝もわずかに曲がって自然に見える。
      legLength = (thighLen + shinLen) * 0.98;
      ankleRestY = Math.max(0.02, hipsRestY - (thighLen + shinLen));
      hipWidth = bones.leftUpperLeg ? Math.abs(bones.leftUpperLeg.position.x) : hipWidth;
      // 歩幅は脚長の半分まで。これ以上広げると腰の沈み込みが大きくなりすぎる
      stride = Math.min(stride, legLength * 0.5);
      placeSeats(measureThigh(vrm) * Math.sin(-SIT_POSE.leftUpperLeg[0]));

      // 視線でこちらを追わせる。XR 中も camera の matrixWorld は
      // WebXRManager が更新してくれるので、これで両対応になる
      if (camera && vrm.lookAt) vrm.lookAt.target = camera;

      group.add(vrm.scene);
      return vrm;
    })
    .catch((error) => {
      // モデルが無いのは想定内の状態なので、読み込み失敗で部屋ごと止めたりはしない
      console.warn(`[character] ${url} を読み込めませんでした:`, error.message ?? error);
      return null;
    });

  /** 腿の長さ（腰から膝まで）を実体のボーンから測る */
  function measureThigh(model) {
    const humanoid = model.humanoid;
    const hips = humanoid?.getRawBoneNode('hips');
    const knee = humanoid?.getRawBoneNode('leftLowerLeg');
    if (!hips || !knee) return 0.35;
    model.scene.updateMatrixWorld(true);
    return hips.getWorldPosition(new THREE.Vector3())
      .distanceTo(knee.getWorldPosition(new THREE.Vector3()));
  }

  /** 使うボーンを引いておく。正規化ボーンに角度を入れると vrm.update() が実体に流す */
  function cacheBones(humanoid) {
    if (!humanoid) return;
    const names = [
      ...POSE_BONES, 'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
      'leftUpperArm', 'rightUpperArm',
    ];
    for (const name of new Set(names)) {
      const node = humanoid.getNormalizedBoneNode(name);
      if (node) bones[name] = node;
    }
    if (!bones.chest) bones.chest = bones.upperChest;
  }

  function curlFingers(humanoid) {
    if (!humanoid) return;
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      for (const joint of FINGERS) {
        humanoid.getNormalizedBoneNode(`${side}${joint}`)?.rotation.set(0, 0, sign * 0.28);
      }
      humanoid.getNormalizedBoneNode(`${side}ThumbProximal`)?.rotation.set(0, sign * -0.3, 0);
    }
  }

  // ------------------------------------------------------------------------
  // ふるまい（どこへ行くか）
  // ------------------------------------------------------------------------

  /** 次の目的地を決める。節点に着くたびに呼ばれる */
  function decide() {
    if (queue.length > 0) {
      goal = queue.shift();
      state = 'walk';
      return;
    }
    // ソファが空いていて、前に座ってからしばらく経っていたら座りにいく
    if (clock > nextSitAt && Math.random() < 0.6) {
      planSit(SEATS[Math.floor(Math.random() * SEATS.length)]);
      return;
    }
    // 4 割は立ち止まって少し休む
    if (Math.random() < 0.4) {
      state = 'idle';
      stateUntil = clock + 2.5 + Math.random() * 4.5;
      return;
    }
    walkToNextNode();
  }

  function walkToNextNode() {
    if (Math.random() < 0.15) direction = -direction; // たまに引き返す
    nodeIndex = (nodeIndex + direction + ROUTE.length) % ROUTE.length;
    goal = { point: ROUTE[nodeIndex] };
    state = 'walk';
  }

  /** 席までの経路を積む。閉ループなので近いほうの回りで辿る */
  function planSit(seat) {
    const size = ROUTE.length;
    const forward = (seat.via - nodeIndex + size) % size;
    const backward = (nodeIndex - seat.via + size) % size;
    const step = forward <= backward ? 1 : -1;
    const count = Math.min(forward, backward);
    for (let i = 0; i < count; i++) {
      nodeIndex = (nodeIndex + step + size) % size;
      queue.push({ point: ROUTE[nodeIndex] });
    }
    direction = step;
    queue.push({ point: seat.approach, seat });
    goal = queue.shift();
    state = 'walk';
  }

  // ------------------------------------------------------------------------
  // 移動
  // ------------------------------------------------------------------------

  /** 目標に向かって 1 フレームぶん歩く。着いたら true */
  function stepTowards(target, dt, speed = CHARACTER.speed) {
    const dx = target.x - group.position.x;
    const dz = target.y - group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.02) return true;

    const turned = turnTowards(Math.atan2(dx, dz), dt);

    // 向きが大きくずれているあいだは前に出ない（その場で回る）
    const facing = Math.abs(angleDelta(Math.atan2(dx, dz), yaw));
    const moved = facing < 0.7 ? Math.min(speed * dt, distance) : 0;
    group.position.x += Math.sin(yaw) * moved;
    group.position.z += Math.cos(yaw) * moved;

    // 位相は「進んだ距離」だけから進める。ここに旋回ぶんを足すと、進んでいない
    // のに足が振られて立脚の足が滑る。歩きながらは常に進路を微調整しているので、
    // わずかな係数でも効いてしまう。その場で回っているときだけ足を動かす。
    advanceGait(moved > 0 ? moved : Math.abs(turned) * 0.2, dt, moved > 0 ? 1 : 0.55);
    return distance - moved < 0.02;
  }

  /** 旋回。実際に回った角度を返す */
  function turnTowards(wanted, dt) {
    const delta = angleDelta(wanted, yaw);
    const step = Math.sign(delta) * Math.min(Math.abs(delta), CHARACTER.turnRate * dt);
    yaw += step;
    group.rotation.y = yaw;
    return step;
  }

  /** 歩きの位相と「歩いている度合い」を進める */
  function advanceGait(distance, dt, wanted) {
    phase += (Math.PI * distance) / stride;
    gait += (wanted - gait) * Math.min(1, dt * 8);
  }

  // ------------------------------------------------------------------------
  // 状態機械
  // ------------------------------------------------------------------------

  function updateBehavior(dt) {
    clock += dt;

    switch (state) {
      case 'idle':
        advanceGait(0, dt, 0);
        if (clock > stateUntil) decide();
        break;

      case 'walk':
        if (stepTowards(goal.point, dt)) {
          if (goal.seat) {
            seated = goal.seat;
            state = 'turn';
          } else {
            decide();
          }
        }
        break;

      // ソファに背を向ける
      case 'turn': {
        const turned = turnTowards(seated.yaw, dt);
        advanceGait(Math.abs(turned) * 0.2, dt, Math.abs(turned) > 1e-3 ? 0.5 : 0);
        if (Math.abs(angleDelta(seated.yaw, yaw)) < 0.05) {
          transition = 0;
          state = 'sitDown';
        }
        break;
      }

      // 後ろ向きに下がって腰を下ろす
      case 'sitDown': {
        transition = Math.min(1, transition + dt / 1.6);
        const back = smoothstep(0, 0.75, transition);
        const before = new THREE.Vector2(group.position.x, group.position.z);
        group.position.x = lerp(seated.approach.x, seated.seat.x, back);
        group.position.z = lerp(seated.approach.y, seated.seat.y, back);
        group.position.y = lerp(0, sitRootY(), smoothstep(0.45, 1, transition));
        sitAmount = smoothstep(0.3, 1, transition);
        // 下がっているあいだは足も動く（位相は後ろ向きに進める）
        const moved = before.distanceTo(new THREE.Vector2(group.position.x, group.position.z));
        advanceGait(-moved, dt, back < 1 ? 0.7 * (1 - sitAmount) : 0);
        if (transition >= 1) {
          state = 'sit';
          stateUntil = clock + 12 + Math.random() * 14;
        }
        break;
      }

      case 'sit':
        if (clock > stateUntil) {
          transition = 0;
          state = 'standUp';
        }
        break;

      // 立ち上がって、ソファの前に戻る
      case 'standUp': {
        transition = Math.min(1, transition + dt / 1.3);
        const out = smoothstep(0.2, 1, transition);
        const before = new THREE.Vector2(group.position.x, group.position.z);
        group.position.x = lerp(seated.seat.x, seated.approach.x, out);
        group.position.z = lerp(seated.seat.y, seated.approach.y, out);
        group.position.y = lerp(sitRootY(), 0, smoothstep(0, 0.5, transition));
        sitAmount = 1 - smoothstep(0, 0.7, transition);
        const moved = before.distanceTo(new THREE.Vector2(group.position.x, group.position.z));
        advanceGait(moved, dt, out < 1 ? 0.7 : 0);
        if (transition >= 1) {
          nodeIndex = seated.via;
          seated = null;
          nextSitAt = clock + 45 + Math.random() * 45;
          queue.push({ point: ROUTE[nodeIndex] });
          decide();
        }
        break;
      }
    }
  }

  /** 腰を座面に乗せるためのルートの高さ（床より下がることもある） */
  function sitRootY() {
    // 腰の関節は尻の面より 8cm ほど上にある
    return seated.top + 0.08 - hipsRestY;
  }

  // ------------------------------------------------------------------------
  // 姿勢
  // ------------------------------------------------------------------------

  /** 立ちポーズと座りポーズを混ぜて入れる */
  function applyPose() {
    for (const name of POSE_BONES) {
      const node = bones[name];
      if (!node) continue;
      const a = STAND_POSE[name];
      const b = SIT_POSE[name];
      node.rotation.set(
        lerp(a?.[0] ?? 0, b?.[0] ?? 0, sitAmount),
        lerp(a?.[1] ?? 0, b?.[1] ?? 0, sitAmount),
        lerp(a?.[2] ?? 0, b?.[2] ?? 0, sitAmount),
      );
    }
    // 腰と首は歩き / 呼吸が加算で触るので、毎フレームここで戻しておく
    if (bones.hips) {
      bones.hips.rotation.set(0, 0, 0);
      bones.hips.position.y = hipsRestY;
    }
    if (bones.neck) bones.neck.rotation.set(0, 0, 0);
  }

  /**
   * 足 1 本の、腰から見た着地点を返す。位相 u は 0 で接地、π で離地。
   *
   * 立脚（u < π）では、体が進むぶんだけ足を真後ろへ **等速で** 送る。
   * こうすると足は地面に対して静止する。以前は腿の角度を sin で振っていたが、
   * それだと足の移動量が歩幅と一致せず（脚長 0.62m × sin0.46 の往復 = 0.62m に
   * 対して歩幅は 0.34m）、1 歩ごとに 28cm ぶん足が滑っていた。
   */
  function footPlan(p) {
    const u = ((p % TAU) + TAU) % TAU;

    if (u < Math.PI) {
      const t = u / Math.PI;
      return { offset: stride * (0.5 - t), lift: 0, stance: t };
    }

    // 遊脚。前へ運びながら持ち上げる
    const t = (u - Math.PI) / Math.PI;
    const eased = t * t * (3 - 2 * t);
    return { offset: stride * (eased - 0.5), lift: Math.sin(t * Math.PI) * stride * GAIT.lift, stance: -1 };
  }

  /**
   * 足 1 本を、与えた着地点に届くよう腿と膝で解く（2 関節の逆運動学）。
   *
   * 腰から足首までの距離 d が分かれば、余弦定理で膝の角度が出る。膝は
   * 前へ突き出るので、腿は腰-足首を結ぶ線より α だけ前に倒す。
   */
  function solveLeg(leg, p, hipY, amount) {
    const upper = bones[`${leg}UpperLeg`];
    const lower = bones[`${leg}LowerLeg`];
    const foot = bones[`${leg}Foot`];
    if (!upper || !lower) return;

    const plan = footPlan(p);
    const dz = plan.offset;
    const dy = (ankleRestY + plan.lift) - hipY;   // 足首は腰より下なので負
    const reach = Math.min(
      Math.max(Math.hypot(dy, dz), Math.abs(thighLen - shinLen) + 0.001),
      thighLen + shinLen - 0.001,
    );

    const beta = Math.atan2(dz, -dy);             // 真下からの角度（前が +）
    const alpha = Math.acos(clamp(
      (thighLen * thighLen + reach * reach - shinLen * shinLen) / (2 * thighLen * reach), -1, 1,
    ));
    const knee = Math.PI - Math.acos(clamp(
      (thighLen * thighLen + shinLen * shinLen - reach * reach) / (2 * thighLen * shinLen), -1, 1,
    ));
    const thigh = beta + alpha;

    // 足裏を床と平行に保つ。そのうえで蹴り出しと着地の足首を足す
    let ankle = thigh - knee;
    if (plan.stance >= 0) {
      // 後半で踵が上がり（つま先で蹴る）、着地直後はわずかにつま先が上を向く
      ankle += GAIT.ankle * smoothstep(0.55, 1, plan.stance);
      ankle -= GAIT.ankle * 0.45 * (1 - smoothstep(0, 0.18, plan.stance));
    } else {
      // 遊脚はつま先を上げておく。下げたままだと床を擦って見える
      ankle -= GAIT.ankle * 0.35;
    }

    // 立ち / 座りポーズからの混ぜ込み。amount が 0 ならそのまま
    upper.rotation.x += (-thigh - upper.rotation.x) * amount;
    lower.rotation.x += (knee - lower.rotation.x) * amount;
    if (foot) foot.rotation.x += (ankle - foot.rotation.x) * amount;
  }

  /**
   * 歩きを重ねる。
   *
   * 腰の高さは腕まかせの sin ではなく、立脚の幾何から決める。脚を伸ばした
   * まま前に振り出すと、腰は脚が真下に来たとき最も高く、両足が前後に開いた
   * 着地の瞬間に最も低くなる（コンパス歩行）。以前の実装はこれが逆位相で、
   * 着地の瞬間に腰が持ち上がっていたので、踏んだ手ごたえが出なかった。
   */
  function applyGait() {
    const amount = gait * (1 - sitAmount);
    if (amount < 0.001) return;

    const s = Math.sin(phase);
    const c = Math.cos(phase);

    // 立脚している側の脚から腰の高さを決める（同時に接地するのは片脚だけ）
    const legs = [['left', phase], ['right', phase + Math.PI]];
    let hipY = hipsRestY;
    let dip = 0;
    for (const [, p] of legs) {
      const plan = footPlan(p);
      if (plan.stance < 0) continue;
      hipY = ankleRestY + Math.sqrt(Math.max(0, legLength * legLength - plan.offset * plan.offset));
      // 接地直後の沈み込み。実際の歩行でも立脚初期に膝が曲がって体重を受ける
      dip = GAIT.dip * Math.sin(Math.PI * clamp01(plan.stance / 0.38));
    }
    hipY -= dip;

    if (bones.hips) {
      bones.hips.position.y += (hipY - bones.hips.position.y) * amount;
      // 脚は **実際に置いた腰の高さ** で解く。理想値のまま解くと、立ち上がりの
      // 混ぜ込み中に腰と足の辻褄が合わず、接地した足が浮いたり沈んだりする
      hipY = bones.hips.position.y;
      bones.hips.rotation.z = GAIT.roll * s * amount;
    }

    for (const [leg, p] of legs) solveLeg(leg, p, hipY, amount);

    // 腕は脚と逆位相。肩を上げずに前後に振る
    if (bones.leftUpperArm) bones.leftUpperArm.rotation.x += GAIT.arm * c * amount;
    if (bones.rightUpperArm) bones.rightUpperArm.rotation.x -= GAIT.arm * c * amount;

    if (bones.chest) bones.chest.rotation.y = -GAIT.twist * s * amount;
  }

  /**
   * 立ち姿を生かす。棒立ちは 3D だとすぐ人形に見えるので、呼吸（1 分に 15 回
   * くらい）と、それより遅い重心の揺れを別々の周期で重ねる。
   */
  function applyIdle(dt) {
    elapsed += dt;

    const breath = Math.sin(elapsed * 1.6);
    const sway = Math.sin(elapsed * 0.42) * (1 - gait);
    const drift = Math.sin(elapsed * 0.27 + 1.1) * (1 - gait);

    if (bones.hips) {
      // 呼吸で腰を上下させるのは立ち止まっているときだけ。歩行中に動かすと、
      // せっかく地面に固定した足が腰ごと持ち上がって滑る
      bones.hips.position.y += breath * 0.006 * (1 - gait);
      bones.hips.rotation.z += sway * 0.02;
      bones.hips.rotation.y = drift * 0.03;
    }
    if (bones.spine) bones.spine.rotation.x += breath * 0.012;
    if (bones.chest) bones.chest.rotation.x += breath * 0.018;
    if (bones.neck) bones.neck.rotation.z += sway * -0.015;

    // まばたき。2〜6 秒に 1 回、0.12 秒で閉じて開く
    const expressions = vrm.expressionManager;
    if (!expressions) return;
    if (elapsed > blinkAt) {
      blink += dt / 0.12;
      if (blink >= 2) {
        blink = 0;
        blinkAt = elapsed + 2 + Math.random() * 4;
      }
    }
    expressions.setValue('blink', blink <= 1 ? blink : 2 - blink);
  }

  /**
   * 足の接地影を置く。
   *
   * 足のワールド座標はボーンから取らず、歩容の計画値（前後のオフセット）と
   * 体の向きから直に出す。update はレンダリングの前に走るのでボーンの
   * ワールド行列がまだ更新されておらず、わざわざ更新するより安い。
   */
  function updateFootShadows() {
    const amount = gait * (1 - sitAmount);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const legs = [['left', phase, -1], ['right', phase + Math.PI, 1]];

    legs.forEach(([, p, side], index) => {
      const shadow = footShadows[index];
      const plan = amount > 0.001 ? footPlan(p) : { offset: 0, lift: 0 };
      // 歩容ぶんは amount で薄めて、立ち止まっているときは足元に戻す
      const forward = plan.offset * amount;
      const lift = plan.lift * amount;
      const lateral = side * hipWidth;

      shadow.position.set(
        group.position.x + lateral * cos + forward * sin,
        // ラグ（y = 0.006）と同じ高さに置くと Z ファイティングで消える
        0.014,
        group.position.z - lateral * sin + forward * cos,
      );

      // 浮くほど大きく薄くなる。接地の瞬間がいちばん濃い
      const height = clamp01(lift / 0.12);
      const scale = 0.60 * (1 + height * 0.6);
      shadow.scale.set(scale, scale, 1);
      shadow.material.opacity = (1 - height * 0.75) * (1 - sitAmount);
      shadow.visible = shadow.material.opacity > 0.02;
    });
  }

  function update(dt) {
    if (!vrm) return;
    if (wander) updateBehavior(dt);
    applyPose();
    applyGait();
    applyIdle(dt);
    updateFootShadows();
    // スプリングボーン（髪・服）、視線、表情をまとめて進める
    vrm.update(dt);
  }

  return {
    group,
    ready,
    update,
    get vrm() { return vrm; },
    /** ライセンス表記用。読み込み前は null */
    get meta() { return vrm?.meta ?? null; },
    /** デバッグ用 */
    get state() { return state; },
    route: ROUTE,
    seats: SEATS,
  };
}
