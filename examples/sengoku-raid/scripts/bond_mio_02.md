---
id: bond_mio_02
title: 水鏡を授ける
characters: [mio]
requires:
  affection: { character: mio, min: 4 }
---

夜明け前。隅田河の浅瀬。風がなく、水面は鏡のように凪いでいる。

@mio 来い。立ったまま、水を覗け。

@narrator お主は水際に立った。澪が背後から、お主の刀の棟に指を添える。

@mio 私の家の業——水鏡——は、術ではない。読み方だ。

@mio 水面、鏡面、刀身。映るものはみな、妖気の流れを表に出す。鬼が近ければ、映りが歪む。

@narrator 澪が指で水面をなぞると、暗がりの奥——まだ見えぬ淵に、黒い澱みが一筋、滲んで見えた。

@mio あそこに、一匹いる。お主の目には、まだ届かぬ位置だ。

@mio これを覚えれば、進む前に淵の鬼を見通せる。私が隣にいる間は、ただで効く。一人のときは、精神を二つ払え。

@narrator 澪はお主の手をとり、刀身を水平にして水面に重ねた。二つの影が、一つの鏡に並ぶ。

@mio もう一つ。これは公儀の業ではない。私が、お主に渡す。

@mio 査問の役目が解けても——お主が自分の歪みを、自分で読めるように。

@narrator 刀身に映った自分の顔を、お主は初めて正面から見た。半分が黒く滲み、半分は、まだ人のままだった。

```yaml
type: effects
effects:
  skills:
    learn: [mizukagami]
  affection:
    mio: 1
  switches:
    learnedMizukagami: true
```

[end]
