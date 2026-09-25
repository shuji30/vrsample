import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';

/**
 * 夜の花火。テーマが夜のあいだ、丘の北の沖の海（テニスコートのずっと向こう）から打ち上げる。
 * 庭からも家の窓からも、コートの向こうの海の上の空に見える。
 *
 * 1 発ごとに、火の玉が海から昇って、丘の上から 28〜45m の高さで開く。開くと 110〜160 個の火の粉が
 * 丸く（半径 22m ほど。丘から 110m 以上離れているので大きめ）広がり、重力と空気の抵抗で垂れながら消える。種類は 3 つ（牡丹・柳・二重の輪）。
 * 火の粉はすべて 1 つの Points にまとめ、毎フレーム CPU で動かす（VR の 2 回描きでも軽い）。
 *
 * 花火は霧を受けない（fog: false。遠くても明るく見えるように）。
 * 音は、開いた所からの距離ぶん遅れて（音速 343m/s）、ドン・バン・ゴロゴロと鳴る（柳と二重の輪はパチパチも）。
 */

const MAX = 4000;
const GRAVITY = -6.0;
const COLORS = [0xff5a5a, 0xffc94a, 0x6fe36f, 0x6fb8ff, 0xd78bff, 0xffffff];

function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 花火の音。開いたところから、距離ぶん遅れて鳴る。
 *   ドン：低い正弦波を 90Hz から 35Hz へ下げる（胸に響く音）
 *   バン：雑音を 1.2kHz より下で鳴らす破裂音
 *   ゴロゴロ：低い雑音を 2 秒ほど残す（遠くの山にこだまする感じ）
 *   パチパチ：柳・二重の輪のあとに、小さなはじける音を散らす
 * 以前は雑音を 260Hz より下だけ残した「ドン」ひとつで、元の音のエネルギーがほとんど削れ、
 * 70m 先の距離でさらに小さくしていたので、ほとんど聞こえなかった。
 */
function createBoom() {
  let context = null;
  let noise = null;
  let out = null;
  function ensure() {
    if (context) return context;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { context = new AudioContextClass(); } catch { return null; }
    noise = context.createBuffer(1, context.sampleRate * 2.5, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // 重なって割れないように、まとめて圧縮してから出す
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    out = context.createGain();
    out.gain.value = 1;
    out.connect(comp).connect(context.destination);
    return context;
  }
  function envelope(gain, at, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }
  function noiseBurst(at, { type = 'lowpass', freq, q = 0.7, peak, attack = 0.004, decay, offset = 0 }) {
    const src = context.createBufferSource();
    src.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = context.createGain();
    envelope(gain, at, peak, attack, decay);
    src.connect(filter).connect(gain).connect(out);
    src.start(at, offset);
    src.stop(at + attack + decay + 0.05);
  }
  return {
    /** delay 秒あとに鳴らす。volume は 0〜1、crackle でパチパチも */
    play(delay, volume, crackle = false) {
      if (!ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      const at = context.currentTime + delay;
      // ドン
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, at);
      osc.frequency.exponentialRampToValueAtTime(35, at + 0.6);
      const g = context.createGain();
      envelope(g, at, volume, 0.006, 0.9);
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + 1.0);
      // バン
      noiseBurst(at, { freq: 1200, peak: volume * 0.8, decay: 0.45, offset: Math.random() });
      // ゴロゴロ
      noiseBurst(at + 0.05, { freq: 160, peak: volume * 0.9, attack: 0.08, decay: 2.2, offset: Math.random() });
      // パチパチ
      if (crackle) {
        for (let i = 0; i < 26; i++) {
          noiseBurst(at + 0.5 + Math.random() * 1.6, { type: 'bandpass', freq: 2500 + Math.random() * 3000, q: 2, peak: volume * (0.12 + Math.random() * 0.2), attack: 0.002, decay: 0.03, offset: Math.random() * 2 });
        }
      }
    },
  };
}

