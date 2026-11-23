<h1 align="center">AstralParty-XingShu</h1>

<h3 align="center">Thank you for choosing AstralParty-XingShu!</h3>

<p align="center">
  <strong>Feedback &amp; Community: QQ Group <code>1080908767</code> &nbsp;|&nbsp; <a href="https://discord.gg/dxVS6ZF393">Discord</a></strong>
</p>

<p align="center">
  <img src="AstralParty-Hub/public/brand/xingshu.svg" width="128" alt="AstralParty-XingShu" />
</p>

<p align="center">
  Pure Launcher · Modular Plugin · Replay Analyzer · Mod Workshop · Compose Android
</p>

<p align="center">
  <a href="https://github.com/Breezecaresses/AstralParty-XingShu/releases"><img src="https://img.shields.io/github/v/release/Breezecaresses/AstralParty-XingShu?include_prereleases&label=release&color=3b82f6" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Hub-Tauri%202%20%7C%20Rust-orange.svg" alt="Tauri Rust" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%7C%20TypeScript-blue.svg" alt="React TS" />
  <img src="https://img.shields.io/badge/Android-Kotlin%20%7C%20Compose-7f52ff.svg" alt="Kotlin Compose" />
  <img src="https://img.shields.io/badge/Runtime-C%23%20%7C%20.NET-purple.svg" alt="C# .NET" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20Web-lightgrey.svg" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Source%20Available-blue.svg" alt="License: Source Available &amp; Fair Use" /></a>
</p>

<p align="center">
  <a href="https://github.com/Breezecaresses/AstralParty-XingShu/releases/tag/v0.1.8">Download v0.1.8</a> ·
  <a href="https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/">Web Edition</a> ·
  <a href="docs/README.md">Docs &amp; Validation Records</a> ·
  <a href="README.md">English</a> · <a href="README_CN.md">简体中文</a>
</p>

---

## Stable Release

