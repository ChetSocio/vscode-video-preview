import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';

type ByteRange = {
  start: number;
  end: number;
};

export class LocalFileServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly files = new Map<string, string>();

  async start(): Promise<number> {
    this.port = await this.getFreePort();

    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Cache-Control', 'no-store');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
        res.end();
        return;
      }

      const token = req.url?.slice(1).split('?')[0];
      if (!token) {
        res.writeHead(404);
        res.end();
        return;
      }

      const filePath = this.files.get(token);
      if (!filePath) {
        res.writeHead(404);
        res.end();
        return;
      }

      this.serveFile(req, res, filePath);
    });

    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve(this.port));
    });
  }

  register(fsPath: string): string {
    for (const [token, currentPath] of this.files) {
      if (currentPath === fsPath) {
        return token;
      }
    }

    const token = crypto.randomBytes(16).toString('hex');
    this.files.set(token, fsPath);
    return token;
  }

  unregister(token: string): void {
    this.files.delete(token);
  }

  url(token: string): string {
    return `http://127.0.0.1:${this.port}/${token}`;
  }

  getPort(): number {
    return this.port;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.files.clear();
  }

  private serveFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string
  ): void {
    let stat: fs.Stats;

    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }

    if (!stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }

    const total = stat.size;
    const contentType = this.getMime(path.extname(filePath).toLowerCase());
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': total,
        'Content-Type': contentType,
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      this.pipeFile(res, filePath);
      return;
    }

    const range = this.parseRange(rangeHeader, total);
    if (!range) {
      res.writeHead(416, {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${total}`,
      });
      res.end();
      return;
    }

    const chunkSize = range.end - range.start + 1;
    res.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
      'Content-Type': contentType,
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    this.pipeFile(res, filePath, range);
  }

  private parseRange(header: string, total: number): ByteRange | null {
    if (!header.startsWith('bytes=') || header.includes(',')) {
      return null;
    }

    const value = header.slice(6).trim();
    const match = /^(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) {
      return null;
    }

    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return null;
      }

      const length = Math.min(suffixLength, total);
      return {
        start: total - length,
        end: total - 1,
      };
    }

    const start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= total) {
      return null;
    }

    let end = total - 1;
    if (match[2]) {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || end < start) {
        return null;
      }
      end = Math.min(end, total - 1);
    }

    return { start, end };
  }

  private pipeFile(
    res: http.ServerResponse,
    filePath: string,
    range?: ByteRange
  ): void {
    const stream = fs.createReadStream(filePath, range);

    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });

    res.on('close', () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  }

  private getMime(ext: string): string {
    const map: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.m4v': 'video/x-m4v',
      '.ogv': 'video/ogg',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };

    return map[ext] ?? 'application/octet-stream';
  }

  private getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        server.close(() => resolve(address.port));
      });
    });
  }
}
