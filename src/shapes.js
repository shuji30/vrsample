import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * 角を丸めた部品（売り物の水準 A7）。
 *
 * 素の BoxGeometry は角が鋭く、光が当たっても縁が光らないので、柵やベンチが紙を切り抜いた板に見える。
 * 本物の木や金属の部材は面取りしてあり、縁に細い照り返しが出る。半径 1〜1.5cm の丸みで十分に効く。
 * 同じ寸法の形は使い回す（柵の柱はみな同じ形なので、形は 1 つで足りる）。
 */
const cache = new Map();

/** 角を丸めた箱。r は丸みの半径（m）。いちばん薄い辺の半分より大きくはしない */
export function roundedBox(w, h, d, r = 0.012, segments = 2) {
  const radius = Math.min(r, Math.min(w, h, d) / 2 - 1e-4);
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${radius.toFixed(4)}|${segments}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, segments, radius);
    cache.set(key, geometry);
  }
  return geometry;
}

/**
 * 角柱の頭にのせる四角錐の笠（雨を切る形）。柱の太さ w に合わせる。y は柱の上端に置く高さの中心
 */
export function postCap(w, height = w * 0.45) {
  const key = `cap|${w.toFixed(4)}|${height.toFixed(4)}`;
  let geometry = cache.get(key);
  if (!geometry) {
    // 4 角の円錐を 45° 回すと、角柱の面にそろう。底の外接円の半径は w/√2
    geometry = new THREE.ConeGeometry(w / Math.SQRT2 * 1.04, height, 4, 1);
    geometry.rotateY(Math.PI / 4);
    geometry.translate(0, height / 2, 0);
    cache.set(key, geometry);
  }
  return geometry;
}
