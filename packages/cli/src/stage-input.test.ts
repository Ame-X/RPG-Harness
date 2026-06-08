import { describe, expect, test } from "bun:test";
import type { HubSnapshot, RenderedChoice } from "@rpg-harness/engine";
import { dispatchStageInput, type KeyEvent } from "./stage-input";
import type { Stage } from "@rpg-harness/frontend-core";

const k = (over: Partial<KeyEvent> = {}): KeyEvent => ({
  return: false,
  upArrow: false,
  downArrow: false,
  ...over,
});

const choiceStage = (
  options: RenderedChoice[],
  cursor = 0,
  view?: string,
): Stage => ({
  kind: "choice",
  options,
  cursor,
  ...(view !== undefined ? { view } : {}),
});

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

describe("dispatchStageInput — choice", () => {
  const opts: RenderedChoice[] = [
    { text: "a", available: true },
    { text: "locked", available: false, lockedReason: "lvl<5" },
    { text: "c", available: true },
  ];

  test("Up jumps cursor to previous available row", () => {
    expect(dispatchStageInput(choiceStage(opts, 2), "", k({ upArrow: true }))).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 0 },
    });
  });

  test("Down jumps cursor to next available row, skipping locked", () => {
    expect(dispatchStageInput(choiceStage(opts, 0), "", k({ downArrow: true }))).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 2 },
    });
  });

  test("j / k act as Down / Up", () => {
    expect(dispatchStageInput(choiceStage(opts, 0), "j", k())).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 2 },
    });
    expect(dispatchStageInput(choiceStage(opts, 2), "k", k())).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 0 },
    });
  });

  test("Enter on an available cursor commits choose(cursor)", () => {
    expect(dispatchStageInput(choiceStage(opts, 2), "", k({ return: true }))).toEqual({
      kind: "engine",
      input: { type: "choose", index: 2 },
    });
  });

  test("Enter on a locked cursor is a no-op", () => {
    expect(dispatchStageInput(choiceStage(opts, 1), "", k({ return: true }))).toBeNull();
  });

  test("digit shortcut commits directly when available", () => {
    expect(dispatchStageInput(choiceStage(opts, 0), "3", k())).toEqual({
      kind: "engine",
      input: { type: "choose", index: 2 },
    });
  });

  test("digit shortcut on a locked option is a no-op", () => {
    expect(dispatchStageInput(choiceStage(opts, 0), "2", k())).toBeNull();
  });

  test("out-of-range digit is a no-op", () => {
    expect(dispatchStageInput(choiceStage(opts, 0), "9", k())).toBeNull();
  });
});

describe("dispatchStageInput — choice with view:grid", () => {
  // 4 options in a 2-column grid:
  //   0  1
  //   2  3
  const opts: RenderedChoice[] = [
    { text: "0", available: true },
    { text: "1", available: true },
    { text: "2", available: true },
    { text: "3", available: true },
  ];

  test("Down moves by one row (+2)", () => {
    expect(dispatchStageInput(choiceStage(opts, 0, "grid"), "", k({ downArrow: true }))).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 2 },
    });
  });

  test("Right moves by one column (+1)", () => {
    expect(dispatchStageInput(choiceStage(opts, 0, "grid"), "", k({ rightArrow: true }))).toEqual({
      kind: "ui",
      action: { kind: "cursorTo", index: 1 },
    });
  });

  test("Up at top row is a no-op", () => {
    expect(
      dispatchStageInput(choiceStage(opts, 0, "grid"), "", k({ upArrow: true })),
    ).toBeNull();
  });

  test("Left at left column is a no-op", () => {
    expect(
      dispatchStageInput(choiceStage(opts, 0, "grid"), "", k({ leftArrow: true })),
    ).toBeNull();
  });

  test("Enter commits cursor", () => {
    expect(dispatchStageInput(choiceStage(opts, 3, "grid"), "", k({ return: true }))).toEqual({
      kind: "engine",
      input: { type: "choose", index: 3 },
    });
  });

  test("digit shortcut still works under grid view", () => {
    expect(dispatchStageInput(choiceStage(opts, 0, "grid"), "4", k())).toEqual({
      kind: "engine",
      input: { type: "choose", index: 3 },
    });
  });

  test("unknown view falls back to list dispatcher", () => {
    expect(
      dispatchStageInput(choiceStage(opts, 0, "no-such-view"), "", k({ downArrow: true })),
    ).toEqual({ kind: "ui", action: { kind: "cursorTo", index: 1 } });
  });
});

describe("dispatchStageInput — narration / dialogue", () => {
  test("Enter advances narration", () => {
    expect(
      dispatchStageInput({ kind: "narration", text: "x" }, "", k({ return: true })),
    ).toEqual({ kind: "engine", input: { type: "next" } });
  });

  test("Space advances dialogue", () => {
    expect(
      dispatchStageInput(
        { kind: "dialogue", speakerId: "a", speakerName: "A", text: "hi" },
        " ",
        k(),
      ),
    ).toEqual({ kind: "engine", input: { type: "next" } });
  });

  test("arrow keys are ignored on narration", () => {
    expect(
      dispatchStageInput({ kind: "narration", text: "x" }, "", k({ upArrow: true })),
    ).toBeNull();
  });
});

describe("dispatchStageInput — hubMenu", () => {
  const snapshot: HubSnapshot = {
    ...emptyHub,
    activities: [
      { id: "study", kind: "script", title: "Study", cost: 1, available: true },
      {
        id: "party",
        kind: "script",
        title: "Party",
        cost: 1,
        available: false,
        lockedReason: "shut",
      },
    ],
  };

  test("Enter on cursor dispatches doActivity for that id", () => {
    expect(
      dispatchStageInput(
        { kind: "hubMenu", snapshot, cursor: 0 },
        "",
        k({ return: true }),
      ),
    ).toEqual({ kind: "engine", input: { type: "doActivity", id: "study" } });
  });

  test("Down still emits cursorNext (hubMenu uses default dispatcher)", () => {
    expect(
      dispatchStageInput(
        { kind: "hubMenu", snapshot, cursor: 0 },
        "",
        k({ downArrow: true }),
      ),
    ).toEqual({ kind: "ui", action: { kind: "cursorNext" } });
  });
});

describe("dispatchStageInput — scriptComplete", () => {
  test("digit selects script by index", () => {
    const stage: Stage = {
      kind: "scriptComplete",
      completedId: null,
      nextAvailable: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      cursor: 0,
    };
    expect(dispatchStageInput(stage, "2", k())).toEqual({
      kind: "engine",
      input: { type: "select", scriptId: "b" },
    });
  });
});
