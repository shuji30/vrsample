import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDesktopSwing } from './swing.js';

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

    const hit = raycaster.intersectObjects(world.interactables, true)[0];
    if (!hit) return;

    // ラケットは部品（子のメッシュ）に当たるので、つかめる親までさかのぼる
    let object = hit.object;
    while (object && !object.userData.grabbable && !object.userData.interactive) object = object.parent;
    if (!object || object.userData.held) return;
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

  // --- PC でのキャッチボールとテニス ---------------------------------------
  // ヘッドセットが無くても女の子とボールをやりとりできるように、F で近くの
  // ボールを拾う / 見ている方へ投げる。こちらへ飛んできた球は、顔の前を
  // 通るときに自動で受ける（マウスで捕る操作は難しすぎるため）。
  //
  // ラケットも F で拾う。持っているあいだは右手に構え、スペースを押すと
  // 振りかぶり、離すと振る。テニスボールも持っていれば、スペースで目の前に
  // トスして、落ちてくるところを自動で打つ。G でラケットを置く。
  const ball = world.ball;
  const racket = world.racket;
  const balls = [world.ball, ...(world.tennisBalls ?? [])].filter(Boolean);
  const basket = world.basket ?? null;
  const HOLD = new THREE.Vector3(0.20, -0.30, -0.45);        // カメラから見た持つ位置
  const HOLD_LEFT = new THREE.Vector3(-0.22, -0.30, -0.45);  // ラケットを持っているときは左手
  const PICK_RANGE = 1.8;
  const CATCH_RANGE = 0.6;
  /** 手に持っている球（無ければ null） */
  let heldBall = null;
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const swing = racket ? createDesktopSwing(camera, racket, { balls: world.tennisBalls ?? [] }) : null;

  const free = (object) => object && !object.userData.held && !object.userData.inBasket;
  const holdSlot = () => (swing?.holding ? HOLD_LEFT : HOLD);

  function take(object) {
    if (object.userData.racket) {
      swing.take();
      return;
    }
    heldBall = object;
    object.userData.held = true;
    object.userData.heldBy = 'desktop';
    object.userData.velocity.set(0, 0, 0);
    object.userData.spin.set(0, 0, 0);
  }

  function release(object) {
    object.userData.held = false;
    object.userData.heldBy = null;
    if (heldBall === object) heldBall = null;
  }

  function throwBall() {
    const object = heldBall;
    camera.getWorldPosition(eye);
    camera.getWorldDirection(look);
    release(object);
    object.position.copy(camera.localToWorld(holdSlot().clone()));
    // 見ている向きへ山なりに。水平を見て投げると 5m 先で胸の高さに届く
    object.userData.velocity.copy(look).multiplyScalar(7.0).add(new THREE.Vector3(0, 2.2, 0));
    // 女の子のほうを見て投げたら、届く球筋に直す（マウスでは強さを加減できない）
    if (object === ball) world.catchGame?.assistThrow(object.position, object.userData.velocity, 1);
    object.userData.spin.set(-look.z, 0, look.x).multiplyScalar(40);
  }

  /** 手の届くところにある、いちばん近い物（球とラケット） */
  function nearest() {
    camera.getWorldPosition(eye);
    let best = null;
    let bestDistance = Infinity;
    const candidates = [...balls];
    if (racket && !swing.holding) candidates.push(racket);
    for (const object of candidates) {
      if (!free(object)) continue;
      const position = object.userData.racket ? racketGrip(object) : object.position;
      const flat = Math.hypot(position.x - eye.x, position.z - eye.z);
      const distance = position.distanceTo(eye);
      if (flat >= PICK_RANGE || distance >= PICK_RANGE + 1.0) continue;
      // ラケットを持っているときは、テニスボールを先に拾う
      if (swing?.holding && object.userData.tennis) return object;
      if (distance < bestDistance) {
        best = object;
        bestDistance = distance;
      }
    }
    return best;
  }
  const gripPoint = new THREE.Vector3();
  function racketGrip(object) {
    // 面の中心あたりで測る（机に寝かせたラケットのどこを見ても拾えるように）
    return object.localToWorld(gripPoint.set(0, 0.3, 0));
  }

  /** ボールかごが手の届くところにあれば、そこから 1 つ取り出す */
  const mouth = new THREE.Vector3();
  function fromBasket() {
    if (!basket || basket.count === 0) return null;
    camera.getWorldPosition(eye);
    basket.mouth(mouth);
    if (Math.hypot(mouth.x - eye.x, mouth.z - eye.z) > PICK_RANGE) return null;
    return basket.take();
  }

  window.addEventListener('keydown', (event) => {
    if (renderer.xr.isPresenting) return;
    if (event.code === 'KeyF') {
      if (heldBall) { throwBall(); return; }
      // 足もとの球より、かごを先に見る（かごのそばで F を押したら、かごから出す）
      const object = (swing?.holding ? fromBasket() : null) ?? nearest() ?? fromBasket();
      if (object) take(object);
    } else if (event.code === 'KeyG' && swing?.holding) {
      swing.drop();
    } else if (event.code === 'Space' && swing?.holding) {
      event.preventDefault();
      if (event.repeat) return;
      if (heldBall?.userData.tennis) {
        const object = heldBall;
        release(object);
        swing.tossAndHit(object);
      } else {
        swing.backswing();
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && swing?.holding) swing.forward();
  });

  function updateBall(dt) {
    swing?.update(dt);
    if (heldBall) {
      if (heldBall.userData.heldBy !== 'desktop') { heldBall = null; return; }
      heldBall.position.copy(camera.localToWorld(holdSlot().clone()));
      return;
    }
    // 飛んできたキャッチボールの球は、顔の前で自動で受ける
    if (!free(ball)) return;
    camera.getWorldPosition(eye);
    const v = ball.userData.velocity;
    const toEye = look.subVectors(eye, ball.position);
    if (v.length() > 1.5 && toEye.dot(v) > 0 && toEye.length() < CATCH_RANGE) take(ball);
  }

  let last = performance.now();

  return {
    controls,
    swing,
    /** @param {number} [dt] 呼び出し側が持っていれば渡す。無ければ自前で測る */
    update(dt) {
      if (renderer.xr.isPresenting) { last = performance.now(); return; }
      const now = performance.now();
      const seconds = dt ?? Math.min((now - last) / 1000, 0.05);
      last = now;
      walk(seconds);
      controls.update();
      updateBall(seconds);
    },
  };
}
