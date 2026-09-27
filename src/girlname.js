/**
 * 女の子の名前。プレイヤーが説明画面（I キー）の「女の子の名前」で付ける。
 *
 * - 付けた名前はこのブラウザに覚えておく（localStorage）。覚えられない環境（プライベートウィンドウなど）では、
 *   そのページを開いているあいだだけ使う
 * - 付けていないあいだは「女の子」と呼ぶ
 * - ?name=さくら のように URL でも渡せる（覚えている名前より先に使う。覚え直しはしない）
 * - 名前が出る所（スコア表・案内・会話の見出しなど）は、描くたびに girlName() を読む
 * - 「よみ」（ひらがな）も付けられる。声で呼ぶときはよみを使う（漢字の名前は、音声合成が読み違えることがあるので）
 */

const KEY = 'vrsample.girlName';
const YOMI_KEY = 'vrsample.girlNameYomi';
export const DEFAULT_GIRL_NAME = '女の子';
export const GIRL_NAME_MAX = 10;

const listeners = new Set();

/** 空白を詰め、制御文字と山かっこを除いて、10 文字まで */
export function cleanGirlName(raw) {
  return Array.from(String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, GIRL_NAME_MAX).join('');
}

function load() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('name');
    if (fromUrl && cleanGirlName(fromUrl)) return cleanGirlName(fromUrl);
  } catch { /* URL が読めなければ覚えている名前へ */ }
  try { return cleanGirlName(localStorage.getItem(KEY)); } catch { return ''; }
}

let current = load();
let yomi = '';
try { yomi = current ? cleanGirlName(localStorage.getItem(YOMI_KEY)) : ''; } catch { /* よみなし */ }

/** 付けた名前（付けていなければ ''） */
export function givenGirlName() { return current; }

/** 呼び名（付けていなければ「女の子」） */
export function girlName() { return current || DEFAULT_GIRL_NAME; }

/** 声で呼ぶときの名前（よみがあればよみ、なければ呼び名） */
export function girlNameSpoken() { return (current && yomi) || girlName(); }

/** 付けたよみ（なければ ''） */
export function givenGirlNameYomi() { return yomi; }

/** 名前（とよみ）を付ける（名前 '' で付けていない状態へ戻す）。付けた名前を返す */
export function setGirlName(raw, rawYomi = '') {
  const next = cleanGirlName(raw);
  const nextYomi = next ? cleanGirlName(rawYomi) : '';
  if (next === current && nextYomi === yomi) return current;
  current = next;
  yomi = nextYomi;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
    if (nextYomi) localStorage.setItem(YOMI_KEY, nextYomi);
    else localStorage.removeItem(YOMI_KEY);
  } catch { /* 覚えられなくても、このページのあいだは使う */ }
  for (const fn of listeners) {
    try { fn(next); } catch (e) { console.warn('girlName listener', e); }
  }
  return current;
}

/** 名前が変わったら呼ぶ。戻り値の関数で外す */
export function onGirlNameChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** innerHTML に入れるとき用（名前から山かっこは除いてあるが、& や引用符も念のため） */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
