import { createReadStream, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdir,
  writeFile,
  rename,
  access,
  stat,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageFile } from './openai-images.ts';
const require = createRequire(import.meta.url);
export function takeFile(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('视频 ID 无效。');
  return path.resolve(
    process.env.STUDIO_DATA_DIR || '.studio',
    'videos',
    id + '.mp4',
  );
}
export function ffmpegPath() {
  if (process.env.STUDIO_FFMPEG_PATH) return process.env.STUDIO_FFMPEG_PATH;
  try {
    return (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
  } catch {
    const local = path.resolve(
      '.studio/runtime',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    return existsSync(local) ? local : 'ffmpeg';
  }
}
export function runFFmpeg(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], {
      windowsHide: true,
      cwd,
    });
    let log = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('本地视频处理超时；已有生成段已保留，可恢复处理。'));
    }, 120000);
    child.stderr.on('data', (b) => {
      log = (log + b.toString()).slice(-12000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new Error('无法启动 FFmpeg，请安装项目依赖或配置 STUDIO_FFMPEG_PATH。'),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else
        reject(
          new Error('本地视频处理失败；请检查视频格式和磁盘空间。', {
            cause: log,
          }),
        );
    });
  });
}
export async function requireFFmpeg() {
  await runFFmpeg(['-version']);
}
export async function normalizeTakePart(
  url: string,
  duration: number,
  ratio: string,
  ids: { fileId: string; tailId: string },
  frameCount = Math.round(duration * 24),
) {
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    Math.abs(frameCount / 24 - duration) > 0.05
  )
    throw new Error('分段帧数与计划时长不匹配。');
  const out = takeFile(ids.fileId),
    raw = out + '.source',
    temp = out + '.tmp.mp4',
    tail = imageFile(ids.tailId);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(path.dirname(tail), { recursive: true });
  try {
    await access(out);
  } catch {
    try {
      await access(raw);
    } catch {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password)
        throw new Error('视频结果必须为 HTTPS 地址。');
      const response = await fetch(u, {
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body)
        throw new Error('下载已生成片段失败，请恢复任务重试。');
      if (Number(response.headers.get('content-length')) > 200 * 1024 * 1024)
        throw new Error('单段视频超过本地下载限制。');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 200 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('单段视频超过 200 MB。');
        }
        chunks.push(chunk);
      }
      await writeFile(raw + '.tmp', Buffer.concat(chunks));
      await rename(raw + '.tmp', raw);
    }
    const probe = await runFFmpeg([
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      raw,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ]);
    const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe);
    if (
      match &&
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) <
        duration - 0.1
    )
      throw new Error(
        '供应商片段短于计划时长，已保留原片，不能将不完整长镜头标为完成。',
      );
    const shape =
      ratio === '9:16' ? '720:1280' : ratio === '1:1' ? '960:960' : '1280:720';
    const hasAudio = /Stream #0:[^\r\n]*Audio:/.test(probe);
    await runFFmpeg([
      '-y',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      raw,
      ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      '-map',
      '0:v:0',
      '-map',
      hasAudio ? '0:a:0' : '1:a:0',
      '-t',
      String(frameCount / 24),
      '-frames:v',
      String(frameCount),
      '-vf',
      `scale=${shape}:force_original_aspect_ratio=decrease,pad=${shape}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-af',
      'apad',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      temp,
    ]);
    const decoded = await runFFmpeg([
      '-i',
      temp,
      '-map',
      '0:v:0',
      '-f',
      'null',
      '-',
    ]);
    const frames = [...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
    if (Number(frames) !== frameCount)
      throw new Error(
        '片段实际帧数不足或超出计划，已保留原始视频，请检查后恢复。',
      );
    await rename(temp, out);
  }
  let validTail = false;
  try {
    const bytes = await readFile(tail);
    validTail =
      bytes.length > 32 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  } catch {
    /* Missing or interrupted extraction is retried from the saved video. */
  }
  if (!validTail) {
    const temporaryTail = tail + '.tmp.png';
    await runFFmpeg([
      '-y',
      '-i',
      out,
      '-vf',
      `select=eq(n\\,${frameCount - 1})`,
      '-vsync',
      '0',
      '-frames:v',
      '1',
      '-update',
      '1',
      temporaryTail,
    ]);
    if ((await stat(temporaryTail)).size <= 32)
      throw new Error('尾帧提取未返回有效图片，不能续接下一段。');
    await rename(temporaryTail, tail);
  }
  return ids;
}
export async function assembleTake(ids: string[], outputId: string) {
  const out = takeFile(outputId);
  await mkdir(path.dirname(out), { recursive: true });
  const list = out + '.concat';
  // Generated UUID basenames only; concat cannot reference arbitrary paths.
  await writeFile(
    list,
    ids
      .map((id) => {
        takeFile(id);
        return "file '" + id + ".mp4'";
      })
      .join('\n'),
  );
  await runFFmpeg(
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '1',
      '-i',
      path.basename(list),
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      out + '.tmp.mp4',
    ],
    path.dirname(out),
  );
  await rename(out + '.tmp.mp4', out);
  return '/api/studio-videos/' + outputId + '.mp4';
}
export async function serveTakeVideo(
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const file = takeFile(id),
    info = await stat(file);
  const range = req.headers.range;
  let start = 0,
    end = info.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + info.size });
      res.end();
      return;
    }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    ) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + info.size });
      res.end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'private, max-age=3600',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
  });
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export const newTakeMediaIds = (): { fileId: string; tailId: string } => ({
  fileId: randomUUID(),
  tailId: randomUUID(),
});
