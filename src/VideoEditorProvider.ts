import * as crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LocalFileServer } from './LocalFileServer';
import { probeMedia } from './MediaProbe';

const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/snap/bin/ffmpeg',
  'ffmpeg',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
];

const TRANSCODE_CONTAINERS = new Set(['.mkv', '.avi', '.ogv']);
const AUDIO_EXTRACT_CONTAINERS = new Set(['.mp4', '.mov', '.m4v']);
const TRANSCODE_VIDEO_CODECS = new Set([
  'prores',
  'mpeg4',
  'hevc',
  'h265',
  'vc1',
  'wmv3',
  'theora',
]);
const EXTRACT_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3', 'alac']);

export class VideoEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'videoPreview.viewer';
  private static ffmpegBin: string | null | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: LocalFileServer
  ) {}

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const port = this.server.getPort();
    const session = new vscode.CancellationTokenSource();
    const cancelFromResolve = token.onCancellationRequested(() => session.cancel());

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'videoEditor.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css')
    );

    const filename = path.basename(document.uri.fsPath);
    const nonce = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(document.uri.fsPath).toLowerCase();
    const videoToken = this.server.register(document.uri.fsPath);
    const videoUrl = this.server.url(videoToken);
    const ffmpegBin = await this.findFfmpeg();
    const mediaInfo = ffmpegBin ? await probeMedia(ffmpegBin, document.uri.fsPath) : null;
    const sourceHasAudio = mediaInfo ? mediaInfo.audioCodec !== null : true;
    const codecNeedsTranscode = mediaInfo?.videoCodec
      ? TRANSCODE_VIDEO_CODECS.has(mediaInfo.videoCodec)
      : false;
    const needsTranscode = TRANSCODE_CONTAINERS.has(ext) || codecNeedsTranscode;
    const willTranscode = needsTranscode && ffmpegBin !== null;
    const needsNativeAudioExtract = sourceHasAudio && (mediaInfo?.audioCodec
      ? EXTRACT_AUDIO_CODECS.has(mediaInfo.audioCodec)
      : AUDIO_EXTRACT_CONTAINERS.has(ext));
    const canFallback = ffmpegBin !== null;
    const lastPosition = this.context.workspaceState.get<number>(
      `videoPreview:lastPosition:${document.uri.fsPath}`,
      0
    );

    webview.html = this.getHtml({
      webview,
      scriptUri,
      styleUri,
      filename,
      nonce,
      port,
    });

    let audioToken: string | null = null;
    let convertedVideoToken: string | null = null;
    let transcodeRequested = willTranscode;

    const extractAudio = async (): Promise<void> => {
      if (!ffmpegBin || !sourceHasAudio || session.token.isCancellationRequested) {
        return;
      }

      webview.postMessage({ type: 'status', message: 'Preparing audio…' });

      try {
        const audioPath = await this.extractAudio(
          ffmpegBin,
          document.uri.fsPath,
          session.token
        );
        if (session.token.isCancellationRequested) {
          return;
        }
        audioToken = this.server.register(audioPath);
        webview.postMessage({ type: 'audio_ready', src: this.server.url(audioToken) });
      } catch (error) {
        if (!session.token.isCancellationRequested) {
          webview.postMessage({
            type: 'audio_failed',
            message: this.errorMessage(error),
          });
        }
      }
    };

    const transcodeAndLoad = async (): Promise<void> => {
      if (!ffmpegBin || session.token.isCancellationRequested) {
        if (!ffmpegBin) {
          webview.postMessage({
            type: 'fatal',
            message: 'This codec is not supported by VS Code. Install ffmpeg to enable fallback playback.',
          });
        }
        return;
      }

      webview.postMessage({ type: 'status', message: 'Preparing compatible video…' });

      try {
        const mp4Path = await this.transcodeToMp4(
          ffmpegBin,
          document.uri.fsPath,
          session.token
        );
        if (session.token.isCancellationRequested) {
          return;
        }
        convertedVideoToken = this.server.register(mp4Path);
        webview.postMessage({
          type: 'video_src',
          src: this.server.url(convertedVideoToken),
          replace: true,
          position: lastPosition,
        });
        await extractAudio();
      } catch (error) {
        if (!session.token.isCancellationRequested) {
          webview.postMessage({
            type: 'fatal',
            message: `Could not prepare this video. ${this.errorMessage(error)}`,
          });
        }
      }
    };

    const disposable = webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            if (willTranscode) {
              void transcodeAndLoad();
              break;
            }

            webview.postMessage({
              type: 'video_src',
              src: videoUrl,
              position: lastPosition,
            });

            if (needsNativeAudioExtract && ffmpegBin) {
              void extractAudio();
            } else if (needsNativeAudioExtract && !ffmpegBin) {
              webview.postMessage({
                type: 'audio_unavailable',
                message: 'Video is playing without audio. Install ffmpeg to enable audio playback.',
              });
            }
            break;

          case 'native_playback_failed':
            if (canFallback && !transcodeRequested) {
              transcodeRequested = true;
              await transcodeAndLoad();
            } else {
              webview.postMessage({
                type: 'fatal',
                message: ffmpegBin
                  ? 'This video codec could not be played.'
                  : 'This video codec is not supported by VS Code. Install ffmpeg to enable fallback playback.',
              });
            }
            break;

          case 'command':
            if (msg.command === 'openExternal') {
              await vscode.env.openExternal(document.uri);
            } else if (msg.command === 'copyPath') {
              await vscode.env.clipboard.writeText(document.uri.fsPath);
            }
            break;

          case 'position':
            await this.context.workspaceState.update(
              `videoPreview:lastPosition:${document.uri.fsPath}`,
              Number(msg.seconds) || 0
            );
            break;
        }
      } catch (error) {
        if (!session.token.isCancellationRequested) {
          webview.postMessage({
            type: 'fatal',
            message: this.errorMessage(error),
          });
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      session.cancel();
      cancelFromResolve.dispose();
      session.dispose();
      disposable.dispose();
      this.server.unregister(videoToken);
      if (audioToken) {
        this.server.unregister(audioToken);
      }
      if (convertedVideoToken) {
        this.server.unregister(convertedVideoToken);
      }
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
      execFile(
        bin,
        ['-version'],
        { timeout: 5000, windowsHide: true },
        (error) => resolve(!error)
      );
    });
  }

  private async transcodeToMp4(
    ffmpegBin: string,
    inputPath: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    const outPath = path.join(
      this.tempDir(),
      `vscode-preview-video-${this.cacheKey(inputPath)}.mp4`
    );

    if (fs.existsSync(outPath)) {
      return outPath;
    }

    const partialPath = outPath.replace(/\.mp4$/, '.partial.mp4');
    this.removeIfExists(partialPath);

    await this.runFfmpeg(
      ffmpegBin,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-an',
        '-movflags',
        '+faststart',
        '-y',
        partialPath,
      ],
      partialPath,
      token
    );

    fs.renameSync(partialPath, outPath);
    return outPath;
  }

  private async extractAudio(
    ffmpegBin: string,
    inputPath: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    const outPath = path.join(
      this.tempDir(),
      `vscode-preview-audio-${this.cacheKey(inputPath)}.mp3`
    );

    if (fs.existsSync(outPath)) {
      return outPath;
    }

    const partialPath = outPath.replace(/\.mp3$/, '.partial.mp3');
    this.removeIfExists(partialPath);

    await this.runFfmpeg(
      ffmpegBin,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-y',
        partialPath,
      ],
      partialPath,
      token
    );

    fs.renameSync(partialPath, outPath);
    return outPath;
  }

  private runFfmpeg(
    ffmpegBin: string,
    args: string[],
    partialPath: string,
    token: vscode.CancellationToken
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (token.isCancellationRequested) {
        reject(new Error('Cancelled'));
        return;
      }

      const child = spawn(ffmpegBin, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cancellation.dispose();
        if (error) {
          this.removeIfExists(partialPath);
          reject(error);
        } else {
          resolve();
        }
      };

      const cancellation = token.onCancellationRequested(() => {
        child.kill();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-64 * 1024);
      });

      child.once('error', (error) => finish(error));
      child.once('close', (code, signal) => {
        if (token.isCancellationRequested) {
          finish(new Error('Cancelled'));
        } else if (code === 0) {
          finish();
        } else {
          const detail = stderr.trim() || `ffmpeg exited with ${signal ?? code}`;
          finish(new Error(detail));
        }
      });
    });
  }

  private cacheKey(inputPath: string): string {
    const stat = fs.statSync(inputPath);
    return crypto
      .createHash('sha256')
      .update(`${inputPath}:${stat.size}:${stat.mtimeMs}:v3`)
      .digest('hex')
      .slice(0, 16);
  }

  private tempDir(): string {
    return process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  }

  private removeIfExists(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.trim() : String(error);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (char) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[char];
    });
  }

  private getHtml({
    webview,
    scriptUri,
    styleUri,
    filename,
    nonce,
    port,
  }: {
    webview: vscode.Webview;
    scriptUri: vscode.Uri;
    styleUri: vscode.Uri;
    filename: string;
    nonce: string;
    port: number;
  }): string {
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `media-src http://127.0.0.1:${port}`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource}`,
      `connect-src http://127.0.0.1:${port}`,
    ].join('; ');

    const safeFilename = this.escapeHtml(filename);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${safeFilename}</title>
