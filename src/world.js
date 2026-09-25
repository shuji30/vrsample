import * as THREE from 'three';
import { createTextures } from './textures.js';
import { createRoom, ROOM } from './room.js';
import { createPark, PARK, COURT_BACKSTOP } from './park.js';
import { KART_TRACK, groundHeight } from './karttrack.js';
import { createKart, gridSlot } from './kart.js';
import { createKartGame } from './kartgame.js';
import { createFurniture, TABLE } from './furniture.js';
import { createLighting } from './lighting.js';
import { createCharacter } from './character.js';
import { createCatchGame } from './catchball.js';
import { createVoice } from './voice.js';
import { createRacketPhysics, createRacket, createTennisBall, createBallBasket, NET, hitsNet, surfaceBounce, addMagnus, spinBounce } from './tennis.js';
import { createTennisGame, HER_RACKET_SPOT } from './tennisgame.js';
import { createImpactSound } from './audio.js';
import { createKartRace } from './kartrace.js';
import { createBike } from './bike.js';
import { BIKE_TRACK, bikeGridSlot } from './biketrack.js';
import { createBikeGame } from './bikegame.js';
import { createSeesaw } from './seesaw.js';
import { createSeesawGame } from './seesawgame.js';
import { createBuranko } from './buranko.js';
import { createBurankoGame } from './burankogame.js';
import { createPond, createFishing, inPond, outOfPond } from './pond.js';
import { createFishingGame } from './fishinggame.js';
import { createStable, stableBlocks, HORSE_PARK, PADDOCK } from './stable.js';
import { createHorse } from './horse.js';
import { createHorseGame } from './horsegame.js';
import { createCarousel, carouselBlocks } from './carousel.js';
import { createCarouselGame } from './carouselgame.js';
import { createCircuit } from './circuit.js';
import { createGT3 } from './gt3.js';
import { createGT3Race } from './gt3race.js';
import { createCorgi } from './corgi.js';
import { createFireworks } from './fireworks.js';

/**
 * 女の子のカートの性能の倍率（最高速・加速・グリップ）。ふつうのカートの性能では、
 * 上手に走っても 3 周 43 秒ほどで「遅すぎる」と言われた。前をふさがれずに走って 3 周 34.3 秒（コースの起伏込み）
 * （スタートの枠から、合図の緑からゴールまで）になるよう、実際に走らせて合わせた
 */
const HER_KART_PERF = { top: 1.41, accel: 2.0, grip: 1.49 };
import { DEFAULT_THEME, THEMES } from './themes.js';

/**
 * 部屋と、窓の外の公園と、照明をまとめて組み立てる。
 *
 * 物理は相変わらず重力と着地だけの数十行。物理エンジンを入れないのは、
 * つかんで投げて戻る、という遊びにはこれで足り、フレーム落ちの原因を
 * 一つ減らせるから。
 */

