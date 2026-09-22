import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM } from './room.js';
import { THEMES } from './themes.js';

/**
 * 室内の家具と小物。
 *
 * 写実で効くのは造形の凝り方よりも「エッジが立っていないこと」。現実の物に
 * 完全な直角はないので、箱はだいたい RoundedBoxGeometry で面取りしてある。
 * ハイライトが一本走るだけで、見え方がまるで変わる。
 */

/** 中央のテーブル。world.js の簡易物理が着地面として参照する。 */
export const TABLE = { center: { x: 0, z: -2.05 }, radius: 0.62, top: 0.745 };

/** つかめる小物。素材の振れ幅があるほど「物がある」感じが出る。 */
const PROPS = [
  { name: '陶器',     color: 0xf0ece4, roughness: 0.18, metalness: 0.0, clearcoat: 0.9 },
  { name: 'くるみ材', color: 0x6b4a2f, roughness: 0.48, metalness: 0.0, clearcoat: 0.25 },
  { name: '真鍮',     color: 0xb08d4f, roughness: 0.26, metalness: 1.0, clearcoat: 0.0 },
  { name: '黒マット', color: 0x23252a, roughness: 0.72, metalness: 0.15, clearcoat: 0.0 },
  { name: 'テラコッタ', color: 0xb5644a, roughness: 0.66, metalness: 0.0, clearcoat: 0.0 },
  { name: '緑釉',     color: 0x3f6f63, roughness: 0.14, metalness: 0.0, clearcoat: 1.0 },
];

