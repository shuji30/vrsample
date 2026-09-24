import * as THREE from 'three';
import { KART_TRACK, TRACK_LENGTH, trackPoint, trackTangent } from './karttrack.js';
import { gridSlot } from './kart.js';
import { createSignalSound } from './audio.js';

/**
 * 女の子とのカートレースの進行。
 *
 *   idle      … プレイヤーがスタートの枠（スタートの線の後ろ 8m まで、コースの上）に止まり、
 *                女の子も自分の枠で待っていれば、1.2 秒でスタートの合図へ
 *   countdown … ゲートの 3 つの灯りが 1 秒ごとに赤く点き（ピッ）、3 秒で全部緑（ポーン）。
 *                そのあいだはどちらのカートも動かない（フライングは無し）
 *   race      … 3 周。周回と順位を数える。女の子は抜いた・抜かれた・最後の周でしゃべる
 *   finish    … 2 台ともゴールしたら（女の子が先なら、プレイヤーを 25 秒まで待つ）、結果を
 *                6 秒出して idle へ。女の子は自分の枠へ戻って、次のレースを待つ
 *
 * 進み具合（progress）は「周」の単位で、スタートの線が 0。周を越えるたびに 1 増える。
 * コース上の位置 u（0..1）の変わりを、つなぎ目の飛びを直しながら足していく。
 *
 * 女の子のペース：ひとりで走って 3 周 34.3 秒ほど（ピンクのカートは性能を上げてある）。
 * 追い上げ（ラバーバンド）：後ろにいるときだけ、腕前を上げ、3m より離れていれば最高速も
 * 最大 1 割上げる。前にいるときは遅くしない。
 *
 * 表示：PC は画面の上に DOM、VR（と PC の一人称）はプレイヤーのカートのダッシュボードの
 * 小さな画面。ゲートの灯りはどちらでも見える。
 */

export const RACE = { laps: 3, countdown: 3, gridZone: 8, results: 6, waitPlayer: 25 };

const START_HOLD = 1.2;
/** 女の子のふだんの腕前（kartai の skill）。カートの性能（world.js の HER_KART_PERF）と合わせて、
 *  ひとりで走ると 3 周 34.3 秒ほど */
export const HER_SKILL = 0.9;
/** 抜いた・抜かれたとみなす差（m）。行ったり来たりで何度もしゃべらないように */
const PASS_MARGIN = 1.5;

/** a - b を -0.5..0.5 に（コースの 1 周を 1 とした差） */
const wrapDiff = (d) => d - Math.round(d);

