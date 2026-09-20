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
  // 正面（-Z）: 公園が見える大きな窓
  front: { x: 0, width: 3.2, sill: 0.42, head: 2.32 },
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
  run(ROOM.width, [0, 0, ROOM.minZ + inset], 0);
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

  // 窓台（室内に少し出す）
  box(width + T * 4, 0.03, sillDepth, 0, -height / 2 - 0.015, sillDepth / 2 - 0.02, sillMaterial);

  // 方立と無目。ガラスの割り付けがあると一気に「窓」になる
  box(0.045, height, 0.03, 0, 0, 0.015, frameMaterial);
  box(width, 0.04, 0.03, 0, height / 2 - height * 0.32, 0.015, frameMaterial);

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

  // --- 窓 -----------------------------------------------------------------
  // ライティング側が面光源を置くために、開口の実座標を返す
  const front = OPENINGS.front;
  const left = OPENINGS.left;
  const windows = [
    {
      name: 'front',
      axis: 'z',
      center: new THREE.Vector3(front.x, (front.sill + front.head) / 2, ROOM.minZ),
      width: front.width,
      height: front.head - front.sill,
      normal: new THREE.Vector3(0, 0, 1),
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
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.height),
      glassMaterial,
    );
    glass.position.copy(spec.center);
    if (spec.axis === 'x') glass.rotation.y = Math.PI / 2;
    glass.renderOrder = 2;
    group.add(glass);
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

  return { group, floor, windows, materials: { wallMaterial, ceilingMaterial, floorMaterial, trimMaterial } };
}
