# vrsample — 窓の外に公園のある部屋

three.js + WebXR でつくった、**ビルド不要**の VR サンプルです。
`index.html` を配信するだけで動きます（バンドラも npm install も不要）。

木の床に丸テーブルと椅子、ソファ、本棚のある部屋です。左の窓から日が差して
床に光の帯を落とし、正面の大きな窓の外には**さるすべりの木と滑り台のある公園**が
広がっています。右の壁のスイッチで昼 / 夕 / 夜が切り替わります。

- ヘッドセット（Meta Quest など）のブラウザ → 「ENTER VR」で没入
- PC / スマホのブラウザ → そのまま 3D シーンとして操作できる

<!-- 画面: 手前に木の床とラグ、中央に丸テーブルと椅子 3 脚、天井からペンダント。
     正面の大きな窓の外に、さるすべりの木・ベンチ・白い柵・青い滑り台のある公園。
     左の窓から日が差して床に窓枠の影が伸びる。右の壁に昼/夕/夜のスイッチ。 -->

**3D モデルもテクスチャ画像も 1 枚も持っていません。**床の木目も壁の塗りムラも
さるすべりの樹皮も、すべて起動時にコードで焼いています（`src/textures.js`）。
クローンしてすぐ動き、オフラインでも回線が細くても影響を受けません。

## 動かす

```bash
git clone <このリポジトリ> && cd vrsample
npm start          # http://localhost:8080 で配信（依存パッケージなし）
```

`npm start` は `scripts/serve.mjs`（Node 標準モジュールだけの静的サーバー）を起動します。
`python3 -m http.server 8080` など、他の静的サーバーでも構いません。

> **ファイルを直接開く（`file://`）のは不可** です。ES modules と importmap を使っているため、
> HTTP で配信する必要があります。

起動時に 1〜2 秒ほど「部屋を焼いています…」と出ます。内訳はテクスチャ生成（CPU、
実測 0.7 秒ほど）と環境マップの焼き込み（GPU）です。`?quality=0.5` にすると
テクスチャ生成は 0.2 秒ほどに縮みます。

## Pimax（PCVR）で試す

Pimax は PC に繋いで使うヘッドセットなので、Quest のように「ヘッドセット内のブラウザ」で
開くのではなく、**PC のブラウザから VR に入ります**。HTTPS 化も不要で、いちばん手順が短いです。

1. **Pimax Play を起動**し、ヘッドセットが認識されている状態にする。
2. **OpenXR ランタイムをどちらか一方に確定させる。**
   Pimax Play → デバイス設定 → 一般 で Pimax / Steam を選べます。SteamVR 側から設定するなら
   SteamVR → 設定 → OpenXR → 「SteamVR を OpenXR ランタイムに設定」。
   どちらでも動きますが、**アクティブなランタイムが 1 つに決まっていること**が必要です。
3. 同じ PC で `npm start`。
4. **Chrome か Edge**（Chromium 系）で `http://localhost:8080` を開く。
   Windows の Chrome の WebXR は OpenXR 経由なので、これだけで「ENTER VR」が押せます。
   `localhost` はセキュアコンテキスト扱いなので HTTPS は不要です。

> Firefox デスクトップは WebXR に対応していないので使えません。Chrome / Edge を使ってください。

### 開けないとき

まず**画面下の状態表示**を読んでください。起動の各段階（「部屋を焼いています…」→
「操作の準備中…」→ 検出結果）と、失敗した場合はその段階とエラーメッセージが
そのまま出ます。ヘッドセットで試すときに DevTools を開かずに済ませるためです。

次に `?safe` を付けて開き直します。影・環境マップ・テクスチャ解像度・XR の
レンダー解像度をすべて最小にしたモードで、これで開けるなら原因は描画負荷側、
開けないなら WebXR 側の問題だと切り分けられます。

```
http://localhost:8080/?safe
```

### ENTER VR が出ない・押しても始まらないとき

