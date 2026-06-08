// Browser twin of packages/cli/src/loader.ts. The CLI loader walks the
// filesystem (readdir + dynamic import); we can't do that in a browser,
// so at BUILD time vite's import.meta.glob inlines every game folder:
// content as raw strings (parsed by the same pure parser the CLI uses),
// modules/preset as real transpiled JS, and asset images as static URLs.
//
// All three globs sweep the whole examples/ tree once; we partition the
// keys by game id. That makes a single bundle carry N games — listGames()
// enumerates them, loadWebGame(id) assembles one. Adding a game = drop a
// folder under examples/ and rebuild; no code change here.

import {
  buildGame,
  parseAction,
  parseAssetSpec,
  parseCharacter,
  parseEnemy,
  parseItem,
  parseManifest,
  parseMap,
  parseScript,
  parseSkill,
  parseWeapon,
} from "@rpg-harness/parser";
import type {
  Action,
  AssetSpec,
  CharacterDef,
  EnemyDef,
  Game,
  ItemDef,
  MapDef,
  Module,
  RunFunction,
  Script,
  SkillDef,
  WeaponDef,
} from "@rpg-harness/engine";

const RAW = import.meta.glob("../../../examples/**/*.{md,yaml,yml}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CODE = import.meta.glob("../../../examples/**/*.ts", {
  eager: true,
}) as Record<string, { default?: unknown }>;

const IMAGES = import.meta.glob(
  "../../../examples/**/assets/**/*.{webp,png,jpg,jpeg}",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

export interface WebGame {
  game: Game;
  // Resolves a VisualState asset path ("assets/portraits/kagari-smile")
  // to a browser image URL. The Stage component renders <img src> from
  // this instead of AssetSpec.renderings (whose fs paths are meaningless
  // in a browser).
  assetUrls: Record<string, string>;
}

export interface WebGameInfo {
  id: string;
  title: string;
  hidden: boolean;
}

// Enumerate every game baked into this bundle (one per game.yaml found).
// Hidden games (manifest `hidden: true`) are filtered unless requested —
// mirrors discoverGames() in packages/cli/src/games.ts.
export function listGames(includeHidden = false): WebGameInfo[] {
  const out: WebGameInfo[] = [];
  for (const id of gameIds()) {
    const manifestRaw = rawFor(id).get("game.yaml");
    if (manifestRaw === undefined) continue;
    let title = id;
    let hidden = false;
    try {
      const m = parseManifest(manifestRaw);
      if (m.title) title = m.title;
      if (m.hidden === true) hidden = true;
    } catch {
      // keep id fallback
    }
    out.push({ id, title, hidden });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return includeHidden ? out : out.filter((g) => !g.hidden);
}

export function loadWebGame(gameId: string): WebGame {
  const raw = rawFor(gameId);
  const manifestRaw = raw.get("game.yaml");
  if (manifestRaw === undefined) {
    throw new Error(`game "${gameId}": game.yaml not found in bundle`);
  }
  const manifest = parseManifest(manifestRaw);

  const characters = collect<CharacterDef>(raw, "characters", [".md"], parseCharacter);
  const scripts = sortById(
    collect<Script>(raw, "scripts", [".md"], parseScript),
  );
  const actions = sortById(
    collect<Action>(raw, "actions", [".yaml", ".yml"], parseAction),
  );
  const items = sortById(collect<ItemDef>(raw, "items", [".md"], parseItem));
  const enemies = sortById(
    collect<EnemyDef>(raw, "enemies", [".md"], parseEnemy),
  );
  const weapons = sortById(
    collect<WeaponDef>(raw, "weapons", [".md"], parseWeapon),
  );
  const skills = sortById(collect<SkillDef>(raw, "skills", [".md"], parseSkill));
  const maps = sortById(collect<MapDef>(raw, "maps", [".yaml", ".yml"], parseMap));
  const assets = collectAssets(raw).sort((a, b) => a.path.localeCompare(b.path));

  const modules: Module[] = [];
  for (const rel of manifest.modules ?? []) {
    const def = codeDefault(gameId, stripDot(rel));
    if (!def || typeof def !== "object" || typeof (def as Module).id !== "string") {
      throw new Error(
        `game "${gameId}": module ${rel} must default-export a Module with a string id`,
      );
    }
    modules.push(def as Module);
  }

  const game = buildGame(
    manifest,
    characters,
    scripts,
    actions,
    modules,
    items,
    enemies,
    weapons,
    skills,
    maps,
    assets,
  );

  // Ejected preset: manifest.preset is a relative path → its default
  // export is the RunFunction. Mirrors loader.ts lines 115-125.
  if (manifest.preset && isRelativePath(manifest.preset)) {
    const fn = codeDefault(gameId, stripDot(manifest.preset));
    if (typeof fn !== "function") {
      throw new Error(
        `game "${gameId}": preset ${manifest.preset} must default-export a RunFunction (got ${typeof fn})`,
      );
    }
    game.runFn = fn as RunFunction;
  }

  return { game, assetUrls: collectAssetUrls(gameId) };
}

interface KeyParts {
  gameId: string;
  rel: string;
}

// Glob keys look like "../../../examples/sengoku-raid/scripts/foo.md".
// Split on "/examples/" → (gameId, game-relative path).
function splitKey(key: string): KeyParts | null {
  const marker = "/examples/";
  const i = key.indexOf(marker);
  if (i < 0) return null;
  const after = key.slice(i + marker.length);
  const slash = after.indexOf("/");
  if (slash < 0) return null;
  return { gameId: after.slice(0, slash), rel: after.slice(slash + 1) };
}

function gameIds(): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(RAW)) {
    const p = splitKey(key);
    if (p && p.rel === "game.yaml") ids.add(p.gameId);
  }
  return [...ids];
}

