import * as THREE from 'three';
import { createTextures } from './textures.js';
import { createRoom, ROOM } from './room.js';
import { createPark } from './park.js';
import { createFurniture, TABLE } from './furniture.js';
import { createLighting } from './lighting.js';
import { createCharacter } from './character.js';
import { createCatchGame } from './catchball.js';
import { DEFAULT_THEME } from './themes.js';

/**
 * 部屋と、窓の外の公園と、照明をまとめて組み立てる。
 *
 * 物理は相変わらず重力と着地だけの数十行。物理エンジンを入れないのは、
 * つかんで投げて戻る、という遊びにはこれで足り、フレーム落ちの原因を
 * 一つ減らせるから。
 */

/** 庭の広さ。歩いて出られる範囲で、公園の遊具や木は柵の向こう側に残る */
const GARDEN = { minX: -6.0, maxX: 6.0, minZ: -13.0 };

const GRAVITY = -9.8;
/**
 * 空気抵抗の係数（1/m）。加速度 = -c |v| v として使う。
 * c = 0.5 ρ Cd A / m なので、硬式球（145g・半径 3.65cm・Cd 0.35）だと
 * およそ 0.006。時速 70km の送球で 2.4m/s^2 ほど減速する計算になる。
 * 軽い小物は同じ大きさでも質量が小さいぶん、もっと効く。
 */
const DRAG_DEFAULT = 0.02;
/** 転がり抵抗（m/s^2）。芝と床の中間くらいの値 */
const ROLL_FRICTION = 0.55;
/** 転がらない物が接地して滑るときの減速（m/s^2） */
const SLIDE_FRICTION = 4.5;
/** これ以下の跳ね返りは止める（m/s） */
const BOUNCE_STOP = 0.32;
const RESTITUTION = 0.38;   // 床の反発。木の床なので跳ねすぎない
const WALL_RESTITUTION = 0.45;
const FRICTION = 0.78;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {number} [options.textureQuality] 1 = 既定。軽くしたいときは 0.5
 * @param {number} [options.shadowMapSize]
 * @param {THREE.Camera} [options.camera] キャラクターに視線で追わせる相手
 * @param {string} [options.characterUrl] VRM ファイルの URL
 * @param {boolean} [options.wander] キャラクターを歩きまわらせるか
 * @param {boolean} [options.sit] ときどきソファに座らせるか
 */
