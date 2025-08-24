# Video Preview (Player)

Play and view common video formats directly inside VS Code. Uses a Custom Editor with an HTML5 `<video>` element rendered in a Webview.

## Features

- Open video files in-editor with controls (play, pause, seek)
- Displays duration and resolution
- Command: **Open with Video Preview** (context menu + Command Palette)
- Remembers state while tab is visible (retainContextWhenHidden)

## Limitations

- **Codec support** depends on VS Code's embedded Chromium and OS codecs.
- Some containers (e.g., MKV) may not play if the codec is unsupported.

## Usage

- Right-click a video → **Open With...** → **Video Preview**
- Or run **Open with Video Preview** and pick a file

## Dev

- `npm install`
- `npm run compile`
- Press `F5` to launch the Extension Development Host

## Pack

- Install `vsce` → `npm i -g @vscode/vsce`
- `npm run compile && vsce package`
