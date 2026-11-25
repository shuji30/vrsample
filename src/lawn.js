import * as THREE from 'three';

/**
 * 芝の地面の仕上げ（売り物の水準 A3）。
 *
 * テクスチャを敷いただけの芝は、どこまでも同じ緑で、上から見ると作り物に見える。本物の芝生には
 *
 *   - 大きな色むら … 日当たりや水はけで、数 m おきに黄ばんだ所と濃い所ができる
 *   - 刈り跡     … 芝刈り機の往復で、葉の倒れる向きが帯ごとに逆になる。見る向きで明暗が入れ替わる
 *   - 際の土     … 小道・木の根もと・柵や遊具の脚のまわりは、踏まれて土が出る
 *
 * がある。これをシェーダーで足す。色むらは場所から決めるノイズ（JS と GLSL で同じ式。草の束の色も
 * 同じむらに合わせる）。土は、真上から「地面すれすれの物」だけを描いた地図をぼかして、際を見つける。
 */

/** 芝の土の色（リニア）。乾いた明るい茶 */
const SOIL = new THREE.Color().setRGB(0.15, 0.095, 0.05);

// --- 場所から決めるノイズ（GLSL と同じ式） ---------------------------------
const fract = (v) => v - Math.floor(v);
function hash(x, y) {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

/** 色むら（-1〜1）。+ が黄ばんだ所、- が濃い緑の所 */
export function lawnPatch(x, z) {
  const n = noise(x / 11, z / 11) * 0.65 + noise(x / 4 + 17.3, z / 4 + 17.3) * 0.35;
  return n * 2 - 1;
}

const GLSL_NOISE = /* glsl */`
float lawnHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float lawnNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( lawnHash( i ), lawnHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( lawnHash( i + vec2( 0.0, 1.0 ) ), lawnHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

/**
 * 真上から、芝と「地面すれすれの物」を描いて、芝の見えている所の地図（1 = 芝）を作り、ぼかす。
 * 高い所にある物（樹冠・屋根・観覧車のかご）は描かない。上から描くと樹冠の丸い影の形に土が出てしまう。
 */
function soilMap(renderer, scene, isLawnMaterial, bounds) {
  const RES = 5;                                  // 1m あたりの画素
  const W = bounds.maxX - bounds.minX;
  const D = bounds.maxZ - bounds.minZ;
  const mw = Math.round(W * RES);
  const mh = Math.round(D * RES);
  const target = new THREE.WebGLRenderTarget(mw, mh, { depthBuffer: true });
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0.1, 120);
  camera.position.set((bounds.minX + bounds.maxX) / 2, 60, (bounds.minZ + bounds.maxZ) / 2);
  camera.up.set(0, 0, -1);
  camera.lookAt(camera.position.x, 0, camera.position.z);
  camera.updateMatrixWorld(true);
  // 1 回目：芝の高さを描く（R = (y + 2) / 8。3cm きざみ）。カートコースの起伏の上でも、地面からの高さで判定できるように
  // 2 回目：芝を白、ほかの物を黒で描く。ただし地面から 35cm より上の画素は捨てる（樹冠や屋根を描かない）。
  // 物ごとの箱で判定すると、木や生け垣はまとめて 1 つのメッシュ（InstancedMesh）なので、樹冠まで黒になった
  const worldPos = `
    vec4 lawnW = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      lawnW = batchingMatrix * lawnW;
    #endif
    #ifdef USE_INSTANCING
      lawnW = instanceMatrix * lawnW;
    #endif
    vLawnW = ( modelMatrix * lawnW ).xyz;`;
  const heightTarget = new THREE.WebGLRenderTarget(mw, mh, { depthBuffer: true });
  const heightMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  heightMat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vLawnW;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${worldPos}`);
    shader.fragmentShader = 'varying vec3 vLawnW;\n' + shader.fragmentShader
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor = vec4( clamp( ( vLawnW.y + 2.0 ) / 8.0, 0.0, 1.0 ), 0.0, 0.0, 1.0 );');
  };
  heightMat.customProgramCacheKey = () => 'lawnHeight';
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });
  const heightMap = { value: heightTarget.texture };
  black.onBeforeCompile = (shader) => {
    shader.uniforms.lawnHeight = heightMap;
    shader.uniforms.lawnBounds = { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) };
    shader.vertexShader = 'varying vec3 vLawnW;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${worldPos}`);
    shader.fragmentShader = 'varying vec3 vLawnW;\nuniform sampler2D lawnHeight;\nuniform vec4 lawnBounds;\n' + shader.fragmentShader
      .replace('void main() {', `void main() {
        vec2 lawnRel = ( vLawnW.xz - lawnBounds.xy ) / ( lawnBounds.zw - lawnBounds.xy );
        float lawnY = texture2D( lawnHeight, vec2( lawnRel.x, 1.0 - lawnRel.y ) ).r * 8.0 - 2.0;
        if ( vLawnW.y > lawnY + 0.35 ) discard;`);
  };
  black.customProgramCacheKey = () => 'lawnSoilBlack';
  const restore = [];
  const lawnMeshes = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      restore.push([o, 'material', o.material]);
      const material = Array.isArray(o.material) ? o.material[0] : o.material;
      if (isLawnMaterial(material)) { o.material = heightMat; lawnMeshes.push(o); return; }
      // 動く物（人・動物）は描かない。見えない物（当たり判定の板など）も、そのまま描かない
      if (o.isSkinnedMesh || (material?.transparent && material.opacity < 0.05) || material?.colorWrite === false) {
        restore.push([o, 'visible', o.visible]);
        o.visible = false;
      } else {
        o.material = black;
      }
    } else if (o.isPoints || o.isLine || o.isSprite) {
      if (o.visible) { restore.push([o, 'visible', true]); o.visible = false; }
    }
  });
  const saved = { target: renderer.getRenderTarget(), background: scene.background, fog: scene.fog, xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate };
  const pixels = new Uint8Array(mw * mh * 4);
  const hidden = [];
  try {
    scene.background = null;
    scene.fog = null;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    // 1 回目：芝だけ
    scene.traverse((o) => { if (o.isMesh && o.material !== heightMat && o.visible) { hidden.push(o); o.visible = false; } });
    renderer.setRenderTarget(heightTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    for (const o of hidden) o.visible = true;
    // 2 回目
    for (const o of lawnMeshes) o.material = white;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, mw, mh, pixels);
  } finally {
    for (const o of hidden) o.visible = true;
    for (let i = restore.length - 1; i >= 0; i--) { const [o, key, value] = restore[i]; o[key] = value; }
    scene.background = saved.background;
    scene.fog = saved.fog;
    renderer.xr.enabled = saved.xr;
    renderer.shadowMap.autoUpdate = saved.shadow;
    renderer.setRenderTarget(saved.target);
    target.dispose();
    heightTarget.dispose();
    heightMat.dispose();
    white.dispose();
    black.dispose();
  }

  // ぼかす（箱型を 2 回。半径 2 画素 = 0.4m）。際から 0.5m ほどで芝に戻る
  let a = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) a[i] = pixels[i * 4] / 255;
  let b = new Float32Array(mw * mh);
  const R = 2;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        let s = 0; let n = 0;
        for (let k = -R; k <= R; k++) { const q = x + k; if (q >= 0 && q < mw) { s += a[y * mw + q]; n++; } }
        b[y * mw + x] = s / n;
      }
    }
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        let s = 0; let n = 0;
        for (let k = -R; k <= R; k++) { const q = y + k; if (q >= 0 && q < mh) { s += b[q * mw + x]; n++; } }
        a[y * mw + x] = s / n;
      }
    }
  }
  const data = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) data[i] = Math.round(a[i] * 255);
  const texture = new THREE.DataTexture(data, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 芝の地面に、色むら・刈り跡・際の土を足す。ほかの物をすべて置いたあと（草の束より前）に呼ぶ。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} options
 * @param {THREE.MeshStandardMaterial} options.lawnMaterial 丘の上の芝の素材
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} options.bounds 刈り跡と土を入れる範囲（丘の上）
 */
