import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';

/**
 * 座って話す（女の子の側）。プレイヤーがソファー・食卓の椅子・庭のベンチ・パラソルの下のいすに座ると
 * （seats.js）、女の子はしていたことをやめて歩いてきて、隣（向かい）の席に座り、会話をする（talk.js）。
 * プレイヤーが立つと、女の子も立って、もとの遊び（キャッチボール・部屋のうろうろ・ビーチバレー）へ戻る。
 *
 * 歩く道：
 * - 家の席：外にいれば、庭から掃き出し窓を通って部屋へ入る（character.js の entryRoute）。部屋の中は
 *   経路の節点（ROUTE の輪）を近いほうの向きにたどり、席ごとの節点から席の前へ
 * - 庭のベンチ：部屋にいれば窓から出て（exitRoute）、庭の中は gardenPath で障害物をよける
 * - 砂浜：ビーチバレーのコートから、まっすぐパラソルの前へ
 *
 * 向かい合って座る席（食卓）では、スカートを腿に沿わせて、手を膝の上に置く。
 */
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.15;
const GET_IN = 1.0;
const GARDEN_EDGE = new THREE.Vector2(-6.2, -4.8);

export function createSeatGame({ character, talk, voice = null, playerHead, isNight = () => false }) {
  const body = character.body;
  let state = 'off';
  let spot = null;           // プレイヤーの座っている席（seats.js の乗り物）
  let want = null;           // 座っている席（world.js が入れる）
  let path = [];
  let timer = 0;
  let onFinish = null;
  let gazeMode = 'player';
  let gazeFor = 0;
  const driver = { get state() { return `seat:${state}`; } };
  const seat = new THREE.Vector3();
  const from = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector2();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  function start() {
    if (state !== 'off' || !want) return;
    spot = want;
    state = 'waitStand';
  }

  /** 部屋の輪の経路で、from に近い節点から node まで（近いほうの向き） */
  function ringPath(fromXZ, node) {
    const route = character.route;
    const n = route.length;
    let near = 0;
    let best = Infinity;
    route.forEach((p, i) => { const d = p.distanceTo(fromXZ); if (d < best) { best = d; near = i; } });
    const fwd = (node - near + n) % n;
    const back = (near - node + n) % n;
    const step = fwd <= back ? 1 : -1;
    const out = [route[near].clone()];
    for (let i = near; i !== node;) { i = (i + step + n) % n; out.push(route[i].clone()); }
    return out;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    const approach = spot.girlApproach(new THREE.Vector2());
    const outside = here.y < OUTSIDE_Z || here.x < ROOM.minX - 0.3 || here.x > ROOM.maxX + 0.3;
    const west = here.x < -6.5 ? [GARDEN_EDGE.clone()] : [];
    if (spot.where === 'house') {
      const way = spot.girlWay();
      let lead = [];
      let inside = here;
      if (outside) {
        const entry = body.entryRoute();
        lead = [...west, ...gardenPath(west[0] ?? here, entry[0]), ...entry];
        inside = entry[entry.length - 1];
      }
      path = [...lead, ...ringPath(inside, way.node), ...way.via.map((p) => p.clone()), approach];
    } else if (spot.where === 'garden') {
      if (!outside) {
        const exit = body.exitRoute();
        path = exit.concat(gardenPath(exit[exit.length - 1], approach));
      } else {
        path = [...west, ...gardenPath(west[0] ?? here, approach)];
      }
    } else {
      path = [approach];
    }
    state = 'toSeat';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  function seatPoint(out) {
    spot.girlSeat(out);
    out.y = body.seatRootY(out.y);
    return out;
  }
  /** 手は膝の上にそろえる（drive 中は座ったときの腕が効かないので、ここで置く） */
  function handsOnLap() {
    spot.girlSeat(tmp);
    const yaw = spot.girlYaw();
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    left.set(tmp.x + fx * 0.24 + lx * 0.06, tmp.y + 0.13, tmp.z + fz * 0.24 + lz * 0.06);
    right.set(tmp.x + fx * 0.25 - lx * 0.06, tmp.y + 0.14, tmp.z + fz * 0.25 - lz * 0.06);
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  const seatStyle = () => ({ skirt: spot.facing });

  /** 見る所：話しているとき・選んでいるときはプレイヤー、だまっているときは景色も */
  function lookAround(dt) {
    gazeFor -= dt;
    if (gazeFor <= 0) {
      const calm = talk.phase === 'choose' && !voice?.speaking;
      gazeMode = calm && spot.where !== 'house' && Math.random() < 0.45 ? 'view' : 'player';
      gazeFor = gazeMode === 'view' ? 4 + Math.random() * 3 : 5 + Math.random() * 5;
    }
    if (voice?.speaking) gazeMode = 'player';
    if (gazeMode === 'view') {
      const yaw = spot.girlYaw();
      spot.girlSeat(gaze.position);
      gaze.position.x += Math.sin(yaw) * 30;
      gaze.position.z += Math.cos(yaw) * 30;
      gaze.position.y += spot.where === 'beach' ? -1.2 : 0.2;
    } else {
      playerHead(gaze.position);
    }
    character.watch(gaze);
  }

  function update(dt) {
    if (!body.loaded) return;
    // プレイヤーが立った（か、別の席へ移った）。座っていれば立ち、まだなら取りやめる（移ったなら、そのあと新しい席へ）
    if (want !== spot && state !== 'off' && state !== 'getOut') {
      if (state === 'sit') { stand(); } else { finish(); return; }
    }
    const ground = spot ? spot.ground : () => 0;
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toSeat':
        if (spot.where === 'beach') body.position.y = ground(body.position.x, body.position.z);
        playerHead(gaze.position);
        character.watch(gaze);
        if (followPath(dt)) { state = 'getIn'; timer = 0; from.copy(body.position); }
        break;
      case 'getIn': {
        // 席の前で向きを変え、後ろへ下がって腰を下ろす
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.turnTowards(spot.girlYaw(), dt * 2);
        if (k > 0.35) body.setYaw(spot.girlYaw());
        const m = Math.max(0, (k - 0.25) / 0.75);
        body.position.lerpVectors(from, seat, m * m * (3 - 2 * m));
        body.setSeat(e, 'upright', seatStyle());
        body.setFootFloor(spot.girlFloorY());
        if (k > 0.6) handsOnLap();
        if (k >= 1) {
          state = 'sit';
          const key = spot.where === 'beach' ? 'seatSitBeach' : spot.where === 'garden' ? 'seatSitGarden' : spot.facing ? 'seatSitTable' : 'seatSitHouse';
          voice?.say(key);
          body.smile(2, 0.8);
          talk.open({ where: spot.where, night: isNight(), xr: false });
          gazeFor = 3;
        }
        break;
      }
      case 'sit':
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(spot.girlYaw());
        body.setSeat(1, 'upright', seatStyle());
        body.setFootFloor(spot.girlFloorY());
        handsOnLap();
        body.setAttend(false);
        lookAround(dt);
        talk.update(dt);
        break;
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        spot.girlApproach(tmp2);
        tmp.set(tmp2.x, ground(tmp2.x, tmp2.y), tmp2.y);
        body.position.lerpVectors(from, tmp, e);
        body.setSeat(1 - e, 'upright', seatStyle());
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); finish(); }
        break;
      }
      default:
        break;
    }
  }

  function stand() {
    talk.close();
    voice?.say('seatBye', { chance: 0.7 });
    state = 'getOut';
    timer = 0;
    from.copy(body.position);
  }

  function finish() {
    talk.close();
    // 腰を下ろしかけで立たれたときも、座りの混ざりを戻しておく
    if (body.driven) body.setSeat(0, 'upright');
    body.reachHands(null);
    body.setGrip(0);
    body.setFootFloor(null);
    body.setAttend(true);
    state = 'off';
    path = [];
    const was = spot;
    spot = null;
    onFinish?.(was);
  }

  return {
    update,
    start,
    set onFinish(fn) { onFinish = fn; },
    /** プレイヤーの座っている席（null で立った） */
    set playerSeat(v) { want = v ?? null; },
    get playerSeat() { return want; },
    get wanted() { return Boolean(want); },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get spot() { return spot; },
  };
}
