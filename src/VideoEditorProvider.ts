import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { LocalFileServer } from './LocalFileServer';

const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/snap/bin/ffmpeg',
  'ffmpeg',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
];

const NEEDS_TRANSCODE = new Set(['.webm', '.mkv', '.avi', '.ogv']);
const NEEDS_AUDIO_EXTRACT = new Set(['.mp4', '.mov', '.m4v']);

export class VideoEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'videoPreview.viewer';
  private static ffmpegBin: string | null | undefined = undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: LocalFileServer
  ) { }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => { } };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const port = this.server.getPort();

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ]
    };

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'videoEditor.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
    const filename = path.basename(document.uri.fsPath);
    const nonce = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(document.uri.fsPath).toLowerCase();

    const videoToken = this.server.register(document.uri.fsPath);
    const videoUrl = this.server.url(videoToken);

    const needsTranscode = NEEDS_TRANSCODE.has(ext);
    const needsAudio = NEEDS_AUDIO_EXTRACT.has(ext);
    const ffmpegBin = (needsTranscode || needsAudio) ? await this.findFfmpeg() : null;
    const willTranscode = needsTranscode && ffmpegBin !== null;
    const willExtractAudio = needsAudio && ffmpegBin !== null;

    webview.html = this.getHtml({
      webview, scriptUri, styleUri, filename, nonce, port,
      willExtractAudio: willExtractAudio || willTranscode,
      showNoFfmpegWarn: (needsTranscode || needsAudio) && !ffmpegBin
    });

    let audioToken: string | null = null;

    const disposable = webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            // Webview ready — send video URL
            if (!willTranscode) {
              webview.postMessage({ type: 'video_src', src: videoUrl });
            }
            break;
          case 'error':
            vscode.window.showErrorMessage(`Video Preview: ${msg.message}`);
            break;
          case 'command':
            if (msg.command === 'openExternal') {
              await vscode.env.openExternal(document.uri);
            } else if (msg.command === 'copyPath') {
              await vscode.env.clipboard.writeText(document.uri.fsPath);
              vscode.window.showInformationMessage('File path copied.');
            }
            break;
          case 'position':
            await this.context.workspaceState.update(
              `videoPreview:lastPosition:${document.uri.fsPath}`,
              Number(msg.seconds) || 0
            );
            break;
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Video Preview error: ${e?.message ?? e}`);
      }
    });

    if (willTranscode && ffmpegBin) {
      this.transcodeToMp4(ffmpegBin, document.uri.fsPath)
        .then((mp4Path) => {
          const mp4Token = this.server.register(mp4Path);
          webview.postMessage({ type: 'video_src', src: this.server.url(mp4Token) });
          return this.extractAudio(ffmpegBin, document.uri.fsPath);
        })
        .then((audioPath) => {
          audioToken = this.server.register(audioPath);
          webview.postMessage({ type: 'audio_ready', src: this.server.url(audioToken) });
        })
        .catch(() => webview.postMessage({ type: 'audio_failed' }));
    } else if (willExtractAudio && ffmpegBin) {
      this.extractAudio(ffmpegBin, document.uri.fsPath)
        .then((audioPath) => {
          audioToken = this.server.register(audioPath);
          webview.postMessage({ type: 'audio_ready', src: this.server.url(audioToken) });
        })
        .catch(() => webview.postMessage({ type: 'audio_failed' }));
    }

    webviewPanel.onDidDispose(() => {
      disposable.dispose();
      this.server.unregister(videoToken);
      if (audioToken) this.server.unregister(audioToken);
    });
  }

  private async findFfmpeg(): Promise<string | null> {
    if (VideoEditorProvider.ffmpegBin !== undefined) {
      return VideoEditorProvider.ffmpegBin;
    }
    for (const bin of FFMPEG_PATHS) {
      if (await this.testBin(bin)) {
        VideoEditorProvider.ffmpegBin = bin;
        return bin;
      }
    }
    VideoEditorProvider.ffmpegBin = null;
    return null;
  }

  private testBin(bin: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(bin, ['-version'], { timeout: 5000 }, (err) => resolve(!err));
    });
  }

  private transcodeToMp4(ffmpegBin: string, inputPath: string): Promise<string> {
    const hash = crypto.createHash('md5').update(inputPath).digest('hex').slice(0, 10);
    const tmpDir = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
    const outPath = path.join(tmpDir, `vscode-preview-video-${hash}.mp4`);

    if (fs.existsSync(outPath)) return Promise.resolve(outPath);

    return new Promise((resolve, reject) => {
      execFile(ffmpegBin, [
        '-nostdin',
        '-i', inputPath,
        '-c:v', 'libx264',
        '-an',
        '-movflags', '+faststart',
        '-y', outPath
      ], { timeout: 300000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(outPath);
      });
    });
  }

  private extractAudio(ffmpegBin: string, inputPath: string): Promise<string> {
    const hash = crypto.createHash('md5').update(inputPath).digest('hex').slice(0, 10);
    const tmpDir = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
    const outPath = path.join(tmpDir, `vscode-preview-audio-${hash}.mp3`);

    if (fs.existsSync(outPath)) return Promise.resolve(outPath);

    return new Promise((resolve, reject) => {
      execFile(ffmpegBin, [
        '-nostdin',
        '-i', inputPath,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y', outPath
      ], { timeout: 120000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(outPath);
      });
    });
  }

  private getHtml({ webview, scriptUri, styleUri, filename, nonce, port, willExtractAudio, showNoFfmpegWarn }: {
    webview: vscode.Webview;
    scriptUri: vscode.Uri;
    styleUri: vscode.Uri;
    filename: string;
    nonce: string;
    port: number;
    willExtractAudio: boolean;
    showNoFfmpegWarn: boolean;
  }): string {
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} blob: data:`,
      `media-src blob: http://127.0.0.1:${port}`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `connect-src http://127.0.0.1:${port}`
    ].join('; ');

    const fileIconSvg = `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polygon points="10 11 16 14.5 10 18 10 11" fill="currentColor" stroke="none"/></svg>`;

    const topBar = willExtractAudio
      ? `<div class="transcode-bar" id="transcodeBar"><div class="transcode-spinner"></div><span>Extracting audio for playback...</span></div>`
      : showNoFfmpegWarn
        ? `<div class="transcode-bar warn" id="transcodeBar"><span>⚠ Install ffmpeg for audio support: <code>brew install ffmpeg</code></span></div>`
        : '';

    return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${filename}</title>
