# VS Code Video Player Extension

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://marketplace.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE.md)

#### By BatchNepal Consultancy Pvt. Ltd

Play **MP4, WebM, MOV, MKV, and AVI** videos directly inside VS Code — with full audio, no file size limits, and a clean player UI.

### Demos

![BNPL Video Player Demo 1](https://sgp1.digitaloceanspaces.com/batchassets/shottr/SCR-20260401-630p.png)
![Video Player Demo 2](https://sgp1.digitaloceanspaces.com/batchassets/shottr/SCR-20260401-643p.png)

---

## Features

- **Full audio playback** — MP4, MOV, MKV, AVI, WebM. Automatically extracts audio via ffmpeg when needed.
- **No file size limits** — videos stream via a local server, nothing loaded into memory.
- **All major formats** — MP4, WebM, MOV, MKV, AVI, M4V.
- **Clean player UI** — auto-hide controls, progress bar with time tooltip, volume slider, resolution badge.
- **Playback speed** — cycle through 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×.
- **10-second skip** — forward and backward buttons.
- **Picture-in-Picture** — float the video while you work.
- **Open in external player** — one click to open in your system player.
- **Copy file path** — instantly copy the full file path to clipboard.
- **Right-click context menu** — quick access to all controls.

---

## Audio Support

Most VS Code video extensions have no audio — because VS Code's webview uses Chromium, which excludes AAC patent licensing.

This extension solves it using **ffmpeg** to extract audio in the background. Video plays immediately while audio loads within seconds.

**ffmpeg is required for audio on MP4, MOV, MKV, and AVI files.**

### Install ffmpeg

**macOS:**

```bash
brew install ffmpeg
```

**Linux:**

```bash
sudo apt install ffmpeg
```

**Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

WebM plays natively — no ffmpeg needed.

---

## Supported Formats

| Format | Video | Audio |
|--------|-------|-------|
| `.mp4` | ✅ | ✅ (requires ffmpeg) |
| `.webm` | ✅ | ✅ |
| `.mov` | ✅ | ✅ (requires ffmpeg) |
| `.mkv` | ✅ | ✅ (requires ffmpeg) |
| `.avi` | ✅ | ✅ (requires ffmpeg) |
| `.m4v` | ✅ | ✅ (requires ffmpeg) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `J` | Back 10 seconds |
| `→` / `L` | Forward 10 seconds |
| `M` | Mute / Unmute |
| `P` | Picture-in-Picture |
| `F` | Fullscreen |

---

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/) or manually:

```bash
code --install-extension vscode-video-preview-0.1.0.vsix
```

---

## Requirements

- VS Code `1.90.0` or higher
- ffmpeg (optional — required for audio on MP4, MOV, MKV, AVI)

---

## Contribution

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature-name`)
3. Commit your changes (`git commit -m 'Add new feature'`)
4. Push to the branch (`git push origin feature-name`)
5. Submit a Pull Request

Report issues or feature requests on [GitHub](https://github.com/ChetSocio/vscode-video-preview/issues).

---

## License

MIT License. See [LICENSE.md](LICENSE.md) for details.

---

## Author

[BatchNepal Consultancy Pvt. Ltd.](https://batchnepal.com)
