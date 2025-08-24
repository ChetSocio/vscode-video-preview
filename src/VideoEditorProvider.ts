import * as vscode from 'vscode';
import * as path from 'path';

export class VideoEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'videoPreview.viewer';

  constructor(private readonly context: vscode.ExtensionContext) { }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => { } };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg');

    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.file(path.dirname(document.uri.fsPath))
      ]
    };

    const videoSrc = webview.asWebviewUri(document.uri);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'videoEditor.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));

    const filename = path.basename(document.uri.fsPath);

    webview.html = this.getHtml({ webview, videoSrc, scriptUri, styleUri, filename });

    const disposable = webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'error':
            vscode.window.showErrorMessage(`Video Preview: ${msg.message}`);
            break;

          case 'command':
            if (msg.command === 'openExternal') {
              await vscode.env.openExternal(document.uri);
            } else if (msg.command === 'copyPath') {
              await vscode.env.clipboard.writeText(document.uri.fsPath);
              vscode.window.showInformationMessage('File path copied to clipboard.');
            }
            break;

          case 'position':
            const seconds = Number(msg.seconds) || 0;
            await this.context.workspaceState.update(`videoPreview:lastPosition:${document.uri.fsPath}`, seconds);
            break;

          case 'snapshot':
            const b64 = (msg.data as string).replace(/^data:image\/png;base64,/, '');
            const bin = Buffer.from(b64, 'base64');
            const fileName = `video-snapshot-${Date.now()}.png`;
            const targetDir = this.context.globalStorageUri || this.context.extensionUri;
            const target = vscode.Uri.joinPath(targetDir, fileName);
            await vscode.workspace.fs.writeFile(target, new Uint8Array(bin));
            const pick = await vscode.window.showInformationMessage('Snapshot saved', 'Reveal in Explorer', 'Open');
            if (pick === 'Reveal in Explorer') {
              await vscode.commands.executeCommand('revealFileInOS', target);
            } else if (pick === 'Open') {
              await vscode.commands.executeCommand('vscode.open', target);
            }
            break;
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Video Preview error: ${e?.message ?? e}`);
      }
    });

    webviewPanel.onDidDispose(() => disposable.dispose());
  }

  private getHtml({ webview, videoSrc, scriptUri, styleUri, filename }: { webview: vscode.Webview; videoSrc: vscode.Uri; scriptUri: vscode.Uri; styleUri: vscode.Uri; filename: string; }): string {
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} blob: data:`,
      `media-src ${webview.cspSource} blob:`,
      `script-src 'nonce-abc123'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`
    ].join('; ');

    const nonce = 'abc123';

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet" />
        <title>Video Preview</title>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="filename">${filename}</div>
          </div>

          <div class="video-wrapper">
            <video id="player" class="video" controls preload="metadata">
              <source src="${videoSrc}" />
              Your system does not support this codec. Try opening with an external player.
            </video>

            <!-- Netflix-style play/pause overlay -->
            <div id="playPauseOverlay" class="play-overlay">
              <svg width="96" height="96" viewBox="0 0 24 24" fill="#e50914">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>

          <div class="actions" style="margin-left:46px;">
            <button id="openExternal" class="apple-btn">Open in External Player</button>
            <button id="copyPath" class="apple-btn">Copy File Path</button>
          </div>

          <div id="footer" style="margin-top:40px;">Thank you for using this plugin. Made with ❤️ by <a href="https://batchnepal.com?utm_source=vs_code&utm_campaign=video_player" target="_blank">BatchNepal Pvt. Ltd</a></div>
        </div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}