export function createWorld(renderer, scene, {
  textureQuality = 1,
  shadowMapSize = 4096,
  environment = true,
  camera = null,
  characterUrl,
  wander = true,
  sit = true,
} = {}) {
  const tex = createTextures(renderer, { quality: textureQuality });

  const room = createRoom(scene, tex);
  const park = createPark(scene, tex);

  let lighting = null;
  const furniture = createFurniture(scene, tex, (key) => {
    if (lighting) lighting.setTheme(key);
  });

  lighting = createLighting(renderer, scene, {
    windows: room.windows,
    lampSockets: furniture.lampSockets,
    skyUniforms: park.skyUniforms,
    shadowMapSize,
    environment,
  });

  // 初期テーマ。環境マップは「部屋を撮って部屋に返す」ので、
  // 2 回まわすと 1 バウンスぶん間接光が乗って落ち着く。
  lighting.setTheme(DEFAULT_THEME);
  lighting.refreshEnvironment();

  // キャラクターは読み込みが非同期なので、部屋の生成はここで待たない
  const character = createCharacter(scene, { url: characterUrl, camera, wander, sit });
  // 投げられたボールを目で追わせる
  character.watch(furniture.ball);
  // 庭に出るとキャッチボールが始まる（プレイヤーの頭 = camera の位置で判定）
  const catchGame = camera
    ? createCatchGame({ character, ball: furniture.ball, camera, scene })
    : null;

  const { grabbables, buttons } = furniture;

  // 歩ける範囲。掃き出し窓から庭へ出られるようになったので、単純な箱ひとつ
  // ではなく「部屋」「窓の通り道」「庭」の 3 つの矩形の和で表す。隣り合う
  // 矩形をわずかに重ねておくと、境目で引っかからずに通り抜けられる。
  //
  // 通り道の幅は room.doorway がそのまま返す「引き戸が開いている側」の幅。
  // 見た目の開口と歩ける幅がずれていると、ガラスをすり抜けたり、
  // 開いて見えるのに進めなかったりして、どちらも気持ち悪い。
  const MARGIN = 0.35;
  const outerZ = ROOM.minZ - ROOM.wall;       // 外壁の外面
  const door = room.doorway;
  //
  // 通り道は壁の厚みぶんではなく、**前後に 1m ほど長く** 取る。inset（体や
  // 物の半径ぶんの余白）は矩形を四方から縮めるので、隣り合う矩形が薄くしか
  // 重なっていないと、縮めた瞬間に継ぎ目に隙間が空いて通り抜けられなくなる。
  // 実際これで「外に出られない」状態になっていた。長い筒にしておけば、
  // 縮めても部屋側・庭側と必ず重なる。はみ出した部分はどちらも既に歩ける
  // 場所なので、和集合としての形は変わらない。
  const THROUGH = 1.0;
  const regions = [
    { minX: ROOM.minX + MARGIN, maxX: ROOM.maxX - MARGIN, minZ: ROOM.minZ + MARGIN, maxZ: ROOM.maxZ - MARGIN },
    { minX: door.x - door.width / 2 + 0.18, maxX: door.x + door.width / 2 - 0.18, minZ: outerZ - THROUGH, maxZ: ROOM.minZ + MARGIN + THROUGH },
    { minX: GARDEN.minX, maxX: GARDEN.maxX, minZ: GARDEN.minZ, maxZ: outerZ - 0.2 },
  ];

  /**
   * 与えた点を、歩ける範囲のいちばん近いところへ寄せる。
   * inset は物の半径ぶんの余白（壁にめり込ませないため）。
   */
  function clampToBounds(x, z, inset = 0) {
    let best = null;
    let bestDistance = Infinity;
    for (const region of regions) {
      const minX = region.minX + inset;
      const maxX = region.maxX - inset;
      const minZ = region.minZ + inset;
      const maxZ = region.maxZ - inset;
      if (maxX < minX || maxZ < minZ) continue;
      const cx = Math.min(Math.max(x, minX), maxX);
      const cz = Math.min(Math.max(z, minZ), maxZ);
      const distance = (cx - x) ** 2 + (cz - z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: cx, z: cz };
      }
    }
    return best ?? { x, z };
  }

  const tmp = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();
  const spinStep = new THREE.Quaternion();

  /** 小物を初期位置に戻す。 */
  function resetProp(prop) {
    const data = prop.userData;
    prop.position.copy(data.home);
    prop.rotation.set(0, 0, 0);
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
  }

  function update(dt) {
    catchGame?.update(dt);
    character.update(dt);

    // --- スイッチの押し込み ------------------------------------------------
    for (const button of buttons) {
      const data = button.userData;
      data.press = Math.max(0, data.press - dt * 4);
      button.position.z = data.restZ - data.press * 0.007;
      button.material.emissiveIntensity = 0.1 + data.press * 0.9;
    }

    // --- 小物の簡易物理 ----------------------------------------------------
    for (const prop of grabbables) {
      const data = prop.userData;
      if (data.held) continue;

      const prevY = prop.position.y;

      // 空気抵抗。速さの二乗に比例するので、山なりに投げた球の飛距離と
      // 落ち際の速さがそれらしくなる。
      const speed = data.velocity.length();
      if (speed > 0.01) {
        const loss = Math.min(0.9, (data.drag ?? DRAG_DEFAULT) * speed * dt);
        data.velocity.multiplyScalar(1 - loss);
      }

      data.velocity.y += GRAVITY * dt;
      prop.position.addScaledVector(data.velocity, dt);

      // 着地面。テーブルの真上から落ちてきたときだけ天板に乗る
      const dx = prop.position.x - TABLE.center.x;
      const dz = prop.position.z - TABLE.center.z;
      const onTable =
        Math.hypot(dx, dz) < TABLE.radius && prevY >= TABLE.top + data.halfSize - 1e-3;
      const surfaceY = onTable ? TABLE.top : 0;
      const restY = surfaceY + data.halfSize;
      let grounded = false;

      if (prop.position.y <= restY + 1e-4) {
        prop.position.y = restY;
        if (data.velocity.y < 0) {
          const bounce = -data.velocity.y * (data.restitution ?? RESTITUTION);
          if (bounce < BOUNCE_STOP) {
            // ただ床に載っているだけ。ここで衝突の摩擦を掛けてはいけない。
            //
            // 落とし穴だった。接地中は毎フレーム重力で velocity.y が負になり、
            // この枝に入り続ける。以前は入るたびに水平成分へ FRICTION(0.78) を
            // 掛けていたので、転がり出したボールが 0.2 秒で止まっていた。
            // 転がっている間の減速は下の ROLL_FRICTION だけが受け持つ。
            data.velocity.y = 0;
          } else {
            data.velocity.y = bounce;
            // 弾んだときだけの摩擦。水平成分を落とし、そのぶんを回転へまわす
            const before = Math.hypot(data.velocity.x, data.velocity.z);
            data.velocity.x *= FRICTION;
            data.velocity.z *= FRICTION;
            if (data.rolls && before > 0.2) {
              // 擦れたぶんスピンが乗る（跳ねたあとに転がりはじめる）
              data.spin.set(data.velocity.z, 0, -data.velocity.x).multiplyScalar(1 / data.halfSize);
            } else {
              data.spin.multiplyScalar(0.6);
            }
          }
        }
        grounded = Math.abs(data.velocity.y) < 0.06;
      }

      // 接地して転がる / 滑る
      if (grounded) {
        const horizontal = Math.hypot(data.velocity.x, data.velocity.z);
        if (horizontal > 0.005) {
          const decel = (data.rolls ? ROLL_FRICTION : SLIDE_FRICTION) * dt;
          const scale = Math.max(0, horizontal - decel) / horizontal;
          data.velocity.x *= scale;
          data.velocity.z *= scale;
        } else {
          data.velocity.x = 0;
          data.velocity.z = 0;
        }

        if (data.rolls) {
          // 転がりは角速度を速度から決める。進行方向に直交する水平軸まわりに
          // ω = v / r で回る（滑らずに転がっている状態）
          data.spin.set(data.velocity.z, 0, -data.velocity.x).multiplyScalar(1 / data.halfSize);
        }
      }

      // 回転。オイラー角に足し込むと軸の順序に引きずられて転がりが破綻するので、
      // ワールド軸まわりのクォータニオンで積む。
      const spinRate = data.spin.length();
      if (spinRate > 1e-4) {
        spinAxis.copy(data.spin).divideScalar(spinRate);
        spinStep.setFromAxisAngle(spinAxis, spinRate * dt);
        prop.quaternion.premultiply(spinStep);
        // 転がっているあいだは速度から決め直すので、ここでは減衰させない
        if (!(grounded && data.rolls)) data.spin.multiplyScalar(Math.max(0, 1 - dt * 0.8));
      }

      // 壁。歩ける範囲と同じ形で押し戻し、押し戻した向きに速度を反射する。
      // 掃き出し窓の開口ぶんはここが空いているので、ボールは庭へ抜けていく。
      const r = data.halfSize;
      const clamped = clampToBounds(prop.position.x, prop.position.z, r);
      const pushX = clamped.x - prop.position.x;
      const pushZ = clamped.z - prop.position.z;
      if (pushX * pushX + pushZ * pushZ > 1e-8) {
        prop.position.x = clamped.x;
        prop.position.z = clamped.z;
        const length = Math.hypot(pushX, pushZ);
        const nx = pushX / length;
        const nz = pushZ / length;
        const along = data.velocity.x * nx + data.velocity.z * nz;
        if (along < 0) {
          data.velocity.x -= (1 + WALL_RESTITUTION) * along * nx;
          data.velocity.z -= (1 + WALL_RESTITUTION) * along * nz;
        }
      }
      // 天井は室内だけ
      if (prop.position.z > ROOM.minZ && prop.position.y > ROOM.height - r) {
        prop.position.y = ROOM.height - r;
        data.velocity.y = -Math.abs(data.velocity.y) * 0.3;
      }

      // 念のため。窓から飛び出すなどして行方不明になったら戻す
      tmp.set(prop.position.x, 0, prop.position.z);
      if (prop.position.y < -2 || tmp.length() > 30) resetProp(prop);
    }
  }

  return {
    grabbables,
    interactables: [...grabbables, ...buttons],
    floor: room.floor,
    bounds: regions,
    clampToBounds,
    room,
    park,
    furniture,
    ball: furniture.ball,
    lighting,
    character,
    catchGame,
    update,
    setTheme: (key) => lighting.setTheme(key),
    getTheme: () => lighting.getTheme(),
    resetProps: () => grabbables.forEach(resetProp),
  };
}
