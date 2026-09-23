"""Turns media/raw/<scene>/*.webp (+ timings.json) into media/<scene>.gif. Needs Pillow."""
import json
import sys
from pathlib import Path

from PIL import Image

MEDIA = Path(__file__).resolve().parent.parent / "media"
WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 960


def build(scene: Path) -> None:
    files = sorted(scene.glob("*.webp"))
    times = json.loads((scene / "timings.json").read_text())
    frames, durations = [], []
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB")
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        frames.append(im.quantize(colors=192, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
        nxt = times[i + 1] if i + 1 < len(times) else times[i] + 1200
        durations.append(max(40, round((nxt - times[i]) / 10) * 10))
    out = MEDIA / f"{scene.name}.gif"
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f"{out.name}: {len(frames)} frames, {out.stat().st_size / 1e6:.1f} MB")


for d in sorted((MEDIA / "raw").iterdir()):
    if d.is_dir():
        build(d)
