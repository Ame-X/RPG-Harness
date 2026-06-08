// sengoku-raid: the headless extraction-shooter module. Reference
// implementation for "what an RPGMaker-native RPG-Harness module looks
// like" after Phase 6.
//
// Owns:
//   - mode flag (HUB / RAID), per-raid sub-state (current zone,
//     encounter, pending loot), and the metCharacters tracker — all
//     in the module's own state slice at state["sengoku-raid"]
//   - the hub menu (mode-dependent activities) via onHubBuild
//   - 12 raid/hub action handlers declared via module.actionHandlers
//     + provides. Dispatched by the engine's standard
//     actionHandlerRegistry; activities carry actionKind + payload
//     so the engine routes Input.doActivity through one code path.
//   - reactive triggers: death (player.hp ≤ 0), spectral overload
//     (player.spectral ≥ 100)
//
// Storage layout:
//   - Player stats (HP / mental / spectral / intellect) live on the
//     `player` character (characters/player.md) with declared
//     min/max. Engine clamps on every mutateState write.
//   - raidsCompleted / raidsFailed are declared variables (game.yaml).
//   - Maps load via the engine's parser as a first-class resource
//     (maps/*.yaml → ctx.game.maps / ctx.mapMap). The module reads
//     them; it no longer touches the filesystem.
//
// Why not the training preset?
//   We want raid/hub modes instead of day/slot calendar, and we want
//   our onHubBuild to win first-wins. Skipping game.training avoids
//   both.

import { enterMap, evaluateCondition } from "@rpg-harness/engine";
import type {
  ActionContext,
  ActionHandler,
  ActionResult,
  CharacterSpawnRule,
  ComposedState,
  Game,
  HubActivity,
  Input,
  MapDef,
  Module,
  Output,
  PresetContext,
  StateDelta,
  StatSnapshot,
  Trigger,
} from "@rpg-harness/engine";

// Most helpers take a minimal ctx (state + game + rng) so they work for
// both PresetContext callers (the preset / onHubBuild) and ActionContext
// callers (handler dispatch). RNG is optional because pure-read helpers
// don't need it.
type Ctx = {
  state: ComposedState;
  game: Game;
  rng: () => number;
};

const MODULE_ID = "sengoku-raid";

// ============================================================================
// Player stats live on the `player` character (characters/player.md)
// with declared min/max — the engine clamps automatically through
// mutateState. `playerStat` / `setPlayerStat` are thin readers/writers
// kept until R2 converts every site to ActionResult { deltas } returns.
// ============================================================================

type PlayerStat = "hp" | "mental" | "spectral" | "intellect";

function playerStat(ctx: Ctx, name: PlayerStat): number {
  return ctx.state.baseline.characters.player?.stats[name] ?? 0;
}

function playerStatMax(ctx: Ctx, name: PlayerStat): number {
  return (
    ctx.game.characters.find((c) => c.id === "player")?.stats?.[name]?.max ?? 0
  );
}

function setPlayerStat(
  ctx: Ctx,
  name: PlayerStat,
  value: number,
): void {
  const c = ctx.state.baseline.characters.player;
  if (!c) return;
  const def = ctx.game.characters.find((cd) => cd.id === "player")?.stats?.[
    name
  ];
  const min = def?.min ?? Number.NEGATIVE_INFINITY;
  const max = def?.max ?? Number.POSITIVE_INFINITY;
  c.stats[name] = Math.max(min, Math.min(max, value));
}

type GameVariable = "raidsCompleted" | "raidsFailed";

function getVar(ctx: Ctx, name: GameVariable): number {
  const v = ctx.state.baseline.variables[name];
  return typeof v === "number" ? v : 0;
}

function setVar(ctx: Ctx, name: GameVariable, value: number): void {
  ctx.state.baseline.variables[name] = value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ============================================================================
// Module sub-state
// ============================================================================

// Per-map runtime state for the *current* raid. Lazy-initialized when
// the player enters a map; lives only inside a RaidInstance and resets
// every raid. Static data (name, connections, encounter/loot tables) is
// not duplicated here — read it from `ctx.mapMap.get(<mapId>)` whenever
// needed.
interface MapInstance {
  visited: boolean;
  searched: boolean;
  encounter: null | {
    enemyId: string;
    enemyHp: number;
    enemyHpMax: number;
    // Set true when HP drops below 30% — unlocks negotiate options in
    // buildRaidMenu. Cleared automatically when the encounter resolves
    // (encounter goes null).
    negotiable?: boolean;
  };
  encounterCleared: boolean;
  pendingLoot: Record<string, number>;
  // Set once this zone's encounter has been rolled — either on first
  // arrival, or earlier by 澪's 水鏡 scry while still in a neighbouring
  // zone. The guard keeps a scouted enemy truthful: the actual arrival
  // must not re-roll and contradict what the player was shown.
  encounterRolled?: boolean;
}

// One raid (a single "expedition" from edo_castle through a chain of maps).
// `chain` matches MapDef.chain; entryMapId is the chain entry the player
// departed to. Per-map state lives in `visited`, keyed by map id —
// crucially, "what map am I on now" is not stored here, it lives in
// `state.baseline.currentMapId` (engine-canonical).
interface RaidInstance {
  chain: string;
  entryMapId: string;
  visited: Record<string, MapInstance>;
  pendingLoot: Record<string, number>; // gathered this raid (sum across maps)
  turnsTaken: number;
}

interface RaidModuleState {
  // "In a raid?" is equivalent to `raid !== null`. The previous explicit
  // `mode: "hub" | "raid"` flag was redundant with the raid sub-state
  // pointer; collapsed in the flat-map migration.
  raid: RaidInstance | null;
  metCharacters: string[];
  // Currently-invited companion. Cleared on raid end (success or
  // failure) regardless of HP. The companion's switch
  // `companion_<id>` is the player-facing source of truth — that
  // is what onChoicePresented / onBeatBefore key on.
  companion: string | null;
  // Companion HP for current raid. 10 cap. When this hits 0 the
  // companion is downed → affection -3, switch flipped off,
  // companion_downed variable += 1.
  companionHp: number;
  // 妖刀の業 — when set, the next time buildRaidMenu (or buildHubMenu
  // if mode flipped) runs, the menu shows only the three imbue
  // activities. Stores the absorb amount the victory queued so the
  // imbue handler can apply it via the chosen pulse's formula.
  pulsePending: null | { enemyId: string; absorb: number };
  // 業の鏡 — log of milestones the player has crossed. Pushed by the
  // onStateMutated observer when a watched stat crosses a threshold
  // for the first time, and by onLabelEnter for letter_03 endings.
  // Duplicates are filtered at append time.
  achievementLog: string[];
}

function moduleState(ctx: Ctx): RaidModuleState {
  const s = ctx.state[MODULE_ID] as RaidModuleState | undefined;
  if (!s) throw new Error(`${MODULE_ID}: module state missing`);
  return s;
}

// Engine-canonical reads. "Where am I right now" is `currentMapId`; the
// per-map runtime instance for the current raid lives at
// `m.raid.visited[currentMapId]`. These helpers consolidate the read so
// the rest of the file doesn't repeat the null-checks.
function currentMap(ctx: Ctx): MapDef | undefined {
  const id = ctx.state.baseline.currentMapId;
  if (id === null) return undefined;
  return ctx.game.maps?.find((m) => m.id === id);
}

function currentMapInstance(ctx: Ctx): MapInstance | undefined {
  const m = moduleState(ctx);
  if (!m.raid) return undefined;
  const id = ctx.state.baseline.currentMapId;
  if (id === null) return undefined;
  return m.raid.visited[id];
}

function ensureMapInstance(ctx: Ctx, mapId: string): MapInstance {
  const m = moduleState(ctx);
  if (!m.raid) throw new Error(`${MODULE_ID}: ensureMapInstance with no active raid`);
  let inst = m.raid.visited[mapId];
  if (!inst) {
    inst = {
      visited: false,
      searched: false,
      encounter: null,
      encounterCleared: false,
      pendingLoot: {},
    };
    m.raid.visited[mapId] = inst;
  }
  return inst;
}

function inRaid(ctx: Ctx): boolean {
  return moduleState(ctx).raid !== null;
}

// ============================================================================
// Maps — loaded by the engine's parser as a first-class resource type
// (packages/parser/src/map.ts). Module consumes them via ctx.game.maps
// or the per-id ctx.mapMap lookup that buildPresetContext exposes.
// ============================================================================

function getMap(ctx: Ctx, mapId: string): MapDef | undefined {
  return ctx.game.maps?.find((m) => m.id === mapId);
}

// Chain → entry map id. Each chain's expedition starts at its
// entry map (the first map the player lands on when they "depart"
// for that chain). Hard-coded because every chain has a distinct
// natural entry; a schema flag would just push this lookup into yaml.
const CHAIN_ENTRY: Record<string, string> = {
  kuro_swamp: "kuro_swamp_edge",
  mt_houkyou: "mt_houkyou_foothills",
  sumida_river: "sumida_river_bridge_foot",
  hell_gate: "hell_gate_mouth",
};

// Sorted list of (chain, entry-map) pairs the player can currently
// depart to. Hub menu uses this to emit depart activities.
function discoverableChains(ctx: Ctx): { chain: string; entry: MapDef }[] {
  const seen = new Set<string>();
  const out: { chain: string; entry: MapDef; difficulty: number }[] = [];
  for (const m of ctx.game.maps ?? []) {
    if (!m.chain) continue;
    if (seen.has(m.chain)) continue;
    seen.add(m.chain);
    const entryId = CHAIN_ENTRY[m.chain];
    if (!entryId) continue;
    const entry = getMap(ctx, entryId);
    if (!entry) continue;
    if (!chainUnlocked(ctx, m.chain)) continue;
    out.push({ chain: m.chain, entry, difficulty: entry.difficulty ?? 1 });
  }
  out.sort((a, b) => a.difficulty - b.difficulty);
  return out.map(({ chain, entry }) => ({ chain, entry }));
}

// Chain availability gates. hell_gate stays locked behind the same
// composite (weapon power AND two skills AND pulse_oni).
function chainUnlocked(ctx: Ctx, chain: string): boolean {
  if (chain === "hell_gate") {
    const pulseOni = (ctx.state.baseline.variables.pulse_oni ?? 0) as number;
    const power = ctx.state.baseline.weapons.ancestor_yaodao?.power ?? 0;
    const knows = ctx.state.baseline.knownSkills;
    return (
      pulseOni >= 8 &&
      power >= 12 &&
      knows.includes("chinkonho") &&
      knows.includes("mizukagami")
    );
  }
  return true;
}

// ============================================================================
// Random helpers (use ctx.rng for determinism)
// ============================================================================

function pickWeighted<T extends { weight: number }>(
  rng: () => number,
  pool: T[],
): T {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1]!;
}

