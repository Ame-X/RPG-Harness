# RPG-Harness

A headless RPG Maker — an AI-first coding harness for GalGame-shaped games.

The engine owns the universal pieces (characters, items, enemies, weapons, skills, scripts, actions, a Condition DSL, 15 lifecycle hooks, reactive triggers, one write path). Everything game-specific — the combat math, the hub layout, the raid loop, the ending semantics — is yours to write as `modules/*.ts` and, if you want, an ejected `preset/run.ts`. Pure visual novels can stay in markdown; anything more interesting drops into TypeScript without touching the engine.

A game is a folder. You play it in your terminal — from a main menu, with save slots and an in-game pause menu. An AI can read the same folder and play through it from the shell, by reading stdout and writing stdin, with no SDK required. The same AI can also extend the game: write new scripts, design new mechanics, ship new modules.

```bash
bun install
bun run play              # boot 妖刀奇譚 — the bundled flagship game
bun run autoplay          # watch a built-in AI persona play through
```

## Make your own

```bash
bun packages/cli/src/bin.ts init ./my-game    # scaffold a minimal game
bun packages/cli/src/bin.ts play ./my-game    # play it
```

Or in another terminal, **edit `scripts/001_intro.md` while the game is running** — the engine watches for `.md` / `.yaml` changes and reloads the next time a beat resolves. Live authoring with no restart.

## Install (experimental — only when you need it)

The canonical way to run anything in this repo is `bun packages/cli/src/bin.ts <command>` or `bun run rpgh <command>` from the repo root. That covers nearly every dev workflow.

The one case it doesn't cover is **running `rpgh studio` against a game directory that lives outside this repo** — `studio` is a browser workbench (PR-stage; see `packages/studio/`) and you'll want a global `rpgh` command for that. There's no distribution / upgrade story yet, so treat this as a self-serve symlink:

```bash
# 1. confirm ~/.local/bin is on your PATH (or pick another PATH dir):
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin" && echo OK

# 2. symlink the CLI entrypoint:
ln -sf "$(pwd)/packages/cli/src/bin.ts" ~/.local/bin/rpgh

# 3. verify:
rpgh --help
```

Caveats:
- Requires `bun` on PATH — the symlink target is a `.ts` file with `#!/usr/bin/env bun` as the shebang.
- The symlink is pinned to this clone's absolute path. Move the repo and `rpgh` breaks.
- No upgrade mechanism. Pull the repo to update.
- `bun link --global` doesn't work cleanly for monorepo workspace packages (1.3.14) — it leaves a broken symlink. Use the manual `ln -sf` above instead.

When/if RPG-Harness stabilizes and we ship a real distribution (npm publish or a single-binary release), the install story becomes one line and this section gets folded into the main quick-start.

To uninstall: `rm ~/.local/bin/rpgh`.

## Let an AI play (or write)

Two skills ship with the repo:

- **[`rpg-harness-player`](.claude/skills/rpg-harness-player/SKILL.md)** — read this and an AI knows how to play RPG-Harness games by running `rpgh peek` / `rpgh step` in a shell loop. No SDK, no API key.
- **[`rpg-harness-author`](.claude/skills/rpg-harness-author/SKILL.md)** — read this and an AI knows how to extend an RPG-Harness game: new scripts, new characters, new branches, new tests. The full DSL is documented inline.

Drop into Claude Code inside any RPG-Harness game folder containing `.claude/skills/`:

```
> Read .claude/skills/rpg-harness-player/SKILL.md and play through this game
> as a thoughtful character who's curious but doesn't oversell themselves.
```

or

```
> Read .claude/skills/rpg-harness-author/SKILL.md, then add a third character
> named "凉" who shows up in script 003 as a wild card.
```

The AI discovers the format on its own. To enable this in a game folder created via `rpgh init`, copy `.claude/` from the RPG-Harness repo into your game folder.

## What's in the box

