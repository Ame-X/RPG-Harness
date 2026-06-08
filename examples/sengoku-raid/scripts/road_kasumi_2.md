---
id: road_kasumi_2
title: 道中 ・ 霞 ・ 二
characters: [kasumi]
---

:cg assets/cgs/road-kasumi

@narrator 共に生きて帰った後、霞は跡を読む手を止めて、お主の歩き方を読むようになった。

@kasumi あんた、撤退の足音が変わった。前は「逃げる」音だった。今は「連れて帰る」音。

@narrator 霞は弓を下ろし、道端の石に腰掛けた。お主も隣に座る。

@kasumi 父が山で消えた時さ、あたしは結局、骸も見つけられなかった。だから狩り続けた。鬼を撃てば、父が少し返る気がして。

@kasumi でも、この前あんたを連れて帰って——分かった。返ってくるのは、死んだ人じゃない。

@kasumi 「次は誰も失くさない」って気持ちのほうだ。それが、あたしの父だったんだと思う。

? どう返す？
  - 「なら、お前を失くすわけにはいかないな」 -> +2kasumi
  - 「俺も、お前を連れて帰る音を覚えた」 -> +2kasumi
  - 黙って、霞の弓を膝に乗せてやる -> +kasumi

@kasumi ……ふふ。猟師を口説くなら、もっと下手にやんな。慣れてないのがバレる。

@narrator 霞は立ち上がり、弓を背負い直した。鼻歌は無かった。代わりに、お主の歩幅に、自分のを合わせてきた。今度は霞の方から。

:hide-cg

```yaml
type: effects
effects:
  affection:
    kasumi: 1
  switches:
    road_kasumi_2_seen: true
```

[end]