/** 庭の広さ。歩いて出られる範囲で、公園の遊具や木は柵の向こう側に残る */
const GARDEN = { minX: -6.0, maxX: 6.0 };

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
/** ネットに当たったときの反発（網なので、ほとんど跳ね返らない） */
const NET_RESTITUTION = 0.12;

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
  voice: voiceOn = true,
} = {}) {
  const tex = createTextures(renderer, { quality: textureQuality });

  const room = createRoom(scene, tex);
  const park = createPark(scene, tex);

  let lighting = null;
  // 時間帯。夜のあいだは花火を上げる（fireworks は下で作る）
  let themeKey = DEFAULT_THEME;
  let fireworks = null;
  function applyTheme(key) {
    themeKey = key;
    if (lighting) lighting.setTheme(key);
    if (fireworks) fireworks.active = key === 'night';
    // 夜は沖の灯台が光る
    park?.hill?.setNight(key === 'night');
  }
  const furniture = createFurniture(scene, tex, (key) => applyTheme(key));

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
  // 女の子の声（音声合成 + 口の動き + 吹き出し）。?voice=off で声だけ切る
  const voice = camera ? createVoice({ character, scene, camera, muted: !voiceOn }) : null;
  // 庭に出るとキャッチボールが始まる（プレイヤーの頭 = camera の位置で判定）
  const catchGame = camera
    ? createCatchGame({ character, ball: furniture.ball, camera, scene, voice })
    : null;

  const { grabbables, buttons } = furniture;

  // 女の子のラケット。コートの向こう側のネットポストの脇に、面を上にして置いてある。
  // プレイヤーはつかめない（女の子がテニスのときに拾って使う）
  const herRacket = createRacket({ color: 0xd9588f, name: 'herRacket' });
  herRacket.userData.grabbable = false;
  herRacket.userData.label = '女の子のラケット';
  herRacket.userData.home.copy(HER_RACKET_SPOT).setY(herRacket.userData.halfSize);
  herRacket.userData.homeQuaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),
  ));
  herRacket.position.copy(herRacket.userData.home);
  herRacket.quaternion.copy(herRacket.userData.homeQuaternion);
  scene.add(herRacket);
  grabbables.push(herRacket);

  // ボールかご（手前のコートの左後ろ、防球ネットの前）に 12 個、コートに 3 個の
  // テニスボールを置いておく。打ち損じても、かごから次の球を出せる
  const basket = createBallBasket();
  basket.group.position.set(COURT_BACKSTOP.minX + 0.9, 0, COURT_BACKSTOP.z - 1.0);
  scene.add(basket.group);
  basket.group.updateMatrixWorld(true);
  for (let i = 0; i < 12; i++) {
    const ball = createTennisBall();
    basket.slotWorld(i, ball.userData.home);
    ball.position.copy(ball.userData.home);
    scene.add(ball);
    grabbables.push(ball);
    basket.add(ball);
  }
  for (const [x, z] of [[1.3, -17.2], [-0.9, -16.4], [2.3, -19.6]]) {
    const ball = createTennisBall();
    ball.userData.home.set(x, ball.userData.halfSize, z);
    ball.position.copy(ball.userData.home);
    scene.add(ball);
    grabbables.push(ball);
  }
  const tennisBalls = grabbables.filter((prop) => prop.userData.tennis);

  // カート 2 台。女の子のカートは速め（HER_KART_PERF）。スタートの枠の前（プレイヤー、青）と後ろ（女の子、ピンク）に置く
  const karts = {
    player: createKart({ color: 0x2b6fd6, number: '1', name: 'playerKart' }),
    her: createKart({ color: 0xe0609a, number: '2', name: 'herKart', perf: HER_KART_PERF }),
  };
  for (const [kart, slot] of [[karts.player, 0], [karts.her, 1]]) {
    const g = gridSlot(slot);
    kart.place(g.x, g.z, g.yaw);
    scene.add(kart.group);
  }
  // ポケバイ（プレイヤーが乗る）。スタートの線の後ろに置く
  const bike = createBike({ name: 'playerBike' });
  {
    const g = bikeGridSlot();
    bike.place(g.x, g.z, g.yaw);
    scene.add(bike.group);
  }
  // プレイヤーがポケバイに乗ると、女の子はコースの横で応援して、ラップを計る
  const bikeGame = camera ? createBikeGame({ character, bike, voice, scene }) : null;
  if (bikeGame) {
    bikeGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // シーソー（庭の左の芝生）。プレイヤーが片方に乗ると、女の子が反対に座る
  const seesaw = createSeesaw();
  scene.add(seesaw.group);
  const seesawGame = camera ? createSeesawGame({ character, seesaw, voice }) : null;
  if (seesawGame) {
    seesawGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // 夜の花火（公園の奥の空）。開いたら、女の子がときどき声をあげる
  let fireworksShown = false;
  fireworks = createFireworks({
    scene,
    onBurst: () => {
      if (!fireworksShown) { fireworksShown = voice?.say('fireworksStart') ?? true; return; }
      voice?.say('fireworksBurst', { chance: 0.35 });
    },
  });
  fireworks.active = themeKey === 'night';

  // 二人乗りのブランコ（シーソーの左）。プレイヤーが右の席に乗ると、女の子が左の席に乗る
  const buranko = createBuranko();
  scene.add(buranko.group);
  const burankoGame = camera ? createBurankoGame({ character, buranko, voice }) : null;
  if (burankoGame) {
    burankoGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // 庭の左の池と釣り。プレイヤーが桟橋のベンチの右に座ると、女の子が左に座って一緒に釣る
  scene.add(createPond());
  let fishingGame = null;
  const fishing = createFishing({
    scene,
    onEvent: (kind, info) => {
      if (!fishingGame?.seated) return;
      const n = info ? `${info.name} ${info.cm}センチ` : '';
      if (kind === 'bite') voice?.say('fishingBite');
      // 声では魚の名前だけ（大きさは吹き出しに出す。VOICEVOX の声を前もって作っておけるように）
      else if (kind === 'caught') voice?.say('fishingCaught', { n, spoken: info?.name });
      else if (kind === 'escaped') voice?.say('fishingEscaped', { chance: 0.7 });
      else if (kind === 'girlCaught') voice?.say('fishingGirlCaught', { n, spoken: info?.name });
    },
  });
  fishingGame = camera ? createFishingGame({ character, fishing, voice }) : null;
  if (fishingGame) {
    fishingGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // 丘の東のふもとのサーキットと GT3。家の右の芝生に飾ってある GT3 に乗ると、暗くなって
  // サーキットのグリッドへ移る（女の子も自分の GT3 で並ぶ）。降りると、暗くなって丘の上へ戻る
  const circuit = createCircuit();
  scene.add(circuit.group);
  const GT3_PARK = { x: 14.5, z: -0.6, yaw: -Math.PI / 2, y: 0.08 };   // y は飾り台の上面
  const gt3 = createGT3({ park: GT3_PARK });
  scene.add(gt3.group);
  {
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.3, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.6, metalness: 0.3 }));
    stage.position.set(GT3_PARK.x, 0.02, GT3_PARK.z);
    stage.receiveShadow = true;
    scene.add(stage);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 192;
    const x = c.getContext('2d');
    x.fillStyle = '#16203a'; x.fillRect(0, 0, 512, 192);
    x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center';
    x.fillText('サーキットへ', 256, 84);
    x.font = '30px sans-serif';
    x.fillText('GT3 に乗ると移動します', 256, 150);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    sign.position.set(GT3_PARK.x + 3.8, 1.5, GT3_PARK.z);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    post.position.set(GT3_PARK.x + 3.85, 0.55, GT3_PARK.z);
    scene.add(post);
  }
  const gt3Race = camera ? createGT3Race({ scene, character, playerCar: gt3, circuit, voice }) : null;
  // 移るときに画面を暗くする幕（カメラの子。VR でも頭についてくる）
  const fader = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }),
  );
  fader.renderOrder = 10000;
  fader.frustumCulled = false;
  fader.visible = false;
  camera?.add(fader);
  let fade = 0;
  const blackout = () => { fade = 1.4; fader.visible = true; fader.material.opacity = 1; };

  // 放し飼いのコーギー「こむぎ」。庭と公園を歩きまわり、ときどき全力で走りまわる
  const corgiEye = new THREE.Vector3();
  const corgi = camera ? createCorgi({
    scene,
    clamp: (x, z, inset, from) => clampToBounds(x, z, inset, from),
    groundHeight: (x, z) => groundHeight(x, z),
    playerPosition: () => camera.getWorldPosition(corgiEye),
    // 女の子がサーキットにいるあいだは、ついていかない
    girlPosition: () => (character.body.loaded && !gt3Race?.active ? character.body.position : null),
    ball: furniture.ball,
    voice,
    areas: [
      { minX: -5.5, maxX: 5.5, minZ: -13, maxZ: -4.5 },     // 庭
      { minX: 6.5, maxX: 21, minZ: -5, maxZ: 4 },           // 家の右（GT3 の所）
      { minX: -16, maxX: -6.5, minZ: -5.5, maxZ: 4.5 },     // 家の左（メリーゴーランドのまわり）
      { minX: -16.5, maxX: -6, minZ: -13.5, maxZ: -6 },     // 遊び場
      { minX: -30, maxX: -17.5, minZ: -8, maxZ: -6 },       // 池のほとり
    ],
  }) : null;
  let corgiMode = '';

  // 家の左の芝生のメリーゴーランド。プレイヤーが木馬に乗ると、女の子がすぐ内側の馬車に座る
  const carousel = createCarousel();
  scene.add(carousel.group);
  let carouselRidden = false;
  const carouselGame = camera ? createCarouselGame({ character, carousel, voice }) : null;
  if (carouselGame) {
    carouselGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // 池の奥の厩と馬場。馬に乗ると、はじめは女の子が引き馬で 1 周、そのあとは自分で乗る
  const stable = createStable();
  scene.add(stable.group);
  let horseGame = null;
  let horseRidden = false;
  const horse = createHorse({ paddock: PADDOCK, park: HORSE_PARK, onGait: (g, prev) => horseGame?.onGait(g, prev) });
  scene.add(horse.group, horse.reins, horse.leadRope);
  horseGame = camera ? createHorseGame({ character, horse, voice }) : null;
  if (horseGame) {
    horseGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // プレイヤーがカートに乗ると、女の子もピンクのカートに乗る。スタートの枠に並ぶとレース
  const kartRace = camera ? createKartRace({ scene, playerKart: karts.player, herKart: karts.her, voice }) : null;
  const kartGame = camera
    ? createKartGame({
      character, kart: karts.her, playerKart: karts.player, voice, race: kartRace,
      clamp: (x, z, from) => clampToBounds(x, z, 0.75, from),
    })
    : null;
  if (kartGame) {
    kartGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

  // テニス。プレイヤーがラケットを持ってコートに入ると、キャッチボールから体を引き取る
  const tennisGame = camera
    ? createTennisGame({
      character, balls: tennisBalls, racket: herRacket, playerRacket: furniture.racket, camera, scene, voice,
    })
    : null;
  if (tennisGame) {
    tennisGame.onFinish = () => {
      character.watch(furniture.ball);
      catchGame?.resume();
    };
  }

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
    // 庭は手前の防球ネットのすぐ前まで
    { minX: GARDEN.minX, maxX: GARDEN.maxX, minZ: COURT_BACKSTOP.z + 0.05, maxZ: outerZ - 0.2 },
    // 庭の奥のテニスコート（外まわりまで）。左右と奥は柵、手前は防球ネットなので、
    // ここが境目になる。庭とはネットの右端の入口だけでつながる
    courtRegion(),
    // 入口。ネットの右端から右の柵まで。コートと庭の両方へ 1m ほど食い込ませる
    // （inset で縮めても継ぎ目が切れないように）
    {
      minX: COURT_BACKSTOP.maxX, maxX: COURT_BACKSTOP.gapMaxX,
      minZ: COURT_BACKSTOP.z - 1.2, maxZ: COURT_BACKSTOP.z + 1.0,
    },
    // 庭の右のカートコース。庭（x 6 まで）と 1m 重ねてつなぐ（inset 0.25 で両側から縮めても
    // 継ぎ目が切れないように。0.2m だと庭の端で止まった）。テニスコートの右の柵
    // （x 4.5）とのあいだは庭の芝で、コートの外まわりとは重ならない
    { ...KART_TRACK.area },
    // 庭の左のポケバイのコース（と、その手前の芝生）。庭（x -6 から）と 1m 重ねてつなぐ。
    // テニスコートの左の柵（x -4.5）とは重ならない
    { ...BIKE_TRACK.area },
    // さらに左の池のまわり（pond.js）。ポケバイの範囲と 0.5m 重ねる。左の生け垣は x -32.5。
    // 池の水の上は clampToBounds の最後で外す（桟橋の上は歩ける）
    { minX: -31.5, maxX: -16.5, minZ: -33.5, maxZ: -5.5 },
    // 家の左の芝生（メリーゴーランド）。庭（x -6 まで）と 0.5m、ポケバイの範囲（z -5.5 まで）と 0.5m 重ねる。
    // 家（x -3 から）には重ならない。回転台の上は clampToBounds で外す
    { minX: -16.5, maxX: -5.5, minZ: -6.0, maxZ: 5.0 },
    // 家の右の芝生（GT3 を飾っておく所）。庭（x 6 まで）と 0.5m、カートコースの範囲（z -5 まで）と 0.6m 重ねる
    { minX: 5.5, maxX: 22.0, minZ: -5.6, maxZ: 4.5 },
  ];

  function courtRegion() {
    const c = PARK.court;
    const halfW = c.width / 2 + c.runoffSide;
    const halfL = c.length / 2 + c.runoffEnd;
    return { minX: c.x - halfW, maxX: c.x + halfW, minZ: c.z - halfL, maxZ: COURT_BACKSTOP.z };
  }

  /**
   * 与えた点を、歩ける範囲へ寄せる。inset は物の半径ぶんの余白（壁にめり込ませないため）。
   *
   * from（直前にいた点）を渡すと、はみ出したときは from のいた矩形の中で寄せる
   * （壁に沿って滑る）。渡さなければ、いちばん近い矩形へ寄せる。
   *
   * from が要るのは、防球ネットのように薄い仕切りの両側で矩形が近いとき。VR の頭は
   * 余白 0 で判定するので、コート側と庭側の矩形が 5cm しか離れておらず、ターンや
   * 身を乗り出した拍子にネットの線を少し越えると、「いちばん近い矩形」が向こう側に
   * なって、ネットの外へ出てしまった。
   */
  function clampToBounds(x, z, inset = 0, from = null) {
    const p = clampToRegions(x, z, inset, from);
    // 池の水の上には入れない（縁の石のぶん 0.2m 広く見る）。直前の点が池の外なら、
    // 縁に沿って滑らせる（桟橋の先から横へ落ちたとき、縁まで大きく飛ばさないように）
    // 厩の建物と馬場の柵、メリーゴーランドの回転台も同じように（馬場の入口は通れる）
    // 飾ってある GT3（丘の上にあるとき）も、歩いて通り抜けない
    const gt3Blocks = (x, z) => !gt3.state.atCircuit && Math.abs(x - GT3_PARK.x) < 2.5 + inset && Math.abs(z - GT3_PARK.z) < 1.2 + inset;
    const solid = (x, z) => stableBlocks(x, z, inset) || carouselBlocks(x, z, inset) || gt3Blocks(x, z);
    if (solid(p.x, p.z)) {
      if (!from || solid(from.x, from.z)) return p;
      if (!solid(p.x, from.z)) return { x: p.x, z: from.z };
      if (!solid(from.x, p.z)) return { x: from.x, z: p.z };
      return { x: from.x, z: from.z };
    }
    const m = inset + 0.2;
    if (!inPond(p.x, p.z, m)) return p;
    if (from && !inPond(from.x, from.z, m)) {
      if (!inPond(p.x, from.z, m)) return { x: p.x, z: from.z };
      if (!inPond(from.x, p.z, m)) return { x: from.x, z: p.z };
      return { x: from.x, z: from.z };
    }
    return outOfPond(p.x, p.z, m);
  }
  function clampToRegions(x, z, inset = 0, from = null) {
    let best = null;
    let bestDistance = Infinity;
    let home = null;
    let homeDistance = Infinity;
    for (const region of regions) {
      const minX = region.minX + inset;
      const maxX = region.maxX - inset;
      const minZ = region.minZ + inset;
      const maxZ = region.maxZ - inset;
      if (maxX < minX || maxZ < minZ) continue;
      const cx = Math.min(Math.max(x, minX), maxX);
      const cz = Math.min(Math.max(z, minZ), maxZ);
      const distance = (cx - x) ** 2 + (cz - z) ** 2;
      if (distance === 0) return { x, z };          // 中にいる
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: cx, z: cz };
      }
      // 直前にいた矩形（少しはみ出していても、その矩形のそばにいたなら）
      if (from) {
        const fx = Math.min(Math.max(from.x, minX), maxX);
        const fz = Math.min(Math.max(from.z, minZ), maxZ);
        const away = (fx - from.x) ** 2 + (fz - from.z) ** 2;
        if (away < 1e-4 && distance < homeDistance) {
          homeDistance = distance;
          home = { x: cx, z: cz };
        }
      }
    }
    return home ?? best ?? { x, z };
  }

  const tmp = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();
  const spinStep = new THREE.Quaternion();

  /** 小物を初期位置に戻す。 */
  function resetProp(prop) {
    const data = prop.userData;
    prop.position.copy(data.home);
    if (data.homeQuaternion) prop.quaternion.copy(data.homeQuaternion);
    else prop.rotation.set(0, 0, 0);
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
  }

  // 影を落とす範囲。プレイヤーがテニスコートへ出たらコートへ寄せ、庭へ
  // 戻ったら家のまわりへ戻す。境目に 2m の遊びをつけて、行き来でちらつかせない
  const courtNear = PARK.court.z + PARK.court.length / 2 + PARK.court.runoffEnd;
  const eye = new THREE.Vector3();
  let shadowOnCourt = false;
  // カートコースへ出たら、コースの真ん中へ寄せる
  let shadowAt = 'house';
  function updateShadowFocus() {
    if (!camera) return;
    // サーキットにいるあいだは、プレイヤーの車のまわりに影を落とす
    if (gt3.state.atCircuit) {
      lighting.setShadowFocus(gt3.group.position.x, gt3.group.position.z);
      shadowAt = 'circuit';
      return;
    }
    camera.getWorldPosition(eye);
    let next = shadowAt;
    if (eye.x > KART_TRACK.area.minX + 1.5) next = 'kart';
    else if (eye.x < -5.5 && eye.x > -18.5 && eye.z > -6.5) next = 'carousel';
    else if ((eye.x < -18.5 || (shadowAt === 'stable' && eye.x < -17)) && eye.z < -17.5) next = 'stable';
    else if (eye.x < -18.5 || (shadowAt === 'pond' && eye.x < -17)) next = 'pond';
    else if (eye.x < BIKE_TRACK.area.maxX - 1.5 && eye.z < -13.5) next = 'bike';
    else if (eye.x < KART_TRACK.area.minX - 0.5 || shadowAt !== 'kart') {
      if (shadowAt !== 'court' && eye.z < courtNear - 1.0) next = 'court';
      else if (shadowAt === 'court' && eye.z > courtNear + 1.0) next = 'house';
      else if (shadowAt === 'kart' || shadowAt === 'bike' || shadowAt === 'pond' || shadowAt === 'stable' || shadowAt === 'carousel' || shadowAt === 'circuit') next = eye.z < courtNear - 1.0 ? 'court' : 'house';
    }
    if (next === shadowAt) return;
    shadowAt = next;
    shadowOnCourt = next === 'court';
    if (next === 'kart') lighting.setShadowFocus(16.5, -19.5);
    else if (next === 'bike') lighting.setShadowFocus(-11.5, -22.5);
    else if (next === 'pond') lighting.setShadowFocus(-24.0, -11.0);
    else if (next === 'stable') lighting.setShadowFocus(-25.0, -26.0);
    else if (next === 'carousel') lighting.setShadowFocus(-9.5, -1.5);
    else if (next === 'court') lighting.setShadowFocus(PARK.court.x, PARK.court.z + 1.5);
    else lighting.setShadowFocus(0, -3.0);
  }

  // ラケットで打つ。打った音と弾む音は、聞いている位置（camera）からの距離で小さくする
  const impact = createImpactSound();
  const hearing = new THREE.Vector3();
  function soundAt(position, kind, strength) {
    if (!camera) return;
    camera.getWorldPosition(hearing);
    const falloff = 1 / (1 + hearing.distanceTo(position) / 3);
    impact.play(kind, strength * falloff);
  }
  const rackets = grabbables.filter((prop) => prop.userData.racket);
  const racketHits = [];
  const racketPhysics = createRacketPhysics({
    rackets,
    balls: tennisBalls,
    onHit: (hit) => {
      soundAt(hit.position, 'racket', Math.min(1, 0.3 + hit.speed / 14));
      tennisGame?.onRacketHit(hit);
      for (const listener of racketHits) listener(hit);
    },
  });

  /**
   * 手前の防球ネット。網の線（z 一定）をまたいだ球を、網のあるところ（入口を除く・
   * 高さ 3m まで）で止める。網なので、ほとんど跳ね返らずに下へ落ちる
   */
  function backstopCollision(prop, prevZ) {
    const data = prop.userData;
    const r = data.halfSize;
    const b = COURT_BACKSTOP;
    const x = prop.position.x;
    if (x < b.minX || x > b.maxX || prop.position.y > b.height) return;
    const before = prevZ - b.z;
    const after = prop.position.z - b.z;
    if (!((before > r && after < r) || (before < -r && after > -r))) return;
    const side = Math.sign(before);
    prop.position.z = b.z + side * r;
    data.velocity.z = -data.velocity.z * NET_RESTITUTION;
    data.velocity.x *= 0.5;
    data.velocity.y *= 0.4;
    data.spin.multiplyScalar(0.3);
    soundAt(prop.position, 'net', Math.min(1, Math.abs(data.velocity.z) / 2 + 0.2));
  }

  /** ネットを通り抜けようとした球を止める（tennis.js の hitsNet で網をまたいだかを見る） */
  function netCollision(prop, prevZ) {
    const data = prop.userData;
    if (!hitsNet(prevZ, prop.position, data.halfSize)) return;
    const side = Math.sign(prevZ - NET.z);
    prop.position.z = NET.z + side * data.halfSize;
    data.velocity.z = -data.velocity.z * NET_RESTITUTION;
    data.velocity.x *= 0.5;
    data.velocity.y *= 0.5;
    data.spin.multiplyScalar(0.3);
    soundAt(prop.position, 'net', Math.min(1, Math.abs(data.velocity.z) / 2 + 0.2));
    tennisGame?.onBallNet(prop);
  }

  const flatQuaternion = new THREE.Quaternion();
  const flatMatrix = new THREE.Matrix4();
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  /** 床に落ちたラケットを、面を上か下にして寝かせる */
  function layFlat(prop, dt) {
    axisY.set(0, 1, 0).applyQuaternion(prop.quaternion);
    axisY.y = 0;
    if (axisY.lengthSq() < 1e-6) axisY.set(1, 0, 0).applyQuaternion(prop.quaternion).setY(0);
    if (axisY.lengthSq() < 1e-6) axisY.set(1, 0, 0);
    axisY.normalize();
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(prop.quaternion).y >= 0 ? 1 : -1;
    axisZ.set(0, up, 0);
    axisX.crossVectors(axisY, axisZ);
    flatQuaternion.setFromRotationMatrix(flatMatrix.makeBasis(axisX, axisY, axisZ));
    prop.quaternion.slerp(flatQuaternion, Math.min(1, dt * 12));
    prop.userData.spin.set(0, 0, 0);
  }

  function update(dt) {
    updateShadowFocus();
    // 暗くした幕を、少し待ってから明ける
    if (fade > 0) {
      fade = Math.max(0, fade - dt / 0.9);
      fader.material.opacity = Math.min(1, fade * 1.5);
      fader.visible = fade > 0;
    }
    // サーキットにいるあいだは、女の子はレースだけ（庭の遊びは止めておく）
    if (gt3Race?.active) gt3Race.update(dt);
    else {
    // カートがいちばん先。テニスの最中なら、テニスを片づけ終わってから（ラケットを戻して）
    if (kartGame?.wanted && !kartGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        kartGame.start();
      }
    }
    // ポケバイはカートの次。カートで遊んでいないときに
    if (!kartGame?.active && bikeGame?.wanted && !bikeGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        bikeGame.start();
      }
    }
    // シーソーも同じ
    if (!kartGame?.active && !bikeGame?.active && seesawGame?.wanted && !seesawGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        seesawGame.start();
      }
    }
    // ブランコも同じ
    if (!kartGame?.active && !bikeGame?.active && !seesawGame?.active && burankoGame?.wanted && !burankoGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        burankoGame.start();
      }
    }
    // 釣りも同じ
    if (!kartGame?.active && !bikeGame?.active && !seesawGame?.active && !burankoGame?.active && fishingGame?.wanted && !fishingGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        fishingGame.start();
      }
    }
    // 乗馬も同じ
    if (!kartGame?.active && !bikeGame?.active && !seesawGame?.active && !burankoGame?.active && !fishingGame?.active && horseGame?.wanted && !horseGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        horseGame.start();
      }
    }
    // メリーゴーランドも同じ
    if (!kartGame?.active && !bikeGame?.active && !seesawGame?.active && !burankoGame?.active && !fishingGame?.active && !horseGame?.active && carouselGame?.wanted && !carouselGame.active) {
      if (tennisGame?.active) tennisGame.stop();
      else {
        catchGame?.suspend();
        carouselGame.start();
      }
    }
    if (!kartGame?.active && !bikeGame?.active && !seesawGame?.active && !burankoGame?.active && !fishingGame?.active && !horseGame?.active && !carouselGame?.active && tennisGame && !tennisGame.active && tennisGame.wanted) {
      catchGame?.suspend();
      tennisGame.start();
    }
    // ブランコの女の子の席は、女の子を座らせる（burankoGame）前に進める。あとで進めると、
    // 体と手が 1 フレーム前の席と鎖に合わせたままになり、こいでいるあいだ手が鎖から離れて見えた
    buranko.updateGirl(dt);
    if (kartGame?.active) kartGame.update(dt);
    else if (bikeGame?.active) { /* 下で動かす */ } else if (seesawGame?.active) seesawGame.update(dt);
    else if (burankoGame?.active) burankoGame.update(dt);
    else if (fishingGame?.active) fishingGame.update(dt);
    else if (horseGame?.active) horseGame.update(dt);
    else if (carouselGame?.active) carouselGame.update(dt);
    else if (tennisGame?.active) tennisGame.update(dt);
    else catchGame?.update(dt);
    }
    // ポケバイは、女の子が見ていないあいだもラップを数えて、表示を出す
    bikeGame?.update(dt);
    // プレイヤーが乗っていないシーソーは、ゆっくりプレイヤーの側へ下りて止まる
    if (!seesawGame?.wanted) seesaw.update(dt, {});
    fireworks.update(dt, camera);
    park.hill.update(dt);
    // こむぎ。走りまわりはじめたら、近くの女の子が声をあげる
    if (corgi) {
      corgi.update(dt);
      if (corgi.mode !== corgiMode && corgi.mode === 'zoomies' && !gt3Race?.active
        && character.body.position.distanceTo(corgi.position) < 10) voice?.say('corgiZoom', { chance: 0.6 });
      corgiMode = corgi.mode;
    }
    // ブランコ：プレイヤーの席は乗っていないときだけ、ここで動かす（女の子の席は上で先に）
    if (!burankoGame?.wanted) buranko.settle(dt);
    // 女の子の竿（座って釣っているあいだだけ出す）
    fishing.updateGirl(dt, Boolean(fishingGame?.seated));
    // 厩の白い馬と、乗っていないときの馬（その場で草を食む）
    stable.update(dt);
    if (!horseRidden) horse.idle(dt);
    // メリーゴーランド：乗っていないときは止まるまでゆるめる。音楽は聞く人との距離で
    if (!carouselRidden) carousel.idle(dt);
    if (camera) carousel.listen(camera.getWorldPosition(hearing));
    kartRace?.update(dt, { driving: Boolean(kartGame?.wanted), seated: Boolean(kartGame?.driving) });
    // カートコースの起伏の上を歩くときは、足元を地面の高さに（カートに乗り降りしているあいだは除く）
    if (character.body.loaded && !['getIn', 'drive', 'stopKart', 'getOut'].includes(kartGame?.state)) {
      const bp = character.body.position;
      const a = KART_TRACK.area;
      if (bp.x > a.minX && bp.x < a.maxX && bp.z > a.minZ && bp.z < a.maxZ) bp.y = groundHeight(bp.x, bp.z);
    }
    character.update(dt);
    tennisGame?.afterPose();
    voice?.update(dt);

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
      if (data.held || data.inBasket) continue;

      const prevY = prop.position.y;
      const prevX = prop.position.x;
      const prevZ = prop.position.z;

      // 空気抵抗。速さの二乗に比例するので、山なりに投げた球の飛距離と
      // 落ち際の速さがそれらしくなる。
      const speed = data.velocity.length();
      if (speed > 0.01) {
        const loss = Math.min(0.9, (data.drag ?? DRAG_DEFAULT) * speed * dt);
        data.velocity.multiplyScalar(1 - loss);
      }

      // マグヌス効果（回転で曲がる。tennis.js と先読みで同じ式を使う）
      addMagnus(data.velocity, data.spin, data, dt);

      data.velocity.y += GRAVITY * dt;
      prop.position.addScaledVector(data.velocity, dt);
      netCollision(prop, prevZ);
      backstopCollision(prop, prevZ);

      // 着地面。テーブルの真上から落ちてきたときだけ天板に乗る
      const dx = prop.position.x - TABLE.center.x;
      const dz = prop.position.z - TABLE.center.z;
      const onTable =
        Math.hypot(dx, dz) < TABLE.radius && prevY >= TABLE.top + data.halfSize - 1e-3;
      // 床（カートコースの起伏の上なら、その高さ）
      const surfaceY = onTable ? TABLE.top : groundHeight(prop.position.x, prop.position.z);
      const restY = surfaceY + data.halfSize;
      let grounded = false;

      if (prop.position.y <= restY + 1e-4) {
        prop.position.y = restY;
        if (data.velocity.y < 0) {
          const restitution = (data.restitution ?? RESTITUTION) * (data.spinBounce ? surfaceBounce(prop.position.x, prop.position.z) : 1);
          const bounce = -data.velocity.y * restitution;
          if (bounce < BOUNCE_STOP) {
            // ただ床に載っているだけ。ここで衝突の摩擦を掛けてはいけない。
            //
            // 落とし穴だった。接地中は毎フレーム重力で velocity.y が負になり、
            // この枝に入り続ける。以前は入るたびに水平成分へ FRICTION(0.78) を
            // 掛けていたので、転がり出したボールが 0.2 秒で止まっていた。
            // 転がっている間の減速は下の ROLL_FRICTION だけが受け持つ。
            data.velocity.y = 0;
          } else if (data.spinBounce) {
            spinBounce(data.velocity, data.spin, data, restitution);
            if (bounce > 0.8) soundAt(prop.position, 'bounce', Math.min(1, bounce / 5));
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
          const decel = (data.rolls ? data.rollFriction ?? ROLL_FRICTION : SLIDE_FRICTION) * dt;
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
        if (!(grounded && data.rolls)) data.spin.multiplyScalar(Math.max(0, 1 - dt * (data.spinDecay ?? 0.8)));
      }
      if (grounded && data.laysFlat) layFlat(prop, dt);

      // 壁。歩ける範囲と同じ形で押し戻し、押し戻した向きに速度を反射する。
      // 掃き出し窓の開口ぶんはここが空いているので、ボールは庭へ抜けていく。
      const r = data.halfSize;
      const clamped = clampToBounds(prop.position.x, prop.position.z, r, { x: prevX, z: prevZ });
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
      // （テニスコートの奥の柵が 30m 先にあるので、それより遠く）
      if (prop.position.y < -2 || tmp.length() > 45) resetProp(prop);
    }

    // --- ラケットで打つ ------------------------------------------------------
    racketPhysics.update(dt);
    basket.update(tennisBalls);
  }

  return {
    grabbables,
    interactables: [...grabbables.filter((prop) => prop.userData.grabbable), ...buttons, karts.player.body, bike.body, seesaw.body, buranko.body, fishing.body, horse.body, carousel.body, gt3.body, ...(corgi ? [corgi.body] : [])],
    floor: room.floor,
    /** 地面の高さ（カートコースの起伏。ほかは 0） */
    groundHeight,
    bounds: regions,
    clampToBounds,
    room,
    park,
    furniture,
    ball: furniture.ball,
    racket: furniture.racket,
    tennisBall: furniture.tennisBall,
    /** テニスボールすべて（机の 1 個・かごの 12 個・コートの 3 個） */
    tennisBalls,
    basket,
    karts,
    kartGame,
    kartRace,
    /** kartdrive.js から：プレイヤーがカートに乗った / 降りた */
    onKartEnter: (v) => {
      if (v === bike) { if (bikeGame) bikeGame.playerRiding = true; } else if (v === seesaw) { if (seesawGame) seesawGame.playerRiding = true; } else if (v === buranko) { if (burankoGame) burankoGame.playerRiding = true; } else if (v === fishing) { if (fishingGame) fishingGame.playerRiding = true; } else if (v === horse) { horseRidden = true; if (horseGame) horseGame.playerRiding = true; } else if (v === carousel) { carouselRidden = true; if (carouselGame) carouselGame.playerRiding = true; } else if (v === gt3) {
        // 暗くして、サーキットのグリッドへ。女の子も（していた遊びをやめて）自分の車へ
        blackout();
        if (tennisGame?.active) tennisGame.stop();
        catchGame?.suspend();
        gt3Race?.start();
        if (!gt3Race) gt3.placeOnCircuit(250, -3);
      } else if (kartGame) kartGame.playerDriving = true;
    },
    onKartExit: (v) => {
      if (v === bike) { if (bikeGame) bikeGame.playerRiding = false; } else if (v === seesaw) { if (seesawGame) seesawGame.playerRiding = false; } else if (v === buranko) { if (burankoGame) burankoGame.playerRiding = false; } else if (v === fishing) { fishing.leave(); if (fishingGame) fishingGame.playerRiding = false; } else if (v === horse) { horseRidden = false; horse.leave(); if (horseGame) horseGame.playerRiding = false; } else if (v === carousel) { carouselRidden = false; if (carouselGame) carouselGame.playerRiding = false; } else if (v === gt3) {
        // 暗くして、丘の上へ。車は飾っておく所に戻し、女の子は車の横に立ってから庭へ戻る
        blackout();
        gt3Race?.stop();
        gt3.parkAtHome();
        const b = character.body;
        b.position.set(GT3_PARK.x - 0.5, 0, GT3_PARK.z + 2.4);
        b.setYaw(Math.PI);
        character.watch(furniture.ball);
        catchGame?.resume();
      } else if (kartGame) kartGame.playerDriving = false;
    },
    seesaw,
    seesawGame,
    buranko,
    burankoGame,
    fishing,
    fishingGame,
    horse,
    horseGame,
    carousel,
    carouselGame,
    circuit,
    gt3,
    gt3Race,
    corgi,
    stable,
    bike,
    bikeGame,
    /** ラケットで打ったときに呼ばれる（{ racket, ball, speed, racketSpeed, by, position }） */
    onRacketHit: (listener) => racketHits.push(listener),
    lighting,
    character,
    catchGame,
    tennisGame,
    herRacket,
    voice,
    update,
    setTheme: (key) => applyTheme(key),
    /** 時間帯を順に替える（昼 → 夕方 → 夜 → 昼）。替えた先を返す */
    cycleTheme() {
      const keys = Object.keys(THEMES);
      const next = keys[(keys.indexOf(themeKey) + 1) % keys.length];
      applyTheme(next);
      return next;
    },
    get theme() { return themeKey; },
    fireworks,
    getTheme: () => lighting.getTheme(),
    // 持っている物はそのまま（手の子になっているので、位置を戻すと手元から飛ぶ）
    resetProps: () => grabbables.filter((prop) => !prop.userData.held).forEach(resetProp),
  };
}