function rawFor(gameId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, content] of Object.entries(RAW)) {
    const p = splitKey(key);
    if (p && p.gameId === gameId) out.set(p.rel, content);
  }
  return out;
}

function collect<T>(
  raw: Map<string, string>,
  subdir: string,
  exts: string[],
  parse: (content: string, source: string) => T,
): T[] {
  const out: T[] = [];
  for (const [rel, content] of raw) {
    if (!rel.startsWith(subdir + "/")) continue;
    if (!exts.some((ext) => rel.endsWith(ext))) continue;
    out.push(parse(content, rel));
  }
  return out;
}

const ASSET_KIND_DIRS = ["portraits", "backgrounds", "cgs"] as const;

function collectAssets(raw: Map<string, string>): AssetSpec[] {
  const out: AssetSpec[] = [];
  for (const [rel, content] of raw) {
    if (!rel.startsWith("assets/") || !rel.endsWith("/spec.yaml")) continue;
    const kind = rel.split("/")[1];
    if (!kind || !ASSET_KIND_DIRS.includes(kind as (typeof ASSET_KIND_DIRS)[number])) {
      continue;
    }
    const assetPath = rel.slice(0, rel.length - "/spec.yaml".length);
    const spec = parseAssetSpec(content, assetPath);
    // renderings stay empty: the web renderer resolves images through
    // assetUrls (build-time static URLs), not fs paths.
    out.push({ ...spec, renderings: {} });
  }
  return out;
}

function collectAssetUrls(gameId: string): Record<string, string> {
  const best: Record<string, { url: string; pri: number }> = {};
  for (const [key, url] of Object.entries(IMAGES)) {
    const p = splitKey(key);
    if (!p || p.gameId !== gameId || !p.rel.startsWith("assets/")) continue;
    const lastSlash = p.rel.lastIndexOf("/");
    const dir = p.rel.slice(0, lastSlash);
    const file = p.rel.slice(lastSlash + 1);
    const pri = rankImage(file);
    if (pri === 0) continue;
    const cur = best[dir];
    if (!cur || pri > cur.pri) best[dir] = { url, pri };
  }
  const out: Record<string, string> = {};
  for (const [dir, v] of Object.entries(best)) out[dir] = v.url;
  return out;
}

// web.* > source.compressed.* > source.quality.* — same precedence the
// loader uses, mapped to "which file do we point the <img> at".
function rankImage(file: string): number {
  if (file.startsWith("web.")) return 3;
  if (file.startsWith("source.compressed.")) return 2;
  if (file.startsWith("source.quality.")) return 1;
  return 0;
}

function codeDefault(gameId: string, rel: string): unknown {
  for (const [key, mod] of Object.entries(CODE)) {
    const p = splitKey(key);
    if (p && p.gameId === gameId && p.rel === rel) return mod.default;
  }
  return undefined;
}

function sortById<T extends { id: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => a.id.localeCompare(b.id));
}

function stripDot(p: string): string {
  return p.replace(/^\.\//, "");
}

function isRelativePath(s: string): boolean {
  return s.startsWith("./") || s.startsWith("../");
}
