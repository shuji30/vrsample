import * as THREE from 'three';
import { createTextures } from './textures.js';
import { createRoom, ROOM } from './room.js';
import { createPark } from './park.js';
import { createFurniture, TABLE } from './furniture.js';
import { createLighting } from './lighting.js';
import { createCharacter } from './character.js';
import { DEFAULT_THEME } from './themes.js';

/**
 * 部屋と、窓の外の公園と、照明をまとめて組み立てる。
 *
 * 物理は相変わらず重力と着地だけの数十行。物理エンジンを入れないのは、
 * つかんで投げて戻る、という遊びにはこれで足り、フレーム落ちの原因を
 * 一つ減らせるから。
 */

const GRAVITY = -9.8;
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

  const { grabbables, buttons } = furniture;

  // プレイヤーが壁を抜けないようにするための内寸
  const bounds = {
    minX: ROOM.minX + 0.35,
    maxX: ROOM.maxX - 0.35,
    minZ: ROOM.minZ + 0.35,
    maxZ: ROOM.maxZ - 0.35,
  };

  const tmp = new THREE.Vector3();

  /** 小物を初期位置に戻す。 */
  function resetProp(prop) {
    const data = prop.userData;
    prop.position.copy(data.home);
    prop.rotation.set(0, 0, 0);
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
  }

  function update(dt) {
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
      data.velocity.y += GRAVITY * dt;
      prop.position.addScaledVector(data.velocity, dt);

      if (data.spin.lengthSq() > 1e-6) {
        prop.rotation.x += data.spin.x * dt;
        prop.rotation.y += data.spin.y * dt;
        prop.rotation.z += data.spin.z * dt;
        data.spin.multiplyScalar(Math.max(0, 1 - dt * 0.9));
      }

      // 着地面。テーブルの真上から落ちてきたときだけ天板に乗る
      const dx = prop.position.x - TABLE.center.x;
      const dz = prop.position.z - TABLE.center.z;
      const onTable =
        Math.hypot(dx, dz) < TABLE.radius && prevY >= TABLE.top + data.halfSize - 1e-3;
      const surfaceY = onTable ? TABLE.top : 0;

      if (prop.position.y < surfaceY + data.halfSize) {
        prop.position.y = surfaceY + data.halfSize;
        if (data.velocity.y < 0) {
          data.velocity.y = -data.velocity.y * (data.restitution ?? RESTITUTION);
          if (Math.abs(data.velocity.y) < 0.35) data.velocity.y = 0;
          data.velocity.x *= FRICTION;
          data.velocity.z *= FRICTION;
          data.spin.multiplyScalar(0.6);
        }
      }

      // 壁。室内なので跳ね返す（外に出られると回収できない）
      const r = data.halfSize;
      if (prop.position.x < ROOM.minX + r) {
        prop.position.x = ROOM.minX + r;
        data.velocity.x = Math.abs(data.velocity.x) * WALL_RESTITUTION;
      } else if (prop.position.x > ROOM.maxX - r) {
        prop.position.x = ROOM.maxX - r;
        data.velocity.x = -Math.abs(data.velocity.x) * WALL_RESTITUTION;
      }
      if (prop.position.z < ROOM.minZ + r) {
        prop.position.z = ROOM.minZ + r;
        data.velocity.z = Math.abs(data.velocity.z) * WALL_RESTITUTION;
      } else if (prop.position.z > ROOM.maxZ - r) {
        prop.position.z = ROOM.maxZ - r;
        data.velocity.z = -Math.abs(data.velocity.z) * WALL_RESTITUTION;
      }
      if (prop.position.y > ROOM.height - r) {
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
    bounds,
    room,
    park,
    furniture,
    ball: furniture.ball,
    lighting,
    character,
    update,
    setTheme: (key) => lighting.setTheme(key),
    getTheme: () => lighting.getTheme(),
    resetProps: () => grabbables.forEach(resetProp),
  };
}
