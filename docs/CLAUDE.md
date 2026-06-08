# Working on RPG-Harness

This file is for AI co-authors (Claude Code, Cursor, …) picking up this codebase. For human-facing architectural context, read `docs/ARCHITECTURE.md` first — it gives you the layering, the resource database, and the lifecycle hooks. This file is operational: where things live, what the hard rules are, how to extend without breaking.

## What this project is

A headless RPG Maker — an AI-first coding harness for GalGame-shaped games. A game is a folder. The engine runs in a terminal via ink; the same engine drives a web frontend and a JSON-in/JSON-out test harness. The engine owns universal pieces (typed resources, Condition DSL, 15 lifecycle hooks, reactive triggers, one write path); each game owns its mechanics via `modules/*.ts` and, optionally, an ejected `preset/run.ts`.

Five packages, never cross-import internals:

- `@rpg-harness/engine` — pure state machine. No React, no DOM, no Node-specific APIs (no `fs`, no `process`). Pure data in, pure events out. Owns the standard resource schemas (characters / items / enemies / weapons / skills), the Condition DSL, StateDelta, the Module interface (action handlers + 15 lifecycle hooks + reactive triggers), and the primitives that compose into preset loops.
- `@rpg-harness/parser` — markdown + YAML frontmatter → Game AST. One file per resource type.
- `@rpg-harness/frontend-core` — renderer-agnostic. The `screen-model` reducer (`applyOutput` / `applyUiAction`): projects the engine's `Output` stream into a stable `ScreenModel` (one current stage + a backlog + visuals). Imported by **both** frontends; depends only on engine types. No React, no ink, no DOM.
- `@rpg-harness/cli` — terminal frontend (ink) + loader + test harness + `init --eject`.
- `@rpg-harness/web` — browser frontend (React DOM). Static: the engine bundles into the page, games are baked at build time (`src/loadGame.ts`, the browser twin of the CLI loader), saves go to localStorage. Renders the same `frontend-core` ScreenModel the CLI does, with DOM components instead of ink.

## Hard rules

