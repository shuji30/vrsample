import * as THREE from 'three';

/**
 * 丘の地図（ROADMAP 10）。北 = 海の側 = -Z が上。PC・スマホは画面の地図（「🗺 マップ」・N キー）、VR はメニュー（左手の Y）の「マップ」。
 * 地図の上の場所の札か、地面を選ぶと、そこへ移る（world.mapTravel。暗くしてから移す）。
 *
 * 地図の絵は、シーンを真上から正射影で 1 回だけ描いて作る（物を足しても地図を描き直さなくてよい）。
 * 丘の上と崖の下の砂浜のあいだ（崖の斜面）は何も無いので、2 つの帯に分けて詰めて並べる。
 * 夜に描くと暗いので、明るさは平均から合わせる。
 */

/** 地図の帯（ワールドの範囲）。上から順に並べる */
export const MAP_BANDS = [
  { key: 'beach', minX: -42, maxX: 42, minZ: -116, maxZ: -73 },
  { key: 'hill', minX: -42, maxX: 42, minZ: -44, maxZ: 38 },
];
/** 帯のあいだのすき間（m ぶん） */
const GAP = 3;
const WIDTH_M = MAP_BANDS[0].maxX - MAP_BANDS[0].minX;
const HEIGHT_M = MAP_BANDS.reduce((s, b) => s + (b.maxZ - b.minZ), 0) + GAP * (MAP_BANDS.length - 1);
/** 地図の縦横比（幅 / 高さ） */
export const MAP_ASPECT = WIDTH_M / HEIGHT_M;

/** 帯ごとの、地図の上の縦の始まり（m） */
const bandTop = [];
{
  let top = 0;
  for (const b of MAP_BANDS) { bandTop.push(top); top += b.maxZ - b.minZ + GAP; }
}

/** ワールドの (x, z) → 地図の (u, v)（0〜1。v は上から）。帯の外なら null */
export function toMap(x, z) {
  for (let i = 0; i < MAP_BANDS.length; i++) {
    const b = MAP_BANDS[i];
    if (z < b.minZ - 2 || z > b.maxZ + 2) continue;
    const zz = Math.min(Math.max(z, b.minZ), b.maxZ);
    const xx = Math.min(Math.max(x, b.minX), b.maxX);
    return { u: (xx - b.minX) / WIDTH_M, v: (bandTop[i] + zz - b.minZ) / HEIGHT_M };
  }
  return null;
}

/** 地図の (u, v) → ワールドの (x, z)。すき間なら null */
export function toWorld(u, v) {
  const m = v * HEIGHT_M;
  for (let i = 0; i < MAP_BANDS.length; i++) {
    const b = MAP_BANDS[i];
    const local = m - bandTop[i];
    if (local < 0 || local > b.maxZ - b.minZ) continue;
    return { x: b.minX + u * WIDTH_M, z: b.minZ + local, band: b.key };
  }
  return null;
}

/**
 * 行き先の札。x, z は立つ所、look は着いたときに見る向き。
 * travel があるものは看板と同じ行き来（world.js の travel）で行く（地図の外の飛行場）。
 * 札の位置（地図の上）は、立つ所からずらしたいときだけ lx, lz で
 */
