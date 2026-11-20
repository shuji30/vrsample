# 女の子のモデルを Blender で作る（引き継ぎ書）

オリジナルの女の子を、Blender で作って VRM で書き出し、ゲームに組み込むための仕様です。
お手元の PC で動かす Claude Code（Blender とつないだもの）が、これを読んで作業を始められるように書いてあります。

経緯：コードだけで作るモデル（`src/girlmodel.js`、`?girl=original`）を作り込んできたが、数式で形を作ってスクショで直す
方式では、顔の立体感と髪の流れに限界がある。Blender をつないで、画面を見ながら作る方式に切り替える（2026-11-20、ユーザーの判断）。

## 1. つなぎ方（お手元の PC で 1 回だけ）

MCP for Blender（旧名 blender-mcp。MIT ライセンス）を使います。以下は公式の README で確認した内容です（2026-11-20）。

1. **Claude Code を入れる**（`claude` と打って「認識されていません」と出るなら、まだ入っていない）。公式の手順（2026-11-20 に確認）：
   - Windows の PowerShell：`irm https://claude.ai/install.ps1 | iex`
   - Windows のコマンドプロンプト：`curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
   - WinGet：`winget install Anthropic.ClaudeCode`
   - 入れたら**ターミナルを開き直して** `claude --version`。見つからなければ、`%USERPROFILE%\.local\bin` を PATH に足す
   - `claude` を実行してサインインする（有料プランのアカウントが要る）
2. **必要な物**：Blender 3.0 以降、Python 3.10 以降、uv。あとで使う MPFB は Blender 4.2 以降が要るので、**Blender は 4.2 以降**にする
3. **uv を入れる**：公式のインストーラーで入れる（`pip install uv` は使わない、と README にある）
   - macOS：`brew install uv`
   - Linux：`curl -LsSf https://astral.sh/uv/install.sh | sh`
   - Windows：uv の公式サイト（astral.sh）の手順で
4. **Blender にアドオンを入れる**：ターミナルで `uvx mcp-for-blender install-addon`
   - Blender の「編集 → プリファレンス → アドオン」で「Interface: MCP for Blender」を有効にする
   - 3D ビューで N キー →「MCP for Blender」タブ →「Start MCP Server」（または「Connect to Claude」）
5. **Claude Code につなぐ**：このリポジトリのフォルダで `claude mcp add blender -- uvx mcp-for-blender`
   （名前のあとに `--` が要る）。`claude mcp list` でつながったか確かめる。「Failed to connect」なら、
   `uvx mcp-for-blender` を単独で実行してエラーを見る（Windows で `cmd /c` で包む必要があるかは、公式の説明に無く未確認）
6. Claude Code を起動して、「docs/girl-blender.md を読んで、女の子のモデルを作って」と頼む

つながると、Claude は Blender の中で Python を実行でき（`execute_blender_code`）、ビューポートの画面を見られます（`look`）。

**気をつけること**（README の注意書き）
- アドオンの接続口には認証も暗号化もない。その口に届く人は、Blender の中で Python を実行できる。**自分の PC の中（localhost）だけ**で使う
- 既定では、Claude は Blender の中でどんな Python でも実行できる。ファイル・プロセス・ネットワークを止める「セーフモード」
  （環境変数 `BLENDER_MCP_SAFE_MODE=1`）もあるが、VRM の書き出しにはファイルの保存が要るので、使うなら書き出しのときだけ外す
- 匿名の利用統計が既定で送られる。止めるには `DISABLE_TELEMETRY=true`
- 作業の前に Blender のファイルを保存しておく

## 2. 使う道具

| 道具 | 何に使う | 確認できたこと | 未確認 |
|---|---|---|---|
| MPFB 2（MakeHuman の Blender アドオン） | 人体の土台（体型・顔立ちをスライダーで） | Blender 4.2 以降が要る。無料・オープンソース | **作ったモデルのライセンス**（リポジトリの `LICENSE.ASSETS.md` を読むこと）。入れ方（公式サイトがこの環境から読めなかった） |
| VRM Add-on for Blender | VRM で書き出す | Blender 2.93〜5.3 に対応。4.2 以降は Blender のプリファレンスから入れられる。MIT と GPL-3.0 の選択制 | VRM 1.0 の書き出し・表情・視線・揺れ物の細かい対応（アドオンの画面で確かめること） |

売り物にするので、**素材ごとにライセンスを確かめてから使う**（体・髪・服・テクスチャのそれぞれ）。確かめられない素材は使わず、自分で作る。

## 3. 目標の見た目

ユーザーが参考写真で示した方向を、言葉でまとめたものです。**実在の人の顔には似せない**（売り物にするとき、肖像の権利の問題になる）。
顔立ちの系統・髪型・服の雰囲気だけを取り入れる。

- **体つき**：大人の女性。身長 1.60〜1.65m、7 頭身ほど。細身で、ウエストが締まっている。首は細すぎず（あごの幅の 7 割ほど）、
  あご先より後ろに立つ。肩から首へなだらかな線
- **顔**：写実寄り。やや丸みのある卵形で、ほおに少しふくらみ。切れ長の目に二重の線、自然な太さの眉。
  鼻は小さめで、眉間から鼻先へゆるく反る鼻筋。唇は上下ともふっくら。あご先は小さく丸く、あごの下に影ができる
