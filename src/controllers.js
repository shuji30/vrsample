import * as THREE from 'three';

const MOVE_SPEED = 1.6;        // m/s（室内なので歩く速さくらいに）
const SNAP_ANGLE = Math.PI / 6; // 30度
const DEADZONE = 0.25;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * コントローラーの見た目（簡単なグリップ形状）。
 * 外部アセットを読み込まずに済むよう自前で組み立てる。
 */
function buildControllerMesh() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x20263c, roughness: 0.4, metalness: 0.5 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 12), material);
  body.scale.set(1, 1, 1.4);
  group.add(body);

  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 6, 12), material);
  handle.position.set(0, -0.05, 0.02);
  handle.rotation.x = -0.35;
  group.add(handle);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.006, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x8ef0ff, emissive: 0x2ea8c4, roughness: 0.3 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -0.01;
  group.add(ring);

  return group;
}

/**
 * ポインター用のレーザー。長さは毎フレームスケールで調整する。
 */
function buildPointer() {
  const group = new THREE.Group();
  group.name = 'pointer';

  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x8ef0ff, transparent: true, opacity: 0.8 }),
  );
  line.name = 'pointerLine';
  line.frustumCulled = false; // 視錐台を合成できないヘッドセット対策（main.js のコメント参照）
  group.add(line);

  // 先端のドットはレーザーの兄弟にしておく（線のスケールで潰れないように）
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x8ef0ff }),
  );
  dot.name = 'pointerDot';
  dot.frustumCulled = false;
  group.add(dot);

  group.userData.setLength = (distance, hit) => {
    line.scale.z = distance;
    dot.position.z = -distance;
    dot.visible = hit;
  };

  return group;
}

/**
 * プレイヤーリグ（カメラ + 両手コントローラー）を作り、
 * つかむ・押す・移動する操作をまとめて面倒を見る。
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./world.js').createWorld>} world
 */
