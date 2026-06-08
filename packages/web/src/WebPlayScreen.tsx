import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Engine, createInitialState } from "@rpg-harness/engine";
import type {
  AssetSpec,
  ComposedState,
  Game,
  HubSnapshot,
  Input,
  Output,
} from "@rpg-harness/engine";
import {
  applyOutput,
  applyUiAction,
  initialModel,
  makeErrorModel,
  type BacklogEntry,
  type ScreenModel,
  type Stage,
  type UiAction,
} from "@rpg-harness/frontend-core";
import { VisualLayer } from "./VisualLayer";

// The browser twin of packages/cli/src/components/PlayScreen.tsx. Same
// engine pump (new Engine → run() → next(input)), same screen-model
// reducer from @rpg-harness/frontend-core — only the shell differs: DOM
// instead of ink, clicks instead of useInput, and no fs (hot-reload and
// disk saves are gone; persistence is injected via onState).
type ModelAction =
  | { kind: "reset"; model: ScreenModel }
  | { kind: "apply"; output: Output }
  | { kind: "ui"; action: UiAction };

function modelReducer(model: ScreenModel, action: ModelAction): ScreenModel {
  if (action.kind === "reset") return action.model;
  if (action.kind === "ui") return applyUiAction(model, action.action);
  return applyOutput(model, action.output);
}

interface Props {
  game: Game;
  assetUrls: Record<string, string>;
  initialState?: ComposedState;
  onState?: (state: ComposedState) => void;
  onExit?: () => void;
}

