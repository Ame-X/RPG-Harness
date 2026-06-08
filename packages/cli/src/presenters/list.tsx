import React from "react";
import { Box, Text } from "ink";
import type { ChoicePresenter, ChoicePresenterProps } from "./types";
import { findAvailableFrom } from "@rpg-harness/frontend-core";
import { parseDigitKey } from "./shared";

// Default presenter — a vertical list. Mirrors the pre-presenter
// Choices.tsx rendering and the existing screen-model keymap:
//   Up / k       → previous available row
//   Down / j     → next available row
//   Enter        → commit current cursor
//   1-9          → direct-select (commit if available)

function ListRender({ prompt, options, cursor }: ChoicePresenterProps) {
  return (
    <Box flexDirection="column">
      {prompt ? <Text color="yellow">{prompt}</Text> : null}
      {options.map((opt, i) => {
        const selected = i === cursor;
        const color = !opt.available ? "gray" : selected ? "cyan" : "white";
        return (
          <Text
            key={i}
            color={color}
            bold={selected && opt.available}
            dimColor={!opt.available}
          >
            {selected ? "▸ " : "  "}
            {`${i + 1}. ${opt.text}`}
            {opt.available ? "" : `  （${opt.lockedReason ?? "锁定"}）`}
          </Text>
        );
      })}
    </Box>
  );
}

export const listPresenter: ChoicePresenter = {
  name: "list",
  footerHint: "↑↓ 选择 · Enter 确认 · 数字直选",
  render: ListRender,
  dispatchKey(props, input, key) {
    const { options, cursor } = props;
    const available = (i: number) => options[i]?.available ?? false;
    if (key.upArrow || input === "k") {
      const next = findAvailableFrom(cursor, options.length, -1, available);
      if (next === cursor) return null;
      return { kind: "ui", action: { kind: "cursorTo", index: next } };
    }
    if (key.downArrow || input === "j") {
      const next = findAvailableFrom(cursor, options.length, 1, available);
      if (next === cursor) return null;
      return { kind: "ui", action: { kind: "cursorTo", index: next } };
    }
    if (key.return) {
      if (cursor < 0 || cursor >= options.length) return null;
      if (!available(cursor)) return null;
      return { kind: "engine", input: { type: "choose", index: cursor } };
    }
    const n = parseDigitKey(input);
    if (n !== null && n >= 1 && n <= options.length) {
      const target = n - 1;
      if (!available(target)) return null;
      return { kind: "engine", input: { type: "choose", index: target } };
    }
    return null;
  },
};
