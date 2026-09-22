# models/

キャラクター（VRM）を置く場所です。`src/character.js` は既定で
`models/character.vrm` を読みに行き、**無ければキャラクターだけ出ない**まま
部屋はそのまま動きます。

```
models/character.vrm
```

別のファイルを試したいときは URL で差し替えられます。

```
http://localhost:8080/?vrm=./models/another.vrm
```

## VRM をリポジトリに入れていない理由

VRM にはモデルごとのライセンス（`VRMC_vrm.meta`）が埋め込まれていて、
**再配布（`allowRedistribution`）や改変（`modification`）が禁止**されている
ものが珍しくありません。リポジトリに置いて GitHub Pages で公開するのは
再配布にあたるので、`.gitignore` で `models/*.vrm` を除外しています。

自分で作ったモデルや、再配布が許可されたモデルを使うときは、
`.gitignore` の該当行を外してコミットしてください。

多くのモデルは表示（`creditNotation: required`）を求めます。読み込みに成功すると
`meta` の名前と作者を画面左上のオーバーレイに出すようにしてあります
（`src/main.js`）。
