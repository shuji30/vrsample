import * as THREE from 'three';
import { KART } from './kart.js';
import { KART_TRACK } from './karttrack.js';
import { BIKE } from './bike.js';
import { BIKE_TRACK } from './biketrack.js';
import { createWheelInput } from './wheel.js';
import { createWheelFFB } from './wheelffb.js';
import { createEngineSound } from './audio.js';

/**
 * プレイヤーがカート（またはポケバイ）に乗って運転する。乗り物は近いほうに乗る。
 * 乗り物はどれも同じ窓口（group / body / state / steering / place / update / eye / side / speed）。
 *
 * 乗る：カートに向けてトリガー（VR）、カートをクリックか近くで E（PC）
 * 降りる：グリップを 0.5 秒握る（VR）、E（PC）
 *
 * 操作（どれでもよい。いちばん大きく入っているものを使う）
 *   VR       … 両手でハンドルを握る形にして、左右の手の傾きがハンドルの角度。
 *               右トリガーでアクセル、左トリガーでブレーキ（止まっていればバック）。
 *               ハンドルから手を離していれば、左スティックの左右でも曲がれる
 *   PC       … W / ↑ アクセル、S / ↓ ブレーキ、A D / ← → ハンドル、C で視点（運転席 / 後ろ）
 *   ハンコン  … ハンドルとペダル（wheel.js）。VR の中でも使える。FFB は wheelffb.js
 *   ゲームパッド … 左スティック、RT / LT
 *
 * VR では、乗った瞬間の頭の位置を覚えておき、それが運転席の目の位置に来るように
 * プレイヤーのリグを置く。そのあとの頭の動き（のぞき込むなど）はそのまま効く。
 */
