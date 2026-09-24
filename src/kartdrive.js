import * as THREE from 'three';
import { KART } from './kart.js';
import { KART_TRACK } from './karttrack.js';
import { createWheelInput } from './wheel.js';
import { createWheelFFB } from './wheelffb.js';
import { createEngineSound } from './audio.js';

/**
 * プレイヤーがカートに乗って運転する。
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
export function createKartDrive({ renderer, camera, player, desktop, world, kart }) {
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

  function near() {
    camera.getWorldPosition(tmp);
    kart.eye(tmp2);
    return Math.hypot(tmp.x - tmp2.x, tmp.z - tmp2.z) < 2.2;
  }

  function enter() {
    if (driving) return;
    driving = true;
    player.releaseHeld();
    desktop.dropAll();
    player.setDriving(true);
    desktop.setDriving(true);
    engine.start();
    if (renderer.xr.isPresenting) calibrateHead();
    world.onKartEnter?.(kart);
  }

  /**
   * VR：いまの頭の位置（リグから見た）と向きを覚え、頭が運転席の目の位置でカートの前を
   * 向くようにリグを合わせる。乗ったとき、乗ったまま VR を始めたとき（PC で乗ってから
   * ENTER VR すると、合わせないまま VR の基準の向き（SteamVR の部屋の正面など）になって
   * 逆を向いていた）、左スティックを押し込んだときに合わせ直す。
   */
  function calibrateHead() {
    const rig = player.player;
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().getWorldPosition(tmp);
    headLocal.copy(rig.worldToLocal(tmp.clone()));
    // 頭の向きのぶんだけリグを回して、前を向いているようにする
    const q = new THREE.Quaternion();
    renderer.xr.getCamera().getWorldQuaternion(q);
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
    kart.side(tmp);
    if (renderer.xr.isPresenting) {
      const rig = player.player;
      renderer.xr.getCamera().getWorldPosition(tmp2);
      rig.position.x += tmp.x - tmp2.x;
      rig.position.z += tmp.z - tmp2.z;
      rig.position.y = 0;
    } else {
      // PC：カートの左に立って、カートのほうを向く
      const ahead = new THREE.Vector3(Math.sin(kart.state.yaw), 0, Math.cos(kart.state.yaw));
      camera.position.set(tmp.x, 1.62, tmp.z);
      desktop.controls.target.set(tmp.x + ahead.x * 3, 1.2, tmp.z + ahead.z * 3);
      desktop.controls.update();
    }
    world.onKartExit?.(kart);
  }

  kart.body.userData.interactive = true;
  kart.body.userData.onSelect = () => enter();

  window.addEventListener('keydown', (event) => {
    if (event.target?.tagName === 'INPUT') return;
    keys.add(event.code);
    if (renderer.xr.isPresenting) return;
    if (event.code === 'KeyE') {
      if (driving) exit();
      else if (near()) enter();
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
      kart.steering.getWorldPosition(wheelCenter);
      const a = c0.getWorldPosition(new THREE.Vector3());
      const b = c1.getWorldPosition(new THREE.Vector3());
      if (a.distanceTo(wheelCenter) < 0.45 && b.distanceTo(wheelCenter) < 0.45) {
        kart.group.worldToLocal(a);
        kart.group.worldToLocal(b);
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
    kart.eye(eye);
    if (calibrateIn > 0 && renderer.xr.isPresenting && --calibrateIn === 0) calibrateHead();
    const yaw = kart.state.yaw;
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
    } else {
      // 追いかけ視点は、進む向き（travelYaw）の後ろから。ハンドブレーキで滑ると、カートが
      // 横を向いて流れるのが見える（車の向きの後ろにすると、滑っていても真後ろしか見えない）
      const ty = kart.state.travelYaw ?? yaw;
      const tx = Math.sin(ty);
      const tz = Math.cos(ty);
      camera.position.set(kart.group.position.x - tx * 3.8, 2.1, kart.group.position.z - tz * 3.8);
      camera.lookAt(kart.group.position.x + tx * 2, 0.6, kart.group.position.z + tz * 2);
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
    // レースのスタートの合図のあいだは動かない（ブレーキも離す。踏み続けるとバックするので）
    if (world.kartRace?.locked) { input.throttle = 0; input.brake = Math.abs(kart.speed) > 0.2 ? 1 : 0; }
    lastInput = input;
    const before = kart.speed;
    kart.update(dt, input, clampKart);
    // 壁に当たって急に止まった
    const drop = before - kart.speed;
    if (drop > 1.2) ffb.bump(Math.min(1, drop / 5), -kart.state.steer || 1);
    const onCurb = !kart.state.onGrass && Math.abs(kart.state.lateral) > KART_TRACK.width / 2 - 0.05;
    if (onCurb && !wasOnCurb) input.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: 120, strongMagnitude: 0.2, weakMagnitude: 0.5 }).catch?.(() => {});
    wasOnCurb = onCurb;
    const rpm = Math.min(1, Math.abs(kart.speed) / KART.maxSpeed * 0.85 + input.throttle * 0.15);
    engine.update(rpm, input.throttle);
    ffb.update(dt, {
      angle: input.kind === 'wheel' ? input.angle : input.steer * 90,
      fullDegrees: wheel.config.fullDegrees,
      speed: kart.speed,
      maxSpeed: KART.maxSpeed,
      onCurb,
      onGrass: kart.state.onGrass,
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
    get input() { return lastInput; },
    wheel,
    ffb,
  };
}
