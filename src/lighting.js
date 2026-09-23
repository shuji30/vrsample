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
 */

const ENV_SIZE = 256;
// 環境マップを撮る位置。人が立つあたりの目の高さ
const ENV_PROBE = new THREE.Vector3(0, 1.5, -1.0);

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} options
 * @param {import('./room.js').createRoom extends never ? never : any[]} options.windows 窓の開口
 * @param {any[]} options.lampSockets 室内灯の位置
 * @param {object} options.skyUniforms 天球シェーダーの uniforms
 * @param {number} [options.shadowMapSize]
 */
export function createLighting(renderer, scene, { windows, lampSockets, skyUniforms, shadowMapSize = 4096, environment = true }) {
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

  /**
   * 部屋をキューブマップに焼き直して scene.environment に入れる。
   * 照明を変えたら呼ぶ。数フレームぶんのコストがかかるので毎フレームは不可。
   */
  function refreshEnvironment() {
    // 切り分け用に丸ごと飛ばせるようにしておく（?safe）。
    // ここはキューブマップを 6 面ぶん描くので、環境によっては最初に疑う場所。
    if (!environment) return;
    const previous = envTarget;
    // 天球まで入るように far を大きく取る
    envTarget = pmrem.fromScene(scene, 0, 0.1, 1000, { size: ENV_SIZE, position: ENV_PROBE });
    scene.environment = envTarget.texture;
    if (previous) previous.dispose();
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

    if (!scene.fog) scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    scene.fog.color.setHex(theme.fog);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;

    renderer.toneMappingExposure = theme.exposure;

    if (refresh) refreshEnvironment();
  }

  function dispose() {
    if (envTarget) envTarget.dispose();
    pmrem.dispose();
  }

  return {
    sun,
    windowLights,
    lamps,
    setTheme,
    refreshEnvironment,
    getTheme: () => currentTheme,
    dispose,
  };
}
