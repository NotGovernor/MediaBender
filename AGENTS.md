# MediaBender — Agent Instructions

## Project Overview
AI-assisted FFmpeg video transcoding desktop app built with **Tauri v2** (Rust backend) + **SolidJS** (frontend) + **Tailwind CSS v4**.

## Design Tokens (Tailwind Theme)
- **Gold**: `#C8B496` (primary accent)
- **Gold Light**: `#D4C4A8`
- **Gold Dark**: `#A89470`
- **Background Primary**: `#0F0F0F`
- **Background Secondary**: `#161616`
- **Background Tertiary**: `#1E1E1E`
- **Background Elevated**: `#252525`
- **Text Primary**: `#E8E8E8`
- **Text Secondary**: `#A0A0A0`
- **Text Muted**: `#6B6B6B`
- **Border**: `#2A2A2A`
- **Danger**: `#D94A4A`
- **Success**: `#34D399` (emerald-400)

## Build Commands

```bash
# Frontend dev (hot reload)
npm run dev

# Frontend production build
npm run build

# Tauri dev (requires platform deps)
npm run tauri dev

# Tauri production build (requires platform deps)
npm run tauri build
```

## Important: Cross-Platform node_modules

**Do NOT share `node_modules` between WSL and Windows.** Native binaries (like `lightningcss`) are platform-specific.

If you switch between environments:
```powershell
# Windows PowerShell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

```bash
# WSL/Linux
rm -rf node_modules package-lock.json
npm install
```

## Windows Build Prerequisites

**Required on Windows:**
1. **Node.js** (v20+) — https://nodejs.org/
2. **Rust** (via rustup) — https://rustup.rs/
3. **Visual Studio Build Tools 2022** with:
   - "Desktop development with C++" workload
   - Windows 10/11 SDK
4. **WebView2 Runtime** — usually pre-installed on Windows 10/11

**Recommended:**
- `npm install -g @tauri-apps/cli` (or use the locally installed one via `npx tauri`)

## Publishing

DefaultGuidelines.md is the author's; do not genericize it in a drive-by.



