# MediaBender

<p align="center">
  <img src="assets/Hero.jpg" alt="MediaBender" width="100%" />
</p>

<p align="center">
  <strong>AI-assisted FFmpeg video transcoding.</strong>
</p>

Desktop app: Tauri v2 + SolidJS + Rust. You bring FFmpeg. An OpenAI-compatible API (or a local server) writes the argv; you review and approve before anything is encoded.

## Download

Installers (Windows NSIS, macOS DMG, Linux AppImage): [GitHub Releases](https://github.com/NotGovernor/MediaBender/releases).

Until the first `v*` tag finishes, run from source (Develop below).

macOS and Linux builds are not well tested.

Unsigned binaries: Windows SmartScreen → More info → Run anyway. macOS Gatekeeper → right-click Open.

## FFmpeg

MediaBender does **not** ship FFmpeg. Install it yourself, then set/verify paths in Settings.

- Windows: [ffmpeg.org/download.html](https://ffmpeg.org/download.html) or `winget install FFmpeg`
- macOS: `brew install ffmpeg`
- Linux: distro package (`ffmpeg` + `ffprobe` on PATH)

## Develop

Requires Node.js 20+, Rust (rustup), and platform Tauri deps (Windows: VS Build Tools + WebView2).

```bash
npm install
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri dev
```

Do not share `node_modules` between WSL and Windows (`lightningcss` is native).

## License

See [`LICENSE`](LICENSE). GitHub may label this “Other”; that is the three-layer waiver + MIT + estoppel grant, not a missing file.

## Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Code of Adult Conduct).

## Features

- AI-generated FFmpeg argv from ffprobe metadata (OpenAI-compatible providers)
- Scan folders / add files into a Work Queue
- Review, edit args, approve, then batch process
- Live FFmpeg log; Stop cancels and deletes incomplete output
- Settings, guidelines, and queue persist locally
