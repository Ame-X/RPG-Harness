---
id: pulse_intro
title: 脈絡の話
characters: []
requires:
  switch: { name: pulse_intro_seen, eq: false }
---

:cg assets/cgs/pulse-intro

@narrator 最初の鬼を斬って帰った夜、屋敷の縁側で、お主は刀を解いて鞘の蒔絵を撫でていた。

@narrator 刀は震えていない——だが、何かが胸の奥に降りた感覚がある。今日、お主は脈を選んだ。

@narrator 家伝の口伝書を開く。先祖の筆跡で、こうある——

@narrator 「鬼を斬りし時、其の妖力、刀身に三脈に分れて流る。」

@narrator 「浄の脈は鎮魂に帰す。鬼の脈は刀を肥やす。凡の脈は穏当に整える。」

@narrator 「流す脈は、斬りし者の選びに在り。選ばざれば——お主の家は、選んでこなかった。」

@narrator お主は選んだ。これは、家業を「家業」にし直すための、最初の決断だった。

:hide-cg

```yaml
type: effects
effects:
  switches:
    pulse_intro_seen: true
```

[end]
