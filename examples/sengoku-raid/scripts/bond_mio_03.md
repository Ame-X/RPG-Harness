---
id: bond_mio_03
title: 鏡を見る
characters: [mio]
requires:
  all:
    - { affection: { character: mio, min: 6 } }
    - { switch: { name: befriended_mio } }
---

:cg assets/cgs/bond-mio-03

夕暮れ。隅田河の岸辺。

@mio 一度、二人で水面を覗かせてもらえるか。

@narrator 澪は水際に膝をついた。お主も並んで膝をつく。

@narrator 二人の影が水に映る。澪の影は揺れず、澪自身よりずっと若く見える——お主の影は、半分が黒く滲んでいる。

@mio 私の家業——水鏡——は、自分を見るためのものでもある。

@mio 公儀の見立ては、結局、人間が人間を測る。誤る。

@mio だが、水鏡は——

@mio （澪は水面を指で乱した。お主の影の黒い部分が散る）

@mio 嘘をつかない。

? それでも、何か答えたかった。
  - 「お前自身の影、若く見えるが」 -> +mio
  - 「鏡が示すのは、未来か」 -> +mio
  - 「黙って、隣にいてくれ」 -> +2mio

@mio 公儀の沙汰がどう下ろうと——私の鏡には、お主は未だ堕ちず。

@mio それを覚えておいてくれ。

:hide-cg

[end]
