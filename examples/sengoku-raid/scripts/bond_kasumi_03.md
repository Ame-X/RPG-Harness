---
id: bond_kasumi_03
title: 鹿の道
characters: [kasumi]
requires:
  all:
    - { affection: { character: kasumi, min: 6 } }
    - { switch: { name: befriended_kasumi } }
---

:cg assets/cgs/bond-kasumi-03

朝。山際の道。

@kasumi あんた、戻り際の足音、私と合ってきた。

@narrator 霞は弓を背負い直し、お主に並んで歩く。

@kasumi 猟師の足って、結局のところ「逃げる」ためじゃないんだ。

@kasumi 鹿の方が早い。だから、追わない。

@kasumi 鬼も同じ。追わない方が、長く生きる。

@narrator 霞は地面を指差した——鹿の蹄の跡が三つ、鬼の足跡を避けて回り込んでいる。

@kasumi ほら、鹿が教えてくれる。鬼の通り道は、ここじゃない。

? それでも、聞きたかった。
  - 「あんたは、なぜ私と歩く」 -> +kasumi
  - 「猟師は、いつ刀を持つ」 -> +kasumi
  - 「鹿の道を、私にも教えてくれ」 -> +2kasumi

@kasumi あんたが鹿の道を歩けるようになったら、私の役目は終わる。

@kasumi それまでは——隣にいる。

:hide-cg

[end]
