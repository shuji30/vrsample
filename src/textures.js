import * as THREE from 'three';

/**
 * 手続き的な PBR テクスチャ生成。
 *
 * 外部アセットを持たない方針（クローンしてすぐ動く）を守りたいので、
 * 写真スキャンのテクスチャは使わずコードで焼く。写実性に効くのは
 * 「アルベドの色」よりも **ノーマルの微細な凹凸** と **ラフネスのムラ** なので、
 * どのマテリアルも albedo / normal / ORM の 3 枚組で作る。
 *
 * ORM は glTF と同じ詰め方（R = AO、G = ラフネス、B = メタルネス）。
 * three.js の MeshStandardMaterial は roughnessMap の G、metalnessMap の B、
 * aoMap の R しか見ないので、1 枚を 3 つのスロットに挿せる。
 */

// --- ノイズ -------------------------------------------------------------

function hash2(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) * 2.3283064365386963e-10;
}

/**
 * タイリングする値ノイズ。x / y は「セル単位」の非負座標で、
 * periodX / periodY セルごとに繰り返す。テクスチャを継ぎ目なく敷くため、
 * 周波数とピリオドは必ず同じ値を渡すこと。
 */
function valueNoise(x, y, periodX, periodY, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const xa = x0 % periodX;
  const xb = (x0 + 1) % periodX;
  const ya = y0 % periodY;
  const yb = (y0 + 1) % periodY;

  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);

  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** オクターブを重ねた値ノイズ。u / v は 0〜1 の UV。 */
function fbm(u, v, freqX, freqY, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = freqX;
  let fy = freqY;

  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(u * fx, v * fy, fx, fy, seed + i * 1013);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }

  return sum / norm;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// --- キャンバス / テクスチャ --------------------------------------------

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function putRGBA(canvas, data) {
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  return canvas;
}

