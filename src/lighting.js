import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ROOM } from './room.js';
import { THEMES, DEFAULT_THEME } from './themes.js';

/**
 * ライティングと環境マップ。写実性のほとんどはここで決まる。
 *
 * 組み合わせは 4 つ。
 *
 * 1. 太陽（DirectionalLight）… 影を落とす唯一の外光。窓から斜めに差し込んで
 *    床に光の帯を作る。室内の写実はこの「光の帯」が出るかどうかが大きい。
 * 2. 窓の面光源（RectAreaLight）… 窓から見える空そのもの。点光源や平行光では
 *    出せない、窓際だけ柔らかく明るい減衰を作る。影は落とせない。
 * 3. 室内灯（PointLight）… 夜のための主光源。
 * 4. 環境マップ（PMREM）… 部屋自体をキューブマップに焼いて scene.environment に
 *    戻す。壁の照り返しが金属やクリアコートに映り込むようになり、間接光を
 *    ベイクしたのに近い効果が、アセットなしで得られる。
 *
 * 環境マップは 2 枚。室内用（部屋の中から焼く）と屋外用（庭の上から、家を隠して空・丘・海・遠景を焼く）。
 * 前は室内用の 1 枚を外の物にもかけていたので、夜の庭が室内灯の色で照らされ、海や金属が部屋の中を映していた。
 * プレイヤーが家の外にいるあいだは屋外用、中にいるあいだは室内用を scene.environment にする（setInside）。
 * 海のように、いつも空を映すべき物は、屋外用を素材に直接持たせる（outdoorMaterials）。
 * 屋外用を焼くあいだは、家を隠し（outdoorHide）、海などを NaN の出ない簡単な素材に替える（outdoorSwap）。
 * 2 枚の大きさは揃える（PMREM の大きさが変わるとシェーダーを作り直し、入れ替えのたびにカクつく）。
 */

const ENV_SIZE = 256;
// 環境マップを撮る位置。人が立つあたりの目の高さ
const ENV_PROBE = new THREE.Vector3(0, 1.5, -1.0);
// 屋外用を撮る位置：庭の上、テニスコートの手前（家・丘・海のどれからも近すぎない）
const OUTDOOR_PROBE = new THREE.Vector3(0, 6, -18);

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} options
 * @param {import('./room.js').createRoom extends never ? never : any[]} options.windows 窓の開口
 * @param {any[]} options.lampSockets 室内灯の位置
 * @param {object} options.skyUniforms 天球シェーダーの uniforms
 * @param {number} [options.shadowMapSize]
 */
