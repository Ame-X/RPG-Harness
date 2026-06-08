import type { Input } from "@rpg-harness/engine";
import type { Stage, UiAction } from "@rpg-harness/frontend-core";
import { getChoicePresenter } from "./presenters";

// Pure mapping from (current stage + keypress) → KeyResult. Two flavors:
//
// - `engine`  — produce an engine Input, send through the runner.
// - `ui`      — pure TUI-local action (cursor movement); never reaches
//               the engine. Applied via applyUiAction in screen-model.
//
// `null` means the key isn't meaningful for the current stage.
//
// Global keys (Esc → open menu, `b` → backlog toggle) are handled at
// the PlayScreen layer before reaching this dispatcher.

export interface KeyEvent {
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  // ink also exposes ctrl/meta/etc — we don't need them for the engine
  // protocol today.
}

export type KeyResult =
  | { kind: "engine"; input: Input }
  | { kind: "ui"; action: UiAction }
  | null;

export function dispatchStageInput(
  stage: Stage,
  input: string,
  key: KeyEvent,
): KeyResult {
  switch (stage.kind) {
    case "narration":
    case "dialogue":
      if (key.return || input === " ") return { kind: "engine", input: { type: "next" } };
      return null;
    case "choice": {
      const presenter = getChoicePresenter(stage.view);
      return presenter.dispatchKey(
        {
          ...(stage.prompt !== undefined ? { prompt: stage.prompt } : {}),
          options: stage.options,
          cursor: stage.cursor,
        },
        input,
        key,
      );
    }
    case "hubMenu": {
      const acts = stage.snapshot.activities;
      return dispatchListKey({
        input,
        key,
        cursor: stage.cursor,
        length: acts.length,
        availableAt: (i) => acts[i]?.available ?? false,
        commit: (i) => {
          const a = acts[i];
          return a ? { type: "doActivity", id: a.id } : null;
        },
      });
    }
    case "scriptComplete": {
      const list = stage.nextAvailable;
      return dispatchListKey({
        input,
        key,
        cursor: stage.cursor,
        length: list.length,
        availableAt: () => true,
        commit: (i) => {
          const s = list[i];
          return s ? { type: "select", scriptId: s.id } : null;
        },
      });
    }
    case "loading":
    case "error":
    case "ended":
      return null;
  }
}

// Shared key-handling for the three list-style stages. Arrow / vim
// keys emit UI cursor moves; Enter commits the current cursor; digit
// keys are a direct-select shortcut (jump + commit in one step).
function dispatchListKey(opts: {
  input: string;
  key: KeyEvent;
  cursor: number;
  length: number;
  availableAt: (i: number) => boolean;
  commit: (i: number) => Input | null;
}): KeyResult {
  const { input, key, cursor, length, availableAt, commit } = opts;
  if (key.upArrow || input === "k") return { kind: "ui", action: { kind: "cursorPrev" } };
  if (key.downArrow || input === "j") return { kind: "ui", action: { kind: "cursorNext" } };
  if (key.return) {
    if (cursor < 0 || cursor >= length) return null;
    if (!availableAt(cursor)) return null;
    const engineInput = commit(cursor);
    return engineInput ? { kind: "engine", input: engineInput } : null;
  }
  const n = parseDigit(input);
  if (n !== null && n >= 1 && n <= length) {
    const target = n - 1;
    if (!availableAt(target)) return null;
    const engineInput = commit(target);
    return engineInput ? { kind: "engine", input: engineInput } : null;
  }
  return null;
}

function parseDigit(input: string): number | null {
  if (input.length !== 1) return null;
  const n = Number(input);
  if (!Number.isInteger(n)) return null;
  return n;
}

// Footer hint text per stage — drives the bottom-line "what keys do I
// have right now" UX. Always appended with the global suffix in
// PlayScreen so the player knows about Esc / b.
export function footerHintFor(stage: Stage): string {
  switch (stage.kind) {
    case "narration":
    case "dialogue":
      return "Enter/空格 继续";
    case "choice":
      return getChoicePresenter(stage.view).footerHint;
    case "hubMenu":
    case "scriptComplete":
      return "↑↓ 选择 · Enter 确认 · 数字直选";
    case "ended":
    case "error":
    case "loading":
      return "";
  }
}
