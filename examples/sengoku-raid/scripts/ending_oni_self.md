---
id: ending_oni_self
title: 地獄門の底
characters: []
requires:
  all:
    - { switch: { name: chose_court_defy } }
    - { variable: { name: pulse_oni, min: 8 } }
---

:cg assets/cgs/ending-oni-self

@narrator お主は公儀に刀を抜いた。そして、鬼の脈に染まり切った。

@narrator 砲響山——火口の北壁。岩のひびが、お主の目には、はっきりと口を開けている。

@narrator 地獄門。鬼の脈が深い者にしか視えぬ、と情報屋は言った。今のお主には、昼の街道より明るい。

@narrator 入る前に、一度だけ、麓の方角を振り返った。

```yaml
type: choice
prompt: 灯がいくつか、遠くに見える。
options:
  - text: 篝の槍の拍を、最後に一度だけ数えてみる
    requires: { switch: { name: befriended_kagari } }
    goto: tether_kagari
  - text: 霞の言った「鹿の道」を、目で探してみる
    requires: { switch: { name: befriended_kasumi } }
    goto: tether_kasumi
  - text: 澪の水鏡に、今の自分が映る様を思う
    requires: { switch: { name: befriended_mio } }
    goto: tether_mio
  - text: 振り返るのを、やめる
    goto: gate
```

# tether_kagari

@narrator ……数えられなかった。拍の数え方を、もう覚えていない。

@narrator 「引き返せるうちに引き返せ」。誰かの声がそう言った気がしたが、それが誰の声だったか、思い出せない。

@narrator 思い出せないことが悲しい、ということだけは、まだ分かった。それが最後だった。

? 門が、開いて待っている。
- 入る -> goto gate

# tether_kasumi

@narrator 鹿の道は、見えなかった。代わりに、鬼の通り道がすべて見えた。昼の街道のように、明るく。

@narrator 「追わない方が、長く生きる」。そう教えてくれた声の主の顔が、靄の向こうにある。

@narrator 靄が晴れる前に、お主は目を逸らした。それが最後だった。

? 門が、開いて待っている。
- 入る -> goto gate

# tether_mio

@narrator 水のない火口で、それでもお主は刀身を覗いた。

@narrator 映っていたのは、全き黒。揺れひとつない。澪の言った通りだ——鏡は、嘘をつかない。

@narrator 「未だ堕ちず」。あの見立てを、お主は今夜、自分の手で覆した。それが最後だった。

? 門が、開いて待っている。
- 入る -> goto gate

# gate

@narrator 入る。

@narrator 中の鬼神は、お主と同じ顔をしていた。

@narrator 何百年前の、お主の家の先祖——名を変え、銘を改めて、忘れ去られた者。

@narrator 「お主が来た。」

@narrator 「待っていた。私を解放できるのは、私と同じ道を来た者だけだ。」

@narrator お主は刀を構えた。妖刀は震えていなかった——もう、震える側と握る側の区別が、なかった。

@narrator 後の世の口伝書に、こうある。「慶長十一年、砲響山に新しき鬼神立つ。声は、人のままなりき。」

@narrator （これが、お主が選んだ結末）

[end]
