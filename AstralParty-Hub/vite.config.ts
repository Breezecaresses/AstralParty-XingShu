import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const launcher = mode === 'launcher';
  return {
  base: launcher ? '/' : process.env.VITE_BASE || '/',
  publicDir: launcher && command === 'build' ? false : 'public',
  build: { outDir: launcher ? 'dist-launcher' : 'dist' },
  plugins: [{
    name: 'launcher-artwork-catalog',
    enforce: 'pre',
    transform(source, id) {
      if (!launcher || !id.endsWith('/src/shared/gameCatalog.generated.json')) return;
      const catalog = JSON.parse(source) as {
        assets: Record<string, string>;
        spineAssets?: Record<string, Record<string, unknown>>;
      };
      catalog.assets = Object.fromEntries(Object.entries(catalog.assets)
        .filter(([, url]) => url.startsWith('/catalog/video/') || url.startsWith('/catalog/spine/')));
      if (catalog.spineAssets) {
        for (const spine of Object.values(catalog.spineAssets)) {
          delete spine.images;
          delete spine.poster;
        }
      }
      return JSON.stringify(catalog);
    },
  }, react(), {
    name: 'launcher-public-assets',
    apply: 'build',
    generateBundle() {
      if (!launcher) return;
      for (const fileName of [
        'brand/xingshu.svg',
        'brand/xingshu-mark.svg',
        'brand/astral-party-logo-zh.png',
        'brand/astral-party-logo-en.png',
        'cards/card_fallback.svg',
      ]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(`./public/${fileName}`, import.meta.url)) });
      }
    },
  }],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8769',
      '/auth': 'http://127.0.0.1:8769',
      '/account': 'http://127.0.0.1:8769',
    },
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  };
});