export const PLACES = [
  // 家と庭
  { key: 'home', label: '家', x: 1.38, z: 0.35, look: { x: 1, z: 0 }, lx: 0, lz: 1.5 },
  { key: 'billiard', label: 'ビリヤード', x: 4.0, z: 0.45, look: { x: 1, z: 0 }, lx: 6.5, lz: 5.5 },
  { key: 'garden', label: '庭', x: 0.5, z: -5.5, look: { x: 0, z: -1 }, lz: -8 },
  { key: 'tennis', label: 'テニス', x: 3.0, z: -14.6, look: { x: -1, z: 0 }, lx: 0, lz: -22 },
  // 公園
  { key: 'kart', label: 'カート', x: 11.71, z: -9.34, look: { x: -0.44, z: 0.9 }, lx: 16, lz: -20 },
  { key: 'bike', label: 'ポケバイ', x: -8.91, z: -16.62, look: { x: 0.84, z: 0.54 }, lx: -11, lz: -22 },
  { key: 'seesaw', label: 'シーソー', x: -8.3, z: -8.65, look: { x: 0.22, z: -0.98 }, lx: -6.5, lz: -10.5 },
  { key: 'buranko', label: 'ブランコ', x: -12.52, z: -7.9, look: { x: -0.18, z: -0.98 }, lx: -14, lz: -6.5 },
  { key: 'fishing', label: '釣り', x: -24.1, z: -9.65, look: { x: 0, z: -1 }, lz: -12 },
  { key: 'horse', label: '乗馬', x: -25.0, z: -19.2, look: { x: 0, z: -1 }, lz: -22 },
  { key: 'carousel', label: 'メリーゴーランド', x: -7.6, z: 0.5, look: { x: -1, z: 0 }, lx: -13, lz: 1 },
  { key: 'ferris', label: '観覧車', x: -21.4, z: 4.4, look: { x: -1, z: 0 }, lx: -24, lz: 4 },
  { key: 'golf', label: 'パットゴルフ', x: -34.95, z: 16.8, look: { x: 0, z: 1 }, lx: -26, lz: 26 },
  { key: 'coaster', label: 'コースター', x: 10.7, z: 9.2, look: { x: 0, z: 1 }, lx: 10, lz: 12.5 },
  { key: 'gt3', label: 'GT3', x: 14.5, z: 1.2, look: { x: 0, z: -1 }, lz: -0.6 },
  { key: 'f40', label: 'Lexus', x: 21.6, z: 1.6, look: { x: 0, z: 1 }, lz: 3.4 },
  { key: 'stairs', label: '崖の階段', x: -18.8, z: -37.8, look: { x: 0, z: -1 } },
  { key: 'airfield', label: '✈ 飛行場へ', travel: 'airfield', x: -3.0, z: 5.5, lx: 30, lz: 35 },
  // 崖の下の砂浜
  { key: 'beach', label: '砂浜', x: -18.6, z: -80.2, look: { x: 0, z: -1 }, lx: -22, lz: -77 },
  { key: 'volley', label: 'ビーチバレー', x: -14.5, z: -82.3, look: { x: 1, z: 0 }, lx: -11, lz: -84 },
  { key: 'parasol', label: 'パラソル', x: 5.64, z: -82.03, look: { x: 0, z: 1 }, lx: 6, lz: -80.5 },
  { key: 'dive', label: 'ダイビング', x: -36.0, z: -81.6, look: { x: 0, z: -1 }, lx: -34, lz: -84 },
  { key: 'jetski', label: 'ジェットスキー', x: 27.7, z: -104.6, look: { x: -0.89, z: -0.46 }, lx: 20, lz: -104 },
  { key: 'cruiser', label: 'クルーザー', x: 28.0, z: -113.3, look: { x: 0, z: -1 }, lx: 28, lz: -112.5 },
];

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {THREE.Scene} options.scene
 */
