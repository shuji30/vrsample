import * as THREE from 'three';
import { ROOM } from './room.js';

/**
 * 窓の外の公園。さるすべりの木と滑り台がある。
 *
 * 室内の写実性は「窓の外に本当に世界があるか」でかなり決まる。距離が出る
 * ように、テラス → 柵 → 芝生 → 木と遊具 → 遠景の生垣、と層を重ねてある。
 */

const UP = new THREE.Vector3(0, 1, 0);

// --- ジオメトリのヘルパー ------------------------------------------------

/**
 * 曲線に沿って半径の変わる筒を張る。TubeGeometry は半径が一定なので、
 * 根元が太く先が細い幹や枝はこれで作る。
 *
 * flute を渡すと断面を花びら状に波打たせて縦溝を作れる。さるすべりの幹は
 * 筋肉質にうねっているので、真円の円柱のままだと途端に「棒」に見える。
 *
 * UV はメートル単位（u = 周長、v = 曲線長）で吐くので、
 * テクスチャ側は uvInMeters で受ける。
 *
 * @param {THREE.Curve} curve
 * @param {(t:number) => number} radiusAt
 * @param {number} tubularSegments
 * @param {number} radialSegments
 * @param {{count:number, depth:number, twist?:number}} [flute]
 */
function taperedTube(curve, radiusAt, tubularSegments = 20, radialSegments = 10, flute = null) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const length = curve.getLength();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const point = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const base = radiusAt(t);

    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);

      // 断面まわりの基底。radial が外向き、tangent がその周方向の微分
      const rx = cos * N.x + sin * B.x;
      const ry = cos * N.y + sin * B.y;
      const rz = cos * N.z + sin * B.z;
      const tx = sin * N.x + cos * B.x;
      const ty = sin * N.y + cos * B.y;
      const tz = sin * N.z + cos * B.z;

      let radius = base;
      let dRadius = 0;
      if (flute) {
        const phase = flute.count * angle + (flute.twist ?? 0) * t;
        radius = base * (1 + flute.depth * Math.sin(phase));
        dRadius = base * flute.depth * flute.count * Math.cos(phase);
      }

      // 断面が波打つと法線も傾く。極座標の曲線の法線は (r, -dr/dθ)。
      // 解析的に出しておけば、継ぎ目に線が出る computeVertexNormals を避けられる。
      const nx = radius * rx - dRadius * tx;
      const ny = radius * ry - dRadius * ty;
      const nz = radius * rz - dRadius * tz;
      const inv = 1 / Math.hypot(nx, ny, nz);

      normals.push(nx * inv, ny * inv, nz * inv);
      positions.push(point.x + radius * rx, point.y + radius * ry, point.z + radius * rz);
      uvs.push((j / radialSegments) * base * Math.PI * 2, t * length);
    }
  }

  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1);
      const b = (radialSegments + 1) * i + (j - 1);
      const c = (radialSegments + 1) * i + j;
      const d = (radialSegments + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * position / normal / uv だけを持つジオメトリをまとめる。
 * 幹と枝と小枝で 100 個近いジオメトリができるので、1 つに畳んでおく。
 */
function mergeParts(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const g of geometries) {
    position.set(g.attributes.position.array, vertexOffset * 3);
    normal.set(g.attributes.normal.array, vertexOffset * 3);
    uv.set(g.attributes.uv.array, vertexOffset * 2);
    const source = g.index.array;
    for (let i = 0; i < source.length; i++) index[indexOffset + i] = source[i] + vertexOffset;
    vertexOffset += g.attributes.position.count;
    indexOffset += source.length;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

/**
 * 2D の断面をカーブに沿って掃引する。滑り台の U 字のシュート用。
 *
 * Frenet フレームは曲率がゼロの区間で法線が飛ぶので、ワールドの上方向を
 * 基準にしたフレームを自前で作る（滑り台は真上を向かないので安定する）。
 *
 * @param {THREE.Curve} curve
 * @param {{x:number,y:number}[]} profile 右方向 x・上方向 y の断面（開いた線）
 */
function sweepProfile(curve, profile, segments = 40) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const point = new THREE.Vector3();
  const length = curve.getLength();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    right.crossVectors(tangent, UP).normalize();
    up.crossVectors(right, tangent).normalize();

    for (let j = 0; j < profile.length; j++) {
      const p = profile[j];
      positions.push(
        point.x + right.x * p.x + up.x * p.y,
        point.y + right.y * p.x + up.y * p.y,
        point.z + right.z * p.x + up.z * p.y,
      );
      uvs.push(j / (profile.length - 1), t * length);
    }
  }

  const stride = profile.length;
  for (let i = 1; i <= segments; i++) {
    for (let j = 1; j < stride; j++) {
      const a = stride * (i - 1) + (j - 1);
      const b = stride * i + (j - 1);
      const c = stride * i + j;
      const d = stride * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** 決まった順で同じ形が出るようにした簡易乱数。 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// --- 空 -------------------------------------------------------------------

/** グラデーションの天球。頂点のワールド高さで 2 色を混ぜるだけ。 */
function createSky() {
  const uniforms = {
    topColor: { value: new THREE.Color(0x2a6bd4) },
    bottomColor: { value: new THREE.Color(0xbfe4ff) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
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

  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  sky.name = 'sky';
  return { sky, uniforms };
}

// --- さるすべり -----------------------------------------------------------

/**
 * さるすべり（百日紅）。
 *
 * 見分けどころは 3 つ。根元から株立ちに分かれて外へ開く壺形の樹形、猿も滑ると
 * いうつるつるのまだらな樹皮、そして枝先に**直立して付く円錐形の紅い花穂**。
 *
 * 作り方で一番効くのは枝の階層を 3 段（幹 → 枝 → 小枝）にすること。太い枝から
 * いきなり大きな葉の板が生えていると、その「中間が抜けている」感じが
 * 一目で CG に見える原因になる。葉は小枝に沿って小さく多数、花穂は小枝の先端に
 * 立てて置く。
 */
function createCrapeMyrtle(tex, { height = 5.0, trunks = 4, seed = 7 } = {}) {
  const group = new THREE.Group();
  const rand = makeRandom(seed);

  const barkMaterial = tex.material('bark', {
    uvInMeters: true,
    roughness: 1,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });

  const leafMaterial = new THREE.MeshStandardMaterial({
    map: tex.foliage,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.72,   // 葉の表面は意外とつやがある
    metalness: 0,
  });

  const blossomMaterial = new THREE.MeshStandardMaterial({
    map: tex.blossom,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
  });

  const wood = [];
  const leafSites = [];
  const blossomSites = [];

  const scale = height / 5.0;

  for (let i = 0; i < trunks; i++) {
    // 壺形。根元でわずかに散らし、上に行くほど外へ開く
    const angle = (i / trunks) * Math.PI * 2 + rand() * 0.5;
    const lean = (0.55 + rand() * 0.35) * scale;
    const top = height * (0.44 + rand() * 0.12);
    const baseR = (0.070 + rand() * 0.028) * scale;
    const dir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));

    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(dir.x * 0.05, 0, dir.y * 0.05),
      new THREE.Vector3(dir.x * lean * 0.34, top * 0.32, dir.y * lean * 0.34),
      // 途中で身をよじらせる。まっすぐな幹は途端に棒に見える
      new THREE.Vector3(
        dir.x * lean * 0.70 + (rand() - 0.5) * 0.16,
        top * 0.66,
        dir.y * lean * 0.70 + (rand() - 0.5) * 0.16,
      ),
      new THREE.Vector3(dir.x * lean, top, dir.y * lean),
    ]);

    wood.push(taperedTube(
      trunkCurve,
      (t) => baseR * (1 - t * 0.55),
      18, 10,
      { count: 5, depth: 0.085, twist: 0.9 },   // 縦溝
    ));

    const branches = 3 + ((rand() * 2) | 0);
    for (let b = 0; b < branches; b++) {
      const from = trunkCurve.getPointAt(0.58 + b * 0.14);
      const bAngle = angle + (rand() - 0.5) * 1.8;
      // 実物の樹冠は高さより幅がある。上へ伸ばすより外へ張らせる
      const reach = (0.85 + rand() * 0.75) * scale;
      const rise = (height - from.y) * (0.24 + rand() * 0.26);
      const tip = new THREE.Vector3(
        from.x + Math.cos(bAngle) * reach,
        from.y + rise,
        from.z + Math.sin(bAngle) * reach,
      );
      const branchCurve = new THREE.CatmullRomCurve3([
        from,
        new THREE.Vector3(
          (from.x + tip.x) / 2 + (rand() - 0.5) * 0.18,
          // 中間を持ち上げて弓なりにする。花の重みで先が少し垂れる形
          (from.y + tip.y) / 2 + rise * 0.42,
          (from.z + tip.z) / 2 + (rand() - 0.5) * 0.18,
        ),
        tip,
      ]);
      const branchR = baseR * 0.44;
      wood.push(taperedTube(branchCurve, (t) => branchR * (1 - t * 0.82), 10, 7));

      // 枝先そのものにも葉を回す
      leafSites.push({
        x: tip.x, y: tip.y, z: tip.z,
        size: (0.32 + rand() * 0.16) * scale,
        ry: rand() * Math.PI * 2,
        tilt: (rand() - 0.5) * 1.1,
        roll: (rand() - 0.5) * 1.3,
        shade: 0.82 + rand() * 0.26,
        warm: 0.82 + rand() * 0.30,
      });

      // 小枝。ここを省くと枝と葉の間に何も無い「CG の木」になる
      const twigs = 7 + ((rand() * 3) | 0);
      for (let w = 0; w < twigs; w++) {
        const at = 0.34 + (w / twigs) * 0.64;
        const origin = branchCurve.getPointAt(at);
        const tAngle = bAngle + (rand() - 0.5) * 2.6;
        const length = (0.26 + rand() * 0.34) * scale;
        // 斜め上へ。真上を向かせると樹冠が箒のように立ってしまう
        const lift = 0.15 + rand() * 0.55;
        const twigTip = new THREE.Vector3(
          origin.x + Math.cos(tAngle) * length * Math.sqrt(1 - lift * lift),
          origin.y + length * lift,
          origin.z + Math.sin(tAngle) * length * Math.sqrt(1 - lift * lift),
        );
        const twigCurve = new THREE.CatmullRomCurve3([
          origin,
          new THREE.Vector3(
            (origin.x + twigTip.x) / 2,
            (origin.y + twigTip.y) / 2 + length * 0.09,
            (origin.z + twigTip.z) / 2,
          ),
          twigTip,
        ]);
        const twigR = branchR * 0.38;
        wood.push(taperedTube(twigCurve, (t) => twigR * (1 - t * 0.6), 5, 5));

        // 葉の房を小枝に沿って
        const clusters = 4 + ((rand() * 2) | 0);
        for (let k = 0; k < clusters; k++) {
          // 先端まで葉を回す。ここを空けると枯れ枝が樹冠から突き出して見える
          const p = twigCurve.getPointAt(0.30 + (k / (clusters - 1)) * 0.70);
          leafSites.push({
            x: p.x + (rand() - 0.5) * 0.12 * scale,
            y: p.y + (rand() - 0.5) * 0.10 * scale,
            z: p.z + (rand() - 0.5) * 0.12 * scale,
            size: (0.30 + rand() * 0.20) * scale,
            ry: rand() * Math.PI * 2,
            tilt: (rand() - 0.5) * 1.1,
            roll: (rand() - 0.5) * 1.3,
            shade: 0.82 + rand() * 0.26,
            warm: 0.82 + rand() * 0.30,
          });
        }

        // 花穂は枝先に直立。これが無いとただの雑木になる
        if (rand() < 0.72) {
          blossomSites.push({
            x: twigTip.x + (rand() - 0.5) * 0.06,
            y: twigTip.y,
            z: twigTip.z + (rand() - 0.5) * 0.06,
            size: (0.17 + rand() * 0.10) * scale,
            ry: rand() * Math.PI * 2,
            tone: 0.78 + rand() * 0.34,
          });
        }
      }
    }
  }

  const trunkMesh = new THREE.Mesh(mergeParts(wood), barkMaterial);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const size = new THREE.Vector3();
  const plane = new THREE.PlaneGeometry(1, 1);

  // 葉。1 か所につき 90 度ずらした 2 枚を交差させる。VR ではビルボードだと
  // 両目の視差で「紙」だと分かってしまうので、向きは固定する。
  const tint = new THREE.Color();
  const leafMesh = new THREE.InstancedMesh(plane, leafMaterial, leafSites.length * 2);
  leafSites.forEach((site, i) => {
    for (let k = 0; k < 2; k++) {
      position.set(site.x, site.y, site.z);
      euler.set(site.tilt, site.ry + k * Math.PI / 2, site.roll);
      quaternion.setFromEuler(euler);
      size.set(site.size, site.size, 1);
      leafMesh.setMatrixAt(i * 2 + k, matrix.compose(position, quaternion, size));
      // 同じテクスチャを何百枚も貼るので、明るさと色味を 1 枚ずつずらす。
      // これが無いと樹冠がべったり一色に見える。
      leafMesh.setColorAt(i * 2 + k, tint.setRGB(site.warm, site.shade, site.shade * 0.92));
    }
  });
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  leafMesh.castShadow = true;
  group.add(leafMesh);

  // 花穂。カードの下端が枝先に来るよう半分ぶん持ち上げる
  const blossomMesh = new THREE.InstancedMesh(plane, blossomMaterial, blossomSites.length * 2);
  blossomSites.forEach((site, i) => {
    for (let k = 0; k < 2; k++) {
      position.set(site.x, site.y + site.size * 0.45, site.z);
      quaternion.setFromAxisAngle(UP, site.ry + k * Math.PI / 2);
      size.set(site.size * 0.62, site.size, 1);
      blossomMesh.setMatrixAt(i * 2 + k, matrix.compose(position, quaternion, size));
      // 咲きはじめと盛りが混ざるので、穂ごとに濃さを変える
      blossomMesh.setColorAt(i * 2 + k, tint.setRGB(site.tone, site.tone * 0.93, site.tone * 0.96));
    }
  });
  blossomMesh.instanceMatrix.needsUpdate = true;
  if (blossomMesh.instanceColor) blossomMesh.instanceColor.needsUpdate = true;
  blossomMesh.castShadow = true;
  group.add(blossomMesh);

  return group;
}

// --- 滑り台 ---------------------------------------------------------------

/** 滑り台。ステップ・踊り場・手すり・U 字のシュート。 */
function createSlide() {
  const group = new THREE.Group();

  const chuteMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f7fd0, roughness: 0.34, metalness: 0.0, side: THREE.DoubleSide,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6432e, roughness: 0.42, metalness: 0.25,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8b021, roughness: 0.4, metalness: 0.25,
  });
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0x3f8f57, roughness: 0.6, metalness: 0.1,
  });

  const DECK_Y = 1.45;
  const HALF = 0.46;

  const post = new THREE.CylinderGeometry(0.038, 0.038, DECK_Y, 10);
  for (const [x, z] of [[-HALF, -HALF], [HALF, -HALF], [-HALF, 0.34], [HALF, 0.34]]) {
    const mesh = new THREE.Mesh(post, frameMaterial);
    mesh.position.set(x, DECK_Y / 2, z - 0.4);
    mesh.castShadow = true;
    group.add(mesh);
  }

  const deck = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.08, 0.05, 0.88), deckMaterial);
  deck.position.set(0, DECK_Y, -0.43);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // 手すり（踊り場の左右）
  const railGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.88, 8);
  for (const x of [-HALF, HALF]) {
    for (const y of [DECK_Y + 0.38, DECK_Y + 0.68]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, y, -0.43);
      rail.castShadow = true;
      group.add(rail);
    }
    const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.72, 8), railMaterial);
    upright.position.set(x, DECK_Y + 0.36, -0.86);
    upright.castShadow = true;
    group.add(upright);
  }

  // 滑り出しのフープ
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 8, 20, Math.PI), railMaterial);
  hoop.position.set(0, DECK_Y + 0.02, -0.02);
  hoop.castShadow = true;
  group.add(hoop);

  // はしご
  const ladderRail = new THREE.CylinderGeometry(0.026, 0.026, 1.85, 8);
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(ladderRail, railMaterial);
    rail.position.set(x, 0.86, -1.18);
    rail.rotation.x = -0.34;
    rail.castShadow = true;
    group.add(rail);
  }
  const rung = new THREE.CylinderGeometry(0.019, 0.019, 0.68, 8);
  for (let i = 0; i < 5; i++) {
    const t = (i + 1) / 6;
    const mesh = new THREE.Mesh(rung, frameMaterial);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(0, DECK_Y * t + 0.06, -1.5 + t * 0.52);
    mesh.castShadow = true;
    group.add(mesh);
  }

  // シュート。U 字の断面をカーブに沿って掃引する
  const chuteCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, DECK_Y - 0.03, -0.02),
    new THREE.Vector3(0, DECK_Y - 0.28, 0.52),
    new THREE.Vector3(0, DECK_Y - 0.78, 1.28),
    new THREE.Vector3(0, 0.30, 2.05),
    new THREE.Vector3(0, 0.17, 2.55),
    new THREE.Vector3(0, 0.22, 2.92),
  ]);

  const profile = [];
  const W = 0.30;
  profile.push({ x: -W, y: 0.20 });
  profile.push({ x: -W, y: 0.10 });
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    profile.push({ x: Math.cos(a) * (W - 0.02), y: 0.10 - Math.sin(a) * 0.07 });
  }
  profile.push({ x: W, y: 0.10 });
  profile.push({ x: W, y: 0.20 });

  const chute = new THREE.Mesh(sweepProfile(chuteCurve, profile, 44), chuteMaterial);
  chute.castShadow = true;
  chute.receiveShadow = true;
  group.add(chute);

  // シュートの支柱
  for (const t of [0.55, 0.85]) {
    const at = chuteCurve.getPointAt(t);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, at.y, 8), frameMaterial);
    leg.position.set(0, at.y / 2, at.z);
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