- アクティブな OpenXR ランタイムが決まっているか（手順 2）。Pimax Play と SteamVR を
  両方立ち上げていると取り合いになることがあります。
- Chrome を `--disable-features=XRSandbox` 付きで起動してみる。XR サンドボックスが
  原因で immersive session に入れない既知のケースがあります（セキュリティ機能を落とすので
  常用はしないこと）。
- `chrome://gpu` で WebGL / ANGLE が有効か確認する。

### Parallel Projections は ON にしなくてよい

Pimax は左右のディスプレイが内向きに傾いています（canted display）。three.js の
`WebXRManager.setProjectionFromUnion()` は**左右の目が平行に向いている前提**でカリング用の
視錐台を 1 つに合成するため、傾いたディスプレイでは視錐台が実際より狭くなり、
視界の外縁でオブジェクトが早めに消えることがあります。

このシーンは数百オブジェクトあるのでカリング自体は効かせたまま、**各ジオメトリの
バウンディングスフィアを 1.35 倍に膨らませて**対処しています（`src/main.js`）。
Pimax Play の **Parallel Projections は OFF のままで大丈夫**です（ON にすると描画負荷が
3 割ほど増えます）。

```js
// src/main.js
if (!geometry.boundingSphere) geometry.computeBoundingSphere();
geometry.boundingSphere.radius *= 1.35;
```

それでも視界の縁が欠けるなら `?cull=off` でカリングを完全に切れます。

### 重いとき・VR に入ると真っ暗なとき

Pimax は視野が広いぶんレンダーターゲットが巨大になります。**まず実測を見てください。**
VR を終了すると、画面下にそのセッションの実測値が出ます。

```
VR 実測: 38fps / フレームバッファ 5472x2736（15.0Mpx）
解像度が大きすぎます。?scale=0.8 を試してください。
```

ヘッドセットを被っている間は画面の文字が読めないので、終了時に残す作りにして
あります。VR 内で見たい場合は `?debug` を付けると、左手のパネルに fps と
フレームバッファのサイズが出ます。

目安として、90fps を保てるのはおおむね **900 万ピクセル／フレーム**までです。
これを超えているなら、まず解像度を落とすのが圧倒的に効きます（描画コストは
ピクセル数にほぼ比例するため）。効く順に:

```
http://localhost:8080/?scale=0.7      # XR のレンダー解像度。いちばん効く
http://localhost:8080/?shadow=1024    # 影の解像度を落とす（既定 2048）
http://localhost:8080/?shadow=off     # 影を切る
http://localhost:8080/?quality=0.5    # テクスチャ解像度を半分に（起動も速くなる）
http://localhost:8080/?safe           # 上を全部まとめた最小構成
```

### コントローラーが効かないとき

`?debug` を付けると、左手コントローラーにデバッグパネルが出ます（PC では **D キー**でも切替）。

```
http://localhost:8080/?debug
```

`inputSources` の handedness / プロファイル名 / **axes と buttons の生の値** / 実 fps が
VR 内でそのまま読めるので、「スティックが別の軸に来ている」「handedness が none」といった
プロファイル差がその場で分かります。

コード側では次のフォールバックを入れてあります（`src/controllers.js`）。

- サムスティックは xr-standard の `axes[2]/[3]` を優先しつつ、`axes[0]/[1]` しか返さない
  コントローラーでも動く（倒れている方の軸ペアを採用する）
- `handedness` を返さないランタイムでは、1 本目を移動・2 本目を旋回として扱う

## Quest などスタンドアロン機で試す

ヘッドセット内のブラウザから開く場合は、WebXR が
**セキュアコンテキスト（HTTPS または localhost）** を要求する点だけ注意が必要です。
手軽な順に 3 つ:

1. **Quest を USB 接続して `adb reverse`**（おすすめ・追加設定なし）
   ```bash
   adb reverse tcp:8080 tcp:8080
   ```
   Quest のブラウザで `http://localhost:8080` を開く。