export function createFireworks({ scene, onBurst = null } = {}) {
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    size: 1.8, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'fireworks';
  points.visible = false;
  scene.add(points);

  // 火の粉と火の玉（どちらも同じ粒の入れ物）
  const parts = [];      // { p: Vector3, v: Vector3, color: Color, life, age, drag, kind }
  const boom = createBoom();
  let active = false;
  let nextLaunch = 1.0;
  const listener = new THREE.Vector3();

  function launch() {
    // 丘の北の沖の海から打ち上げる（海岸は z -90 あたり）。開く高さは丘の上から見て 28〜45m
    const from = new THREE.Vector3(THREE.MathUtils.randFloat(-30, 30), SEA_LEVEL, THREE.MathUtils.randFloat(-135, -105));
    const height = THREE.MathUtils.randFloat(28, 45) - SEA_LEVEL;
    // 昇る速さ：その高さでちょうど止まる（v² = 2gh）
    const v = new THREE.Vector3(THREE.MathUtils.randFloat(-1, 1), Math.sqrt(-2 * GRAVITY * height), THREE.MathUtils.randFloat(-1, 1));
    parts.push({ p: from, v, color: new THREE.Color(0xffd9a0), life: v.y / -GRAVITY, age: 0, drag: 0, kind: 'rocket', burst: pickBurst() });
  }
  function pickBurst() {
    const r = Math.random();
    const color = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const color2 = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
    return r < 0.5 ? { type: 'peony', color, color2 } : r < 0.8 ? { type: 'willow', color: new THREE.Color(0xffc66b), color2 } : { type: 'ring', color, color2 };
  }
  function burst(at, b) {
    const n = b.type === 'willow' ? 110 : b.type === 'ring' ? 160 : 130;
    for (let i = 0; i < n; i++) {
      // 球の上にむらなく（黄金角）
      const t = (i + 0.5) / n;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      // 開く大きさ（半径）はおよそ 速さ / 抵抗。牡丹で 22m ほど
      let speed = b.type === 'willow' ? 16 : 23;
      let color = b.color;
      if (b.type === 'ring' && i % 2) { speed *= 0.55; color = b.color2; }
      parts.push({
        p: at.clone(), v: dir.multiplyScalar(speed * THREE.MathUtils.randFloat(0.9, 1.1)), color: color.clone(),
        life: b.type === 'willow' ? 3.4 : 2.4, age: 0, drag: b.type === 'willow' ? 1.3 : 1.05, kind: 'spark',
      });
    }
    onBurst?.(at, b);
  }

  function update(dt, camera) {
    if (active) {
      nextLaunch -= dt;
      if (nextLaunch <= 0) {
        launch();
        if (Math.random() < 0.25) launch();   // たまに 2 発いっしょに
        nextLaunch = THREE.MathUtils.randFloat(1.2, 2.8);
      }
    }
    camera?.getWorldPosition(listener);
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt;
      q.v.y += GRAVITY * dt;
      if (q.drag) q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      // 消えた粒は、最後の粒と入れ替えて抜く（並びは気にしない。splice だと重い）
      const remove = () => { parts[i] = parts[parts.length - 1]; parts.pop(); };
      if (q.kind === 'rocket' && q.age >= q.life) {
        remove();
        burst(q.p, q.burst);
        const distance = listener.distanceTo(q.p);
        // 遠いほど小さく。ただし 0.35 より小さくしない（庭から 70m 先でも、ちゃんと聞こえるように）
        boom.play(distance / 343, THREE.MathUtils.clamp(30 / distance, 0.35, 0.9), q.burst.type !== 'peony');
        continue;
      }
      if (q.age >= q.life) remove();
    }
    if (parts.length > MAX) parts.splice(0, parts.length - MAX);
    // 入れ物へ書く。火の粉は終わりに近いほど暗く（加算なので暗い＝消える）、ちらつかせる
    let n = 0;
    for (const q of parts) {
      positions[n * 3] = q.p.x;
      positions[n * 3 + 1] = q.p.y;
      positions[n * 3 + 2] = q.p.z;
      const fade = q.kind === 'rocket' ? 0.9 : 1.5 * Math.max(0, 1 - q.age / q.life) ** 1.5 * (0.75 + Math.random() * 0.25);
      colors[n * 3] = q.color.r * fade;
      colors[n * 3 + 1] = q.color.g * fade;
      colors[n * 3 + 2] = q.color.b * fade;
      n++;
    }
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    points.visible = n > 0;
  }

  return {
    update,
    /** 打ち上げを始める / やめる（上がっている分は最後まで見せる） */
    set active(v) {
      if (v && !active) nextLaunch = 1.0;
      active = Boolean(v);
    },
    get active() { return active; },
    /** 検証用：すぐに 1 発 */
    debugLaunch() { launch(); },
    get count() { return parts.length; },
  };
}
