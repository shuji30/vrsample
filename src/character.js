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

/**
 * 掃き出し窓から庭へ出る道順。経路のソファの前（節点 6）から、テーブルと
 * 椅子の右脇を抜けて、引き戸の開いている側（x = -0.4..1.4）を通る。
 */
const EXIT_NODE = 6;

/** 背もたれに預けて座るときの腰のソファローカル z（背もたれの前面は -0.22） */
const LOUNGE_SEAT_Z = -0.11;
/** そのときの脚の付け根の、座面からの高さ（m） */
const LOUNGE_LIFT = 0.13;
/** 横になるときの腰のソファローカル x / z と、座面からの高さ */
const NAP_X = 0.10;
const NAP_Z = 0.10;
const NAP_LIFT = 0.24;
/**
 * 眠るときに腰かける位置（ソファローカル x）。クッションの真ん中（+0.5）に
 * 座ってから体を倒すと、伸ばした足先が肘掛けに当たった。ソファの中ほどに
 * 座れば、倒したあと頭は -X 側のクッション、足は肘掛けの手前に収まる
 */
const NAP_SEAT_X = 0.15;
/**
 * 座るとき / 立つときに、座面の縁まで下がる位置（腰のボーンのソファローカル z）。
 * このモデルは小柄で、座面（61cm）がお尻より高い。まっすぐ後ろへ下がると
 * お尻が座面の前側へ突っ込むので（12cm めり込んだ）、縁まで下がってから、
 * 腰を持ち上げて奥へ乗る。
 */
const EDGE_Z = SOFA.frontZ + 0.16;
/** 奥へ乗るときに腰を持ち上げる高さ（m） */
const HOP = 0.10;
/** 横になる / 起き上がる途中で腰を浮かせる高さ（m）。倒す途中で腰の横が沈む */
const ROLL_LIFT = 0.12;
const EXIT_PATH = [
  [1.35, -1.4],
  [1.15, -3.25],
  [0.9, -4.5],
].map(([x, z]) => new THREE.Vector2(x, z));

/** 立ちポーズ。T ポーズからの差分。肩から先を段階的に曲げると自然に見える */
// 腕は体の横へまっすぐ下ろす。肘を曲げて脇を開けていると、止まっているときに
// 小包を抱えているように見え、歩くと肘を張って偉そうに見えた
const STAND_POSE = {
  leftUpperArm: [0, 0, -1.30],
  rightUpperArm: [0, 0, 1.30],
  leftLowerArm: [0, -0.08, -0.05],
  rightLowerArm: [0, 0.08, 0.05],
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
  // 腿は水平から 24 度の下り。ここが浅い（水平に近い）とスカートの裾が腿に
  // 乗り上げてめくれ、深い（下げすぎ）と腿が座面クッションにめり込む。
  // 座る位置は placeSeats がこの角度から逆算して前寄りに取るので、
  // 膝は座面の前縁を越え、腿の下面がちょうど座面をなぞる。
  // 膝は閉じる。スカートが短いので、開くとどうしても中が見えてしまう
  // 膝をそろえる向きは、左脚が -Z・右脚が +Z（両方の符号を描いて確かめた。
  // 以前の +0.11 / -0.11 は膝が開いて、短いスカートの中が正面から見えていた）
  leftUpperLeg: [-1.15, 0.05, -0.08],
  rightUpperLeg: [-1.15, -0.05, 0.08],
  // 脛はほぼ真下。身長 1.4m のモデルに座面 61cm のソファなので足は床に
  // 届かない。無理に届かせようとすると腰を沈めるしかなくなる。
  leftLowerLeg: [1.10, 0, 0],
  rightLowerLeg: [1.10, 0, 0],
  leftFoot: [0.20, 0, 0],
  rightFoot: [0.20, 0, 0],
  // 背すじを伸ばし、ほんの少しだけ前へ。前傾は +X まわり（モデルは +Z を向く）。
  // 以前は -0.15 / -0.10 で「やや前かがみ」のつもりが、実際は後ろへ反り返っていた
  spine: [0.06, 0, 0],
  chest: [0.04, 0, 0],
};

/**
 * 足を組む（右脚を左の腿に乗せる）。SIT_POSE との差ぶんだけ書く。
 * 載せる右腿は深く上げて内へ寄せ、脛は下へ垂らす。
 */
const CROSS_LEGS = {
  rightUpperLeg: [-1.42, -0.10, 0.34],
  rightLowerLeg: [1.30, 0, 0],
  rightFoot: [0.35, 0, 0],
  leftUpperLeg: [-1.12, 0.05, -0.06],
};

/**
 * 背もたれに背中をつけて、足を前へ伸ばす座り方。骨盤を後ろへ倒して
 * 背もたれに預け、腿は座面に沿わせ、膝を伸ばして踵を床へ出す。
 */
const LOUNGE_POSE = {
  hips: [-0.30, 0, 0],
  spine: [-0.06, 0, 0],
  chest: [0.02, 0, 0],
  neck: [0.20, 0, 0],
  head: [0.12, 0, 0],
  leftUpperArm: [0.05, 0, -1.10],
  rightUpperArm: [0.05, 0, 1.10],
  leftLowerArm: [0, -0.40, -0.10],
  rightLowerArm: [0, 0.40, 0.10],
  leftHand: [0, 0, -0.10],
  rightHand: [0, 0, 0.10],
  // 脚は座面の上へまっすぐ伸ばし、足先を座面の縁から出す。小柄なので膝が
  // 縁まで届かず、膝を曲げると脛が座面へ折れ込んでいた（5.5cm めり込み）
  leftUpperLeg: [-1.24, 0.06, -0.07],
  rightUpperLeg: [-1.24, -0.06, 0.07],
  leftLowerLeg: [0.10, 0, 0],
  rightLowerLeg: [0.10, 0, 0],
  leftFoot: [-0.25, 0, 0],
  rightFoot: [-0.25, 0, 0],
};

/**
 * ソファに横になって眠る。座った向きのまま体を右へ倒し（腰を Z まわりに
 * 90 度）、右半身を下にして、背中を背もたれへ向ける。膝は軽く曲げる。
 */
const NAP_POSE = {
  hips: [0, 0, 1.5708],
  spine: [0.12, 0, 0],
  chest: [0.08, 0, 0],
  neck: [0.10, 0, 0.18],
  head: [0.05, 0, 0.12],
  leftUpperArm: [0.3, 0, -1.2],
  rightUpperArm: [0.3, 0, 1.2],
  leftLowerArm: [0, -0.8, 0],
  rightLowerArm: [0, 0.8, 0],
  leftHand: [0, 0, -0.10],
  rightHand: [0, 0, 0.10],
  leftUpperLeg: [-0.62, 0, 0.02],
  rightUpperLeg: [-0.48, 0, -0.02],
  leftLowerLeg: [1.05, 0, 0],
  rightLowerLeg: [0.95, 0, 0],
  leftFoot: [0.35, 0, 0],
  rightFoot: [0.35, 0, 0],
};

/**
 * 横になる / 起き上がる途中だけ、脚を胸のほうへ引き寄せる。座面の縁から
 * 垂れた脛をそのまま回すと、体を倒す途中で脛が座面をなでて沈む（9cm）。
 */
const TUCK_POSE = {
  // 膝を深く曲げると足先がお尻の下（座面の中）へ入るので、腿を高く上げて
  // 膝は浅めに曲げる。足先は座面より前・上に残る
  leftUpperLeg: [-1.95, 0, -0.05],
  rightUpperLeg: [-1.95, 0, 0.05],
  leftLowerLeg: [1.35, 0, 0],
  rightLowerLeg: [1.35, 0, 0],
  leftFoot: [0.2, 0, 0],
  rightFoot: [0.2, 0, 0],
};

/**
 * 笑顔のリアクション。毎回同じ顔だと作り物に見えるので、いくつか用意して
 * 前回と違うものを選ぶ。face は VRM の表情の重み、tilt / nod は首のかしげと
 * 上下（rad）。steps があるものは、途中で顔が切り替わる（びっくり → にこっ）。
 */
const REACTIONS = {
  // 目を細めて、にっこり
  nikkori: { face: { happy: 0.9 }, tilt: 0.06 },
  // 目は開けたまま、やわらかく微笑む
  hohoemi: { face: { relaxed: 0.75, happy: 0.25 }, tilt: -0.08, nod: 0.05 },
  // 口を開けて大よろこび。少し顔を上げる
  yorokobi: { face: { happy: 1.0, aa: 0.55 }, tilt: 0.04, nod: -0.10 },
  // ウインク
  wink: { face: { blinkRight: 1.0, happy: 0.35, ee: 0.25 }, tilt: 0.16 },
  // えへへ（照れ笑い）。首をかしげる
  ehehe: { face: { happy: 0.6, ee: 0.35 }, tilt: -0.20, nod: 0.06 },
  // びっくりしてから、にこっ
  bikkuri: {
    steps: [
      { until: 0.35, face: { surprised: 0.85, oh: 0.45 }, nod: -0.08 },
      { face: { happy: 0.85 }, tilt: 0.08 },
    ],
  },
};
const REACTION_NAMES = Object.keys(REACTIONS);
const REACTION_FACES = ['happy', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blinkRight'];
/** 口の形（しゃべるとき voice.js が入れる） */
const MOUTH_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'];

const POSE_BONES = [...new Set([
  ...Object.keys(STAND_POSE), ...Object.keys(SIT_POSE), ...Object.keys(CROSS_LEGS),
  ...Object.keys(LOUNGE_POSE), ...Object.keys(NAP_POSE), 'hips', 'neck', 'head',
])];

/** 指を軽く握らせる。開いたままの手は VR で見ると妙に目につく */
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'].flatMap((finger) =>
  ['Proximal', 'Intermediate', 'Distal'].map((joint) => `${finger}${joint}`),
);

