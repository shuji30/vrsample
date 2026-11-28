# 車のモデル（GLB）の作り方

配布されている車のモデルを、ゲームで使える形（`src/carmodel.js` が読む）に Blender で組み直すスクリプトです。
Blender 5.2 をバックグラウンドで動かします（開いている Blender には触りません）。

```
# GT3（Porsche GT3 RS。"Porsche GT3 RS" by Black Snow、CC BY 4.0）
blender -b --factory-startup --python blender/cars/build_gt3.py -- models/porsche_gt3_rs.glb models/gt3.glb 0.35

# ガレージの Lexus（zip を展開した source/*.glb を渡す）
blender -b --factory-startup --python blender/cars/build_lexus.py -- <展開先>/source/Sketchfab_2026_11_14_14_55_43.glb models/lexus.glb 0.3
```

最後の数字はポリゴンを減らす割合（0.35 なら大きな部品を 35% に）。

- 部品を Body・Wheel_LF/RF/LR/RR（原点が車輪の中心）・Caliper_*（Lexus だけ）・Steer（原点が輪の中心。
  extras の `axis` が回る軸）にまとめる
- ライトの材質を、前は `CarHead_*` / `LexusHead*`、後ろは `CarTail_*` / `LexusTail*` に写す（夜・ブレーキで光らせる）
- GT3 は、重なっている別バージョンの部品（時計なしのダッシュ・MT のシフトなど）と見えない下回りを捨て、タイヤの下を地面（0）にする
- テクスチャは 512〜1024 に縮め、WebP で書き出す
