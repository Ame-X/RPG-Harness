---
id: bond_kagari_03
title: 同道の槍
characters: [kagari]
requires:
  all:
    - { affection: { character: kagari, min: 6 } }
    - { switch: { name: befriended_kagari } }
---

:cg assets/cgs/bond-kagari-03

宿。月。

@kagari 共に出立すると、刀の音が違って聞こえる。

@kagari 私一人で歩いていた頃、夜は静かすぎた。それを静かと感じていなかった——気づくのは、戻ってから。

@kagari お主の刀は——歌う。私の槍は、唸るだけだ。

@narrator 篝は窓辺の床几に座り、長く息を吐いた。

@kagari 一つ、聞いていいか。

@kagari お主の妖刀が、私の槍の何倍も重そうな夜——どうやって寝ている。

? それでも、答える。
  - 「夢を見ないようにしている」 -> +kagari
  - 「鎮魂法で、毎晩二十押し返す」 -> +kagari
  - 「眠らない」 -> +2kagari

@kagari 嘘でも、答えてくれたのが嬉しい。

@narrator 篝はお主の隣に座り、肩を寄せた。距離は、刀一本分ではなくなった。

:hide-cg

[end]