/**
 * 力を抜いて軽く握った手（付け根・中・先の曲げ、rad）。小指側ほど深く曲がるのが
 * 自然な形で、全部同じ角度だと作り物に見える。以前は全部 0.28rad で、ほとんど
 * 開いた「パー」だったので、歩くとロボットのように見えた。
 */
const FINGER_CURL = {
  Index: [0.50, 0.62, 0.42],
  Middle: [0.62, 0.72, 0.48],
  Ring: [0.72, 0.78, 0.50],
  Little: [0.82, 0.82, 0.50],
};

/**
 * 歩きのパラメータ。
 *
 * 腿と膝の角度はここには無い。以前は腿の振り幅を角度で決め打ちしていたが、
 * それだと足の可動範囲（脚長 × sin 振り幅）と歩幅が一致せず、立脚中の足が
 * 地面を滑る。いまは歩幅と脚の長さから毎フレーム逆算している（solveLeg）。
 */
const GAIT = {
  arm: 0.46,        // 腕は脚と逆位相
  elbow: 0.12,      // 前に振れた側だけ肘をわずかに曲げる。深く曲げると肘を張って偉そうに見える
  ankle: 0.30,      // 蹴り出し / 着地の足首
  lift: 0.30,       // 遊脚で足を持ち上げる高さ（歩幅に対する比）
  dip: 0.014,       // 接地直後に体重が乗って沈む量（m）
  roll: 0.050,      // 腰の左右の傾き（遊脚側が下がる）
  twist: 0.075,     // 胸の捻り。骨盤と逆に回る
  lean: 0.050,      // 歩くときの前傾
};

const TAU = Math.PI * 2;
/** crouch = 1 のときに腰を落とす量（m）。ボールを拾うときに膝を曲げるぶん */
const CROUCH_DEPTH = 0.42;
/** bend = 1 のときに上体を前へ倒す角度（rad）。背骨と胸で分ける */
const BEND_ANGLE = 1.4;
/** しゃがんだときに腰を後ろへ引く量（m）。上体を倒したぶんの釣り合いを取る */
const CROUCH_BACK = 0.12;
const IDENTITY = new THREE.Quaternion();

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

/** 眠るときの席。いちばん近い節点は +X 側のクッションと同じ */
function napSeat() {
  const base = SEATS.find((s) => s.localX > 0);
  return {
    ...base,
    localX: NAP_SEAT_X,
    seat: sofaToWorld(NAP_SEAT_X, base.localZ ?? SOFA.seatZ),
    approach: sofaToWorld(NAP_SEAT_X, SOFA.frontZ + 0.30),
  };
}

/**
 * 腰を下ろす点を、膝が座面の前縁あたりに来るように決める。
 * 腿が座面より短いモデル（子どもや小柄なキャラクター）が座面の奥に腰を下ろすと、
 * 脛がクッションに埋まってしまう。深さは背もたれまでで頭打ちにする。
 */
