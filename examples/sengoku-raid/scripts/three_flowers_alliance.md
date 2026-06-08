---
id: three_flowers_alliance
title: 三花の盟
characters: [kagari, kasumi, mio]
---

:cg assets/cgs/three-flowers-alliance

深夜。大名府の中庭。三人の女が並んで立っている。

@kagari 召されたのは私一人ではないらしいな。

@kasumi 私は、月見だと聞いて来た。

@mio 私は——公儀の沙汰ではなく、個人の用で。

@narrator お主は三人の前に立つ。手には何も持っていない。

@narrator 「三度、お主たちと出帰った。生きて戻った。」

@narrator 「鬼を狩る生き方が、いつ終わるか、私には見えない。だが、終わるその日まで——」

? それでも、口にしたかった。
  - 「三人とも、隣にいてくれ」 -> +kagari +kasumi +mio
  - 「お主たちと共に死ぬ覚悟を、私は持っている」 -> +2kagari +2kasumi +2mio

@kagari 私の槍は、お主の刀の後ろを守る。

@kasumi 私の弓は、お主の刀の届かぬ間合いを撃つ。

@mio 私の鏡は、お主の刀が映す影を読む。

@narrator 三人の声が一度に降りる。中庭の月が、いつもより低く見えた。

:hide-cg

```yaml
type: effects
effects:
  switches:
    three_flowers_pledged: true
```

[end]
