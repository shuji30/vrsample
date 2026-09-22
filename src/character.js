import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * 部屋に立っている VRM キャラクター。
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
 * ということになる。前 3 つはプラグインが面倒を見てくれるので、ここでやるのは
 * 「置く場所を決める」「T ポーズをほどく」「呼吸とまばたきで生かす」の 3 つ。
 *
 * モデルは同梱していない（後述のライセンスの都合）。`models/character.vrm` が
 * 無ければ、キャラクターが居ないだけで部屋はそのまま動く。
 */

export const CHARACTER = {
  url: './models/character.vrm',
  // 丸テーブルと椅子を避けた、正面の窓と左の窓のあいだの空き。
  // 既定のカメラ（0.85, 1.62, 1.75）から見て左手前に立つ位置。
  position: new THREE.Vector3(-1.25, 0, -1.05),
  // VRM 1.0 のモデルは +Z を向いている。少しだけテーブル側に体を捻らせる
  yaw: -0.24,
};

/** 腕を下ろす角度（T ポーズからの差分）。肩から先を段階的に曲げると自然に見える */
const RELAXED_POSE = {
  leftUpperArm: [0, 0, -1.18],
  rightUpperArm: [0, 0, 1.18],
  leftLowerArm: [0, -0.22, -0.16],
  rightLowerArm: [0, 0.22, 0.16],
  leftHand: [0, 0, -0.10],
  rightHand: [0, 0, 0.10],
};

/** 指を軽く握らせる。開いたままの手は VR で見ると妙に目につく */
const FINGER_BEND = ['Index', 'Middle', 'Ring', 'Little'].flatMap((finger) =>
  ['Proximal', 'Intermediate', 'Distal'].map((joint) => `${finger}${joint}`),
);

/**
 * VRM を読み込んで部屋に立たせる。読み込みは非同期なので、部屋の生成は
 * 待たせない（キャラクターだけ後から現れる）。
 *
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {string} [options.url] VRM ファイルの URL
 * @param {THREE.Camera} [options.camera] 視線で追わせる相手
 */
export function createCharacter(scene, { url = CHARACTER.url, camera = null } = {}) {
  const group = new THREE.Group();
  group.name = 'character';
  group.position.copy(CHARACTER.position);
  group.rotation.y = CHARACTER.yaw;
  scene.add(group);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let vrm = null;
  let bones = null;
  let hipsRestY = 0;
  let elapsed = 0;
  let blinkAt = 2.5;   // 次にまばたきする時刻
  let blink = 0;       // まばたきの進み（0..1）

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

      bones = poseToRelaxed(vrm.humanoid);
      hipsRestY = bones.hips ? bones.hips.position.y : 0;

      // 視線でこちらを追わせる。XR 中も camera の matrixWorld は
      // WebXRManager が更新してくれるので、これで両対応になる
      if (camera && vrm.lookAt) vrm.lookAt.target = camera;

      group.add(vrm.scene);
      return vrm;
    })
    .catch((error) => {
      // モデルが無いのは「同梱していない」という想定どおりの状態なので、
      // 読み込み失敗で部屋ごと止めたりはしない
      console.warn(`[character] ${url} を読み込めませんでした:`, error.message ?? error);
      return null;
    });

  /**
   * T ポーズをほどく。正規化ボーン（humanoid の normalized rig）に角度を
   * 入れておくと、vrm.update() が実際のボーンに流し込んでくれる。
   */
  function poseToRelaxed(humanoid) {
    if (!humanoid) return null;
    for (const [name, [x, y, z]] of Object.entries(RELAXED_POSE)) {
      humanoid.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
    }
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      for (const joint of FINGER_BEND) {
        humanoid.getNormalizedBoneNode(`${side}${joint}`)?.rotation.set(0, 0, sign * 0.28);
      }
      humanoid.getNormalizedBoneNode(`${side}ThumbProximal`)?.rotation.set(0, sign * -0.3, 0);
    }
    return {
      hips: humanoid.getNormalizedBoneNode('hips'),
      spine: humanoid.getNormalizedBoneNode('spine'),
      chest: humanoid.getNormalizedBoneNode('chest') ?? humanoid.getNormalizedBoneNode('upperChest'),
      neck: humanoid.getNormalizedBoneNode('neck'),
    };
  }

  /**
   * 立ち姿を生かす。棒立ちは 3D だとすぐ人形に見えるので、呼吸（1 分に 15 回
   * くらい）と、それより遅い重心の揺れを別々の周期で重ねる。
   */
  function idle(dt) {
    elapsed += dt;

    const breath = Math.sin(elapsed * 1.6);     // 呼吸
    const sway = Math.sin(elapsed * 0.42);      // 重心の揺れ
    const drift = Math.sin(elapsed * 0.27 + 1.1);

    if (bones.hips) {
      bones.hips.position.y = hipsRestY + breath * 0.006;
      bones.hips.rotation.z = sway * 0.02;
      bones.hips.rotation.y = drift * 0.03;
    }
    if (bones.spine) bones.spine.rotation.x = breath * 0.012;
    if (bones.chest) bones.chest.rotation.x = breath * 0.018;
    if (bones.neck) bones.neck.rotation.z = sway * -0.015;

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

  function update(dt) {
    if (!vrm) return;
    if (bones) idle(dt);
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
  };
}
