// Screen model: projects the engine's `Output` event stream into a stable
// "screen state". The current scene (stage) is always exactly one thing —
// what the player is looking at right now. Past narrations/dialogues
// accumulate in a separate `backlog` (capped) for the `b`-toggled review
// overlay, not for inline rendering.
//
// This file is a pure reducer. PlayScreen wires Output → applyOutput;
// the model is the single source of truth for every visible region.

import type {
  HubSnapshot,
  Output,
  RenderedChoice,
  ScriptInfo,
  VisualState,
} from "@rpg-harness/engine";
import { emptyVisualState } from "@rpg-harness/engine";

// `cursor` on selectable stages: the row the player has currently
// highlighted. Owned by the TUI, not the engine — Up/Down move it,
// Enter commits the engine input. Initial value is computed when the
// stage is installed (see `firstAvailableIndex` below); the engine
// itself never sees or sets it.
export type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string; stack?: string }
  | { kind: "narration"; text: string }
  | { kind: "dialogue"; speakerId: string; speakerName: string; text: string }
  | {
      kind: "choice";
      prompt?: string;
      options: RenderedChoice[];
      cursor: number;
      // Presenter hint forwarded from Output.choice.view. The TUI
      // looks this up in its presenter registry; `undefined` (or an
      // unknown name) falls back to the default list presenter.
      view?: string;
    }
  | { kind: "hubMenu"; snapshot: HubSnapshot; cursor: number }
  | {
      kind: "scriptComplete";
      completedId: string | null;
      nextAvailable: ScriptInfo[];
      cursor: number;
    }
  | { kind: "ended"; reason?: string };

export type BacklogEntry =
  | { kind: "narration"; text: string }
  | { kind: "dialogue"; speakerName: string; text: string }
  | { kind: "sceneBreak" };

export interface ScreenModel {
  stage: Stage;
  backlog: BacklogEntry[];
  // Current visual stack (bg / portraits / cg). Persists across
  // stage transitions — when the engine moves from dialogue to choice
  // the bg stays put. Updated whenever an Output carries a
  // visualState; orthogonal to `stage`.
  visuals: VisualState;
}

export const BACKLOG_CAP = 200;

export const initialModel: ScreenModel = {
  stage: { kind: "loading" },
  backlog: [],
  visuals: emptyVisualState(),
};

export function makeErrorModel(err: Error): ScreenModel {
  return {
    stage: { kind: "error", message: err.message, stack: err.stack },
    backlog: [],
    visuals: emptyVisualState(),
  };
}

