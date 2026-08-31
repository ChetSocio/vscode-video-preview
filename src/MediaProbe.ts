import { execFile } from 'child_process';
import * as path from 'path';

export interface MediaInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  duration: number | null;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
}

export async function probeMedia(ffmpegBin: string, inputPath: string): Promise<MediaInfo | null> {
  for (const ffprobeBin of ffprobeCandidates(ffmpegBin)) {
    try {
      const output = await runProbe(ffprobeBin, inputPath);
      const video = output.streams?.find((stream) => stream.codec_type === 'video');
      const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
      const duration = Number(output.format?.duration);

      return {
        videoCodec: video?.codec_name?.toLowerCase() ?? null,
        audioCodec: audio?.codec_name?.toLowerCase() ?? null,
        duration: Number.isFinite(duration) ? duration : null,
      };
    } catch {
      // Try the next ffprobe candidate.
    }
  }

  return null;
}

function ffprobeCandidates(ffmpegBin: string): string[] {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const sameDir = path.join(path.dirname(ffmpegBin), `ffprobe${ext}`);

  return sameDir === `ffprobe${ext}` ? [sameDir] : [sameDir, `ffprobe${ext}`];
}

function runProbe(bin: string, inputPath: string): Promise<ProbeOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name:format=duration',
        '-of',
        'json',
        inputPath,
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          resolve(JSON.parse(stdout) as ProbeOutput);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}
