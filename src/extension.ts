import * as vscode from 'vscode';
import { VideoEditorProvider } from './VideoEditorProvider';
import { LocalFileServer } from './LocalFileServer';

export async function activate(context: vscode.ExtensionContext) {
  const server = new LocalFileServer();
  await server.start();
  context.subscriptions.push({ dispose: () => server.stop() });

  const provider = new VideoEditorProvider(context, server);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VideoEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('videoPreview.open', async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickVideoFile());
      if (!target) return;
      await vscode.commands.executeCommand('vscode.openWith', target, VideoEditorProvider.viewType);
    })
  );
}

async function pickVideoFile(): Promise<vscode.Uri | undefined> {
  const res = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'] }
  });
  return res?.[0];
}

export function deactivate() { }