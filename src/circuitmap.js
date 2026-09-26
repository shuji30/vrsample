import { CIRCUIT, CIRCUIT_LENGTH, circuitFrame, circuitElevation } from './circuit.js';

/**
 * サーキットの地図（上から見た形。北 = 海の側 = -Z が上）。GT3 の車内の画面と、PC の右上の表示に使う。
 *
 * コースの形は一度だけ別の canvas に描いておき、毎回はそれを写して、車の点だけ描き足す。
 * 8 の字の交差は、低い所から順に（縁取り → 路面）描くので、橋の側が上に重なって見える。
 */
const STEP = 4;   // コースをたどる間隔（m）

export function createCircuitMap() {
  // コースの点（ワールドの x, z と高さ）
  const pts = [];
  for (let s = 0; s < CIRCUIT_LENGTH; s += STEP) {
    const fr = circuitFrame(s);
    pts.push({ x: fr.p.x, z: fr.p.z, h: circuitElevation(s) });
  }
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }

  const cache = new Map();   // `${w}x${h}` → { canvas, fit }
  function fitFor(w, h) {
    const pad = Math.min(w, h) * 0.08;
    const k = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * k) / 2;
    const oz = (h - (maxZ - minZ) * k) / 2;
    return { k, map: (x, z) => [ox + (x - minX) * k, oz + (z - minZ) * k] };
  }
  function base(w, h) {
    const key = `${w}x${h}`;
    if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    const fit = fitFor(w, h);
    // 実際の幅だと細すぎて（車内の画面では特に）見えないので、太めに描く
    const road = Math.max(5, w * 0.03);
    // 地面の区間と橋の区間に分けて、それぞれ縁取り → 路面の順に描く（交差では橋が上）。
    // 区間ごとに縁取りと路面を交互に描くと、次の区間の縁取りが前の路面を塗りつぶしてしまう
    const segs = pts.map((p, i) => ({ a: p, b: pts[(i + 1) % pts.length], h: (p.h + pts[(i + 1) % pts.length].h) / 2 }));
    const line = (list, color, width) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      for (const sg of list) {
        const [ax, ay] = fit.map(sg.a.x, sg.a.z);
        const [bx, by] = fit.map(sg.b.x, sg.b.z);
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
      }
      c.stroke();
    };
    for (const layer of [segs.filter((sg) => sg.h <= 1), segs.filter((sg) => sg.h > 1)]) {
      line(layer, '#0b0e16', road + 4);
      line(layer, '#c9d0dc', road);
    }
    // スタートの線
    const st = circuitFrame(CIRCUIT.startAt);
    const [sx, sy] = fit.map(st.p.x, st.p.z);
    const nx = st.n.x;
    const nz = st.n.z;
    c.strokeStyle = '#ff4040';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(sx - nx * road, sy - nz * road);
    c.lineTo(sx + nx * road, sy + nz * road);
    c.stroke();
    const entry = { canvas, fit };
    cache.set(key, entry);
    return entry;
  }

  /**
   * ctx の (x, y, w, h) に地図を描く。cars は [{ s（コース上の位置 m）, color, me? }]。
   * 自分（me）は大きめの丸に白い縁、ほかは小さな丸
   */
  function draw(ctx, x, y, w, h, cars = []) {
    const { canvas, fit } = base(w, h);
    ctx.drawImage(canvas, x, y);
    // 自分を最後に（上に）描く
    const list = [...cars].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));
    for (const car of list) {
      const fr = circuitFrame(car.s);
      const [px, py] = fit.map(fr.p.x, fr.p.z);
      const r = car.me ? Math.max(4, w * 0.035) : Math.max(3, w * 0.026);
      ctx.fillStyle = car.color;
      ctx.strokeStyle = car.me ? '#ffffff' : '#0b0e16';
      ctx.lineWidth = car.me ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(x + px, y + py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  return { draw };
}
