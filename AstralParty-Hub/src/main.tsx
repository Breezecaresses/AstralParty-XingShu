import React from "react";
import ReactDOM from "react-dom/client";
import { isTauriRuntime } from "./shared/runtime";

if (typeof window !== "undefined" && (isTauriRuntime() || import.meta.env.MODE === "launcher")) {
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );
}

const isSplashWindow =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("window") === "splash";

if (isSplashWindow && typeof document !== "undefined") {
  document.documentElement.classList.add("xingshu-splash-window");
  document.documentElement.style.background = "transparent";
  document.body.classList.add("xingshu-splash-window");
  document.body.style.background = "transparent";
}

async function mount(root: ReactDOM.Root) {
  try {
    if (isSplashWindow) {
      const { SplashWindowApp } = await import("./pages/launcher/SplashWindowApp");
      root.render(
        <React.StrictMode>
          <SplashWindowApp />
        </React.StrictMode>,
      );
      return;
    }

    const { default: App } = import.meta.env.MODE === "launcher"
      ? await import("./app/LauncherApp")
      : await import("./App");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch {
    if (isSplashWindow) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("finish_splash_and_show_main");
      } catch {
        // Ignore if not running in Tauri runtime.
      }
      return;
    }
    const zh = navigator.language.toLowerCase().startsWith("zh");
    root.render(
      <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
        <p role="alert">{zh ? "星枢界面加载失败，请重试。" : "XingShu could not load. Please retry."}</p>
        <button type="button" onClick={() => window.location.reload()}>{zh ? "重新加载" : "Reload"}</button>
      </main>,
    );
  }
}

const rootEl = document.getElementById("root");
if (rootEl) void mount(ReactDOM.createRoot(rootEl));
