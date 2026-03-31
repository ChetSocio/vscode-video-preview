import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';

export class LocalFileServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private files: Map<string, string> = new Map(); // token -> fsPath

  async start(): Promise<number> {
    this.port = await this.getFreePort();

    this.server = http.createServer((req, res) => {
      // Handle CORS preflight
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const token = req.url?.slice(1).split('?')[0]; // strip leading / and query params
      if (!token) { res.writeHead(404); res.end(); return; }

      const filePath = this.files.get(token);
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }

      this.serveFile(req, res, filePath);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => resolve(this.port));
      this.server!.on('error', reject);
    });
  }

  // Register a file and return its access token
  register(fsPath: string): string {
    // Reuse token if already registered
    for (const [token, p] of this.files) {
      if (p === fsPath) return token;
    }
    const token = crypto.randomBytes(16).toString('hex');
    this.files.set(token, fsPath);
    return token;
  }

  unregister(token: string) {
    this.files.delete(token);
  }

  url(token: string): string {
    return `http://127.0.0.1:${this.port}/${token}`;
  }

  getPort(): number {
    return this.port;
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.files.clear();
  }

  private serveFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }

    const total = stat.size;
    const mimeType = this.getMime(path.extname(filePath).toLowerCase());
    const rangeHeader = req.headers['range'];

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 2 * 1024 * 1024 - 1, total - 1);

      if (start >= total || end >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => res.end());
    }
  }

  private getMime(ext: string): string {
    const map: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/mp4',   // Electron handles H.264 from .mov served as mp4
      '.mkv': 'video/mp4',
      '.avi': 'video/mp4',
      '.m4v': 'video/mp4',
      '.ogv': 'video/ogg',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }
}