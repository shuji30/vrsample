import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VERSION } from './version.js';

/**
 * 車の見た目を、配布されている 3D モデル（GLB）と入れ替える。gt3.js の createGT3Model がコードで組んだ模型を作り、
 * ここで GLB を読めたら中身を差し替える（運転・乗り降り・女の子の席・ミラー・メーターは GT3 と同じ作りのまま）。
 * 読めないときは、コードで組んだ模型のまま走れる。
 *
 * GLB は元のデータを Blender で軽くしたもの（ポリゴンを減らし、テクスチャを 512〜1024 の WebP に）。中は
 * Body（車体・室内）、Wheel_LF/RF/LR/RR（回る車輪。原点が車輪の中心）、Caliper_LF/RF/LR/RR（あれば。ブレーキ。
 * 前は車輪と一緒に切れる）、Steer（ハンドル。原点が輪の中心、extras の axis が回る軸）。
 * 向きはゲームと同じ（+Z が前・+X が左・左ハンドル）、原点は車の真ん中の地面。
 *
 * - gt3：Porsche GT3 RS（models/gt3.glb。元は models/porsche_gt3_rs.glb。
 *   "Porsche GT3 RS" by Black Snow https://sketchfab.com/3d-models/porsche-gt3-rs-e738eae819c34d19a31dd066c45e0f3d CC-BY-4.0）。
 *   プレイヤーの車（青）と女の子の車（ピンク）で、塗装の色だけを変える
 * - lexus：Lexus LC500 WALD スポーツライン（models/lexus.glb。元は models/lexus-lc-500-wald-sports-line-wwwvecarzcom.zip）。白のまま
 */
export const CAR_MODELS = {
  gt3: {
    url: './models/gt3.glb',
    shiftZ: 0,
    /** 塗装の材質（color で色を変える） */
    paint: (name) => name.startsWith('TwiXeR_992_carPaint'),
    head: (name) => name.startsWith('CarHead_'),
    tail: (name) => name.startsWith('CarTail_'),
    /**
     * ガラス（窓・ライトのカバー・黒いガラス）。GLB では金属度が書かれておらず（glTF の決まりで 1 ＝ 金属）粗さ 0 なので、
     * 鏡になって写り込み（環境マップ）をくっきり映し、家の中から見ると部屋の中が、どこでも丘の上の景色が窓に映った。
     * 金属でないガラス（正面からはほとんど映らず、斜めから見たときだけ空が映る）にする
     */
    glass: (name) => /glass/i.test(name),
    /** ルームミラー（GLB のミラーの、運転席側の面に重ねる） */
    mirror: { x: 0.004, y: 1.178, z: 0.175, w: 0.22, h: 0.05 },
    /** メーター（gt3.js が描く速さ・ギア）。この車のメーターの真ん中に、運転席の目のほうへ向けて */
    dash: { at: [0.346, 0.885, 0.355], w: 0.13, h: 0.065 },
    /**
     * GPS（コースの地図）とラップタイマー。コードの模型ではダッシュボードの上だったが、この車のダッシュボード（上面 0.94）に
     * 埋もれ、上に載せると前の道を隠すので、ダッシュボードの正面（真ん中の画面のあたり）に
     */
    units: { gps: [-0.24, 0.885, 0.31], timer: [-0.01, 0.875, 0.31] },
  },
  lexus: {
    url: './models/lexus.glb',
    /** 運転席の目（gt3.js の SEAT。ローカル z -0.35・高さ 1.12）が、この車の運転席の上に来るように前後へずらす */
    shiftZ: -0.1,
    paint: null,
    head: (name) => name.startsWith('LexusHead'),
    tail: (name) => name.startsWith('LexusTail') || ['taillight', 'light_glass_red', 'GlassRed'].includes(name),
    mirror: { x: 0.022, y: 1.128, z: 0.09, w: 0.22, h: 0.048 },
    dash: { at: [0.377, 0.99, 0.49], w: 0.16, h: 0.08 },
  },
};

const WHEELS = ['LF', 'RF', 'LR', 'RR'];   // createGT3Model の wheels の並び（+X が左）
const loads = new Map();
/** 同じ GLB は 1 回だけ読む（GT3 はプレイヤーと女の子の 2 台） */
function load(url) {
  if (!loads.has(url)) loads.set(url, new GLTFLoader().loadAsync(`${url}?v=${encodeURIComponent(VERSION)}`));
  return loads.get(url);
}

/**
 * @param {ReturnType<import('./gt3.js').createGT3Model>} model
 * @param {keyof typeof CAR_MODELS} style
 * @param {{ eyeAt: THREE.Vector3, shell: THREE.Object3D[], color?: number }} options
 *   eyeAt：運転席の目（車のローカル）、shell：コードで組んだ車体（読めたら隠す）、color：塗装の色
 */