[Download stable v0.1.8](https://github.com/Breezecaresses/AstralParty-XingShu/releases/tag/v0.1.8) ([release notes](docs/records/RELEASE_0.1.8.md)). Both Windows and Android packages target *Astral Party* `3.3.0` (`resource 160`).

| Target | Package / Access | Highlights |
| --- | --- | --- |
| **Windows Desktop** | `XingShu_Hub_0.1.8_x64-setup.exe` / `XingShu_Desktop_0.1.8.zip` | One-click Windows installer or streamlined portable pure-launcher Hub (contains only `Hub/xingshu-hub.exe` + readme). Decoupled from core runtime via remote `core-manifest.json` hot-updates, integrated conflict scan/restore, 4-way concurrent SHA-256 mod caching, redesigned Mod detail modal with in-game emoji reactions, and on-demand installation of **XingShu Official Plugin Mod** (`r8.41` LZ4) + **19 modules**. |
| **Web Edition** | [astralparty-xingshu.lanxichaxu.cn/xingshu-hub](https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/) | Instant browser access for Modrinth-style **Mod / Card / Skin Workshop** discovery & creator uploads, XingShu Platform accounts, UID lookup, `.rep` / match-ID replay analysis, and offline encyclopedia. |
| **Android Launcher** | `XingShu_Android_0.1.8.apk` / `XingShu_Android_0.1.8.zip` | Streamlined Kotlin + Jetpack Compose Material 3 pure launcher (`XingShu_Android_0.1.8.apk` directly, or ZIP containing only `星枢启动器.apk` + usage guide). Now loads remote `android-core-manifest.json` (`CoreRuntimeSpec`) over Shizuku & Wireless/USB ADB so core updates (`android-preview8.36` and beyond) install without reinstalling the APK. |

> [!NOTE]
> The Core Framework (`XingShu Official Plugin Mod`) is now completely independent from both Desktop Hub and Android APKs—future core runtime or game-baseline updates install directly via remote manifests without upgrading the launcher. See the [v0.1.8 release record](docs/records/RELEASE_0.1.8.md) and [packaging guide](docs/guides/RELEASE_PACKAGING.md).

---

## Overview

**AstralParty-XingShu (星枢)** is an open-source multi-platform launcher, mod workshop, replay workstation, and modular in-game runtime suite built for *Astral Party* (吉星派对):

1. **AstralParty-Hub (Desktop & Web)**: Built with Tauri 2 + Rust + React 19 + TypeScript. Launches vanilla clients out of the box or installs modular official/community `.xspkg`/`.zip` mods with single-flight locking, 4-way concurrent EdgeOne-cached downloads, local SHA-256 verification, and atomic backups. Features built-in conflict inspection and vanilla restoration, live in-game room management, `.rep` frame-by-frame replay & board topology playback, platform accounts, and an offline encyclopedia displaying active mod overrides.
2. **XingShu Official Plugin Mod (`r8.41` PC / `android-preview8.36` Android, C# / Unity)**: Independent hot-updatable in-game runtime featuring **19 independently toggleable official modules** (including **Custom Lobby Background**, teammate hand overlay, defense/dodge prediction, battle card point hints, character-select map name display, discard hitbox guard, monster cooldown tracker, free camera zoom, match stats HUD, quick thanks, and FairyGUI-styled native UI center).
3. **Android Pure Launcher (`AndroidInstaller`, Kotlin / Jetpack Compose)**: Rebuilt Material 3 companion app featuring remote `CoreRuntimeSpec` hot-updates, custom XingShu bottom navigation bar, dynamic theme palettes & wallpaper support, Shizuku / ADB runtime installation & restoration, and PE Mod Workshop / card-pack management.

---

## Key Capabilities in v0.1.8

- **Independent Hot-Updatable Core Framework (No Launcher Reinstall Required)**: Both Desktop (`core-manifest.json`) and Android (`android-core-manifest.json` synced via Shizuku IPC & Wireless ADB) treat **XingShu Official Plugin Mod** as an independent hot-updatable core mod alongside custom mods, with strict HTTPS/path/SHA-256 checks and offline baseline fallbacks.
- **Pure Launcher + 19 Official Modules (New: Custom Lobby Background)**: Added module #19 `xingshu.launcher.custom-lobby-bg` for one-click persistent in-game lobby background customization; toggle any module or batch-install all 19 with live progress.
- **EdgeOne CDN Acceleration, LZ4 Compression & Download Reliability**: PC `r8.41` uses LZ4 compression (~`9.3 MB`), backed by EdgeOne CDN caching + BBR, Rust single-flight install locks (fixing repeat-click state oscillation), tab-switch progress rehydration, 4-way concurrent payload fetch, and local SHA-256 caching.
- **Redesigned Mod Detail Modal, Emoji Reactions & Native Official Logo**: Fixed Portal scoping/z-index stacking in Desktop Mods detail modal with animated `EmoteReactionBar` reactions and gallery lightbox, and upgraded LauncherHome with the native transparent dual-language *Astral Party* official logo.
- **Unified Native In-Game Control Center & Replay Analyzer**: Press `F1` (or tap the floating orb) for consistent PC/mobile native FairyGUI controls and 12 remappable hotkeys ([HOTKEYS.md](docs/guides/HOTKEYS.md)); analyze `.rep` or match-ID replays with interactive round charts and step-by-step board playback.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Hub["AstralParty-Hub (Tauri 2 / Rust + React 19)"]
        UI["Launcher & Workshop UI (React + TS)"]
        FSM["Session & Auto-Follow Coordinator"]
        TCPServer["Bridge TCP Server (127.0.0.1:25890)"]
        Workshop["Inline Conflict Scanner & Atomic Mod Installer"]
        UI <--> TCPServer
        UI <--> Workshop
        FSM <--> TCPServer
    end

    subgraph RuntimeSpectator["Bound Spectator Client (Optional)"]
        SpecHook["WatchLogic Hooks"]
        SpecStore["SpectatorStateStore"]
        SpecBridge["Bridge Client (Loopback TCP)"]
        SpecHook --> SpecStore --> SpecBridge
    end

    subgraph RuntimeMain["Main Game Client (Optional XingShu Official Plugin r8.41)"]
        MainBridge["Bridge Client (Loopback TCP)"]
        TruthSource["HandTruthSource Arbiter"]
        Modules["19 Modular Official Plugins & Native UI Center"]
        MainBridge --> TruthSource --> Modules
    end

    subgraph AndroidApp["Android Launcher (Kotlin + Jetpack Compose + localadb / Shizuku)"]
        MobileUI["Compose Material 3 UI & PE Workshop"]
        PayloadMgr["HTTPS + SHA-256 On-Demand Cache"]
        Privileged["Shizuku Binder / Wireless & USB ADB"]
        MobileUI --> PayloadMgr --> Privileged
    end

    TCPServer <== "Loopback TCP (JSON Frames)" ==> SpecBridge
    TCPServer <== "HAND_TRUTH_MIRROR & ROOM" ==> MainBridge
```

---

## Security & Integrity Guarantees

- **Strict Hash & Signature Verification**: Self-updates validate RSA-signed manifests (`xingshu-update.json`); Desktop and Android runtime downloads enforce HTTPS and full SHA-256 verification against pinned channel manifests.
- **Safe Mod Archive Handling**: Desktop `.xspkg` / `.zip` installers reject path traversal, symlinks, and arbitrary executable overwrites while maintaining `.xingshu-backup` / `.xingshu-mods` snapshots for lossless recovery.
- **Authoritative Hand Truth (`HandTruthSource`)**: Mirrors verified co-op hand snapshots strictly over loopback `127.0.0.1` validated against active match heroes without placeholder fabrication.

---

## Directory Structure

```text
AstralParty-XingShu/
├── AstralParty-Hub/                      # Tauri 2 + React 19 Desktop Launcher & Web Workshop
│   ├── src/                              # Launcher, Workshop, Encyclopedia, Replay, Room & Settings UI
│   ├── src-tauri/                        # Rust backend (IPC bridge, inline inspector, SHA-256 installer)
│   └── public/                           # Static brand, encyclopedia media & animated emotes
├── XingShu-Dev/                          # In-game C# Unity modular runtime
│   ├── src/XingShu.Runtime/              # 19 official modules, Native UI Center, HandTruth & Room control
│   └── tools/                            # MSBuild scripts, C# conformance & lifecycle test runners
├── AndroidInstaller/                     # Kotlin + Jetpack Compose Android Pure Launcher
│   ├── app/                              # Compose UI, Shizuku integration, HTTPS SHA-256 cache & tests
│   └── localadb/                         # Wireless/USB ADB protocol module
├── tools/                                # Release packagers, APK builder, signer & Python unit tests
├── docs/                                 # User guides and validation/release records
└── LICENSE                               # AstralParty-XingShu License & Fair Use Terms
```

---

## Build & Setup

> [!NOTE]
> This repository **does not contain** proprietary game binaries, DLLs, signing keystores, or account credentials.

### 1. AstralParty-Hub (Desktop & Web)

- Prerequisites: Node.js 20+, Rust & Cargo (stable), MSVC C++ Build Tools, Microsoft Edge WebView2.

```bash
cd AstralParty-Hub
npm ci

# Build Web Edition
npm run build:web

# Run TypeScript & Rust verification tests
npx tsc --noEmit
npm run test:all
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib

# Build Tauri Desktop Installer / Binary
npx tauri build -- --locked --offline
```

### 2. XingShu Runtime (C# Game Plugin)

- Prerequisites: Visual Studio MSBuild (C# 11 / `.NET Framework 4.0` target), Python 3.x, Mono.Cecil in `XingShu-Dev/tools/lib`.
- Extract `AstralParty.Runtime.dll` from your legally owned game client into `XingShu-Dev/references/` (or pass `AstralPartyRuntimePath`).

```powershell
.\XingShu-Dev\tools\build.ps1 -Configuration Release
```

### 3. Android Pure Launcher (Kotlin / Jetpack Compose)

- Prerequisites: JDK 17, Android SDK (`compileSdk 35`), Gradle 8.9.

```powershell
python tools/build_android_installer.py --help
```

---

## Detailed Documentation

- [docs/README.md](docs/README.md) — Documentation Index & Release / Validation Records
- [RELEASE_0.1.8.md](docs/records/RELEASE_0.1.8.md) — v0.1.8 Release Notes & Independent Core Architecture
- [RELEASE_0.1.7.md](docs/records/RELEASE_0.1.7.md) — v0.1.7 Release Notes & Architecture Changes
- [ANDROID_PHONE_INSTALL.md](docs/guides/ANDROID_PHONE_INSTALL.md) — Android Installation & Recovery Guide
- [HOTKEYS.md](docs/guides/HOTKEYS.md) — In-Game Shortcuts Configuration
- [AUTO_FOLLOW_PROTOCOL.md](docs/guides/AUTO_FOLLOW_PROTOCOL.md) — Auto-Follow Loopback TCP Protocol
- [AUTO_FOLLOW_STATE_MACHINE.md](docs/guides/AUTO_FOLLOW_STATE_MACHINE.md) — 11-State Finite State Machine Specification
- [HAND_TRUTH_SOURCE_ARCHITECTURE.md](docs/guides/HAND_TRUTH_SOURCE_ARCHITECTURE.md) — Hand Truth Single Source of Truth Architecture
- [OVERLAY_LIFECYCLE_RECONCILIATION.md](docs/guides/OVERLAY_LIFECYCLE_RECONCILIATION.md) — Floating Overlay Adaptive Lifecycle Reconciliation
- [local-managed-watcher.md](AstralParty-Hub/docs/local-managed-watcher.md) — Local Managed Watcher Setup
- [extension_channels.md](AstralParty-Hub/docs/specs/extension_channels.md) — Extension Channels & Manifest Boundaries

---

## Disclaimer & License

1. Intended strictly for technical research, local testing, mod management, and community tooling.
2. No proprietary game binaries or commercial game assets are relicensed; official game assets remain copyright of their respective owners.
3. Please abide by official game Terms of Service. Users assume full responsibility for their own usage.
4. Source code in this repository is governed by the [AstralParty-XingShu License & Fair Use Terms](LICENSE) (source-available, personal/non-commercial use, attribution & share-alike for forks).