export function createKartRace({ scene, playerKart, herKart, voice = null }) {
  const signal = createSignalSound();
  let state = 'idle';
  let timer = 0;
  let clock = 0;
  let holdTimer = 0;
  let resultText = '';
  let lastBeep = -1;
  let lastLapSaid = false;
  let leader = null;         // 'player' | 'her'（抜いた・抜かれたの判定用）
  let finishOrder = [];
  let herSkill = HER_SKILL;
  let herBoost = 1;
  let playerDriving = false;
  let herSeated = false;
  let gridAsked = false;

  const runners = {
    player: { kart: playerKart, progress: 0, prevU: 0, finished: false, time: 0 },
    her: { kart: herKart, progress: 0, prevU: 0, finished: false, time: 0 },
  };
  const slotHer = gridSlot(1);

  // --- ゲートの灯り ---------------------------------------------------------
  const lamps = [];
  const lampGroup = new THREE.Group();
  {
    const at = trackPoint(KART_TRACK.startAt);
    const t = trackTangent(KART_TRACK.startAt);
    lampGroup.position.set(at.x, 0, at.z);
    lampGroup.rotation.y = Math.atan2(t.x, t.z);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.36, 0.14), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 }));
    housing.position.set(0, 3.3, 0);
    lampGroup.add(housing);
    for (let i = 0; i < 3; i++) {
      const material = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000, roughness: 0.3 });
      // 箱（奥行き 0.14）より大きい球にして、前からも後ろからも見えるように
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), material);
      lamp.position.set((1 - i) * 0.36, 3.3, 0);   // 並んだカートから見て、左から点く
      lampGroup.add(lamp);
      lamps.push(material);
    }
    scene.add(lampGroup);
  }
  function setLamps(count, green = false) {
    lamps.forEach((m, i) => {
      const on = green || i < count;
      const color = green ? 0x2bff5a : 0xff2b2b;
      m.color.setHex(on ? color : 0x333333);
      m.emissive.setHex(on ? color : 0x000000);
      m.emissiveIntensity = on ? 1.4 : 0;
    });
  }
  setLamps(0);

  // --- 表示（PC の DOM と、ダッシュボードの画面） ------------------------------
  const hud = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (hud) {
    hud.id = 'race-hud';
    // 右上（真ん中の上だと、追いかけ視点でゲートの灯りに重なる）
    hud.style.cssText = 'position:fixed;right:16px;top:14px;padding:6px 18px;border-radius:10px;'
      + 'background:rgba(16,20,28,0.72);color:#fff;font:bold 20px/1.4 sans-serif;text-align:center;pointer-events:none;'
      + 'z-index:15;display:none;white-space:pre-line';
    document.body.appendChild(hud);
  }
  const dashCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let dashTexture = null;
  if (dashCanvas) {
    dashCanvas.width = 256;
    dashCanvas.height = 112;
    dashTexture = new THREE.CanvasTexture(dashCanvas);
    dashTexture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.114), new THREE.MeshBasicMaterial({ map: dashTexture, toneMapped: false }));
    // ダッシュボードの上、ハンドルの向こう側（一人称の目から、ハンドルの輪の中に見える高さ）。
    // カートの前は +Z なので、板の表（+Z）を運転席（-Z）へ向けてから、上へ少し起こす
    screen.position.set(0, 0.56, 0.86);
    screen.rotateY(Math.PI);
    screen.rotateX(-0.5);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.135, 0.025), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 }));
    back.position.set(0, 0, -0.014);
    screen.add(back);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.03), back.material);
    stand.position.set(0, 0.52, 0.89);
    playerKart.body.add(screen, stand);
  }
  let shownKey = '';
  function show(big, line) {
    const key = `${big}|${line}|${playerDriving}`;
    if (key === shownKey) return;
    shownKey = key;
    if (hud) {
      hud.style.display = playerDriving && (big || line) ? '' : 'none';
      hud.innerHTML = `${big ? `<div style="font-size:44px">${big}</div>` : ''}${line}`;
    }
    if (dashCanvas) {
      const ctx = dashCanvas.getContext('2d');
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, 256, 112);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = line.split('\n');
      if (big) {
        ctx.font = 'bold 52px sans-serif';
        ctx.fillStyle = big === 'GO!' ? '#5dff7a' : '#ff6b6b';
        ctx.fillText(big, 128, 40);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(lines[0] ?? '', 128, 90);
      } else {
        ctx.font = 'bold 26px sans-serif';
        lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, 128, 56 + (i - (Math.min(3, lines.length) - 1) / 2) * 32));
      }
      dashTexture.needsUpdate = true;
    }
  }

  // --- 進み具合 --------------------------------------------------------------
  function resetRunner(r) {
    r.prevU = r.kart.state.u;
    r.progress = wrapDiff(r.kart.state.u - KART_TRACK.startAt);
    r.finished = false;
    r.time = 0;
  }
  function track(r) {
    const u = r.kart.state.u;
    r.progress += wrapDiff(u - r.prevU);
    r.prevU = u;
  }
  /** プレイヤーがスタートの枠に止まっているか */
  function playerOnGrid() {
    const k = playerKart;
    const behind = -wrapDiff(k.state.u - KART_TRACK.startAt) * TRACK_LENGTH;
    return behind > 0 && behind < RACE.gridZone && Math.abs(k.state.lateral) < KART_TRACK.width / 2 && Math.abs(k.speed) < 0.3;
  }
  /** 女の子が自分の枠に止まっているか */
  function herOnSlot() {
    const p = herKart.group.position;
    return Math.hypot(p.x - slotHer.x, p.z - slotHer.z) < 0.5 && Math.abs(herKart.speed) < 0.3;
  }
  const lapOf = (r) => Math.min(RACE.laps, Math.max(1, Math.floor(r.progress) + 1));
  /** プレイヤーの順位（ゴールした順が先、まだなら進み具合で） */
  function position() {
    if (finishOrder.includes('player')) return finishOrder.indexOf('player') + 1;
    if (runners.her.finished) return 2;
    return runners.player.progress >= runners.her.progress ? 1 : 2;
  }

  // --- 毎フレーム ------------------------------------------------------------
  function update(dt, { driving, seated }) {
    clock += dt;
    playerDriving = driving;
    herSeated = seated;
    if (!driving && state !== 'idle') abort();

    switch (state) {
      case 'idle': {
        setLamps(0);
        if (!driving) { show('', ''); break; }
        const ready = seated && herOnSlot();
        const onGrid = playerOnGrid();
        holdTimer = ready && onGrid ? holdTimer + dt : 0;
        if (ready && !onGrid && !gridAsked) { voice?.say('raceGrid'); gridAsked = true; }
        show('', !seated ? '女の子がカートに乗るのを待っています'
          : !ready ? '女の子がスタートの枠へ戻っています'
            : onGrid ? 'まもなくスタート' : `スタートの枠に止まると\nレースが始まります（${RACE.laps} 周）`);
        if (holdTimer > START_HOLD) startCountdown();
        break;
      }
      case 'countdown': {
        timer += dt;
        const n = Math.floor(timer);
        if (n !== lastBeep && n < RACE.countdown) {
          lastBeep = n;
          signal.beep(false);
          setLamps(n + 1);
        }
        show(String(RACE.countdown - Math.min(RACE.countdown - 1, n)), `${RACE.laps} 周のレース`);
        if (timer >= RACE.countdown) {
          state = 'race';
          timer = 0;
          signal.beep(true);
          setLamps(3, true);
          voice?.say('raceGo');
          resetRunner(runners.player);
          resetRunner(runners.her);
          leader = null;
        }
        break;
      }
      case 'race': {
        timer += dt;
        if (timer > 2.5) setLamps(0);
        for (const [name, r] of Object.entries(runners)) {
          track(r);
          if (!r.finished && r.progress >= RACE.laps) {
            r.finished = true;
            r.time = timer;
            finishOrder.push(name);
            // 勝ち負けは、先にゴールしたほうが決まったときに 1 回だけ言う
            if (finishOrder.length === 1) voice?.say(name === 'player' ? 'racePlayerWin' : 'raceHerWin');
          }
        }
        const p = runners.player;
        const h = runners.her;
        // 抜いた・抜かれた（ゴールしたあとは言わない）
        if (!p.finished && !h.finished) {
          const gap = (p.progress - h.progress) * TRACK_LENGTH;
          if (leader !== 'player' && gap > PASS_MARGIN) { if (leader) voice?.say('raceOvertaken'); leader = 'player'; }
          if (leader !== 'her' && gap < -PASS_MARGIN) { if (leader) voice?.say('racePass'); leader = 'her'; }
          if (!lastLapSaid && Math.max(p.progress, h.progress) >= RACE.laps - 1) { voice?.say('raceLastLap'); lastLapSaid = true; }
          // 追い上げ：プレイヤーより前にいるほど遅く、後ろにいるほど速く
          // 前にいても遅くはしない（決めたペースで走る。以前は前に離れるほど遅くしていて、
          // 「遅すぎる」と言われた）。後ろにいるときだけ、腕前を上げて追う
          herSkill = THREE.MathUtils.clamp(HER_SKILL + Math.max(0, gap) * 0.02, HER_SKILL, 1.0);
          // 3m より離れて後ろにいるときは、最高速も少し上げる（最大 1 割）。腕前を上げるだけでは、
          // 最高速が同じなので追いつけなかった
          herBoost = gap > 3 ? Math.min(1.1, 1 + (gap - 3) * 0.012) : 1;
        }
        const done = p.finished && (h.finished || timer - p.time > 0.5);
        const gaveUp = h.finished && !p.finished && timer - h.time > RACE.waitPlayer;
        if (done || gaveUp) {
          state = 'finish';
          const place = finishOrder[0] === 'player' ? 1 : 2;
          resultText = p.finished
            ? `ゴール！ ${place} 位\nタイム ${p.time.toFixed(1)} 秒`
            : 'ゴールならず…\nまた挑戦してね';
          timer = 0;
        } else {
          const pos = position();
          show('', p.finished ? `ゴール！ ${pos} 位\n女の子を待っています`
            : `LAP ${lapOf(p)} / ${RACE.laps}\n${pos} 位　${timer.toFixed(1)} 秒`);
        }
        break;
      }
      case 'finish': {
        timer += dt;
        show('', resultText);
        if (timer > RACE.results) toIdle();
        break;
      }
      default:
        break;
    }
  }

  function startCountdown() {
    state = 'countdown';
    timer = 0;
    lastBeep = -1;
    lastLapSaid = false;
    finishOrder = [];
    herSkill = HER_SKILL;
    herBoost = 1;
    voice?.say('raceReady');
  }
  function toIdle() {
    state = 'idle';
    timer = 0;
    holdTimer = 0;
    gridAsked = false;
    setLamps(0);
  }
  /** プレイヤーが降りた：レースをやめる */
  function abort() {
    toIdle();
    show('', '');
  }

  /**
   * 女の子のカートへの指示。
   *   'hold'   … その場で止まる（枠で待つ・合図のあいだ）
   *   'race'   … 全力で走る（skill は追い上げで変わる）
   *   'toGrid' … 自分の枠へ戻る（ゴールしたあと、結果を出しているあいだも）
   */
  function herCommand() {
    if (state === 'countdown') return 'hold';
    if (state === 'race') return runners.her.finished ? 'toGrid' : 'race';
    if (state === 'finish') return 'toGrid';
    return herOnSlot() ? 'hold' : 'toGrid';
  }

  return {
    update,
    herCommand,
    get herSkill() { return herSkill; },
    /** 女の子のカートの最高速の倍率（レースの最中だけ 1 より大きくなる） */
    get herBoost() { return state === 'race' && !runners.her.finished ? herBoost : 1; },
    /** 合図のあいだは、プレイヤーのカートも動かない */
    get locked() { return state === 'countdown'; },
    get state() { return state; },
    get slot() { return slotHer; },
    get runners() { return runners; },
    get finishOrder() { return finishOrder.slice(); },
    get lamps() { return lampGroup; },
    /** 検証用：すぐに合図を始める */
    debugStart() { startCountdown(); },
  };
}