// Apply one engine Output to the model. Transient beats (narration /
// dialogue) demote the *previous* stage into the backlog before being
// installed. `clear` is a transcript boundary — it doesn't change the
// stage, but inserts a sceneBreak marker into the backlog. Menu-like
// outputs (choice / hubMenu / scriptComplete / gameEnd) replace the
// stage outright and don't write to backlog.
export function applyOutput(model: ScreenModel, output: Output): ScreenModel {
  // Snapshot incoming visualState — the engine yields the same live
  // object on every step, so without a copy the model would share a
  // reference and downstream consumers (memoization, React props
  // equality) would treat unchanged frames as changed and vice versa.
  const visuals = output.visualState
    ? {
        bg: output.visualState.bg,
        portraits: { ...output.visualState.portraits },
        cg: output.visualState.cg,
      }
    : model.visuals;
  switch (output.type) {
    case "narration":
      return {
        stage: { kind: "narration", text: output.text },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "dialogue":
      return {
        stage: {
          kind: "dialogue",
          speakerId: output.speakerId,
          speakerName: output.speakerName,
          text: output.text,
        },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "choice":
      return {
        stage: {
          kind: "choice",
          ...(output.prompt !== undefined ? { prompt: output.prompt } : {}),
          options: output.options,
          cursor: firstAvailableIndex(output.options.length, (i) =>
            isOptionAvailable(output.options[i]),
          ),
          ...(output.view !== undefined ? { view: output.view } : {}),
        },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "hubMenu":
      return {
        stage: {
          kind: "hubMenu",
          snapshot: output.snapshot,
          cursor: firstAvailableIndex(
            output.snapshot.activities.length,
            (i) => isActivityAvailable(output.snapshot.activities[i]),
          ),
        },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "scriptComplete":
      return {
        stage: {
          kind: "scriptComplete",
          completedId: output.completedId,
          nextAvailable: output.nextAvailable,
          cursor: 0,
        },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "gameEnd":
      return {
        stage: {
          kind: "ended",
          ...(output.reason !== undefined ? { reason: output.reason } : {}),
        },
        backlog: demote(model.stage, model.backlog),
        visuals,
      };
    case "clear":
      return {
        stage: model.stage,
        backlog: capBacklog([...model.backlog, { kind: "sceneBreak" }]),
        visuals,
      };
  }
}

// Push the outgoing stage into the backlog IFF it was a transient
// transcript-worthy beat (narration / dialogue). Menus / errors / loading
// don't get preserved — they're UI state, not story.
function demote(stage: Stage, backlog: BacklogEntry[]): BacklogEntry[] {
  if (stage.kind === "narration") {
    return capBacklog([...backlog, { kind: "narration", text: stage.text }]);
  }
  if (stage.kind === "dialogue") {
    return capBacklog([
      ...backlog,
      { kind: "dialogue", speakerName: stage.speakerName, text: stage.text },
    ]);
  }
  return backlog;
}

function capBacklog(entries: BacklogEntry[]): BacklogEntry[] {
  if (entries.length <= BACKLOG_CAP) return entries;
  return entries.slice(entries.length - BACKLOG_CAP);
}

// ---------- UI actions (TUI-local, not engine inputs) ----------
//
// These flow from key events into the same reducer pipeline as engine
// Outputs but never reach the engine. They move the selection cursor
// for choice / hubMenu / scriptComplete stages. Other stages ignore
// them — applyUiAction is a no-op when the stage isn't selectable.

export type UiAction =
  | { kind: "cursorPrev" }
  | { kind: "cursorNext" }
  | { kind: "cursorTo"; index: number };

export function applyUiAction(model: ScreenModel, action: UiAction): ScreenModel {
  const s = model.stage;
  if (s.kind === "choice") {
    const next = moveCursor(s.cursor, s.options.length, action, (i) =>
      isOptionAvailable(s.options[i]),
    );
    if (next === s.cursor) return model;
    return { ...model, stage: { ...s, cursor: next } };
  }
  if (s.kind === "hubMenu") {
    const acts = s.snapshot.activities;
    const next = moveCursor(s.cursor, acts.length, action, (i) =>
      isActivityAvailable(acts[i]),
    );
    if (next === s.cursor) return model;
    return { ...model, stage: { ...s, cursor: next } };
  }
  if (s.kind === "scriptComplete") {
    const next = moveCursor(s.cursor, s.nextAvailable.length, action, () => true);
    if (next === s.cursor) return model;
    return { ...model, stage: { ...s, cursor: next } };
  }
  return model;
}

// Movement rule: prev/next walk in the direction skipping locked rows.
// If no available row exists in that direction, the cursor stays put
// (clamp, not wrap). `cursorTo` jumps directly when target is available;
// otherwise it's a no-op so a stray digit never lands on a locked row.
function moveCursor(
  cursor: number,
  length: number,
  action: UiAction,
  available: (i: number) => boolean,
): number {
  if (length === 0) return cursor;
  if (action.kind === "cursorTo") {
    if (action.index < 0 || action.index >= length) return cursor;
    return available(action.index) ? action.index : cursor;
  }
  const step = action.kind === "cursorNext" ? 1 : -1;
  for (let i = cursor + step; i >= 0 && i < length; i += step) {
    if (available(i)) return i;
  }
  return cursor;
}

// Walk in `step` increments from `from` until we hit an available
// row or run off the end. Used by presenters whose key-handling
// computes a target index (e.g. grid Up = -cols) and wants the
// reducer to skip locked cells inside that direction. `step` must be
// non-zero; positive walks forward, negative walks back. Returns
// `from` when no row in that direction is available — the caller can
// detect a no-op by reference equality.
export function findAvailableFrom(
  from: number,
  length: number,
  step: number,
  available: (i: number) => boolean,
): number {
  if (step === 0 || length === 0) return from;
  for (let i = from; i >= 0 && i < length; i += step) {
    if (i !== from && available(i)) return i;
  }
  return from;
}

function isOptionAvailable(opt: RenderedChoice | undefined): boolean {
  return opt ? opt.available : false;
}

function isActivityAvailable(
  act: { available: boolean } | undefined,
): boolean {
  return act ? act.available : false;
}

// Returns the first index for which `available(i)` is true. If none
// are available, returns 0 — the cursor still has *somewhere* to sit
// (rendered locked) and Enter at that row is rejected upstream by
// stage-input.
function firstAvailableIndex(length: number, available: (i: number) => boolean): number {
  for (let i = 0; i < length; i++) {
    if (available(i)) return i;
  }
  return 0;
}