function rollIntInclusive(rng: () => number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ============================================================================
// Hub menu construction (mode-dependent)
// ============================================================================

function buildSnapshot(activities: HubActivity[], ctx: Ctx): Output {
  return {
    type: "hubMenu",
    snapshot: {
      day: 0,
      maxDay: 0,
      slot: 0,
      slotName: "",
      slotsPerDay: 0,
      stats: buildStatSnapshots(ctx),
      affections: buildAffectionSnapshots(ctx),
      activities,
    },
  };
}

function buildStatSnapshots(ctx: Ctx) {
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  const stats: StatSnapshot[] = [
    {
      id: "hp",
      name: "体力",
      value: playerStat(ctx, "hp"),
      min: 0,
      max: playerStatMax(ctx, "hp"),
      thresholds: [
        { min: 0, label: "瀕死", color: "red" as const },
        { min: 6, label: "負傷", color: "yellow" as const },
        { min: 15, label: "万全", color: "green" as const },
      ],
    },
    {
      id: "mental",
      name: "精神",
      value: playerStat(ctx, "mental"),
      min: 0,
      max: playerStatMax(ctx, "mental"),
      thresholds: [
        { min: 0, label: "崩壊", color: "red" as const },
        { min: 3, label: "安定", color: "green" as const },
      ],
    },
    {
      id: "spectral",
      name: "霊体化",
      value: playerStat(ctx, "spectral"),
      min: 0,
      max: 100,
      thresholds: [
        { min: 0, label: "平穏", color: "green" as const },
        { min: 20, label: "覚醒", color: "cyan" as const },
        { min: 50, label: "危険", color: "yellow" as const },
        { min: 80, label: "暴走寸前", color: "red" as const },
      ],
    },
    { id: "intellect", name: "学識", value: playerStat(ctx, "intellect"), min: 0, max: 99 },
    { id: "ryo", name: "両", value: ryo, min: 0, max: 99999 },
  ];

  // 三脈 — always shown; value 0 reads as "未流したことがない". These are
  // the variables that gate the endings (pure rite / 鬼ヶ門 / 凡道), so
  // putting them in the visible stat strip lets the player track where
  // their build is heading without grepping state JSON.
  const v = ctx.state.baseline.variables;
  stats.push({
    id: "pulse_pure",
    name: "脈絡: 浄",
    value: ((v.pulse_pure ?? 0) as number),
    min: 0,
    max: 99,
  });
  stats.push({
    id: "pulse_oni",
    name: "脈絡: 鬼",
    value: ((v.pulse_oni ?? 0) as number),
    min: 0,
    max: 99,
    thresholds: [
      { min: 0, label: "清", color: "green" as const },
      { min: 5, label: "傾", color: "yellow" as const },
      { min: 10, label: "堕", color: "red" as const },
    ],
  });
  stats.push({
    id: "pulse_mundane",
    name: "脈絡: 凡",
    value: ((v.pulse_mundane ?? 0) as number),
    min: 0,
    max: 99,
  });

  // Companion HP — surfaced only while a companion is in party. The
  // module already tracks companionHp on m, but it wasn't exposed to
  // the snapshot; without this row the player can't tell their tank
  // is bleeding out short of reading combat narration.
  const m = moduleState(ctx);
  if (m.companion) {
    const charName =
      ctx.game.characters.find((c) => c.id === m.companion)?.name ?? m.companion;
    stats.push({
      id: "companion_hp",
      name: `同伴 ${charName}`,
      value: m.companionHp,
      min: 0,
      max: 10,
      thresholds: [
        { min: 0, label: "倒", color: "red" as const },
        { min: 4, label: "傷", color: "yellow" as const },
        { min: 7, label: "万全", color: "green" as const },
      ],
    });
  }

  return stats;
}

function buildAffectionSnapshots(ctx: Ctx) {
  const m = moduleState(ctx);
  return ctx.game.characters
    .filter((c) => m.metCharacters.includes(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      value: ctx.state.baseline.characters[c.id]?.stats.affection ?? 0,
    }));
}

function buildHubMenu(ctx: Ctx): Output {
  const m = moduleState(ctx);
  const activities: HubActivity[] = [];

  // Per-character bonding: hub-side gift + scripted bond scenes.
  // The bond scripts are static files (scripts/bond_<id>_NN.md) with
  // affection-gated `requires:` clauses. They're surfaced here as
  // "script:" activities, dispatched through the engine's standard
  // dispatch (NOT the raid module's prefix), so script completion
  // hooks fire normally and the script gets logged to completionOrder.
  for (const charId of m.metCharacters) {
    const char = ctx.game.characters.find((c) => c.id === charId);
    if (!char) continue;
    const ryo = ctx.state.baseline.inventory.ryo ?? 0;
    activities.push({
      id: `bond:${charId}`,
      kind: "action",
      actionKind: "bond",
      payload: { characterId: charId },
      title: `${char.name}に贈り物をする`,
      description: "好感度 +1（50 両）",
      category: "social",
      cost: 0,
      effectsHint: `${char.name}+1 ryo-50`,
      available: ryo >= 50,
      lockedReason: ryo < 50 ? "両が足りない" : undefined,
    });
    // Surface bond scripts. Unlike zone_haunt / ending which we hide
    // until eligible (surprise content), bond_* scripts are surfaced
    // even when locked — with lockedReason — so the player can see
    // "送り物をもう一度すれば開放" instead of wondering whether the
    // scene exists at all.
    for (const script of ctx.game.scripts) {
      if (!script.id.startsWith(`bond_${charId}_`)) continue;
      if (ctx.state.baseline.scripts[script.id]?.completed === true) continue;
      const reqs = script.requires;
      const r =
        reqs === undefined ? { ok: true } : evaluateCondition(reqs, ctx.state);
      activities.push({
        id: `script:${script.id}`,
        kind: "script",
        title: `${char.name} — ${script.title}`,
        category: "social",
        cost: 0,
        available: r.ok,
        ...(r.ok ? {} : { lockedReason: r.reason }),
      });
    }
  }

  // zone_haunt_<enemy> — one-shot lore scripts that unlock when the
  // player has *released* (negotiated free) an enemy of that type
  // at least once. Selfswitch A on the script is the unlock gate;
  // script `requires:` reads it. Once played, script.completed is
  // true and it disappears from the hub.
  for (const script of ctx.game.scripts) {
    if (!script.id.startsWith("zone_haunt_")) continue;
    if (ctx.state.baseline.scripts[script.id]?.completed === true) continue;
    const reqs = script.requires;
    const eligible = reqs === undefined || evaluateCondition(reqs, ctx.state).ok;
    if (!eligible) continue;
    activities.push({
      id: `script:${script.id}`,
      kind: "script",
      title: `回想 — ${script.title}`,
      category: "social",
      cost: 0,
      available: true,
    });
  }

  // Ending scripts — gated on chose_court_* + the corresponding pulse
  // threshold. The same enumeration pattern as bond_* / zone_haunt_*;
  // the engine's evaluateCondition does all the gating work.
  for (const script of ctx.game.scripts) {
    if (!script.id.startsWith("ending_")) continue;
    if (ctx.state.baseline.scripts[script.id]?.completed === true) continue;
    const reqs = script.requires;
    const eligible = reqs === undefined || evaluateCondition(reqs, ctx.state).ok;
    if (!eligible) continue;
    activities.push({
      id: `script:${script.id}`,
      kind: "script",
      title: `終局 — ${script.title}`,
      category: "raid",
      cost: 0,
      available: true,
    });
  }

  // Sell loot
  const lootIds = Object.entries(ctx.state.baseline.inventory).filter(
    ([id, n]) => n > 0 && isLoot(ctx, id),
  );
  if (lootIds.length > 0) {
    const total = lootIds.reduce((sum, [id, n]) => sum + n * sellValue(ctx, id), 0);
    activities.push({
      id: "sell_all_loot",
      kind: "action",
      actionKind: "sell_all_loot",
      title: `戦利品を炼器師に売る（${total} 両）`,
      description: lootIds.map(([id, n]) => `${itemName(ctx, id)} ×${n}`).join("、"),
      category: "shop",
      cost: 0,
      available: true,
    });
  }

  // Upgrade weapon — three pulse-paths. Player picks which side to feed
  // based on resources at hand + intended build.
  const shards = ctx.state.baseline.inventory.soul_shard ?? 0;
  const horns = ctx.state.baseline.inventory.oni_horn ?? 0;
  const frags = ctx.state.baseline.inventory.cursed_blade_fragment ?? 0;
  const ryoNow = ctx.state.baseline.inventory.ryo ?? 0;
  const canMundane = shards >= 3 && ryoNow >= 100;
  activities.push({
    id: "upgrade_mundane",
    kind: "action",
    actionKind: "upgrade_mundane",
    title: "炼器師に整え直させる（威力 +2、脈絡: 凡 +1）",
    description: "魂石碎片 ×3 + 100 両",
    category: "shop",
    cost: 0,
    available: canMundane,
    lockedReason: canMundane
      ? undefined
      : `魂石碎片 ≥3（現在 ${shards}）、両 ≥100（現在 ${ryoNow}）`,
  });
  const canPure = horns >= 1 && ryoNow >= 80;
  activities.push({
    id: "upgrade_pure",
    kind: "action",
    actionKind: "upgrade_pure",
    title: "神社で鎮魂の儀を頼む（威力 +1、脈絡: 浄 +1）",
    description: "鬼の角 ×1 + 80 両。霊体化触発を緩める",
    category: "shop",
    cost: 0,
    available: canPure,
    lockedReason: canPure
      ? undefined
      : `鬼の角 ≥1（現在 ${horns}）、両 ≥80（現在 ${ryoNow}）`,
  });
  const canOni = horns >= 1 && frags >= 1 && ryoNow >= 120;
  activities.push({
    id: "upgrade_oni",
    kind: "action",
    actionKind: "upgrade_oni",
    title: "炉で鬼の脈に鍛える（威力 +4、霊体化 +5、脈絡: 鬼 +1）",
    description: "鬼の角 ×1 + 呪われし刃の欠片 ×1 + 120 両。後戻りはきかぬ",
    category: "shop",
    cost: 0,
    available: canOni,
    lockedReason: canOni
      ? undefined
      : `鬼の角 ≥1（現在 ${horns}）、欠片 ≥1（現在 ${frags}）、両 ≥120（現在 ${ryoNow}）`,
  });

  // Rest (recover HP/mental)
  const hp = playerStat(ctx, "hp");
  const hpMax = playerStatMax(ctx, "hp");
  if (hp < hpMax) {
    activities.push({
      id: "rest",
      kind: "action",
      actionKind: "rest",
      title: "宿で休む（体力・精神を全回復）",
      description: "霊体化は変わらない",
      category: "rest",
      cost: 0,
      available: true,
    });
  }

  // 両国橋の情報屋 — four-tier infoshop actions, each gated on
  // intellect + ryo. Selling intel sets `intel_active` (string var)
  // to a level key, which onScriptSelect later uses to redirect the
  // generic `intel_briefing` script to one of four variants.
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  const intellect = playerStat(ctx, "intellect");
  const intelActive =
    typeof ctx.state.baseline.variables.intel_active === "string"
      ? (ctx.state.baseline.variables.intel_active as string)
      : "";
  const infoshopBands: Array<{
    id: string;
    title: string;
    desc: string;
    cost: number;
    intellectMin: number;
    requiresFrag: boolean;
  }> = [
    {
      id: "infoshop_basic",
      title: "情報屋：次回 raid のスポーン覚書（50 両）",
      desc: "次の出帰り先の鬼の出方を知る",
      cost: 50,
      intellectMin: 0,
      requiresFrag: false,
    },
    {
      id: "infoshop_loot",
      title: "情報屋：稀少な収穫地（100 両、学識 30+）",
      desc: "次の出帰り先の最良 loot zone を知る",
      cost: 100,
      intellectMin: 30,
      requiresFrag: false,
    },
    {
      id: "infoshop_yaodao",
      title: "情報屋：妖刀の声に耐える法（200 両、学識 50+）",
      desc: "霊体化触発率を永続 -10%",
      cost: 200,
      intellectMin: 50,
      requiresFrag: false,
    },
    {
      id: "infoshop_hidden",
      title: "情報屋：隠し zone の坐標（300 両、学識 80+、欠片 1）",
      desc: "宝峰山の隠し zone への足跡を知る",
      cost: 300,
      intellectMin: 80,
      requiresFrag: true,
    },
  ];
  // Only show infoshop band when player can afford the cheapest AND
  // hasn't already bought intel that's still unread.
  if (intelActive === "") {
    for (const band of infoshopBands) {
      const ok =
        ryo >= band.cost &&
        intellect >= band.intellectMin &&
        (!band.requiresFrag ||
          (ctx.state.baseline.inventory.cursed_blade_fragment ?? 0) >= 1);
      activities.push({
        id: band.id,
        kind: "action",
        actionKind: band.id,
        title: band.title,
        description: band.desc,
        category: "shop",
        cost: 0,
        available: ok,
        lockedReason: ok
          ? undefined
          : `両 ≥${band.cost}、学識 ≥${band.intellectMin}${band.requiresFrag ? "、呪われし刃の欠片 ≥1" : ""} が要る`,
      });
    }
  } else {
    // Pending intel — surface a "read it" script entry. The actual
    // script that runs is decided by onScriptSelect first-wins.
    activities.push({
      id: "script:intel_briefing",
      kind: "script",
      title: "情報屋の覚書を読む",
      category: "shop",
      cost: 0,
      available: true,
    });
  }

  // Use chinkonho (skill granted by篝 bond) — drops spectral by 20.
  // Only available in hub (combat is too tense per篝's teaching), and
  // only when player actually has the skill.
  if (ctx.state.baseline.knownSkills.includes("chinkonho")) {
    const spec = playerStat(ctx, "spectral");
    activities.push({
      id: "use_chinkonho",
      kind: "action",
      actionKind: "use_chinkonho",
      title: "鎮魂法を行う（霊体化 -20）",
      description: "篝伝授の口伝。集中して長く息を吐く",
      category: "spirit",
      cost: 0,
      available: spec >= 10,
      lockedReason: spec >= 10 ? undefined : "霊体化が低すぎて鎮める意味がない",
    });
  }

  // 同行者システム — invite a met character with affection >= 4.
  // Only one companion at a time. Flipping a companion_<id> switch
  // is what onChoicePresented / onBeatBefore key on; m.companion is
  // the runtime mirror.
  for (const charId of m.metCharacters) {
    const char = ctx.game.characters.find((c) => c.id === charId);
    if (!char) continue;
    const affection =
      ctx.state.baseline.characters[charId]?.stats.affection ?? 0;
    if (affection < 4) continue;
    const alreadyInvited = m.companion === charId;
    activities.push({
      id: `invite:${charId}`,
      kind: "action",
      actionKind: "invite",
      payload: { characterId: charId },
      title: alreadyInvited
        ? `${char.name}を同行から外す`
        : `${char.name}を次の出帰りに誘う`,
      description: alreadyInvited
        ? "同行を解く（次の出立では一人）"
        : "親密度 4 以上で同行可。他者を誘うと自動的に交代",
      category: "social",
      cost: 0,
      available: true,
    });
  }

  // Depart on raid — one entry per unlocked chain, sorted by difficulty.
  for (const { chain, entry } of discoverableChains(ctx)) {
    const hpFull = hp >= hpMax;
    const label = chainDisplayName(chain) ?? entry.name;
    activities.push({
      id: `depart:${chain}`,
      kind: "action",
      actionKind: "depart",
      payload: { chain },
      title: `出立 — ${label}（難度 ${entry.difficulty ?? 1}）`,
      description: entry.description,
      category: "raid",
      cost: 0,
      available: hpFull,
      lockedReason: hpFull ? undefined : "体力が満たぬ。先に休め。",
    });
  }

  return buildSnapshot(activities, ctx);
}

