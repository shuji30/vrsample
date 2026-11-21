# 3 人目の女の子・ニットコーデ（Blender）

`girl-knit.blend` は、`models/girl-knit.vrm` の元データです。
黒のハイネックニット、リボン柄のフレアスカート（ちょう結びのリボン付き）、白のインナー、黒のパンプス（ブロックヒール）。
髪は黒のストレートで、眉ぎりのぱっつん前髪、長さは胸の上まで。

体・骨組み・共通の顔のスクリプトは、ほかの 2 人（水着・ストリート）と同じものを使います
（`C:\Users\shuji\Documents\girl-blender\scripts\`。写しは vrgame2 の `blender/girl/scripts/`）。
ここの `scripts/` は、この子だけの値と追加の形です。

## 作り直し方（Blender の中で、この順に exec する）

| ファイル | すること |
| --- | --- |
| `scripts/make_face_knit.py` | 体型（細め・ヒール・胸）、首・小顔・額、顔立ち、メイク、表情（笑顔・あいうえお）、髪（`make_hair_knit.py` を呼ぶ）、眉（`make_brows_knit.py` を呼ぶ） |
| `scripts/make_outfit_knit.py` | 服と靴を作り、骨組みに付ける |
| `scripts/export_vrm_knit.py` | VRM 1.0 で `export/girl-knit.vrm` に書き出す。できたものを `models/girl-knit.vrm` に写す |

`make_hair_knit2.py`（横分けのウェーブ）は試作で、いまは使っていません。
`export/` と `*.blend1` はリポジトリに入れません。
