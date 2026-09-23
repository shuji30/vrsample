import * as THREE from 'three';

/**
 * 部屋の躯体（床・壁・天井・幅木・窓・ドア）。
 *
 * 壁は厚み 14cm の押し出しで作り、窓とドアは穴として開ける。こうすると
 * 開口部の「見込み（reveal）」が自然に出る。板 1 枚に穴を描いただけの窓は
 * VR だと厚みの無さが立体視で即バレるので、ここは手を抜けない。
 */

export const ROOM = {
  width: 6.0,
  depth: 7.2,
  height: 2.7,
  wall: 0.14,
  get minX() { return -this.width / 2; },
  get maxX() { return this.width / 2; },
  get minZ() { return -this.depth / 2; },
  get maxZ() { return this.depth / 2; },
};

/** 開口部。x は壁のローカル座標（壁の中心が 0）、y は床からの高さ。 */
const OPENINGS = {
  // 正面（-Z）: 庭へ出る掃き出し窓。腰高の窓ではなく床まで開いているので、
  // そのまま外へ歩いて出られる。すぐ外にテラスがあるので導線としても自然。
  front: { x: 0, width: 3.2, sill: 0.0, head: 2.32, doorway: true },
  // 左（-X）: 採光用。ここから斜めに日が差して床に光の帯を作る
  left: { x: 0.7, width: 1.8, sill: 0.42, head: 2.32 },
  // 背面（+Z）: ドア
  door: { x: -1.05, width: 0.92, sill: 0, head: 2.04 },
};

/**
 * 壁 1 枚ぶんの形状を作る。ローカル XY（x は壁中心が 0、y は床からの高さ）で
 * 定義し、+Z 方向に壁厚ぶん押し出す。
 */
