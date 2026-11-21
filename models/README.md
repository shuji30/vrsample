# models/

キャラクター（VRM）を置く場所です。`src/character.js` は既定で
`models/character.vrm` を読みに行き、**無ければキャラクターだけ出ない**まま
部屋はそのまま動きます。

```
models/character.vrm    このリポジトリのオーナーが自作した VRM 1.0 モデル（VRoid Studio。既定）
models/girl-swim.vrm    Blender で作った自前のモデル・水着コーデ（VRM 1.0）
models/girl-street.vrm  Blender で作った自前のモデル・ストリートコーデ（VRM 1.0）
models/girl-knit.vrm    Blender で作った自前のモデル・ニットコーデ（VRM 1.0。作り方は blender/girl-knit/）
models/corgi.glb        Blender で作った自前のモデル・コーギーの「こむぎ」（GLB。骨入り。作り方は blender/corgi/）
models/sarusuberi.glb   Blender で作った自前のモデル・さるすべりの木（GLB。満開のピンク。作り方は blender/sarusuberi/）
```

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