function buildRaidMenu(ctx: Ctx): Output {
  const m = moduleState(ctx);
  if (!m.raid) return buildHubMenu(ctx);

  const map = currentMap(ctx);
  if (!map) throw new Error(`${MODULE_ID}: currentMapId missing during raid`);
  const inst = currentMapInstance(ctx);
  if (!inst) throw new Error(`${MODULE_ID}: map instance missing for ${map.id}`);

  const activities: HubActivity[] = [];

  // 妖刀の業 — pulsePending takes over the menu after a victory.
  // Three exclusive imbue choices; each clears pulsePending.
  if (m.pulsePending) {
    const absorb = m.pulsePending.absorb;
    activities.push({
      id: "imbue:pure",
      kind: "action",
      actionKind: "imbue_pure",
      title: `浄の脈に流す（威力 +1、霊体化触発率 −0.2%）`,
      description: `「鎮魂」の脈絡。次の戦闘で霊体化暴走が起きにくくなる`,
      category: "spirit",
      cost: 0,
      available: true,
    });
    activities.push({
      id: "imbue:oni",
      kind: "action",
      actionKind: "imbue_oni",
      title: `鬼の脈に流す（威力 +${Math.max(3, Math.floor(absorb / 2))}、灵体化 +3）`,
      description: `「喰らう」の脈絡。刀が跳ね上がる代償に、お主の身体も鬼に近づく`,
      category: "spirit",
      cost: 0,
      available: true,
    });
    activities.push({
      id: "imbue:mundane",
      kind: "action",
      actionKind: "imbue_mundane",
      title: `凡の脈に流す（威力 +2、副作用なし）`,
      description: `「整える」の脈絡。穏当に育てる道`,
      category: "spirit",
      cost: 0,
      available: true,
    });
    return buildSnapshot(activities, ctx);
  }

  if (inst.encounter) {
    activities.push({
      id: "attack",
      kind: "action",
      actionKind: "attack",
      title: `斬る — ${enemyName(ctx, inst.encounter.enemyId)}（HP ${inst.encounter.enemyHp}/${inst.encounter.enemyHpMax}）`,
      description: "妖刀威力 × (1 + 霊体化×0.04) × ばらつき",
      category: "combat",
      cost: 0,
      available: true,
    });
    activities.push({
      id: "sneak_strike",
      kind: "action",
      actionKind: "sneak_strike",
      title: "不意打ちを狙う",
      description: "学識+霊体化判定。成功で大ダメージ、失敗で外す",
      category: "combat",
      cost: 0,
      available: true,
    });
    activities.push({
      id: "flee",
      kind: "action",
      actionKind: "flee",
      title: "逃げる",
      description: "霊体化判定。失敗で一発被弾",
      category: "combat",
      cost: 0,
      available: true,
    });
    if (inst.encounter.negotiable) {
      const cunning = enemyCunning(ctx, inst.encounter.enemyId);
      activities.push({
        id: "negotiate_listen",
        kind: "action",
        actionKind: "negotiate_listen",
        title: `聞き出す — ${enemyName(ctx, inst.encounter.enemyId)}`,
        description: `成功率 ${negotiateDropChance(cunning)}%（cunning ${cunning}）。失敗でも斬り直せる`,
        category: "combat",
        cost: 0,
        available: true,
      });
      activities.push({
        id: "negotiate_release",
        kind: "action",
        actionKind: "negotiate_release",
        title: `逃がす — ${enemyName(ctx, inst.encounter.enemyId)}`,
        description: "霊体化 -2、戦利品なし、その鬼種の zone_haunt 解錠",
        category: "combat",
        cost: 0,
        available: true,
      });
      const spec = playerStat(ctx, "spectral");
      const voiceAvailable = spec >= 50;
      activities.push({
        id: "yaodao_voice",
        kind: "action",
        actionKind: "yaodao_voice",
        title: voiceAvailable
          ? "妖刀の声に従う — 必殺の一閃（霊体化 +5、脈絡: 鬼 +1）"
          : "妖刀の声（霊体化が低くて聞こえない）",
        description: "4 倍の威力で必ず止め。脈絡選択は強制「鬼」",
        category: "combat",
        cost: 0,
        available: voiceAvailable,
        lockedReason: voiceAvailable
          ? undefined
          : `霊体化 ≥ 50 が要る（現在 ${spec}）`,
      });
    }
  } else {
    if (!inst.searched && Object.keys(inst.pendingLoot).length > 0) {
      activities.push({
        id: "search",
        kind: "action",
        actionKind: "search",
        title: "この区域を探る",
        category: "raid",
        cost: 0,
        available: true,
      });
    }
    if (map.isExtract) {
      activities.push({
        id: "extract",
        kind: "action",
        actionKind: "extract",
        title: `${map.name} から撤退して大名府に戻る`,
        description: "戦利品を蔵に納める",
        category: "raid",
        cost: 0,
        available: true,
      });
    }
    for (const conn of map.connections ?? []) {
      const targetMap = getMap(ctx, conn.target);
      const targetInst = m.raid.visited[conn.target];
      const visitedNote = targetInst?.visited ? "（既訪）" : "";
      const extractNote = targetMap?.isExtract ? "（撤退可）" : "";
      activities.push({
        id: `move:${conn.target}`,
        kind: "action",
        actionKind: "move",
        payload: { mapId: conn.target },
        title: `${conn.dir}へ進む — ${targetMap?.name ?? conn.target}${visitedNote}${extractNote}`,
        category: "raid",
        cost: 0,
        available: true,
      });
    }
  }

  return buildSnapshot(activities, ctx);
}

// ============================================================================
// Helpers
// ============================================================================

// "Loot" = any item whose .md frontmatter carries a numeric `sell_value`
// AND is not flagged `material: true`. Materials (oni_horn, soul_shard,
// cursed_blade_fragment) still have sell_value so they can be sold
// individually if a future action exposes them, but `sell_all_loot`
// skips them so a player who hits "sell" doesn't vend their upgrade
// stockpile.
function isLoot(ctx: Ctx, itemId: string): boolean {
  const item = ctx.game.items?.find((i) => i.id === itemId);
  if (item?.custom?.material === true) return false;
  return typeof sellValueOf(ctx, itemId) === "number";
}

function sellValue(ctx: Ctx, itemId: string): number {
  return sellValueOf(ctx, itemId) ?? 0;
}

function sellValueOf(ctx: Ctx, itemId: string): number | undefined {
  const item = ctx.game.items?.find((i) => i.id === itemId);
  const v = item?.custom?.sell_value;
  return typeof v === "number" ? v : undefined;
}

function itemName(ctx: Ctx, itemId: string): string {
  return ctx.game.items?.find((i) => i.id === itemId)?.name ?? itemId;
}

function enemyName(ctx: Ctx, enemyId: string): string {
  return ctx.game.enemies?.find((e) => e.id === enemyId)?.name ?? enemyId;
}

function enemyAttackPower(ctx: Ctx, enemyId: string): number {
  const e = ctx.game.enemies?.find((x) => x.id === enemyId);
  if (!e) return 1;
  const raw = e.custom?.attack_power;
  return typeof raw === "number" ? raw : 1;
}

function enemyHp(ctx: Ctx, enemyId: string): number {
  return ctx.game.enemies?.find((e) => e.id === enemyId)?.hp ?? 1;
}

// 鬼の交渉 — uses enemy.stats.cunning to modulate listen success.
function enemyCunning(ctx: Ctx, enemyId: string): number {
  const e = ctx.game.enemies?.find((x) => x.id === enemyId);
  return e?.stats?.cunning ?? 1;
}

function enemyNegotiateLore(ctx: Ctx, enemyId: string): string | undefined {
  const v = ctx.game.enemies?.find((x) => x.id === enemyId)?.custom?.negotiate_lore;
  return typeof v === "string" ? v : undefined;
}

