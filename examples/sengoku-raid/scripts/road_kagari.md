---
id: road_kagari
title: 道中 ・ 篝
characters: [kagari]
---

:cg assets/cgs/road-kagari

@narrator 二人で歩く道は、一人より静かだった。篝は槍を肩に担ぎ、半歩だけ前を行く。

@kagari 足音を合わせろ。別々に鳴ると、鬼が二人ぶん数える。

@narrator お主は歩幅を直した。やがて、二つの足音が一つに聞こえ始める。

@kagari ……そう。それでいい。

@narrator しばらく無言が続いた。篝の槍の石突きが、土を一定の拍で打つ。

@kagari 一人で渡り歩いてた頃は、この拍を自分で数えてた。眠らないために。

@kagari 今は、数えなくていい。お主が隣で勝手に鳴らしてる。

? なんと返す？
  - 「俺がいなくなったら、また数えるのか」 -> +kagari
  - 「なら、ずっと鳴らしていよう」 -> +2kagari
  - 黙って、槍の拍に足を合わせる -> +kagari

@kagari ……減らず口は、生きてる証だ。よし。

@narrator 篝は前を向いたまま、口の端だけ上げた。槍を担ぎ直す手が、ほんの少し緩んでいた。

:hide-cg

```yaml
type: effects
effects:
  affection:
    kagari: 1
  switches:
    road_kagari_seen: true
```

[end]