export function createMapImage({ renderer, scene }) {
  /** 真上からの絵（幅 PX）。最初に使うときに描く */
  const PX = 1024;
  let base = null;

  function bake() {
    const k = PX / WIDTH_M;
    const canvas = document.createElement('canvas');
    canvas.width = PX;
    canvas.height = Math.round(HEIGHT_M * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b2a22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // VR の最中でも別の描き先へ描けるように、VR と影の更新を止める（gt3.js のミラーと同じ）
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevTarget = renderer.getRenderTarget();
    const prevFog = scene.fog;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    scene.fog = null;
    const pixels = [];
    try {
      for (let i = 0; i < MAP_BANDS.length; i++) {
        const b = MAP_BANDS[i];
        const w = PX;
        const h = Math.round((b.maxZ - b.minZ) * k);
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const hw = (b.maxX - b.minX) / 2;
        const hh = (b.maxZ - b.minZ) / 2;
        const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 600);
        cam.position.set(cx, 300, cz);
        cam.up.set(0, 0, -1);
        cam.lookAt(cx, 0, cz);
        cam.updateMatrixWorld(true);
        const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        const px = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
        rt.dispose();
        pixels.push({ px, w, h, top: Math.round(bandTop[i] * k) });
      }
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.xr.enabled = prevXr;
      renderer.shadowMap.autoUpdate = prevShadow;
      scene.fog = prevFog;
    }

    // 明るさをそろえる（夜に描いても昼と同じくらいに）。平均の明るさを 0.42 に
    let sum = 0;
    let n = 0;
    for (const { px } of pixels) {
      for (let j = 0; j < px.length; j += 64) { sum += 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]; n++; }
    }
    const mean = sum / Math.max(1, n) / 255;
    const gain = Math.min(4, Math.max(1, 0.42 / Math.max(0.02, mean)));
    for (const { px, w, h, top } of pixels) {
      const img = ctx.createImageData(w, h);
      // 描き先は下から上へ並んでいるので、上下を返して写す
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        const dst = y * w * 4;
        for (let x = 0; x < w * 4; x += 4) {
          img.data[dst + x] = Math.min(255, px[src + x] * gain);
          img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * gain);
          img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * gain);
          img.data[dst + x + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, top);
    }
    // 帯のあいだ（崖）に、階段の印
    ctx.fillStyle = 'rgba(8, 12, 24, 0.85)';
    for (let i = 1; i < MAP_BANDS.length; i++) {
      const y0 = Math.round((bandTop[i] - GAP) * k);
      ctx.fillRect(0, y0, canvas.width, Math.round(GAP * k));
      ctx.fillStyle = '#c9d6ea';
      ctx.font = `bold ${Math.round(GAP * k * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('↑ 崖の下の砂浜（階段か看板で）', canvas.width - 12, y0 + GAP * k / 2);
      ctx.fillStyle = 'rgba(8, 12, 24, 0.85)';
    }
    return canvas;
  }

  return {
    /** 真上からの絵（canvas）。最初に呼んだときに描く */
    get canvas() { return (base ??= bake()); },
    get baked() { return Boolean(base); },
    /** 描き直す（時間帯を替えたあとなど。ふだんは要らない） */
    rebake() { base = null; },
  };
}

/**
 * 地図を ctx の (x, y, w, h) に描く（縦横比は MAP_ASPECT に合わせて中に収める）。
 * 選べる場所の札の当たり（地図の u, v の箱）を返す
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} image createMapImage の canvas
 * @param {{ player?: { x: number, z: number, yaw?: number }, girl?: { x: number, z: number }, places?: object[], scale?: number, hover?: string }} marks
 */
export function drawMap(ctx, image, x, y, w, h, marks = {}) {
  const fit = Math.min(w / MAP_ASPECT, h);
  const mw = fit * MAP_ASPECT;
  const mh = fit;
  const ox = x + (w - mw) / 2;
  const oy = y + (h - mh) / 2;
  ctx.save();
  ctx.drawImage(image, ox, oy, mw, mh);
  ctx.strokeStyle = 'rgba(143, 220, 255, 0.5)';
  ctx.lineWidth = Math.max(1, mw / 400);
  ctx.strokeRect(ox, oy, mw, mh);
  const s = marks.scale ?? mw / 512;
  const at = (wx, wz) => {
    const p = toMap(wx, wz);
    return p ? [ox + p.u * mw, oy + p.v * mh] : null;
  };

  // 場所の札
  const boxes = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(13 * s)}px system-ui, sans-serif`;
  for (const place of marks.places ?? PLACES) {
    const p = at(place.lx ?? place.x, place.lz ?? place.z);
    if (!p) continue;
    const tw = ctx.measureText(place.label).width + 12 * s;
    const th = 20 * s;
    const bx = Math.min(Math.max(p[0] - tw / 2, ox + 2), ox + mw - tw - 2);
    const by = Math.min(Math.max(p[1] - th / 2, oy + 2), oy + mh - th - 2);
    const hover = marks.hover === place.key;
    ctx.fillStyle = hover ? 'rgba(255, 214, 120, 0.96)' : 'rgba(10, 16, 34, 0.78)';
    roundRect(ctx, bx, by, tw, th, th / 2);
    ctx.fill();
    ctx.strokeStyle = hover ? '#fff' : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();
    ctx.fillStyle = hover ? '#1a1206' : '#f2f6ff';
    ctx.fillText(place.label, bx + tw / 2, by + th / 2 + 0.5);
    boxes.push({ key: place.key, place, u0: (bx - ox) / mw, v0: (by - oy) / mh, u1: (bx + tw - ox) / mw, v1: (by + th - oy) / mh });
  }

  // 女の子（ピンク）と自分（青い矢印）
  if (marks.girl) {
    const p = at(marks.girl.x, marks.girl.z);
    if (p) {
      ctx.fillStyle = '#ff7fb8';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (marks.player) {
    const p = at(marks.player.x, marks.player.z);
    if (p) {
      ctx.translate(p[0], p[1]);
      // yaw：-Z を向いて 0、左回りが正（three.js の rotation.y と同じ）。地図は -Z が上
      ctx.rotate(-(marks.player.yaw ?? 0));
      ctx.fillStyle = '#3aa0ff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(0, -11 * s);
      ctx.lineTo(8 * s, 8 * s);
      ctx.lineTo(0, 4 * s);
      ctx.lineTo(-8 * s, 8 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
  return { boxes, ox, oy, mw, mh };
}

/**
 * 地図の上の点（描いた範囲の中の u, v）で、何を選んだか。札なら { place }、地面なら { x, z }、何もなければ null
 */
export function pickMap(layout, u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  // 札は少し広めに当てる（VR のレーザー・指で押しやすく）
  const pad = 0.006;
  for (let i = layout.boxes.length - 1; i >= 0; i--) {
    const b = layout.boxes[i];
    if (u >= b.u0 - pad && u <= b.u1 + pad && v >= b.v0 - pad && v <= b.v1 + pad) return { place: b.place };
  }
  const p = toWorld(u, v);
  return p ? { x: p.x, z: p.z } : null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * PC・スマホの画面の地図。「🗺 マップ」か N キーで開け閉め、Esc・× で閉じる。
 * 札か地面を押すと onPick({ place } | { x, z }) を呼ぶ。onPick が文字列を返したら（移れないわけ）、それを出して閉じない
 * @param {object} options
 * @param {{ canvas: HTMLCanvasElement }} options.image createMapImage の戻り値
 * @param {() => object} options.marks drawMap に渡す印（player・girl）
 * @param {(pick: object) => (string | true | false)} options.onPick
 */
export function createMapScreen({ image, marks, onPick }) {
  const root = document.createElement('div');
  root.id = 'map-screen';
  root.hidden = true;
  root.innerHTML = `<div class="map-box">
    <div class="map-head"><b>マップ</b><span class="map-note">場所の札か地面を押すと、そこへ移ります</span><button type="button" class="map-close" aria-label="閉じる" title="閉じる（N・Esc）">×</button></div>
    <canvas></canvas>
  </div>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas');
  const note = root.querySelector('.map-note');
  const NOTE = note.textContent;
  const ctx = canvas.getContext('2d');
  let layout = null;
  let hover = null;
  let redrawIn = 0;

  const button = document.createElement('button');
  button.id = 'map-open';
  button.type = 'button';
  button.title = 'マップ（N キー）';
  button.textContent = '🗺 マップ';
  document.body.appendChild(button);
  button.addEventListener('click', () => toggle());
  root.querySelector('.map-close').addEventListener('click', () => close());
  // 地図の外（暗い所）を押したら閉じる
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxW = Math.min(window.innerWidth - 32, 900);
    const maxH = window.innerHeight - 90;
    const h = Math.max(200, Math.min(maxH, maxW / MAP_ASPECT));
    const w = h * MAP_ASPECT;
    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  function draw() {
    if (root.hidden) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.max(0.9, Math.min(1.6, canvas.width / 520));
    layout = drawMap(ctx, image.canvas, 0, 0, canvas.width, canvas.height, { ...marks(), hover, scale: s });
  }
  function uvOf(e) {
    if (!layout) return null;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (canvas.width / r.width);
    const py = (e.clientY - r.top) * (canvas.height / r.height);
    return { u: (px - layout.ox) / layout.mw, v: (py - layout.oy) / layout.mh };
  }
  canvas.addEventListener('pointermove', (e) => {
    const uv = uvOf(e);
    const hit = uv ? pickMap(layout, uv.u, uv.v) : null;
    const key = hit?.place?.key ?? null;
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (key !== hover) { hover = key; draw(); }
  });
  canvas.addEventListener('click', (e) => {
    const uv = uvOf(e);
    const hit = uv ? pickMap(layout, uv.u, uv.v) : null;
    if (!hit) return;
    const result = onPick(hit);
    if (typeof result === 'string') { note.textContent = result; note.classList.add('warn'); return; }
    if (result) close();
  });

  function open() {
    note.textContent = NOTE;
    note.classList.remove('warn');
    root.hidden = false;
    button.classList.add('on');
    size();
    draw();
  }
  function close() {
    root.hidden = true;
    button.classList.remove('on');
    hover = null;
  }
  function toggle() { if (root.hidden) open(); else close(); }
  window.addEventListener('resize', () => { if (!root.hidden) { size(); draw(); } });

  return {
    get open() { return !root.hidden; },
    toggle,
    close,
    show: open,
    /** 毎フレーム：開いているあいだは、自分と女の子の印を 0.2 秒ごとに描き直す */
    update(dt) {
      if (root.hidden) return;
      redrawIn -= dt;
      if (redrawIn > 0) return;
      redrawIn = 0.2;
      draw();
    },
  };
}
