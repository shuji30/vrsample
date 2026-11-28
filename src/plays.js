/**
 * 女の子を使う遊びの「始まり」と「いまの遊び」を 1 か所で決める（ROADMAP 7）。
 *
 * 以前は world.js に、遊びごとに見ている条件がばらばらの長い if が 19 個並んでいた。それを表にした。
 * 振る舞いは前とまったく同じ（並び順・止める遊び・特別な条件。乱数の状態で前と比べて確かめた）。
 *
 * 遊び（game）は { wanted, active, start(), state? } を持つ（無い遊びは null）。
 *
 * 決まり（表の上から順に、同じフレームの中で見る。先に始まった遊びが、あとの遊びを止める）
 *   - wanted で、まだ active でなく、blockedBy の遊びがどれも active でなければ始める
 *   - beachPlay：砂浜の遊び（beach）がビーチバレーの最中（state === 'play'）か、砂浜にいないとき
 *   - テニスの最中なら、まずテニスを片づける（ラケットを戻す）。始めるのは、片づけ終わった次のフレーム
 *   - 始めるときは、キャッチボールを休ませる
 */

const PARK = ['kart', 'bike', 'seesaw', 'buranko', 'fishing', 'horse', 'carousel'];

/** [名前, 止める遊び, { beachPlay, noTennisStop }] */
export const PLAY_RULES = [
  ['kart', []],
  ['bike', ['kart']],
  ['seesaw', ['kart', 'bike']],
  ['buranko', ['kart', 'bike', 'seesaw']],
  ['fishing', ['kart', 'bike', 'seesaw', 'buranko']],
  ['horse', ['kart', 'bike', 'seesaw', 'buranko', 'fishing']],
  ['carousel', ['kart', 'bike', 'seesaw', 'buranko', 'fishing', 'horse']],
  // Lexus に乗ったら、していた遊びをやめて助手席へ
  ['f40', [...PARK, 'ferris', 'coaster', 'golf', 'seat', 'beach']],
  // 飛行場・砂浜へ行ったら、していた遊びをやめて一緒に来る
  ['cessna', []],
  ['beach', []],
  // 座って話す：砂浜ならビーチバレーの最中でも（ボールは置いて）
  ['seat', [...PARK, 'ferris'], { beachPlay: true }],
  ['cruiser', ['seat', ...PARK, 'ferris', 'coaster', 'golf'], { beachPlay: true }],
  ['dive', ['jetski', 'cruiser', 'seat', ...PARK, 'ferris', 'coaster', 'golf'], { beachPlay: true }],
  ['jetski', ['cruiser', 'seat', ...PARK, 'ferris', 'coaster', 'golf'], { beachPlay: true }],
  ['ferris', ['beach', ...PARK]],
  ['billiard', ['seat', 'golf', 'beach', 'kart', 'bike']],
  ['golf', ['beach', ...PARK, 'ferris', 'coaster']],
  ['coaster', ['beach', ...PARK, 'ferris']],
  // テニス：いちばんあと（ほかの遊びのどれもしていないとき）
  ['tennis', ['beach', ...PARK, 'ferris', 'coaster', 'golf'], { noTennisStop: true }],
];

/** 女の子を動かす遊びの順（先に active なものが女の子を使う）。どれでもなければキャッチボール */
export const UPDATE_ORDER = ['seat', 'f40', 'cessna', 'dive', 'cruiser', 'jetski', 'beach', 'kart', 'bike', 'seesaw', 'buranko',
  'fishing', 'horse', 'carousel', 'ferris', 'coaster', 'golf', 'billiard', 'tennis'];

/**
 * 遊びたい（wanted）遊びを、決まりに沿って始める。毎フレーム呼ぶ
 * @param {Record<string, any>} games 名前 → 遊び（無ければ null）。tennis と catch も入れる
 */
export function startWantedPlays(games) {
  const active = (name) => Boolean(games[name]?.active);
  const tennis = games.tennis;
  for (const [name, blockedBy, opts = {}] of PLAY_RULES) {
    const game = games[name];
    if (!game || !game.wanted || game.active) continue;
    if (blockedBy.some(active)) continue;
    if (opts.beachPlay && games.beach?.active && games.beach.state !== 'play') continue;
    if (!opts.noTennisStop && tennis?.active) { tennis.stop(); continue; }
    games.catch?.suspend();
    game.start();
  }
}

/** いま女の子を使っている遊びの名前（どれでもなければ 'catch'。キャッチボールも無ければ null） */
export function currentPlay(games) {
  for (const name of UPDATE_ORDER) if (games[name]?.active) return name;
  return games.catch ? 'catch' : null;
}