export function createKartDrive({ renderer, camera, player, desktop, world, kart, bike = null, others = [] }) {
  const vehicles = [kart, bike, ...others].filter(Boolean);
  /** いま乗っている（最後に乗った）乗り物 */
  let vehicle = kart;
  const SEESAW_SPEC = { spec: { maxSpeed: 1 }, track: { width: 1e6 } };
  const GT3_SPEC = { spec: { maxSpeed: 75 }, track: { width: 12 } };
  const specOf = (v) => (v.kind === 'bike' ? { spec: BIKE, track: BIKE_TRACK } : v.kind === 'gt3' ? GT3_SPEC : v.silent ? SEESAW_SPEC : { spec: KART, track: KART_TRACK });
  // シフト（GT3）：押した回数をためて、次のフレームで車に渡す（+1 上げる / -1 下げる）
  let shiftQueue = 0;
  let autoToggle = false;        // AT / MT の切り替えを押した（次のフレームで GT3 へ）
  let xrStickRight = false;
  const padShift = { up: false, down: false };
  const xrShift = { up: false, down: false };
  const wheel = createWheelInput();
  const ffb = createWheelFFB();
  const engine = createEngineSound();
  const keys = new Set();
  let driving = false;
  let view = 'first';           // PC の視点：運転席 / 後ろから
  let grip = 0;                 // VR でグリップを握っている時間（降りる）
  const headLocal = new THREE.Vector3();
  let rigYawOffset = 0;
  let stickClick = false;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const wheelCenter = new THREE.Vector3();
  let lastInput = { steer: 0, throttle: 0, brake: 0, kind: 'none', angle: 0 };
  let wasOnCurb = false;

  // --- 乗る / 降りる ---------------------------------------------------------

  /** 近く（2.2m 以内）にある乗り物。無ければ null */
  function nearestVehicle() {
    camera.getWorldPosition(tmp);
    let best = null;
    let bestD = 2.2;
    for (const v of vehicles) {
      v.eye(tmp2);
      const d = Math.hypot(tmp.x - tmp2.x, tmp.z - tmp2.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function enter(target = null) {
    if (driving) return;
    vehicle = target ?? nearestVehicle() ?? kart;
    driving = true;
    player.releaseHeld();
    desktop.dropAll();
    player.setDriving(true);
    desktop.setDriving(true);
    if (!vehicle.silent) engine.start();   // シーソーなど、エンジンの無い乗り物は鳴らさない
    if (renderer.xr.isPresenting) calibrateHead();
    world.onKartEnter?.(vehicle);
  }

  /**
   * VR：いまの頭の位置（リグから見た）と向きを覚え、頭が運転席の目の位置でカートの前を
   * 向くようにリグを合わせる。乗ったとき、乗ったまま VR を始めたとき（PC で乗ってから
   * ENTER VR すると、合わせないまま VR の基準の向き（SteamVR の部屋の正面など）になって
   * 逆を向いていた）、左スティックを押し込んだときに合わせ直す。
   */
  function calibrateHead() {
    // 頭の姿勢は player.headWorld*（リグの中のカメラ）から取る。renderer.xr.getCamera() の
    // getWorldPosition はリグの位置が入らない値を返し、乗ったまま ENTER VR すると目線が
    // まったく違う所になっていた
    const rig = player.player;
    rig.updateMatrixWorld(true);
    player.headWorldPosition(tmp);
    headLocal.copy(rig.worldToLocal(tmp.clone()));
    // 頭の向きのぶんだけリグを回して、前を向いているようにする
    const q = new THREE.Quaternion();
    player.headWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const headYaw = Math.atan2(-f.x, -f.z) - rig.rotation.y;
    rigYawOffset = -headYaw;
  }
  // VR を始めたときに乗っていたら、頭の姿勢が取れるようになってから（数フレーム後）合わせる
  let calibrateIn = 0;
  renderer.xr.addEventListener('sessionstart', () => { if (driving) calibrateIn = 3; });

  function exit() {
    if (!driving) return;
    driving = false;
    player.setDriving(false);
    desktop.setDriving(false);
    engine.stop();
    ffb.release();
    vehicle.side(tmp);
    if (renderer.xr.isPresenting) {
      const rig = player.player;
      player.headWorldPosition(tmp2);
      rig.position.x += tmp.x - tmp2.x;
      rig.position.z += tmp.z - tmp2.z;
      rig.position.y = world.groundHeight?.(tmp.x, tmp.z) ?? 0;
    } else {
      // PC：カートの左に立って、カートのほうを向く
      const ahead = new THREE.Vector3(Math.sin(vehicle.state.yaw), 0, Math.cos(vehicle.state.yaw));
      // 目の高さは地面から 1.62m（坂の途中で降りても、地面に立つ）
      camera.position.set(tmp.x, 1.62 + (world.groundHeight?.(tmp.x, tmp.z) ?? 0), tmp.z);
      desktop.controls.target.set(tmp.x + ahead.x * 3, 1.2 + (world.groundHeight?.(tmp.x, tmp.z) ?? 0), tmp.z + ahead.z * 3);
      desktop.controls.update();
    }
    world.onKartExit?.(vehicle);
  }

  for (const v of vehicles) {
    v.body.userData.interactive = true;
    v.body.userData.onSelect = () => enter(v);
  }

  window.addEventListener('keydown', (event) => {
    if (event.target?.tagName === 'INPUT') return;
    keys.add(event.code);
    // シフト：X で上げる、Z で下げる（ハンコンのボタンを割り当てると、このキーとして届く。VR でも効く）
    if (!event.repeat && driving && event.code === 'KeyX') shiftQueue++;
    if (!event.repeat && driving && event.code === 'KeyZ') shiftQueue--;
    // AT / MT の切り替え（GT3。Q・パッドの十字キー上・VR の右スティックの押し込み）
    if (!event.repeat && driving && event.code === 'KeyQ') autoToggle = true;
    if (renderer.xr.isPresenting) return;
    // 乗る / 降りるは E（どの乗り物も同じ。F は拾う / 投げる）
    if (event.code === 'KeyE') {
      if (driving) exit();
      else if (nearestVehicle()) enter();
    }
    if (event.code === 'KeyC' && driving) view = view === 'first' ? 'chase' : 'first';
    if (event.code === 'KeyH') wheel.openPanel();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  // ハンコンの設定の画面に、FFB の欄を足す
  wheel.onPanel = (panel) => {
    const slot = panel.querySelector('[data-ffb]');
    const draw = () => {
      if (!ffb.supported) { slot.innerHTML = '<br>FFB：このブラウザは WebHID に対応していません（Chrome / Edge で開いてください）'; return; }
      slot.innerHTML = `<br><b>FFB</b>（実機では確かめていません）<br>`
        + `<button data-connect>${ffb.connected ? '別のハンコンにつなぎ直す' : 'FFB を有効にする（ハンコンを選ぶ）'}</button> `
        + `${ffb.connected ? '<button data-describe>機器の情報を書き出す</button>' : ''}<br>`
        + `<span data-status>${ffb.status || (ffb.connected ? '' : 'Logitech（G29 / G27 など）は専用の命令、CAMMUS などの DD や Thrustmaster / Fanatec は HID 標準の命令で試します')}</span><br>`
        + (ffb.connected
          ? `強さ <input data-str type="range" min="0" max="1.5" step="0.1" value="${ffb.strength}">　<label><input data-inv type="checkbox" ${ffb.invert ? 'checked' : ''}> 向きを逆にする</label>`
          : '')
        + '<textarea data-dump readonly style="display:none;width:100%;height:10em;font:11px monospace"></textarea>';
    };
    draw();
    slot.addEventListener('click', async (event) => {
      if (event.target.hasAttribute?.('data-connect')) { await ffb.connect(); draw(); }
      if (event.target.hasAttribute?.('data-describe')) {
        const dump = slot.querySelector('[data-dump]');
        dump.value = ffb.describe();
        dump.style.display = '';
        dump.select();
      }
    });
    slot.addEventListener('change', (event) => {
      if (event.target.hasAttribute('data-str')) ffb.strength = event.target.value;
      if (event.target.hasAttribute('data-inv')) ffb.invert = event.target.checked;
    });
  };

  // --- 入力 -------------------------------------------------------------------

  function keyboardInput() {
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    return {
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      throttle: keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0,
      brake: keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0,
      handbrake: keys.has('Space') ? 1 : 0,
      kind: 'keys',
      angle: 0,
    };
  }

  /** VR のコントローラー。両手の傾きでハンドル、トリガーでアクセル / ブレーキ */
  function xrInput(dt) {
    const session = renderer.xr.getSession();
    if (!session) return null;
    const out = { steer: 0, throttle: 0, brake: 0, handbrake: 0, kind: 'xr', angle: 0, hands: false };
    let stickX = 0;
    let gripped = false;
    [...session.inputSources].forEach((source, index) => {
      const gp = source.gamepad;
      if (!gp) return;
      const hand = source.handedness === 'left' || source.handedness === 'right'
        ? source.handedness : index === 0 ? 'left' : 'right';
      const trigger = gp.buttons[0]?.value ?? 0;
      if (hand === 'right') out.throttle = trigger;
      else out.brake = trigger;
      // 降りるのは左のグリップ（0.5 秒）。右のグリップはハンドブレーキ
      if (hand === 'left' && gp.buttons[1]?.pressed) gripped = true;
      if (hand === 'right') out.handbrake = gp.buttons[1]?.value ?? (gp.buttons[1]?.pressed ? 1 : 0);
      // シフト（GT3）：右手の A で上げる、B で下げる（押した瞬間だけ）
      if (hand === 'right') {
        const up = Boolean(gp.buttons[4]?.pressed);
        const down = Boolean(gp.buttons[5]?.pressed);
        if (up && !xrShift.up) shiftQueue++;
        if (down && !xrShift.down) shiftQueue--;
        xrShift.up = up;
        xrShift.down = down;
        // 右スティックの押し込みで AT / MT
        const click = Boolean(gp.buttons[3]?.pressed);
        if (click && !xrStickRight) autoToggle = true;
        xrStickRight = click;
      }
      if (hand === 'left') {
        const x = Math.abs(gp.axes[2] ?? 0) > Math.abs(gp.axes[0] ?? 0) ? gp.axes[2] ?? 0 : gp.axes[0] ?? 0;
        stickX = Math.abs(x) < 0.2 ? 0 : x;
        // 左スティックの押し込み：頭の位置と向きを合わせ直す
        const click = Boolean(gp.buttons[3]?.pressed);
        if (click && !stickClick) calibrateHead();
        stickClick = click;
      }
    });
    grip = gripped ? grip + dt : 0;
    if (grip > 0.5) { grip = 0; exit(); return null; }

    // 両手がハンドルの近くにあれば、手の傾きでハンドルを切る
    const [c0, c1] = player.controllers;
    if (c0.visible && c1.visible) {
      vehicle.steering.getWorldPosition(wheelCenter);
      const a = c0.getWorldPosition(new THREE.Vector3());
      const b = c1.getWorldPosition(new THREE.Vector3());
      if (vehicle.steerFromHands) {
        // ポケバイ：ハンドルバーを握って回す（手を結ぶ線の向き）
        vehicle.body.worldToLocal(a);
        vehicle.body.worldToLocal(b);
        const r = vehicle.steerFromHands(a, b);
        if (r) { out.steer = r.steer; out.angle = r.angle; out.hands = true; }
      } else if (a.distanceTo(wheelCenter) < 0.45 && b.distanceTo(wheelCenter) < 0.45) {
        vehicle.group.worldToLocal(a);
        vehicle.group.worldToLocal(b);
        // 左手・右手の区別がつかないこともあるので、カートの左（+X）にあるほうを左手とする
        const [l, r] = a.x > b.x ? [a, b] : [b, a];
        const angle = Math.atan2(r.y - l.y, l.x - r.x);   // 右手が下がると負（右へ切る）
        out.steer = THREE.MathUtils.clamp(angle / (Math.PI / 2), -1, 1);
        out.angle = THREE.MathUtils.radToDeg(angle);
        out.hands = true;
      }
    }
    if (!out.hands) out.steer = -stickX;
    return out;
  }

  /**
   * いくつかの入力のうち、いちばん大きく入っているものを使う。ハンコンがつながって
   * いても、キー（W / S / A / D）とゲームパッドは効く。アクセル・ブレーキは大きいほう、
   * ハンドルはキーやスティックを入れているあいだだけそちらを使う
   * （以前はハンコンを常に優先していて、ペダルが読めないとキーでも進めなかった）
   */
  function readInput(dt) {
    // VR のコントローラーは毎回読む（ハンコンで運転していても、グリップで降りられるように）
    const xr = xrInput(dt);
    const w = wheel.read();
    if (w?.kind === 'wheel') {
      // キー・パッド・VR のコントローラーを入れているあいだは、そちらのアクセル・ブレーキを使う
      // （ペダルの読み違いでブレーキが踏まれたままに見えても、キーで走れるように）
      const out = { ...w };
      const active = (i) => i.throttle > 0.02 || i.brake > 0.02 || Math.abs(i.steer) > 0.05;
      // ハンドブレーキは、どれで引いても効く
      out.handbrake = Math.max(out.handbrake ?? 0, ...[keyboardInput(), wheel.readPad(), xr].filter(Boolean).map((i) => i.handbrake ?? 0));
      const extras = [keyboardInput(), wheel.readPad(), xr].filter((i) => i && active(i));
      if (extras.length) {
        out.throttle = Math.max(...extras.map((i) => i.throttle));
        out.brake = Math.max(...extras.map((i) => i.brake));
      }
      for (const extra of extras) {
        if (Math.abs(extra.steer) > 0.05) { out.steer = extra.steer; out.angle = extra.steer * 90; }
      }
      if (xr?.hands) out.hands = true;
      return out;
    }
    const candidates = [keyboardInput(), xr, w].filter(Boolean);
    let best = candidates[0];
    const size = (i) => Math.abs(i.steer) + i.throttle + i.brake;
    for (const c of candidates) if (size(c) > size(best)) best = c;
    return { ...best, handbrake: Math.max(...candidates.map((c) => c.handbrake ?? 0)) };
  }

  // --- 毎フレーム ---------------------------------------------------------------

  function placeView() {
    vehicle.eye(eye);
    if (calibrateIn > 0 && renderer.xr.isPresenting && --calibrateIn === 0) calibrateHead();
    const yaw = vehicle.state.yaw;
    if (renderer.xr.isPresenting) {
      // 覚えた頭の位置が、運転席の目に来るようにリグを置く
      const rig = player.player;
      rig.rotation.y = yaw + Math.PI + rigYawOffset;
      tmp.copy(headLocal).applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.rotation.y);
      rig.position.set(eye.x - tmp.x, eye.y - headLocal.y, eye.z - tmp.z);
      return;
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (view === 'first') {
      camera.position.copy(eye);
      camera.lookAt(eye.x + fx * 6, eye.y - 0.35, eye.z + fz * 6);
    } else if (vehicle.chase) {
      vehicle.chase(camera);      // 観覧車など、その場で動く乗り物は自分で決める
    } else {
      // 追いかけ視点は、進む向き（travelYaw）の後ろから。ハンドブレーキで滑ると、カートが
      // 横を向いて流れるのが見える（車の向きの後ろにすると、滑っていても真後ろしか見えない）
      const ty = vehicle.state.travelYaw ?? yaw;
      const tx = Math.sin(ty);
      const tz = Math.cos(ty);
      const gp = vehicle.group.position;
      const back = vehicle.chaseBack ?? 3.8;
      camera.position.set(gp.x - tx * back, gp.y + (vehicle.chaseUp ?? 2.1), gp.z - tz * back);
      camera.lookAt(gp.x + tx * 2, gp.y + 0.6, gp.z + tz * 2);
    }
    camera.updateMatrixWorld(true);
  }

  const clampKart = (x, z, from) => world.clampToBounds(x, z, 0.75, from);

  function update(dt) {
    // ハンコンのボタンに割り当てたキー（乗り降り・視点など）
    wheel.pollButtons();
    if (!driving) {
      ffb.update(dt, { angle: 0, fullDegrees: 90, speed: 0, maxSpeed: KART.maxSpeed, onCurb: false, onGrass: false, rpm: 0, driving: false });
      return;
    }
    const input = readInput(dt);
    if (!driving) return;       // 入力を読むあいだに降りた
    // パッドの RB / LB（押した瞬間）でもシフト
    const pad = wheel.readPad();
    if (pad) {
      if (pad.shiftUp && !padShift.up) shiftQueue++;
      if (pad.shiftDown && !padShift.down) shiftQueue--;
      padShift.up = Boolean(pad.shiftUp);
      padShift.down = Boolean(pad.shiftDown);
    }
    input.shift = shiftQueue;
    shiftQueue = 0;
    input.toggleAuto = autoToggle;
    autoToggle = false;
    // レースのスタートの合図のあいだは動かない（ブレーキも離す。踏み続けるとバックするので）
    if (vehicle === kart && world.kartRace?.locked) { input.throttle = 0; input.brake = Math.abs(kart.speed) > 0.2 ? 1 : 0; }
    lastInput = input;
    const { spec, track } = specOf(vehicle);
    const before = vehicle.speed;
    // 4 つめは、手で持つ物（釣り竿など）のための VR の手
    vehicle.update(dt, input, clampKart, { xr: renderer.xr.isPresenting, controllers: player.controllers });
    // 壁に当たって急に止まった
    const drop = before - vehicle.speed;
    if (drop > 1.2) ffb.bump(Math.min(1, drop / 5), -vehicle.state.steer || 1);
    const onCurb = !vehicle.state.onGrass && Math.abs(vehicle.state.lateral) > track.width / 2 - 0.05;
    if (onCurb && !wasOnCurb) input.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: 120, strongMagnitude: 0.2, weakMagnitude: 0.5 }).catch?.(() => {});
    wasOnCurb = onCurb;
    // GT3 はエンジンの回転数をそのまま（ギアで上下する）
    const rpm = vehicle.rpm01 ?? Math.min(1, Math.abs(vehicle.speed) / spec.maxSpeed * 0.85 + input.throttle * 0.15);
    engine.update(rpm, input.throttle);
    ffb.update(dt, {
      angle: input.kind === 'wheel' ? input.angle : input.steer * 90,
      fullDegrees: wheel.config.fullDegrees,
      speed: vehicle.speed,
      maxSpeed: spec.maxSpeed,
      onCurb,
      onGrass: vehicle.state.onGrass,
      rpm,
      driving: input.kind === 'wheel',
    });
    placeView();
  }

  return {
    update,
    enter,
    exit,
    get driving() { return driving; },
    /** いま乗っている（最後に乗った）乗り物 */
    get vehicle() { return vehicle; },
    get input() { return lastInput; },
    wheel,
    ffb,
  };
}