```
rpg-harness/
├── packages/
│   ├── engine/         Pure state-machine runtime. No DOM, no Node-specific APIs.
│   ├── parser/         Markdown + frontmatter + YAML fence → engine AST.
│   ├── frontend-core/  Renderer-agnostic Output→ScreenModel reducer, shared by every shell.
│   ├── cli/            The `rpgh` binary: init / play / step / peek / autoplay / test / sessions / assets / studio.
│   ├── web/            Browser (React DOM) shell — engine bundled in-tab, games baked at build time, saves in localStorage. Static; deployable to any host.
│   └── studio/         Browser-based asset workbench (chafa render loop, spec editor).
├── examples/
│   ├── sengoku-raid/    "妖刀奇譚" — bundled flagship. Extraction-shooter raid loop +
│   │                    GalGame bonds + 3 endings + most of the engine surface
│   │                    (13/15 module hooks, full Condition AST, selfSwitch,
│   │                    composite triggers, weapon.custom)
│   ├── hook-test/       (hidden) engine fixture — full Module.onX coverage
│   ├── eject-test/      (hidden) engine fixture — training preset eject reference
│   └── _invalid_typo/   (hidden) negative fixture — validator must reject
└── .claude/skills/
    ├── rpg-harness-player/SKILL.md   for AIs that play
    └── rpg-harness-author/SKILL.md   for AIs that write content
```

The three `(hidden)` directories declare `hidden: true` in their `game.yaml`;
`bun run play` skips them automatically. They're still loadable by explicit
path, and `bun run test:fixtures` runs them as engine regression coverage.

## Three game modes

The same harness underneath, three preset loop shapes on top. Pick whichever fits the game; drop into a module (or eject the preset) when you want a fourth.

**Pure VN**: scripts only. Between scripts, the engine yields a
`scriptComplete` picker. Affection + flags + branching. Classic visual novel.
No module required.

**Training mode**: add a `training:` block to `game.yaml` and the hub becomes a
calendar-driven activity menu. Day/time slots, stats with caps, an `actions/`
folder of daily activities, optional combat mini-loop, end conditions that
trigger ending scripts. Story scripts coexist with daily actions as activities
in the hub. The `examples/eject-test/` fixture is the minimal reference for
this mode.

**Extraction-shooter** (like `sengoku-raid`): no `training:` block — instead, a
declared `maps/` directory carries the hub-city map (`edo_castle`) plus the
network of raid maps grouped by `chain:` tags. The player's location lives in
`state.baseline.currentMapId`; the engine's `enterMap` primitive + bundled
`moveToMap` handler drive transitions. A game module provides custom hub
rendering for in-raid stats (companion HP, pulse counters) via `onHubBuild`,
and observes `onActionComplete` for `moveToMap` dispatches to layer raid-side
effects (turn count, encounter rolls). Raids are repeatable expeditions
through chains of flat maps — set-piece scenes still use scripts (intros,
character first-meets, bonding beats); the random raid content lives in
module action handlers with `ctx.rng()`.

See `examples/sengoku-raid/README.md` for the flagship's full design.

## How a play session is structured

`rpgh play <game-dir>` boots into a **Hub** where you pick what to do:

```
樱花季 / Cherry Blossom Season
RPG-Harness · headless RPG Maker

▸ 新游戏
  继续: play-20260521-143012    进行中 · 003_invitation · 2 完成
  继续: claude-thoughtful       ✓ 005c_bea_good
  退出

↑↓/jk 选择 · Enter 确认 · q 退出
```

- **新游戏** auto-creates a fresh session (named by timestamp).
- **继续: X** resumes that save (autosaves after every advance).
- **Esc** during play opens an in-game menu (Continue / Return to Hub / Quit).

Saves live at `<game-dir>/.rpg-harness/sessions/<name>/state.json` — plain JSON, `git diff`-able, copyable between machines.

## The nine modes

