# Banbu Gomoku (半步五子棋打谱)

[中文](./README.md) · **English**

![Banbu Gomoku](marketing/social-preview-1280x640.png)

A mobile-first Go-Moku / Renju **game-record (kifu) study tool**: record, study, solve problems and play — with the AI engines bundled inside the package so analysis works **offline, on device**.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/gugujiao953-ship-it/banbu-gomoku)](https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/latest)
[![Quality Gate](https://github.com/gugujiao953-ship-it/banbu-gomoku/actions/workflows/quality.yml/badge.svg)](https://github.com/gugujiao953-ship-it/banbu-gomoku/actions/workflows/quality.yml)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Web-blue.svg)](#downloads)

Current stable release: **v1.2.0** (2026-10-15) · see [Releases](https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/latest) for exact version, size and SHA-256.

Built with React + TypeScript (shared core) for the web/PWA and Capacitor for Android.

## Screenshots

| **Record** | **Problems** |
|:---:|:---:|
| ![Record workspace](marketing/screenshots/record.png) | ![Problem training](marketing/screenshots/puzzle.png) |
| **Play vs AI** | **Game library** |
| ![Play vs AI](marketing/screenshots/ai-duel.png) | ![Game library](marketing/screenshots/library.png) |

## Downloads

| | Link | Notes |
| --- | --- | --- |
| **Web / PWA (incl. iOS)** | **[Open the web app](https://gugujiao953-ship-it.github.io/banbu-gomoku/app/)** | Runs in any mobile or desktop browser; add to home screen on iOS for offline use |
| **Android APK** | **[Latest release](https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/latest)** | Every release ships a `.sha256` checksum file |
| Lanzou (China mirror) | [Download](https://wwbwc.lanzouq.com/ihYTE4c6aube) | Password `hrbj` |
| Landing page | [gugujiao953-ship-it.github.io/banbu-gomoku](https://gugujiao953-ship-it.github.io/banbu-gomoku/) | Feature tour and release highlights |

In-app update notes: **Settings → About → What's new in this version**. Full development log: [RELEASE_NOTES.md](./RELEASE_NOTES.md).

## What it does

**Records & study**
- 5–25 line square boards (15 by default), touch input, tap a stone to jump to that move
- Full variation tree: create branches, mark the main line, delete a variation and its subtree
- Branch graph with four tabs (graph / navigate / list / bookmarks), minimap, transposition (same position reached in different move orders) detection
- Coordinates on all four edges, rotation by 90° and mirroring
- Annotations: comments, position text, move-quality labels, board marks (numbers, win/loss, A–E, attack/defence, free text)
- Renju forbidden-move assistance (overline, double-four, double-three) while recording
- Local game library with fast search by title, player or event, and debounced auto-save

**Problems & training**
- Built-in problem library (17 sets, ~6,367 problems) plus import of Kaibao-style 2-D JSON problem sets
- Daily puzzle page, wrong-answer book, per-problem attempt history kept separate from the board
- **VCF challenge**: every move must be a four-threat; rating ladder, three timer modes and three in-game items
- **Puzzle generator**: ordinary / forbidden-move / shape / text problems, 3–100 moves, custom shape drawing, test-play, history
- Achievements and the "soul" collection used to unlock themes, boards, stones and items

**Play & AI**
- Local human-vs-AI games with the full Renju opening rule set (free opening, swap, 3-swap, 5-two, 5-multi, Yamaguchi, Soosõrv-8, Taraguchi-10)
- Custom opening setup: place stones yourself, save the position, or load a record from your library as the opening
- **Rapfi and KataGo engines are bundled in the APK** — no extra download, no network needed; cloud (your own KataGo server) is optional and only used for analysis
- VCF forced-win search with independent proof checking, plus local win-rate / candidate-point analysis

**Utility**
- Image recognition: locate the grid in a screenshot and read stones, colours and move numbers
- Game clock for offline play (Fischer / Bronstein / sudden death / byo-yomi), score and rating ledger
- Board-to-image export with optional move numbers and coordinates
- Single-record backup & restore, encrypted device credential for moving to a new phone
- Installable PWA with offline cache, Android safe-area handling, light/dark themes and many appearance presets

## File formats

Import: `.sgf` / `.fgf`, `.pos` / `.txt` (coordinate lists), `.ren` / `.renjs` / `.wzq` (SGF content), `.renju` / `.json` (native cross-platform format), `.db` / `.dp` (LZ4-compressed DP/DB databases), `.lib` (RenLib binary variation trees, opened through the RenLib WASM core in a worker).

Export: `.sgf` (for RenLib and other tools), `.renju` (full variation tree, comments, marks and metadata).

## Local development

```powershell
npm install
npm run dev          # dev server
npm test             # unit tests
npm run build        # production build (AI assets → typecheck → build → size check)
```

Android (the `android/` folder is a Capacitor native project; JDK 21 and the Android SDK are required — the release script prefers the toolchain inside the project so it does not depend on a global `JAVA_HOME`):

```powershell
npm run android:sync
npm run android:open

cd android
.\gradlew.bat assembleDebug     # debug APK
npm run android:release         # signed release APK (builds web, syncs, verifies metadata)
```

Release process: [docs/Android发布流程.md](./docs/Android发布流程.md). Engine and model assets are placed into the package by build scripts, so a fresh clone builds out of the box.

Visual regression gate (Playwright places real moves at 360×800 and 412×915 touch viewports and verifies coordinates, edits, variations, candidate points and more):

```powershell
node .\qa\mobile-visual.mjs
```

## Repository layout

```
src/          app source (React + TypeScript)
public/       static assets served by the web build
android/      Capacitor Android project (native engine plugins, assets)
scripts/      build, packaging and release tooling
qa/           browser-based regression gates (see qa/README.md)
docs/         documentation (Chinese; reference audits in docs/reference/)
models/       index of the AI models & variants shipped or used (see models/README.md)
marketing/    landing page source, app screenshots and current-release promo assets
```

## Documentation

| Doc | Contents |
| --- | --- |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | version-by-version development log |
| [docs/项目全景说明.md](./docs/项目全景说明.md) | project overview and asset map (Chinese) |
| [docs/Android发布流程.md](./docs/Android发布流程.md) | packaging & release SOP (Chinese) |
| [docs/adr/](./docs/adr) | architecture decision records |
| [docs/reference/](./docs/reference) | reference-software audits (Chinese) |

## Feedback

- **Bugs / feature requests**: [open an issue](https://github.com/gugujiao953-ship-it/banbu-gomoku/issues/new/choose) — templates are provided. Attaching the device report from **Settings → About → Compatibility check** speeds things up a lot.
- **Anything else**: [Discussions](https://github.com/gugujiao953-ship-it/banbu-gomoku/discussions).

## Credits & license

- Record-study workflow inspired by 爱五子棋打谱, RenLib and the SGF ecosystem.
- Problem interaction and problem-set format inspired by 开宝五子棋.
- AI search ideas from SlowRenju and other public projects.

Source code is released under the **MIT License**; third-party names and content remain with their owners (see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)).

This project is a personal vibecoding effort: free, open source, no ads, no in-app purchases.
