---
id: encounter_kagari_first
title: 三叉路の出会い
characters: [kagari]
---

:cg assets/cgs/encounter-kagari-first

霧の向こうから、もう一つの足音が近づいてくる。

@narrator 黒い具足。槍の柄。年若い女が、お主と同じく刀ではなく長物を構えていた。

@narrator 女はお主の妖刀をひと目見て、口の端を上げた。

@kagari あんた、松本家の。

@kagari 噂は聞いてた。家伝の刀を抱えて山野を渡り歩く奴がいる、って。

@kagari 同業ってわけだ。よろしく頼むよ。

@kagari あたしは篝。生まれた家は教えない決まりだ。あんたも詮索はしないでくれ。

:hide-cg

? どう応える？
- 同業ということは、お主も…… -> +2kagari | goto same_curse
- 軽く頷くだけ -> +kagari | goto silent_nod
- 面倒事に巻き込まれそうだな -> goto wary

# same_curse

@narrator 篝の眉が、ほんの少し動いた。

@kagari お互い、訊くだけ野暮ってもんだろう。

@kagari だけど——そう、その通りだ。

@narrator 同類だと、口にしないまま確認しあった。

[end]

# silent_nod

@kagari ふん。寡黙な奴は嫌いじゃない。

[end]

# wary

@kagari ははっ、賢明だな。

@kagari だが心配するな。あたしは別の方角から登ってる。すぐ別れる。

[end]
