# 5 人目の女の子・ワンピース 2（Blender）

`girl-onepiece2.blend` は、5 人目の女の子の元データです。4 人目の `blender/girl-onepiece/girl-onepiece.blend` を 2026-11-27 に写して作り、
服・髪・体のサイズを変えました。顔立ち（手で直したシェイプキー）は 4 人目のままです。

- 服：白い生地に白い花の刺しゅうのレースのワンピース。四角い襟ぐり（前のふちにぎざぎざで透かしの菱形のレース `OP_Trim`）、
  ふくらんだ短いパフスリーブ（袖口にレースのフリル `OP_Frill`）、白いサテンの細い帯、ひざ上丈でふんわり広がる 2 段のスカート
  （下の段 `OP_Skirt` は薄い白い布、上の段 `OP_SkirtLace` はレースで、すそはスカラップ）。白いエナメルのメリージェーン（下の「靴」）
- 髪：こげ茶の肩までの長さ。顔のまわりをふんわり囲み（`SIDE_X`・`MID_PUFF`）、毛先は外へはねる（`CURL` をマイナス）。前髪は眉の上で切りそろえる
- カチューシャ：白。本人の左にリボン（`Girl_HairBand`。`scripts/make_headband_onepiece2.py`）。2026-11-28 に外した（`hide_viewport`・`hide_render`。書き出しにも入らない）
- サイズ：はだしで 155cm、7 頭身、B86（E カップ。アンダー 65）・W58・H84、足 22cm。
  腕は上腕 28cm・前腕 22.5cm・手 16.5cm、股下 71cm、太もも 38.3cm・すね 34.3cm

## Blender の中で手で直したところ（4 人目から引き継いだ）

顔は `make_face_onepiece2.py` で作ったあと、Blender の中で多くのシェイプキー（`custom-*`）を足して直してある（卵型の輪郭・丸いあご・目の形・口元・首の付け根など）。
`make_face_onepiece2.py` を流し直すと、この直しは消える。だから身長・頭身・スリーサイズは `make_face_onepiece2.py` の値（`HEIGHT`・`HEAD_H`）ではなく、
今の形にシェイプキーを足す下のスクリプトで合わせてある（`make_face_onepiece2.py` の値は 4 人目のときのまま）。

- まつ毛：1 本ずつの毛のまつ毛を別のオブジェクトにした（`Girl_LashStrands`・`Girl_LashLowerStrands`。頭の骨に付ける）
- アイライン・二重の線・下まぶたのピンク：頂点の属性（`mk_liner`・`mk_lid_dz` など）に書き、肌の材質で描く
- 表情：まつ毛・歯・眉の表情キーは、体の表情キーの値で動く（ドライバー）。書き出しでは同じ名前の表情キーとして VRM の表情に入る

