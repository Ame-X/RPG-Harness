import type { ComposedState } from "@rpg-harness/engine";

// Browser twin of packages/cli/src/session.ts. The CLI persists one
// state.json per session under the game's .rpg-harness dir; in the
// browser there's no fs, so each game gets a single autosave slot in
// localStorage. ComposedState is plain JSON (engine invariant), so it
// round-trips through stringify/parse without loss — the same property
// that lets the CLI write state.json.
//
// Key namespace is per-game so one bundle's many games keep independent
// saves: rpgh:save:<gameId>.

const PREFIX = "rpgh:save:";

function key(gameId: string): string {
  return PREFIX + gameId;
}

export function loadState(gameId: string): ComposedState | null {
  try {
    const raw = localStorage.getItem(key(gameId));
    if (raw === null) return null;
    return JSON.parse(raw) as ComposedState;
  } catch {
    // Corrupt or unparseable save → treat as no save rather than
    // wedging the player on a broken slot.
    return null;
  }
}

export function saveState(gameId: string, state: ComposedState): void {
  try {
    localStorage.setItem(key(gameId), JSON.stringify(state));
  } catch {
    // Quota exceeded / storage disabled (private mode). Saves are
    // best-effort; play continues in-memory either way.
  }
}

export function clearState(gameId: string): void {
  try {
    localStorage.removeItem(key(gameId));
  } catch {
    // ignore
  }
}

export function hasSave(gameId: string): boolean {
  try {
    return localStorage.getItem(key(gameId)) !== null;
  } catch {
    return false;
  }
}