</head>
<body>
  <div class="player-root" id="playerRoot">
    ${topBar}

    <div class="video-wrapper" id="videoWrapper">
      <video id="player" class="loading" preload="metadata" playsinline muted>
        <p class="codec-error">Unsupported format. Try opening in an external player.</p>
      </video>
      <div class="video-loading-spinner" id="videoSpinner">
        <div class="transcode-spinner"></div>
      </div>
      <div id="playPauseOverlay" class="play-overlay"></div>
      <div class="overlay-top">
        <div class="filename-row">
          ${fileIconSvg}
          <span class="filename-badge">${filename}</span>
        </div>
      </div>
      <div class="progress-section">
        <div class="progress-wrap" id="progressWrap">
          <div class="progress-bg" id="progressBg">
            <div class="progress-fill" id="progressFill"></div>
            <div class="progress-thumb" id="progressThumb"></div>
          </div>
          <span class="time-tooltip" id="timeTooltip">0:00</span>
        </div>
      </div>
    </div>

    <div class="controls-bar">
      <div class="controls-left">
        <button class="ctrl" id="playBtn" title="Play / Pause (Space)"></button>
        <button class="ctrl" id="muteBtn" title="Mute (M)"></button>
        <div class="volume-wrap">
          <input type="range" id="volumeSlider" class="volume-slider" min="0" max="1" step="0.02" value="1">
        </div>
        <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
      </div>
      <div class="controls-right">
      <!-- After time display in controls-left -->
      <button class="ctrl" id="backBtn" title="Back 10s">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5V1L7 6l5 5V7a7 7 0 1 1-7 7h-2a9 9 0 1 0 9-9z"/><text x="7.5" y="16.5" font-size="6" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">10</text></svg>
      </button>
      <button class="ctrl" id="fwdBtn" title="Forward 10s">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5V1l5 5-5 5V7a7 7 0 1 0 7 7h2a9 9 0 1 1-9-9z"/><text x="7.5" y="16.5" font-size="6" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">10</text></svg>
      </button>

      <!-- In controls-right, before pipBtn -->
      <button class="ctrl speed-btn" id="speedBtn" title="Playback Speed">1×</button>
        <span class="res-badge" id="resBadge"></span>
        <button class="ctrl" id="pipBtn" title="Picture-in-Picture (P)"></button>
        <button class="ctrl" id="fsBtn" title="Fullscreen (F)"></button>
      </div>
    </div>

    <div class="action-bar">
      <button class="action-btn" id="openExternal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Open in External Player
      </button>
      <button class="action-btn" id="copyPath">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy File Path
      </button>
    </div>

    <div class="context-menu" id="contextMenu"></div>
    <div id="footer">Made with ❤️ by <a href="https://batchnepal.com?utm_source=vs_code&utm_campaign=video_player" target="_blank" rel="noopener">BatchNepal Pvt. Ltd.</a></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}