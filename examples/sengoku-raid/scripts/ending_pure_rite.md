---
id: ending_pure_rite
title: 鎮魂結界の儀
characters: [kagari, kasumi, mio]
requires:
  all:
    - { switch: { name: chose_court_loyal } }
    - { variable: { name: pulse_pure, min: 5 } }
---

:cg assets/cgs/ending-pure-rite

@narrator 公儀の沙汰に従い、お主は浄の脈を選び切った。

@narrator 大広間。将軍家の側用人が上座に座し、巻物を広げる。

@narrator 「松本家——妖刀が浄の脈のみで満ちた例、当家の記録に先例がない。」

@narrator 「お主の代で、あの刀は初めて、刃ではなく器になった。鎮魂結界の儀を、お主の手で執り行わせる。」

@mio 見立て役として、最後の上申を読み上げる。「松本家当主、霊体化の進行、停止。脈、清澄。向後の査問——不要。」

@narrator 澪は巻物を閉じ、一瞬だけ、役目ではない目でお主を見た。

@kagari 私の槍も、結界に加える。家伝が二つ重なれば、結界は倍では利かないからな。

@narrator 夜。城の四隅に篝火が焚かれ、お主は刀を逆手に持ち、心臓の真上に置いた。教わった通りに。息を、長く、一度。

@narrator 刀身が応える。何百年ぶりかに、斬るためではなく鳴った。

@narrator 鬼の声は、江戸から遠ざかった。少なくとも、お主たちの代の間は。

@narrator 儀を終えて、夜気が白み始める。

```yaml
type: choice
prompt: 最初に、誰のところへ歩く？
options:
  - text: 篝のところへ
    requires: { switch: { name: befriended_kagari } }
    goto: coda_kagari
  - text: 霞のところへ
    requires: { switch: { name: befriended_kasumi } }
    goto: coda_kasumi
  - text: 澪のところへ
    requires: { switch: { name: befriended_mio } }
    goto: coda_mio
  - text: 一人で、白む空を見に行く
    goto: coda_alone
```

# coda_kagari

@narrator 篝は、燃え残りの篝火に手をかざしていた。

@kagari 終わったな。……あたしの家伝も、これでようやく役目を果たした。伯母に、いい土産話ができた。

@kagari なあ。刀が器になったなら——お主の隣は、もう刀の置き場じゃないだろう。

@kagari あたしが座る。文句は受け付けない。

@narrator 篝火が爆ぜて、高い笑い声がそれに混じった。

@narrator （これが、お主が選んだ結末）

[end]

# coda_kasumi

@narrator 霞は庭の隅、矢の刺さった的の前にいた。儀の最中、結界の四隅の最後のひとつを留めたのは、彼女の矢だ。

@kasumi 見てた？　あたしの矢、ちゃんと届いたでしょ。

@kasumi 鬼がいなくなったらさ、猟師は山に帰るものなんだけど。

@kasumi ——帰らない理由が、もうあるんだよね。隣、空いてる？

@narrator 朝の光の中で、霞は笑った。いつもの笑顔で、いつもより正直な目で。

@narrator （これが、お主が選んだ結末）

[end]

# coda_mio

@narrator 澪は水場の縁に立っていた。袂から、畳んだ上申書を出す。

@mio これで、私の役目は終わった。京へ戻れ、と沙汰が下るだろう。

@mio だが——水鏡は嘘をつかない。私の鏡には、もうずっと、戻る道が映っていない。

@mio 役目ではなく、私の勝手で、ここに残る。……隣に、置いてくれるか。

@narrator 水面に二つの影が並ぶ。どちらの影も、もう揺れていなかった。

@narrator （これが、お主が選んだ結末）

[end]

# coda_alone

@narrator 白む空の下、お主は一人で刀を抜き、刀身を朝日に透かした。

@narrator 黒い澱みは、どこにもない。映っているのは、お主の顔だけだ。

@narrator 家伝は今日、何百年ぶりに本来の意味を取り戻した。それを成したのが誰か、刀は覚えている。

@narrator （これが、お主が選んだ結末）

[end]
