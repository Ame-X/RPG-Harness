# @rpg-harness/web

The browser shell for RPG-Harness. Same engine, same game folders, same
`screen-model` reducer as the terminal (ink) frontend — only the renderer
differs: React DOM instead of ink, clicks instead of keystrokes.

It's a **static** app. The engine is a pure state machine with no Node
dependencies, so it bundles straight into the page (the way a web GBA
emulator bundles the console core into JS). Games are baked in at build
time. There is no backend: `vite build` → `dist/` → any static host.

## How it works

Three seams mirror the CLI, swapping fs for build-time + browser:

| Seam | CLI (`packages/cli`) | Web (here) |
| --- | --- | --- |
| catalog / loadGame | `discoverGames` + `loader.ts` (readdir + dynamic import) | `loadGame.ts` (`import.meta.glob` + `buildGame`) |
| renderer (consumes `screen-model`) | ink components | DOM components (`WebPlayScreen`, `VisualLayer`) |
| saves | `session.ts` → `state.json` on disk | `session.ts` → `localStorage` (`rpgh:save:<gameId>`) |

`src/loadGame.ts` is the heart: `import.meta.glob` sweeps the whole
`examples/` tree once and inlines every game folder three ways — content
markdown/YAML as raw strings (parsed by the same pure parser the CLI uses),
`modules/*.ts` + `preset/run.ts` as real transpiled JS, and asset images as
static URLs. Keys are partitioned by game id, so one bundle carries every
game and the picker lets you choose.

`Buffer` is polyfilled (`src/polyfill.ts`) because the parser's frontmatter
library (`gray-matter`) reaches for Node's global `Buffer`, which browsers
lack.

## Adding a game

Drop a game folder under `examples/` (a `game.yaml` + the usual resource
dirs) and rebuild. No code change here — the globs pick it up. Games with
`hidden: true` in `game.yaml` are excluded from the picker (same rule as the
CLI's `discoverGames`).

Note: a game's `modules/` and `preset/` must be browser-safe — no `node:`
imports, no fs/process. That's already the engine's hard rule for modules,
so any game that runs in the CLI runs here.

## Commands

```sh
bun run dev:web      # vite dev server (from repo root)
bun run build:web    # → packages/web/dist
bun run --filter='@rpg-harness/web' preview   # serve the built bundle
```

## Deploy (Vercel)

The repo-root `vercel.json` points Vercel at this package: it runs
`bun run build:web` and serves `packages/web/dist`. Push and share the link.
