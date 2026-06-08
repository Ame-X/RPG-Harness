import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Static-only web shell. No backend (unlike studio): the engine is
// bundled into the page and games are baked at build time via
// import.meta.glob in src/loadGame.ts. `vite build` → dist/ → any
// static host (Vercel).
//
// The game folders live at <repo>/examples, two levels above this
// package, so the dev server must be allowed to read them for the
// ?raw / ?url glob imports. fs.allow opens the repo root.
const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5174),
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