```bash
rpgh init     <dir> [--force]                                  # scaffold a new game
rpgh play     <game-dir>                                       # interactive TUI (ink, hot-reloading)
rpgh step     <game-dir> --input <json> [--session NAME]       # headless, stateless step
rpgh peek     <game-dir> [--session NAME]                      # inspect current state
rpgh autoplay <game-dir> --persona NAME [-v]                   # built-in AI plays through
rpgh test     <game-dir>                                       # run fixtures
rpgh sessions <game-dir>                                       # list save sessions
rpgh assets   <game-dir> list|prompts [--missing]              # asset manifest / prompt copy
rpgh studio   <game-dir>                                       # browser asset workbench
```

Every mode runs on the same engine and the same content. `step` and `play` produce
identical state files. `autoplay` is just `step` with a built-in persona deciding
the input. `test` is `step` with assertions on the resulting trace. An AI agent
playing via the `rpg-harness-player` skill is just `step` with the LLM deciding the input.
`assets` and `studio` are authoring-side tools — they help humans (or AI) fill in
visual art for the spec.yaml entries scripts reference.

## A game is a folder

```
my-game/
├── game.yaml                  title
├── characters/
│   └── alice.md               name, default affection, description, portraits map
├── maps/                      optional — locations the player can be in
│   └── town.yaml              connections, actions, encounter tables
├── scripts/
│   ├── 001_meeting.md         台本 with frontmatter: id, title, requires, characters, bg
│   └── ...
├── assets/                    optional — portraits, backgrounds, CGs
│   ├── portraits/alice-smile/
│   │   ├── spec.yaml                       description, prompt, placeholder, sizing
│   │   ├── tui.txt?                        ASCII rendering for terminal (optional)
│   │   ├── tui.ans?                        ANSI-colored rendering (optional)
│   │   ├── source.quality.png?             high-res master (gitignored)
│   │   └── source.compressed.webp?         distribution copy (optional)
│   ├── backgrounds/sakura-path/spec.yaml
│   └── cgs/handshake/spec.yaml
└── tests/
    └── good-ending.yaml       fixture: state seed + inputs + assertions
```

No `package.json`. No `node_modules`. No build step. Author writes markdown.

## Script syntax

Every paragraph is one **beat**. Empty lines separate beats.

```markdown
---
id: 001_meeting
title: 樱花树下
characters: [alice]
---

四月的午后，校园的樱花树下。           ← narration (plain text)

@alice 嗨。你也喜欢看樱花吗？          ← dialogue (@speaker prefix)

? 你怎么回应？                          ← choice (? prompt)
- "嗯，很美。" -> +alice               ← inline effect: alice affection +1
- "只是路过。" -> -alice
- "我喜欢看你画。" -> +2alice           ← +N for larger deltas
- 离开 -> goto leave                    ← goto a label

她笑了。

[end]                                    ← end script here (skip remaining beats)

# leave                                  ← label

你转身离开了。
```

For complex choices (requires, flags, multiple effects), use a YAML fenced block:

```markdown
​```yaml
type: choice
prompt: 你怎么选？
options:
  - text: 答应碧河
    effects:
      flags: { route: bea }
    goto: pick_bea
  - text: 跟薄樱走
    requires:
      affection: { character: alice, min: 2 }
    effects:
      flags: { route: alice }
    goto: pick_alice
​```
```

Scripts can also drive visual assets — background, portrait per slot, full-screen CG:

```markdown
---
id: 002_under_sakura
title: 樱花树下
characters: [alice]
bg: assets/backgrounds/sakura-path        ← scene's backdrop (set on entry)
defaultPortraits:
  center: { characterId: alice, emotion: smile }
---

@alice smile 嗨，又见面了。                ← inline emotion: swaps to
                                          ← alice.portraits.smile

:cg assets/cgs/handshake                   ← full-screen CG takes over
@alice 别说什么了。
:hide-cg                                   ← back to bg + portrait

[end]
```

