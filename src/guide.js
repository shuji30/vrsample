/**
 * 最初の 5 分の案内（売り物の水準 B2）。
 *
 * はじめて遊ぶ人は、何をすればよいか分からないまま家の中を歩きまわって終わりがち。女の子の台詞と、画面の下の
 * 小さな札（PC・スマホ）で、遊びの流れを 1 回だけ案内する。
 *
 *   1. 出迎え     … 「はじめる」で開始画面を閉じたら、女の子が迎えて、キャッチボールに誘う
 *   2. キャッチボール … 3 回つづいたら（または 4 分たったら）、座って話そうと誘う
 *   3. 座って話す   … 話しおえたら（または 3 分たったら）、次の遊びを勧めて、案内はおしまい
 *
 * 一度おわったら（札の × で消しても）このブラウザに覚えて、次からは出さない。?guide=again でもう一度。
 * VR の最中は札が見えないので、台詞で案内する（台詞はどの端末でも出る）。
 */

const DONE_KEY = 'vrsample.guideDone';

/** 札の文。PC とスマホで操作の書き方を変える */
const CARDS = {
  catch: {
    pc: '庭へ出て、女の子と<b>キャッチボール</b>をしよう。食卓のボールの前で <b>F</b> で拾って、もう一度 <b>F</b> で投げる',
    touch: '庭へ出て、女の子と<b>キャッチボール</b>をしよう。食卓のボールに近づいて、右下の「拾う」→「投げる」',
  },
  sit: {
    pc: 'ベンチやソファーの前で <b>E</b> を押すと、女の子が隣に座って<b>話せます</b>（話題は 1〜4 キー）',
    touch: 'ベンチやソファーに近づいて、右下の「座る」を押すと、女の子が隣に座って<b>話せます</b>',
  },
  next: {
    pc: 'つぎは何をしよう？ テニス・カート・メリーゴーランド・崖の下の砂浜…。左上の「☰ メニュー」の「遊べること」に一覧があります',
    touch: 'つぎは何をしよう？ テニス・カート・メリーゴーランド・崖の下の砂浜…。左上の「☰ メニュー」の「遊べること」に一覧があります',
  },
};

/**
 * @param {object} options
 * @param {{ say: (kind: string) => boolean } | null} options.voice 女の子の声
 * @param {{ stats: { rally: number, best: number } } | null} options.catchGame キャッチボール
 * @param {{ active: boolean } | null} options.talk 座って話す
 * @param {() => boolean} options.overlayOpen 開始画面が開いているか
 * @param {boolean} [options.touch] スマホ・タブレットか
 * @param {boolean} [options.again] 案内をもう一度出す（?guide=again）
 */
export function createGuide({ voice, catchGame, talk, overlayOpen, touch = false, again = false }) {
  let done = false;
  try { done = !again && localStorage.getItem(DONE_KEY) === '1'; } catch { /* 覚えられない端末では毎回出す */ }

  /** 'wait'（開始画面が開いている）→ 'hello' → 'catch' → 'sit' → 'talking' → 'next' → おわり */
  let step = 'wait';
  let timer = 0;
  let card = null;

  function finish() {
    done = true;
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* 覚えられなくてもよい */ }
    showCard(null);
  }

  function showCard(key) {
    if (!key) { card?.remove(); card = null; return; }
    if (!card) {
      card = document.createElement('div');
      card.id = 'guide';
      card.innerHTML = '<p></p><button type="button" title="案内を消す（次からは出しません）" aria-label="案内を消す">×</button>';
      card.querySelector('button').addEventListener('click', finish);
      document.body.appendChild(card);
    }
    card.querySelector('p').innerHTML = CARDS[key][touch ? 'touch' : 'pc'];
  }

  function go(next) {
    step = next;
    timer = 0;
  }

  return {
    get step() { return done ? 'done' : step; },
    update(dt) {
      if (done) return;
      timer += dt;
      // 開始画面を開きなおしているあいだは、札を隠して待つ
      if (overlayOpen()) { if (card) card.style.display = 'none'; return; }
      if (card) card.style.display = '';
      switch (step) {
        case 'wait':
          go('hello');
          break;
        case 'hello':
          // 閉じてすぐより、ひと呼吸おいてから迎える
          if (timer > 1.2) {
            voice?.say('guideHello');
            go('catch');
            showCard('catch');
          }
          break;
        case 'catch': {
          if (timer > 4 && timer - dt <= 4) voice?.say('guideCatch');
          const rally = Math.max(catchGame?.stats?.rally ?? 0, catchGame?.stats?.best ?? 0);
          if (rally >= 3 || timer > 240) {
            voice?.say('guideSit');
            go('sit');
            showCard('sit');
          }
          break;
        }
        case 'sit':
          if (talk?.active) go('talking');
          else if (timer > 180) {
            voice?.say('guideNext');
            go('next');
            showCard('next');
          }
          break;
        case 'talking':
          if (!talk?.active) {
            voice?.say('guideNext');
            go('next');
            showCard('next');
          }
          break;
        case 'next':
          if (timer > 25) finish();
          break;
        default:
          break;
      }
    },
  };
}
