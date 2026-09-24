import * as THREE from 'three';
import { createFootsteps } from './audio.js';
import { VR_GRIP } from './tennis.js';

const MOVE_SPEED = 1.45;        // m/s（室内なので歩く速さくらいに）
const ACCELERATION = 8.0;       // m/s^2 歩き出し
const DECELERATION = 11.0;      // m/s^2 止まるほうが速い
const SNAP_ANGLE = Math.PI / 6; // 30度
const DEADZONE = 0.25;

// 歩容。人が歩くとき頭は 1 歩ごとに 2〜3cm 沈む。これが無いと、
// どれだけ床を作り込んでも「滑っている」「浮いている」ようにしか感じられない。
const STEP_LENGTH = 0.72;       // m 1 歩の歩幅（毎分 120 歩あたりになる）
const BOB_HEIGHT = 0.022;       // m 頭の上下動
const BOB_SWAY = 0.008;         // m 左右の振れ（VR では大きくすると酔う）

const UP = new THREE.Vector3(0, 1, 0);

// 投げる。手の速度は 1 フレームの差分だとぶれが大きく、離す瞬間には手が
// もう減速しはじめていることが多い（実際に投げると弱く、方向もばらつく）。
// 直近のフレームを覚えておき、いちばん速かった 3 フレームの平均を使う。
const VELOCITY_FRAMES = 12;   // 90Hz で 0.13 秒。振り切ってから離しても、いちばん速いところが残る
/** 手に重さが無いぶん、実際の腕の振りより弱く感じる。そのぶんを少し足す */
const THROW_GAIN = 1.15;
const THROW_MAX = 14;
/** 飛んできたボールがこの距離より手の近くを通れば、その手に収まる（m） */
const HAND_CATCH_RADIUS = 0.2;

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
 * 足元の影。
 *
 * VR で下を見たときに体が無いと、自分が床の上にいるという手がかりが
 * まったく無い。太陽で落とす本物の影はプレイヤーには付けられない（体の
 * ジオメトリが無い）ので、柔らかい楕円を頭の真下に敷く。
 */
function buildGroundShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.22)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.85),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.name = 'groundShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
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
export function createPlayer(renderer, camera, scene, world, { bobScale = 1, muted = false } = {}) {
  const player = new THREE.Group();
  player.name = 'player';
  scene.add(player);

  // 歩容の揺れ用に 1 段はさむ。player.position を直接触ると、移動・
  // スナップターン・壁の押し戻しと取り合いになるので、揺れは子側で持つ。
  // カメラも手もこの下にぶら下げるので、体ごと沈む動きになる。
  const bob = new THREE.Group();
  bob.name = 'bob';
  player.add(bob);
  bob.add(camera);

  const footsteps = createFootsteps({ muted });

  // 影はリグではなくシーン直下に置く。実空間で歩いて頭だけ動いたときにも
  // 足元に追従させたいので、毎フレーム頭のワールド座標から位置を決める。
  const groundShadow = buildGroundShadow();
  scene.add(groundShadow);

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const controllers = [];

  function setHover(object, on) {
    if (!object || !object.userData.grabbable) return;
    // ラケットのように部品を束ねた物は、光らせる材質を userData で指定する
    const material = object.userData.hoverMaterial ?? object.material;
    if (!material?.emissive) return;
    material.emissive.copy(on ? object.userData.baseColor : new THREE.Color(0x000000));
    material.emissiveIntensity = on ? 0.45 : 0;
  }

  function pick(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    raycaster.far = 8;
    const hit = raycaster.intersectObjects(world.interactables, true)[0];
    if (!hit) return null;
    // ラケットは部品（子のメッシュ）に当たるので、つかめる親までさかのぼる
    let object = hit.object;
    while (object && !object.userData.grabbable && !object.userData.interactive) object = object.parent;
    return object ? { ...hit, object } : null;
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
      object.userData.heldBy = 'player';
      object.userData.inBasket = false;   // かごの中の球も、そのままつかめる
      object.userData.velocity.set(0, 0, 0);
      object.userData.spin.set(0, 0, 0);
      setHover(object, false);
      controller.attach(object); // ワールド変換を保ったまま手の子にする
      if (object.userData.racket) {
        // ラケットは握る位置と向きを決めて持たせる（どこをつかんでもグリップを握る）
        object.position.copy(VR_GRIP.position);
        object.quaternion.copy(VR_GRIP.quaternion);
      } else {
        object.position.set(0, 0, -0.12); // 離れた場所からでも手元に引き寄せる
      }
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
    object.userData.heldBy = null;

    // 手の振りの速さから投げる速度にする。相手（女の子）のほうへ投げたときは
    // 向きを少しだけ相手へ寄せる（catchball.js の assistThrow）
    throwVelocity(controller, object.userData.velocity);
    sinceRelease = 0;
    // 相手へ寄せるのはキャッチボールの球だけ
    if (object === world.ball) world.catchGame?.assistThrow(object.position, object.userData.velocity, 0.5);
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
    controller.userData.history = [];
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
      controller.userData.history.length = 0;
    });

    bob.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(buildControllerMesh());
    bob.add(grip);
  }

  // --- 移動・旋回 ---------------------------------------------------------
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const pivot = new THREE.Vector3();

  // 歩容の状態。velocity は world 空間の水平速度で、スティック入力そのものでは
  // なく「そこへ寄せていく目標」として扱う。瞬時に最高速へ飛ぶと、床を蹴って
  // いる感じが出ずに滑っているように見える。
  const desired = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const towards = new THREE.Vector3();
  let stepDistance = 0;
  let stepsTaken = 0;

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
    const clamp = world.clampToBounds;
    if (!clamp) return;

    renderer.xr.getCamera().getWorldPosition(pivot);
    const inside = clamp(pivot.x, pivot.z);
    player.position.x += inside.x - pivot.x;
    player.position.z += inside.z - pivot.z;
  }

  function applyDeadzone(value) {
    const magnitude = Math.abs(value);
    if (magnitude < DEADZONE) return 0;
    // 縁で 0 から始まるよう引き伸ばす。切り捨てるだけだと、
    // わずかに倒した瞬間に 0.25 ぶんの速度が飛び出して階段状になる。
    return Math.sign(value) * (magnitude - DEADZONE) / (1 - DEADZONE);
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
    desired.set(0, 0, 0);

    const session = renderer.xr.getSession();
    if (!session) {
      velocity.set(0, 0, 0);
      return;
    }

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
        desired.addScaledVector(forward, -y * MOVE_SPEED);
        desired.addScaledVector(right, x * MOVE_SPEED);
      }
    });

    // 斜め入力で速くならないように頭打ちにする
    if (desired.lengthSq() > MOVE_SPEED * MOVE_SPEED) desired.setLength(MOVE_SPEED);

    // 目標速度へ一定の加速度で寄せる。歩き出しと止まりに時間をかけると、
    // 体重が乗っている感じが出る。止まるほうを速くするのは、
    // 入力を放したあともずるずる進むと操作感が悪いため。
    const rate = (desired.lengthSq() > 1e-6 ? ACCELERATION : DECELERATION) * dt;
    towards.subVectors(desired, velocity);
    if (towards.lengthSq() <= rate * rate) velocity.copy(desired);
    else velocity.addScaledVector(towards.normalize(), rate);

    player.position.addScaledVector(velocity, dt);
    clampToBounds();
  }

  /**
   * 歩容。進んだ距離から歩数を割り出し、頭を上下させて足音を鳴らす。
   *
   * 時間ではなく **距離** を位相にするのが要点。時間で回すと、ゆっくり歩いても
   * 同じ間隔で足音が鳴ってしまい、歩幅と合わない。
   */
  function updateGait(dt) {
    const speed = velocity.length();

    // 遅いときは揺れも足音も弱くする。止まりぎわに 1 歩だけ鳴るのを防ぐ
    const gait = Math.min(1, speed / (MOVE_SPEED * 0.55));

    if (speed > 0.05) {
      stepDistance += speed * dt;
      const count = Math.floor(stepDistance / STEP_LENGTH);
      if (count > stepsTaken) {
        stepsTaken = count;
        footsteps.step(gait);
      }
    }

    // 1 歩ごとに 1 回沈む。左右の振れは 2 歩で 1 周期
    const phase = (stepDistance / STEP_LENGTH) * Math.PI;
    bob.position.y = -Math.abs(Math.sin(phase)) * BOB_HEIGHT * gait * bobScale;
    bob.position.x = Math.sin(phase * 0.5) * BOB_SWAY * gait * bobScale;
  }

  /** 直近のフレームのうち、いちばん速かった 3 フレームの平均速度 */
  function throwVelocity(controller, out) {
    const history = controller.userData.history;
    out.set(0, 0, 0);
    if (history.length === 0) return out.copy(controller.userData.velocity);
    let best = 0;
    let bestSpeed = -1;
    for (let i = 0; i + 2 < history.length; i++) {
      const speed = history[i].length() + history[i + 1].length() + history[i + 2].length();
      if (speed > bestSpeed) { bestSpeed = speed; best = i; }
    }
    const count = Math.min(3, history.length - best);
    for (let i = 0; i < count; i++) out.add(history[best + i]);
    return out.divideScalar(count).multiplyScalar(THROW_GAIN).clampLength(0, THROW_MAX);
  }

  /**
   * 飛んできたボールを手で受ける。トリガーを引いていなくても、手の近くを
   * 通れば手に収まる。投げるときは、トリガーを引いて離す。
   * 1 フレームで 15cm 以上進む速い球もあるので、前のフレームからの線分で見る。
   */
  const lastBall = new THREE.Vector3();
  let sinceRelease = Infinity;   // 投げてからの秒数。離した直後の球を受け直さない
  const segment = new THREE.Line3();
  const closest = new THREE.Vector3();
  function handCatch(dt) {
    sinceRelease += dt;
    const ball = world.ball;
    if (!ball || !renderer.xr.isPresenting) { if (ball) lastBall.copy(ball.position); return; }
    const data = ball.userData;
    if (!data.held && data.velocity.length() > 1.5 && sinceRelease > 0.5) {
      segment.set(lastBall, ball.position);
      for (const controller of controllers) {
        if (controller.userData.held || !controller.visible) continue;
        controller.getWorldPosition(worldPos);
        segment.closestPointToPoint(worldPos, true, closest);
        if (closest.distanceTo(worldPos) > HAND_CATCH_RADIUS) continue;
        // 手へ向かってくる球だけ（手の横をすり抜けていった球を後ろから拾わない）
        if (closest.subVectors(worldPos, lastBall).dot(data.velocity) <= 0) continue;
        data.held = true;
        data.heldBy = 'player';
        data.velocity.set(0, 0, 0);
        data.spin.set(0, 0, 0);
        controller.attach(ball);
        ball.position.set(0, 0, -0.12);
        controller.userData.held = ball;
        break;
      }
    }
    lastBall.copy(ball.position);
  }

  // --- 毎フレーム更新 -----------------------------------------------------
  const worldPos = new THREE.Vector3();

  function update(dt) {
    updateLocomotion(dt);
    updateGait(dt);

    // 足元の影を頭の真下へ。歩幅の沈み込みに合わせて少し濃くすると接地が出る
    groundShadow.visible = renderer.xr.isPresenting;
    if (groundShadow.visible) {
      renderer.xr.getCamera().getWorldPosition(worldPos);
      groundShadow.position.set(worldPos.x, 0.012, worldPos.z);
      const sink = -bob.position.y / (BOB_HEIGHT || 1);
      groundShadow.material.opacity = 0.8 + sink * 0.35;
    }

    handCatch(dt);

    for (const controller of controllers) {
      // 手の速度を記録（投げる速度に使う）
      controller.getWorldPosition(worldPos);
      if (controller.userData.hasPrevPos && dt > 0) {
        controller.userData.velocity
          .subVectors(worldPos, controller.userData.prevWorldPos)
          .divideScalar(dt);
        const history = controller.userData.history;
        history.push(controller.userData.velocity.clone());
        if (history.length > VELOCITY_FRAMES) history.shift();
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
        controller.userData.held.userData.heldBy = null;
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
    velocity.set(0, 0, 0);
    desired.set(0, 0, 0);
    bob.position.set(0, 0, 0);
    stepDistance = 0;
    stepsTaken = 0;
  }

  return { player, bob, controllers, footsteps, update, reset };
}
