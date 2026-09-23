import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** PC で歩く速さ（m/s）。VR のスティック移動と同じにして感覚を揃える */
const WALK_SPEED = 2.2;
/** Shift を押しているあいだの倍率 */
const DASH = 2.0;

/**
 * ヘッドセットがない環境（PC / スマホ）向けの操作。
 * ドラッグで視点回転、ホイールでズーム、WASD / 矢印キーで歩く、
 * クリックでオブジェクトを跳ねさせる。
 *
 * 歩けるようにしたのは、掃き出し窓から庭へ出られるようになったのに、
 * PC では部屋の中心を周回することしかできず、外へ出る手段が無かったため。
 */
export function createDesktopControls(renderer, camera, world) {
  // 入った瞬間にテーブルと、その奥の窓ごしの公園が見える位置
  camera.position.set(0.85, 1.62, 1.75);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.10, -2.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.8;
  controls.maxDistance = 6.5;   // 見回すぶんにはこれで足りる。遠出は歩いて行く
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.495; // 床より下に潜らない
  controls.update();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  renderer.domElement.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (renderer.xr.isPresenting) return;
    // ドラッグ（視点回転）はクリック扱いにしない
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return;

    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObjects(world.interactables, false)[0];
    if (!hit) return;

    const object = hit.object;
    if (object.userData.grabbable) {
      object.userData.velocity.set(
        (Math.random() - 0.5) * 1.2,
        2.4,
        (Math.random() - 0.5) * 1.2,
      );
      object.userData.spin.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      );
    } else if (object.userData.interactive && object.userData.onSelect) {
      object.userData.press = 1;
      object.userData.onSelect();
    }
  });

  // --- キーボードで歩く -----------------------------------------------------
  // OrbitControls は毎フレーム「注視点 + 球座標」からカメラ位置を組み立て直す。
  // なので **カメラと注視点を同じだけ平行移動** しないと、update() で元に
  // 戻されてしまう。片方だけ動かすと距離が変わってズームしたように見える。
  const keys = new Set();
  const HELD = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight',
  ]);

  window.addEventListener('keydown', (event) => {
    if (!HELD.has(event.code)) return;
    keys.add(event.code);
    if (event.code.startsWith('Arrow')) event.preventDefault(); // ページスクロール抑止
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const step = new THREE.Vector3();

  function walk(dt) {
    const ahead = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    if (ahead === 0 && side === 0) return;

    // 視線を地面に落とした向きを前とする（見上げていても前へ進む）
    forward.subVectors(controls.target, camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.set(-forward.z, 0, forward.x);

    step.set(0, 0, 0);
    step.addScaledVector(forward, ahead);
    step.addScaledVector(right, side);
    if (step.lengthSq() > 1) step.normalize();   // 斜めで速くならないように
    const speed = WALK_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? DASH : 1);
    step.multiplyScalar(speed * dt);

    // 歩ける範囲は VR と同じ判定を使う。0.25 は体の半径ぶんの余白。
    const clamp = world.clampToBounds;
    let dx = step.x;
    let dz = step.z;
    if (clamp) {
      const inside = clamp(camera.position.x + dx, camera.position.z + dz, 0.25);
      dx = inside.x - camera.position.x;
      dz = inside.z - camera.position.z;
    }
    camera.position.x += dx;
    camera.position.z += dz;
    controls.target.x += dx;
    controls.target.z += dz;
  }

  let last = performance.now();

  return {
    controls,
    /** @param {number} [dt] 呼び出し側が持っていれば渡す。無ければ自前で測る */
    update(dt) {
      if (renderer.xr.isPresenting) { last = performance.now(); return; }
      const now = performance.now();
      const seconds = dt ?? Math.min((now - last) / 1000, 0.05);
      last = now;
      walk(seconds);
      controls.update();
    },
  };
}
