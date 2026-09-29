import * as THREE from 'three';

/**
 * 背骨に沿って曲がる体（イルカ・クジラ）。
 *
 * 体は、鼻先 t=0 → 尾の先 t=1 の輪切り（rings + 1 本）を並べた 1 つの形。頂点ごとに何本目の輪か（ringOf）を持ち、
 * 位置の y は背骨（y=0）からの高さ、z は体の前後（前が +Z、鼻先が +length/2）。
 * bend(arch, amp, phase) で、毎フレーム上下に曲げる（横は曲げない）。
 *   - arch：弓なり。鼻先から尾までで向きが変わる角度。+ で背を上へ丸める（∩）。頭（鼻先から headRigid）は曲げない
 *   - amp：泳ぐ波。尾の先の振れの角度。waveStart より後ろで、尾へ向かって大きくなり、頭から尾へ伝わる
 * 背骨の角度は、曲げの中心（center）から前後へ積分する（鼻先から積分すると、尾を振るたびに体全体が上下に揺れる）。
 * 頂点の高さは、背骨に直角な上の向き（cos θ, -sin θ）へ（y だけずらすと、曲げた所で体が細く・太くなる）。
 * ひれ・目などは anchor(t) の台に載せる。台は背骨といっしょに動いて傾く（gain で傾きを強める。尾びれ）
 */
export function createSpine(geometry, ringOf, { rings, length, center = 0.42, headRigid = 0.12, waveStart = 0.3, waveK = 4.5 }) {
  const rest = geometry.attributes.position.array.slice();
  const posArr = geometry.attributes.position.array;
  const th = new Float32Array(rings + 1);
  const py = new Float32Array(rings + 1);
  const pz = new Float32Array(rings + 1);
  const ds = length / rings;
  const rc = Math.round(center * rings);
  const zAt = (t) => length / 2 - t * length;
  const anchors = [];
  // 曲げても外に出ないくらいの球（毎フレーム計り直さない。視野外判定で消えないように）
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), length * 0.75);

  function anchor(t, gain = 1) {
    const a = new THREE.Group();
    a.position.z = zAt(t);
    a.userData.t = t;
    a.userData.gain = gain;
    anchors.push(a);
    return a;
  }

  function bend(arch, amp, phase) {
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      let a = (arch * (Math.max(t, headRigid) - center)) / (1 - headRigid);
      const w = THREE.MathUtils.smoothstep(t, waveStart, 1);
      a += amp * w * w * Math.sin(phase - (t - waveStart) * waveK);
      th[r] = a;
    }
    py[rc] = 0;
    pz[rc] = zAt(rc / rings);
    for (let r = rc + 1; r <= rings; r++) {
      const m = (th[r - 1] + th[r]) / 2;
      py[r] = py[r - 1] - Math.sin(m) * ds;
      pz[r] = pz[r - 1] - Math.cos(m) * ds;
    }
    for (let r = rc - 1; r >= 0; r--) {
      const m = (th[r] + th[r + 1]) / 2;
      py[r] = py[r + 1] + Math.sin(m) * ds;
      pz[r] = pz[r + 1] + Math.cos(m) * ds;
    }
    for (let i = 0, n = ringOf.length; i < n; i++) {
      const r = ringOf[i];
      const yo = rest[i * 3 + 1];
      const c = Math.cos(th[r]);
      const s = Math.sin(th[r]);
      posArr[i * 3] = rest[i * 3];
      posArr[i * 3 + 1] = py[r] + yo * c;
      posArr[i * 3 + 2] = pz[r] - yo * s;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    for (const an of anchors) {
      const k = an.userData.t * rings;
      const r0 = Math.min(rings - 1, Math.floor(k));
      const f = k - r0;
      an.position.set(0, py[r0] + (py[r0 + 1] - py[r0]) * f, pz[r0] + (pz[r0 + 1] - pz[r0]) * f);
      an.rotation.x = -(th[r0] + (th[r0 + 1] - th[r0]) * f) * an.userData.gain;
    }
  }

  return {
    anchor,
    bend,
    /** 背骨の t の所の点（体のローカル。bend のあと） */
    pointAt(t, out = new THREE.Vector3()) {
      const k = t * rings;
      const r0 = Math.min(rings - 1, Math.floor(k));
      const f = k - r0;
      return out.set(0, py[r0] + (py[r0 + 1] - py[r0]) * f, pz[r0] + (pz[r0 + 1] - pz[r0]) * f);
    },
    /** 背骨の t の所の角度（+ で後ろが下がる） */
    angleAt(t) {
      const k = t * rings;
      const r0 = Math.min(rings - 1, Math.floor(k));
      return th[r0] + (th[r0 + 1] - th[r0]) * (k - r0);
    },
  };
}