function enemyNegotiateDrop(ctx: Ctx, enemyId: string): string | undefined {
  const v = ctx.game.enemies?.find((x) => x.id === enemyId)?.custom?.negotiate_drop;
  return typeof v === "string" ? v : undefined;
}

// Listen success chance: 60 - cunning*10, floored at 10%.
function negotiateDropChance(cunning: number): number {
  return Math.max(10, 60 - cunning * 10);
}

function getEnemyNarration(
  ctx: Ctx,
  enemyId: string,
  key: "intro" | "victory" | "escape",
): string | undefined {
  const e = ctx.game.enemies?.find((x) => x.id === enemyId);
  return e?.narrations?.[key];
}

function fillTemplate(tmpl: string, vars: Record<string, string | number>): string {
  let out = tmpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

function getSwordPower(ctx: Ctx): number {
  const id = ctx.state.baseline.equippedWeaponId;
  if (!id) return 1;
  return ctx.state.baseline.weapons[id]?.power ?? 1;
}

// ============================================================================
// Dispatcher guards (issues #10 + #11)
// ============================================================================
// Returns a denial message if the current zone has an active encounter,
// or null when it's safe to do non-combat actions. Centralized so all
// three callers (move/search/extract) use the same invariant.
function combatBlock(ctx: Ctx): string | null {
  if (!inRaid(ctx)) return null;
  const inst = currentMapInstance(ctx);
  if (inst?.encounter) {
    return `${enemyName(ctx, inst.encounter.enemyId)}に背を向けるわけにはいかぬ。斬るか、抜けるかだ。`;
  }
  return null;
}

// ============================================================================
// Raid lifecycle
// ============================================================================

// Begin a raid on a chain. Enters the chain's entry map (engine
// updates currentMapId + bg via enterMap), initializes RaidInstance,
// rolls the entry map's loot (encounter table on entry maps is always
// trivial — null-only — so no encounter to roll).
function startRaid(ctx: Ctx, chain: string): void {
  const entryId = CHAIN_ENTRY[chain];
  if (!entryId) throw new Error(`${MODULE_ID}: unknown chain ${chain}`);
  const entry = getMap(ctx, entryId);
  if (!entry) throw new Error(`${MODULE_ID}: chain ${chain} entry "${entryId}" missing`);
  const m = moduleState(ctx);

  enterMap(ctx.state, ctx.game, entryId);
  m.raid = {
    chain,
    entryMapId: entryId,
    visited: {},
    pendingLoot: {},
    turnsTaken: 0,
  };
  // Mark the entry map visited + roll its loot. Encounter stays null
  // (entry maps' encounter tables are null-only by convention).
  const spawnInst = ensureMapInstance(ctx, entryId);
  spawnInst.visited = true;
  spawnInst.pendingLoot = rollLoot(ctx, entry);

  const flavor =
    typeof entry.custom?.entry_narration === "string"
      ? (entry.custom.entry_narration as string)
      : "霧が脛に絡みつく。";
  // Chain display name: take any chain map's "name" as a label — they
  // all share the same chain identity, but the entry map's name is the
  // most evocative ("沼の縁" works for narration as well as "黒沼地" did
  // pre-migration). Fall back to chain id when truly degenerate.
  const chainLabel = chainDisplayName(chain) ?? entry.name;
  ctx.state.runtime.pendingNarrations.push(
    `${chainLabel}に踏み入る。${flavor}`,
  );
}

// Human-facing label for a chain. We don't have an explicit "chain
// name" field on MapDef (chain is just a grouping id); instead, every
// chain has a canonical display name kept here. Module-side because
// it's purely a presentation concern.
function chainDisplayName(chain: string): string | undefined {
  return {
    kuro_swamp: "黒沼地",
    mt_houkyou: "砲響山",
    sumida_river: "隅田河",
    hell_gate: "地獄門",
  }[chain];
}

function rollEncounter(
  ctx: Ctx,
  map: MapDef,
): null | { enemyId: string; enemyHp: number; enemyHpMax: number } {
  const table = map.encounterTable ?? [];
  if (table.length === 0) return null;
  const pick = pickWeighted(ctx.rng, table);
  if (pick.enemyId === null) return null;
  const hp = enemyHp(ctx, pick.enemyId);
  return { enemyId: pick.enemyId, enemyHp: hp, enemyHpMax: hp };
}

// Roll the current map's character spawns. Skips characters the player
// has already met (one-shot encounters by convention).
function rollCharacterSpawn(
  ctx: Ctx,
  map: MapDef,
): CharacterSpawnRule | null {
  if (!map.characterSpawns) return null;
  const m = moduleState(ctx);
  for (const rule of map.characterSpawns) {
    if (m.metCharacters.includes(rule.characterId)) continue;
    if (ctx.rng() <= rule.chance) return rule;
  }
  return null;
}

function rollLoot(ctx: Ctx, map: MapDef): Record<string, number> {
  const table = map.lootTable ?? [];
  if (table.length === 0) return {};
  const pick = pickWeighted(ctx.rng, table);
  if (pick.itemId === null) return {};
  const count = rollIntInclusive(ctx.rng, pick.min, pick.max);
  return { [pick.itemId]: count };
}

// Clear companion state on raid end. Switches stay set (player kept
// the bond between raids); only the runtime "in party right now" flag
// resets so the player has to re-invite each raid (otherwise the
// system feels less like a deliberate decision).
function clearCompanionAfterRaid(ctx: Ctx): void {
  const m = moduleState(ctx);
  if (!m.companion) return;
  ctx.state.baseline.switches[`companion_${m.companion}`] = false;
  m.companion = null;
  m.companionHp = 0;
}

function endRaidExtract(ctx: Ctx): void {
  const m = moduleState(ctx);
  if (!m.raid) return;
  // Transfer pendingLoot to baseline.inventory.
  const lootSummary: string[] = [];
  for (const [itemId, count] of Object.entries(m.raid.pendingLoot)) {
    if (count <= 0) continue;
    ctx.state.baseline.inventory[itemId] =
      (ctx.state.baseline.inventory[itemId] ?? 0) + count;
    lootSummary.push(`${itemName(ctx, itemId)} ×${count}`);
  }
  const chainLabel = chainDisplayName(m.raid.chain) ?? m.raid.chain;

  // If companion survived the raid (HP > 0), mark the persistent
  // "befriended" switch and grant +1 affection. This is the loop:
  // invite → survive together → unlock deeper bond scenes.
  if (m.companion && m.companionHp > 0) {
    const companionId = m.companion;
    ctx.state.baseline.switches[`befriended_${companionId}`] = true;
    const c = ctx.state.baseline.characters[companionId];
    if (c) c.stats.affection = (c.stats.affection ?? 0) + 1;
    const charName =
      ctx.game.characters.find((x) => x.id === companionId)?.name ?? companionId;
    ctx.state.runtime.pendingNarrations.push(
      `${charName}は無事に大名府まで歩いた。一度共に出帰った仲——刀を握る手の重さが、少し変わる。親密度 +1。`,
    );
  }

  m.raid = null;
  enterMap(ctx.state, ctx.game, "edo_castle");
  setVar(ctx, "raidsCompleted", getVar(ctx, "raidsCompleted") + 1);
  clearCompanionAfterRaid(ctx);

  ctx.state.runtime.pendingNarrations.push(
    `${chainLabel}から撤退に成功。${lootSummary.length > 0 ? "持ち帰った戦利品：" + lootSummary.join("、") + "。" : "今回は手ぶら。"}`,
  );

  // 脈絡の話 — defer pulse_intro to the back-in-hub transition rather
  // than firing it mid-raid via a trigger on pulse_<x> rising edge.
  // The intro's prose ("屋敷の縁側で…") assumes hub setting; firing
  // it inside startRaid-zone breaks immersion.
  if (
    ctx.state.baseline.switches.pulse_intro_seen !== true &&
    ((ctx.state.baseline.variables.pulse_pure ?? 0) as number) +
      ((ctx.state.baseline.variables.pulse_oni ?? 0) as number) +
      ((ctx.state.baseline.variables.pulse_mundane ?? 0) as number) >
      0 &&
    ctx.state.baseline.currentScriptId === null &&
    ctx.game.scripts.some((s) => s.id === "pulse_intro")
  ) {
    ctx.state.baseline.currentScriptId = "pulse_intro";
    ctx.state.baseline.beatIndex = 0;
  }
}

function endRaidFailure(ctx: Ctx, reason: string): void {
  const m = moduleState(ctx);
  if (!m.raid) return;
  const chainLabel = chainDisplayName(m.raid.chain) ?? m.raid.chain;
  m.raid = null;
  enterMap(ctx.state, ctx.game, "edo_castle");
  setVar(ctx, "raidsFailed", getVar(ctx, "raidsFailed") + 1);
  clearCompanionAfterRaid(ctx);
  // Reset HP/mental/spectral to defaults (death/overload triggered).
  // hp = 1 so player has to rest; mental partial; spectral cut.
  setPlayerStat(ctx, "hp", 1);
  setPlayerStat(ctx, "mental", Math.max(1, Math.floor(playerStatMax(ctx, "mental") / 2)));
  setPlayerStat(ctx, "spectral", Math.max(5, Math.floor(playerStat(ctx, "spectral") / 2)));
  ctx.state.runtime.pendingNarrations.push(
    `${chainLabel}での討伐は失敗——${reason}。戦利品は全て失われた。気がついたら大名府の御殿医の枕元。`,
  );
}

// Companion damage redirect — called from the enemy counter-attack
// in doAttackRound. If a companion is in party, the companion absorbs
// part of the damage (offers tactical value at risk of downing them).
//
// Returns the residual damage that should still hit the player.
function tryCompanionAbsorb(ctx: Ctx, raw: number): number {
  const m = moduleState(ctx);
  if (!m.companion || m.companionHp <= 0 || !m.raid) return raw;
  const absorbed = Math.min(m.companionHp, Math.ceil(raw / 2));
  m.companionHp -= absorbed;
  const charName =
    ctx.game.characters.find((c) => c.id === m.companion!)?.name ?? m.companion!;
  ctx.state.runtime.pendingNarrations.push(
    `${charName}が割って入った——${absorbed} のダメージを彼女が引き受けた。残り HP ${m.companionHp}/10。`,
  );

  // Downed?
  if (m.companionHp <= 0) {
    const downedName = charName;
    const charId = m.companion;
    m.companion = null;
    m.companionHp = 0;
    ctx.state.baseline.switches[`companion_${charId}`] = false;
    ctx.state.baseline.variables.companion_downed =
      (typeof ctx.state.baseline.variables.companion_downed === "number"
        ? ctx.state.baseline.variables.companion_downed
        : 0) + 1;
    // -3 affection. Engine clamps to character's min if declared.
    const c = ctx.state.baseline.characters[charId!];
    if (c) c.stats.affection = Math.max(0, (c.stats.affection ?? 0) - 3);
    ctx.state.runtime.pendingNarrations.push(
      `${downedName}は倒れた。意識はある——だが、もう刀は握れぬ。お主の中で何かが折れた。親密度 -3。`,
    );
  }
  return raw - absorbed;
}

// ============================================================================
// Combat
// ============================================================================

function doAttackRound(ctx: Ctx, kind: "normal" | "sneak"): void {
  const m = moduleState(ctx);
  if (!m.raid) return;
  const zone = currentMapInstance(ctx)!;
  if (!zone.encounter) return;

  const sword = getSwordPower(ctx);
  const spec = playerStat(ctx, "spectral");
  const intellect = playerStat(ctx, "intellect");

  // Player strikes first.
  let damage: number;
  let hitLine: string;
  if (kind === "sneak") {
    // Skill check: rng() * 100 < intellect*5 + spectral*0.5
    const dc = intellect * 5 + spec * 0.5;
    const roll = ctx.rng() * 100;
    if (roll < dc) {
      damage = Math.floor(sword * (1 + spec * 0.04) * 2.2 * (0.9 + ctx.rng() * 0.2));
      hitLine = `不意打ちが入った。柄を掴み直す間もなく一刀で割く——${damage} のダメージ。`;
    } else {
      damage = 0;
      hitLine = `間合いを誤った——一閃外す。`;
    }
  } else {
    const variance = 0.8 + ctx.rng() * 0.4;
    const critRoll = ctx.rng() * 100;
    const isCrit = critRoll < spec * 0.7;
    damage = Math.floor(sword * (1 + spec * 0.04) * variance * (isCrit ? 2 : 1));
    hitLine = isCrit
      ? `妖刀が震えた。倍の威力で斬り抜く——${damage} のダメージ。`
      : `刀を振るう。${damage} のダメージ。`;
  }

  ctx.state.runtime.pendingNarrations.push(hitLine);
  zone.encounter.enemyHp -= damage;

  // Spectral creep from striking
  setPlayerStat(ctx, "spectral", Math.min(100, spec + 1));

  // 鬼の交渉: when an enemy drops below 30% HP, the next raid menu
  // gains 3 conditional activities (listen / release / yaodao-voice).
  // This flag lives on the encounter object so it auto-clears when
  // the encounter resolves (victory / flee / release).
  if (
    zone.encounter.enemyHp > 0 &&
    zone.encounter.enemyHp < zone.encounter.enemyHpMax * 0.3
  ) {
    zone.encounter.negotiable = true;
    ctx.state.runtime.pendingNarrations.push(
      `${enemyName(ctx, zone.encounter.enemyId)}の構えが崩れた——息は荒く、まだ斬れる。だが、聞き出すことも、放すこともできる。`,
    );
  }

  if (zone.encounter.enemyHp <= 0) {
    // Victory — spectral drops by absorb, but weapon power gain is
    // DEFERRED. The module queues pulsePending; next buildRaidMenu
    // shows only three imbue activities (浄/鬼/凡), and the chosen
    // one applies its specific power formula + counter increment.
    // This forces a build-path decision on every kill.
    const enemyId = zone.encounter.enemyId;
    const hpMax = zone.encounter.enemyHpMax;
    const absorb = Math.floor(hpMax / 2);
    const tmpl = getEnemyNarration(ctx, enemyId, "victory");
    if (tmpl) {
      ctx.state.runtime.pendingNarrations.push(
        fillTemplate(tmpl, {
          name: enemyName(ctx, enemyId),
          hp: hpMax,
          absorb,
          swordGain: 0, // placeholder; actual gain decided by imbue choice
          damage,
        }),
      );
    }
    setPlayerStat(ctx, "spectral", Math.max(0, playerStat(ctx, "spectral") - absorb));
    zone.encounter = null;
    zone.encounterCleared = true;
    // Queue the imbue choice. yaodao_voice already handled this
    // inline (forced oni path); normal victories go through the menu.
    moduleState(ctx).pulsePending = { enemyId, absorb };
    ctx.state.runtime.pendingNarrations.push(
      `刀が震えている——${enemyName(ctx, enemyId)}の妖力を、どの脈に流すか。`,
    );
    return;
  }

  // Enemy counter-attacks
  const enemyPow = enemyAttackPower(ctx, zone.encounter.enemyId);
  const enemyHit = Math.max(
    1,
    Math.floor(enemyPow * (0.8 + ctx.rng() * 0.4)),
  );
  const fumbleRoll = ctx.rng() * 100;
  const isFumble = fumbleRoll < spec * 0.5;
  // High spectral makes the player less coordinated defending.

  const finalEnemyDamage = isFumble ? Math.floor(enemyHit * 1.6) : enemyHit;
  // 同行者が割って入るかチェック。Companion soaks half (rounded up),
  // remainder hits player. Companion HP=0 → downed (handled inside).
  const residual = tryCompanionAbsorb(ctx, finalEnemyDamage);
  setPlayerStat(ctx, "hp", playerStat(ctx, "hp") - residual);
  ctx.state.runtime.pendingNarrations.push(
    isFumble
      ? `${enemyName(ctx, zone.encounter.enemyId)}の反撃。霊体化が暴れて体が思うように動かず——${residual} のダメージ。`
      : `${enemyName(ctx, zone.encounter.enemyId)}の反撃。${residual} のダメージ。`,
  );
  setPlayerStat(ctx, "mental", Math.max(0, playerStat(ctx, "mental") - 1));
}

function doFlee(ctx: Ctx): void {
  const m = moduleState(ctx);
  if (!m.raid) return;
  const zone = currentMapInstance(ctx)!;
  if (!zone.encounter) return;
  const enemyId = zone.encounter.enemyId;

  const m2 = moduleState(ctx);

  // Hayagake (taught by 霞) OR 霞 currently in party — flee always
  // succeeds with no damage/no mental cost.
  if (
    ctx.state.baseline.knownSkills.includes("hayagake") ||
    m2.companion === "kasumi"
  ) {
    const reason = m2.companion === "kasumi" ? "霞の手が手首を取った" : "霞に教わった足運び";
    ctx.state.runtime.pendingNarrations.push(
      `${reason}——${enemyName(ctx, enemyId)}が振り向く半秒前に、お主はもう間合いの外。`,
    );
    zone.encounter = null;
    zone.encounterCleared = true;
    return;
  }

  const spec = playerStat(ctx, "spectral");
  const dc = 30 + spec; // higher spec = harder (you're slow)
  const roll = ctx.rng() * 100;
  if (roll > dc - 10) {
    ctx.state.runtime.pendingNarrations.push(
      `${enemyName(ctx, enemyId)}の隙を縫って退いた。`,
    );
    zone.encounter = null;
    zone.encounterCleared = true;
    setPlayerStat(ctx, "mental", Math.max(0, playerStat(ctx, "mental") - 1));
  } else {
    const dmg = Math.max(2, enemyAttackPower(ctx, enemyId) + 1);
    setPlayerStat(ctx, "hp", playerStat(ctx, "hp") - dmg);
    ctx.state.runtime.pendingNarrations.push(
      `背を見せた瞬間、${enemyName(ctx, enemyId)}に追いつかれた——${dmg} のダメージ。`,
    );
  }
}

// ============================================================================
// Action handlers — declared on the module's actionHandlers map below.
// Engine routes Input.doActivity through actionHandlerRegistry; each
// handler returns ActionResult { narrations? }. Module-private mutations
// (zone state, m.raid sub-state, m.metCharacters) stay in-place because
// they live on the module's own state slice that the engine doesn't
// model in StateDelta. After each handler the engine calls checkTriggers
// unconditionally (engine/src/primitives/applyActionResult.ts) so the
// HP=0 / spectral=100 triggers still fire even when mutations bypass
// StateDelta.
//
// Narrations are returned in the ActionResult so the engine queues
// them through pendingNarrations. The `denial` helper builds an
// ActionResult that carries just the rejection message.
// ============================================================================

function denial(message: string): ActionResult {
  return { narrations: [message] };
}

const departHandler: ActionHandler = (ctx) => {
  const chain = ctx.action.payload?.chain as string | undefined;
  if (!chain) return denial(`出立先が指定されていない。`);
  if (playerStat(ctx, "hp") < playerStatMax(ctx, "hp")) {
    return denial("体力が満たぬ。先に宿で休め。");
  }
  if (!CHAIN_ENTRY[chain]) {
    return denial(`その地は地図にない（${chain}）。`);
  }
  if (!chainUnlocked(ctx, chain)) {
    return denial(`まだ${chainDisplayName(chain) ?? chain}には踏み入れない。`);
  }
  startRaid(ctx, chain);
  return {};
};

const bondHandler: ActionHandler = (ctx) => {
  const charId = ctx.action.payload?.characterId as string | undefined;
  if (!charId) return denial("贈る相手が指定されていない。");
  const m = moduleState(ctx);
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  if (ryo < 50) return denial(`両が足りない。あと ${50 - ryo} 両要る。`);
  if (!m.metCharacters.includes(charId)) {
    return denial("まだ会ったことのない相手だ。");
  }
  const charName =
    ctx.game.characters.find((x) => x.id === charId)?.name ?? charId;
  return {
    deltas: {
      inventory: { ryo: -50 },
      characterStats: { [charId]: { affection: 1 } },
    },
    narrations: [
      `${charName}に贈り物を渡した。受け取り際の目が、いつもより少しだけ柔らかい。`,
    ],
  };
};

const sellAllLootHandler: ActionHandler = (ctx) => {
  const sellable = Object.entries(ctx.state.baseline.inventory).filter(
    ([id, n]) => n > 0 && isLoot(ctx, id),
  );
  if (sellable.length === 0) return denial("売れる戦利品が手元にない。");

  let total = 0;
  const lines: string[] = [];
  const inventoryDelta: Record<string, number> = {};
  for (const [itemId, count] of sellable) {
    const val = sellValue(ctx, itemId) * count;
    total += val;
    lines.push(`${itemName(ctx, itemId)} ×${count} → ${val}両`);
    inventoryDelta[itemId] = -count;
  }
  inventoryDelta.ryo = (inventoryDelta.ryo ?? 0) + total;
  return {
    deltas: { inventory: inventoryDelta },
    narrations: [`炼器師に納めた：${lines.join("、")}。合計 ${total} 両。`],
  };
};

// 妖刀の業 — three upgrade paths replace the single upgrade_weapon
// action. Each consumes different resources and feeds a different pulse
// counter, so the player's hub spending is the second axis of build
// decisions (the first being which pulse to imbue after each victory).
const upgradeMundaneHandler: ActionHandler = (ctx) => {
  const shards = ctx.state.baseline.inventory.soul_shard ?? 0;
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  if (shards < 3) {
    return denial(`炼器師「魂石碎片が足りない。あと ${3 - shards} 枚要る。」`);
  }
  if (ryo < 100) {
    return denial(`炼器師「持ち合わせが ${ryo} 両か。あと ${100 - ryo} 両要る。」`);
  }
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    inventory: { soul_shard: -3, ryo: -100 },
    variables: { pulse_mundane: 1 },
  };
  if (wid) deltas.weapons = { [wid]: { power: 2 } };
  return {
    deltas,
    narrations: [
      `炼器師は無言で碎片を炉に投じた。一夜明け、妖刀の刃に新しい紋様が浮いている——威力 +2、脈絡: 凡 +1。`,
    ],
  };
};

