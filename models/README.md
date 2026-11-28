# models/

キャラクター（VRM）を置く場所です。どのモデルを読むかは `src/girlchoice.js` が決めます
（既定はニットコーデ。開始画面の「女の子」で選べる）。モデルが無ければ**キャラクターだけ出ない**まま
部屋はそのまま動きます。モデルが仕様を満たすかは `node scripts/vrm-audit.mjs models/*.vrm` で調べられます。

```
models/character.vrm    このリポジトリのオーナーが自作した VRM 1.0 モデル（VRoid Studio。売り物に使えない利用条件なので、既定ではない）
models/girl-swim.vrm    Blender で作った自前のモデル・水着コーデ（VRM 1.0）
models/girl-street.vrm  Blender で作った自前のモデル・ストリートコーデ（VRM 1.0）
models/girl-knit.vrm    Blender で作った自前のモデル・ニットコーデ（VRM 1.0。作り方は blender/girl-knit/。既定）
models/girl-onepiece.vrm Blender で作った自前のモデル・ワンピースコーデ（VRM 1.0。作り方は blender/girl-onepiece/）
models/girl-onepiece2.vrm Blender で作った自前のモデル・ワンピースコーデ 2（VRM 1.0。白いレースのワンピース・昭和のアイドル風。作り方は blender/girl-onepiece2/）
models/corgi.glb        Blender で作った自前のモデル・コーギーの「こむぎ」（GLB。骨入り。作り方は blender/corgi/）
models/sarusuberi.glb   Blender で作った自前のモデル・さるすべりの木（GLB。満開のピンク。作り方は blender/sarusuberi/）
models/gt3.glb          GT3 の車。porsche_gt3_rs.glb（"Porsche GT3 RS" by Black Snow、Sketchfab、CC BY 4.0）を Blender で軽くしたもの
models/lexus.glb        ガレージの Lexus。lexus-lc-500-wald-sports-line-wwwvecarzcom.zip（vecarz）を Blender で軽くしたもの（利用条件は要確認）
```

`gt3.glb`・`lexus.glb` の中は、Body（車体と室内）・Wheel_LF/RF/LR/RR（車輪。原点が中心）・Steer（ハンドル。
extras の axis が回る軸）に分けてあります（`src/carmodel.js` が読む）。元のファイル（`porsche_gt3_rs.glb`・
`lexus-lc-500-...zip`）は大きいので、リポジトリには入れません（`.gitignore`）。

別のファイルを試したいときは URL で差し替えられます。

```
http://localhost:8080/?vrm=./models/another.vrm
```

## ライセンス

VRM にはモデルごとのライセンスがファイル自身に埋め込まれています
（`VRMC_vrm.meta`）。同梱の `character.vrm` は作者本人が置いたものですが、
メタデータ上は**再配布・改変・商用利用が不可、作者表示が必要**
（`creditNotation: required`）です。フォークして再公開するときは差し替えて
ください。

他所のモデルを置く場合も同じで、再配布が許可されていないモデルをリポジトリに
入れて GitHub Pages で公開するのは再配布にあたります。その場合は `.gitignore` に
`models/*.vrm` を足して、手元に置くだけにしてください。

作者表示は、読み込みに成功すると `meta` の名前と作者を画面左上のオーバーレイに
出すようにしてあります（`src/main.js`）。