function placeSeats(thighReach) {
  // +0.08 は脛のぶんの逃げ。膝が座面の前縁より少し前に出るようにする
  const localZ = Math.max(SOFA.seatZ, SOFA.frontZ - thighReach + 0.08);
  for (const seat of SEATS) {
    seat.seat = sofaToWorld(seat.localX, localZ);
    seat.localZ = localZ;
  }
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

export function createCharacter(scene, { url = CHARACTER.url, camera = null, wander = true, sit = true } = {}) {
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
  let hipsRestZ = 0;
  let stride = CHARACTER.stride;

  // 脚の寸法。歩幅と辻褄の合う脚の角度を逆算するのに要る
  let thighLen = 0.34;    // 腰から膝
  let shinLen = 0.34;     // 膝から足首
  let legLength = 0.67;   // 腰の付け根から足首までの、立ちポーズでの高さ
  let ankleRestY = 0.06;  // 足首の床からの高さ（実測）
  let legTopOffset = -0.05; // 腰のボーンから見た脚の付け根の高さ（負）
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
  // 座り方。upright（ふつう）/ lounge（背もたれに預けて足を伸ばす）/ nap（横になって眠る）
  let lounge = 0;         // lounge の混ざり具合
  let napAmount = 0;      // 横になっている度合い
  let tuck = 0;           // 横になる途中で脚を引き寄せる度合い
  let legCross = 0;       // 足を組んでいる度合い（ふつうの座りのとき）
  let legCrossWant = 0;
  let armCross = 0;       // 腕を組んでいる度合い
  let armCrossWant = 0;
  let fidgetAt = 0;       // 次に腕や足を組み替える時刻
  const seatRoot = new THREE.Vector3();   // 腰を下ろしている（寝ている）ときのルート位置
  let elapsed = 0;        // 呼吸とまばたきの時計
  let blinkAt = 2.5;
  let blink = 0;
  let settleSprings = 0;  // スプリングボーンを落ち着かせる残りフレーム数

  // --- 外から動かすとき（キャッチボール） -----------------------------------
  /** 値が入っているあいだは、部屋をうろうろする状態機械を止めて任せる */
  let driver = null;
  let strideGain = 1;     // 歩幅の倍率。急ぐときは歩幅を広げて、回転数を上げすぎない
  let crouch = 0;         // 膝を曲げて腰を落とす度合い（0..1）
  let crouchWant = 0;
  let bend = 0;           // 上体を前に倒す度合い（0..1）
  let bendWant = 0;
  let armAmount = 0;      // 腕を目標へ伸ばす度合い（0..1）
  let armWant = 0;
  const armTarget = new THREE.Vector3();   // 両手のあいだに来てほしい点（ワールド）
  // 腕を下ろしはじめたときの目標点を、体から見た位置で覚えておく。
  // ワールドのまま残すと、力を抜いているあいだに振り返って走り出したとき、
  // 背中側に残った目標点へ両腕が引っぱられた（走りながら腕を後ろへ突き出す）
  const armLocal = new THREE.Vector3();
  let armFollow = false;
  let armSpread = 0.08;                     // 手首どうしの間隔の半分
  const catchPoint = new THREE.Vector3();  // 両手のあいだの点。毎フレーム更新
  let onPosed = null;
  let focus = false;                        // 止まっているボールでも目で追う
  let attend = false;                       // ボールを見ていないときは相手（camera）の顔を見る
  let handOpen = 0;                         // 指の開き（0 = 軽く握る）
  let handOpenWant = 0;
  // 笑顔のリアクション。いまの顔の重みを faceNow に持って、目標へ寄せる
  let reaction = null;                      // { recipe, start, until, strength }
  let lastReaction = '';
  const faceNow = Object.fromEntries(REACTION_FACES.map((n) => [n, 0]));
  // しゃべっている口。リアクションの口（大よろこびの aa など）と大きいほうを使う
  const mouthWant = Object.fromEntries(MOUTH_SHAPES.map((n) => [n, 0]));
  const mouthNow = Object.fromEntries(MOUTH_SHAPES.map((n) => [n, 0]));
  let tiltNow = 0;
  let nodNow = 0;
  /**
   * 投球の姿勢（throwing.js が毎フレーム入れる）。null なら何もしない。
   * { weight, hipsYaw, chestYaw, bend, hipShift, hipDrop,
   *   left: {forward, lift}, right: {forward, lift} }
   */
  let throwPose = null;
  /** 片手ずつの目標。投球中は両手で 1 点ではなく、左右が別々に動く */
  const hands = {
    left: { target: new THREE.Vector3(), amount: 0, pole: null },
    right: { target: new THREE.Vector3(), amount: 0, pole: null },
    active: false,
  };                       // 姿勢が決まったあとに呼ぶ（持ったボールを手に付ける）

  // --- 視線 ---------------------------------------------------------------
  let watched = null;      // 投げられたら目で追うもの（野球ボール）
  let gaze = 0;            // それを見ている度合い（0..1）
  let lookYaw = 0;         // いま首が向いている角度（体の正面から）
  let lookPitch = 0;
  let idleYaw = 0;         // きょろきょろの目標
  let idlePitch = 0;
  let idleUntil = 1.5;
  let headRestY = 1.2;     // 頭のボーンの、足元からの高さ

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
      relaxSkirtWeights(vrm);

      // 腰の高さと腿の長さは、座面に腰を乗せる位置に要る。歩幅も身体に合わせる
      hipsRestY = bones.hips ? bones.hips.position.y : 0.7;
      hipsRestZ = bones.hips ? bones.hips.position.z : 0;
      stride = CHARACTER.stride * (hipsRestY / 0.70);

      // 正規化ボーンのローカル位置は、そのまま骨の長さになっている
      thighLen = bones.leftLowerLeg ? bones.leftLowerLeg.position.length() : thighLen;
      shinLen = bones.leftFoot ? bones.leftFoot.position.length() : shinLen;
      hipWidth = bones.leftUpperLeg ? Math.abs(bones.leftUpperLeg.position.x) : hipWidth;
      placeSeats(measureThigh(vrm) * Math.sin(-SIT_POSE.leftUpperLeg[0]));

      // 視線でこちらを追わせる。XR 中も camera の matrixWorld は
      // WebXRManager が更新してくれるので、これで両対応になる
      if (camera && vrm.lookAt) vrm.lookAt.target = camera;

      group.add(vrm.scene);
      measureLegs();
      if (bones.head) {
        const head = new THREE.Vector3();
        bones.head.getWorldPosition(head);
        headRestY = head.y;
      }
      return vrm;
    })
    .catch((error) => {
      // モデルが無いのは想定内の状態なので、読み込み失敗で部屋ごと止めたりはしない
      console.warn(`[character] ${url} を読み込めませんでした:`, error.message ?? error);
      return null;
    });

  /**
   * スカートの頂点が腿（UpperLeg）から受けている影響を、腰（Hips）へ移す。
   *
   * このモデルのスカートは腿にスキニングされているので、座って腿を上げると
   * 裾が腿に引っぱられて持ち上がり、めくれ上がったように見える。スカートの
   * ボーンを畳んでも直らないのはこのため（実際に試して変わらなかった）。
   *
   * 「スカートの頂点」は、スプリングボーン用のスカートボーン（VRoid 系なら
   * J_Sec_*Skirt*）から影響を受けているかどうかで判定する。名前でメッシュを
   * 探すより、モデルによる違いに強い。
   *
   * 腰へ移すと、歩いたときに脚がスカートを押し広げる動きは失われるが、
   * 裾はスプリングボーンが揺らすので見た目の破綻はない。
   */
  function relaxSkirtWeights(model) {
    let moved = 0;

    model.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const skeleton = mesh.skeleton?.bones;
      const index = mesh.geometry?.attributes?.skinIndex;
      const weight = mesh.geometry?.attributes?.skinWeight;
      if (!skeleton || !index || !weight) return;

      const skirt = new Set();
      const thigh = new Set();
      let hips = -1;
      skeleton.forEach((bone, i) => {
        const name = bone?.name ?? '';
        if (/skirt/i.test(name)) skirt.add(i);
        else if (/upperleg/i.test(name)) thigh.add(i);
        else if (hips < 0 && /hips/i.test(name)) hips = i;
      });
      if (hips < 0 || skirt.size === 0 || thigh.size === 0) return;

      for (let v = 0; v < index.count; v++) {
        let isSkirt = false;
        for (let k = 0; k < 4; k++) {
          if (weight.getComponent(v, k) > 0.01 && skirt.has(index.getComponent(v, k))) {
            isSkirt = true;
            break;
          }
        }
        if (!isSkirt) continue;

        let transfer = 0;
        for (let k = 0; k < 4; k++) {
          const w = weight.getComponent(v, k);
          if (w > 0 && thigh.has(index.getComponent(v, k))) {
            transfer += w;
            weight.setComponent(v, k, 0);
          }
        }
        if (transfer <= 0) continue;

        // すでに腰の枠があればそこへ、無ければ空いた枠を腰にする
        let slot = -1;
        for (let k = 0; k < 4; k++) if (index.getComponent(v, k) === hips) { slot = k; break; }
        if (slot < 0) {
          for (let k = 0; k < 4; k++) if (weight.getComponent(v, k) <= 0) { slot = k; break; }
          if (slot >= 0) index.setComponent(v, slot, hips);
        }
        if (slot < 0) continue;   // 4 枠が全部埋まっている頂点はあきらめる

        weight.setComponent(v, slot, weight.getComponent(v, slot) + transfer);
        moved++;
      }

      index.needsUpdate = true;
      weight.needsUpdate = true;
    });

    return moved;
  }

  /**
   * 脚の寸法を、立ちポーズの実体から測る。
   *
   * 腿と脛の長さを足したものを「腰から足首までの高さ」として使ってはいけない。
   * 脚は真下に一直線に伸びているわけではない（付け根が外へ開いている）ので、
   * 合計は実際の高さより 1〜2cm 長くなる。それを足首の基準にすると、歩き
   * はじめた瞬間に靴がそのぶん床へめり込む。実際に一度これで沈めた。
   */
  function measureLegs() {
    const legTop = new THREE.Vector3();
    const ankle = new THREE.Vector3();
    group.updateMatrixWorld(true);
    if (!bones.leftUpperLeg || !bones.leftFoot) return;
    bones.leftUpperLeg.getWorldPosition(legTop);
    bones.leftFoot.getWorldPosition(ankle);

    ankleRestY = ankle.y;
    legTopOffset = legTop.y - hipsRestY;
    // 立ちポーズの脚の伸び具合をそのまま基準にする。offset = 0 のときに
    // 腰がちょうど元の高さに戻るので、歩いても中腰にならない
    legLength = Math.min(legTop.y - ankle.y, thighLen + shinLen - 0.001);
    stride = Math.min(stride, legLength * 0.5);
  }

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
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
    ];
    for (const name of new Set(names)) {
      const node = humanoid.getNormalizedBoneNode(name);
      if (node) bones[name] = node;
    }
    if (!bones.chest) bones.chest = bones.upperChest;
  }

  /** 指のボーンを引いておく。姿勢は毎フレーム applyFingers が入れる */
  const fingerNodes = [];
  function curlFingers(humanoid) {
    if (!humanoid) return;
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      for (const [finger, curls] of Object.entries(FINGER_CURL)) {
        ['Proximal', 'Intermediate', 'Distal'].forEach((joint, i) => {
          const node = humanoid.getNormalizedBoneNode(`${side}${finger}${joint}`);
          if (node) fingerNodes.push({ node, axis: 'z', angle: sign * curls[i] });
        });
      }
      // 親指は人差し指の脇へ寄せて、先を少し曲げる
      const thumb = humanoid.getNormalizedBoneNode(`${side}ThumbProximal`);
      if (thumb) fingerNodes.push({ node: thumb, axis: 'y', angle: sign * -0.45 });
      const thumbTip = humanoid.getNormalizedBoneNode(`${side}ThumbDistal`);
      if (thumbTip) fingerNodes.push({ node: thumbTip, axis: 'y', angle: sign * -0.35 });
    }
    applyFingers(0);
  }

  /**
   * 指を入れる。open が 1 に近いほど開く。ボールを受けようと手を伸ばすときだけ
   * 開き、ふだんは軽く握っておく。
   */
  function applyFingers(dt) {
    handOpen += (handOpenWant - handOpen) * Math.min(1, dt * 8);
    const k = 1 - handOpen * 0.7;
    for (const f of fingerNodes) {
      f.node.rotation.set(0, 0, 0);
      f.node.rotation[f.axis] = f.angle * k;
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
    // ソファが空いていて、前に座ってからしばらく経っていたら座りにいく。
    // ?sit=off で座らせないようにもできる（座り姿勢はスカートの裾が
    // 腿に乗り上げてしまうモデルがあるため、切れるようにしてある）
    if (sit && clock > nextSitAt && Math.random() < 0.6) {
      // 座り方を選ぶ。ふつう 5 割、背もたれに預けて足を伸ばす 3 割、横になって眠る 2 割。
      // 眠るときは右半身を下にして頭をソファの -X 側へ倒すので、+X 側のクッションに座る
      const r = Math.random();
      const style = r < 0.5 ? 'upright' : r < 0.8 ? 'lounge' : 'nap';
      const seat = style === 'nap' ? napSeat() : SEATS[Math.floor(Math.random() * SEATS.length)];
      planSit(seat, style);
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
  function planSit(seat, style = 'upright') {
    seat = { ...seat, style };
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
    // 速く歩くときは歩幅を広げる。歩幅そのままで速度だけ上げると、足が
    // 小刻みにばたついて見える（人は速く歩くとき、回転数より先に歩幅を伸ばす）
    const gainWant = 1 + 0.55 * clamp01((speed - CHARACTER.speed) / 0.8);
    strideGain += (gainWant - strideGain) * Math.min(1, dt * 4);

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
    phase += (Math.PI * distance) / (stride * strideGain);
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

      // 後ろ向きに座面の縁まで下がり、腰を持ち上げて奥へ乗る
      case 'sitDown': {
        // ゆっくり座る。急に腿を上げるとスプリングボーン（スカート）が
        // 跳ね上がって裾がめくれる
        transition = Math.min(1, transition + dt / 2.6);
        const before = new THREE.Vector2(group.position.x, group.position.z);
        // 眠るときも、いったんふつうに腰かけてから横になる
        const style = seated.style === 'lounge' ? 'lounge' : 'upright';
        const target = seatPoint(style);
        const edge = sofaToWorld(seated.localX, EDGE_Z);
        const t = transition;
        if (t < 0.35) {
          const k = smoothstep(0, 1, t / 0.35);
          group.position.x = lerp(seated.approach.x, edge.x, k);
          group.position.z = lerp(seated.approach.y, edge.y, k);
          group.position.y = 0;
          sitAmount = 0.12 * k;
        } else {
          const u = (t - 0.35) / 0.65;
          // 先に腿を上げ（sitAmount）、腰を浮かせながら奥へ滑り込む
          sitAmount = 0.12 + 0.88 * smoothstep(0, 0.7, u);
          const slide = smoothstep(0.2, 1, u);
          group.position.x = lerp(edge.x, target.x, slide);
          group.position.z = lerp(edge.y, target.y, slide);
          group.position.y = lerp(0, sitRootY(style), smoothstep(0, 1, u)) + HOP * Math.sin(Math.PI * Math.min(1, u * 1.15));
        }
        lounge = style === 'lounge' ? smoothstep(0.6, 1, t) : 0;
        // 下がっているあいだは足も動く（位相は後ろ向きに進める）
        const moved = before.distanceTo(new THREE.Vector2(group.position.x, group.position.z));
        advanceGait(-moved, dt, t < 0.35 ? 0.7 : 0);
        if (transition >= 1) {
          group.position.y = sitRootY(style);
          seatRoot.copy(group.position);
          fidgetAt = clock + 2 + Math.random() * 3;
          if (seated.style === 'nap') {
            transition = 0;
            state = 'lieDown';
            break;
          }
          state = 'sit';
          stateUntil = clock + (seated.style === 'lounge' ? 16 + Math.random() * 14 : 14 + Math.random() * 14);
          // 腰かけ終わったらスカートの揺れを一度落ち着かせる。遷移中に
          // 溜まった勢いがそのまま残ると、裾が持ち上がったままになる
          settleSprings = 2;
        }
        break;
      }

      case 'sit': {
        // ふつうの座りのあいだは、ときどき腕を組んだり足を組んだりする
        if (seated.style === 'upright' && clock > fidgetAt && clock < stateUntil - 2) {
          fidgetAt = clock + 5 + Math.random() * 5;
          if (Math.random() < 0.6) armCrossWant = armCrossWant > 0.5 ? 0 : 1;
          if (Math.random() < 0.5) legCrossWant = legCrossWant > 0.5 ? 0 : 1;
        }
        // 立つ前に組んでいた腕と足をほどく
        if (clock > stateUntil - 1.5) { armCrossWant = 0; legCrossWant = 0; }
        const k = Math.min(1, dt * 1.6);
        armCross += (armCrossWant - armCross) * k;
        legCross += (legCrossWant - legCross) * k;
        if (clock > stateUntil && armCross < 0.05 && legCross < 0.05) {
          armCross = 0;
          legCross = 0;
          transition = 0;
          state = 'standUp';
        }
        break;
      }

      // 腰かけた姿勢から、右へ体を倒して横になる。腰は座面の中ほどへずらす
      case 'lieDown': {
        transition = Math.min(1, transition + dt / 2.6);
        const t = transition;
        // 先に体を倒して脚を座面の上へ上げ、それから奥（寝る位置）へずれる。
        // 同時にずらすと、縁から垂れた脛が上がる前に座面へ入り込んだ（12cm）
        napAmount = smoothstep(0, 0.7, t);
        tuck = Math.sin(Math.PI * Math.min(1, t / 0.75)) * 0.85;
        const slide = smoothstep(0.55, 1, t);
        const lie = napPoint();
        group.position.x = lerp(seatRoot.x, lie.x, slide);
        group.position.z = lerp(seatRoot.z, lie.y, slide);
        group.position.y = lerp(seatRoot.y, napRootY(), smoothstep(0, 0.8, t)) + ROLL_LIFT * Math.sin(Math.PI * Math.min(1, t / 0.8));
        if (transition >= 1) {
          tuck = 0;
          state = 'nap';
          stateUntil = clock + 25 + Math.random() * 20;
          settleSprings = 2;
        }
        break;
      }

      case 'nap':
        if (clock > stateUntil) {
          transition = 0;
          state = 'getUp';
        }
        break;

      // 起き上がって、腰かけた姿勢へ戻る
      case 'getUp': {
        transition = Math.min(1, transition + dt / 2.4);
        const t = transition;
        // 横になるときの逆。先に手前へずれてから、体を起こして脚を下ろす
        const slide = smoothstep(0, 0.45, t);
        napAmount = 1 - smoothstep(0.3, 1, t);
        tuck = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - 0.25) / 0.75))) * 0.85;
        const lie = napPoint();
        group.position.x = lerp(lie.x, seatRoot.x, slide);
        group.position.z = lerp(lie.y, seatRoot.z, slide);
        const u = Math.max(0, (t - 0.2) / 0.8);
        group.position.y = lerp(napRootY(), seatRoot.y, smoothstep(0, 1, u)) + ROLL_LIFT * Math.sin(Math.PI * u);
        if (transition >= 1) {
          napAmount = 0;
          tuck = 0;
          seated = { ...seated, style: 'upright' };
          state = 'sit';
          stateUntil = clock + 2.5;
          settleSprings = 2;
        }
        break;
      }

      // 座面の縁まで滑り出て床に足をつき、立ち上がってソファの前に戻る
      case 'standUp': {
        transition = Math.min(1, transition + dt / 1.8);
        const t = transition;
        const before = new THREE.Vector2(group.position.x, group.position.z);
        const edge = sofaToWorld(seated.localX, EDGE_Z);
        if (t < 0.65) {
          const u = t / 0.65;
          const slide = smoothstep(0, 0.8, u);
          group.position.x = lerp(seatRoot.x, edge.x, slide);
          group.position.z = lerp(seatRoot.z, edge.y, slide);
          group.position.y = lerp(seatRoot.y, 0, smoothstep(0, 1, u)) + HOP * Math.sin(Math.PI * Math.max(0, u * 1.15 - 0.15));
          sitAmount = 0.12 + 0.88 * (1 - smoothstep(0.3, 1, u));
          lounge *= 1 - smoothstep(0, 0.5, u);
        } else {
          const k = smoothstep(0, 1, (t - 0.65) / 0.35);
          group.position.x = lerp(edge.x, seated.approach.x, k);
          group.position.z = lerp(edge.y, seated.approach.y, k);
          group.position.y = 0;
          sitAmount = 0.12 * (1 - k);
          lounge = 0;
        }
        const moved = before.distanceTo(new THREE.Vector2(group.position.x, group.position.z));
        advanceGait(t >= 0.65 ? moved : 0, dt, t >= 0.65 && t < 1 ? 0.7 : 0);
        if (transition >= 1) {
          nodeIndex = seated.via;
          seated = null;
          lounge = 0;
          nextSitAt = clock + 45 + Math.random() * 45;
          queue.push({ point: ROUTE[nodeIndex] });
          decide();
        }
        break;
      }
    }
  }

  /** 腰を座面に乗せるためのルートの高さ（床より下がることもある） */
  /** 腰を下ろす点（XZ）。背もたれに預けるときは奥へ、眠るときは座面の中ほど */
  function seatPoint(style) {
    if (style === 'lounge') return sofaToWorld(seated.localX, LOUNGE_SEAT_Z);
    return seated.seat;
  }
  function napPoint() { return sofaToWorld(NAP_X, NAP_Z); }
  /** 横になったときのルートの高さ。腰（横倒しの骨盤）の厚みの半分だけ座面から浮かす */
  function napRootY() { return seated.top + NAP_LIFT - hipsRestY; }

  function sitRootY(style = 'upright') {
    // 背もたれに預けるときは少し沈む（骨盤を倒して座面の奥へ滑り込む）
    if (style === 'lounge') return seated.top + LOUNGE_LIFT - hipsRestY - legTopOffset;
    // 「脚の付け根が座面より 13cm 上」に来るようルートを置く。腰のボーンでは
    // なく脚の付け根を基準にするのが要点で、ここを間違えると腿が座面に沈む
    // （+0.08 を腰のボーン基準で取っていたときは、膝が座面より 7cm 下だった）。
    // 13cm は腿の太さぶんの逃げも含んだ値。
    return seated.top + 0.13 - hipsRestY - legTopOffset;
  }

  // ------------------------------------------------------------------------
  // 姿勢
  // ------------------------------------------------------------------------

  /**
   * 座っているときの 1 本ぶんの角度。ふつうの座り → 足組み → 背もたれに
   * 預ける → 横になる、の順に重ねて混ぜる
   */
  const _seatValue = [0, 0, 0];
  function seatValue(name) {
    const up = SIT_POSE[name];
    for (let i = 0; i < 3; i++) {
      let v = up?.[i] ?? 0;
      const cross = CROSS_LEGS[name];
      if (cross) v = lerp(v, cross[i], legCross);
      v = lerp(v, LOUNGE_POSE[name]?.[i] ?? 0, lounge);
      v = lerp(v, NAP_POSE[name]?.[i] ?? 0, napAmount);
      const tuckValue = TUCK_POSE[name];
      if (tuckValue && tuck > 0) v = lerp(v, tuckValue[i], tuck);
      _seatValue[i] = v;
    }
    return _seatValue;
  }

  /** 立ちポーズと座りポーズを混ぜて入れる */
  function applyPose() {
    for (const name of POSE_BONES) {
      const node = bones[name];
      if (!node) continue;
      const a = STAND_POSE[name];
      const b = sitAmount > 0 ? seatValue(name) : null;
      node.rotation.set(
        lerp(a?.[0] ?? 0, b?.[0] ?? 0, sitAmount),
        lerp(a?.[1] ?? 0, b?.[1] ?? 0, sitAmount),
        lerp(a?.[2] ?? 0, b?.[2] ?? 0, sitAmount),
      );
    }
    // 腰と首の角度は上の表で毎フレーム入れ直している（歩き / 呼吸は加算で触る）。
    // 位置だけここで戻す
    if (bones.hips) {
      bones.hips.position.y = hipsRestY;
      bones.hips.position.z = hipsRestZ;
    }
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

    const step = stride * strideGain;
    if (u < Math.PI) {
      const t = u / Math.PI;
      return { offset: step * (0.5 - t), lift: 0, stance: t };
    }

    // 遊脚。前へ運びながら持ち上げる
    const t = (u - Math.PI) / Math.PI;
    const eased = t * t * (3 - 2 * t);
    return { offset: step * (eased - 0.5), lift: Math.sin(t * Math.PI) * step * GAIT.lift, stance: -1 };
  }

  /**
   * 足 1 本を、与えた着地点に届くよう腿と膝で解く（2 関節の逆運動学）。
   *
   * 腰から足首までの距離 d が分かれば、余弦定理で膝の角度が出る。膝は
   * 前へ突き出るので、腿は腰-足首を結ぶ線より α だけ前に倒す。
   */
  function solveLeg(leg, p, hipY, amount, { forward = 0, pitch = 0, lift = 0 } = {}) {
    const upper = bones[`${leg}UpperLeg`];
    const lower = bones[`${leg}LowerLeg`];
    const foot = bones[`${leg}Foot`];
    if (!upper || !lower) return;

    const plan = footPlan(p);
    const dz = plan.offset + forward;
    // 脚の付け根は腰のボーンより少し下にあり、腰を左右に傾けるとさらに上下する。
    // これを無視すると、傾いたぶんだけ足が床にめり込んだり浮いたりする。
    const roll = bones.hips ? bones.hips.rotation.z : 0;
    const rootY = hipY + legTopOffset * Math.cos(roll) + upper.position.x * Math.sin(roll);
    const dy = (ankleRestY + plan.lift + lift) - rootY;
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
    // 骨盤を前へ倒していれば（pitch）、そのぶん腿を戻して足の向きを保つ
    upper.rotation.x += (-thigh - pitch - upper.rotation.x) * amount;
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
      hipY = ankleRestY - legTopOffset
        + Math.sqrt(Math.max(0, legLength * legLength - plan.offset * plan.offset));
      // 接地直後の沈み込み。実際の歩行でも立脚初期に膝が曲がって体重を受ける
      dip = GAIT.dip * Math.sin(Math.PI * clamp01(plan.stance / 0.38));
    }
    hipY -= dip + CROUCH_DEPTH * crouch;

    if (bones.hips) {
      bones.hips.position.y += (hipY - bones.hips.position.y) * amount;
      // 脚は **実際に置いた腰の高さ** で解く。理想値のまま解くと、立ち上がりの
      // 混ぜ込み中に腰と足の辻褄が合わず、接地した足が浮いたり沈んだりする
      hipY = bones.hips.position.y;
      bones.hips.rotation.z = GAIT.roll * s * amount;
    }

    for (const [leg, p] of legs) solveLeg(leg, p, hipY, amount);

    // 腕は脚と逆位相。肩を上げずに前後に振り、前へ出た側だけ肘を曲げる。
    // 肘が伸びたままだと腕が棒のように見え、上半身が止まって感じられる。
    if (bones.leftUpperArm) bones.leftUpperArm.rotation.x += GAIT.arm * c * amount;
    if (bones.rightUpperArm) bones.rightUpperArm.rotation.x -= GAIT.arm * c * amount;
    if (bones.leftLowerArm) bones.leftLowerArm.rotation.y -= GAIT.elbow * Math.max(0, c) * amount;
    if (bones.rightLowerArm) bones.rightLowerArm.rotation.y += GAIT.elbow * Math.max(0, -c) * amount;

    // 体幹。骨盤と胸を逆に捻り、わずかに前傾させる。ここが完全に静止していると、
    // 脚だけが動いて体は引きずられているように見える（「ふわふわ」の主因）。
    if (bones.spine) {
      // 前傾は +X まわり（モデルは +Z を向いている）。以前は -= で、前傾の
      // つもりがわずかに反り返っていた（しゃがむ動きを作ったときに気づいた）
      bones.spine.rotation.x += GAIT.lean * amount;
      bones.spine.rotation.y = GAIT.twist * 0.5 * s * amount;
    }
    if (bones.chest) bones.chest.rotation.y = -GAIT.twist * s * amount;

    // 頭は水平に保つ。腰が揺れても頭が揺れないことで、体が地面を捉えている
    // ように見える（実際の歩行でも頭の揺れは腰よりずっと小さい）
    if (bones.neck) {
      bones.neck.rotation.z = -GAIT.roll * s * amount * 0.8;
      bones.neck.rotation.y = GAIT.twist * s * amount * 0.6;
      bones.neck.rotation.x = -GAIT.lean * amount * 0.7;
    }
  }

  /**
   * 首と視線。
   *
   * やることは 2 つ。ふだんは少しずつあたりを見まわし（キョロキョロ）、
   * ボールが動いていればそちらを追う。追うのは速く、外すのはゆっくりにすると
   * 「気づいて目で追い、やがて興味を失う」ように見える。
   *
   * 首だけでなく頭にも配分するのは、片方だけだと可動域に対して曲がりすぎて
   * 不自然になるため。目玉は VRM の lookAt に任せる。
   */
  const _gazeAt = new THREE.Vector3();
  function applyGaze(dt) {
    const data = watched?.userData;
    const speed = data?.velocity ? data.velocity.length() : 0;
    // 持たれている / 飛んでいるあいだは気にする
    // 自分で持っているときは相手（カメラ）を見る。拾いにいくときは止まっている
    // ボールでも見続ける（focus）
    const heldByMe = data?.heldBy === 'character';
    // キャッチボール中は、相手が手に持っている球ではなく相手の顔を見る
    const heldByOther = Boolean(data?.held && !heldByMe);
    const interested = Boolean(data && !heldByMe && (focus || (heldByOther && !attend) || (!data.held && speed > 0.6)));
    gaze += ((interested ? 1 : 0) - gaze) * Math.min(1, dt * (interested ? 7 : 1.1));

    // --- 目標の向きを決める -----------------------------------------------
    let wantYaw = 0;
    let wantPitch = 0;

    if (gaze > 0.01 && watched) {
      const dx = watched.position.x - group.position.x;
      const dz = watched.position.z - group.position.z;
      const dy = watched.position.y - (group.position.y + headRestY);
      const horizontal = Math.hypot(dx, dz);
      wantYaw = angleDelta(Math.atan2(dx, dz), yaw);
      wantPitch = Math.atan2(dy, Math.max(0.2, horizontal));
    }

    // きょろきょろ。数秒ごとに見る先を変え、そこへゆっくり向く
    if (elapsed > idleUntil) {
      idleYaw = (Math.random() - 0.5) * 0.62;
      idlePitch = (Math.random() - 0.5) * 0.20;
      idleUntil = elapsed + 2.2 + Math.random() * 3.4;
    }
    // ゆっくりした揺らぎを足して、目標に着いたあと完全に止まらないようにする
    const driftYaw = Math.sin(elapsed * 0.37) * 0.05 + Math.sin(elapsed * 0.83 + 1.7) * 0.03;
    const driftPitch = Math.sin(elapsed * 0.29 + 0.6) * 0.022;

    // ふだんの見る先。キャッチボール中はきょろきょろせず相手の顔を見る
    let baseYaw = idleYaw + driftYaw;
    let basePitch = idlePitch + driftPitch;
    if (attend && camera) {
      camera.getWorldPosition(_gazeAt);
      const dx = _gazeAt.x - group.position.x;
      const dz = _gazeAt.z - group.position.z;
      baseYaw = angleDelta(Math.atan2(dx, dz), yaw) + driftYaw * 0.3;
      basePitch = Math.atan2(_gazeAt.y - (group.position.y + headRestY), Math.max(0.3, Math.hypot(dx, dz))) + driftPitch * 0.3;
    }
    wantYaw = lerp(baseYaw, wantYaw, gaze);
    wantPitch = lerp(basePitch, wantPitch, gaze);

    // 首が回りきらないように抑える
    wantYaw = Math.max(-0.95, Math.min(0.95, wantYaw));
    wantPitch = Math.max(-0.5, Math.min(0.45, wantPitch));

    // 追うときは速く、ふだんはゆっくり
    const follow = Math.min(1, dt * lerp(1.8, 9, gaze));
    lookYaw += (wantYaw - lookYaw) * follow;
    lookPitch += (wantPitch - lookPitch) * follow;

    // 眠っているあいだは首を動かさない
    const awake = 1 - napAmount;
    lookYaw *= awake > 0.99 ? 1 : awake;
    lookPitch *= awake > 0.99 ? 1 : awake;
    // 首と頭で分担する
    if (bones.neck) {
      bones.neck.rotation.y += lookYaw * 0.55;
      bones.neck.rotation.x += -lookPitch * 0.5;
    }
    if (bones.head) {
      bones.head.rotation.y += lookYaw * 0.45;
      bones.head.rotation.x += -lookPitch * 0.5;
      // 追っているときは少し首をかしげる。生き物らしさが出る
      bones.head.rotation.z += lookYaw * 0.10 * gaze;
    }

    // 目玉は VRM の lookAt に任せる。見る相手を切り替えるだけ
    if (vrm.lookAt) vrm.lookAt.target = gaze > 0.45 && watched ? watched : camera;
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
      bones.hips.rotation.y += drift * 0.03 * (1 - sitAmount);
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
    // にっこり。ふっと笑って、少し残してから戻す
    // リアクションの顔。立ち上がりは速く、戻りはゆっくり
    let want = null;
    let tiltWant = 0;
    let nodWant = 0;
    if (reaction && elapsed < reaction.until) {
      const t = elapsed - reaction.start;
      const recipe = reaction.recipe;
      const step = recipe.steps ? recipe.steps.find((q) => q.until === undefined || t < q.until) : recipe;
      want = step.face;
      tiltWant = (step.tilt ?? 0) * reaction.strength;
      nodWant = (step.nod ?? 0) * reaction.strength;
    }
    // 口は速く動かす（1 拍 0.13 秒ほど）。表情ほどなめらかにするとぼやける
    for (const name of MOUTH_SHAPES) {
      mouthNow[name] += (mouthWant[name] - mouthNow[name]) * Math.min(1, dt * 22);
    }
    for (const name of REACTION_FACES) {
      const target = (want?.[name] ?? 0) * (reaction?.strength ?? 1);
      faceNow[name] += (target - faceNow[name]) * Math.min(1, dt * (target > faceNow[name] ? 9 : 2.4));
      expressions.setValue(name, Math.max(faceNow[name], mouthNow[name] ?? 0));
    }
    tiltNow += (tiltWant - tiltNow) * Math.min(1, dt * 5);
    nodNow += (nodWant - nodNow) * Math.min(1, dt * 5);
    if (bones.head) {
      bones.head.rotation.z += tiltNow;
      bones.head.rotation.x += nodNow;
    }
    // 目を細めた笑顔（happy）にまばたきを重ねると潰れすぎる
    const smile = faceNow.happy;
    // 笑っている目（細めた目）に、まばたきを重ねると目が潰れすぎる
    const open = 1 - Math.min(1, smile * 1.4);
    // 眠っているあいだは目を閉じ、表情を少しゆるめる
    const shut = Math.max((blink <= 1 ? blink : 2 - blink) * open, napAmount);
    expressions.setValue('blink', shut);
    expressions.setValue('relaxed', Math.max(faceNow.relaxed, napAmount * 0.35));
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

  /**
   * しゃがむ・前かがみ。
   *
   * 腰を落とすだけだと足が床に沈むので、立ち止まっているあいだは両足を
   * その場に置いたまま脚を解き直す（歩いているときは applyGait が同じ腰の
   * 高さで解いている）。上体は背骨と胸に分けて倒す。1 か所で折ると
   * 腰から上が板のように見える。
   */
  function applyCrouch(dt) {
    const k = Math.min(1, dt * 6);
    crouch += (crouchWant - crouch) * k;
    bend += (bendWant - bend) * k;

    // 前かがみは +X まわり（モデルは +Z を向いている）。
    //
    // 背骨だけを曲げても肩はほとんど下がらない。人は物を拾うとき、まず
    // 骨盤ごと前へ倒し（股関節で曲げ）、腰を後ろへ引いて釣り合いを取る。
    // それをしないと、このモデル（肩 1.1m・腕 0.38m）では手が地面から
    // 40cm も上で止まった。骨盤の傾きは立ち止まっているときだけ入れる。
    // 歩きながら骨盤を倒すと、歩容の脚の解き方と噛み合わない。
    const standing = (1 - gait) * (1 - sitAmount);
    const pitch = BEND_ANGLE * 0.5 * bend * standing;
    const back = CROUCH_BACK * smoothstep(0, 1, Math.max(crouch, bend)) * standing;

    const legWeight = standing * smoothstep(0, 0.08, Math.max(crouch, bend));
    if (legWeight > 0.001 && bones.hips) {
      const hipY = hipsRestY - CROUCH_DEPTH * crouch;
      bones.hips.position.y += (hipY - bones.hips.position.y) * legWeight;
      bones.hips.position.z = hipsRestZ - back;
      bones.hips.rotation.x += pitch;
      // 位相 π/2 は立脚のまん中で、足の前後のずれが 0 になる。腰を引いたぶん
      // 足は腰より前にある
      const options = { forward: back, pitch };
      solveLeg('left', Math.PI / 2, bones.hips.position.y, legWeight, options);
      solveLeg('right', Math.PI / 2, bones.hips.position.y, legWeight, options);
    }

    if (bend > 0.001) {
      if (bones.spine) bones.spine.rotation.x += BEND_ANGLE * 0.3 * bend + BEND_ANGLE * 0.5 * bend * (1 - standing);
      if (bones.chest) bones.chest.rotation.x += BEND_ANGLE * 0.2 * bend;
      // 顔は少しだけ起こす。拾うときは手元を見るので起こしすぎない
      if (bones.neck) bones.neck.rotation.x -= BEND_ANGLE * 0.2 * bend;
    }
  }

  /**
   * 投球の体幹と脚。throwing.js が決めた値をそのまま骨に入れる。
   *
   * 捻りは腰・背骨・胸に分ける（腰だけで回すと、脚ごと回って足が滑る）。
   * 脚は「体の正面方向に何 m 踏み出すか」で受け取り、腰を捻っているぶんは
   * cos で割り引いて腰の向きの中で解く。横ずれ（sin 側）は無視している。
   * 捻りは 0.35rad 程度なので、踏み出し 0.3m に対して 10cm 以内に収まる。
   */
  function applyThrow() {
    const p = throwPose;
    if (!p || p.weight < 0.001 || !bones.hips) return;
    const w = p.weight * (1 - sitAmount);

    bones.hips.rotation.y += p.hipsYaw * w;
    if (bones.spine) {
      bones.spine.rotation.y += p.chestYaw * 0.45 * w;
      bones.spine.rotation.x += p.bend * 0.55 * w;
    }
    if (bones.chest) {
      bones.chest.rotation.y += p.chestYaw * 0.55 * w;
      bones.chest.rotation.x += p.bend * 0.45 * w;
    }
    // 顔は投げる相手へ向けたまま。体を捻ったぶん首で戻す
    if (bones.neck) {
      bones.neck.rotation.y -= (p.hipsYaw + p.chestYaw) * 0.6 * w;
      bones.neck.rotation.x -= p.bend * 0.4 * w;
    }
    if (bones.head) bones.head.rotation.y -= (p.hipsYaw + p.chestYaw) * 0.3 * w;

    const hipY = hipsRestY - p.hipDrop;
    bones.hips.position.y += (hipY - bones.hips.position.y) * w;
    bones.hips.position.z = hipsRestZ + p.hipShift * w;
    const c = Math.cos(p.hipsYaw * w);
    for (const side of ['left', 'right']) {
      const foot = p[side];
      solveLeg(side, Math.PI / 2, bones.hips.position.y, w, {
        forward: (foot.forward - p.hipShift) * c,
        lift: foot.lift,
      });
    }
  }

  // --- 腕の逆運動学 ---------------------------------------------------------
  const _pq = new THREE.Quaternion();
  const _bq = new THREE.Quaternion();
  const _dq = new THREE.Quaternion();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _pole = new THREE.Vector3();
  const _goal = new THREE.Vector3();

  /**
   * ボーンを回して、子ボーンへ向かう向きを dir（ワールド、単位ベクトル）に
   * 合わせる。いまの向きからの最小の回転を足すので、腕のねじれは元のまま残る。
   * 正規化ボーンは休止姿勢で回転が 0 なので、子の位置がそのまま骨の向き。
   */
  function aimBone(bone, child, dir, amount) {
    bone.parent.getWorldQuaternion(_pq);
    _bq.copy(_pq).multiply(bone.quaternion);
    _a.copy(child.position).normalize().applyQuaternion(_bq);
    _dq.setFromUnitVectors(_a, dir);
    // slerpQuaternions(IDENTITY, _dq, t) は先に自分を IDENTITY で上書きするので
    // 使えない（実際それで腕がまったく動かなかった）。自分から IDENTITY へ寄せる
    if (amount < 1) _dq.slerp(IDENTITY, 1 - amount);
    _bq.premultiply(_dq);
    bone.quaternion.copy(_pq.invert().multiply(_bq));
    bone.updateMatrixWorld(true);
  }

  /**
   * 片腕を、手首が target に来るように解く（肩-肘-手首の 2 関節）。
   *
   * 肘は下・外・少し後ろへ逃がす。ボールを受ける腕は肘が体の脇へ下がって
   * いるので、そちらに曲がるように極（pole）を置く。
   */
  function solveArm(side, target, amount, poleOverride = null) {
    const upper = bones[`${side}UpperArm`];
    const lower = bones[`${side}LowerArm`];
    const hand = bones[`${side}Hand`];
    if (!upper || !lower || !hand) return;

    const a = lower.position.length();
    const b = hand.position.length();
    upper.getWorldPosition(_a);
    _dir.subVectors(target, _a);
    // target は手のひらの中心。手首はそこから手のひらぶん（7cm）手前に置く
    const d = clamp(_dir.length() - 0.07, Math.abs(a - b) + 0.01, (a + b) * 0.985);
    _dir.normalize();
    _goal.copy(_a).addScaledVector(_dir, d);

    // モデルは +Z を向き、左手が +X にある。これをいまの体の向きへ回す
    const outward = side === 'left' ? 1 : -1;
    if (poleOverride) _pole.copy(poleOverride);
    else _pole.set(Math.cos(yaw) * outward * 0.55 - Math.sin(yaw) * 0.25, -1, -Math.sin(yaw) * outward * 0.55 - Math.cos(yaw) * 0.25);
    _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0);
    _pole.normalize();

    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const alpha = Math.acos(cosA);
    _b.copy(_dir).multiplyScalar(Math.cos(alpha)).addScaledVector(_pole, Math.sin(alpha));
    aimBone(upper, lower, _b, amount);

    lower.getWorldPosition(_c);
    _b.subVectors(_goal, _c).normalize();
    aimBone(lower, hand, _b, amount);
  }

  /**
   * 両手のひらのあいだの点。手首から前腕の向きに 7cm 先が手のひらの中心。
   * 手首どうしの中点だと、下へ手を伸ばしたときに 7cm 届かない計算になる。
   */
  function palmOf(side, out) {
    bones[`${side}Hand`].getWorldPosition(_a);
    bones[`${side}LowerArm`].getWorldPosition(_b);
    _b.subVectors(_a, _b).normalize();
    return out.copy(_a).addScaledVector(_b, 0.07);
  }

  function palmCenter(out) {
    out.set(0, 0, 0);
    for (const side of ['left', 'right']) {
      bones[`${side}Hand`].getWorldPosition(_a);
      bones[`${side}LowerArm`].getWorldPosition(_b);
      _b.subVectors(_a, _b).normalize();
      out.add(_a).addScaledVector(_b, 0.07);
    }
    return out.multiplyScalar(0.5);
  }

  /** 両手を armTarget へ伸ばし、両手のあいだの点（catchPoint）を出す */
  /**
   * 座っているときの腕。腕組み・お腹の上で手を重ねる・寝ている腕は、角度を
   * 並べて合わせ込むより、手を置く場所を決めて IK で解くほうが体格に左右されない。
   * 手の置き場所は胸・腰・頭のボーンから、体の向き（yaw）で前後左右を決める。
   */
  const _seatA = new THREE.Vector3();
  const _seatB = new THREE.Vector3();
  const _poleL = new THREE.Vector3();
  const _poleR = new THREE.Vector3();
  function applySeatedArms() {
    if (driver || sitAmount < 0.01) return false;
    const cross = armCross * (1 - lounge) * (1 - napAmount);
    const belly = lounge * (1 - napAmount);
    const nap = napAmount;
    // 腕を組んでいないときは、両手を膝の上（スカートの前）にそろえて置く
    const lap = (1 - armCross) * (1 - lounge) * (1 - napAmount);
    const w = Math.max(cross, belly, nap, lap) * sitAmount;
    if (w < 0.002 || !bones.leftHand) return false;
    group.updateMatrixWorld(true);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    const at = (base, f, l, u, out) => out.set(base.x + fx * f + lx * l, base.y + u, base.z + fz * f + lz * l);

    let left;
    let right;
    if (nap > cross && nap > belly) {
      // 下になった右手は顔の前、上の左手は胸の前の座面に置く
      (bones.head ?? bones.chest).getWorldPosition(_a);
      // 下になった腕は座面の上に置く。頭より下へ置くと前腕が座面へ沈む
      right = at(_a, 0.20, 0.02, -0.02, _seatA);
      // 上になった左手は腰の前（スカートの裾のあたり）に置く
      bones.hips.getWorldPosition(_b);
      left = at(_b, 0.16, 0.06, 0.02, _seatB);
      _poleR.set(fx * 0.3, -1, fz * 0.3);
      _poleL.set(fx * 0.3 + lx * 0.3, 1, fz * 0.3 + lz * 0.3);
    } else if (lap > cross && lap > belly) {
      bones.hips.getWorldPosition(_a);
      // 手はそろえた腿の付け根の前に置く。短いスカートなので、低い目線からは
      // ここが見えてしまう（実際の人も手で押さえる位置）
      left = at(_a, 0.22, 0.045, -0.01, _seatA);
      right = at(_a, 0.23, -0.045, 0.0, _seatB);
      _poleL.set(lx, -0.8, lz);
      _poleR.set(-lx, -0.8, -lz);
    } else if (belly > cross) {
      // 下腹の上で手を重ねる（スカートの前を押さえる位置）
      bones.hips.getWorldPosition(_a);
      left = at(_a, 0.24, 0.035, 0.0, _seatA);
      right = at(_a, 0.25, -0.035, 0.02, _seatB);
      _poleL.set(lx, -0.8, lz);
      _poleR.set(-lx, -0.8, -lz);
    } else {
      // 腕を組む。左手は右の二の腕へ、右手は左の二の腕へ。前後に少しずらして重ねる
      (bones.upperChest ?? bones.chest).getWorldPosition(_a);
      left = at(_a, 0.15, -0.10, -0.08, _seatA);
      right = at(_a, 0.19, 0.10, -0.06, _seatB);
      _poleL.set(lx + fx * 0.25, -0.5, lz + fz * 0.25);
      _poleR.set(-lx + fx * 0.25, -0.5, -lz + fz * 0.25);
    }
    solveArm('left', left, w, _poleL.normalize());
    solveArm('right', right, w, _poleR.normalize());
    palmCenter(catchPoint);
    return true;
  }

  function applyArms(dt) {
    if (applySeatedArms()) return;
    if (armFollow) {
      // 下ろしている途中の目標点は体といっしょに動かす
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      armTarget.set(
        group.position.x + armLocal.x * c + armLocal.z * sn,
        group.position.y + armLocal.y,
        group.position.z - armLocal.x * sn + armLocal.z * c,
      );
    }
    if (hands.active) {
      group.updateMatrixWorld(true);
      for (const side of ['left', 'right']) {
        const hand = hands[side];
        if (hand.amount > 0.001) solveArm(side, hand.target, hand.amount, hand.pole);
      }
      palmCenter(catchPoint);
      return;
    }
    armAmount += (armWant - armAmount) * Math.min(1, dt * 7);
    if (armAmount < 0.002 || !bones.leftHand || !bones.rightHand) {
      armAmount = Math.max(0, armAmount);
      // 手の位置が要るのはキャッチボール中だけ。部屋を歩いているあいだは、
      // 行列の更新ぶん（VR では毎フレーム効く）を省く
      if (bones.leftHand && driver) {
        group.updateMatrixWorld(true);
        palmCenter(catchPoint);
      }
      return;
    }
    group.updateMatrixWorld(true);

    // 左右の手のひらをボールの両脇に置く。体の左右方向に開く
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    _c.set(armTarget.x + lx * armSpread, armTarget.y, armTarget.z + lz * armSpread);
    solveArm('left', _c, armAmount);
    _c.set(armTarget.x - lx * armSpread, armTarget.y, armTarget.z - lz * armSpread);
    solveArm('right', _c, armAmount);

    palmCenter(catchPoint);
  }

  /** 部屋の経路で、いまの場所からいちばん近い節点 */
  function nearestNode() {
    let best = 0;
    let bestDistance = Infinity;
    ROUTE.forEach((node, i) => {
      const d = Math.hypot(node.x - group.position.x, node.y - group.position.z);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    return best;
  }

  /**
   * 外から動かすための窓口。キャッチボールはこれ越しに体を動かす。
   * うろうろの状態機械は driver が入っているあいだ止まる。
   */
  const body = {
    get loaded() { return Boolean(vrm); },
    get position() { return group.position; },
    get yaw() { return yaw; },
    /** 頭のボーンの高さ（身長の目安） */
    get headHeight() { return headRestY; },
    /** 腕の長さ（肩から手首） */
    get armLength() {
      return (bones.leftLowerArm?.position.length() ?? 0.22) + (bones.leftHand?.position.length() ?? 0.2);
    },
    /** 部屋の状態機械から引き取れるか（座っていない） */
    get free() { return state === 'idle' || state === 'walk'; },
    get sitting() { return ['sit', 'sitDown', 'turn', 'standUp', 'lieDown', 'nap', 'getUp'].includes(state); },
    get catchPoint() { return catchPoint; },
    /** 座っていたら（眠っていたら）早めに立たせる */
    requestStand() { if (state === 'sit' || state === 'nap') stateUntil = Math.min(stateUntil, clock); },
    /** 体を任せる。null で部屋のうろうろに戻す（node はそこから歩き出す節点） */
    drive(next, node = null) {
      driver = next;
      if (!next) {
        crouchWant = 0; bendWant = 0; armWant = 0;
        attend = false; handOpenWant = 0;
        nodeIndex = node ?? nearestNode();
        queue.length = 0;
        goal = { point: ROUTE[nodeIndex] };
        state = 'walk';
      }
    },
    get driven() { return driver !== null; },
    stepTowards(point, dt, speed) { return stepTowards(point, dt, speed); },
    /**
     * 体の向き（faceYaw）を保ったまま point へ寄る。後ろへ下がるときは位相を
     * 逆に回すので、足は後ろ向きに運ばれる（座るときの下がり方と同じ）。
     * 短い距離の位置直し用。着いたら true
     */
    stepFacing(point, dt, speed, faceYaw) {
      turnTowards(faceYaw, dt);
      const dx = point.x - group.position.x;
      const dz = point.y - group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.03) { advanceGait(0, dt, 0); return true; }
      const moved = Math.min(speed * dt, d);
      group.position.x += (dx / d) * moved;
      group.position.z += (dz / d) * moved;
      const along = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
      advanceGait(along >= 0 ? moved : -moved, dt, 1);
      return d - moved < 0.03;
    },
    turnTowards(angle, dt) {
      const turned = turnTowards(angle, dt);
      advanceGait(Math.abs(turned) * 0.2, dt, Math.abs(turned) > 1e-3 ? 0.5 : 0);
      return Math.abs(angleDelta(angle, yaw)) < 0.06;
    },
    /** その場で立ち止まる（歩きの度合いを 0 へ戻す） */
    stand(dt) { advanceGait(0, dt, 0); },
    setCrouch(value) { crouchWant = clamp01(value); },
    setBend(value) { bendWant = clamp01(value); },
    /** 両手を point へ伸ばす。null なら腕を下ろす */
    reach(point, amount = 1, spread = 0.08) {
      if (!point) {
        if (!armFollow) {
          // 体の向きで回して、体から見た位置にする
          const dx = armTarget.x - group.position.x;
          const dz = armTarget.z - group.position.z;
          const c = Math.cos(yaw);
          const sn = Math.sin(yaw);
          armLocal.set(dx * c - dz * sn, armTarget.y - group.position.y, dx * sn + dz * c);
          armFollow = true;
        }
        armWant = 0;
        return;
      }
      armFollow = false;
      armTarget.copy(point);
      armWant = clamp01(amount);
      armSpread = spread;
    },
    set onPosed(fn) { onPosed = fn; },
    /** 止まっているボールでも見続ける（拾いにいくとき） */
    setFocus(value) { focus = Boolean(value); },
    /** ボールを見ていないときは、相手（camera）の顔を見る */
    setAttend(value) { attend = Boolean(value); },
    /** にっこり笑う（seconds 秒、strength 0..1） */
    smile(seconds = 2, strength = 1, kind = null) {
      // 前回と違う笑い方を選ぶ（kind を渡せばそれ）
      let name = kind;
      if (!name) {
        const choices = REACTION_NAMES.filter((n) => n !== lastReaction);
        name = choices[Math.floor(Math.random() * choices.length)];
      }
      lastReaction = name;
      reaction = { recipe: REACTIONS[name], start: elapsed, until: elapsed + seconds, strength, name };
    },
    /** 口の形を入れる（{ aa, ih, ou, ee, oh }、0..1）。null で閉じる */
    setMouth(shape) {
      for (const name of MOUTH_SHAPES) mouthWant[name] = shape?.[name] ?? 0;
    },
    /** 検証用：いまの口の開き（いちばん大きい形の値） */
    get mouthOpen() { return Math.max(...MOUTH_SHAPES.map((n) => mouthNow[n])); },
    /** 検証用：いまのリアクションの名前 */
    get reactionName() { return reaction && elapsed < reaction.until ? reaction.name : null; },
    /** 指を開く度合い（0 = 軽く握る、1 = 開く） */
    setHandOpen(value) { handOpenWant = clamp01(value); },
    /** 投球の体幹・脚の姿勢。null で解除 */
    setThrowPose(pose) { throwPose = pose; },
    /**
     * 左右の手を別々の点へ伸ばす（投球用）。null を渡すと両手で 1 点へ伸ばす
     * ふだんの reach に戻る。pole は肘を逃がす向き（ワールド）
     */
    reachHands(spec) {
      if (!spec) {
        // 抜けた瞬間は、いま手のある所（両手のあいだ）から両手の IK を続ける。
        // 投げる前の古い目標と効き具合が戻ってくると、腕が一瞬でどこかへ飛ぶ
        if (hands.active) { armTarget.copy(catchPoint); armAmount = 1; armWant = 1; armFollow = false; }
        hands.active = false;
        return;
      }
      hands.active = true;
      for (const side of ['left', 'right']) {
        const src = spec[side];
        hands[side].amount = src ? clamp01(src.amount ?? 1) : 0;
        if (src?.target) hands[side].target.copy(src.target);
        hands[side].pole = src?.pole ?? null;
      }
    },
    /** 片手の手のひらの中心（ワールド） */
    palm(side, out = new THREE.Vector3()) { return palmOf(side, out); },
    /** 体の向きを直接決める（投球中に体の正面を相手へ固定する） */
    setYaw(value) { yaw = value; group.rotation.y = yaw; },
    /** 部屋から掃き出し窓までの道順（経路の節点をたどってソファの前から出る） */
    exitRoute() {
      const size = ROUTE.length;
      const from = nearestNode();
      const forward = (EXIT_NODE - from + size) % size;
      const backward = (from - EXIT_NODE + size) % size;
      const step = forward <= backward ? 1 : -1;
      const points = [ROUTE[from].clone()];
      for (let i = from; i !== EXIT_NODE;) {
        i = (i + step + size) % size;
        points.push(ROUTE[i].clone());
      }
      return points.concat(EXIT_PATH.map((p) => p.clone()));
    },
    /** 掃き出し窓から部屋へ戻る道順（exitRoute の窓より先を逆にたどる） */
    entryRoute() {
      return [...EXIT_PATH].reverse().map((p) => p.clone()).concat([ROUTE[EXIT_NODE].clone()]);
    },
    exitNode: () => EXIT_NODE,
  };

  function update(dt) {
    if (!vrm) return;
    if (driver) clock += dt;
    else if (wander) updateBehavior(dt);
    applyPose();
    applyGait();
    applyIdle(dt);
    applyGaze(dt);
    applyCrouch(dt);
    applyThrow();
    applyArms(dt);
    applyFingers(dt);
    onPosed?.();
    updateFootShadows();
    // スプリングボーン（髪・服）、視線、表情をまとめて進める
    vrm.update(dt);

    // 座っているあいだはスカートの揺れを毎フレーム初期状態へ戻す。
    //
    // 腿をほぼ水平まで上げると、スプリングボーンだけでは裾が腿に乗り上げて
    // めくれ上がってしまう（スカートのコライダーは立ち姿勢を前提に作られて
    // いることがほとんど）。揺れを止めると、モデルが作られたときの「垂れた」
    // 形に落ち着く。腿にわずかに食い込むが、めくれるよりはずっとよい。
    if (sitAmount > 0.5 || settleSprings > 0) {
      if (settleSprings > 0) settleSprings--;
      vrm.springBoneManager?.reset?.();
    }
  }

  return {
    group,
    ready,
    update,
    /** 投げられたら目で追う対象（野球ボールなど）を登録する */
    watch(object) { watched = object; },
    get vrm() { return vrm; },
    /** ライセンス表記用。読み込み前は null */
    get meta() { return vrm?.meta ?? null; },
    /** キャッチボールなど、外から体を動かすための窓口 */
    body,
    /**
     * 検証用。指定の座り方でソファに座らせたまま止める（状態機械は動かさない）。
     * style: 'upright' | 'lounge' | 'nap'、arms / legs: 腕組み・足組み（0..1）
     */
    /** 検証用。いまいる所から、指定の座り方で座りにいかせる（状態機械はそのまま動く） */
    debugPlanSit(style = 'upright') {
      const seat = style === 'nap' ? napSeat() : SEATS[0];
      queue.length = 0;
      planSit(seat, style);
    },
    debugSeat({ style = 'upright', seat = 0, arms = 0, legs = 0 } = {}) {
      const base = style === 'nap' ? napSeat() : SEATS[seat];
      seated = { ...base, style };
      sitAmount = 1;
      lounge = style === 'lounge' ? 1 : 0;
      napAmount = style === 'nap' ? 1 : 0;
      armCross = armCrossWant = arms;
      legCross = legCrossWant = legs;
      yaw = seated.yaw;
      group.rotation.y = yaw;
      const p = style === 'nap' ? napPoint() : seatPoint(style);
      group.position.set(p.x, style === 'nap' ? napRootY() : sitRootY(style), p.y);
      seatRoot.copy(group.position);
      gait = 0;
      state = style === 'nap' ? 'nap' : 'sit';
      stateUntil = Infinity;
      settleSprings = 2;
    },
    /** デバッグ用 */
    get state() { return driver ? `driven:${driver.state ?? ''}` : state; },
    route: ROUTE,
    seats: SEATS,
  };
}