const upgradePureHandler: ActionHandler = (ctx) => {
  const horns = ctx.state.baseline.inventory.oni_horn ?? 0;
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  if (horns < 1) {
    return denial(`神主「鬼の角が要る。鎮魂の儀には必須」`);
  }
  if (ryo < 80) {
    return denial(`神主「奉納が ${ryo} 両か。80 両要る」`);
  }
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    inventory: { oni_horn: -1, ryo: -80 },
    variables: { pulse_pure: 1 },
  };
  if (wid) deltas.weapons = { [wid]: { power: 1 } };
  return {
    deltas,
    narrations: [
      `神社の祭壇で鎮魂の儀が行われる。鬼の角が浄火に灼かれ、刀の鞘が一瞬白く光る——威力 +1、脈絡: 浄 +1。`,
    ],
  };
};

const upgradeOniHandler: ActionHandler = (ctx) => {
  const horns = ctx.state.baseline.inventory.oni_horn ?? 0;
  const frags = ctx.state.baseline.inventory.cursed_blade_fragment ?? 0;
  const ryo = ctx.state.baseline.inventory.ryo ?? 0;
  if (horns < 1 || frags < 1) {
    return denial(
      `炼器師「鬼の角 1 + 呪われし刃の欠片 1 が要る。短期的に強くなる代わり、後戻りはできぬ」`,
    );
  }
  if (ryo < 120) {
    return denial(`炼器師「持ち合わせが ${ryo} 両か。120 両要る」`);
  }
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    inventory: { oni_horn: -1, cursed_blade_fragment: -1, ryo: -120 },
    variables: { pulse_oni: 1 },
    characterStats: { player: { spectral: 5 } },
  };
  if (wid) deltas.weapons = { [wid]: { power: 4 } };
  return {
    deltas,
    narrations: [
      `炼器師は炉に欠片を投じた。炎が黒く立ち上り、刀の刃に鬼の歯のような連紋が浮く——威力 +4、霊体化 +5、脈絡: 鬼 +1。`,
    ],
  };
};