export function dressLawn(renderer, scene, { lawnMaterial, bounds }) {
  // 同じ芝のテクスチャを使う素材（丘の斜面など）も、色むらだけはそろえる
  const map = lawnMaterial.map;
  const isLawnMaterial = (m) => m === lawnMaterial || (Boolean(map) && m?.isMeshStandardMaterial && m.map === map);
  const soil = soilMap(renderer, scene, isLawnMaterial, bounds);
  const uniforms = {
    lawnSoil: { value: soil },
    lawnBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) },
    lawnSoilColor: { value: SOIL },
  };

  const materials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (isLawnMaterial(m)) materials.add(m);
  });
  for (const material of materials) {
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      before?.call(material, shader, r);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vLawnPos;\n' + shader.vertexShader
        .replace('#include <project_vertex>', `#include <project_vertex>
        vLawnPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
      shader.fragmentShader = `varying vec3 vLawnPos;
uniform sampler2D lawnSoil;
uniform vec4 lawnBounds;
uniform vec3 lawnSoilColor;
${GLSL_NOISE}
` + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 p = vLawnPos.xz;
        vec3 c = diffuseColor.rgb;
        // 大きな色むら（lawnPatch と同じ式）
        float pc = ( lawnNoise( p / 11.0 ) * 0.65 + lawnNoise( p / 4.0 + 17.3 ) * 0.35 ) * 2.0 - 1.0;
        c *= 1.0 + pc * 0.2;
        c = mix( c, c * vec3( 1.14, 1.03, 0.68 ), smoothstep( 0.1, 0.7, pc ) * 0.6 );
        // 刈り跡（丘の上だけ）。幅 1.8m の帯で、葉の倒れる向きが交互。見る向きで明暗が入れ替わる
        vec2 rel = ( p - lawnBounds.xy ) / ( lawnBounds.zw - lawnBounds.xy );
        float inside = step( 0.0, rel.x ) * step( rel.x, 1.0 ) * step( 0.0, rel.y ) * step( rel.y, 1.0 );
        float band = smoothstep( -0.2, 0.2, sin( p.x * 3.14159265 / 1.8 ) ) * 2.0 - 1.0;
        vec2 toEye = cameraPosition.xz - p;
        float along = toEye.y / max( length( toEye ), 0.001 );
        float fade = smoothstep( 60.0, 15.0, length( toEye ) );
        c *= 1.0 + 0.12 * band * along * inside * fade;
        // 際の土
        float k = texture2D( lawnSoil, vec2( rel.x, 1.0 - rel.y ) ).r;
        float sn = lawnNoise( p * 1.7 + 3.1 );
        float soilK = inside * smoothstep( 0.78, 0.45, k + ( sn - 0.5 ) * 0.3 );
        c = mix( c, lawnSoilColor * ( 0.8 + 0.4 * sn ), soilK * 0.85 );
        diffuseColor.rgb = c;
      }`);
    };
    const key = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${key ? key() : ''}|lawnDress`;
    material.needsUpdate = true;
  }
  return { materials: materials.size, soil };
}
