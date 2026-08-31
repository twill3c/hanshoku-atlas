# hanshoku-atlas — 版色アトラス

浮世絵の**版ごとの平面色(版色)**を復元して測る。

写真と違い、木版画は一版一色の平面色で構成される。だから画像の色は連続分布ではなく、
版の数だけの離散クラスタを成している**はず**である。写真に対する k-means は便宜的な減色でしかないが、
木版画に対するそれは**制作構造の推定**でありうる —— その「はず」が成り立つ範囲を測るのがこのアプリの主題である。

## 測っている対象を短くしない

浮世絵の画像から色相ヒストグラムを出すのは 30 分で書ける。問題はその数字が何を測っているかだ。
我々が見ている色は少なくとも四層の媒介を通っている:

1. 摺られた当時、版木と顔料が生んだ色
2. 200 年超の褪色(紅と露草は光で消える。紫は青灰色へ、桃色は生成りへ)
3. 所蔵館の照明・撮影機材・カラープロファイル・後処理
4. 閲覧者のディスプレイ

**アプリが制御できるのは 4 だけである。**したがって「浮世絵の色相分布」という対象は素朴には存在しない。
このアプリが測るのは **「メトロポリタン美術館が公開した画像において、k-means が復元した版色の分布」** である。

**本番 https://hanshoku-atlas.vercel.app**

## いま動くもの(L1)

**① 一枚解剖** —— 画像 URL を入れると版色を抽出し、面積比と OKLCh 座標を出す。
パレットを押すとその版だけが画面上で光る。紙の地色を版色に数えるかはトグルで選べる。

**② 色相環** —— 一枚の絵を数点の布置に抽象化する。角度 = 色相、半径 = 彩度、点の大きさ = 面積比、
**縁の太さ = 明度**。明度を色の濃さで表すと褪せる青と残る青が同じ点になるので、縁に逃がしてある。

## 測って分かったこと(2026-08-31)

| | |
|---|---|
| 版色の復元(標準条件・合成木版 60 枚) | ΔE2000 中央値 **0.0000** / 最大 **0.3048** |
| 面積比の復元 | 絶対誤差 最大 **4.43×10⁻⁴** |
| エルボーが版数を当てる率 | **1.000**(合成木版。**本物の版画では検証できない**) |
| Chromium ↔ Firefox の色相角の差 | **0.000°**(16 進表記まで一致) |
| TS ↔ Rust/WASM | 結論も**経路も**ビット一致(経路をずらした対照は 12/12 で落ちる) |
| 抽出の速さ(実画像・k=8) | Chromium **610–724 ms**(WASM)/ Firefox **968–1,128 ms**(TS) |
| 神奈川沖浪裏 JP10 の相異なる色 | **55,100** |
| 同、k=8 のとき紙の帯が占める割合 | **75.9 %**(4 クラスタに割れる) |

**本物の浮世絵の版数はカタログに書かれていない。**Met の記述は
“Woodblock print; ink and color on paper” までで版数を記さない。
だから「エルボーが版数を当てる」は**合成木版についてだけ**言える。この限界は画面にも書いてある。

## 落とし穴の記録

- **`images.metmuseum.org` は `curl -I`(HEAD)には `Access-Control-Allow-Origin: *` を返すが、GET には返さない。**
  HEAD で測って「プロキシ不要」と書き、実ブラウザ検品で初めて誤りが分かった(SPEC §2.7)。
  対処は `vercel.json` の rewrite で `/met/*` を同一オリジンに寄せること。**本番経路で検証済み**
- **シカゴ美術館の IIIF は Cloudflare の bot チャレンジで 403。**クロスオリジンの img はチャレンジを解けない
- **AIC の `color` フィールドは色オラクルにならない。**神奈川沖浪裏の「dominant」は画面の 0.5 % しか占めない
- **露草色(褪せる)と藍色(残る)の色相角の差は 1.3°。**色相ヒストグラムでは分離できない
- **Rust/WASM が速いとは限らない。** Chromium では TS の 1.5 倍速いが、**Firefox では 4 倍遅い**。
  だから実行時に測って選ぶ —— 二実装がビット一致するので、選択は結果を変えない
- **小さすぎるベンチと暖機なしは、実測と反対の結論を出す**(SPEC §2.10)

## 開発

```bash
npm install
npm test                  # vitest(56 件)
npm run build             # 静的書き出し(out/)
npm run verify:browser    # 実ブラウザ検品 + G-07 の実測(ローカル out/・rewrite は模倣)
node scripts/verify-browser.mjs --url https://hanshoku-atlas.vercel.app/   # 本番経路
python scripts/make_color_oracle.py   # 色変換オラクルの再生成(colour-science)

# Rust/WASM(第二実装)
cargo test  --manifest-path rust/Cargo.toml --release
cargo build --manifest-path rust/Cargo.toml --target wasm32-unknown-unknown --release
cp rust/target/wasm32-unknown-unknown/release/hanshoku.wasm public/hanshoku.wasm
```

- 仕様は [SPEC.md](SPEC.md)、検査は [TEST_SPEC.md](TEST_SPEC.md)
- 使い方は[版色アトラスの歩き方](https://claude.ai/code/artifact/53dcce2c-f144-4615-8418-d3e3faad5be7)、
  構造は[版色アトラスの設計図](https://claude.ai/code/artifact/5a6c3bad-00fc-463d-ad9a-55b0710b1b53)
- ループの記録は `logs/loops/`

MIT License © 2026 坂田哲朗