// Pulse imbue handlers — invoked from buildRaidMenu after a victory.
// Each clears pulsePending, increments its pulse counter, and bumps
// weapon power on its own curve. The pulse_pure has a side effect of
// reducing future spectral creep; that's encoded by simply granting
// spectral -1 immediately as a small "rebate".
const imbueRequires = (ctx: ActionContext): string | null => {
  const m = moduleState(ctx);
  if (!m.pulsePending) return "脈絡選択の機会は今ない。";
  return null;
};

const imbuePureHandler: ActionHandler = (ctx) => {
  const blocker = imbueRequires(ctx);
  if (blocker) return denial(blocker);
  const m = moduleState(ctx);
  m.pulsePending = null;
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    variables: { pulse_pure: 1 },
    characterStats: { player: { spectral: -1 } },
  };
  if (wid) deltas.weapons = { [wid]: { power: 1 } };
  return {
    deltas,
    narrations: [
      `妖力が刀の中で透き通っていく——浄の脈に通った。威力 +1、霊体化 -1、脈絡: 浄 +1。`,
    ],
  };
};

const imbueOniHandler: ActionHandler = (ctx) => {
  const blocker = imbueRequires(ctx);
  if (blocker) return denial(blocker);
  const m = moduleState(ctx);
  const absorb = m.pulsePending!.absorb;
  m.pulsePending = null;
  const gain = Math.max(3, Math.floor(absorb / 2));
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    variables: { pulse_oni: 1 },
    characterStats: { player: { spectral: 3 } },
  };
  if (wid) deltas.weapons = { [wid]: { power: gain } };
  return {
    deltas,
    narrations: [
      `刀が悦んだ。鬼の脈に妖力が押し込められる——威力 +${gain}、霊体化 +3、脈絡: 鬼 +1。`,
    ],
  };
};

// 情報屋 handlers — each sets intel_active to a level key (string var)
// and increments intel_count. The actual briefing text is delivered
// via the corresponding intel_briefing_<level> script, which the
// player picks via the unified `script:intel_briefing` activity that
// onScriptSelect rewrites.
function infoshopHandler(
  level: "basic" | "loot" | "yaodao" | "hidden",
  cost: number,
  intellectMin: number,
  requiresFrag: boolean,
): ActionHandler {
  return (ctx) => {
    const ryo = ctx.state.baseline.inventory.ryo ?? 0;
    const intellect = playerStat(ctx, "intellect");
    if (ryo < cost) return denial(`情報屋「${cost} 両足りない」`);
    if (intellect < intellectMin) {
      return denial(`情報屋「お主の学識ではこの情報は活かせまい。学識 ${intellectMin} が要る」`);
    }
    if (requiresFrag) {
      const frags = ctx.state.baseline.inventory.cursed_blade_fragment ?? 0;
      if (frags < 1) {
        return denial(`情報屋「呪われし刃の欠片を寄越せ。それで奥の話が出来る」`);
      }
    }
    const intelActive =
      typeof ctx.state.baseline.variables.intel_active === "string"
        ? (ctx.state.baseline.variables.intel_active as string)
        : "";
    if (intelActive !== "") {
      return denial("先の覚書をまだ読んでいない。先に読め。");
    }
    const deltas: StateDelta = {
      inventory: { ryo: -cost },
      variables: { intel_active: level, intel_count: 1 },
    };
    if (requiresFrag) {
      deltas.inventory!.cursed_blade_fragment = -1;
    }
    return {
      deltas,
      narrations: [
        `情報屋は折り紙を差し出した。「読みなさい——大名府に戻ったら、すぐに」`,
      ],
    };
  };
}

const imbueMundaneHandler: ActionHandler = (ctx) => {
  const blocker = imbueRequires(ctx);
  if (blocker) return denial(blocker);
  const m = moduleState(ctx);
  m.pulsePending = null;
  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    variables: { pulse_mundane: 1 },
  };
  if (wid) deltas.weapons = { [wid]: { power: 2 } };
  return {
    deltas,
    narrations: [
      `妖力は穏やかに刀身に馴染んだ——威力 +2、脈絡: 凡 +1。`,
    ],
  };
};

const restHandler: ActionHandler = (ctx) => {
  const hp = playerStat(ctx, "hp");
  const hpMax = playerStatMax(ctx, "hp");
  if (hp >= hpMax) {
    return denial("もう休む必要はない。体力は満たされている。");
  }
  return {
    deltas: {
      characterStats: {
        player: {
          hp: hpMax - hp,
          mental: playerStatMax(ctx, "mental") - playerStat(ctx, "mental"),
        },
      },
    },
    narrations: [
      `宿で一晩明かす。体力と精神を回復した。霊体化は鎮まらないが、刀は静かに鞘に収まっている。`,
    ],
  };
};

const useChinkonhoHandler: ActionHandler = (ctx) => {
  if (!ctx.state.baseline.knownSkills.includes("chinkonho")) {
    return denial("鎮魂法はまだ伝授されていない。");
  }
  const spec = playerStat(ctx, "spectral");
  if (spec < 10) {
    return denial("霊体化がまだ低い。今鎮める意味はない。");
  }
  return {
    deltas: {
      characterStats: { player: { spectral: -Math.min(20, spec) } },
    },
    narrations: [
      `刀を逆手に取り、心臓の真上に当てる。長く、一度息を吐く。胸の奥でうねっていたものが、二十、押し戻された。`,
    ],
  };
};

// 澪同行者 passive — 水鏡: standing in one zone she reads the water /
// blade-sheen and scouts whichever enemy waits in each connected,
// not-yet-entered zone. We roll + persist those encounters now (the
// MapInstance.encounterRolled guard keeps the preview truthful — the
// real arrival won't re-roll). Pushes a narration; returns nothing.
function mioScry(ctx: Ctx, fromMap: MapDef): void {
  const seen: string[] = [];
  for (const conn of fromMap.connections ?? []) {
    const nextMap = getMap(ctx, conn.target);
    if (!nextMap) continue;
    const inst = ensureMapInstance(ctx, conn.target);
    if (inst.visited) continue; // already walked — nothing to foretell
    if (!inst.encounterRolled) {
      inst.encounter = rollEncounter(ctx, nextMap);
      inst.encounterRolled = true;
    }
    seen.push(
      inst.encounter
        ? `${nextMap.name}に${enemyName(ctx, inst.encounter.enemyId)}が一匹`
        : `${nextMap.name}は澄んでいる`,
    );
  }
  if (seen.length > 0) {
    ctx.state.runtime.pendingNarrations.push(
      `澪が刀身を水平にし、流れに映す。「水鏡に問う——」${seen.join("、")}。`,
    );
  }
}

// 同行道中の一幕 — on reaching a quiet (no-encounter) new zone with a
// companion in party, play that companion's next unseen "on the road"
// scene. Two tiers, in order:
//   road_<id>    — first time out together (gate: !road_<id>_seen)
//   road_<id>_2  — deeper, after surviving a raid together
//                  (gate: befriended_<id> && !road_<id>_2_seen)
// Each scene's own effects block sets its `_seen` switch + grants
// affection, so neither re-fires. Returns true if a scene was launched
// (caller returns early, same contract as the character_spawns path).
function maybeLaunchRoadScene(ctx: Ctx): boolean {
  const m = moduleState(ctx);
  if (!m.companion) return false;
  const id = m.companion;
  const sw = ctx.state.baseline.switches;
  const launch = (scriptId: string): boolean => {
    if (!ctx.game.scripts.some((s) => s.id === scriptId)) return false;
    ctx.state.baseline.currentScriptId = scriptId;
    ctx.state.baseline.beatIndex = 0;
    return true;
  };
  if (sw[`road_${id}_seen`] !== true) return launch(`road_${id}`);
  if (sw[`befriended_${id}`] === true && sw[`road_${id}_2_seen`] !== true) {
    return launch(`road_${id}_2`);
  }
  return false;
}

const moveHandler: ActionHandler = (ctx) => {
  const blocker = combatBlock(ctx);
  if (blocker) return denial(blocker);
  const target = ctx.action.payload?.mapId as string | undefined;
  if (!target) return denial("行き先が指定されていない。");

  const m = moduleState(ctx);
  if (!m.raid) return {};
  const cur = currentMap(ctx);
  if (!cur) return denial("現在地が不明だ。");
  const conn = (cur.connections ?? []).find((c) => c.target === target);
  if (!conn) return denial(`${cur.name}からそちらへ通じる道はない。`);

  // enterMap writes currentMapId + visuals.bg; we layer raid-specific
  // side effects (turn count, companion passives, encounter roll) on
  // top. The engine doesn't model raid-instance state in StateDelta —
  // these writes live in the module's own slice.
  enterMap(ctx.state, ctx.game, target);
  m.raid.turnsTaken += 1;
  const targetMap = currentMap(ctx)!;

  // 篝同行者 passive: each new zone, spectral -1.
  if (m.companion === "kagari") {
    const spec = playerStat(ctx, "spectral");
    if (spec > 0) {
      setPlayerStat(ctx, "spectral", Math.max(0, spec - 1));
      ctx.state.runtime.pendingNarrations.push(
        `篝が刀を握り直す。歩を合わせるたび、胸の奥のものが一寸だけ静かになる——霊体化 -1。`,
      );
    }
  }

  const inst = ensureMapInstance(ctx, target);
  if (inst.visited) {
    return { narrations: [`${targetMap.name}に戻る。一度通った道。`] };
  }
  inst.visited = true;
  inst.pendingLoot = rollLoot(ctx, targetMap);
  // 澪's 水鏡 scry may already have rolled this zone's encounter from a
  // neighbouring zone — honour that roll so the scouted enemy is what
  // actually appears (see MapInstance.encounterRolled).
  if (!inst.encounterRolled) {
    inst.encounter = rollEncounter(ctx, targetMap);
    inst.encounterRolled = true;
  }

  // Character spawn check. If a rule fires, launch the encounter
  // script instead of narrating map entry.
  const spawnedChar = rollCharacterSpawn(ctx, targetMap);
  if (spawnedChar) {
    m.metCharacters.push(spawnedChar.characterId);
    ctx.state.baseline.currentScriptId = spawnedChar.encounterScriptId;
    ctx.state.baseline.beatIndex = 0;
    return {};
  }

  // 澪同行者 passive: scout the connected zones ahead (pushes narration).
  if (m.companion === "mio") mioScry(ctx, targetMap);

  if (inst.encounter) {
    const intro = getEnemyNarration(ctx, inst.encounter.enemyId, "intro");
    if (intro) {
      return {
        narrations: [
          fillTemplate(intro, {
            name: enemyName(ctx, inst.encounter.enemyId),
            hp: inst.encounter.enemyHpMax,
          }),
        ],
      };
    }
    return {};
  }

  // Quiet zone — chance for a one-time 同行 road scene before the player
  // moves on. Launching a script returns early (same as character_spawns).
  if (maybeLaunchRoadScene(ctx)) return {};

  return { narrations: [`${targetMap.name}に出る。静かだ。`] };
};

