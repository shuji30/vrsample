import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * ヘッドセットがない環境（PC / スマホ）向けの操作。
 * ドラッグで視点回転、ホイールでズーム、クリックでオブジェクトを跳ねさせる。
 */
export function createDesktopControls(renderer, camera, world) {
  camera.position.set(0, 1.6, 1.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, -2.2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.495; // 地面より下に潜らない
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
        (Math.random() - 0.5) * 1.5,
        3.2,
        (Math.random() - 0.5) * 1.5,
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

  return {
    controls,
    update() {
      if (renderer.xr.isPresenting) return;
      controls.update();
    },
  };
}