export function createLighting(renderer, scene, {
  windows, lampSockets, skyUniforms, shadowMapSize = 4096, environment = true,
  outdoorHide = () => [], outdoorSwap = [], outdoorMaterials = [],
}) {
  RectAreaLightUniformsLib.init();

  // --- 太陽 ---------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);

  // 影のカメラは「部屋 + 窓のすぐ外」だけを覆う。公園の奥まで入れると
  // テクセルが粗くなって室内の影がぼやけるので、ここは欲張らない。
  const half = 11;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0002;
  // normalBias は面に沿って少し押し出す。塗り壁のような平らで大きい面の
  // シャドウアクネに効く（bias だけで消そうとすると影が浮いてしまう）
  sun.shadow.normalBias = 0.022;
  sun.target.position.set(0, 0.9, -3.0);
  scene.add(sun);
  scene.add(sun.target);

  // --- 窓の面光源 ---------------------------------------------------------
  const windowLights = windows.map((spec) => {
    const light = new THREE.RectAreaLight(0xffffff, 1, spec.width * 0.95, spec.height * 0.95);
    // 開口のわずかに内側に置く。壁と同一面だと自分の壁を照らしてしまう
    light.position.copy(spec.center).addScaledVector(spec.normal, 0.02);
    light.lookAt(
      spec.center.x + spec.normal.x * 2,
      spec.center.y - 0.35,
      spec.center.z + spec.normal.z * 2,
    );
    scene.add(light);
    return light;
  });

  // --- 環境光（薄く敷くだけ。主役は環境マップ） ---------------------------
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
  hemisphere.position.set(0, ROOM.height, 0);
  scene.add(hemisphere);

  // --- 室内灯 -------------------------------------------------------------
  // distance は付けない。three.js の distance は「そこで 0 になる」窓関数なので、
  // 部屋より短く取ると壁の途中に光の切れ目がはっきり出てしまう。
  // 物理的に正しい逆二乗（decay = 2）だけに任せる。
  const lamps = lampSockets.map((socket) => {
    if (socket.type === 'spot') {
      const light = new THREE.SpotLight(0xffd9a8, 0, 0, socket.angle, socket.penumbra, 2);
      light.position.copy(socket.position);
      light.target.position.copy(socket.target);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 8;
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.focus = 1;
      scene.add(light);
      scene.add(light.target);
      return { light, socket };
    }

    const light = new THREE.PointLight(0xffd9a8, 0, 0, 2);
    light.position.copy(socket.position);
    scene.add(light);
    return { light, socket };
  });

  // --- 環境マップ ---------------------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  let envTarget = null;
  let outdoorTarget = null;
  let inside = true;

  /**
   * 部屋と外をキューブマップに焼き直して、環境マップにする。
   * 照明を変えたら呼ぶ。数フレームぶんのコストがかかるので毎フレームは不可。
   */
  function refreshEnvironment() {
    // 切り分け用に丸ごと飛ばせるようにしておく（?safe）。
    // ここはキューブマップを 6 面ぶん描くので、環境によっては最初に疑う場所。
    if (!environment) return;
    const previous = envTarget;
    const previousOut = outdoorTarget;
    // 室内用：前の室内用を当てたまま焼く（2 回まわすと 1 バウンスぶん間接光が乗る）。天球まで入るように far を大きく取る
    scene.environment = envTarget?.texture ?? null;
    envTarget = pmrem.fromScene(scene, 0, 0.1, 1000, { size: ENV_SIZE, position: ENV_PROBE });
    // 屋外用：家（壁・屋根・ビリヤードの部屋）を隠して、空・丘・海・遠景だけを撮る
    // 落とし穴：前の屋外用を当てて焼くと、一度 NaN が入ったら消えなくなる（海が映して次の屋外用へ持ち越す）。
    // 屋外用は環境マップなしで焼く（空の明るさと直接の光だけ。外の物の照り返しは小さいので見た目は変わらない）
    const hidden = outdoorHide().filter((o) => o && o.visible);
    for (const o of hidden) o.visible = false;
    // 焼くあいだだけ素材を替える物（海：遠くの海面を光の計算つきで描くと、ところどころ NaN の画素が出て、
    // PMREM のぼかしで環境マップ全体に広がる。光を使わない素材にし、色はテーマから決める（tint）
    const swapped = outdoorSwap.map(([o]) => [o, o.material]);
    for (const [o, m, tint] of outdoorSwap) { if (tint) tint(m, THEMES[currentTheme ?? DEFAULT_THEME]); o.material = m; }
    scene.environment = null;
    try {
      outdoorTarget = pmrem.fromScene(scene, 0, 0.1, 3000, { size: ENV_SIZE, position: OUTDOOR_PROBE });
    } finally {
      for (const o of hidden) o.visible = true;
      for (const [o, m] of swapped) o.material = m;
    }
    for (const m of outdoorMaterials) { m.envMap = outdoorTarget.texture; m.needsUpdate = true; }
    scene.environment = (inside ? envTarget : outdoorTarget).texture;
    if (previous) previous.dispose();
    if (previousOut) previousOut.dispose();
  }

  /** プレイヤー（カメラ）が家の中にいるか。中なら室内用、外なら屋外用の環境マップにする */
  function setInside(value) {
    if (value === inside) return;
    inside = value;
    if (envTarget && outdoorTarget) scene.environment = (inside ? envTarget : outdoorTarget).texture;
  }

  // --- テーマ適用 ---------------------------------------------------------
  let currentTheme = null;
  const sunDirection = new THREE.Vector3();

  function setTheme(key, { refresh = true } = {}) {
    const theme = THEMES[key] ?? THEMES[DEFAULT_THEME];
    currentTheme = THEMES[key] ? key : DEFAULT_THEME;

    sunDirection.fromArray(theme.sunDirection).normalize();
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 30);
    sun.color.setHex(theme.sunColor);
    sun.intensity = theme.sunIntensity;

    for (const light of windowLights) {
      light.color.setHex(theme.windowColor);
      light.intensity = theme.windowIntensity;
    }

    hemisphere.color.setHex(theme.ambientSky);
    hemisphere.groundColor.setHex(theme.ambientGround);
    hemisphere.intensity = theme.ambientIntensity;

    for (const { light, socket } of lamps) {
      light.color.setHex(theme.lampColor);
      light.intensity = socket.intensity * theme.lampIntensity;
      // 消えているライトのシャドウマップを毎フレーム焼いても意味がない
      light.visible = light.intensity > 0.01;
      if (socket.material) {
        socket.material.emissive.setHex(theme.lampColor);
        socket.material.emissiveIntensity = theme.lampIntensity * 1.6;
      }
    }

    skyUniforms.topColor.value.setHex(theme.skyTop);
    skyUniforms.bottomColor.value.setHex(theme.skyBottom);
    skyUniforms.horizonColor?.value.setHex(theme.fog);
    // 太陽（夜は月）の円盤・光の輪・地平線の帯・星。円盤は照明の太陽と同じ向き
    const s = theme.sky;
    if (s && skyUniforms.sunDir) {
      skyUniforms.sunDir.value.copy(sunDirection);
      skyUniforms.skyPow.value = s.pow;
      skyUniforms.discColor.value.setHex(s.disc);
      skyUniforms.discRadius.value = s.discRadius;
      skyUniforms.discSoft.value = s.discSoft;
      skyUniforms.discGain.value = s.discGain ?? 1;
      skyUniforms.moon.value = s.moon ? 1 : 0;
      skyUniforms.glowColor.value.setHex(s.glow);
      skyUniforms.glowPow.value = s.glowPow;
      skyUniforms.bandColor.value.setHex(s.band);
      skyUniforms.stars.value = s.stars;
    }

    if (!scene.fog) scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    scene.fog.color.setHex(theme.fog);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;

    renderer.toneMappingExposure = theme.exposure;

    if (refresh) refreshEnvironment();
  }

  function dispose() {
    if (envTarget) envTarget.dispose();
    if (outdoorTarget) outdoorTarget.dispose();
    pmrem.dispose();
  }

  /**
   * 影を落とす範囲の中心を移す。影のカメラは ±11m しか覆わないので、
   * プレイヤーが庭の奥のテニスコートへ出たら、そちらへ寄せる。
   * 動かすのは境目をまたいだときだけ（毎フレーム動かすと影がちらつく）
   */
  const shadowFocus = sun.target.position.clone();
  const baseFocusY = shadowFocus.y;
  /** 影を落とす範囲の真ん中。y は地面の高さ（崖の下の砂浜は -25m。既定は丘の上の 0） */
  function setShadowFocus(x, z, y = baseFocusY) {
    if (Math.hypot(x - shadowFocus.x, z - shadowFocus.z) < 0.01 && Math.abs(y - shadowFocus.y) < 0.01) return;
    const offset = sun.position.clone().sub(sun.target.position);
    shadowFocus.set(x, y, z);
    sun.target.position.copy(shadowFocus);
    sun.position.copy(shadowFocus).add(offset);
    sun.target.updateMatrixWorld();
  }

  return {
    sun,
    windowLights,
    lamps,
    setTheme,
    setShadowFocus,
    refreshEnvironment,
    setInside,
    get inside() { return inside; },
    getTheme: () => currentTheme,
    dispose,
  };
}