const searchHandler: ActionHandler = (ctx) => {
  const blocker = combatBlock(ctx);
  if (blocker) return denial(blocker);
  const m = moduleState(ctx);
  if (!m.raid) return {};
  const map = currentMap(ctx);
  if (!map) return {};
  const inst = currentMapInstance(ctx)!;
  if (inst.searched) return denial(`${map.name}はもう探った。`);

  inst.searched = true;
  const lines: string[] = [];
  for (const [itemId, count] of Object.entries(inst.pendingLoot)) {
    if (count <= 0) continue;
    m.raid.pendingLoot[itemId] = (m.raid.pendingLoot[itemId] ?? 0) + count;
    lines.push(`${itemName(ctx, itemId)} ×${count}`);
  }
  return {
    narrations: [
      lines.length > 0
        ? `${map.name}を探った。見つけたもの：${lines.join("、")}。`
        : `${map.name}は何もなかった。`,
    ],
  };
};

const attackHandler: ActionHandler = (ctx) => {
  doAttackRound(ctx, "normal");
  return {};
};

const sneakStrikeHandler: ActionHandler = (ctx) => {
  doAttackRound(ctx, "sneak");
  return {};
};

const fleeHandler: ActionHandler = (ctx) => {
  doFlee(ctx);
  return {};
};

// 鬼の交渉 — three branches, all only valid when the encounter is
// marked negotiable (HP < 30%). Module guards check this; if the
// encounter isn't negotiable the handler returns a denial.

const negotiateListenHandler: ActionHandler = (ctx) => {
  const m = moduleState(ctx);
  if (!m.raid) return denial("交渉できる相手がいない。");
  const zone = currentMapInstance(ctx);
  if (!zone?.encounter?.negotiable) {
    return denial("まだ斬れるうちに聞き出すには弱らせろ。");
  }
  const enemyId = zone.encounter.enemyId;
  const cunning = enemyCunning(ctx, enemyId);
  const lore = enemyNegotiateLore(ctx, enemyId);
  const dropId = enemyNegotiateDrop(ctx, enemyId);
  const chance = negotiateDropChance(cunning);
  const success = ctx.rng() * 100 < chance;

  const narrations: string[] = [];
  if (lore) narrations.push(lore);

  const deltas: StateDelta = {};
  if (success && dropId) {
    deltas.inventory = { [dropId]: 1 };
    narrations.push(
      `${enemyName(ctx, enemyId)}は最後に何かを差し出して、霧に溶けた——${itemName(ctx, dropId)} ×1。`,
    );
  } else {
    narrations.push(
      `${enemyName(ctx, enemyId)}の声は途切れた。差し出されたものは何もない。`,
    );
  }

  // Listening "consumes" the negotiation moment; encounter still alive
  // but no longer negotiable — player must commit (attack / flee).
  zone.encounter.negotiable = false;
  return { deltas, narrations };
};

const negotiateReleaseHandler: ActionHandler = (ctx) => {
  const m = moduleState(ctx);
  if (!m.raid) return denial("放す相手がいない。");
  const zone = currentMapInstance(ctx);
  if (!zone?.encounter?.negotiable) {
    return denial("斬れる距離まで弱らせろ。");
  }
  const enemyId = zone.encounter.enemyId;
  const enemyTitle = enemyName(ctx, enemyId);

  zone.encounter = null;
  zone.encounterCleared = true;

  // selfSwitch A on the zone_haunt_<enemy> script: persists across
  // raids, unlocks the haunt lore script in hub. This is what makes
  // selfSwitch meaningful — a one-time, script-scoped permanent flag
  // that's neither a global switch nor a variable.
  return {
    deltas: {
      characterStats: { player: { spectral: -2 } },
      selfSwitches: {
        [`zone_haunt_${enemyId}`]: { A: true },
      },
    },
    narrations: [
      `お主は刀を引いた。${enemyTitle}は霧に滲んでいく——その目に、礼に似たものが浮かんだ気がした。霊体化 -2。`,
    ],
  };
};

const yaodaoVoiceHandler: ActionHandler = (ctx) => {
  const m = moduleState(ctx);
  if (!m.raid) return denial("ここでは聞こえぬ声だ。");
  const zone = currentMapInstance(ctx);
  if (!zone?.encounter?.negotiable) {
    return denial("妖刀が応える気配は無い——まだ早い。");
  }
  if (playerStat(ctx, "spectral") < 50) {
    return denial("霊体化が低くて、刀の声が聞こえない。");
  }
  const enemyId = zone.encounter.enemyId;
  const hpMax = zone.encounter.enemyHpMax;
  const swordGain = Math.max(2, Math.floor(hpMax / 2));

  // Finisher: no need to compute damage, the encounter is forced over.
  zone.encounter = null;
  zone.encounterCleared = true;

  const wid = ctx.state.baseline.equippedWeaponId;
  const deltas: StateDelta = {
    characterStats: { player: { spectral: 5 } },
    variables: { pulse_oni: 1 },
  };
  if (wid) deltas.weapons = { [wid]: { power: swordGain } };

  return {
    deltas,
    narrations: [
      `刀が鳴いた。胸の奥のものが舌を出した——${enemyName(ctx, enemyId)}は、一閃で四つに別れた。霊体化 +5、妖刀威力 +${swordGain}、脈絡: 鬼 +1。`,
    ],
  };
};

const extractHandler: ActionHandler = (ctx) => {
  const blocker = combatBlock(ctx);
  if (blocker) return denial(blocker);
  const m = moduleState(ctx);
  if (!m.raid) return {};
  const map = currentMap(ctx);
  if (!map) return {};
  if (!map.isExtract) {
    return denial(`${map.name}は撤退点ではない。社か杜まで戻れ。`);
  }
  endRaidExtract(ctx);
  return {};
};

// 同行者 invite/uninvite handler. Toggles companion + the public
// `companion_<id>` switch (hooks key off the switch since switches are
// in the engine-modeled state, not module-private).
const inviteHandler: ActionHandler = (ctx) => {
  const charId = ctx.action.payload?.characterId as string | undefined;
  if (!charId) return denial("誰を誘うか指定されていない。");
  const m = moduleState(ctx);
  if (!m.metCharacters.includes(charId)) {
    return denial("会ったことのない相手は誘えない。");
  }
  if (m.raid !== null) {
    return denial("出立後は誘えない。大名府に戻ってから。");
  }
  const affection =
    ctx.state.baseline.characters[charId]?.stats.affection ?? 0;
  if (affection < 4 && m.companion !== charId) {
    return denial("まだ同行を頼める仲ではない（親密度 4 が要る）。");
  }
  const charName =
    ctx.game.characters.find((c) => c.id === charId)?.name ?? charId;

  // Toggle off if already invited.
  if (m.companion === charId) {
    m.companion = null;
    m.companionHp = 0;
    return {
      deltas: { switches: { [`companion_${charId}`]: false } },
      narrations: [`${charName}に同行を解いた旨を伝えた。`],
    };
  }

  // Replace any prior companion, flip switches accordingly.
  const switches: Record<string, boolean> = {
    [`companion_${charId}`]: true,
  };
  if (m.companion) {
    switches[`companion_${m.companion}`] = false;
  }
  m.companion = charId;
  m.companionHp = 10;
  return {
    deltas: { switches },
    narrations: [
      `${charName}は頷いた。「次の出帰り、隣で歩く。」`,
    ],
  };
};

// ============================================================================
// Triggers: HP <= 0 or spectral >= 100 during a raid → failure
// ============================================================================

// Queue a letter script — but only when we're safely in the hub between
// scripts. If the player is mid-script (very rare; only if a trigger
// somehow fires during a script's effects block), the chapter advance
// still happens via the delta below, and onHubBuild can show a "未読の
// 文" hint until the next hub cycle. The next time `currentScriptId`
// becomes null in the run loop, the letter will queue.
function queueLetterIfHub(ctx: PresetContext, scriptId: string): void {
  if (ctx.state.baseline.currentScriptId === null) {
    ctx.state.baseline.currentScriptId = scriptId;
    ctx.state.baseline.beatIndex = 0;
  }
}

const triggers: Trigger[] = [
  {
    id: "raid_death_hp",
    when: { characterStat: { character: "player", name: "hp", max: 0 } },
    do: (ctx) => {
      const m = moduleState(ctx);
      if (m.raid !== null) {
        endRaidFailure(ctx, "体力が尽きた");
      }
      return {};
    },
  },
  {
    id: "raid_death_spectral",
    when: { characterStat: { character: "player", name: "spectral", min: 100 } },
    do: (ctx) => {
      const m = moduleState(ctx);
      if (m.raid !== null) {
        endRaidFailure(ctx, "霊体化が振り切れた");
      }
      return {};
    },
  },
  // ============== 主線：将軍家からの密書 milestones ==============
  // Each letter fires once per session (`once: true`); the engine
  // tracks fired ids in state.runtime.firedTriggers.
  //
  // Composite `when:` shows off how trigger conditions can mix:
  // - letter_02 requires both a raid count AND a spectral ceiling
  //   (player must be visibly *not* drowning before the inspector
  //   shows up — narrative beat, not just a counter).
  // - letter_03 chains on shogun_chapter, so the trigger order is
  //   guaranteed even if raidsCompleted accidentally jumps.
  {
    id: "letter_01_dispatch",
    once: true,
    when: { variable: { name: "raidsCompleted", min: 3 } },
    do: (ctx) => {
      queueLetterIfHub(ctx, "letter_01_suspicion");
      return {
        deltas: { variables: { shogun_chapter: 1 } },
      };
    },
  },
  {
    id: "letter_02_dispatch",
    once: true,
    when: {
      all: [
        { variable: { name: "shogun_chapter", min: 1 } },
        { variable: { name: "raidsCompleted", min: 7 } },
        { characterStat: { character: "player", name: "spectral", max: 49 } },
      ],
    },
    do: (ctx) => {
      queueLetterIfHub(ctx, "letter_02_rival");
      return {
        deltas: { variables: { shogun_chapter: 1 } },
      };
    },
  },
  {
    id: "letter_03_dispatch",
    once: true,
    when: {
      all: [
        { variable: { name: "shogun_chapter", min: 2 } },
        { variable: { name: "raidsCompleted", min: 12 } },
      ],
    },
    do: (ctx) => {
      queueLetterIfHub(ctx, "letter_03_choice");
      return {
        deltas: { variables: { shogun_chapter: 1 } },
      };
    },
  },
  // 三花の盟 — once-only trigger when all three companions have
  // survived at least one raid each. Composite of three switches via
  // the `all` connector. The reward is a special script that branches
  // the endings.
  {
    id: "three_flowers_alliance",
    once: true,
    when: {
      all: [
        { switch: { name: "befriended_kagari" } },
        { switch: { name: "befriended_kasumi" } },
        { switch: { name: "befriended_mio" } },
      ],
    },
    do: (ctx) => {
      queueLetterIfHub(ctx, "three_flowers_alliance");
      return {};
    },
  },
];

