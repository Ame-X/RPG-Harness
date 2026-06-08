---
id: road_kagari_2
title: 道中 ・ 篝 ・ 二
characters: [kagari]
---

:cg assets/cgs/road-kagari

@narrator 一度、二人で死地を抜けてからの道は、また少し違って聞こえる。篝は槍を杖のように突いて、ゆっくり歩く。

@kagari この前、お主が前に出た時——あたしは、伯母を思い出した。

@kagari 言ったろ。霊体化に呑まれて鬼になった。祓ったのは、あたしだと。

@narrator 篝は立ち止まり、槍の石突きを土に深く埋めた。

@kagari ずっと、あれは「祓った」って言い続けてきた。家伝の言い方だ。聞こえがいい。

@kagari 本当は——斬った。伯母が、まだ笑える顔のうちに。間に合ううちに。

@narrator 月のない夜だった。篝の声は低く、いつもの高さを失っていた。

@kagari お主には、間に合わせたい。祓うんじゃない。鬼にする前に、引き戻す。

? なんと返す？
  - 「お前の手は借りない。自分で引き返す」 -> +2kagari
  - 「もし間に合わなかったら、お前が斬れ」 -> +kagari
  - 篝の槍に、自分の手を重ねる -> +2kagari

@kagari ……ああ。約束だ。どっちの約束も、覚えておく。

@narrator 篝は槍を土から引き抜いた。歩き出す足取りは、来た時より軽い。背負っていたものを、半分だけ、お主に預けた顔だった。

:hide-cg

```yaml
type: effects
effects:
  affection:
    kagari: 1
  switches:
    road_kagari_2_seen: true
```

[end]