// --- 小物 -----------------------------------------------------------------

/** 公園のベンチ。人のサイズの手がかりになるので、距離感がぐっと出る。 */
function createBench(tex) {
  const group = new THREE.Group();
  const slatMaterial = tex.material('walnut', {
    sizeX: 1.6, sizeY: 0.09, color: 0xa8825a, roughness: 0.74,
  });
  const ironMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, metalness: 0.7 });

  const slat = new THREE.BoxGeometry(1.6, 0.035, 0.085);
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(slat, slatMaterial);
    mesh.position.set(0, 0.44, -0.11 + i * 0.105);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(slat, slatMaterial);
    mesh.position.set(0, 0.60 + i * 0.105, 0.20);
    mesh.rotation.x = -0.18;
    mesh.castShadow = true;
    group.add(mesh);
  }
  for (const x of [-0.68, 0.68]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.34), ironMaterial);
    leg.position.set(x, 0.22, 0.02);
    leg.castShadow = true;
    group.add(leg);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), ironMaterial);
    back.position.set(x, 0.66, 0.22);
    back.rotation.x = -0.18;
    back.castShadow = true;
    group.add(back);
  }
  return group;
}

/** 横桟の低い柵。テラスと芝生の境目に置いて奥行きの層を作る。 */
function createFence(length, seed = 3) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.78, metalness: 0 });
  const rand = makeRandom(seed);
  const spacing = 1.5;
  const count = Math.round(length / spacing);

  for (let i = 0; i <= count; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.80, 0.075), material);
    post.position.set(-length / 2 + i * spacing, 0.40, (rand() - 0.5) * 0.02);
    post.rotation.y = (rand() - 0.5) * 0.05;
    post.castShadow = true;
    group.add(post);
  }
  for (const y of [0.34, 0.66]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.075, 0.035), material);
    rail.position.set(0, y, 0);
    rail.castShadow = true;
    group.add(rail);
  }
  return group;
}

