import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  runFFmpeg,
  takeFile,
  normalizeTakePart,
  assembleTake,
  requireFFmpeg,
} from '../lib/studio/take-media.ts';
import { imageFile } from '../lib/studio/openai-images.ts';
void test('local video pipeline extracts a tail, adds silent audio when absent and joins normalized clips', async (t) => {
  try {
    await requireFFmpeg();
  } catch (e) {
    if (process.env.REQUIRE_FFMPEG_TEST === '1') throw e;
    t.skip('FFmpeg 未安装；设置 REQUIRE_FFMPEG_TEST=1 强制执行媒体集成测试');
    return;
  }
  const previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), 'take-media-'),
  );
  t.after(() => {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
  });
  const ids = { fileId: randomUUID(), tailId: randomUUID() };
  await mkdir(path.dirname(takeFile(ids.fileId)), { recursive: true });
  await runFFmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=24',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-f',
    'mp4',
    takeFile(ids.fileId) + '.source',
  ]);
  await normalizeTakePart('https://unused.example/video', 1, '16:9', ids);
  assert.ok((await stat(imageFile(ids.tailId))).size > 0);
  const output = randomUUID();
  assert.equal(
    await assembleTake([ids.fileId, ids.fileId], output),
    '/api/studio-videos/' + output + '.mp4',
  );
  assert.ok((await stat(takeFile(output))).size > 0);
  const decoded = await runFFmpeg([
    '-i',
    takeFile(output),
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-',
  ]);
  assert.equal(
    Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),
    48,
  );
  await runFFmpeg([
    '-i',
    takeFile(output),
    '-map',
    '0:a:0',
    '-t',
    '0.1',
    '-f',
    'null',
    '-',
  ]);
});

void test('native audio is retained and the last displayed frame replaces interrupted tail files', async (t) => {
  try {
    await requireFFmpeg();
  } catch (e) {
    if (process.env.REQUIRE_FFMPEG_TEST === '1') throw e;
    t.skip('FFmpeg 未安装');
    return;
  }
  const previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), 'take-native-audio-'),
  );
  t.after(() => {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
  });
  const ids = { fileId: randomUUID(), tailId: randomUUID() };
  const file = takeFile(ids.fileId),
    tail = imageFile(ids.tailId);
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(tail), { recursive: true });
  await runFFmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=160x90:r=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-t',
    '1',
    '-vf',
    "drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='eq(n,23)'",
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-f',
    'mp4',
    file + '.source',
  ]);
  await writeFile(tail, 'incomplete interrupted PNG');
  await normalizeTakePart(
    'https://unused.example/native.mp4',
    1,
    '16:9',
    ids,
    24,
  );
  const audio = await runFFmpeg([
    '-i',
    file,
    '-af',
    'volumedetect',
    '-vn',
    '-f',
    'null',
    '-',
  ]);
  const volume = /max_volume: (-?\d+(?:\.\d+)?) dB/.exec(audio);
  assert.ok(
    volume && Number(volume[1]) > -40,
    'source tone must survive normalization',
  );
  await runFFmpeg([
    '-y',
    '-i',
    tail,
    '-vf',
    'scale=1:1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    tail + '.rgb',
  ]);
  const pixel = await readFile(tail + '.rgb');
  assert.ok(
    pixel[2] > 180 && pixel[0] < 80,
    'tail must be the blue final frame, not an earlier red frame',
  );
  const frames = await runFFmpeg([
    '-i',
    file,
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-',
  ]);
  assert.equal(Number([...frames.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]), 24);
});