1. **Engine never imports DOM, Node, or React.** Any external need (read a file, ask the user) goes through an injected interface (`PresetContext`, frontend), never direct.
2. **State is plain JSON-serializable.** No class instances, no functions, no `Date`s, no `Map`s. `JSON.stringify` must round-trip without loss.
3. **One write path: `mutateState`.** Anything that changes `state.baseline` / `state.training` goes through `mutateState(ctx, delta, source)`. It calls `applyDelta` + `fireOnStateMutated` + `checkTriggers`. Bypassing it breaks triggers and the audit trail.
4. **ActionHandlers resolve atomically.** A handler returns an `ActionResult` (deltas + narrations + scriptStart). It does NOT yield. Multi-step output goes through `narrations: string[]` which the main loop drains one per step. This is what makes `step` mode work; violating it silently breaks AI playtester evaluation.
5. **Engine owns standard schemas; modules consume them.** Adding a field to `ItemDef` is an engine PR. A module's own data lives under `state[moduleId]` — its private namespace. Modules MUST NOT modify engine-owned slots except via primitives.
   - **Maps are first-class.** "Where the player is" lives in `state.baseline.currentMapId` (one of the engine's six standard resources, alongside characters/items/enemies/weapons/skills). Modules read it; modules write it via `enterMap(state, game, mapId)`. Do not invent module-private "current location" / "mode flag" fields — that's the pre-refactor pattern that the flat-map model exists to eliminate. If you need to know "are we in a special sub-context" (raid mode, dive jacked-in, etc.), express that by *which map* the player is on (e.g. `currentMap.chain === "kuro_swamp"`) rather than parallel state.
6. **No `any`, no `as` casts unless unavoidable.** Strict TS is the contract.
7. **No comments in source code.** Names and types must document themselves. Add a comment only when the WHY would surprise a future reader. Architecture docs go in `docs/`.
8. **Frontmatter is the only place imperative-looking syntax lives in content.** Scripts are declarative.

## Documentation sediment

Engine/parser/schema changes outrun docs by default — readers and future AI co-authors then work from stale information. When a PR changes behavior or shape, the docs update ships in the **same** PR, not as follow-up. Checklist:

1. **Engine schema** (new field on a `Def`, new `StateDelta` slot, new `Output` / `Input` variant, new `Condition` operator) → update `docs/ARCHITECTURE.md` resource table / relevant section.
2. **New frontmatter convention** (new fields in an asset format, new beat syntax, new effect shape) → update `.claude/skills/rpg-harness-author/SKILL.md` so AI authors discover it.
3. **New game-mode shape** (a fundamentally different preset / hub pattern, like sengoku-raid's raid-as-mode) → add `examples/<game>/README.md` AND extend the "game modes" section of top-level `README.md`.
4. **New hard rule or repeating pattern** (something other modules should copy, like the `.custom` field passthrough) → add to this file's "Hard rules" or "Common tasks".
5. Run the full fixture suite (`bun run rpgh test examples/<each>`) and typecheck for every package before opening the PR.

Precedents to imitate: commit `cd02df8` ("docs: sediment architecture + co-author docs to reflect post-PR-#7 reality") updated three docs in one go after PR #7. PR #12 (sengoku-raid + custom field + dispatcher hygiene) was the exception this checklist exists to prevent.

## File map

```
packages/engine/src/
  types.ts              all engine types (resources, state, Module, hooks, Output/Input, …)
  state.ts              createInitialState, applyDelta, query helpers
  condition.ts          Condition DSL evaluator
  engine.ts             Engine class — constructs maps, resolves runFn, exposes run()
  runLoop.ts            interactive `runLoop` driver
  step.ts               headless `step` driver (fresh engine per call)
  primitives/
    runScript.ts        beat loop with choice + effects
    drainNarrations.ts  empty runtime.pendingNarrations as outputs
    dispatchActivity.ts script-or-action routing
    applyActionResult.ts apply handler result atomically
    mutateState.ts      THE write path — delta + onStateMutated + checkTriggers
    enterMap.ts         set currentMapId + sync visuals.bg + queue onEnter script
    buildMapHub.ts      collectMapActivities / buildMapHubSnapshot — scope hub by currentMapId
    checkEndConditions.ts
    checkTriggers.ts    rising-edge detection + bounded cascade
    hooks.ts            15 fireOn* dispatchers
    inventory.ts        give / consume / has
    weapons.ts          equip / getPower / setPower
    skills.ts           learn / knows
    index.ts            primitive re-exports
  modules/
    baseline.ts         bundled module: state init + useItem + useSkill + moveToMap handlers
    runtime.ts          bundled module: pendingNarrations init etc.
  presets/
    vn/                 visual-novel preset (linear)
    training/           calendar + hub + actions + endings preset
  index.ts              public exports

packages/parser/src/
  index.ts              buildGame(...) — assembles parsed pieces into a Game
  game.ts               game.yaml parsing
  script.ts             script .md parsing
  character.ts items.ts enemy.ts weapon.ts skill.ts action.ts
  condition.ts          Condition DSL parser (mirror of evaluator)
  inline-effects.ts     effects: blocks inside scripts / actions

packages/frontend-core/src/
  screen-model.ts       Output → ScreenModel reducer (applyOutput / applyUiAction); shared by cli + web

packages/cli/src/
  index.ts              `rpgh` binary entry — argv routing
  loader.ts             game-folder → Game (calls parsers, dynamic-imports modules + preset)
  app.tsx               ink root component
  interactor.ts         ink events → engine Input
  init.ts               `rpgh init --preset --eject`
  test.ts               fixture runner
  autoplay.ts           persona-driven headless playthrough
  stage-input.ts        (current stage + keypress) → engine Input / UI action
  components/           ink widgets

packages/web/src/
  loadGame.ts           browser twin of loader.ts: import.meta.glob → Game (+ asset URLs)
  WebPlayScreen.tsx     engine pump + DOM stage rendering (mirrors cli PlayScreen)
  VisualLayer.tsx       bg / portraits / cg as <img> from build-time asset URLs
  session.ts            localStorage save/load (per-game slot)
  polyfill.ts           Buffer shim (gray-matter needs it in the browser)
  App.tsx               game picker + resume/new-game wiring

examples/
  sengoku-raid/         flagship: extraction-shooter raid loop + GalGame bonds, 13/15
                        module hooks, full Condition AST, composite triggers, selfSwitch,
                        weapon.custom, ejected preset
  hook-test/            (hidden) hook integration smoke test (notify-all + first-wins + reducer)
  eject-test/           (hidden) ejection smoke test — minimal training preset reference
  _invalid_typo/        (hidden) negative fixture: validator must reject undeclared switch
```

`hidden: true` in a fixture's `game.yaml` makes `bun run play`'s discovery
skip it. Engine fixtures use this; `bun run test:fixtures` still runs them.

## How a step happens

1. Frontend (or test harness) calls `loop.next(input)`.
2. The preset's `run.ts` resumes inside its `while (true)`.
3. It checks end conditions, drains queued narrations, advances scripts, polls hub via `fireOnHubBuild`, dispatches actions via `dispatchActivity`.
4. `dispatchActivity` resolves to either a script start (sets `currentScriptId`) or an action handler call (`ActionResult` → `applyActionResult` → `mutateState` per delta → triggers possibly cascade).
5. Generator yields the next `Output` and pauses, waiting for the next `Input`.

The engine itself (`engine.ts`) is ~100 lines. It builds maps, resolves the run function (game-specified path → bundled preset name → auto-pick by shape), and yields from `runFn(ctx)`.

## Common tasks

### Add a new typed resource to the engine

Follow the pattern established by `Item` / `Enemy` / `Weapon` / `Skill`:

1. **`packages/engine/src/types.ts`** — add `XxxDef`, a `Game.xxxs?: XxxDef[]` field, a `PresetContext.xxxMap`, a state slot under `BaselineState`, a `StateDelta.xxxs?` field if mutable, a `Condition` variant for queries, a `StateMutationSource` value if it has its own write source.
2. **`packages/engine/src/state.ts`** — initialize the baseline slot in `createBaselineState`; handle the slot in `applyDelta` (clamp / prune invariants live HERE, not in handlers).
3. **`packages/engine/src/condition.ts`** — add case for the new operator.
4. **`packages/engine/src/primitives/<resource>.ts`** — read/write helpers, all going through `mutateState` for writes.
5. **`packages/engine/src/modules/baseline.ts`** — if it has a bundled action handler (like `useItem`), register it here. Atomic-resolution invariant applies.
6. **`packages/engine/src/engine.ts`** — build the map in the constructor.
7. **`packages/engine/src/index.ts`** — export `XxxDef` and any new primitives.
8. **`packages/parser/src/<resource>.ts`** — mirror `character.ts`.
9. **`packages/parser/src/condition.ts`** — parse the new condition variant.
10. **`packages/parser/src/inline-effects.ts`** + **`script.ts`** + **`action.ts`** — accept the new StateDelta field.
11. **`packages/parser/src/index.ts`** — extend `buildGame` signature.
12. **`packages/cli/src/loader.ts`** — scan the new directory.
13. **`examples/sengoku-raid/`** — add demo content + at least one fixture exercising the read AND write paths.
14. **`.claude/skills/rpg-harness-author/SKILL.md`** — document the file format for AI authors.

Recent precedents: read the diffs for commits `cb7b9f3` (items), `0220799` (enemies), `6470ff8` (weapons), `c2efdb5` (skills). They're the template.

### Game-specific metadata on resource Defs (the `.custom` field)

Every parsed Def (`ItemDef` / `EnemyDef` / `WeaponDef` / `SkillDef` / `CharacterDef`) carries an optional `custom?: Record<string, unknown>` populated by `extractCustom()` in `packages/parser/src/frontmatter.ts` — any frontmatter key not in the parser's known-fields list lands there verbatim. Game modules read e.g. `enemy.custom.attack_power` or `item.custom.sell_value` straight from the engine's resource registry.

This is the preferred way to attach per-game data to a resource. **Do not** add fields to the engine `Def` interfaces just because one game needs them; that bloats the schema for every other game. Engine-side fields are for things every game needs (id, name, hp, etc.). `custom` is for everything else.

Originally needed because sengoku-raid was maintaining a `SELL_VALUES: Record<string, number>` workaround table in its module — the engine schema dropped the field and the module had to mirror it. After PR #12 the workaround is gone; the item .md is the single source of truth.

### Add a new Output type

1. Add variant to `Output` in `packages/engine/src/types.ts`.
2. Make the engine yield it where appropriate (usually inside a primitive).
3. Add a renderer component in `packages/cli/src/components/`.
4. Wire it into `packages/cli/src/app.tsx`.

Both ends MUST be updated. If you only add the type without rendering, the CLI fails at runtime on that variant.

### Add a new Input type

Symmetric: add variant, make the relevant primitive accept it, make the interactor produce it.

### Add a new Beat type

1. Add variant to `Beat` in `types.ts`.
2. Handle it in `primitives/runScript.ts` (the switch over `beat.type`).
3. Teach `packages/parser/src/script.ts` to recognize its syntax.

### Add a new Condition operator

1. Add variant to `Condition` in `types.ts`.
2. Handle it in `evaluateCondition` in `condition.ts`.
3. Add parse branch in `packages/parser/src/condition.ts`.

### Add a new lifecycle hook

1. Add the method to `Module` in `types.ts`.
2. Add `fireOnXxx` to `primitives/hooks.ts` — match an existing compose strategy (notify-all / first-wins / veto).
3. Call `fireOnXxx` at the right point in preset `run.ts` files AND/OR in primitives.
4. Add an entry to `examples/hook-test/` proving it fires.

### Write a module (game-side)

A gameplay module is a `.ts` file under the game's `modules/`. Default-export a `Module`. `id` should be unique. Use the module's id as the key for its private state namespace (`state[id]`). Reach into engine state ONLY via primitives (`giveItem`, `mutateState`, etc.) — never write `state.baseline.*` directly.

See `examples/sengoku-raid/modules/raid.ts` for the canonical pattern: action handlers for ~20 action kinds, reactive triggers (including `once: true` milestones with composite `when:`), private state namespace (`state["sengoku-raid"]`), and a wide hook surface (onScriptStart/Complete, onActionDispatch first-wins, onBeatBefore + onChoicePresented reducers, onStateMutated observer).

### Add a fixture

`examples/<game>/tests/<name>.yaml` with the schema from `packages/cli/src/test.ts`. Fixtures run in CI on every PR. They're also executable spec — the assertions describe what the feature does.

## Testing

`bun test` runs the in-tree unit tests. `bun run rpgh test <game-folder>` runs all `tests/*.yaml` fixtures. CI runs both for `sengoku-raid`, `hook-test`, and `eject-test` on every PR, plus `scripts/test-validate-negative.sh` for `_invalid_typo`.

The engine is testable without ink: instantiate `new Engine(game)`, push synthetic inputs, assert on yielded outputs. Fixture infrastructure does exactly that.

## When NOT to touch the engine

The engine is small on purpose. If a feature can live in content (a new script, a new condition tree, a new flag), in a module (a new action handler, a new trigger), or in the frontend (better rendering, a different layout), do it there. Engine changes affect every game in existence.

Engine PRs are warranted for: new standard resource types, new hook points, new primitives that multiple modules will share, new `StateDelta` fields, new `Condition` operators, new `Output` / `Input` variants.

## Deferred / not yet implemented

- **States** (buff/debuff as a 5th typed resource) — tick mechanic + duration semantics are non-trivial; deferred until a game needs them.
- **Save/load surface** — state model supports it (plain JSON). The TUI persists per-session to disk (`packages/cli/src/session.ts`) and the web shell to localStorage (`packages/web/src/session.ts`), but there's no explicit save/load *command* (named slots, export/import) yet.

Landed since this list was last cut:
- **Web frontend** — `packages/web` is a static React DOM shell. The engine bundles into the page (no backend); games are baked at build time via `import.meta.glob` (`src/loadGame.ts`, the browser twin of the CLI loader); saves go to localStorage. It shares the engine and the `@rpg-harness/frontend-core` `screen-model` reducer with the TUI — only the renderer (DOM vs ink) and the three fs-vs-browser seams (loadGame / saves / no hot-reload) differ. See `packages/web/README.md`.