function wallGeometry(width, height, openings, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  for (const o of openings) {
    const hole = new THREE.Path();
    const x0 = o.x - o.width / 2;
    const x1 = o.x + o.width / 2;
    hole.moveTo(x0, o.sill);
    hole.lineTo(x1, o.sill);
    hole.lineTo(x1, o.head);
    hole.lineTo(x0, o.head);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 壁を配置する。押し出し方向（ローカル +Z）が必ず部屋の内側を向くように、
 * 壁は室内の外側に置いてから回転させる。
 */
function placeWall(mesh, side) {
  const { wall } = ROOM;
  switch (side) {
    case 'front': // -Z
      mesh.position.set(0, 0, ROOM.minZ - wall);
      break;
    case 'back': // +Z
      mesh.position.set(0, 0, ROOM.maxZ + wall);
      mesh.rotation.y = Math.PI;
      break;
    case 'left': // -X
      mesh.position.set(ROOM.minX - wall, 0, 0);
      mesh.rotation.y = Math.PI / 2;
      break;
    case 'right': // +X
      mesh.position.set(ROOM.maxX + wall, 0, 0);
      mesh.rotation.y = -Math.PI / 2;
      break;
  }
}

/** 幅木。壁の足元に回すだけで、途端に「建築」に見えるようになる。 */
function addBaseboard(group, material) {
  const H = 0.092;
  const T = 0.018;
  const geometry = new THREE.BoxGeometry(1, H, T);

  /** @param {number} length @param {[number,number,number]} pos @param {number} rotY */
  const run = (length, pos, rotY) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.x = length;
    mesh.position.set(pos[0], H / 2, pos[2]);
    mesh.rotation.y = rotY;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const inset = T / 2;
  // 正面は掃き出し窓の開口ぶんを空ける
  const front = OPENINGS.front;
  if (front.sill <= 0.001) {
    const left = front.x - front.width / 2;
    const right = front.x + front.width / 2;
    const leftLen = left - ROOM.minX;
    const rightLen = ROOM.maxX - right;
    if (leftLen > 0.01) run(leftLen, [ROOM.minX + leftLen / 2, 0, ROOM.minZ + inset], 0);
    if (rightLen > 0.01) run(rightLen, [right + rightLen / 2, 0, ROOM.minZ + inset], 0);
  } else {
    run(ROOM.width, [0, 0, ROOM.minZ + inset], 0);
  }
  run(ROOM.depth, [ROOM.minX + inset, 0, 0], Math.PI / 2);
  run(ROOM.depth, [ROOM.maxX - inset, 0, 0], -Math.PI / 2);

  // 背面はドアの開口ぶんを空ける（ドアは壁ローカル x = -1.05、+Z 壁は反転）
  const door = OPENINGS.door;
  const doorCenter = -door.x;
  const left = doorCenter - door.width / 2;
  const right = doorCenter + door.width / 2;
  const leftLen = left - ROOM.minX;
  const rightLen = ROOM.maxX - right;
  run(leftLen, [ROOM.minX + leftLen / 2, 0, ROOM.maxZ - inset], Math.PI);
  run(rightLen, [right + rightLen / 2, 0, ROOM.maxZ - inset], Math.PI);
}

/**
 * 窓の内枠・額縁・窓台・方立。開口の縁が「切りっぱなし」だと安っぽいので、
 * 薄い板を回して陰影のきっかけを作る。
 */
function addWindowTrim(group, frameMaterial, sillMaterial, spec) {
  const { center, width, height, axis } = spec;
  const T = 0.035;      // 枠の見付け
  const D = 0.05;       // 室内側への出
  const sillDepth = 0.13;
  const trim = new THREE.Group();
  trim.position.copy(center);
  if (axis === 'x') trim.rotation.y = Math.PI / 2;

  const box = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    trim.add(mesh);
  };

  // 額縁（上・左・右）
  box(width + T * 2, T, D, 0, height / 2 + T / 2, D / 2, frameMaterial);
  box(T, height + T * 2, D, -width / 2 - T / 2, 0, D / 2, frameMaterial);
  box(T, height + T * 2, D, width / 2 + T / 2, 0, D / 2, frameMaterial);

  if (spec.doorway) {
    // 敷居。掃き出し窓なので窓台ではなく、床と地面をつなぐ框を置く
    box(width + T * 2, 0.022, 0.14, 0, -height / 2 + 0.011, 0.02, sillMaterial);
  } else {
    // 窓台（室内に少し出す）
    box(width + T * 4, 0.03, sillDepth, 0, -height / 2 - 0.015, sillDepth / 2 - 0.02, sillMaterial);
  }

  if (spec.doorway) {
    // 引き戸は 2 枚とも片側へ寄せて「全開」にしてある。
    //
    // 前は左右に 1 枚ずつ寄せて中央を空けていたが、縦框が左右対称に立つと
    // 方立にしか見えず、閉じた窓と区別がつかなかった（実際「外に出られない」
    // と言われた）。2 枚を重ねて片側に寄せ、残りを丸ごと空けると、
    // どこが通り抜けられるのかがひと目で分かる。
    // 鴨居（上のレール）
    box(width + T * 2, 0.045, 0.11, 0, height / 2 - 0.0225, 0.055, frameMaterial);
    for (const sash of spec.sashes) {
      const w = sash.width;
      const z = sash.z;
      box(w, 0.055, 0.038, sash.x, height / 2 - 0.0775, z, frameMaterial);            // 上框
      box(w, 0.075, 0.038, sash.x, -height / 2 + 0.0575, z, frameMaterial);           // 下框
      box(0.048, height - 0.15, 0.038, sash.x - w / 2 + 0.024, -0.01, z, frameMaterial); // 縦框
      box(0.048, height - 0.15, 0.038, sash.x + w / 2 - 0.024, -0.01, z, frameMaterial); // 縦框
      box(w, 0.032, 0.036, sash.x, height / 2 - height * 0.30, z, frameMaterial);     // 中桟
    }
  } else {
    // 方立と無目。ガラスの割り付けがあると一気に「窓」になる
    box(0.045, height, 0.03, 0, 0, 0.015, frameMaterial);
    box(width, 0.04, 0.03, 0, height / 2 - height * 0.32, 0.015, frameMaterial);
  }

  group.add(trim);
}

/**
 * 部屋を組み立てる。
 *
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./textures.js').createTextures>} tex
 */
export function createRoom(scene, tex) {
  const group = new THREE.Group();
  group.name = 'room';
  scene.add(group);

  const wallMaterial = tex.material('plaster', {
    uvInMeters: true,
    color: 0xe9e3da,
    normalScale: new THREE.Vector2(0.18, 0.18),
  });
  const ceilingMaterial = tex.material('plaster', {
    sizeX: ROOM.width, sizeY: ROOM.depth,
    color: 0xf3f0ea,
    normalScale: new THREE.Vector2(0.14, 0.14),
  });
  const floorMaterial = tex.material('oakFloor', {
    sizeX: ROOM.width, sizeY: ROOM.depth,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  // 塗装した木部（枠・幅木・ドア枠）。テクスチャは板目を弱く効かせる
  const trimMaterial = tex.material('walnut', {
    sizeX: 1.2, sizeY: 1.2,
    color: 0xf6f4f0,
    roughness: 0.55,
    normalScale: new THREE.Vector2(0.10, 0.10),
  });
  const doorMaterial = tex.material('walnut', {
    sizeX: 0.92, sizeY: 2.04,
    color: 0xb8a48c,
    normalScale: new THREE.Vector2(0.25, 0.25),
  });

  // --- 床 -----------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // --- 天井 ---------------------------------------------------------------
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    ceilingMaterial,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.height;
  ceiling.receiveShadow = true;
  group.add(ceiling);

  // --- 壁 -----------------------------------------------------------------
  const walls = {
    front: [OPENINGS.front],
    back: [OPENINGS.door],
    left: [OPENINGS.left],
    right: [],
  };

  for (const [side, openings] of Object.entries(walls)) {
    const isEndWall = side === 'front' || side === 'back';
    const width = isEndWall ? ROOM.width : ROOM.depth;
    const mesh = new THREE.Mesh(
      wallGeometry(width, ROOM.height, openings, ROOM.wall),
      wallMaterial,
    );
    placeWall(mesh, side);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  addBaseboard(group, trimMaterial);

  // --- 屋根 ---------------------------------------------------------------
  // 庭から見ると、屋根が無いままでは家が書き割りに見える（天井が透けて
  // 見えてしまう）。陸屋根に深い庇を回して、外から見ても建物になるようにする。
  const EAVE = 0.55;
  const ROOF_THICK = 0.20;
  const roofW = ROOM.width + ROOM.wall * 2 + EAVE * 2;
  const roofD = ROOM.depth + ROOM.wall * 2 + EAVE * 2;

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(roofW, ROOF_THICK, roofD),
    tex.material('plaster', {
      sizeX: roofW, sizeY: roofD,
      color: 0xb9b3a8,
      roughness: 0.95,
      normalScale: new THREE.Vector2(0.25, 0.25),
    }),
  );
  roof.position.set(0, ROOM.height + ROOF_THICK / 2 + 0.02, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  // 鼻隠し。庇の小口に一本入れると、厚みのある屋根に見える
  const fasciaMaterial = tex.material('walnut', {
    sizeX: roofW, sizeY: 0.09, color: 0x6a5b4a, roughness: 0.62,
  });
  for (const [w, d, x, z] of [
    [roofW, 0.03, 0, -roofD / 2], [roofW, 0.03, 0, roofD / 2],
    [0.03, roofD, -roofW / 2, 0], [0.03, roofD, roofW / 2, 0],
  ]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), fasciaMaterial);
    fascia.position.set(x, ROOM.height + 0.02 - 0.02, z);
    fascia.castShadow = true;
    group.add(fascia);
  }

  // --- 窓 -----------------------------------------------------------------
  // ライティング側が面光源を置くために、開口の実座標を返す
  const front = OPENINGS.front;
  const left = OPENINGS.left;

  // 掃き出し窓の引き戸。2 枚を -X 側へ寄せ、わずかにずらして重ねて置く。
  // 残った側が実際に通り抜けられる開口で、歩ける範囲もここから決める。
  const SASH_WIDTH = 0.82;
  const SASH_STACK = 0.20;      // 重なった 2 枚の見えるずれ
  const sashX = -front.width / 2 + SASH_WIDTH / 2;
  const sashes = [
    { x: sashX, width: SASH_WIDTH, z: 0.020 },            // 外レール
    { x: sashX + SASH_STACK, width: SASH_WIDTH, z: 0.078 }, // 内レール
  ];
  const openMin = sashX + SASH_STACK + SASH_WIDTH / 2;
  const openMax = front.width / 2;

  const windows = [
    {
      name: 'front',
      axis: 'z',
      center: new THREE.Vector3(front.x, (front.sill + front.head) / 2, ROOM.minZ),
      width: front.width,
      height: front.head - front.sill,
      normal: new THREE.Vector3(0, 0, 1),
      doorway: Boolean(front.doorway),
      sashes,
    },
    {
      name: 'left',
      axis: 'x',
      // 壁ローカル x は world -Z 向き（placeWall の回転による）
      center: new THREE.Vector3(ROOM.minX, (left.sill + left.head) / 2, -left.x),
      width: left.width,
      height: left.head - left.sill,
      normal: new THREE.Vector3(1, 0, 0),
    },
  ];

  for (const spec of windows) addWindowTrim(group, trimMaterial, trimMaterial, spec);

  // ガラス。本物の transmission は WebXR で高くつくので、
  // ごく薄い加算のツヤだけ置いて「そこに板ガラスがある」ことを示す。
  const glassMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfd8ea,
    transparent: true,
    opacity: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  for (const spec of windows) {
    // 掃き出し窓は左右に寄せた戸のぶんだけガラスを張る。中央は開いている
    // 掃き出し窓は引き戸の枠の中だけにガラスを張る。戸と同じ奥行きに置かないと
    // 枠から浮いて見えるので、レールのぶんだけ室内側へ寄せる。
    const panes = spec.doorway
      ? spec.sashes.map((sash) => [sash.x, sash.width - 0.09, sash.z, spec.height - 0.14])
      : [[0, spec.width, 0.02, spec.height]];

    for (const [offset, paneWidth, depth, paneHeight] of panes) {
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(paneWidth, paneHeight),
        glassMaterial,
      );
      glass.position.copy(spec.center);
      if (spec.axis === 'x') {
        glass.rotation.y = Math.PI / 2;
        glass.position.z -= offset;
        glass.position.x += depth;
      } else {
        glass.position.x += offset;
        glass.position.z += depth;
      }
      glass.renderOrder = 2;
      group.add(glass);
    }
  }

  // --- ドア ---------------------------------------------------------------
  const door = OPENINGS.door;
  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(door.width - 0.02, door.head - 0.02, 0.042),
    doorMaterial,
  );
  doorPanel.position.set(-door.x, (door.head - 0.02) / 2, ROOM.maxZ + 0.03);
  doorPanel.castShadow = true;
  doorPanel.receiveShadow = true;
  group.add(doorPanel);

  const doorTrim = new THREE.Mesh(
    new THREE.BoxGeometry(door.width + 0.11, door.head + 0.055, 0.03),
    trimMaterial,
  );
  doorTrim.position.set(-door.x, (door.head + 0.055) / 2 - 0.03, ROOM.maxZ - 0.012);
  group.add(doorTrim);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x8c7a5e, roughness: 0.28, metalness: 0.95 }),
  );
  knob.position.set(-door.x + door.width / 2 - 0.10, 1.02, ROOM.maxZ - 0.01);
  knob.castShadow = true;
  group.add(knob);

  return { group, floor, windows, doorway: { x: front.x + (openMin + openMax) / 2, width: openMax - openMin, frameWidth: front.width }, materials: { wallMaterial, ceilingMaterial, floorMaterial, trimMaterial } };
}