// ============================================================================
// Module declaration
// ============================================================================

const raidModule: Module = {
  id: MODULE_ID,
  version: "0.3.0",

  initialize: (_game: Game): RaidModuleState => ({
    raid: null,
    metCharacters: [],
    companion: null,
    companionHp: 0,
    pulsePending: null,
    achievementLog: [],
  }),

  // Action handler kinds the module supplies. Engine namespaces them as
  // "sengoku-raid:<kind>"; bare form resolves uniquely since no other
  // module claims these names. HubActivities built by onHubBuild
  // reference the bare form via HubActivity.actionKind.
  provides: [
    "depart",
    "bond",
    "sell_all_loot",
    "upgrade_mundane",
    "upgrade_pure",
    "upgrade_oni",
    "rest",
    "use_chinkonho",
    "move",
    "search",
    "attack",
    "sneak_strike",
    "flee",
    "extract",
    "negotiate_listen",
    "negotiate_release",
    "yaodao_voice",
    "invite",
    "imbue_pure",
    "imbue_oni",
    "imbue_mundane",
    "infoshop_basic",
    "infoshop_loot",
    "infoshop_yaodao",
    "infoshop_hidden",
  ],
  actionHandlers: {
    depart: departHandler,
    bond: bondHandler,
    sell_all_loot: sellAllLootHandler,
    upgrade_mundane: upgradeMundaneHandler,
    upgrade_pure: upgradePureHandler,
    upgrade_oni: upgradeOniHandler,
    rest: restHandler,
    use_chinkonho: useChinkonhoHandler,
    move: moveHandler,
    search: searchHandler,
    attack: attackHandler,
    sneak_strike: sneakStrikeHandler,
    flee: fleeHandler,
    extract: extractHandler,
    negotiate_listen: negotiateListenHandler,
    negotiate_release: negotiateReleaseHandler,
    yaodao_voice: yaodaoVoiceHandler,
    invite: inviteHandler,
    imbue_pure: imbuePureHandler,
    imbue_oni: imbueOniHandler,
    imbue_mundane: imbueMundaneHandler,
    infoshop_basic: infoshopHandler("basic", 50, 0, false),
    infoshop_loot: infoshopHandler("loot", 100, 30, false),
    infoshop_yaodao: infoshopHandler("yaodao", 200, 50, false),
    infoshop_hidden: infoshopHandler("hidden", 300, 80, true),
  },

  onSessionStart: (ctx) => {
    // Player stats (hp/mental/spectral/intellect) are pre-populated from
    // characters/player.md's declared initials — no manual bootstrap
    // here. raidsCompleted/raidsFailed are declared variables — engine
    // pre-populates from game.yaml.
    if (ctx.state.baseline.inventory.ryo === undefined) {
      ctx.state.baseline.inventory.ryo = 100;
    }
    // Establish the starting location. Fresh sessions land in the hub
    // (大名府 / edo_castle); seeded fixtures that have already entered a
    // raid map keep their currentMapId. The hub menu / raid menu split
    // keys off `m.raid !== null`, but the bg / location semantics still
    // need currentMapId to be set.
    if (ctx.state.baseline.currentMapId === null) {
      enterMap(ctx.state, ctx.game, "edo_castle");
    }
    if (
      ctx.state.baseline.scripts["000_intro"]?.completed !== true &&
      ctx.scriptMap.has("000_intro") &&
      ctx.state.baseline.currentScriptId === null
    ) {
      ctx.state.baseline.currentScriptId = "000_intro";
      ctx.state.baseline.beatIndex = 0;
    }
  },

  triggers,

  // ============== Letter lifecycle observers ==============
  // onScriptStart fires before the first beat yields. We push a single
  // header narration ahead of the letter body so the player gets the
  // "公儀御沙汰" page-break visually, no matter how the script was queued
  // (trigger / hub / save-load).
  onScriptStart: (ctx, scriptId) => {
    if (scriptId.startsWith("letter_")) {
      ctx.state.runtime.pendingNarrations.unshift(
        `——— 公儀御沙汰 ———`,
      );
    }
  },

  // onScriptSelect (first-wins): when the player picks the generic
  // `intel_briefing` script from the hub, redirect to the level-specific
  // variant based on the `intel_active` variable. This is the cleanest
  // legitimate use of the hook — the player-facing menu has one entry
  // ("情報屋の覚書を読む") but the actual content depends on which
  // tier of intel they bought.
  onScriptSelect: (ctx, scriptId) => {
    if (scriptId !== "intel_briefing") return;
    const v = ctx.state.baseline.variables.intel_active;
    if (typeof v !== "string" || v === "") return;
    return `intel_briefing_${v}`;
  },

  // ============== Achievement observers ==============
  //
  // onStateMutated (observer): watch for rising-edge stat / variable
  // crossings and push achievement strings into module-state log.
  // Triggers don't do this naturally because they fire ActionResult
  // deltas — observers can read fresh values directly and append
  // strings without going through the delta surface.
  //
  // The dedup-on-append guard handles re-loads: the same crossing
  // doesn't double-log when state.baseline is restored from a save.
  onStateMutated: (ctx, _delta, source) => {
    // Ignore replays from the seed loader / hot-reload paths.
    if (source === "external") return;
    const m = moduleState(ctx);
    const log = (label: string) => {
      if (!m.achievementLog.includes(label)) m.achievementLog.push(label);
    };
    const spec = playerStat(ctx, "spectral");
    if (spec >= 50) log("鬼に近づく — 霊体化 50");
    if (spec >= 80) log("暴走寸前 — 霊体化 80");
    const pulsePure = (ctx.state.baseline.variables.pulse_pure ?? 0) as number;
    const pulseOni = (ctx.state.baseline.variables.pulse_oni ?? 0) as number;
    if (pulsePure >= 5) log("浄の極み — 浄脈 5");
    if (pulseOni >= 5) log("鬼の脈、深し — 鬼脈 5");
    if ((ctx.state.baseline.inventory.cursed_blade_fragment ?? 0) >= 1) {
      log("呪の片を握る — 鬼神を斬りし証");
    }
  },

  // onLabelEnter (observer): letter_03's three branches are implemented
  // as goto labels (end_loyal / end_defy / end_silent). Logging the
  // entry into one of those labels gives us a clean "the decision was
  // made HERE" anchor, separate from the switch flip which happens
  // earlier in the choice's effects block.
  onLabelEnter: (ctx, scriptId, labelName) => {
    if (scriptId !== "letter_03_choice") return;
    if (!labelName.startsWith("end_")) return;
    const m = moduleState(ctx);
    const tag = `御沙汰：${labelName.slice(4)}`;
    if (!m.achievementLog.includes(tag)) m.achievementLog.push(tag);
  },

  // onScriptComplete is the natural place to finalize a letter's
  // module-level side effects that can't go in the script's effects
  // block: pushing mio into metCharacters (a private module state
  // slice). The chapter advance already happened in the dispatch
  // trigger, so we don't touch shogun_chapter here.
  onScriptComplete: (ctx, scriptId) => {
    if (scriptId === "letter_02_rival") {
      const m = moduleState(ctx);
      if (!m.metCharacters.includes("mio")) {
        m.metCharacters.push("mio");
      }
    }
    // After any intel briefing variant runs to completion, clear
    // intel_active so the hub stops surfacing it and the next infoshop
    // purchase is unblocked.
    if (scriptId.startsWith("intel_briefing_")) {
      ctx.state.baseline.variables.intel_active = "";
    }
  },

  // ============== Companion-aware reducers ==============
  //
  // onActionDispatch (first-wins): when a companion is in party at
  // critical HP, veto `attack` and `sneak_strike` dispatches. Player
  // must flee, use chinkonho, or let HP recover before re-engaging.
  // Returns "cancel" — engine still fires onActionComplete with
  // result=undefined, but the handler body doesn't run.
  onActionDispatch: (ctx, action) => {
    const m = moduleState(ctx);
    if (
      m.companion &&
      m.companionHp > 0 &&
      m.companionHp <= 3 &&
      (action.kind === "attack" || action.kind === "sneak_strike")
    ) {
      const charName =
        ctx.game.characters.find((c) => c.id === m.companion!)?.name ??
        m.companion!;
      ctx.state.runtime.pendingNarrations.push(
        `${charName}が刀を抑えた。「下がれ、深い」——その目に、お主が今日見たどの鬼より強い意志。攻撃は取り消された。`,
      );
      return "cancel";
    }
    return;
  },

  // onBeatBefore (reducer): in bond scripts, if the player's spectral
  // is already past the "危険" threshold (≥50), shadow specific dialogue
  // beats with an alternate text that acknowledges the change. Uses
  // the `{ replace: <beat> }` return form so the timeline still
  // advances one beat per drain.
  onBeatBefore: (ctx, scriptId, _beatIdx, beat) => {
    if (!scriptId.startsWith("bond_")) return;
    if (beat.type !== "dialogue") return;
    if (playerStat(ctx, "spectral") < 50) return;
    // Replace one specific tag — first dialogue beat where speaker is
    // the bond target — with a darker variant. We just append a
    // suffix to make it cheap & uniform.
    return {
      replace: {
        ...beat,
        text: `${beat.text}（——その目を、見つめ返せなかった。お主の瞳が、いつもと違うらしい。）`,
      },
    };
  },

  // onChoicePresented (reducer): in bond_*_03 scenes, when a *different*
  // companion is in party, lock the boldest option (the last one, which
  // is the +2-affection "I commit" choice). Player can still pick the
  // milder options. The lock represents "I won't say that in front of
  // her" social pressure.
  //
  // NOTE on the reducer surface: the engine's runScript resolves choices
  // by indexing back into the original `beat.options` (runScript.ts:105).
  // That means reducers can MARK options unavailable but cannot ADD new
  // ones meaningfully — extra options shown to the player don't have a
  // corresponding ChoiceOption to dispatch. So this hook is for
  // contextual locking only, matching hook-test's coverage.
  onChoicePresented: (ctx, scriptId, _beatIdx, options) => {
    if (!scriptId.match(/^bond_\w+_03$/)) return;
    const m = moduleState(ctx);
    if (!m.companion) return;
    const subjectMatch = scriptId.match(/^bond_(\w+)_03$/);
    if (!subjectMatch) return;
    const subject = subjectMatch[1];
    if (m.companion === subject) return; // self in party — no jealousy axis
    const sideName =
      ctx.game.characters.find((c) => c.id === m.companion!)?.name ??
      m.companion!;
    const lastIdx = options.length - 1;
    return options.map((opt, idx) =>
      idx === lastIdx
        ? {
            ...opt,
            available: false,
            lockedReason: `${sideName}が隣にいる。今ここで口にする言葉ではない。`,
          }
        : opt,
    );
  },

  onHubBuild: (ctx) => {
    // After any ending script completes, the game ends. Returning
    // undefined from onHubBuild signals the preset's run loop to
    // yield gameEnd. This is the engine-canonical way to terminate
    // from a module — no need for a special action or hook.
    const endings = ["ending_pure_rite", "ending_oni_self", "ending_mundane_seal"];
    for (const id of endings) {
      if (ctx.state.baseline.scripts[id]?.completed === true) return undefined;
    }
    const m = moduleState(ctx);
    return m.raid === null ? buildHubMenu(ctx) : buildRaidMenu(ctx);
  },
};

export default raidModule;