Backgrounds, portraits, and CGs are **visual assets** — each lives in `assets/<kind>/<id>/` with a `spec.yaml` describing what it depicts plus optional pre-rendered files. The convention is two-tier: `source.quality.png` is the author's high-res master (gitignored, kept local) and `source.compressed.{webp,png,jpg,jpeg}` is the slimmed distribution copy that travels with the repo so cloners get a working visual experience out of the box. ASCII art `tui.txt` and color `tui.ans` are what the TUI actually renders; missing renderings degrade to the spec's placeholder text, which is also what AI players see in the headless JSON event stream. See the [rpg-harness-author skill](.claude/skills/rpg-harness-author/SKILL.md) for the full asset spec format.

## Headless step API

This is what makes `autoplay`, `test`, and the AI-player skill possible:

```
step :: (Game, GameState, Input) → (GameState, Output)
```

Pure function. Stateless. Persistable. So:

```bash
# Session "claude" plays one step at a time
rpgh step ./my-game --session claude --input '{"type":"select","scriptId":"001_meeting"}'
rpgh step ./my-game --session claude --input '{"type":"next"}'
rpgh step ./my-game --session claude --input '{"type":"choose","index":2}'
```

State persists to `<game-dir>/.rpg-harness/sessions/<name>/state.json` between calls.
Each `step` also appends `(input, output)` to `log.jsonl` for replay.

## Test injection

```yaml
# tests/seeded-alice-good.yaml
name: 注入 alice 高好感，验证 good ending 可达
state:
  baseline:
    characters:
      alice: { affection: 5, custom: {} }
    flags: { route: alice }
    completedScripts: [001_meeting_alice, 002_meeting_bea, 003_invitation, 004a_alice_route]
inputs:
  - { type: select, scriptId: "005a_alice_good" }
  - { type: next }
  # ...
assertions:
  - kind: state
    path: baseline.completedScripts
    includes: 005a_alice_good
  - kind: output
    type: gameEnd
    present: true
```

You don't have to play through 001–004 to test 005a. Seed the state, run the loop,
assert the outcome. Same idea Auto-Quant uses for strategy backtesting, applied
here to gameplay regression.

## Built-in personas (no API key)

```bash
rpgh autoplay ./examples/sengoku-raid --persona extractor -v   # always extract / flee / sell
rpgh autoplay ./examples/sengoku-raid --persona delver    -v   # always attack / push deepest
```

Generic personas — `greedy`, `charmer`, `rude`, `random`, `hunter` — also ship
for any game (always-first / always-last / always-second / uniform-random /
training-aware). They're useful for fuzz-testing path coverage. For LLM-driven
personas use the [`rpg-harness-player` skill](.claude/skills/rpg-harness-player/SKILL.md).

## Architecture in one paragraph

`Engine` is a pure state machine. State is namespaced (`{ baseline: { ... } }`)
so future modules (combat, training, etc.) can each own a slice. The engine
yields `Output` events through an `AsyncGenerator` and accepts `Input` decisions.
The same generator is wrapped as `step()` for headless, `runLoop()` for batch
(tests + autoplay), and `play()` for the ink TUI. Same engine, different I/O bindings.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the long version,
[`docs/CLAUDE.md`](docs/CLAUDE.md) if you're an AI co-authoring on this codebase,
and [`.claude/skills/rpg-harness-player/SKILL.md`](.claude/skills/rpg-harness-player/SKILL.md)
if you're an AI playing the games.

## Status

Pre-alpha. Works end-to-end. Hub-mode TUI with multi-save and live hot-reload,
markdown content authoring, headless step API, fixture testing, built-in autoplay
personas, AI player + author skills, a scaffold command (`rpgh init`), and a
static **web frontend** (engine bundled in-tab, games baked at build time, saves
in localStorage — same engine + same screen-model reducer as the TUI; see
`packages/web/`) are all landed. Combat/training modules and a plugin registry
are next.

## License

MIT.