export async function attachCarModel(model, style, { eyeAt, shell, color = null }) {
  const spec = CAR_MODELS[style];
  const gltf = await load(spec.url);
  // 2 台目からは写しを使う（形・テクスチャは共有。色を変える塗装・光らせるライトの材質は車ごとに写す）
  const src = gltf.scene.clone(true);
  const part = (name, need = true) => {
    const o = src.getObjectByName(name);
    if (!o && need) throw new Error(`${spec.url} に ${name} がありません`);
    return o;
  };
  const body = part('Body');
  const steer = part('Steer');
  const wheels = WHEELS.map((k) => part(`Wheel_${k}`));
  const calipers = WHEELS.map((k) => part(`Caliper_${k}`, false));
  const axis = steer.userData.axis;
  if (!Array.isArray(axis)) throw new Error(`${spec.url} の Steer に axis がありません`);

  const own = new Map();
  const mine = (m) => {
    if (!own.has(m)) own.set(m, m.clone());
    return own.get(m);
  };
  const headIntensity = model.headMat.emissiveIntensity;
  const tailIntensity = model.tailMat.emissiveIntensity;
  src.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    if (!m) return;
    if (spec.paint?.(m.name) && color !== null) {
      o.material = mine(m);
      o.material.color.set(color);
    } else if (spec.head(m.name) && m.emissive) {
      o.material = mine(m);
      o.material.emissive.set(0xfff0c0);
      o.material.emissiveIntensity = headIntensity;
      if (!model.headMats.includes(o.material)) model.headMats.push(o.material);
    } else if (spec.tail(m.name) && m.emissive) {
      o.material = mine(m);
      o.material.emissive.set(0xff2010);
      o.material.emissiveIntensity = tailIntensity;
      if (!model.tailMats.includes(o.material)) model.tailMats.push(o.material);
    }
    if (spec.glass?.(m.name) && o.material.metalness > 0) {
      o.material = mine(m);   // ライトのカバーは上で写した材質（mine は同じ写しを返す）
      o.material.metalness = 0;
      o.material.roughness = Math.max(o.material.roughness, 0.05);
    }
  });

  // コードで組んだ模型を隠す（ハンドルの輪とハブ・ミラーの枠も）
  for (const o of shell) o.visible = false;
  for (const o of model.steering.children) if (o !== model.dash) o.visible = false;
  model.mirrorFrame.visible = false;

  // 車体（揺れる body の下へ）
  body.position.z += spec.shiftZ;
  model.body.add(body);

  // 車輪：車輪の中心へ動かし、回るのは spin、前の車輪の切れ角は hold
  model.wheels.forEach((w, i) => {
    for (const o of w.spin.children) o.visible = false;
    const c = wheels[i].position;
    w.hold.position.set(c.x, c.y, c.z + spec.shiftZ);
    wheels[i].position.set(0, 0, 0);
    w.spin.add(wheels[i]);
    if (calipers[i]) {
      calipers[i].position.set(0, 0, 0);
      w.hold.add(calipers[i]);
    }
  });

  // ハンドル：model.steering を、この車のハンドルの中心へ。ローカル +Z を回る軸（運転席の胸のほう）に合わせる
  // （gt3.js の update は rotation.z だけを書き換えるので、x・y で軸を決める）
  const s = model.steering;
  s.position.set(steer.position.x, steer.position.y, steer.position.z + spec.shiftZ);
  s.rotation.set(Math.atan2(axis[1], -axis[2]), Math.PI, 0);
  steer.position.set(0, 0, 0);
  steer.quaternion.copy(s.quaternion).invert();
  s.add(steer);

  // メーター：ハンドルの真ん中ではなく、この車のメーターの所に（ハンドルと一緒には回らない）
  const dash = model.dash;
  dash.geometry.dispose();
  dash.geometry = new THREE.PlaneGeometry(spec.dash.w, spec.dash.h);
  const at = new THREE.Vector3(...spec.dash.at);
  at.z += spec.shiftZ;
  model.body.add(dash);
  // 面（ローカル +Z）を目のほうへ。車はもう置き場所へ動いているので、ワールドの lookAt ではなく車のローカルで決める
  const faceEye = (o, p) => {
    o.position.copy(p);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eyeAt, p, new THREE.Vector3(0, 1, 0)));
  };
  faceEye(dash, at);
  if (spec.units) {
    faceEye(model.gps, new THREE.Vector3(...spec.units.gps));
    faceEye(model.lapTimer, new THREE.Vector3(...spec.units.timer));
  }
}
