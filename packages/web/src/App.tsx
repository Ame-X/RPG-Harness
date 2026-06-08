import React, { useCallback, useMemo, useState } from "react";
import type { ComposedState, Game } from "@rpg-harness/engine";
import { listGames, loadWebGame } from "./loadGame";
import { clearState, hasSave, loadState, saveState } from "./session";
import { WebPlayScreen } from "./WebPlayScreen";

interface Loaded {
  id: string;
  game: Game;
  assetUrls: Record<string, string>;
  initialState?: ComposedState;
}

export function App() {
  // listGames() is build-time-constant, but hasSave() reads localStorage,
  // so the picker re-derives save badges whenever we bump `tick`.
  const games = useMemo(() => listGames(), []);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback((id: string, fresh: boolean) => {
    try {
      if (fresh) clearState(id);
      const saved = fresh ? null : loadState(id);
      const { game, assetUrls } = loadWebGame(id);
      setLoaded({
        id,
        game,
        assetUrls,
        ...(saved ? { initialState: saved } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));
    }
  }, []);

  const exit = useCallback(() => {
    setLoaded(null);
    setTick((t) => t + 1);
  }, []);

  if (error) {
    return <pre className="boot-error">{error}</pre>;
  }

  if (loaded) {
    return (
      <WebPlayScreen
        key={loaded.id + (loaded.initialState ? ":resume" : ":new")}
        game={loaded.game}
        assetUrls={loaded.assetUrls}
        {...(loaded.initialState ? { initialState: loaded.initialState } : {})}
        onState={(s) => saveState(loaded.id, s)}
        onExit={exit}
      />
    );
  }

  return (
    <div className="picker">
      <h1 className="picker-title">RPG-Harness</h1>
      <p className="picker-sub">headless RPG Maker — web</p>
      <ul className="picker-list" key={tick}>
        {games.map((g) => {
          const saved = hasSave(g.id);
          return (
            <li key={g.id} className="picker-row">
              <button className="picker-btn" onClick={() => start(g.id, !saved)}>
                <span>{g.title}</span>
                <span className="picker-action">{saved ? "続きから ▸" : "はじめる ▸"}</span>
              </button>
              {saved && (
                <button
                  className="picker-fresh"
                  title="セーブを消して最初から"
                  onClick={() => start(g.id, true)}
                >
                  最初から
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