</head>
<body>
  <main class="player-root" id="playerRoot">
    <section class="video-shell controls-visible" id="videoWrapper">
      <video id="player" preload="metadata" playsinline muted></video>

      <div class="scrim scrim-top"></div>
      <div class="scrim scrim-bottom"></div>

      <header class="top-controls">
        <div class="file-title" title="${safeFilename}">${safeFilename}</div>
        <button class="icon-button" id="moreBtn" type="button" title="More options" aria-label="More options">•••</button>
      </header>

      <div class="loading-layer" id="loadingLayer">
        <div class="spinner"></div>
        <div class="loading-text" id="loadingText">Opening video…</div>
      </div>

      <button class="center-play" id="centerPlay" type="button" aria-label="Play"></button>
      <div class="seek-feedback" id="seekFeedback"></div>

      <div class="error-layer" id="errorLayer" hidden>
        <div class="error-title">Could not play this video</div>
        <div class="error-message" id="errorMessage"></div>
        <button class="error-action" id="errorOpenExternal" type="button">Open externally</button>
      </div>

      <div class="status-pill" id="statusPill" hidden></div>

      <footer class="bottom-controls">
        <div class="timeline" id="progressWrap">
          <div class="timeline-track" id="progressBg">
            <div class="timeline-buffered" id="progressBuffered"></div>
            <div class="timeline-played" id="progressFill"></div>
            <div class="timeline-thumb" id="progressThumb"></div>
          </div>
          <div class="time-tooltip" id="timeTooltip">0:00</div>
        </div>

        <div class="control-row">
          <div class="control-group">
            <button class="icon-button" id="playBtn" type="button" title="Play / Pause (Space)"></button>
            <button class="icon-button" id="muteBtn" type="button" title="Mute (M)"></button>
            <div class="volume-wrap">
              <input id="volumeSlider" class="volume-slider" type="range" min="0" max="1" step="0.02" value="1" aria-label="Volume">
            </div>
            <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
          </div>

          <div class="control-group control-group-right">
            <button class="text-button" id="speedBtn" type="button" title="Playback speed">1×</button>
            <button class="text-button" id="fitBtn" type="button" title="Video sizing">Fit</button>
            <button class="icon-button" id="pipBtn" type="button" title="Picture-in-Picture (P)"></button>
            <button class="icon-button" id="fsBtn" type="button" title="Fullscreen (F)"></button>
          </div>
        </div>
      </footer>

      <div class="context-menu" id="contextMenu"></div>
    </section>
  </main>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
