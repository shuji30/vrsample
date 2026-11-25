# 4 人目の女の子・ワンピース（Blender）

`girl-onepiece.blend` は、4 人目の女の子の元データです（3 人目の `girl-knit.blend` を写して作った）。
黒地にピンクの大きな花と金・くすんだ緑の葉を織り出したジャカードのワンピース（スタンドカラー・パフスリーブ・ひざ丈のフレア）、
ベリー色の太いベルト、黒のストラップサンダル（ベージュのブロックヒール）。
髪は濃いこげ茶のゆるふわセミロングボブ（`scripts/make_hair_onepiece_bob.py`。値は `Girl_Body` の `hair_params`）。
前髪は眉にかかる長さで切りそろえ、細い毛束のすき間から額が透ける薄めの前髪（髪の材質で、頂点の属性 `bang` の所だけ透かす）。
毛先は肩の上で、ゆるい S 字の波とふくらみを付ける（`WAVE`・`WAVE_LEN`・`FLUFF`）。前のまとめ髪は `make_hair_onepiece.py` に残してあるが、使っていない。
髪を作り直したら、骨の重み（上は頭、耳から下は `hairSwing`）を付け直す（共通の `bind_rig.py`。付けないと頭を動かしても髪がついてこない）。

### Blender の中で手で直したところ（スクリプトにはまだ入っていない）

顔は `make_face_onepiece.py` で作ったあと、Blender の中で多くのシェイプキー（`custom-*`）を足して直してある（卵型の輪郭・丸いあご・目の形・口元・首の付け根など）。`make_face_onepiece.py` を流し直すと、この直しは消える。

- まつ毛：体のメッシュの板のまつ毛は隠し、1 本ずつの毛のまつ毛を別のオブジェクトにした（`Girl_LashStrands`・`Girl_LashLowerStrands`。頭の骨に付ける）
- アイライン・二重の線・下まぶたのピンク：今のまぶたの線から頂点の属性（`mk_liner`・`mk_lid_dz` など）に書き、肌の材質で描く
- 表情：口は `make_expressions_onepiece.py` と `make_face_onepiece.py` の表情の部分で作り、目（まばたき・ウインク・くつろぎ・驚き）は今のまぶたの線から作り直した。まつ毛・歯・眉の表情キーは、体の表情キーの値で動く（ドライバー）。書き出しでは同じ名前の表情キーとして VRM の表情に入る

- 身長：はだしで 160cm。頭の高さ（あご先〜てっぺん）22.2cm、7.2 頭身（`make_face_onepiece.py` の `HEIGHT`・`HEAD_H`）
- 体型は 3 人目と同じ細め・ヒール。肩幅は約 36cm（頭の高さの約 1.6 倍。`measure-shoulder-dist-decr` 1.25）。首は短め（あご先〜のどのくぼみが頭の高さの約 0.3 倍。`NECK_D`）で、えりの高さはあご先から決める（`COLLAR_GAP`）。肩はなで肩（首の横からすぐになだらかに下がる。`custom-shoulder-slope`・`SLOPE_X`/`SLOPE_DZ`）
- 首と顔の下半分の幅は両方から寄せてある：顔の下半分（えら・あご）を横に 0.88 倍（`custom-face-narrow`・`JAW_W`）、
  首はどの高さでも幅 10cm のまっすぐな筒（`custom-neck-thick`・`NECK_W`）
- 頭（額・てっぺん・こめかみ・後頭部）の横幅は 0.86 倍に細くしてある（`custom-skull-narrow`・`SKULL_K`）。目・ほお・口のある顔の前は動かさない
- 横から見た頭の長さ（額〜後頭部）は約 19.7cm。耳より後ろを前後に 0.76 倍に縮めてある（`custom-skull-short`・`SKULL_BACK_K`）
- 目元はきりっと：目じりを上げ（`l/r-eye-corner2-up` 0.8・`EYE_TILT` 6）、目じりのラインは濃く。眉は黒に近いこげ茶で、眉尻を少し上げる（`BROW_TAIL_UP`）。口を閉じた控えめなほほえみ（`custom-soft-smile`・`SOFT_SMILE` 0.15）。鼻は低め

体・骨組み・共通の顔のスクリプトは、ほかの子と同じものを使います
（`C:\Users\shuji\Documents\girl-blender\scripts\`。写しは vrgame2 の `blender/girl/scripts/`）。
ここの `scripts/` は、この子だけの値と追加の形です。

## 作り直し方（Blender の中で、この順に exec する）

| ファイル | すること |
| --- | --- |
| `scripts/make_face_onepiece.py` | 身長と頭身、体型（細め・ヒール・胸・肩幅）、首・頭の大きさ・額、顔立ち、メイク、表情（笑顔・あいうえお）、ふだんのほほえみ、髪（`make_hair_onepiece.py` を呼ぶ）、眉（`make_brows_onepiece.py` を呼ぶ）。頭身を合わせる倍率は今の形を測って決めるので、値を変えたら 2〜3 回続けて実行し、`height:`・`head:` の表示が変わらなくなるまで流す |
| `scripts/make_outfit_onepiece.py` | 服と靴を作り、骨組みに付ける。服の寸法は 3 人目の体の値で書いてあり、身長の倍率で割って作ってから掛け戻す |
| `scripts/export_vrm_onepiece.py` | VRM 1.0 で `export/girl-onepiece.vrm` に書き出す |

服の柄（`OP_Floral`）は計算で描いていて、上身ごろは前・後ろ・横・袖で貼り方を変えています。
貼り方の継ぎ目の近く（頂点の属性 `NoSeam` が 0 の所）には花と葉を置きません（継ぎ目で柄が細切れになるため）。
`export/` と `*.blend1` はリポジトリに入れません。
