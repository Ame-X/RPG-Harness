import React from "react";
import { Box, Text } from "ink";
import type { ChoicePresenter, ChoicePresenterProps } from "./types";
import { findAvailableFrom } from "@rpg-harness/frontend-core";
import { parseDigitKey } from "./shared";

// 2-column grid presenter. Row-major fill: options 1,2 land on row 1;
// 3,4 on row 2; etc. Useful when the option set reads more like a
// menu of *things* (places to go, weapons to pick) than a sequence of
// dialogue replies. Authors opt in via `? prompt {view: grid}`.
//
// Navigation:
//   Up / k       → cursor - cols
//   Down / j     → cursor + cols
//   Left / h     → cursor - 1
//   Right / l    → cursor + 1
//   Enter        → commit cursor
//   1-9          → direct-select
//
// Moves skip locked rows in the direction of travel; off-grid moves
// stay put (no wrap, no row-end teleport). When the geometric
// target lies on the same row as a locked column, the cursor keeps
// walking by ±1 within the column band — predictable enough to be
// learned in two presses.

const COLS = 2;

function GridRender({ prompt, options, cursor }: ChoicePresenterProps) {
  const rows: number[][] = [];
  for (let i = 0; i < options.length; i += COLS) {
    rows.push(
      Array.from({ length: COLS }, (_, c) => i + c).filter(
        (idx) => idx < options.length,
      ),
    );
  }
  return (
    <Box flexDirection="column">
      {prompt ? <Text color="yellow">{prompt}</Text> : null}
      {rows.map((row, rIdx) => (
        <Box key={rIdx} flexDirection="row">
          {row.map((idx) => {
            const opt = options[idx];
            if (!opt) return null;
            const selected = idx === cursor;
            const color = !opt.available
              ? "gray"
              : selected
                ? "cyan"
                : "white";
            return (
              <Box key={idx} width="50%" paddingRight={1}>
                <Text
                  color={color}
                  bold={selected && opt.available}
                  dimColor={!opt.available}
                >
                  {selected ? "▸ " : "  "}
                  {`${idx + 1}. ${opt.text}`}
                  {opt.available
                    ? ""
                    : `（${opt.lockedReason ?? "锁定"}）`}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export const gridPresenter: ChoicePresenter = {
  name: "grid",
  footerHint: "↑↓←→ 选择 · Enter 确认 · 数字直选",
  render: GridRender,
  dispatchKey(props, input, key) {
    const { options, cursor } = props;
    const length = options.length;
    const available = (i: number) => options[i]?.available ?? false;

    const step = (() => {
      if (key.upArrow || input === "k") return -COLS;
      if (key.downArrow || input === "j") return COLS;
      if (key.leftArrow || input === "h") return -1;
      if (key.rightArrow || input === "l") return 1;
      return 0;
    })();
    if (step !== 0) {
      const next = findAvailableFrom(cursor, length, step, available);
      if (next === cursor) return null;
      return { kind: "ui", action: { kind: "cursorTo", index: next } };
    }
    if (key.return) {
      if (cursor < 0 || cursor >= length) return null;
      if (!available(cursor)) return null;
      return { kind: "engine", input: { type: "choose", index: cursor } };
    }
    const n = parseDigitKey(input);
    if (n !== null && n >= 1 && n <= length) {
      const target = n - 1;
      if (!available(target)) return null;
      return { kind: "engine", input: { type: "choose", index: target } };
    }
    return null;
  },
};
