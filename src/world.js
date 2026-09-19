import * as THREE from 'three';
import { THEMES, DEFAULT_THEME } from './themes.js';

const GRAVITY = -9.8;
const RESTITUTION = 0.42; // 床で跳ね返るときの反発係数
const FLOOR_RADIUS = 40;   // 地平線が霧に溶けるよう広めにとる
const PLAY_RADIUS = 12;    // グリッドを敷く遊び場の広さ

/** 中央のテーブル。床とあわせて「着地できる面」として扱う。 */
const TABLE = { center: { x: 0, y: -2.2 }, radius: 0.9, top: 0.75 };

/**
 * グラデーション空。巨大な球を裏面表示して、頂点の高さで色を混ぜる。
 */
function createSky() {
  const uniforms = {
    topColor: { value: new THREE.Color() },
    bottomColor: { value: new THREE.Color() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = clamp(normalize(vWorldPosition).y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.7)), 1.0);
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), material);
  sky.name = 'sky';
  return { sky, uniforms };
}

/**
 * 日本語テキストを canvas に描いてテクスチャにする。
 */
function createTextTexture(lines, { width = 1024, height = 512 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(8, 12, 26, 0.92)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  ctx.textBaseline = 'top';
  let y = 48;
  for (const line of lines) {
    const heading = line.startsWith('#');
    const text = heading ? line.slice(1).trim() : line;
    ctx.font = heading
      ? 'bold 52px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif'
      : '34px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = heading ? '#8ef0ff' : '#e8ecf8';
    ctx.fillText(text, 48, y);
    y += heading ? 78 : 50;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * ワールド（床・空・光・オブジェクト類）を組み立てる。
 * @param {THREE.Scene} scene
 */
export function createWorld(scene) {
  const grabbables = [];
  const buttons = [];

  // --- 空 ---------------------------------------------------------------
  const { sky, uniforms: skyUniforms } = createSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(0x000000, 14, 52);

  // --- ライト -----------------------------------------------------------
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.position.set(6, 12, 4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.top = 14;
  sunLight.shadow.camera.bottom = -14;
  sunLight.shadow.camera.left = -14;
  sunLight.shadow.camera.right = 14;
  sunLight.shadow.camera.far = 40;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  // --- 床 ---------------------------------------------------------------
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f7f92,
    roughness: 0.85,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);

  const grid = new THREE.GridHelper(PLAY_RADIUS * 2, 24, 0xffffff, 0xffffff);
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  grid.position.y = 0.002;
  scene.add(grid);

  // --- 中央のテーブルと回転するオブジェ -----------------------------------
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x3b455f, roughness: 0.55, metalness: 0.15 });

  const tableTop = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE.radius, TABLE.radius, 0.06, 48),
    tableMaterial,
  );
  tableTop.position.set(TABLE.center.x, TABLE.top - 0.03, TABLE.center.y);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  scene.add(tableTop);

  const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, TABLE.top - 0.06, 24), tableMaterial);
  tableLeg.position.set(TABLE.center.x, (TABLE.top - 0.06) / 2, TABLE.center.y);
  tableLeg.castShadow = true;
  tableLeg.receiveShadow = true;
  scene.add(tableLeg);

  const knotMaterial = new THREE.MeshStandardMaterial({
    color: 0x223052,
    roughness: 0.18,
    metalness: 0.85,
    emissive: new THREE.Color(0x36d1c4),
    emissiveIntensity: 0.25,
  });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.26, 0.085, 200, 32), knotMaterial);

  // ノット自身を光源にして、夜でも周囲がほんのり照らされるようにする
  const knotLight = new THREE.PointLight(0x36d1c4, 2.2, 5, 2);
  knot.add(knotLight);
  knot.position.set(TABLE.center.x, TABLE.top + 0.55, TABLE.center.y);
  knot.castShadow = true;
  scene.add(knot);

  // --- つかめるキューブ -------------------------------------------------
  const cubeColors = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb892ff, 0xff9ecd];
  const cubeGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);

  cubeColors.forEach((color, i) => {
    const mesh = new THREE.Mesh(
      cubeGeometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 }),
    );
    const angle = (i / cubeColors.length) * Math.PI * 2;
    const home = new THREE.Vector3(
      TABLE.center.x + Math.cos(angle) * 0.62,
      TABLE.top + 0.09,
      TABLE.center.y + Math.sin(angle) * 0.62,
    );
    mesh.position.copy(home);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      grabbable: true,
      home,
      halfSize: 0.09,
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      held: false,
      baseColor: new THREE.Color(color),
    };
    scene.add(mesh);
    grabbables.push(mesh);
  });

  // --- 遠景の柱 ---------------------------------------------------------
  // VR では動いていることが分かる目印がないと距離感がつかみにくいので、
  // 外周にシンプルな柱を並べておく。
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9, metalness: 0.0 });
  const pillarGeometry = new THREE.CylinderGeometry(0.28, 0.36, 1, 10);
  const pillarCount = 16;

  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2 + 0.2;
    const radius = 8.5 + ((i * 7) % 5) * 0.8;
    const height = 1.6 + ((i * 3) % 4) * 0.9;
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
    pillar.scale.y = height;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
  }

  // --- 説明パネル -------------------------------------------------------
  const panelTexture = createTextTexture([
    '# WebXR おもちゃ箱',
    'トリガー : つかむ / 離すと投げる',
    '左スティック : 移動',
    '右スティック : スナップターン',
    'ボタンを撃つ : 時間帯を変える',
  ]);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.9),
    new THREE.MeshBasicMaterial({ map: panelTexture, toneMapped: false }),
  );
  panel.position.set(-2.6, 1.6, -2.6);
  panel.rotation.y = Math.PI / 7;
  scene.add(panel);

  // --- テーマ切り替えボタン ---------------------------------------------
  const console3d = new THREE.Group();
  console3d.position.set(2.3, 0.95, -2.4);
  console3d.rotation.y = -Math.PI / 7;
  scene.add(console3d);

  const consoleBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.12, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x323c5c, roughness: 0.55, metalness: 0.15 }),
  );
  consoleBody.castShadow = true;
  console3d.add(consoleBody);

  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 0.9, 16),
    new THREE.MeshStandardMaterial({ color: 0x323c5c, roughness: 0.6, metalness: 0.15 }),
  );
  leg.position.y = -0.51;
  leg.castShadow = true;
  console3d.add(leg);

  const themeKeys = Object.keys(THEMES);
  themeKeys.forEach((key, i) => {
    const theme = THEMES[key];
    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.07, 24),
      new THREE.MeshStandardMaterial({
        color: theme.swatch,
        roughness: 0.3,
        emissive: new THREE.Color(theme.swatch),
        emissiveIntensity: 0.15,
      }),
    );
    button.position.set((i - (themeKeys.length - 1) / 2) * 0.3, 0.08, 0);
    button.castShadow = true;
    button.userData = {
      interactive: true,
      restY: 0.08,
      press: 0,
      onSelect: () => setTheme(key),
    };
    console3d.add(button);
    buttons.push(button);
  });

  // --- テーマ適用 -------------------------------------------------------
  let currentTheme = null;

  function setTheme(key) {
    const theme = THEMES[key] ?? THEMES[DEFAULT_THEME];
    currentTheme = key;

    skyUniforms.topColor.value.setHex(theme.skyTop);
    skyUniforms.bottomColor.value.setHex(theme.skyBottom);
    scene.fog.color.setHex(theme.fog);
    floorMaterial.color.setHex(theme.ground);
    grid.material.color.setHex(theme.grid);
    hemiLight.color.setHex(theme.hemiSky);
    hemiLight.groundColor.setHex(theme.hemiGround);
    sunLight.color.setHex(theme.sun);
    sunLight.intensity = theme.sunIntensity;
    knotMaterial.emissive.setHex(theme.accent);
    knotLight.color.setHex(theme.accent);
    pillarMaterial.color.setHex(theme.pillar);
  }

  setTheme(DEFAULT_THEME);

  // --- 毎フレームの更新 -------------------------------------------------
  const tmp = new THREE.Vector3();

  function update(dt, elapsed) {
    knot.rotation.x = elapsed * 0.6;
    knot.rotation.y = elapsed * 0.9;
    knot.position.y = TABLE.top + 0.55 + Math.sin(elapsed * 1.4) * 0.05;
    knotMaterial.emissiveIntensity = 0.28 + Math.sin(elapsed * 2.2) * 0.08;

    // ボタンの押し込みアニメーション
    for (const button of buttons) {
      button.userData.press = Math.max(0, button.userData.press - dt * 4);
      button.position.y = button.userData.restY - button.userData.press * 0.035;
      button.material.emissiveIntensity = 0.15 + button.userData.press * 0.85;
    }

    // つかまれていないキューブに簡易物理を適用
    for (const cube of grabbables) {
      const data = cube.userData;
      if (data.held) continue;

      const prevY = cube.position.y;
      data.velocity.y += GRAVITY * dt;
      cube.position.addScaledVector(data.velocity, dt);

      if (data.spin.lengthSq() > 1e-6) {
        cube.rotation.x += data.spin.x * dt;
        cube.rotation.y += data.spin.y * dt;
        cube.rotation.z += data.spin.z * dt;
        data.spin.multiplyScalar(Math.max(0, 1 - dt * 0.8));
      }

      // 着地面の高さを決める（テーブルの真上にいればテーブル、それ以外は床）
      const dx = cube.position.x - TABLE.center.x;
      const dz = cube.position.z - TABLE.center.y;
      const onTable =
        Math.hypot(dx, dz) < TABLE.radius && prevY >= TABLE.top + data.halfSize - 1e-3;
      const surfaceY = onTable ? TABLE.top : 0;

      if (cube.position.y < surfaceY + data.halfSize) {
        cube.position.y = surfaceY + data.halfSize;
        if (data.velocity.y < 0) {
          data.velocity.y = -data.velocity.y * RESTITUTION;
          if (Math.abs(data.velocity.y) < 0.35) data.velocity.y = 0;
          data.velocity.x *= 0.75;
          data.velocity.z *= 0.75;
          data.spin.multiplyScalar(0.6);
        }
      }

      // 床から落ちた / 遠くへ行きすぎたら元の位置に戻す
      tmp.set(cube.position.x, 0, cube.position.z);
      if (cube.position.y < -6 || tmp.length() > PLAY_RADIUS + 8) {
        cube.position.copy(data.home);
        cube.rotation.set(0, 0, 0);
        data.velocity.set(0, 0, 0);
        data.spin.set(0, 0, 0);
      }
    }
  }

  return {
    grabbables,
    interactables: [...grabbables, ...buttons],
    floor,
    update,
    setTheme,
    getTheme: () => currentTheme,
  };
}
