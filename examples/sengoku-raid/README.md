# 妖刀奇譚 / Sengoku Raid

一个用 [RPG-Harness](https://github.com/luokerenx4/rpg-harness) 引擎做的**搜打撤 + GalGame**。日本战国时代，主角は家伝の妖刀使い、灵体化に追われながら鬼を斬る。

**RPG-Harness の旗艦サンプル**：本ゲームは引擎の主要 surface を**8割以上**実際に消費する — `Module` の 15 hook のうち 13 個、Condition AST 14 種のうち 12 種、`once: true` trigger、composite `all/any/not`、`selfSwitch`、`weapon.custom`、string variable、3 composite hook（reducer / first-wins / observer）。AI 作家がこのゲームを読めば、対応する引擎特性の「自然な使い方」が手に入る。

**Headless RPGMaker 形態**：游戏 loop 在 `preset/run.ts`（ejected）；地图 / 角色 / 道具 / 武器 / 技能 / 敌人 是 typed databases（6 種すべて使用）；戦闘 + raid 状態機 + module hook 都在 `modules/raid.ts`。**引擎 0 修改**。

「在 hub」「在 raid」是从 `state.baseline.currentMapId` 推出来的——`edo_castle`（大名府）是 hub map；带 `chain:` 標籤的 map 是 raid 中。沒有独立的 mode flag，所有"我在哪儿"都走引擎的一等 currentMapId。

## 玩

```bash
rpgh play .                                  # 自分で遊ぶ
rpgh autoplay . --persona extractor -v       # AI が「逃げ撤退」路線で遊ぶ
rpgh autoplay . --persona delver    -v       # AI が「直推 boss」路線で遊ぶ
rpgh test .                                  # fixture 回帰（31 個）
```

## 世界観 + 三つの軸

慶長十年。江戸城本丸。将軍家側用人がお主を呼ぶ — 諸国に鬼が湧いている、家伝の妖刀使である你，要遊国討伐並把妖物の遺骸帯回。

但家书提醒：斬れば斬るほど、自分の中にも鬼が積もる。そして、刀には**三つの脈**がある——お主はどの脈に流すかを、毎回選ぶ。

**這是個取捨的循環。**

## 五つの体験軸（特性駆動）

| 軸 | 内容 | 引擎特性 |
|---|---|---|
| **A — 密書主線** | 将軍からの三通の密書が raidsCompleted を区切り、お主の選択を結審する | `once: true` triggers + composite `all` + variable: string |
| **B — 同行者** | 篝 / 霞 / 澪 を raid に誘う。各々 passive を提供、半分のダメージを引き受ける。初めて静かな zone に共に着くと一度だけ「同行道中」のシーンが流れる | onActionDispatch first-wins + onBeatBefore reducer + onChoicePresented reducer + moveHandler script-launch |
| **C — 鬼の交渉** | 鬼 HP < 30% で「聞く / 逃がす / 妖刀の声に従う」の三択 | selfSwitch + enemy.stats + enemy.custom + composite condition |
| **D — 妖刀の業** | 勝利毎に「浄 / 鬼 / 凡」の脈絡を選ぶ。三本道で異なる結末 | weapon.custom + weaponPower condition + 3 endings via composite requires |
| **E — 情報屋** | hub の「両国橋」で 4 段階の情報を買う。intellect が解錠条件 | variable: string + onScriptSelect first-wins |

## 数値

| 資源 | 範囲 | 初期 | 作用 |
|---|---|---|---|
| `hp` | 0–30 | 30 | 戦闘血量。0 で raid 失敗、hub `rest` で全回 |
| `mental` | 0–10 | 10 | 戦闘で削れる。intel_briefing_yaodao で +2 |
| `spectral` | 0–100 | 5 | 攻撃で +1 creep、勝斬で吸入 -absorb。crit 率 = `spec × 0.7%`、fumble 率 = `spec × 0.5%`。≥100 → BAD END |
| `intellect` | 0–99 | 0 | 偷襲 DC + 情報屋の解錠条件 |
| `ryo` | 0–∞ | 100 | 通貨 |

**妖刀**：basePower 4。三本道の鍛え方：
- 凡: `upgrade_mundane`（魂石碎片 3 + 100 両）→ 威力 +2、脈絡: 凡 +1
- 浄: `upgrade_pure`（鬼の角 1 + 80 両）→ 威力 +1、脈絡: 浄 +1
- 鬼: `upgrade_oni`（鬼の角 1 + 欠片 1 + 120 両）→ 威力 +4、霊体化 +5、脈絡: 鬼 +1

**imbue 選択** — 戦闘勝利後、必ず三択を経て妖力を流す脈を決める：
- 浄: 威力 +1、霊体化 -1（rebate）
- 鬼: 威力 +max(3, absorb/2)、霊体化 +3
- 凡: 威力 +2

## 地図

20 張の flat map：1 張の hub（`edo_castle`）+ 19 張の raid map（4 つの chain にグループ化）。

| Chain | 表示名 | 難度 | 入口 map | 撤退可 map | 主敵 | 解錠 |
|---|---|---|---|---|---|---|
| `kuro_swamp`   | 黒沼地 | 1 | `kuro_swamp_edge` | `kuro_swamp_shrine` / `kuro_swamp_deep_grove` | 下級の鬼 | 開幕から |
| `sumida_river` | 隅田河 | 2 | `sumida_river_bridge_foot` | `sumida_river_ferry_landing` / `sumida_river_under_eaves` | 下級の鬼 + 戦鬼 | 開幕から |
| `mt_houkyou`   | 砲響山 | 3 | `mt_houkyou_foothills` | `mt_houkyou_burnt_temple` / `mt_houkyou_caldera` | 戦鬼 + 鬼神 (boss) | 開幕から |
| `hell_gate`    | 地獄門 | 5 | `hell_gate_mouth` | `hell_gate_mirror_pool` | 鬼神 + 鏡鬼（映し井戸） | pulse_oni≥8 AND power≥12 AND chinkonho AND mizukagami |

各 map は `maps/<chain>_<zone>.yaml`：自分の `bg` / `connections` / `encounter_table` / `loot_table` / `is_extract` / 場合により `character_spawns` を持つ。引擎の `enterMap` primitive がトランジションを駆動（`currentMapId` + `visuals.bg` 同期）。

「`hell_gate` chain を depart 可能か」は `raid.ts` の `chainUnlocked()` の composite gate で評価。引擎の "composite condition gating" の使い所はここを読めば分かる。

連接（connections）は同じ chain 内の map 間にだけ張る。chain を跨ぐ移動は raid module の `depart:<chain>` action（`startRaid` → `enterMap(chain entry map)`）と extract action（`endRaidExtract` → `enterMap("edo_castle")`）でのみ起こる。

## 角色 + 技能

| 角色 | 邂逅 | 邦絆技能 | 同行 passive |
|---|---|---|---|
| 篝 | `kuro_swamp_crossroads` / `kuro_swamp_ruined_hut`（`character_spawns` chance=1.0）| 鎮魂法（hub-only、spectral -20）| map 移動毎 spectral -1 |
| 霞 | `mt_houkyou_stone_paths` / `mt_houkyou_lava_vent` | 早駆け（flee 無傷成功）| 同行中は flee 常時成功 |
| 澪 | 第二の密書で登場（朝廷監察役）| 水鏡（mizukagami、scry）| 移動毎、接続する未踏 zone の鬼を先読み（水鏡 scry） |

邦絆ループ：邂逅 → 親密度 ≥2 で `bond_<id>_01` → ≥4 で `bond_<id>_02`（grant skill）→ raid に誘う（switch `companion_<id>`）→ 生還で `befriended_<id>` 立つ → ≥6 + befriended で `bond_<id>_03`（companion 同道）→ 三人とも befriended で `three_flowers_alliance` trigger。

**同行道中シーン**：同行者を連れて raid 中、初めて遭遇の無い静かな新 zone に着くと、その同行者の道中会話が一度だけ自動で流れる。二档ある——`road_<id>`（一幕目）と、befriended（生還を共にした）後に解錠される `road_<id>_2`（二幕目、より踏み込んだ告白）。`moveHandler` が character_spawns と同じ要領で `currentScriptId` をセットして launch、シーン自身の effects ブロックが `road_<id>(_2)_seen` を立てて再発火を止め、親密度を加える。各シーンには `:cg assets/cgs/road-<id>` が付く。同行を「数値バフ」から「道連れの関係」へ寄せるレイヤー。

三人とも `bond_<id>_01 / 02 / 03` の三段が揃っている。澪の `bond_mio_02` が伝授する**水鏡（mizukagami）は hell_gate chain 解錠の四条件の一つ**——澪の邦絆を進めない限り、地獄門は開かない。三技（鎮魂法 / 早駆け / 水鏡）はそれぞれ別のヒロイン経由でしか手に入らない。

## Loop

```
edo_castle (hub map)                      <chain>_<entry> ... (raid maps)
───                                       ────
depart:<chain>           ───→            chain の entry map に enterMap
↑                                         │
│   sell_all_loot                         │ move:<chain>_<map>  (engine moveToMap + module observer)
│   upgrade_pure/oni/mundane              │     ├── encounter rolled → combat
│   infoshop_basic/loot/yaodao/hidden     │     │     ├── HP<30% → 聞く/逃がす/妖刀の声
│   script:intel_briefing                 │     │     └── HP=0  → 脈絡選択（imbue）
│   bond / script:bond_*                  │     ├── empty → search / move
│   invite:<companion>                    │     └── is_extract → extract
│   rest                                  │
│   use_chinkonho                         │
│   script:ending_*  (game over)          │
│                                          │
│   ←── extract success → enterMap(edo_castle)
│   ←── failure ←── HP=0 / spectral=100 / companion HP=0 → enterMap(edo_castle)
```

`buildHubMenu` は `currentMapId === "edo_castle"` の時、`buildRaidMenu` は `m.raid !== null` の時に走る — どちらも `raid.ts` の `onHubBuild` がディスパッチ。pre-flat-map era の `mode: "hub" | "raid"` flag は削除済み。"在哪儿"の単一真実は `state.baseline.currentMapId`。

## Hook usage matrix（旗艦覆盖）

| Engine surface | 用処 | コード位置 |
|---|---|---|
| `onSessionStart` | ryo bootstrap + intro auto-launch | raid.ts onSessionStart |
| `onScriptSelect` | intel_briefing → intel_briefing_<level> redirect | raid.ts onScriptSelect |
| `onScriptStart` | letter_ scripts に page-break narration を unshift | raid.ts onScriptStart |
| `onBeatBefore` (reducer) | spectral≥50 で bond dialogue を replace | raid.ts onBeatBefore |
| `onChoicePresented` (reducer) | bond_*_03 で他者同行中なら大胆肢を lock | raid.ts onChoicePresented |
| `onLabelEnter` | letter_03 の end_* label を achievementLog に書く | raid.ts onLabelEnter |
| `onScriptComplete` | letter_02_rival → metCharacters に mio 追加；intel_briefing_* → intel_active クリア | raid.ts onScriptComplete |
| `onActionDispatch` (first-wins) | companion HP≤3 で attack を cancel | raid.ts onActionDispatch |
| `onStateMutated` (observer) | spectral / pulse 閾値跨ぎを achievementLog に記録 | raid.ts onStateMutated |
| `onHubBuild` (first-wins) | mode-dependent menu、ending 完了で undefined→gameEnd | raid.ts onHubBuild |
| Trigger `once: true` | 4 milestones（letter_01/02/03、three_flowers、pulse_intro）| triggers 配列 |
| Trigger composite `when` | letter_02（var+characterStat）、three_flowers（switch×3）、pulse_intro（all+any） | triggers 配列 |
| `selfSwitch` | 鬼解放 → zone_haunt_<enemy> A flip → lore script unlock | negotiateReleaseHandler |
| `weapon.custom` (nested) | pulse_paths schema document | weapons/ancestor_yaodao.md |
| `weaponPower` condition | hell_gate chain unlock composite | raid.ts chainUnlocked |
| `inventory` condition | infoshop_hidden requires frag | infoshopHandler |
| `knowsSkill` condition | hell_gate mapUnlocked | raid.ts chainUnlocked |
| Fenced choice with effects | letter_03_choice で chose_court_* 三択 | letter_03_choice.md |
| Composite script `requires:` | ending_* scripts、bond_*_03 scripts | 各 .md frontmatter |
| `string` variable | intel_active、last_directive | game.yaml variables |

唯二 **未挂** の hook：`onNarrationDrain`（性価比低）、`onEndConditionFire`（training preset 専用、我々は使わない）。

## Fixtures（38 個）

```
01–13  legacy + 邦絆 + 同行剧情（開幕状態 / 邂逅 / 邦絆×3 / 戦闘 / 撤退 / 死亡 / dispatcher guard）
       ├ 09  bond_mio_02 → mizukagami 伝授（澪線補完。05/06 の三人目ミラー）
       ├ 10  road_kagari → 静かな zone で同行道中シーン launch + 選択肢 affection
       ├ 11  澪 水鏡 scry → 接続未踏 zone の encounter を先 roll + 永続化
       ├ 12  road_<id>_2 → befriended 後に二幕目が解錠して launch
       └ 13  bond_*_03 の選択肢 inline 加成（`-> +2` 矢印修正）の回帰
A1–A4  提案A — 密書 milestone triggers、fenced choice branching
       └ A3 に mio affection 断言追加（letter_02 の `-> +1mio` 矢印修正）
B1–B6  提案B — 同行者 invite、passive、damage absorb、3 reducer hooks、composite trigger
       └ B5b  three_flowers の選択肢多人 inline 加成（`-> +2×3` 矢印修正）
C1–C4  提案C — 鬼の交渉、selfSwitch、yaodao_voice gate、zone_haunt 解錠
D1–D4  提案D — pulse imbue、hell_gate gate、upgrade_oni cost、水鏡欠如で hell_gate ロック（D2 負例）
DE1    提案D+E 結 — ending_pure_rite で gameEnd
E1–E3  提案E — infoshop tiers、onScriptSelect redirect、intellect gate
F1–F2  收尾 — onStateMutated achievement log、onLabelEnter
```

## Personas

| Persona | 策略 | 用処 |
|---|---|---|
| `extractor` | `is_extract` map に着いたら撤退。遇敵 flee | "戦わなくても遊べる" 検証 |
| `delver` | 必ず戦う。chain 内 map を全部踏破してから撤退 | boss 到達 + pulse 累積 検証 |

## 開発で見つけた engine / parser bug（this branch で fix）

- **parser/condition.ts `selfSwitch`**：engine の `evaluateCondition` と validator は selfSwitch を理解していたが、parser がフロントマターから読めなかった（条件 AST の漏れ）。15 行追加で修正。
- **`onChoicePresented` の意味的制限**：reducer は option を **ADD** できる（visual に追加可）が、`runScript` は ピックを `beat.options[index]` で再解決するため、追加 option は dispatch 不能。よって reducer は **filter / lock** にのみ使うべき。コメントで note 追加（modules/raid.ts onChoicePresented）。

## 内容 bug（this branch で fix）— 澪線の補完

- **水鏡（mizukagami）が入手不能 → hell_gate が到達不能だった**：`chainUnlocked()` は地獄門の解錠に `mizukagami` を要求し、skill 定義 / hell_gate map / D2 fixture もすべて存在していた。だが**この技を伝授する script が無かった**——澪は `bond_mio_03` だけを持ち、`bond_mio_01 / 02` が欠落していた（篝・霞は三段揃い）。結果、ゲーム内で水鏡を学ぶ術が無く、終盤 chain 全体が dead content 化していた。
  - 補完：`scripts/bond_mio_01.md`（査問する者 / 親密度≥2）+ `scripts/bond_mio_02.md`（水鏡を授ける / ≥4、`learn: [mizukagami]` + `learnedMizukagami` switch）。邦絆ループは完全データ駆動なので module 改変は不要——`buildHubMenu` が `bond_mio_*` を自動で surface する。
  - 回帰：`09_bond_mio_grants_mizukagami`（05/06 の三人目ミラー、入手経路を証明）+ `D4_hell_gate_locked_without_mizukagami`（D2 の負例、水鏡が binding constraint であることを証明）。
- **新敵「鏡鬼」(`enemies/kagami_oni.md`)**：到達可能になった地獄門・映し井戸の主。覗き込む者の妖気を写し取り、その太刀筋で襲う（高 cunning）。放すと `zone_haunt_kagami_oni`（澪の水鏡と主題が呼応）を解錠。敵は完全データ駆動なので `.md` 追加 + encounter_table への参照のみ、コード 0 行。

## 同行体験の拡張 — 「道連れ」を剧情にする

同行システムは passive + ダメージ肩代わり止まりで、「共に歩く」物語が薄かった。二層を追加：

- **同行道中シーン・二档 (`scripts/road_<id>.md` + `road_<id>_2.md`)**：同行者を連れて静かな新 zone に着くと、その同行者の道中会話が流れる。一幕目（`road_<id>`）はそのまま、二幕目（`road_<id>_2`）は befriended（生還を共にした）後に解錠——`maybeLaunchRoadScene` が未観の最上位档を選んで launch。`moveHandler` が character_spawns と同じ要領で `currentScriptId` を立てる（遭遇の無い zone 限定なので戦闘と競合しない）。各シーンの effects ブロックが `road_<id>(_2)_seen` を立てて再発火を止め、選択肢で親密度が動く。switch 六つを `game.yaml` に追加。
- **澪の同行 passive「水鏡 scry」(`mioScry`)**：澪同行中は新 zone に着くたび、接続する未踏 zone の鬼を先読みナレーション。`MapInstance.encounterRolled` guard を新設し、scry が roll した encounter を実際の到達時に再 roll しないことで「水鏡に映る」予言を**真**にする。これで三同行者の passive 欄が全て埋まる（篝=spectral減、霞=flee成功、澪=scry）。
- **選択肢 inline 加成の修正（全箇所）**：`parseChoiceBlock` は `->` の後ろしか effects を読まない。矢印無しで書かれ **affection が全く加算されていなかった** 選択肢を全て `- 「…」 -> +N<id>` 形へ修正：`bond_{kagari,kasumi,mio}_03`（route 頂点の三択）、`letter_02_rival`（`-> +1mio`）、`three_flowers_alliance`（`-> +2kagari +2kasumi +2mio`、`parseInlineEffects` が一 tail 内の複数 token を全適用）。`road_*` も同形式。これで矢印無しの未加算選択肢は残っていない。
- **CG 配線（情感の峰のみ）**：CG は「章/節目の beat」に絞る設計方針に沿い、(a) 描き上がっているのに未配線だった既存 CG 9 枚を `:cg` で接続（`encounter_kagari/kasumi_first`、`letter_02/03`、`pulse_intro`、`three_flowers_alliance`、`ending_*` ×3）、(b) 視覚的空白だった**各 route の頂点 `bond_<id>_03`** に新 CG spec を追加（`assets/cgs/bond-{kagari,kasumi,mio}-03/`）、(c) 同行道中シーンに `assets/cgs/road-{kagari,kasumi,mio}/`。gameplay に戻る script は `:hide-cg` も付与（視覚 beat は runScript 上で自動進行＝`next` を消費しないので既存 fixture の drain 数に影響なし）。新規 spec の画像は未生成——`placeholder` で TUI フォールバックし、後から画像 + tui.ans/txt を差し込めばそのまま表示される。日常 beat（bond_01/02、戦闘、zone_haunt）には CG を付けず、峰の印象を保つ。
- 回帰：`10`（一幕 launch）/ `11`（水鏡 scry）/ `12`（二幕 befriended gate）/ `13`（bond_*_03 矢印修正）。
