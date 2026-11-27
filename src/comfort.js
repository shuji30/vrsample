/**
 * VR の快適設定（売り物の水準 B4）。このブラウザに覚える。VR の中のメニュー（vrmenu.js）で変える。
 *
 *   turn      … 右スティックの旋回。'snap'（30° ずつ。酔いにくい）/ 'smooth'（なめらか）
 *   vignette  … 歩く・回るあいだ、視野の外側を暗くする（酔いにくくする）
 *   seated    … 座って遊ぶ。入れたときの頭の高さを、立った目の高さ（1.55m）まで持ち上げる（heightOffset m）
 *   coaster   … ジェットコースター。'gentle'（宙返りなし・最高 13m/s。既定）/ 'full'。線路の形が変わるので、読み込み直すと効く
 *               URL の ?coaster=gentle / ?coaster=full が優先
 */
const KEY = 'vrsample.comfort';
const DEFAULTS = { turn: 'snap', vignette: true, seated: false, heightOffset: 0, coaster: 'gentle' };

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { ...DEFAULTS, ...v };
  } catch { /* 覚えていない */ }
  return { ...DEFAULTS };
}

export const comfort = typeof localStorage !== 'undefined' ? load() : { ...DEFAULTS };

export function saveComfort() {
  try { localStorage.setItem(KEY, JSON.stringify(comfort)); } catch { /* 覚えられなくてもよい */ }
}

/** ジェットコースターをやさしくするか（URL が優先） */
export function coasterGentle() {
  const p = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('coaster') : null;
  if (p === 'gentle') return true;
  if (p === 'full') return false;
  return comfort.coaster !== 'full';
}

/** 立った目の高さ（座って遊ぶときの目標） */
export const STANDING_EYE = 1.55;