function toTexture(canvas, { srgb = false, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * ハイトマップからノーマルマップを焼く（Sobel ではなく中央差分）。
 *
 * three.js は OpenGL 系の接空間（緑 = +Y）を期待する。CanvasTexture は
 * flipY = true で読まれるので、画像の y が増える向きは v が減る向き。
 * その分だけ緑の符号が入れ替わることに注意。
 */
function heightToNormal(height, size, strength) {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => height[(y & (size - 1)) * size + (x & (size - 1))];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const gy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(gx, gy, 1);
      const i = (y * size + x) * 4;
      out[i] = (-gx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (gy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }

  return out;
}

/**
 * 1 ピクセルずつ評価してテクスチャ 3 枚組を焼く共通ループ。
 *
 * @param {number} size テクスチャ解像度（2 の冪）
 * @param {(u:number, v:number, out:object) => void} shade
 *        out に r/g/b（アルベド 0〜1）、h（高さ）、ao / rough / metal を書く
 * @param {number} normalStrength ノーマルの強さ
 */
function bake(size, shade, normalStrength) {
  const albedo = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const out = { r: 1, g: 1, b: 1, h: 0, ao: 1, rough: 0.5, metal: 0 };
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.h = 0;
      out.ao = 1;
      out.metal = 0;
      shade((x + 0.5) * inv, (y + 0.5) * inv, out);

      const i = (y * size + x) * 4;
      albedo[i] = out.r * 255;
      albedo[i + 1] = out.g * 255;
      albedo[i + 2] = out.b * 255;
      albedo[i + 3] = 255;

      orm[i] = out.ao * 255;
      orm[i + 1] = out.rough * 255;
      orm[i + 2] = out.metal * 255;
      orm[i + 3] = 255;

      height[y * size + x] = out.h;
    }
  }

  return {
    albedo: putRGBA(makeCanvas(size), albedo),
    orm: putRGBA(makeCanvas(size), orm),
    normal: putRGBA(makeCanvas(size), heightToNormal(height, size, normalStrength)),
  };
}

// --- 各マテリアルのレシピ ------------------------------------------------

/** オーク材のフローリング。1 タイル = 2m 四方、板幅 12.5cm。 */
function oakFloor(size) {
  const ROWS = 16;          // 2m / 16 = 12.5cm 幅の板
  const JOINTS = 2;         // 1 行あたり 2 枚 = 板長 1m
  const BEVEL = 0.004 / 2;  // 4mm の面取りを UV に換算
  const AO_WIDTH = BEVEL * 4;

  return bake(size, (u, v, out) => {
    const row = Math.floor(v * ROWS);
    const vLocal = v * ROWS - row;

    // 行ごとに継ぎ目をずらす（同じ位置に目地が並ぶと途端に嘘くさくなる）
    const rowSeed = hash2(row, 7, 12345);
    const uShift = u * JOINTS + rowSeed * JOINTS;
    const col = Math.floor(uShift);
    const uLocal = uShift - col;

    // 目地までの距離（UV 空間）
    const dv = Math.min(vLocal, 1 - vLocal) / ROWS;
    const du = Math.min(uLocal, 1 - uLocal) / JOINTS;
    const edge = Math.min(du, dv);

    // 板ごとの色ムラ。オークの範囲内で明度と赤みを振る
    const tone = hash2(row, col, 991);
    const warm = hash2(row, col, 5501);
    const lift = 0.86 + tone * 0.30;
    const red = 0.98 + warm * 0.08;

    // 木目。板に沿って伸びる（u 方向は低周波、v 方向は高周波）
    const grainSeed = 400 + row * 13;
    const grain = fbm(u + rowSeed, v, 6, 96, 3, grainSeed);
    const pores = fbm(u + rowSeed, v, 24, 320, 2, grainSeed + 77);
    const figure = Math.abs(grain - 0.5) * 2;       // 芯に近いほど濃い筋
    const dark = 1 - (figure * 0.30 + pores * 0.12);

    const base = 0.56 * lift * dark;
    out.r = clamp01(base * 1.00 * red);
    out.g = clamp01(base * 0.74);
    out.b = clamp01(base * 0.50);

    // 目地は暗く落とす
    const joint = smoothstep(0, BEVEL, edge);
    out.r *= 0.35 + joint * 0.65;
    out.g *= 0.35 + joint * 0.65;
    out.b *= 0.35 + joint * 0.65;

    out.h = joint * 0.85 + (1 - figure) * 0.10 + pores * 0.05;
    out.ao = 0.55 + smoothstep(0, AO_WIDTH, edge) * 0.45;
    // サテン塗装。木目の導管は少しだけ荒れる
    out.rough = clamp01(0.30 + figure * 0.10 + pores * 0.06 + (1 - joint) * 0.25);
    out.metal = 0;
  }, 26);
}

/** 塗り壁。色はマテリアル側の color で付けるので、ここは白に近い明度ムラだけ。 */
function plaster(size) {
  return bake(size, (u, v, out) => {
    // 目安は 8mm 周期の「ゆず肌」。ここを粗くすると一気に吹き付け塗装になる
    const fine = fbm(u, v, 256, 256, 2, 2024);
    const broad = fbm(u, v, 6, 6, 2, 909);     // ローラーの塗りムラ
    const shade = 0.955 + broad * 0.032 + (fine - 0.5) * 0.014;

    out.r = out.g = out.b = clamp01(shade);
    out.h = fine * 0.88 + broad * 0.12;
    out.ao = 1;
    out.rough = clamp01(0.90 + (fine - 0.5) * 0.08);
    out.metal = 0;
  }, 2);
}

/** ウォールナット。家具用。1 タイル = 1m。 */
function walnut(size) {
  return bake(size, (u, v, out) => {
    // 同心リングを主役にすると、丸天板では大理石に見えてしまう。
    // 実際の家具材は板目取りなので、ゆるく波打つ縞を主役にする。
    const warp = fbm(u, v, 3, 3, 3, 311) - 0.5;
    // 負の座標をノイズに渡さないよう +1（周期ぶんのシフトなので絵は変わらない）
    const gu = u + warp * 0.12 + 1;
    const streak = fbm(gu, v, 5, 88, 3, 733);
    const pores = fbm(u, v, 14, 220, 2, 181);
    const figure = Math.pow(Math.abs(streak - 0.5) * 2, 0.7);

    const dark = 1 - (figure * 0.34 + pores * 0.13);
    const base = 0.26 * dark;
    out.r = clamp01(base * 1.00);
    out.g = clamp01(base * 0.60);
    out.b = clamp01(base * 0.38);

    // 導管の凹凸を高さに強く入れると、光沢のある面で箔のように潰れて見える
    out.h = (1 - figure) * 0.72 + (1 - pores) * 0.28;
    out.ao = 1;
    out.rough = clamp01(0.42 + pores * 0.11 + figure * 0.05);
    out.metal = 0;
  }, 4);
}

/** リネン地。ソファやクッション用。1 タイル = 0.15m。 */
function linen(size) {
  // 0.15m / 34 本 ≒ 4.4mm ピッチ。ここを粗くすると麻袋に見える
  const THREADS = 34;

  return bake(size, (u, v, out) => {
    // 縦糸と横糸を市松に交互へ重ねた、素朴な平織り
    const tu = u * THREADS;
    const tv = v * THREADS;
    const over = ((Math.floor(tu) + Math.floor(tv)) & 1) === 0;
    const warp = Math.sin((tu % 1) * Math.PI);
    const weft = Math.sin((tv % 1) * Math.PI);
    const weave = over ? warp * 0.85 + weft * 0.15 : weft * 0.85 + warp * 0.15;

    const slub = fbm(u, v, 18, 18, 3, 617);      // 糸の太さのばらつき
    const shade = 0.80 + weave * 0.20 - slub * 0.12;

    out.r = out.g = out.b = clamp01(shade);
    out.h = weave * 0.8 + slub * 0.2;
    out.ao = clamp01(0.82 + weave * 0.18);
    out.rough = clamp01(0.86 + slub * 0.10);
    out.metal = 0;
  }, 10);
}

/** ウールのラグ。1 タイル = 0.8m。 */
function wool(size) {
  return bake(size, (u, v, out) => {
    const fiber = fbm(u, v, 160, 160, 3, 8123);
    const clump = fbm(u, v, 14, 14, 3, 4411);
    const shade = 0.80 + (fiber - 0.5) * 0.18 + (clump - 0.5) * 0.10;

    out.r = out.g = out.b = clamp01(shade);
    out.h = fiber * 0.7 + clump * 0.3;
    out.ao = clamp01(0.70 + clump * 0.30);
    out.rough = clamp01(0.94 + (fiber - 0.5) * 0.06);
    out.metal = 0;
  }, 13);
}

/** ヘアライン仕上げのスチール。脚やランプ用。1 タイル = 0.4m。 */
function brushedSteel(size) {
  return bake(size, (u, v, out) => {
    const brush = fbm(u, v, 6, 420, 2, 97);      // 縦方向のヘアライン
    const patina = fbm(u, v, 12, 12, 3, 1201);
    const shade = 0.62 + (brush - 0.5) * 0.10 + (patina - 0.5) * 0.06;

    out.r = clamp01(shade);
    out.g = clamp01(shade * 1.005);
    out.b = clamp01(shade * 1.02);
    out.h = brush;
    out.ao = 1;
    out.rough = clamp01(0.26 + (brush - 0.5) * 0.18 + patina * 0.10);
    out.metal = 1;
  }, 4);
}

/**
 * さるすべりの樹皮。1 タイル = 1m。
 *
 * この木の見分けどころは「猿も滑る」つるつるの幹と、古い皮が剥がれて
 * 出てくるクリーム色・肉桂色・灰色のまだら。凹凸はほとんど付けない。
 */
function crapeMyrtleBark(size) {
  return bake(size, (u, v, out) => {
    // 剥がれた皮のパッチ。低周波ノイズを閾値で切って輪郭を作る
    const patch = fbm(u, v, 5, 7, 4, 3301);
    const patch2 = fbm(u, v, 11, 15, 3, 9903);
    const fresh = smoothstep(0.46, 0.56, patch);          // 新しい肌 = 明るい
    const cinnamon = smoothstep(0.52, 0.62, patch2) * (1 - fresh);

    // 幹の縦方向のうねり（樹皮の凹凸ではなく幹自体の筋肉質な起伏）
    const sinew = fbm(u, v, 9, 3, 2, 555);
    const mottle = fbm(u, v, 40, 30, 2, 71);

    let r = 0.52, g = 0.46, b = 0.42;                     // 下地の灰
    r += fresh * 0.26; g += fresh * 0.21; b += fresh * 0.14;   // クリーム
    r += cinnamon * 0.16; g += cinnamon * 0.04; b -= cinnamon * 0.04; // 肉桂
    const shade = 0.90 + (mottle - 0.5) * 0.12 + (sinew - 0.5) * 0.10;

    out.r = clamp01(r * shade);
    out.g = clamp01(g * shade);
    out.b = clamp01(b * shade);

    // 剥がれた縁だけわずかに段差を付ける。それ以外はつるつる
    const rim = Math.abs(patch - 0.51) < 0.02 ? 0.35 : 0;
    out.h = sinew * 0.7 + mottle * 0.15 - rim;
    out.ao = clamp01(0.88 + fresh * 0.12 - rim * 0.3);
    out.rough = clamp01(0.42 + (1 - fresh) * 0.22 + mottle * 0.08);
    out.metal = 0;
  }, 5);
}

/** 公園の芝生。窓越しに見る前提なので、株のムラと色の幅だけ作る。1 タイル = 2m。 */
function grass(size) {
  return bake(size, (u, v, out) => {
    const blade = fbm(u, v, 200, 200, 2, 6001);
    const clump = fbm(u, v, 16, 16, 3, 733);
    const patch = fbm(u, v, 4, 4, 2, 1777);

    const life = clamp01(0.45 + clump * 0.35 + patch * 0.25);
    const shade = 0.78 + (blade - 0.5) * 0.30;

    // 芝のアルベドは思っているより暗い。明るい緑にすると途端に人工芝になる
    out.r = clamp01((0.22 + (1 - life) * 0.16) * shade);
    out.g = clamp01((0.36 + life * 0.14) * shade);
    out.b = clamp01((0.16 + (1 - life) * 0.05) * shade);

    out.h = blade * 0.6 + clump * 0.4;
    out.ao = clamp01(0.74 + clump * 0.26);
    out.rough = clamp01(0.92 + (blade - 0.5) * 0.08);
    out.metal = 0;
  }, 10);
}

/**
 * 葉のかたまり（アルファ付き）。クロスプレーンに貼って樹冠にする。
 *
 * VR ではビルボードが「紙」に見えてしまう（両目の視差で厚みが無いと分かる）ので、
 * カメラを向かせず固定の交差板として使う前提のテクスチャ。
 *
 * @param {object} options
 * @param {string[]} options.leafColors 葉の色
 * @param {string[]} options.blossomColors 花の色（さるすべりの紅色の穂）
 */
function foliageCluster(size, { leafColors, blossomColors, blossomRatio = 0 }) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  let seed = 1;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const half = size / 2;

  // 中心ほど密に葉を置く。輪郭がぼんやりした塊になるよう半径は二乗で分布させる
  const leafCount = Math.round(size * 1.6);
  for (let i = 0; i < leafCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * half * 0.94;
    const x = half + Math.cos(angle) * radius;
    const y = half + Math.sin(angle) * radius * 0.88;

    const len = size * (0.045 + rand() * 0.055);
    const width = len * (0.42 + rand() * 0.22);

    // 外周の葉は少し暗く（樹冠の内側からの照り返しを想像した擬似 AO）
    const depth = 1 - radius / half;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.globalAlpha = 0.72 + rand() * 0.28;
    ctx.fillStyle = leafColors[(rand() * leafColors.length) | 0];
    ctx.filter = `brightness(${(0.72 + depth * 0.45).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 花穂。小さな花が円錐状に集まるので、点を縦長の房にまとめて置く
  const blossomCount = Math.round(size * 1.6 * blossomRatio);
  for (let i = 0; i < blossomCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * half * 0.85;
    const cx = half + Math.cos(angle) * radius;
    const cy = half + Math.sin(angle) * radius * 0.88;
    const color = blossomColors[(rand() * blossomColors.length) | 0];
    const spread = size * 0.05;

    for (let p = 0; p < 14; p++) {
      const t = p / 14;
      ctx.globalAlpha = 0.65 + rand() * 0.35;
      ctx.fillStyle = color;
      ctx.filter = `brightness(${(0.85 + rand() * 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(
        cx + (rand() - 0.5) * spread * (1 - t) * 2,
        cy - spread * 1.6 * t + (rand() - 0.5) * spread * 0.5,
        size * (0.008 + rand() * 0.010),
        0, Math.PI * 2,
      );
      ctx.fill();
    }
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  return canvas;
}

// --- 公開 API -----------------------------------------------------------

/**
 * テクスチャ一式を焼く。CPU でピクセルを回すので数百 ms かかる。
 *
 * @param {THREE.WebGLRenderer} renderer 異方性フィルタの上限を見るために使う
 * @param {object} [options]
 * @param {number} [options.quality] 1 = 既定。0.5 で解像度を半分に落とす
 */
export function createTextures(renderer, { quality = 1 } = {}) {
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const res = (n) => Math.max(64, 2 ** Math.round(Math.log2(n * quality)));

  /** bake() の 3 枚組を three.js のテクスチャにして、実寸のタイル幅を添える。 */
  function pack(baked, tile) {
    return {
      tile,
      map: toTexture(baked.albedo, { srgb: true, anisotropy: aniso }),
      normalMap: toTexture(baked.normal, { anisotropy: aniso }),
      ormMap: toTexture(baked.orm, { anisotropy: aniso }),
    };
  }

  const sets = {
    oakFloor: pack(oakFloor(res(1024)), 2.0),
    plaster: pack(plaster(res(512)), 2.0),
    walnut: pack(walnut(res(512)), 1.0),
    linen: pack(linen(res(256)), 0.15),
    wool: pack(wool(res(512)), 0.8),
    brushedSteel: pack(brushedSteel(res(256)), 0.4),
    bark: pack(crapeMyrtleBark(res(512)), 1.0),
    grass: pack(grass(res(512)), 2.0),
  };

  /** 交差板に貼る葉テクスチャ。手前の木と遠景で作り分ける。 */
  const foliage = toTexture(
    foliageCluster(res(512), {
      leafColors: ['#3f6b2b', '#4a7a30', '#355c24', '#557f38', '#2e5320'],
      blossomColors: ['#d94f86', '#e06a99', '#c53c74', '#ee89b2'],
      blossomRatio: 0.45,
    }),
    { srgb: true, anisotropy: aniso },
  );
  foliage.wrapS = foliage.wrapT = THREE.ClampToEdgeWrapping;

  // 遠景の生垣と木立。花は付けず、色も落として大気遠近を助ける
  const foliageDark = toTexture(
    foliageCluster(res(256), {
      leafColors: ['#2f4a26', '#37552c', '#28401f', '#3f5f33', '#22371b'],
      blossomColors: [],
      blossomRatio: 0,
    }),
    { srgb: true, anisotropy: aniso },
  );
  foliageDark.wrapS = foliageDark.wrapT = THREE.ClampToEdgeWrapping;

  /**
   * テクスチャ組からマテリアルを作る。
   * sizeX / sizeY は「そのメッシュが実寸で何メートル分か」。
   * ここを実寸で指定することで、部屋じゅうのテクセル密度が揃う。
   */
  function material(setName, { sizeX = 1, sizeY = 1, uvInMeters = false, physical = false, ...params } = {}) {
    const set = sets[setName];
    // ExtrudeGeometry は UV をメートル単位で吐くので、その場合は繰り返しを 1/タイル にする
    const repeatX = uvInMeters ? 1 / set.tile : sizeX / set.tile;
    const repeatY = uvInMeters ? 1 / set.tile : sizeY / set.tile;

    const clone = (texture) => {
      const t = texture.clone();
      t.repeat.set(repeatX, repeatY);
      t.needsUpdate = true;
      return t;
    };

    const Material = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const mat = new Material({
      map: clone(set.map),
      normalMap: clone(set.normalMap),
      roughnessMap: clone(set.ormMap),
      metalnessMap: clone(set.ormMap),
      aoMap: clone(set.ormMap),
      roughness: 1,
      metalness: 1,
      ...params,
    });

    // ORM は AO が R、ラフネスが G、メタルネスが B。three.js は
    // それぞれのスロットで対応するチャンネルだけを読むので 1 枚を使い回せる。
    mat.aoMap.channel = 0;
    return mat;
  }

  return { sets, foliage, foliageDark, material, anisotropy: aniso };
}