/**
 * 遠景の生垣と木立。
 *
 * 細部は要らないので葉テクスチャの板を並べるだけだが、枚数が多いので
 * InstancedMesh にまとめる。ドローコールは Pimax のような高解像度ヘッドセット
 * ではフィルレートほど支配的ではないものの、数百単位で積むと効いてくる。
 *
 * 部屋の 2 面（正面と左）に窓があるので、遠景も 3 辺に回しておかないと
 * 左の窓から「芝生と空だけ」の何もない地平線が見えてしまう。
 */
function createBackdrop(tex, seed = 11) {
  const group = new THREE.Group();
  const rand = makeRandom(seed);

  const leafMaterial = new THREE.MeshStandardMaterial({
    map: tex.foliageDark,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });

  const leaves = [];
  const trunks = [];

  /** 生垣を 1 辺ぶん並べる。dir は辺に沿った向き。 */
  function hedgeRow(from, to, count) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const size = 1.6 + rand() * 0.9;
      leaves.push({
        x: from.x + (to.x - from.x) * t + (rand() - 0.5) * 1.0,
        y: 0.75 + rand() * 0.25,
        z: from.z + (to.z - from.z) * t + (rand() - 0.5) * 1.0,
        sx: size, sy: size * 0.8, ry: rand() * Math.PI,
      });
    }
  }

  /** 木立を 1 辺ぶん並べる。 */
  function treeRow(from, to, count) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = from.x + (to.x - from.x) * t + (rand() - 0.5) * 2.2;
      const z = from.z + (to.z - from.z) * t + (rand() - 0.5) * 2.2;
      const h = 5 + rand() * 3.5;
      trunks.push({ x, y: h * 0.275, z, sy: h * 0.55 });
      for (let k = 0; k < 3; k++) {
        const size = h * (0.5 + rand() * 0.2);
        leaves.push({
          x: x + (rand() - 0.5) * 0.9,
          y: h * 0.68 + (rand() - 0.5) * 0.6,
          z: z + (rand() - 0.5) * 0.9,
          sx: size, sy: size, ry: rand() * Math.PI,
        });
      }
    }
  }

  hedgeRow({ x: -24, z: -17.5 }, { x: 24, z: -17.5 }, 46);
  hedgeRow({ x: -17.5, z: -20 }, { x: -17.5, z: 6 }, 26);
  hedgeRow({ x: 17.5, z: -20 }, { x: 17.5, z: 6 }, 26);

  treeRow({ x: -22, z: -22 }, { x: 22, z: -22 }, 16);
  treeRow({ x: -20.5, z: -20 }, { x: -20.5, z: 6 }, 11);
  treeRow({ x: 20.5, z: -20 }, { x: 20.5, z: 6 }, 11);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  const leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMaterial, leaves.length);
  leaves.forEach((leaf, i) => {
    position.set(leaf.x, leaf.y, leaf.z);
    quaternion.setFromAxisAngle(UP, leaf.ry);
    scale.set(leaf.sx, leaf.sy, 1);
    leafMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  });
  leafMesh.instanceMatrix.needsUpdate = true;
  group.add(leafMesh);

  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.11, 0.18, 1, 6),
    trunkMaterial,
    trunks.length,
  );
  trunks.forEach((trunk, i) => {
    position.set(trunk.x, trunk.y, trunk.z);
    quaternion.identity();
    scale.set(1, trunk.sy, 1);
    trunkMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  group.add(trunkMesh);

  return group;
}

// --- 組み立て -------------------------------------------------------------

/**
 * 公園をまるごと作ってシーンに足す。
 *
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./textures.js').createTextures>} tex
 */
export function createPark(scene, tex) {
  const group = new THREE.Group();
  group.name = 'park';
  scene.add(group);

  const { sky, uniforms: skyUniforms } = createSky();
  scene.add(sky);

  // --- 地面 ---------------------------------------------------------------
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    tex.material('grass', { sizeX: 70, sizeY: 70, normalScale: new THREE.Vector2(0.6, 0.6) }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(0, -0.005, -20);
  lawn.receiveShadow = true;
  group.add(lawn);

  // 窓の外すぐのテラス。室内の床と芝生をつなぐ層
  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.12, 2.0),
    tex.material('plaster', { sizeX: 11, sizeY: 2, color: 0xa9a49b, roughness: 0.95 }),
  );
  terrace.position.set(0, -0.06, ROOM.minZ - ROOM.wall - 1.0);
  terrace.receiveShadow = true;
  group.add(terrace);

  const fence = createFence(13);
  fence.position.set(0, 0, ROOM.minZ - ROOM.wall - 2.2);
  group.add(fence);

  // --- さるすべり ---------------------------------------------------------
  // 樹高と位置は窓の画角から逆算している。開始位置（目の高さ 1.6m）から
  // 窓の上枠ごしに見える高さは距離 d に対しておよそ 1.6 + 0.16d なので、
  // 5m の木だと花の付く上半分が枠で切れてしまう。実物としても 4m 前後は
  // ありふれた大きさなので、そちらに合わせた。
  const tree = createCrapeMyrtle(tex, { height: 4.0, trunks: 4, seed: 19 });
  tree.position.set(-1.6, 0, -9.2);
  group.add(tree);

  const smallTree = createCrapeMyrtle(tex, { height: 3.2, trunks: 3, seed: 91 });
  smallTree.position.set(-6.4, 0, -12.6);
  smallTree.rotation.y = 1.1;
  group.add(smallTree);

  // --- 滑り台 -------------------------------------------------------------
  const slide = createSlide();
  slide.position.set(2.35, 0, -9.4);
  slide.rotation.y = -0.52;
  group.add(slide);

  // 滑り降りた先の砂場
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 28),
    new THREE.MeshStandardMaterial({ color: 0xcdb794, roughness: 0.98, metalness: 0 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(1.95, 0.012, -7.5);
  sand.receiveShadow = true;
  group.add(sand);

  // --- 小物 ---------------------------------------------------------------
  const bench = createBench(tex);
  bench.position.set(-0.3, 0, -6.2);
  bench.rotation.y = Math.PI + 0.25;
  group.add(bench);

  group.add(createBackdrop(tex));

  return { group, sky, skyUniforms };
}
