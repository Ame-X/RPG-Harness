import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { BacklogEntry } from "@rpg-harness/frontend-core";
import { GameLayout } from "./GameLayout";

interface Props {
  entries: BacklogEntry[];
  onClose: () => void;
}

// Full-screen review of past narrations / dialogues. Newest entries sit
// at the bottom (like a chat log). j/k scrolls one line at a time;
// PgUp/PgDn jumps a page; gg/G to ends. b/q/Esc closes.
//
// Scrolling math: `offset` = how many entries from the bottom to skip
// (0 = pinned to the latest). Visible window is rows available minus
// header (1) and footer (1) and the pad/borders inside the stage box.

export function BacklogOverlay({ entries, onClose }: Props) {
  const { stdout } = useStdout();
  const [rows, setRows] = useState<number>(stdout.rows ?? 24);
  useEffect(() => {
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Reserve: 1 header, 1 footer, 2 vertical pad inside stage.
  const visible = Math.max(3, rows - 4);
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, entries.length - visible);

  useInput((input, key) => {
    if (key.escape || input === "b" || input === "q") {
      onClose();
      return;
    }
    if (key.downArrow || input === "j") {
      setOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (key.upArrow || input === "k") {
      setOffset((o) => Math.min(maxOffset, o + 1));
      return;
    }
    if (key.pageDown || input === " ") {
      setOffset((o) => Math.max(0, o - visible));
      return;
    }
    if (key.pageUp) {
      setOffset((o) => Math.min(maxOffset, o + visible));
      return;
    }
    if (input === "G") {
      setOffset(0);
      return;
    }
    if (input === "g") {
      setOffset(maxOffset);
      return;
    }
  });

  // Slice the visible window. `end` is the index just past the last
  // entry to show (clamped); `start` is `visible` entries before that.
  const end = Math.max(0, entries.length - offset);
  const start = Math.max(0, end - visible);
  const window = entries.slice(start, end);

  const header = (
    <Box paddingX={1}>
      <Text bold>回看 backlog</Text>
      <Text dimColor>
        {"  "}({start + 1}-{end} / {entries.length})
      </Text>
    </Box>
  );
  const footer = (
    <Box paddingX={1}>
      <Text dimColor>
        j/k 上下 · Space/PgDn 翻页 · g/G 顶/底 · b/q/Esc 关闭
      </Text>
    </Box>
  );

  return (
    <GameLayout header={header} footer={footer}>
      <Box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1}>
        {entries.length === 0 ? (
          <Text dimColor>（还没有可回看的内容）</Text>
        ) : (
          window.map((entry, i) => <Entry key={start + i} entry={entry} />)
        )}
      </Box>
    </GameLayout>
  );
}

function Entry({ entry }: { entry: BacklogEntry }) {
  if (entry.kind === "sceneBreak") {
    return (
      <Box marginY={1}>
        <Text dimColor>─── 场景切换 ───</Text>
      </Box>
    );
  }
  if (entry.kind === "narration") {
    return (
      <Box>
        <Text dimColor>{entry.text}</Text>
      </Box>
    );
  }
  // Single Text node so ink can wrap CJK content cleanly. Nested
  // <Box flexDirection="row"> with mixed cyan/dim/normal spans was
  // garbling speaker names ("narrato" missing the trailing 'r') on
  // wrap because each span has its own layout box.
  return (
    <Box>
      <Text>
        <Text color="cyan">{entry.speakerName}</Text>
        <Text dimColor>: 「</Text>
        {entry.text}
        <Text dimColor>」</Text>
      </Text>
    </Box>
  );
}