- **髪**：黒のストレートのロング（胸の下まで）。**前髪は眉のすぐ上でまっすぐ切りそろえる（ぱっつん）**。
  顔の横は、前髪の端からそのまま厚い髪がまっすぐ下り、耳を隠して、肩の前を通って胸まで。毛量は多く、つやの帯が入る。
  目の横に細い毛を垂らさない
- **服**：黒の長そでニット（ハイネック）。ウエストをリボン（ちょう結び）で結んだ、黒のひざ丈のフレアスカート。黒のパンプス。素足

いまのコード製のモデル（`?girl=original`）が、この方向の下書きです。寸法の出発点として `src/girlmodel.js` の骨の表（`boneTable`）を使える。

## 4. ゲームが必要とすること（`src/character.js` が使う所）

モデルは **VRM**（できれば 1.0）で、`@pixiv/three-vrm` で読みます。

**向きと姿勢**
- T ポーズ、足元が原点、+Y が上。VRM 1.0 は +Z が前（0.x は読み込み時に回す）
- 正規化した人型の骨に角度を入れて動かす。腕を下ろす・座る・歩くなどは、すべてコードが骨を回す（モデルにアニメーションは要らない）

**人型の骨**（VRM の人型の名前。これが無いと、その部位が動かない）
- 必須：`hips` `spine` `chest`（または `upperChest`）`neck` `head`、左右の `UpperArm` `LowerArm` `Hand` `UpperLeg` `LowerLeg` `Foot`
- あると良い：`upperChest`、左右の `Shoulder` `Toes`
- 指：左右の `Index` `Middle` `Ring` `Little` の `Proximal` `Intermediate` `Distal`、`ThumbProximal` `ThumbDistal`
  （物をにぎる・手を軽く丸めるのに使う）

**表情**（VRM の表情の名前。0〜1 の重み）
- 顔：`happy` `relaxed` `surprised`
- 目：`blink` `blinkRight`（ウインク）
- 口：`aa` `ih` `ou` `ee` `oh`（しゃべるときの口の形）

**視線**：VRM の lookAt を設定する（目の骨か、表情での視線）。コードが見る相手を切り替える。

**揺れ物**（VRM の spring bone）
- 髪とスカートに設定する。長い髪は、頭を振り向けても肩に入らないよう、肩と胸にコライダーを置く
- **スカートの骨は、名前に `skirt` を入れる**。チェーンの根もとの骨は、前を `front`、横を `side` を含む名前にする
  （例：`Skirt_Front_L_01`）。カートに座るとき、コードがこの名前で前と横の骨を探して、腿のあいだへ垂らす（`drapeSkirt`）
- スカートの頂点が腿の骨から受ける重みは、座るとコードが腰へ移す（`relaxSkirtWeights`。骨の名前に `skirt` が要る）
- 座る・足を組む・またがる（乗馬・ポケバイ）・カートに乗る、で腿がスカートを突き抜けないこと。
  念のため、スカートに隠れる範囲の腿は、スカートの裏地の色にしておく

**メタ情報**（VRM の meta。開始画面のクレジットに出る）
- 名前と作者を入れる
- **利用条件は、売り物に使える設定にする**：商用利用を許可、再配布と改変は自分で決める。
  いま同梱の `models/character.vrm` は「個人・非営利のみ／再配布不可／改変禁止」で、売り物に使えない

**軽さ**（VR は両目ぶん描く。Quest 単体でも動かしたい）
- 三角形は 3〜5 万まで。素材（マテリアル）は 3〜5 個にまとめる（描画命令の数になる）
- テクスチャは 2048 まで（顔・体・髪・服をまとめられるなら 1〜2 枚）
- ファイルは 15MB 以下（いまのモデルが 15MB）

## 5. 置き場所と確かめ方

1. 書き出した VRM を `models/` に置く（例：`models/girl.vrm`）。Blender のファイル（.blend）は、大きければリポジトリに入れない
2. `npm start` でサーバーを起動し、`http://localhost:8080/?vrm=./models/girl.vrm` で開く
3. 確かめること
   - 立つ・歩く・ソファーに座る・足を組む・もたれる（部屋でしばらく見ていると、順にする）
   - まばたき・笑顔・しゃべる口・こちらを目で追う
   - カート・ブランコ・シーソー・乗馬・観覧車に乗る。テニス・キャッチボール・釣りで、持ち物が手の位置に合う
   - 背丈が変わるので、座面に腰が合うか、足が床に届くか
   - コンソールにエラーが出ないこと
4. 良ければ、`src/character.js` の `CHARACTER.url` をそのファイルに変えて既定にする。`models/README.md` と開始画面のクレジットも直す
5. リリースのときは、`src/version.js` と `package.json` のバージョンを上げる（ROADMAP.md の「進め方」）

## 6. いまあるもの

- `src/girlmodel.js`：コードだけで作るモデル（`?girl=original`）。Blender 製ができるまでの試作。できたあとは、
  モデルが読めないときの代わりとして残すか、消すかを決める
- `models/character.vrm`：ユーザーが VRoid Studio で作ったモデル（いまの既定）。利用条件が売り物に使えない設定
- ROADMAP.md の「売り物の水準へ」の C1 が、この作業
