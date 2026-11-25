import * as THREE from 'three';

/**
 * 夜の灯りの見せ方（本物の光源を使わない、軽い作り）。
 *
 * - 光ぼけ：電球の位置に、あたたかい色のぼけた円を加算で重ねる（THREE.Points。電球が何十個あっても描画命令は 1 回）。
 *   電球の玉だけだと、夜でも「黄色い粒」に見えて、灯っている感じが出ない
 * - 光だまり：灯りの下の地面に、あたたかい色の円を加算で重ねる。本物の光源は Quest 単体では重く、数も限られる
 *
 * どちらも、夜の濃さ（0..1）で出す。昼は消す。
 */

let glowTexture = null;
/** 中心が明るく、まわりへ消える円（光ぼけと光だまりで共用） */
function glowMap() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/**
 * 電球の光ぼけ。positions は電球の位置（parent のローカル）。parent に足すので、回る遊具といっしょに回る
 * @param {THREE.Object3D} parent
 * @param {THREE.Vector3[]} positions
 * @param {{ color?: number, size?: number }} [options] size は光ぼけの直径（m）
 */
export function addBulbGlow(parent, positions, { color = 0xffc878, size = 0.5 } = {}) {
  const geometry = new THREE.BufferGeometry().setFromPoints(positions);
  const material = new THREE.PointsMaterial({
    map: glowMap(), color, size, sizeAttenuation: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'bulbGlow';
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.visible = false;
  parent.add(points);
  return {
    points,
    /** 夜の濃さ（0..1）と、またたき（0..1、1 = いちばん明るい） */
    set(level, flicker = 1) {
      material.opacity = level * (0.55 + 0.45 * flicker);
      points.visible = level > 0.01;
    },
  };
}

/**
 * 地面の光だまり（だ円）。x・z は中心（parent のローカル）、y は地面の高さ
 * @param {THREE.Object3D} parent
 * @param {{ x:number, y?:number, z:number, rx:number, rz?:number, color?:number, strength?:number }} options
 */
export function addLightPool(parent, { x, y = 0.02, z, rx, rz = rx, color = 0xffb46a, strength = 0.6 }) {
  const material = new THREE.MeshBasicMaterial({
    map: glowMap(), color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 3;
  mesh.visible = false;
  parent.add(mesh);
  return {
    mesh,
    set(level, flicker = 1) {
      material.opacity = level * strength * (0.75 + 0.25 * flicker);
      mesh.visible = level > 0.01;
    },
  };
}