/** 紙に刷ったような説明パネル。額に入れて壁に掛ける。 */
function createPrintTexture(lines, width = 1024, height = 700) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f2efe8';
  ctx.fillRect(0, 0, width, height);

  // 紙のムラ。真っ平らな白は印刷物に見えない
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.018})`;
    ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
  }

  ctx.textBaseline = 'top';
  let y = 88;
  for (const line of lines) {
    const heading = line.startsWith('#');
    const text = heading ? line.slice(1).trim() : line;
    ctx.font = heading
      ? '600 62px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
      : '36px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.fillStyle = heading ? '#1d2430' : '#454b57';
    ctx.fillText(text, 86, y);
    if (heading) {
      ctx.fillStyle = '#c8a04a';
      ctx.fillRect(86, y + 82, 130, 5);
      y += 128;
    } else {
      y += 62;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * 平面投影の UV を張り直す。
 *
 * CylinderGeometry の天面 UV は円盤に放射状に張られているので、そのまま
 * 木材テクスチャを貼ると年輪のような渦になって大理石に見えてしまう。
 * 実際の丸天板は板を矧いで丸く挽くので、木目はまっすぐ通っている。
 * UV はメートル単位で吐くので、マテリアル側は uvInMeters で受ける。
 */
function planarUV(geometry) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i), position.getZ(i));
  }
  uv.needsUpdate = true;
  return geometry;
}

/** 額装した板を壁に掛ける。 */
function framed(map, width, height, frameMaterial) {
  const group = new THREE.Group();
  const depth = 0.028;

  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 }),
  );
  art.position.z = depth / 2 + 0.001;
  group.add(art);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.05, height + 0.05, depth),
    frameMaterial,
  );
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);

  return group;
}

/**
 * 家具一式を作る。
 *
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./textures.js').createTextures>} tex
 * @param {(key: string) => void} onSelectTheme テーマ切替ボタンが押されたとき
 */
export function createFurniture(scene, tex, onSelectTheme) {
  const group = new THREE.Group();
  group.name = 'furniture';
  scene.add(group);

  const grabbables = [];
  const buttons = [];
  const lampSockets = [];

  // テクセル密度を揃えるために、マテリアルは「その部材が実寸で何メートルか」
  // ごとに分ける。同じ木材マテリアルを天板にも椅子の脚にも使い回すと、
  // 小さい部材ほど木目が細かくなりすぎて、くしゃくしゃの箔のように見える。
  // clearcoat は 0.06 まで下げるとほぼ見えないのに、BRDF の計算量は倍近くなる。
  // Pimax のような広視野機ではピクセル数が桁違いなので、木部は素の
  // MeshStandardMaterial にしてある（つやは roughness だけで作る）。
  const wood = (size, extra = {}) => tex.material('walnut', {
    sizeX: size, sizeY: size,
    roughness: 1,
    normalScale: new THREE.Vector2(0.22, 0.22),
    ...extra,
  });
  const steel = (size) => tex.material('brushedSteel', {
    sizeX: size, sizeY: size,
    roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  const cloth = (size, color) => tex.material('linen', {
    sizeX: size, sizeY: size,
    color, roughness: 1,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });

  const woodMaterial = wood(1.3);          // 幕板・小口など
  const tableTopMaterial = wood(1, { uvInMeters: true }); // 天板（平面投影）
  const chairWood = wood(0.45);            // 椅子の座面・背もたれ
  const steelMaterial = steel(0.4);        // テーブルの柱・台座
  const steelThin = steel(0.12);           // 椅子の脚・ソファの脚・ランプの支柱
  const linenMaterial = cloth(2.05, 0x9aa3a8);  // ソファ本体
  const cushionMaterial = cloth(0.96, 0x9aa3a8);
  const pillowMaterial = cloth(0.40, 0x9aa3a8);
  const paintedMaterial = tex.material('walnut', {
    sizeX: 1.5, sizeY: 1.5, color: 0xf2efe9, roughness: 0.6,
    normalScale: new THREE.Vector2(0.08, 0.08),
  });

  // --- ラグ ---------------------------------------------------------------
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.65, 48),
    tex.material('wool', { sizeX: 3.3, sizeY: 3.3, color: 0x9c8f7d, roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55) }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(TABLE.center.x, 0.006, TABLE.center.z);
  rug.receiveShadow = true;
  group.add(rug);

  // --- テーブル -----------------------------------------------------------
  const tableTop = new THREE.Mesh(
    planarUV(new THREE.CylinderGeometry(TABLE.radius, TABLE.radius, 0.042, 64)),
    tableTopMaterial,
  );
  tableTop.position.set(TABLE.center.x, TABLE.top - 0.021, TABLE.center.z);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  group.add(tableTop);

  // 天板の小口を薄く見せるための面取りリング
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(TABLE.radius - 0.006, 0.008, 8, 64),
    woodMaterial,
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.set(TABLE.center.x, TABLE.top - 0.040, TABLE.center.z);
  group.add(edge);

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.075, TABLE.top - 0.10, 20),
    steelMaterial,
  );
  column.position.set(TABLE.center.x, (TABLE.top - 0.10) / 2 + 0.03, TABLE.center.z);
  column.castShadow = true;
  group.add(column);

  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.028, 0.05), steelMaterial);
    arm.position.set(TABLE.center.x, 0.02, TABLE.center.z);
    arm.rotation.y = (i / 4) * Math.PI * 2;
    arm.translateX(0.20);
    arm.castShadow = true;
    group.add(arm);
  }

  // --- 椅子 ---------------------------------------------------------------
  const chairSeat = new RoundedBoxGeometry(0.44, 0.045, 0.42, 3, 0.015);
  const chairBack = new RoundedBoxGeometry(0.42, 0.40, 0.038, 3, 0.014);
  const chairLeg = new THREE.CylinderGeometry(0.017, 0.013, 0.44, 10);

  for (const angle of [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.5]) {
    const chair = new THREE.Group();
    chair.position.set(
      TABLE.center.x + Math.sin(angle) * 0.96,
      0,
      TABLE.center.z + Math.cos(angle) * 0.96,
    );
    chair.rotation.y = angle + Math.PI;

    const seat = new THREE.Mesh(chairSeat, chairWood);
    seat.position.y = 0.45;
    seat.castShadow = true;
    seat.receiveShadow = true;
    chair.add(seat);

    const back = new THREE.Mesh(chairBack, chairWood);
    back.position.set(0, 0.68, -0.19);
    back.rotation.x = 0.10;
    back.castShadow = true;
    chair.add(back);

    for (const [x, z] of [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]]) {
      const leg = new THREE.Mesh(chairLeg, steelThin);
      leg.position.set(x, 0.22, z);
      leg.castShadow = true;
      chair.add(leg);
    }

    group.add(chair);
  }

  // --- ソファ -------------------------------------------------------------
  const sofa = new THREE.Group();
  sofa.position.set(ROOM.maxX - 0.95, 0, 0.35);
  sofa.rotation.y = -Math.PI / 2;

  const sofaBase = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.34, 0.88, 4, 0.05), linenMaterial);
  sofaBase.position.y = 0.30;
  sofaBase.castShadow = true;
  sofaBase.receiveShadow = true;
  sofa.add(sofaBase);

  const sofaBack = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.60, 0.22, 4, 0.06), linenMaterial);
  sofaBack.position.set(0, 0.68, -0.33);
  sofaBack.rotation.x = -0.10;
  sofaBack.castShadow = true;
  sofa.add(sofaBack);

  for (const x of [-0.98, 0.98]) {
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.30, 0.88, 4, 0.06), linenMaterial);
    arm.position.set(x, 0.62, 0);
    arm.castShadow = true;
    sofa.add(arm);
  }

  // 座面クッション。わずかに間隔と沈み込みを変えると生活感が出る
  for (let i = 0; i < 2; i++) {
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.96, 0.15, 0.80, 4, 0.06), cushionMaterial);
    cushion.position.set(-0.50 + i * 1.0, 0.535 - i * 0.008, 0.02);
    cushion.rotation.y = (i - 0.5) * 0.02;
    cushion.castShadow = true;
    cushion.receiveShadow = true;
    sofa.add(cushion);
  }

  for (let i = 0; i < 2; i++) {
    const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.40, 0.40, 0.13, 4, 0.06), pillowMaterial.clone());
    pillow.material.color.setHex(i === 0 ? 0xb96a4f : 0x4c6473);
    pillow.position.set(-0.68 + i * 1.36, 0.72, -0.20);
    pillow.rotation.set(0.28, (i - 0.5) * 0.5, (i - 0.5) * 0.35);
    pillow.castShadow = true;
    sofa.add(pillow);
  }

  for (const [x, z] of [[-0.9, -0.34], [0.9, -0.34], [-0.9, 0.34], [0.9, 0.34]]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.14, 8), steelThin);
    foot.position.set(x, 0.07, z);
    sofa.add(foot);
  }

  group.add(sofa);

  // --- 本棚 ---------------------------------------------------------------
  const shelf = new THREE.Group();
  shelf.position.set(-1.75, 0, ROOM.maxZ - 0.17);

  const SHELF_W = 1.5;
  const SHELF_H = 1.85;
  const SHELF_D = 0.30;

  const sideGeometry = new THREE.BoxGeometry(0.03, SHELF_H, SHELF_D);
  for (const x of [-SHELF_W / 2, SHELF_W / 2]) {
    const side = new THREE.Mesh(sideGeometry, paintedMaterial);
    side.position.set(x, SHELF_H / 2, 0);
    side.castShadow = true;
    side.receiveShadow = true;
    shelf.add(side);
  }

  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(SHELF_W, SHELF_H, 0.014), paintedMaterial);
  backPanel.position.set(0, SHELF_H / 2, -SHELF_D / 2);
  backPanel.receiveShadow = true;
  shelf.add(backPanel);

  const bookColors = [0x7a3b34, 0x2f4a5c, 0x6a6350, 0x8a6a3a, 0x3d5a45, 0x4a3a52, 0xa8a094];
  const boardGeometry = new THREE.BoxGeometry(SHELF_W, 0.026, SHELF_D);
  const books = [];

  for (let level = 0; level < 5; level++) {
    const y = 0.06 + level * ((SHELF_H - 0.12) / 4);
    const board = new THREE.Mesh(boardGeometry, paintedMaterial);
    board.position.set(0, y, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    shelf.add(board);

    // 本。高さと厚みと傾きを散らして「詰まっている」感じにする
    let x = -SHELF_W / 2 + 0.05;
    let index = level * 7;
    while (x < SHELF_W / 2 - 0.10) {
      const thickness = 0.018 + ((index * 37) % 5) * 0.009;
      const height = 0.20 + ((index * 53) % 7) * 0.014;
      const lean = ((index * 29) % 11) === 0 ? 0.16 : 0;
      books.push({
        x: x + thickness / 2,
        y: y + 0.013 + height / 2,
        thickness, height, lean,
        color: bookColors[index % bookColors.length],
      });
      x += thickness + 0.003 + lean * 0.1;
      index++;
    }
  }

  // 本は 100 冊近くになるので InstancedMesh にまとめる。
  // 色は setColorAt で 1 冊ずつ変えられるので、見た目は失われない。
  const bookMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 }),
    books.length,
  );
  bookMesh.castShadow = true;
  bookMesh.receiveShadow = true;

  {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1);
    const color = new THREE.Color();

    books.forEach((book, i) => {
      position.set(book.x, book.y, 0.01);
      quaternion.setFromAxisAngle(axis, book.lean);
      scale.set(book.thickness, book.height, SHELF_D * 0.72);
      bookMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      bookMesh.setColorAt(i, color.setHex(book.color));
    });
    bookMesh.instanceMatrix.needsUpdate = true;
    if (bookMesh.instanceColor) bookMesh.instanceColor.needsUpdate = true;
  }

  shelf.add(bookMesh);

  group.add(shelf);

  // --- 照明器具 -----------------------------------------------------------
  // ペンダント（テーブルの上）
  const shadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8e2d6, roughness: 0.6, metalness: 0.05,
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });

  const pendantY = 1.78;
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, ROOM.height - pendantY - 0.09, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }),
  );
  cord.position.set(TABLE.center.x, (ROOM.height + pendantY - 0.09) / 2, TABLE.center.z);
  group.add(cord);

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.20, 28, 1, true),
    shadeMaterial,
  );
  shade.position.set(TABLE.center.x, pendantY, TABLE.center.z);
  shade.castShadow = true;
  group.add(shade);

  // ペンダントはスポットライト。点光源のキューブシャドウは 6 面の継ぎ目から
  // 光が漏れて天井に三角形のシミが出るので、影を落とすのは単一の 2D シャドウ
  // マップで済むスポットに任せる。上向きの淡い漏れだけ別に足す。
  lampSockets.push({
    type: 'spot',
    position: new THREE.Vector3(TABLE.center.x, pendantY - 0.04, TABLE.center.z),
    target: new THREE.Vector3(TABLE.center.x, 0, TABLE.center.z),
    material: shadeMaterial,
    intensity: 26,
    angle: 0.95,
    penumbra: 0.65,
  });
  lampSockets.push({
    type: 'point',
    position: new THREE.Vector3(TABLE.center.x, pendantY + 0.14, TABLE.center.z),
    intensity: 2.2,
  });

  // フロアランプ（隅）
  const lampShadeMaterial = shadeMaterial.clone();
  const lamp = new THREE.Group();
  lamp.position.set(ROOM.minX + 0.55, 0, ROOM.maxZ - 0.75);

  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 24), steelMaterial);
  lampBase.position.y = 0.015;
  lampBase.castShadow = true;
  lamp.add(lampBase);

  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.42, 10), steelThin);
  lampPole.position.y = 0.72;
  lampPole.castShadow = true;
  lamp.add(lampPole);

  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.21, 0.26, 28, 1, true),
    lampShadeMaterial,
  );
  lampShade.position.y = 1.44;
  lampShade.castShadow = true;
  lamp.add(lampShade);
  group.add(lamp);

  lampSockets.push({
    type: 'point',
    position: new THREE.Vector3(ROOM.minX + 0.55, 1.40, ROOM.maxZ - 0.75),
    material: lampShadeMaterial,
    intensity: 9,
  });

  // --- 壁の額 -------------------------------------------------------------
  const frameMaterial = tex.material('walnut', { sizeX: 0.5, sizeY: 0.5, color: 0x50412f, roughness: 0.5 });

  const panel = framed(
    createPrintTexture([
      '# WebXR おもちゃ箱',
      'トリガー : つかむ / 離すと投げる',
      '左スティック : 移動',
      '右スティック : スナップターン',
      '壁のスイッチ : 時間帯を変える',
    ]),
    0.78, 0.53, frameMaterial,
  );
  panel.position.set(ROOM.minX + 0.02, 1.52, 1.45);
  panel.rotation.y = Math.PI / 2;
  group.add(panel);

  // --- テーマ切替スイッチ -------------------------------------------------
  const plate = new THREE.Group();
  plate.position.set(ROOM.maxX - 0.02, 1.15, -1.75);
  plate.rotation.y = -Math.PI / 2;

  const plateBody = new THREE.Mesh(
    new RoundedBoxGeometry(0.30, 0.13, 0.016, 3, 0.008),
    new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.42, metalness: 0.05 }),
  );
  plateBody.castShadow = true;
  plate.add(plateBody);

  const themeKeys = Object.keys(THEMES);
  themeKeys.forEach((key, i) => {
    const theme = THEMES[key];
    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.031, 0.031, 0.014, 24),
      new THREE.MeshStandardMaterial({
        color: theme.swatch,
        roughness: 0.28,
        metalness: 0.05,
        emissive: new THREE.Color(theme.swatch),
        emissiveIntensity: 0.1,
      }),
    );
    button.rotation.x = Math.PI / 2;
    const restZ = 0.014;
    button.position.set((i - (themeKeys.length - 1) / 2) * 0.085, 0, restZ);
    button.castShadow = true;
    button.userData = {
      interactive: true,
      restZ,
      press: 0,
      // 壁付きなので、押し込みは Z 方向（板の法線方向）
      axis: 'z',
      onSelect: () => onSelectTheme(key),
    };
    plate.add(button);
    buttons.push(button);
  });

  group.add(plate);

  // --- つかめる小物 -------------------------------------------------------
  const propGeometry = new RoundedBoxGeometry(0.085, 0.085, 0.085, 4, 0.012);

  PROPS.forEach((prop, i) => {
    const mesh = new THREE.Mesh(
      propGeometry,
      new THREE.MeshPhysicalMaterial({
        color: prop.color,
        roughness: prop.roughness,
        metalness: prop.metalness,
        clearcoat: prop.clearcoat,
        clearcoatRoughness: 0.18,
      }),
    );
    const angle = (i / PROPS.length) * Math.PI * 2 + 0.4;
    const home = new THREE.Vector3(
      TABLE.center.x + Math.cos(angle) * 0.36,
      TABLE.top + 0.0425,
      TABLE.center.z + Math.sin(angle) * 0.36,
    );
    mesh.position.copy(home);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      grabbable: true,
      label: prop.name,
      home,
      halfSize: 0.0425,
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      held: false,
      baseColor: new THREE.Color(prop.color),
      baseEmissive: new THREE.Color(0x000000),
    };
    group.add(mesh);
    grabbables.push(mesh);
  });

  // 生活感の足し算。テーブルの上に浅い受け皿を置いておく
  const tray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.155, 0.022, 32),
    new THREE.MeshPhysicalMaterial({ color: 0x2c2f34, roughness: 0.55, metalness: 0.1, clearcoat: 0.2 }),
  );
  tray.position.set(TABLE.center.x, TABLE.top + 0.011, TABLE.center.z);
  tray.castShadow = true;
  tray.receiveShadow = true;
  group.add(tray);

  return { group, grabbables, buttons, lampSockets };
}
