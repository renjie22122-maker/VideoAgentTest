"""Assemble user-supplied local clips. No remote downloads, no shell evaluation.

Usage: python scripts/assemble.py timeline.json output.mp4
Fill each timeline clip's `file` with its local video path before running.
Requires FFmpeg on PATH. Normalizes frame size, fps and duration, then concatenates.
Optional top-level `audioFile` is a pre-mixed audio track (TTS/SFX/BGM external).
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

def assemble(manifest_path, output_path):
    manifest = pathlib.Path(manifest_path).resolve()
    output = pathlib.Path(output_path).resolve()
    if output.exists():
        raise ValueError('Output already exists. Choose a new path to avoid overwriting.')
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('FFmpeg is required. Install FFmpeg and add it to PATH.')
    data = json.loads(manifest.read_text(encoding='utf-8-sig'))
    clips = data.get('clips', [])
    if not 1 <= len(clips) <= 24:
        raise ValueError('Expected 1–24 local clips.')
    sizes = {'16:9': (1280, 720), '9:16': (720, 1280), '1:1': (960, 960)}
    w, h = sizes[data.get('ratio', '16:9')]
    def local_file(value):
        if not isinstance(value, str) or not value:
            raise ValueError('Each clip requires a local file path; a URL is not enough.')
        p = (manifest.parent / value).resolve()
        if not p.is_file():
            raise ValueError(f'Local media does not exist: {p}')
        if p == output:
            raise ValueError('Input and output must be different.')
        return p
    validated = []
    for clip in clips:
        duration = clip.get('duration')
        if not isinstance(duration, (int, float)) or not 2 <= duration <= 15:
            raise ValueError('Clip duration must be 2–15 seconds.')
        if clip.get('transition', 'cut') != 'cut':
            raise ValueError('This assembly script supports hard cuts only. Confirm cuts in the timeline first.')
        validated.append((local_file(clip.get('file')), duration))
    audio = local_file(data['audioFile']) if data.get('audioFile') else None
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='frame-assembly-') as temp:
        temp = pathlib.Path(temp)
        for i, (source, duration) in enumerate(validated):
            filters = f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,tpad=stop_mode=clone:stop_duration={duration}'
            subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(source), '-vf', filters, '-t', str(duration), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(temp / f'clip-{i}.mp4')], check=True)
        (temp / 'concat.txt').write_text(''.join(f"file 'clip-{i}.mp4'\n" for i in range(len(validated))), encoding='utf-8')
        command = [ffmpeg, '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', str(temp / 'concat.txt')]
        if audio:
            total = sum(duration for _, duration in validated)
            command += ['-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-af', 'apad', '-t', str(total), '-c:a', 'aac']
        command += ['-c:v', 'copy', '-movflags', '+faststart', '-n', str(output)]
        subprocess.run(command, check=True)
    return output

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Usage: python scripts/assemble.py timeline.json output.mp4')
        print(assemble(sys.argv[1], sys.argv[2]))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f'Assembly failed: {error}', file=sys.stderr)
        sys.exit(1)
