"""Offline integration tests: no WhatsApp account or network is used."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / 'bin'
FFMPEG = Path(os.environ.get('FFMPEG_PATH', BIN / 'ffmpeg.exe'))
FFPROBE = Path(os.environ.get('FFPROBE_PATH', BIN / 'ffprobe.exe'))
NODE = BIN / 'node.exe' if (BIN / 'node.exe').exists() else shutil.which('node')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], capture_output=True, text=True,
                          encoding='utf-8', errors='replace', creationflags=NO_WINDOW, **kwargs)


class ConversionTest(unittest.TestCase):
    def test_crop_trim_and_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            video, webp, ogg = (tmp / x for x in ('input.mp4', 'sticker.webp', 'audio.ogg'))
            # The left half is red and the right half is blue; select only red.
            made = run(FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
                       '-f', 'lavfi', '-i', 'color=red:s=320x240:r=15:d=2',
                       '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                       '-vf', 'drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill',
                       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video)
            self.assertEqual(made.returncode, 0,
                             f'FFmpeg ({FFMPEG}) exited {made.returncode}.\nstdout: {made.stdout}\nstderr: {made.stderr}')
            config = {'video': str(video), 'start': 0.2, 'duration': 1.4,
                      'crop': {'x': 0, 'y': 0, 'w': 0.5, 'h': 1},
                      'prepareOnly': True, 'outputWebp': str(webp), 'outputAudio': str(ogg)}
            config_path = tmp / 'job.json'
            config_path.write_text(json.dumps(config), encoding='utf-8')
            result = run(NODE, ROOT / 'backend.cjs', config_path, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('"kind":"done"', result.stdout)
            self.assertLessEqual(webp.stat().st_size, 500 * 1024)
            with Image.open(webp) as image:
                self.assertEqual(image.size, (512, 512))
                self.assertGreater(image.n_frames, 1)
                pixel = image.convert('RGBA').getpixel((256, 256))
                self.assertGreater(pixel[0], pixel[2] + 80, pixel)
            probe = run(FFPROBE, '-v', 'error', '-show_entries',
                        'format=duration:stream=codec_name', '-of', 'json', ogg, check=True)
            audio = json.loads(probe.stdout)
            self.assertEqual(audio['streams'][0]['codec_name'], 'opus')
            self.assertAlmostEqual(float(audio['format']['duration']), 1.4, delta=0.2)

    def test_missing_video_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            config = {'video': str(tmp / 'missing.mp4'), 'start': 0, 'duration': 1,
                      'crop': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, 'prepareOnly': True,
                      'outputWebp': str(tmp / 'out.webp'), 'outputAudio': str(tmp / 'out.ogg')}
            config_path = tmp / 'job.json'
            config_path.write_text(json.dumps(config), encoding='utf-8')
            result = run(NODE, ROOT / 'backend.cjs', config_path, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('"kind":"error"', result.stdout)


if __name__ == '__main__':
    unittest.main()
