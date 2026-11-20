/**
 * 女の子の見た目（モデル）の選択。説明画面（I キー）の「女の子の見た目」で選ぶ。
 *
 * - 選んだものはこのブラウザに覚えておく（localStorage）。覚えられない環境では、既定のモデルになる
 * - モデルは起動のときに 1 回だけ読むので、選び直したらページを読み込み直す（main.js）
 * - ?model=swim のように URL でも渡せる（覚えている選択より先に使う。覚え直しはしない）
 * - ?vrm=…（好きな VRM のファイル）と ?girl=original（コードで作るモデル）は、この選択より先に効く（main.js）
 *
 * swim と street は、Blender で作った自前のモデル（VRM 1.0）。元データと作り方は vrgame2 の blender/girl/。
 */

export const GIRL_MODELS = [
  { id: 'classic', label: 'もとの女の子', url: './models/character.vrm' },
  { id: 'swim', label: '水着コーデ', url: './models/girl-swim.vrm' },
  { id: 'street', label: 'ストリートコーデ', url: './models/girl-street.vrm' },
];
export const DEFAULT_GIRL_MODEL = 'classic';
const KEY = 'vrsample.girlModel';

const known = (id) => GIRL_MODELS.some((m) => m.id === id);

/** いま選ばれているモデルの id */
export function girlModelId() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('model');
    if (known(fromUrl)) return fromUrl;
  } catch { /* URL が読めなければ覚えている選択へ */ }
  try {
    const saved = localStorage.getItem(KEY);
    if (known(saved)) return saved;
  } catch { /* 覚えていない */ }
  return DEFAULT_GIRL_MODEL;
}

/** いま選ばれているモデルのファイル */
export function girlModelUrl(version = '') {
  // 版を付けて読む：モデルを作り直しても名前が同じだと、ブラウザが覚えている古いファイルが出てしまう
  const url = GIRL_MODELS.find((m) => m.id === girlModelId()).url;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

/** 選び直す。覚えられたら true（覚えられないと、読み込み直しても元に戻る） */
export function setGirlModel(id) {
  if (!known(id)) return false;
  try { localStorage.setItem(KEY, id); return true; } catch { return false; }
}