2. **GitHub Pages に公開する**
   `.github/workflows/pages.yml` を同梱しています。リポジトリの
   Settings → Pages で Source を「GitHub Actions」にすると、`main` への push で公開されます。

3. **トンネルサービス**（ngrok / cloudflared など）で HTTPS の URL を発行する。

このシーンは PCVR 向けの設定（影 4096、面光源、クリアコート）で作ってあるので、
Quest では次のあたりから落としてください。

```
http://localhost:8080/?shadow=1024&quality=0.5&scale=0.9
```

PC の Chrome で試すだけなら、[WebXR API Emulator](https://chromewebstore.google.com/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje)
拡張を入れると ENTER VR が押せるようになります。

## 操作

| | VR | PC |
|---|---|---|
| つかむ / 離す | トリガー（離した瞬間の手の速度で飛ぶ） | — |
| 移動 | 左スティック（壁は抜けない） | — |
| 旋回 | 右スティック（30度スナップターン） | ドラッグ |
| ズーム | — | ホイール |
| スイッチを押す | スイッチに向けてトリガー | クリック |
| 小物を跳ねさせる | — | クリック |
| 小物を元に戻す | — | R キー |

右の壁のスイッチ 3 つで、時間帯（昼 / 夕 / 夜）が切り替わります。

### URL オプション

| | |
|---|---|
| `?safe` | 切り分け用の最小構成（影・環境マップ off、テクスチャ 1/4、解像度 0.7） |
| `?scale=0.8` | XR のレンダー解像度倍率 |
| `?shadow=1024` | シャドウマップの解像度（既定 2048）。`?shadow=off` で影を切る |
| `?quality=0.5` | 手続きテクスチャの解像度倍率（起動時間に効く） |
| `?cull=off` | 視錐台カリングを完全に切る（外縁が欠けるヘッドセット向け） |
| `?debug` | VR 内にデバッグパネルを出す（PC では D キーでも切替） |

## 構成

```
index.html              importmap と画面オーバーレイ
style.css
src/
  main.js               レンダラー・VRButton・メインループ
  textures.js           手続き的 PBR テクスチャ（床・壁・木・布・樹皮・芝）
  room.js               部屋の躯体（床・壁・天井・幅木・窓・ドア）
  park.js               窓の外の公園（さるすべり・滑り台・ベンチ・遠景）
  furniture.js          家具と小物（テーブル・椅子・ソファ・本棚・照明器具）
  lighting.js           太陽 / 窓の面光源 / 室内灯 / 環境マップ
  themes.js             昼 / 夕 / 夜の照明シナリオ
  world.js              上をまとめて組み立てる。簡易物理もここ
  controllers.js        プレイヤーリグ、つかむ / 押す / 移動
  desktop.js            ヘッドセットなしのときの操作（OrbitControls）
  debug.js              VR 内で入力を確認するデバッグパネル（?debug）
scripts/
  serve.mjs             依存なしの静的サーバー
  vendor.mjs            three.js を vendor/ にコピーするスクリプト
vendor/three/           three.js 本体と addons（リポジトリに同梱）
```

### three.js を更新する

```bash
npm install three@<version>   # devDependencies のバージョンも更新される
npm run vendor                # vendor/ にコピーし直す
```

## 画質のつくり方

「リアルに見えるかどうか」はレンダラーの性能よりも、**ライティングの組み立て方**と
**テクスチャの縮尺**でほとんど決まります。このシーンで効かせているのは次の 6 つです。

### 1. 環境マップを部屋自身から焼く

一番効きます。`PMREMGenerator.fromScene()` で**部屋そのもの**をキューブマップに
撮り、`scene.environment` に戻しています（`src/lighting.js`）。壁の照り返しが金属や
クリアコートに映り込むようになり、間接光をベイクしたのに近い効果が、
アセットなしで手に入ります。照明を変えたときだけ焼き直します。

```js
envTarget = pmrem.fromScene(scene, 0, 0.1, 1000, { size: 256, position: ENV_PROBE });
scene.environment = envTarget.texture;
```

### 2. 窓は面光源、影は平行光

窓の開口と同じ大きさの `RectAreaLight` を置いています。点光源や平行光では
「窓際だけ柔らかく明るい」減衰が出ません。ただし three.js の RectAreaLight は
**影を落とせない**ので、影は別に `DirectionalLight`（太陽）が担当します。
この 2 本立てが室内ライティングの定石です。

### 3. テクセル密度をメートルで揃える

`tex.material('walnut', { sizeX: 0.45 })` の `sizeX` は「その部材が実寸で何メートルか」。
テクスチャ側は 1 タイル何メートルかを持っているので、割り算で繰り返し回数が決まり、
部屋じゅうで木目の細かさが揃います。

同じマテリアルを天板にも椅子の脚にも使い回すと、小さい部材ほど木目が細かくなりすぎて
**くしゃくしゃの箔**のように見えます。最初の実装はまさにこれで失敗しました。

### 4. ノーマルマップを強くしすぎない

CG っぽさの最大の原因です。塗り壁の `normalScale` は 0.18、凹凸の周期は 8mm。
これより粗く・強くすると、たちまち「吹き付け塗装」になります。
さるすべりの樹皮に至っては、つるつるなのが特徴なのでほとんど凹凸を付けていません。

### 5. 壁に厚みを持たせる

壁は厚さ 14cm の押し出しで作り、窓とドアは穴として開けています。開口部の
**見込み（reveal）** が出るかどうかは大きく、板 1 枚に穴を描いただけの窓は
立体視だと厚みの無さが即バレします。

### 6. 窓の外に世界を作る

室内の写実は「窓の外に本当に奥行きがあるか」でかなり決まります。
テラス → 柵 → 芝生 → さるすべりと滑り台 → 遠景の生垣と木立、と層を重ね、
霧（`scene.fog`）で遠くを空の色に溶かして大気遠近を出しています。

### やっていないこと（WebXR の限界）

- **ポストプロセス**（SSAO / Bloom / 被写界深度）。`EffectComposer` は WebXR の
  ステレオ描画と素直に噛み合いません。トーンマッピング（ACES）はマテリアル側の
  処理なので効いています。
- **SSR / リアルタイム GI**。環境マップの焼き直しで代用しています。
- **本物のガラス**。`MeshPhysicalMaterial.transmission` は専用の描画パスが要るので、
  ごく薄い加算のツヤだけ置いて「そこに板ガラスがある」ことを示しています。

ここから先（ベイクした GI、SSAO、実測の PBR テクスチャ）に進みたい場合は、
Unity URP + ライトマップベイクに移すのが現実的です。

## つくり変えるヒント

- **小物を増やす** → `src/furniture.js` の `PROPS` に素材を足すだけで、
  つかめる小物が増えます。
- **新しいマテリアル** → `src/textures.js` に `bake(size, shade, strength)` を使った
  レシピを 1 つ足して `sets` に登録します。`shade` は UV を受けて
  アルベド / 高さ / AO / ラフネス / メタルネスを書くだけの関数です。
- **公園に遊具を足す** → `src/park.js` の `sweepProfile()`（断面をカーブに沿って
  掃引する）と `taperedTube()`（半径の変わる筒）が使えます。滑り台のシュートと
  木の幹はこれで作っています。
- **時間帯を足す** → `src/themes.js` にもう 1 つ定義を書けば、壁のスイッチが
  自動で増えます。
- **3D モデルを置く** → `GLTFLoader`（`three/examples/jsm/loaders/GLTFLoader.js`）を
  `scripts/vendor.mjs` の `FILES` に追加して `npm run vendor`。
- **ハンドトラッキング** → `renderer.xr.getHand(i)` と `XRHandModelFactory` を使います。
