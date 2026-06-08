import React from "react";
import type { AssetSpec, VisualState } from "@rpg-harness/engine";

interface Props {
  visuals: VisualState;
  assetMap: Map<string, AssetSpec>;
  assetUrls: Record<string, string>;
}

// The VN visual stack: bg fills the stage, portraits sit in a row above
// the dialogue box, an active cg overlays everything. Each layer resolves
// its VisualState asset path → a build-time image URL (assetUrls). When no
// image exists (e.g. portraits that ship only tui.txt), we fall back to the
// asset's placeholder text so the scene still reads.
export function VisualLayer({ visuals, assetMap, assetUrls }: Props) {
  const portraitSlots = Object.entries(visuals.portraits).filter(
    ([, p]) => p !== null,
  ) as Array<[string, string]>;

  return (
    <div className="visual-layer">
      <Layer kind="bg" path={visuals.bg} assetMap={assetMap} assetUrls={assetUrls} />
      {portraitSlots.length > 0 && (
        <div className="portrait-row">
          {portraitSlots.map(([slot, path]) => (
            <Layer
              key={slot}
              kind="portrait"
              path={path}
              assetMap={assetMap}
              assetUrls={assetUrls}
            />
          ))}
        </div>
      )}
      {visuals.cg !== null && (
        <Layer kind="cg" path={visuals.cg} assetMap={assetMap} assetUrls={assetUrls} />
      )}
    </div>
  );
}

function Layer({
  kind,
  path,
  assetMap,
  assetUrls,
}: {
  kind: "bg" | "portrait" | "cg";
  path: string | null;
  assetMap: Map<string, AssetSpec>;
  assetUrls: Record<string, string>;
}) {
  if (path === null) return null;
  const url = assetUrls[path];
  if (url) {
    return (
      <img
        className={`layer layer-${kind}`}
        src={url}
        alt={assetMap.get(path)?.placeholder ?? path}
        draggable={false}
      />
    );
  }
  const placeholder = assetMap.get(path)?.placeholder ?? path;
  return <div className={`layer layer-${kind} layer-placeholder`}>{placeholder}</div>;
}
