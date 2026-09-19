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

## ヘッドセットで試す

WebXR は **セキュアコンテキスト（HTTPS または localhost）** でしか動きません。
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

## 構成

```
index.html              importmap と画面オーバーレイ
style.css
src/
  main.js               レンダラー・VRButton・メインループ
  world.js              シーン（空・床・テーブル・つかめるキューブ・簡易物理）
  controllers.js        プレイヤーリグ、つかむ / 押す / 移動
  desktop.js            ヘッドセットなしのときの操作（OrbitControls）
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
