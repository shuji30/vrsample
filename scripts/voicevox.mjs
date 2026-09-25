// 女の子の台詞を VOICEVOX で音声ファイルにする。VOICEVOX を起動した PC で 1 回実行する。
//
//   npm install                       # 初回だけ（three と、MP3 にする lamejs）
//   node scripts/voicevox.mjs --list  # 声（キャラクターとスタイル）の番号を見る
//   node scripts/voicevox.mjs --samples   # 候補の声の見本を voices/samples/ に作る（聞き比べ用）
//   node scripts/voicevox.mjs --speaker 8 # 台詞を全部作る（8 = 春日部つむぎ ノーマル）
//
// 台詞は src/voice.js の LINES（と VOICE_NUMBERS で数を入れたもの）。できたファイルは
// voices/voicevox/ に入り、manifest.json に「台詞 → ファイル・長さ・口の動き（拍ごとの母音と時間）」を書く。
// ゲームは manifest.json にある台詞をこのファイルで、無い台詞はブラウザの音声合成で読む。
//
// 台詞を足したり直したりしたら、もう一度実行する（変わった台詞だけ作り直す）。
//
// VOICEVOX の利用規約により、声を使うときは「VOICEVOX:キャラクター名」の表記が要る。ゲームは
// manifest.json の credit を開始画面に出す。キャラクターごとの規約も確かめること
// （https://voicevox.hiroshiba.jp/ の各キャラクターのページ）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { host: 'http://127.0.0.1:50021', speaker: 8, out: 'voices/voicevox', speed: 1.08, pitch: 0.02, intonation: 1.25, volume: 1.0, kbps: 48, force: false, list: false, samples: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') args.host = next().replace(/\/$/, '');
    else if (a === '--speaker') args.speaker = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--speed') args.speed = Number(next());
    else if (a === '--pitch') args.pitch = Number(next());
    else if (a === '--intonation') args.intonation = Number(next());
    else if (a === '--volume') args.volume = Number(next());
    else if (a === '--kbps') args.kbps = Number(next());
    else if (a === '--only') args.only = next();
    else if (a === '--force') args.force = true;
    else if (a === '--list') args.list = true;
    else if (a === '--samples') args.samples = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`知らない引数: ${a}`);
  }
  return args;
}

const HELP = `使い方: node scripts/voicevox.mjs [--list | --samples | --speaker 番号] [オプション]
  --host URL         VOICEVOX エンジンの場所（既定 http://127.0.0.1:50021。VOICEVOX を起動すると動く）
  --speaker 番号     声（スタイルの番号。--list で見られる。既定 8 = 春日部つむぎ ノーマル）
  --speed 1.08       話す速さ      --pitch 0.02   声の高さ（-0.15〜0.15）
  --intonation 1.25  抑揚の強さ    --volume 1.0   音量
  --kbps 48          MP3 のビットレート（lamejs が無いときは WAV で書く）
  --out 場所         出力先（既定 voices/voicevox）
  --only 語          その語を含む台詞だけ作る（試し用）
  --force            作ってある台詞も作り直す`;

// --- VOICEVOX エンジン -----------------------------------------------------------

async function engine(host, path, { method = 'GET', body = null, binary = false } = {}) {
  let res;
  try {
    res = await fetch(host + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`VOICEVOX エンジン（${host}）につながりません。VOICEVOX を起動してください。（${error.cause?.code ?? error.message}）`);
  }
  if (!res.ok) throw new Error(`VOICEVOX ${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function speakerName(host, id) {
  const speakers = await engine(host, '/speakers');
  for (const s of speakers) {
    const style = s.styles.find((st) => st.id === id);
    if (style) return { name: s.name, style: style.name };
  }
  throw new Error(`声の番号 ${id} が見つかりません（--list で確かめてください）`);
}

async function synthesize(host, speaker, text, opt) {
  const query = await engine(host, `/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
  query.speedScale = opt.speed;
  query.pitchScale = opt.pitch;
  query.intonationScale = opt.intonation;
  query.volumeScale = opt.volume;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.12;
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  const wav = await engine(host, `/synthesis?speaker=${speaker}`, { method: 'POST', body: query, binary: true });
  return { wav, morae: moraTimeline(query) };
}

/**
 * 口の動きの表：拍ごとに [母音の始まり（秒）, 母音の長さ（秒）, 母音]。
 * 母音は a i u e o、n（ん）、無声化した母音は大文字（口を小さく）。っ と間は入れない（口を閉じる）。
 * audio_query の長さは速さ 1 のときの値なので、speedScale で割る。
 */
function moraTimeline(query) {
  const speed = query.speedScale || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  let t = (query.prePhonemeLength ?? 0) / speed;
  const out = [];
  for (const phrase of query.accent_phrases ?? []) {
    for (const mora of phrase.moras ?? []) {
      const c = (mora.consonant_length ?? 0) / speed;
      const v = (mora.vowel_length ?? 0) / speed;
      const vowel = mora.vowel === 'N' ? 'n' : mora.vowel === 'cl' || mora.vowel === 'pau' ? null : mora.vowel;
      if (vowel) out.push([r(t + c), r(v), vowel]);
      t += c + v;
    }
    if (phrase.pause_mora) t += ((phrase.pause_mora.consonant_length ?? 0) + (phrase.pause_mora.vowel_length ?? 0)) / speed;
  }
  return out;
}

// --- WAV → MP3 --------------------------------------------------------------------

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV ではありません');
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('16 ビット PCM の WAV ではありません');
  const all = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  // ステレオなら左だけ
  const pcm = fmt.channels === 1 ? all : all.filter((_, i) => i % fmt.channels === 0);
  return { rate: fmt.rate, pcm };
}