体・骨組み・共通の顔のスクリプトは、ほかの子と同じものを使います
（`C:\Users\shuji\Documents\girl-blender\scripts\`。写しは vrgame2 の `blender/girl/scripts/`）。

## サイズを合わせたスクリプト（それぞれ 1 回だけ流してある。この順）

どれもシェイプキーを 1 つ足し、骨組みの骨も同じだけ動かします。2 回流すと 2 回かかるので、2 回目は止まるようにしてあります
（やり直すときは、流す前の .blend を開き直す）。

| ファイル | シェイプキー | すること |
| --- | --- | --- |
| `scripts/set_size_onepiece2.py` | `custom-size` | はだしの身長を 155cm に（全体を縮める）、胴回りを B86・アンダー 65・W58・H84 に、足を 23cm に。眉・まつ毛・歯・髪の値も直す |
| `scripts/set_head_onepiece2.py` | `custom-headsize` | 7.5 頭身に（頭を 1.17 倍に大きくし、首から下を少し縮めて身長を保つ） |
| `scripts/set_limbs_onepiece2.py` | `custom-limbs` | 腕を上腕 28cm・前腕 22.5cm・手 16.5cm に伸ばす。股下を 71cm に縮め、そのぶん胴（腰〜胸の下）を伸ばす |
| `scripts/set_girth_onepiece2.py` | `custom-girth` | 胴回りを B86・W58・H84 に合わせ直す（何度流してもよい） |
| `scripts/set_knee_onepiece2.py` | `custom-knee` | 膝を 2cm 下げる（太ももを伸ばし、すねを縮める。股下は変えない） |

| `scripts/set_head_onepiece2.py`（2 回目。`KEY="custom-headsize2"`・`HEADS=7.0`） | `custom-headsize2` | 7 頭身に（顔が小さく見えたため） |

| `scripts/set_side_slim_onepiece2.py` | `custom-side-slim` | 脇の下〜腰の横の張り出しを寄せ、前後から見て脇の下からまっすぐ下りる線に（何度流してもよい） |
| `scripts/set_bust_keep_onepiece2.py` | `custom-bust-keep` | バストを 86cm に保つ。ふくらみを左右へ離し、前への突き出しを `FLAT`（0.72）倍に抑える（何度流してもよい） |
| `scripts/set_arm_plump_onepiece2.py` | `custom-arm-plump` | 二の腕を 1.2 倍にふっくら（何度流してもよい） |
| `scripts/set_foot_onepiece2.py` | `custom-foot` | 足（かかと〜つま先）を `FOOT`（22cm）に合わせる。足先の骨も伸ばす（何度流してもよい） |
| `scripts/set_hand_onepiece2.py` | `custom-hand` | 手首〜中指の先を、あご先〜眉の長さ（12.9cm）に。手と指の骨も縮める（何度流してもよい） |

胴回りは、高さ z の平面で肌を切った断面の凸包の周（巻き尺で測るのと同じ）で測っています。

## 顔立ち・メイク・耳（何度流してもよい）

特定の人に似せるのではなく、昭和のアイドル風の雰囲気に寄せています。

| ファイル | すること |
| --- | --- |
| `scripts/set_vibe_onepiece2.py` | 顔のシェイプキーの効き具合（ほお・鼻・あご・鼻すじ・えら）、ふだんのほほえみ（`custom-idol-smile`）、髪の色 |
| `scripts/set_makeup_onepiece2.py` | 肌のつや、チークの位置と広がり、眉の色と高さ（`Girl_Brows["brow_up"]`）、唇の色 |
| `scripts/set_ear_natural_onepiece2.py` | 耳：4 人目の耳の直し（`custom-ear-*`）を全部 0 にして MakeHuman の素の耳に戻し、大きさ（`ear-scale-decr` 0.35）と頭への寄せ方（`ear-wing-decr` 1.0）だけ決める |
| `scripts/set_idol_face_onepiece2.py` | 2026-11-28 の直し。`set_vibe` のあとに流す。高さは目の骨（`leftEye` の基本の位置）から決める（靴を替えると体ごと上下するため）。目（横に長いアーモンド形で、上まぶたが黒目の上を少し隠す。たれ目 `custom-idol-eye`）、鼻（短く低く、下げて鼻と口のあいだを狭める。小鼻を小さく）、口（小さく、口角を上げ、横から見て出すぎないよう奥へ）、ほお（ムチッとした丸みは残し、下ほおとあごを少し細く）、眉（UV から形を決めて肌に貼り直す。低め・長め・まん中寄り。影は落とさない）、下まぶたのふちのならし（`custom-lowlid-clean`）、目じりの外と口のまわりのしわ取り（`custom-smooth-wrinkle`）。最後に `set_lash_fit`・`set_blink_fit` を呼び、眉にまばたき・やすらぎの表情キー（肌と同じだけ動く）を作る |
| `scripts/set_lash_fit_onepiece2.py` | まつ毛を今の目の形に合わせ直す。目を直す前のまつ毛（`_LashOrig_Upper`・`_LashOrig_Lower`。親なし・非表示で保管）を、まぶたのふちの補助メッシュ（`helper-?-eyelashes-*`）の動きで運び、毛の付け根を見えている白目のふちにそろえる。近くの肌の動きの平均で動かしたら、根元が浮いて段になった |
| `scripts/set_blink_fit_onepiece2.py` | まばたきのキーを、閉じた位置が目を直す前と同じになるよう合わせ直す（元のキーは `_orig-exp-blink*` に保管）。閉じた目のまつ毛が少し波打つのは直す前から |
| `scripts/make_expressions_extra_onepiece2.py` | 怒り（`exp-angry`）と悲しみ（`exp-sad`）の表情を足す。まばたき・やすらぎ・口角の動きを少しずつ足し、眉のまわりの肌と眉を上げ下げする。眉・まつ毛にも同じ名前のキーを作り、体のキーの値で動かす。書き出しの `EXPS` に入れてある |
| `scripts/set_crease_onepiece2.py` | 二重の線。まぶたのふちからの高さ（属性 `mk_lid_dz`）を今の形で取り直し、まつ毛のすぐ上に描く |
| `scripts/set_ear_reattach_onepiece2.py` | 耳の付け直し（`custom-ear-reattach`）。顔・頭の直しのキーで耳のまわりだけがゆがみ、耳の前に段差・上に稜線ができて、耳が板のように見えていた。MakeHuman の素の耳を、まわりの肌の動き（相似変換）に合わせて丸ごと置き直し、付け根をなじませる。大きさは `ear-scale-decr` 0.3（高さ 6cm。目〜鼻の下の高さ）。素の頭の基準だと高く後ろすぎたので `OFFSET`（前へ 8mm・下へ 12mm）ずらす。`set_ear_natural` のあとに流す |
| `scripts/make_couture_onepiece2.py` | 服の飾り：背中の大きなサテンのリボン（`OP_Bow`）、背中のパールのボタンと前の襟ぐりのパール（`OP_Pearls`）。服のあとに流す |

`set_ear_round_onepiece2.py`・`set_ear_smooth_onepiece2.py`（耳の丸め・まわりのならし）は試したが、耳の形を崩したので使っていない（キーは 0）。

頭の横幅（`custom-skull-narrow`）は 0.357 にしてある（頭の幅 0.86 倍 → 0.95 倍）。

## 髪（聖子ちゃんカット風・2 層）

2026-11-28 に、殻を垂らす作り方の上の層をやめ、毛束を 1 本ずつ並べる作り方にした（殻ではぱっつんの前髪と波打つ板になった）。
3 枚目の参考の写真に合わせて、丸くふくらんだボブ（輪郭はベル形）にしている。前髪は厚く眉を隠し、横と後ろはあごの下〜首の高さで内へ巻き込む。耳と眉は隠れる。

- 下の層 `Girl_Hair`：`make_hair_onepiece2_bob.py` に `Girl_Body["hair_params"]`（`NO_BANG=True`・`LONG_A=120`。前と顔の横は作らず、後ろだけ。`ZB` は首の高さ）。
  靴を替えて体が 2.27cm 下がったので、高さの値（`C`・`ZB`・`ZSH`・`ZBANG`・`BANG_CUT`・`ZSM`）を下げ、頭を包む楕円（`RX`・`RY`・`RZ`）を 0.95 倍にした。
  そのときの目の骨の高さを `EYE_REF` に残してある
- 上の層 `Girl_HairLayer`：`make_hair_seiko_onepiece2.py`。高さは目の骨からの距離で決める。
  前髪（毛束 45 本。重ねて額をすかさず、毛先の 2 割だけとがらせる。上まぶたのすぐ上まで）、横の段 2 つ（ほお・あごの下で内へ巻く）、後ろ（首の高さで内へ巻く）、
  てっぺんのすき間をふさぐ丸い面、頭の地肌にぴったり沿う薄い面（生え際から上、横は耳の下まで、後ろはえりあしまで。耳は外からくるむ。
  これがないと、下から見上げたとき前髪のすき間や耳のまわりから地肌が見えて、はげ頭のように見えた）。
  毛束は長さ 20 点・幅 3 列（約 3 万三角形）。UV は 1 本ずつ重ならないマスに並べる（書き出しで画像に焼くため）
- 髪の色は黒に近いこげ茶（`set_vibe_onepiece2.py` の `HAIR`）
- 作り直したら共通の `bind_rig.py` で骨の重みを付け直す（カチューシャは使っていないので、`make_headband_onepiece2.py` は流さず `bind_rig.py` を直接流す）

`Girl_Body["hair_layer_params"]`（前の殻の上の層の値）は使っていない。

## 作り直し方（Blender の中で、この順に exec する）

| ファイル | すること |
| --- | --- |
| `scripts/make_hair_onepiece2_bob.py` | 髪。値は `Girl_Body` の `hair_params`（`exec(..., dict(hair_params))` のように渡す）。流したら共通の `bind_rig.py` で骨の重みを付け直す |
| `scripts/make_hair_seiko_onepiece2.py` | 髪の上の層（聖子ちゃんカットの毛束）。下の層のあとに流す |
| `scripts/make_outfit_onepiece2.py` | 服と靴を作り、骨組みに付ける（`LACE = True` で白いレース。`Girl_Body` の `square_neck` で四角い襟ぐり）。服の寸法は 3 人目の体の値で書いてあり、身長の倍率（`height_s`）で割って作ってから掛け戻す |
| `scripts/make_headband_onepiece2.py` | カチューシャとリボン。髪を作り直したら流し直す |
| `scripts/export_vrm_onepiece2.py` | VRM 1.0 で `export/girl-onepiece2.vrm` に書き出す（見た目が完成してから） |

レースの柄（`OP_Lace`）は計算で描いていて、上身ごろは前・後ろ・横・袖で貼り方を変えています。
貼り方の継ぎ目の近く（頂点の属性 `NoSeam` が 0 の所）には花と葉を置きません（継ぎ目で柄が細切れになるため）。
`export/` と `*.blend1` はリポジトリに入れません。

## 靴（既製のモデル）

白いエナメルのメリージェーン（甲にストラップとボタン、太めの低いヒール。かかとは指の付け根より約 4.5cm 高い）。Sketchfab の既製モデルを、
大きさと向きを足に合わせて置き、ヒールを低くしています（`scripts/make_maryjane_onepiece2.py`。服・飾りのあとに流す。
値は `S=1.05`・`SX=0.88`・`YAW=-2.5`・`DX=-0.004`・`LOWER=0.046`・`POW=0.5`）。甲のベルトは両脇の付け根と同じだけ下げて、甲に沿わせています。元のヒールは約 7cm で、指の付け根より後ろを
後ろへ行くほど多く下げ（土踏まずのあたりを早めに下げて中敷きを足の裏に沿わせる）、ヒールの柱は床の面を残して縮めています。
取り込んだ左の靴（`MJ_L`。つま先 -Y、かかとの後ろ y=0、床 z=0 に置き直し、面を 1/10 に減らしたもの）を .blend に残してあり、そこから
（元のモデルは左右の靴がくっついた 1 つの形で、切り分けると内側の壁に穴としわが残ったため、`MJ_L` は外側の半分を鏡に写した左右対称の形にしてある。
ボタンは両側に付く）
`OP_MaryJaneL`・`OP_MaryJaneR`（右は鏡写し）を作ります。色は元の絵（えんじ）から色味を抜いた白い絵（`OP_MaryJaneWhite`）を作って貼っています。
足の傾きは `set_foot_tilt_onepiece2.py` の `ANG=0`（`custom-heel` だけの傾き。足の裏の傾き約 13°、かかとの下 5.4cm）です。
靴の中の肌は隠します（靴が肌の外側 12mm 以内にある所と、つま先の横で壁の外へ 2cm 以内出た所、まわりとつながらない小さな肌のかけら）。

前に試した靴（計算で作った `OP_Shoes`・`make_pump_onepiece2.py`、既製のパンプス `OP_PumpL`/`OP_PumpR`・`make_pump_asset_onepiece2.py`）は使っていません（隠してある）。

- クレジット（CC BY 4.0）："Burgundy Mary Jane Shoes" by mangoon14 — https://sketchfab.com/3d-models/f76677f9923346ba960d4693d0a09fdc
