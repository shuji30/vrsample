# models/

キャラクター（VRM）を置く場所です。`src/character.js` は既定で
`models/character.vrm` を読みに行き、**無ければキャラクターだけ出ない**まま
部屋はそのまま動きます。

```
models/character.vrm    このリポジトリのオーナーが自作した VRM 1.0 モデル
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
