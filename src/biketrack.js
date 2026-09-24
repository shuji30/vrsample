import * as THREE from 'three';

/**
 * ポケバイ（ミニバイク）の小さなコース。公園の左（テニスコートの左の芝生）に置く。
 * 平らで、幅 2.4m。短いストレートと、ヘアピン・S 字を入れて 1 周 50m ほど（ポケバイで
 * 1 周 10 秒くらい）。走る向きは点の順（手前のストレートを奥（-Z）へ）。
 *
 * カートのコース（karttrack.js）と同じ考え方で、中心線を閉じた曲線で決め、そこから路面・
 * 縁石・スタート / ゴールを作る。中心線はバイクの走り（コースの外に出たか）と周回の計算に使う。
 */

const CENTER = [
  [-8.2, -16.0], [-8.2, -24.0], [-9.2, -28.8], [-12.2, -30.0], [-14.8, -28.6], [-15.4, -25.6],
  [-13.2, -23.4], [-12.0, -21.0], [-14.2, -18.6], [-15.6, -16.2], [-14.2, -14.4], [-10.6, -14.2],
];

export const BIKE_TRACK = {
  width: 2.4,
  curb: 0.25,
  /** スタート / ゴールの位置（中心線の長さに対する割合） */
  startAt: 0.04,
  /** 走れる範囲（庭とつながる、ワールドの矩形）。手前の z -14〜-5 は芝生（遊び場を置く） */
  area: { minX: -17.0, maxX: -5.0, minZ: -31.6, maxZ: -5.5 },
};

const curve = new THREE.CatmullRomCurve3(CENTER.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
const SAMPLES = 400;
const points = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES);
const tangents = points.map((_, i) => curve.getTangentAt(i / SAMPLES).setY(0).normalize());
export const BIKE_TRACK_LENGTH = curve.getLength();

export function bikeTrackPoint(u, out = new THREE.Vector3()) {
  return out.copy(curve.getPointAt(((u % 1) + 1) % 1));
}
export function bikeTrackTangent(u, out = new THREE.Vector3()) {
  return out.copy(curve.getTangentAt(((u % 1) + 1) % 1)).setY(0).normalize();
}

/**
 * いちばん近い中心線の点。
 * @returns {{ u: number, lateral: number, distance: number, index: number }} lateral は右が +
 */
export function nearestOnBikeTrack(x, z, hint = -1) {
  let best = 0;
  let bestD = Infinity;
  const scan = (i) => {
    const p = points[(i + SAMPLES) % SAMPLES];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = (i + SAMPLES) % SAMPLES; }
  };
  if (hint >= 0) for (let k = -30; k <= 30; k++) scan(hint + k);
  else for (let i = 0; i < SAMPLES; i++) scan(i);
  const p = points[best];
  const t = tangents[best];
  const lateral = (x - p.x) * -t.z + (z - p.z) * t.x;
  return { u: best / SAMPLES, lateral, distance: Math.sqrt(bestD), index: best };
}

/** スタートの線の少し後ろ（バイクを置く所）。後輪の車軸の位置と向き */
export function bikeGridSlot(back = 1.6) {
  const u = BIKE_TRACK.startAt - back / BIKE_TRACK_LENGTH;
  const p = bikeTrackPoint(u);
  const t = bikeTrackTangent(u);
  return { x: p.x, z: p.z, yaw: Math.atan2(t.x, t.z) };
}

function ribbon(from, to, y, cols = 1) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = cols + 1;
  let along = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const k = i % SAMPLES;
    const p = points[k];
    const t = tangents[k];
    if (i > 0) along += points[k].distanceTo(points[(i - 1) % SAMPLES]);
    for (let c = 0; c <= cols; c++) {
      const off = from + ((to - from) * c) / cols;
      positions.push(p.x - t.z * off, y, p.z + t.x * off);
      uvs.push(c / cols, along);
    }
    if (i < SAMPLES) {
      const a = i * row;
      for (let c = 0; c < cols; c++) indices.push(a + c, a + row + c, a + c + 1, a + c + 1, a + row + c, a + row + c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (geometry.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

function canvasTexture(draw, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** コース一式（路面・縁石・スタート / ゴールの線・小さな看板） */
export function createBikeCourse() {
  const group = new THREE.Group();
  group.name = 'bikeCourse';
  const half = BIKE_TRACK.width / 2;

  const asphalt = canvasTexture((ctx) => {
    ctx.fillStyle = '#55585d';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1600; i++) {
      const v = 60 + Math.floor(Math.random() * 60);
      ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.3 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
  }, 128, 128);
  asphalt.repeat.set(1, 0.3);
  const road = new THREE.Mesh(ribbon(-half, half, 0.012, 4), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9 }));
  road.receiveShadow = true;
  group.add(road);

  // 縁石（青と白。カートの赤白と見分けられるように）
  const stripes = canvasTexture((ctx) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, 16, 64);
    ctx.fillStyle = '#2f6fd8';
    ctx.fillRect(0, 0, 16, 32);
  }, 16, 64);
  stripes.repeat.set(1, 1.25);
  const curbMaterial = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const a = side * half;
    const b = side * (half + BIKE_TRACK.curb);
    const curb = new THREE.Mesh(ribbon(Math.min(a, b), Math.max(a, b), 0.02), curbMaterial);
    curb.receiveShadow = true;
    group.add(curb);
  }

  // スタート / ゴールの市松の線
  const at = bikeTrackPoint(BIKE_TRACK.startAt);
  const dir = bikeTrackTangent(BIKE_TRACK.startAt);
  const checker = canvasTexture((ctx) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(i * 16, j * 16, 16, 16);
    }
  }, 128, 32);
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(BIKE_TRACK.width, 0.4), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }));
  finish.rotation.set(-Math.PI / 2, Math.atan2(dir.x, dir.z), 0, 'YXZ');
  finish.position.set(at.x, 0.022, at.z);
  group.add(finish);

  // 看板「ポケバイ」
  const sign = canvasTexture((ctx) => {
    ctx.fillStyle = '#2f6fd8';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ポケバイ', 128, 50);
  }, 256, 96);
  // 表は庭の側。裏は無地の板（両面にすると、裏から鏡文字に見えた）
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }));
  const boardBack = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.56), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 }));
  boardBack.rotation.y = Math.PI;
  boardBack.position.z = -0.01;
  board.add(boardBack);
  board.position.set(-6.0, 1.3, -14.4);
  board.rotation.y = Math.PI / 2 + 0.3;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }));
  post.position.set(-6.0, 0.55, -14.4);
  group.add(board, post);
  return group;
}