export function createPlayer(renderer, camera, scene, world) {
  const player = new THREE.Group();
  player.name = 'player';
  player.add(camera);
  scene.add(player);

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const controllers = [];

  function setHover(object, on) {
    if (!object || !object.userData.grabbable) return;
    const emissive = object.material.emissive;
    if (!emissive) return;
    emissive.copy(on ? object.userData.baseColor : new THREE.Color(0x000000));
    object.material.emissiveIntensity = on ? 0.45 : 0;
  }

  function pick(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    raycaster.far = 8;
    return raycaster.intersectObjects(world.interactables, false)[0] ?? null;
  }

  function onSelectStart(event) {
    const controller = event.target;
    const hit = pick(controller);
    if (!hit) return;

    const object = hit.object;

    if (object.userData.grabbable) {
      // 別の手が持っていたら奪う
      for (const other of controllers) {
        if (other.userData.held === object) other.userData.held = null;
      }
      object.userData.held = true;
      object.userData.velocity.set(0, 0, 0);
      object.userData.spin.set(0, 0, 0);
      setHover(object, false);
      controller.attach(object); // ワールド変換を保ったまま手の子にする
      object.position.set(0, 0, -0.12); // 離れた場所からでも手元に引き寄せる
      controller.userData.held = object;
    } else if (object.userData.interactive && object.userData.onSelect) {
      object.userData.press = 1;
      object.userData.onSelect();
    }
  }

  function onSelectEnd(event) {
    const controller = event.target;
    const object = controller.userData.held;
    if (!object) return;

    scene.attach(object); // シーン直下に戻す（ワールド変換は保持）
    object.userData.held = false;

    // 手の移動量からそのまま投げる速度にする
    object.userData.velocity.copy(controller.userData.velocity).clampLength(0, 12);
    object.userData.spin.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
    ).multiplyScalar(Math.min(1, controller.userData.velocity.length() / 3));

    controller.userData.held = null;
  }

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.userData.held = null;
    controller.userData.hovered = null;
    controller.userData.handedness = null;
    controller.userData.velocity = new THREE.Vector3();
    controller.userData.prevWorldPos = new THREE.Vector3();
    controller.userData.hasPrevPos = false;
    controller.userData.snapLatched = false;

    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data.handedness;
      if (event.data.targetRayMode === 'tracked-pointer' && !controller.getObjectByName('pointer')) {
        controller.add(buildPointer());
      }
      controller.visible = true;
    });
    controller.addEventListener('disconnected', () => {
      controller.visible = false;
      controller.userData.hasPrevPos = false;
    });

    player.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(buildControllerMesh());
    player.add(grip);
  }

  // --- 移動・旋回 ---------------------------------------------------------
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const pivot = new THREE.Vector3();

  function rotateAroundHead(angle) {
    renderer.xr.getCamera().getWorldPosition(pivot);
    player.position.sub(pivot);
    player.position.applyAxisAngle(UP, angle);
    player.position.add(pivot);
    player.rotation.y += angle;
  }

  /**
   * 頭が壁を抜けないようにリグを押し戻す。
   *
   * リグの原点ではなく **頭のワールド位置** で判定するのが要点。リグだけを
   * 制限しても、実空間で一歩踏み出せば頭は壁の外に出てしまう。
   */
  function clampToBounds() {
    const bounds = world.bounds;
    if (!bounds) return;

    renderer.xr.getCamera().getWorldPosition(pivot);
    if (pivot.x < bounds.minX) player.position.x += bounds.minX - pivot.x;
    else if (pivot.x > bounds.maxX) player.position.x += bounds.maxX - pivot.x;
    if (pivot.z < bounds.minZ) player.position.z += bounds.minZ - pivot.z;
    else if (pivot.z > bounds.maxZ) player.position.z += bounds.maxZ - pivot.z;
  }

  function applyDeadzone(value) {
    return Math.abs(value) < DEADZONE ? 0 : value;
  }

  /**
   * サムスティックの値を読む。
   *
   * xr-standard では axes[2]/axes[3] がサムスティックだが、
   * Pimax Sword や Vive ワンドなど一部のプロファイルでは
   * axes[0]/axes[1] に来る。倒れている方のペアを採用して両対応する。
   */
  function readStick(gamepad) {
    const axes = gamepad.axes;
    let bestX = 0;
    let bestY = 0;
    let bestMagnitude = 0;

    for (let i = 0; i + 1 < axes.length; i += 2) {
      const x = axes[i] ?? 0;
      const y = axes[i + 1] ?? 0;
      const magnitude = Math.hypot(x, y);
      // axes[2]/axes[3] を既定とみなし、他のペアは明確に上回るときだけ採用する
      const bias = i === 2 ? 0.05 : 0;
      if (magnitude + bias > bestMagnitude) {
        bestMagnitude = magnitude + bias;
        bestX = x;
        bestY = y;
      }
    }

    return { x: applyDeadzone(bestX), y: applyDeadzone(bestY) };
  }

  function updateLocomotion(dt) {
    const session = renderer.xr.getSession();
    if (!session) return;

    renderer.xr.getCamera().getWorldQuaternion(camQuat);
    forward.set(0, 0, -1).applyQuaternion(camQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.set(-forward.z, 0, forward.x); // forward を Y 軸まわりに -90度（右方向）

    const sources = [...session.inputSources];

    sources.forEach((source, index) => {
      const gamepad = source.gamepad;
      if (!gamepad || gamepad.axes.length === 0) return;

      // handedness を返さないランタイムもあるので、その場合は順番で左右を決める
      const hand =
        source.handedness === 'left' || source.handedness === 'right'
          ? source.handedness
          : index === 0
            ? 'left'
            : 'right';

      // three.js は inputSources の並び順どおりにコントローラーを割り当てる
      const controller = controllers[index];
      const { x, y } = readStick(gamepad);

      if (hand === 'right') {
        // スナップターン：一度倒したら中央に戻すまで再入力しない
        if (!controller) return;
        if (x === 0) {
          controller.userData.snapLatched = false;
        } else if (!controller.userData.snapLatched) {
          rotateAroundHead(-Math.sign(x) * SNAP_ANGLE);
          clampToBounds();
          controller.userData.snapLatched = true;
        }
      } else {
        player.position.addScaledVector(forward, -y * MOVE_SPEED * dt);
        player.position.addScaledVector(right, x * MOVE_SPEED * dt);
      }
    });

    clampToBounds();
  }

  // --- 毎フレーム更新 -----------------------------------------------------
  const worldPos = new THREE.Vector3();

  function update(dt) {
    updateLocomotion(dt);

    for (const controller of controllers) {
      // 手の速度を記録（投げる速度に使う）
      controller.getWorldPosition(worldPos);
      if (controller.userData.hasPrevPos && dt > 0) {
        controller.userData.velocity
          .subVectors(worldPos, controller.userData.prevWorldPos)
          .divideScalar(dt)
          .multiplyScalar(0.85); // 少し減衰させて暴発を防ぐ
      }
      controller.userData.prevWorldPos.copy(worldPos);
      controller.userData.hasPrevPos = true;

      const pointer = controller.getObjectByName('pointer');
      if (!pointer) continue;

      if (controller.userData.held) {
        pointer.visible = false;
        if (controller.userData.hovered) {
          setHover(controller.userData.hovered, false);
          controller.userData.hovered = null;
        }
        continue;
      }

      pointer.visible = true;
      const hit = pick(controller);
      const hovered = hit ? hit.object : null;

      if (hovered !== controller.userData.hovered) {
        setHover(controller.userData.hovered, false);
        setHover(hovered, true);
        controller.userData.hovered = hovered;
      }

      pointer.userData.setLength(hit ? hit.distance : 5, Boolean(hit));
    }
  }

  /** セッション終了時などに、持っているものを全部離してリグを原点に戻す。 */
  function reset() {
    for (const controller of controllers) {
      if (controller.userData.held) {
        scene.attach(controller.userData.held);
        controller.userData.held.userData.held = false;
        controller.userData.held.userData.velocity.set(0, 0, 0);
        controller.userData.held = null;
      }
      if (controller.userData.hovered) {
        setHover(controller.userData.hovered, false);
        controller.userData.hovered = null;
      }
      controller.userData.hasPrevPos = false;
    }
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
  }

  return { player, controllers, update, reset };
}
