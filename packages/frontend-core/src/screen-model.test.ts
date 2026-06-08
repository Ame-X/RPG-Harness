import { describe, expect, test } from "bun:test";
import type { HubSnapshot, Output } from "@rpg-harness/engine";
import {
  BACKLOG_CAP,
  applyOutput,
  applyUiAction,
  initialModel,
  makeErrorModel,
  type ScreenModel,
} from "./screen-model";

const emptyHub: HubSnapshot = {
  day: 0,
  maxDay: 0,
  slot: 0,
  slotName: "",
  slotsPerDay: 0,
  stats: [],
  affections: [],
  activities: [],
};

const narr = (text: string): Output => ({ type: "narration", text });
const dlg = (text: string, speaker = "alice"): Output => ({
  type: "dialogue",
  speakerId: speaker,
  speakerName: speaker,
  text,
});

describe("applyOutput — stage transitions", () => {
  test("narration replaces loading stage; no backlog yet", () => {
    const m = applyOutput(initialModel, narr("hello"));
    expect(m.stage).toEqual({ kind: "narration", text: "hello" });
    expect(m.backlog).toEqual([]);
  });

  test("narration → narration demotes prior into backlog", () => {
    let m = applyOutput(initialModel, narr("first"));
    m = applyOutput(m, narr("second"));
    expect(m.stage).toEqual({ kind: "narration", text: "second" });
    expect(m.backlog).toEqual([{ kind: "narration", text: "first" }]);
  });

  test("dialogue demotes prior narration", () => {
    let m = applyOutput(initialModel, narr("scene set"));
    m = applyOutput(m, dlg("hi"));
    expect(m.stage.kind).toBe("dialogue");
    expect(m.backlog).toEqual([{ kind: "narration", text: "scene set" }]);
  });

  test("hubMenu replaces stage and demotes prior narration", () => {
    let m = applyOutput(initialModel, narr("intro"));
    m = applyOutput(m, { type: "hubMenu", snapshot: emptyHub });
    expect(m.stage.kind).toBe("hubMenu");
    expect(m.backlog).toEqual([{ kind: "narration", text: "intro" }]);
  });

  test("hubMenu → narration: prior hubMenu is NOT pushed to backlog", () => {
    let m = applyOutput(initialModel, { type: "hubMenu", snapshot: emptyHub });
    m = applyOutput(m, narr("you depart"));
    expect(m.stage.kind).toBe("narration");
    expect(m.backlog).toEqual([]); // hubMenu isn't transcript material
  });

  test("choice replaces stage", () => {
    const m = applyOutput(initialModel, {
      type: "choice",
      prompt: "pick",
      options: [{ text: "a", available: true }],
    });
    expect(m.stage).toMatchObject({ kind: "choice", prompt: "pick" });
  });

  test("scriptComplete replaces stage", () => {
    const m = applyOutput(initialModel, {
      type: "scriptComplete",
      completedId: "001_intro",
      nextAvailable: [{ id: "002_a", title: "Path A" }],
    });
    expect(m.stage).toMatchObject({
      kind: "scriptComplete",
      completedId: "001_intro",
      cursor: 0,
    });
  });

  test("gameEnd → ended; reason preserved when provided", () => {
    const m1 = applyOutput(initialModel, { type: "gameEnd" });
    expect(m1.stage).toEqual({ kind: "ended" });
    const m2 = applyOutput(initialModel, {
      type: "gameEnd",
      reason: "fin",
    });
    expect(m2.stage).toEqual({ kind: "ended", reason: "fin" });
  });
});

describe("applyOutput — clear", () => {
  test("clear leaves stage untouched", () => {
    const m1 = applyOutput(initialModel, narr("a"));
    const m2 = applyOutput(m1, { type: "clear" });
    expect(m2.stage).toEqual(m1.stage);
  });

  test("clear inserts sceneBreak marker into backlog", () => {
    let m = applyOutput(initialModel, narr("a"));
    m = applyOutput(m, narr("b")); // a → backlog
    m = applyOutput(m, { type: "clear" }); // sceneBreak appended
    expect(m.backlog).toEqual([
      { kind: "narration", text: "a" },
      { kind: "sceneBreak" },
    ]);
  });
});

