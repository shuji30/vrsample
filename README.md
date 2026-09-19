# vrsample — WebXR おもちゃ箱

three.js + WebXR でつくった、**ビルド不要**の VR サンプルです。
`index.html` を配信するだけで動きます（バンドラも npm install も不要）。

- ヘッドセット（Meta Quest など）のブラウザ → 「ENTER VR」で没入
- PC / スマホのブラウザ → そのまま 3D シーンとして操作できる

<!-- 画面: 丸テーブルの上に回転するトーラスノット、まわりにつかめるカラフルなキューブ、
     左に操作説明パネル、右に「昼 / 夕 / 夜」を切り替えるボタン -->

## 動かす

```bash
git clone <このリポジトリ> && cd vrsample
npm start          # http://localhost:8080 で配信（依存パッケージなし）
```

`npm start` は `scripts/serve.mjs`（Node 標準モジュールだけの静的サーバー）を起動します。
`python3 -m http.server 8080` など、他の静的サーバーでも構いません。

> **ファイルを直接開く（`file://`）のは不可** です。ES modules と importmap を使っているため、
> HTTP で配信する必要があります。

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

このサンプルでは `src/main.js` で視錐台カリング自体を切ってあるので、この症状は出ません。
Pimax Play の **Parallel Projections は OFF のままで大丈夫**です（ON にすると描画負荷が
3 割ほど増えます）。

```js
// src/main.js
scene.traverse((object) => { object.frustumCulled = false; });
```

オブジェクトを大量に増やしてカリングを戻したくなったら、代わりに各オブジェクトの
bounding sphere を大きめに取る、といった対処になります。

### 重いとき

Pimax は視野が広いぶんレンダーターゲットが巨大になります。解像度を落として試せます。

```
http://localhost:8080/?scale=0.8
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

PC の Chrome で試すだけなら、[WebXR API Emulator](https://chromewebstore.google.com/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje)
拡張を入れると ENTER VR が押せるようになります。

## 操作

| | VR | PC |
|---|---|---|
| つかむ / 離す | トリガー（離した瞬間の手の速度で飛ぶ） | — |
| 移動 | 左スティック | — |
| 旋回 | 右スティック（30度スナップターン） | ドラッグ |
| ズーム | — | ホイール |
| ボタンを押す | ボタンに向けてトリガー | クリック |
| キューブを跳ねさせる | — | クリック |

右のコンソールにある 3 つのボタンで、環境（昼 / 夕 / 夜）が切り替わります。

### URL オプション

| | |
|---|---|
| `?debug` | VR 内にデバッグパネルを出す（PC では D キーでも切替） |
| `?scale=0.8` | XR のレンダー解像度倍率（重いヘッドセット向け） |

## 構成

```
index.html              importmap と画面オーバーレイ
style.css
src/
  main.js               レンダラー・VRButton・メインループ
  world.js              シーン（空・床・テーブル・つかめるキューブ・簡易物理）
  controllers.js        プレイヤーリグ、つかむ / 押す / 移動
  desktop.js            ヘッドセットなしのときの操作（OrbitControls）
  debug.js              VR 内で入力を確認するデバッグパネル（?debug）
  themes.js             昼 / 夕 / 夜の配色定義
scripts/
  serve.mjs             依存なしの静的サーバー
  vendor.mjs            three.js を vendor/ にコピーするスクリプト
vendor/three/           three.js 本体と addons（リポジトリに同梱）
```

three.js は CDN ではなく `vendor/` に同梱しています。クローンしてすぐ動き、
オフラインでもヘッドセットの回線が細くても影響を受けません。

### three.js を更新する

```bash
npm install three@<version>   # devDependencies のバージョンも更新される
npm run vendor                # vendor/ にコピーし直す
```

## 仕組みのメモ

- **プレイヤーリグ**: カメラとコントローラーを `player` という `Group` にまとめ、
  この Group を動かすことで移動を実現しています（カメラ自身の位置は XR のヘッド
  トラッキングが上書きするため、直接動かしてはいけません）。
- **スナップターン**: 連続回転より VR 酔いしにくいので 30 度ずつ回します。回転の中心は
  Group の原点ではなく**頭の位置**にしています。
- **つかむ**: `controller.attach(object)` でワールド変換を保ったまま手の子にし、
  離すときに `scene.attach(object)` で戻します。離した瞬間はコントローラーの移動量を
  そのまま初速にしているので、投げられます。
- **簡易物理**: 重力・床とテーブル上面への着地・反発だけの数十行です。物理エンジンは
  使っていません。転がり落ちたキューブは元の位置に戻ります。
- **遠景の柱**: VR では動いている実感を得るための目印がないと距離感がつかめないので、
  外周に柱を並べています。

## つくり変えるヒント

- オブジェクトを増やす → `src/world.js` で `userData.grabbable = true` を持つ Mesh を
  `grabbables` に追加すれば、そのままつかめるようになります。
- 3D モデルを置く → `GLTFLoader`（`three/examples/jsm/loaders/GLTFLoader.js`）を
  `scripts/vendor.mjs` の `FILES` に追加して `npm run vendor`。
- ハンドトラッキング → `renderer.xr.getHand(i)` と `XRHandModelFactory` を使います。
- AR にする → `VRButton` を `ARButton` に差し替え、床や空を消して現実に重ねます。
