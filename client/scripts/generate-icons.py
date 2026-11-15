"""Regenerate PNG variants of the existing favicon.svg (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for size, maskable, name in [(192, False, 'icon-192.png'), (512, False, 'icon-512.png'), (512, True, 'maskable-512.png'), (180, False, 'apple-touch-icon.png')]:
    scale = size * 4 / 64
    image = Image.new('RGBA', (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size * 4, size * 4), radius=0 if maskable else 14 * scale, fill='#990000')
    points = [(14, 18), (50, 18), (50, 27), (37, 27), (37, 50), (27, 50), (27, 27), (14, 27)]
    draw.polygon([(x * scale, y * scale) for x, y in points], fill='#fff2c6')
    image.resize((size, size), Image.Resampling.LANCZOS).save(out / name)
