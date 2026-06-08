---
id: letter_02_rival
title: 「査問の使者」
characters: [mio]
requires:
  all:
    - { variable: { name: shogun_chapter, min: 1 } }
    - { variable: { name: raidsCompleted, min: 7 } }
    - { characterStat: { character: player, name: spectral, max: 49 } }
---

:cg assets/cgs/letter-02-rival

@narrator 七度目の出帰り。蔵を出ると、大名府の中庭に若い妖刀使いが一人、片膝をついている。

@narrator 深い藍の打掛。腰には家伝の脇差。

@narrator 顔を上げる。お主と同じくらいの歳——だが目の冷たさは、別の層から来ている。

@mio 京から参った。澪と申す。

@mio 公儀の沙汰を奉じ、諸国の妖刀使いの見立てに回っている。

@mio お主の番に当たった。怒らずに聞いてほしい——「鬼に堕ちていないか」を、確かめに来た。

@narrator 澪はゆっくり立ち上がり、お主の右に並んで立つ。距離は刀一本分。

@mio 私の見立てが「未だ堕ちず」と判ぜられれば、公儀の懸念は晴れる。

@mio 「既に堕ちている」と見れば——その場で斬る、ということになる。

@narrator 言葉に重さはあるが、声に怒りはない。仕事として言っている。

@mio 結論を出すまで、お主の出帰りに同行する。隅田河の方面に出ると聞いた。

@mio 私の家伝の業は「水鏡」——水面に映る妖気を読む。隠れている鬼の位置を、おそらく見立てられる。

@mio 互いに身を守れ。それでよいか。

? それでよい。
  - 「同行を頼む」 -> +1mio
  - 「断る術はあるか」
  - （無言で頷く）

:hide-cg

```yaml
type: effects
effects:
  variables:
    last_directive: "澪と共に出帰り、見立てを受けよ。"
  switches:
    mio_met: true
```

[end]