export function WebPlayScreen({
  game,
  assetUrls,
  initialState,
  onState,
  onExit,
}: Props) {
  const [model, dispatch] = useReducer(modelReducer, initialModel);
  const engineRef = useRef<Engine | null>(null);
  const runnerRef = useRef<AsyncGenerator<Output, void, Input> | null>(null);
  const processingRef = useRef(false);
  const [showBacklog, setShowBacklog] = useState(false);

  const assetMap = useRef(
    new Map((game.assets ?? []).map((a) => [a.path, a] as const)),
  ).current;

  const commit = useCallback(
    (res: IteratorResult<Output, void>) => {
      if (res.done) {
        dispatch({ kind: "apply", output: { type: "gameEnd" } });
      } else {
        dispatch({ kind: "apply", output: res.value });
      }
      const engine = engineRef.current;
      if (engine && onState) onState(engine.getState());
    },
    [onState],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const engine = new Engine(game, initialState ?? createInitialState(game));
        const runner = engine.run();
        engineRef.current = engine;
        runnerRef.current = runner;
        const res = await runner.next();
        if (cancelled) return;
        commit(res);
      } catch (err) {
        if (cancelled) return;
        dispatch({ kind: "reset", model: makeErrorModel(err as Error) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot once per (game, initialState). commit is stable enough; the
    // engine is rebuilt only when the game identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, initialState]);

  const sendInput = useCallback(
    async (input: Input) => {
      if (processingRef.current) return;
      const runner = runnerRef.current;
      if (!runner) return;
      processingRef.current = true;
      try {
        commit(await runner.next(input));
      } catch (err) {
        dispatch({ kind: "reset", model: makeErrorModel(err as Error) });
      } finally {
        processingRef.current = false;
      }
    },
    [commit],
  );

  // Keyboard: Space/Enter advances text beats; Esc exits. Selection on
  // choice/hub/scriptComplete is click-driven (each option carries its
  // own index/id), so no cursor key-walking is needed here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onExit) {
        onExit();
        return;
      }
      if (showBacklog) return;
      const k = model.stage.kind;
      if ((e.key === " " || e.key === "Enter") && (k === "narration" || k === "dialogue")) {
        e.preventDefault();
        void sendInput({ type: "next" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model.stage.kind, showBacklog, sendInput, onExit]);

  return (
    <div className="play-root">
      <VisualLayer visuals={model.visuals} assetMap={assetMap} assetUrls={assetUrls} />
      {model.stage.kind === "hubMenu" && (
        <StatusBar snapshot={model.stage.snapshot} />
      )}
      <div className="stage-area">
        <StageView stage={model.stage} onInput={sendInput} />
      </div>
      <div className="hud">
        {onExit && (
          <button className="hud-btn" onClick={onExit}>
            ← 主菜单
          </button>
        )}
        {model.backlog.length > 0 && (
          <button className="hud-btn" onClick={() => setShowBacklog(true)}>
            回看
          </button>
        )}
      </div>
      {showBacklog && (
        <BacklogOverlay entries={model.backlog} onClose={() => setShowBacklog(false)} />
      )}
    </div>
  );
}

function StageView({
  stage,
  onInput,
}: {
  stage: Stage;
  onInput: (input: Input) => void;
}) {
  switch (stage.kind) {
    case "loading":
      return <div className="dialogue-box">読み込み中…</div>;
    case "error":
      return (
        <div className="dialogue-box error">
          <strong>エラー</strong>
          <pre>{stage.message}</pre>
        </div>
      );
    case "narration":
      return (
        <div className="dialogue-box clickable" onClick={() => onInput({ type: "next" })}>
          <p className="narration-text">{stage.text}</p>
          <div className="advance-hint">▼ クリック / Space</div>
        </div>
      );
    case "dialogue":
      return (
        <div className="dialogue-box clickable" onClick={() => onInput({ type: "next" })}>
          <div className="speaker">{stage.speakerName}</div>
          <p className="dialogue-text">{stage.text}</p>
          <div className="advance-hint">▼ クリック / Space</div>
        </div>
      );
    case "choice":
      return (
        <div className="choice-panel">
          {stage.prompt && <div className="choice-prompt">{stage.prompt}</div>}
          <ul className="option-list">
            {stage.options.map((opt, i) => (
              <li key={i}>
                <button
                  className="option-btn"
                  disabled={!opt.available}
                  onClick={() => onInput({ type: "choose", index: i })}
                  title={opt.lockedReason ?? ""}
                >
                  <span>{opt.text}</span>
                  {!opt.available && opt.lockedReason && (
                    <span className="locked-reason">🔒 {opt.lockedReason}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    case "hubMenu":
      return (
        <div className="hub-panel">
          <ul className="activity-list">
            {stage.snapshot.activities.map((a) => (
              <li key={a.id}>
                <button
                  className="activity-btn"
                  disabled={!a.available}
                  onClick={() => onInput({ type: "doActivity", id: a.id })}
                  title={a.lockedReason ?? ""}
                >
                  <div className="activity-head">
                    <span className="activity-title">{a.title}</span>
                    {a.cost > 0 && <span className="activity-cost">⏳{a.cost}</span>}
                  </div>
                  {a.description && <div className="activity-desc">{a.description}</div>}
                  {a.effectsHint && <div className="activity-hint">{a.effectsHint}</div>}
                  {!a.available && a.lockedReason && (
                    <div className="locked-reason">🔒 {a.lockedReason}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    case "scriptComplete":
      return (
        <div className="choice-panel">
          {stage.nextAvailable.length === 0 ? (
            <div className="choice-prompt">（次の物語はまだない）</div>
          ) : (
            <ul className="option-list">
              {stage.nextAvailable.map((s) => (
                <li key={s.id}>
                  <button
                    className="option-btn"
                    onClick={() => onInput({ type: "select", scriptId: s.id })}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "ended":
      return (
        <div className="ended-panel">
          <div className="ended-title">― 終 ―</div>
          {stage.reason && <div className="ended-reason">{stage.reason}</div>}
        </div>
      );
  }
}

function StatusBar({ snapshot }: { snapshot: HubSnapshot }) {
  return (
    <div className="status-bar">
      <span className="status-day">
        Day {snapshot.day}/{snapshot.maxDay} · {snapshot.slotName}
      </span>
      {snapshot.stats.map((s) => (
        <span key={s.id} className="status-stat">
          {s.name} {s.value}/{s.max}
        </span>
      ))}
      {snapshot.affections.map((a) => (
        <span key={a.id} className="status-affection">
          {a.name} ♥{a.value}
        </span>
      ))}
    </div>
  );
}

function BacklogOverlay({
  entries,
  onClose,
}: {
  entries: BacklogEntry[];
  onClose: () => void;
}) {
  return (
    <div className="backlog-overlay" onClick={onClose}>
      <div className="backlog-inner" onClick={(e) => e.stopPropagation()}>
        <div className="backlog-head">
          <span>回看</span>
          <button className="hud-btn" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="backlog-scroll">
          {entries.map((entry, i) => {
            if (entry.kind === "sceneBreak") return <hr key={i} className="scene-break" />;
            if (entry.kind === "dialogue")
              return (
                <p key={i} className="backlog-dialogue">
                  <strong>{entry.speakerName}</strong>：{entry.text}
                </p>
              );
            return (
              <p key={i} className="backlog-narration">
                {entry.text}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