describe("backlog cap", () => {
  test(`backlog never exceeds ${BACKLOG_CAP} entries`, () => {
    let m: ScreenModel = initialModel;
    // narration #1 sits on stage; #2..#(CAP+5) each demote the prior.
    // Total backlog growth = CAP + 4.
    for (let i = 0; i < BACKLOG_CAP + 5; i++) {
      m = applyOutput(m, narr(`line ${i}`));
    }
    expect(m.backlog.length).toBe(BACKLOG_CAP);
    // The very oldest narrations should have been trimmed.
    expect(m.backlog[0]).toEqual({ kind: "narration", text: "line 4" });
  });
});

describe("applyOutput — cursor init", () => {
  test("choice cursor lands on first available option", () => {
    const m = applyOutput(initialModel, {
      type: "choice",
      options: [
        { text: "locked", available: false, lockedReason: "lvl<5" },
        { text: "fine", available: true },
        { text: "also fine", available: true },
      ],
    });
    expect(m.stage).toMatchObject({ kind: "choice", cursor: 1 });
  });

  test("choice cursor falls back to 0 when nothing is available", () => {
    const m = applyOutput(initialModel, {
      type: "choice",
      options: [
        { text: "x", available: false },
        { text: "y", available: false },
      ],
    });
    expect(m.stage).toMatchObject({ kind: "choice", cursor: 0 });
  });

  test("hubMenu cursor lands on first available activity", () => {
    const snap: HubSnapshot = {
      ...emptyHub,
      activities: [
        {
          id: "a",
          kind: "script",
          title: "A",
          cost: 0,
          available: false,
          lockedReason: "shut",
        },
        { id: "b", kind: "script", title: "B", cost: 0, available: true },
      ],
    };
    const m = applyOutput(initialModel, { type: "hubMenu", snapshot: snap });
    expect(m.stage).toMatchObject({ kind: "hubMenu", cursor: 1 });
  });

  test("scriptComplete cursor starts at 0", () => {
    const m = applyOutput(initialModel, {
      type: "scriptComplete",
      completedId: null,
      nextAvailable: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    });
    expect(m.stage).toMatchObject({ kind: "scriptComplete", cursor: 0 });
  });
});

describe("applyUiAction — cursor movement", () => {
  const choiceOf = (available: boolean[]): Output => ({
    type: "choice",
    options: available.map((a, i) => ({ text: `opt ${i}`, available: a })),
  });

  test("cursorNext steps forward, skipping locked rows", () => {
    let m = applyOutput(initialModel, choiceOf([true, false, true]));
    expect((m.stage as { cursor: number }).cursor).toBe(0);
    m = applyUiAction(m, { kind: "cursorNext" });
    expect((m.stage as { cursor: number }).cursor).toBe(2);
  });

  test("cursorPrev steps back, skipping locked rows", () => {
    let m = applyOutput(initialModel, choiceOf([true, false, true]));
    m = applyUiAction(m, { kind: "cursorNext" }); // → 2
    m = applyUiAction(m, { kind: "cursorPrev" });
    expect((m.stage as { cursor: number }).cursor).toBe(0);
  });

  test("cursorNext at the bottom is a no-op (no wrap)", () => {
    let m = applyOutput(initialModel, choiceOf([true, true]));
    m = applyUiAction(m, { kind: "cursorNext" }); // → 1
    const prev = m;
    m = applyUiAction(m, { kind: "cursorNext" });
    expect(m).toBe(prev);
  });

  test("cursorTo jumps directly when target is available", () => {
    let m = applyOutput(initialModel, choiceOf([true, true, true]));
    m = applyUiAction(m, { kind: "cursorTo", index: 2 });
    expect((m.stage as { cursor: number }).cursor).toBe(2);
  });

  test("cursorTo on a locked row is rejected", () => {
    let m = applyOutput(initialModel, choiceOf([true, false, true]));
    const prev = m;
    m = applyUiAction(m, { kind: "cursorTo", index: 1 });
    expect(m).toBe(prev);
  });

  test("applyUiAction is a no-op on non-selectable stages", () => {
    const m = applyOutput(initialModel, narr("hi"));
    const next = applyUiAction(m, { kind: "cursorNext" });
    expect(next).toBe(m);
  });
});

describe("makeErrorModel", () => {
  test("wraps an Error into an error stage", () => {
    const err = new Error("boom");
    const m = makeErrorModel(err);
    expect(m.stage.kind).toBe("error");
    if (m.stage.kind === "error") {
      expect(m.stage.message).toBe("boom");
    }
    expect(m.backlog).toEqual([]);
  });
});