/** lamejs（npm の lamejs 1.2.1）。node_modules の lame.all.js を読む（src 版は Node で動かない不具合がある） */
function loadLame() {
  const path = join(ROOT, 'node_modules/lamejs/lame.all.js');
  if (!existsSync(path)) return null;
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${readFileSync(path, 'utf8')};this.lamejs = lamejs;`, context);
  return context.lamejs;
}

function toMp3(lame, { rate, pcm }, kbps) {
  const encoder = new lame.Mp3Encoder(1, rate, kbps);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (chunk.length) parts.push(Buffer.from(chunk));
  }
  parts.push(Buffer.from(encoder.flush()));
  return Buffer.concat(parts);
}

// --- 台詞の一覧 -------------------------------------------------------------------

async function allTexts() {
  const { LINES, VOICE_NUMBERS, EXTRA_LINES, spokenLine } = await import(join(ROOT, 'src/voice.js'));
  const texts = new Set();
  for (const [kind, lines] of Object.entries(LINES)) {
    for (const line of lines) {
      if (!line.includes('{n}')) { texts.add(line); continue; }
      const values = VOICE_NUMBERS[kind];
      if (!values) { console.warn(`  ${kind}: 数の候補（VOICE_NUMBERS）が無いので作りません: ${line}`); continue; }
      for (const n of values) texts.add(spokenLine(line, n));
    }
  }
  for (const line of EXTRA_LINES) texts.add(line);
  return [...texts];
}

// --- 本体 -------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  const version = await engine(args.host, '/version');
  console.log(`VOICEVOX エンジン ${version}（${args.host}）`);

  if (args.list) {
    for (const s of await engine(args.host, '/speakers')) {
      console.log(`${s.name}: ${s.styles.map((st) => `${st.id} ${st.name}`).join(' / ')}`);
    }
    return;
  }

  const lame = loadLame();
  if (!lame) console.warn('lamejs が見つからないので WAV で書きます（大きくなります）。npm install で入ります。');
  const ext = lame ? 'mp3' : 'wav';
  const encode = (wav) => (lame ? toMp3(lame, parseWav(wav), args.kbps) : wav);

  if (args.samples) { await samples(args, encode, ext); return; }

  const who = await speakerName(args.host, args.speaker);
  const out = resolve(ROOT, args.out);
  await mkdir(out, { recursive: true });
  const manifestPath = join(out, 'manifest.json');
  const old = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { lines: {} };
  const params = { speaker: args.speaker, speed: args.speed, pitch: args.pitch, intonation: args.intonation, volume: args.volume, kbps: lame ? args.kbps : 'wav' };
  const paramKey = JSON.stringify(params);
  const texts = (await allTexts()).filter((t) => !args.only || t.includes(args.only));
  console.log(`声: ${who.name}（${who.style}）  台詞: ${texts.length}`);

  const lines = args.only ? { ...old.lines } : {};
  let made = 0;
  let kept = 0;
  let bytes = 0;
  for (const [i, text] of texts.entries()) {
    const file = `${createHash('sha1').update(`${paramKey}\n${text}`).digest('hex').slice(0, 12)}.${ext}`;
    const prev = old.lines?.[text];
    if (!args.force && prev?.f === file && existsSync(join(out, file))) {
      lines[text] = prev;
      kept++;
      continue;
    }
    const { wav, morae } = await synthesize(args.host, args.speaker, text, args);
    const { rate, pcm } = parseWav(wav);
    const data = encode(wav);
    await writeFile(join(out, file), data);
    bytes += data.length;
    lines[text] = { f: file, d: Math.round((pcm.length / rate) * 1000) / 1000, m: morae };
    made++;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${i + 1}/${texts.length}  ${text}                    `);
    else if (made % 50 === 0) console.log(`  ${i + 1}/${texts.length}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');

  const manifest = {
    version: 1,
    engine: `VOICEVOX ${version}`,
    speaker: { id: args.speaker, name: who.name, style: who.style },
    credit: `VOICEVOX:${who.name}`,
    params,
    lines,
  };
  // 1 台詞 1 行にして、差分を見やすくする
  const body = Object.entries(lines).map(([t, v]) => `    ${JSON.stringify(t)}: ${JSON.stringify(v)}`).join(',\n');
  const head = JSON.stringify({ ...manifest, lines: undefined }, null, 2).replace(/\n}$/, '');
  await writeFile(manifestPath, `${head},\n  "lines": {\n${body}\n  }\n}\n`);

  // 使わなくなったファイルを消す
  const used = new Set(Object.values(lines).map((v) => v.f));
  let removed = 0;
  for (const name of await readdir(out)) {
    if (/^[0-9a-f]{12}\.(mp3|wav)$/.test(name) && !used.has(name)) { await rm(join(out, name)); removed++; }
  }
  console.log(`作った ${made}（${Math.round(bytes / 1024)} KB）・そのまま ${kept}・消した ${removed}  → ${args.out}/manifest.json`);
  console.log(`表記: ${manifest.credit}（ゲームの開始画面に出ます）`);
}

/** 候補の声の見本（聞き比べ用）。voices/samples/index.html を開いて聞く */
async function samples(args, encode, ext) {
  const WANT = /春日部つむぎ|四国めたん|冥鳴ひまり|九州そら|雨晴はう|波音リツ|WhiteCUL|櫻歌ミコ|小夜|満別花丸|琴詠ニア|春歌ナナ|猫使ビィ|中国うさぎ|もち子|ずんだもん/;
  const TEXTS = ['ねえねえ、キャッチボールしよ！', 'わぁ、じょうず！10かい、つづいたね！', 'あっ、ごめん！おとしちゃった…'];
  const out = resolve(ROOT, 'voices/samples');
  await mkdir(out, { recursive: true });
  const rows = [];
  for (const s of await engine(args.host, '/speakers')) {
    if (!WANT.test(s.name)) continue;
    for (const st of s.styles) {
      if (/ささやき|ヒソヒソ|なみだめ|セクシー|びえーん|怒り|ツンツン|悲しみ|喜び|クイーン|人間ver|ぬいぐるみ/.test(st.name)) continue;
      const clips = [];
      for (const [k, text] of TEXTS.entries()) {
        const { wav } = await synthesize(args.host, st.id, text, args);
        const file = `${st.id}-${k}.${ext}`;
        await writeFile(join(out, file), encode(wav));
        clips.push(file);
      }
      rows.push({ id: st.id, name: s.name, style: st.name, clips });
      console.log(`  ${st.id} ${s.name}（${st.name}）`);
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>声の見本</title>
<style>body{font-family:sans-serif;margin:24px;line-height:1.6}td{padding:4px 10px;border-bottom:1px solid #ddd}code{background:#f3f3f3;padding:2px 4px}</style>
<h1>女の子の声の見本（VOICEVOX）</h1>
<p>気に入った声の番号で <code>node scripts/voicevox.mjs --speaker 番号</code> を実行すると、台詞が全部その声になります。</p>
<p>台詞：${TEXTS.map((t) => `「${t}」`).join(' ')}</p>
<table>${rows.map((r) => `<tr><td><b>${r.id}</b></td><td>${r.name}（${r.style}）</td>${r.clips.map((c) => `<td><audio controls preload="none" src="${c}"></audio></td>`).join('')}</tr>`).join('\n')}</table>`;
  await writeFile(join(out, 'index.html'), html);
  console.log(`見本 ${rows.length} 声 → voices/samples/index.html（npm start で開いて http://localhost:8080/voices/samples/）`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
