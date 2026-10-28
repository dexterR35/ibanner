"""Writes neutral synthetic test images to tests/fixtures (no brand or example artwork)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).resolve().parents[1] / 'tests/fixtures'
out.mkdir(parents=True, exist_ok=True)


def font(size):
    for name in ('arialbd.ttf', 'DejaVuSans-Bold.ttf', 'Arial Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def photo(width, height):
    """A soft gradient scene with one round 'subject' left of centre."""
    im = Image.new('RGB', (width, height))
    px = im.load()
    for y in range(height):
        for x in range(width):
            t, u = y / height, x / width
            px[x, y] = (int(30 + 90 * u), int(60 + 120 * t), int(140 + 80 * (1 - t)))
    d = ImageDraw.Draw(im)
    r = min(width, height) * 0.22
    cx, cy = width * 0.42, height * 0.55
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(235, 190, 150))
    d.rectangle([cx - r * 0.9, cy + r * 0.8, cx + r * 0.9, height], fill=(200, 40, 50))
    return im


for w, h in [(300, 600), (160, 600), (320, 480)]:
    photo(w, h).save(out / f'photo-{w}x{h}.png', optimize=True)

banner = photo(300, 600)
d = ImageDraw.Draw(banner)
d.rectangle([0, 0, 300, 230], fill=(12, 16, 30))
d.text((150, 40), 'LOGO', font=font(34), fill='white', anchor='mm')
d.text((150, 110), 'BIG HEADLINE', font=font(30), fill='white', anchor='mm')
d.text((150, 155), 'SPECIAL OFFER', font=font(24), fill=(255, 210, 80), anchor='mm')
d.rounded_rectangle([60, 180, 240, 220], radius=18, fill=(230, 40, 50))
d.text((150, 200), 'Sign up', font=font(20), fill='white', anchor='mm')
d.rectangle([0, 570, 300, 600], fill=(12, 16, 30))
d.text((150, 585), '18+ | Terms apply | Play responsibly', font=font(11), fill=(200, 200, 210), anchor='mm')
banner.save(out / 'text-banner-300x600.png', optimize=True)


# Flat OCR-import fixture: text drawn as ink stripes inside measured line boxes, a red
# button pill behind the CTA and pale-blue supporting lines (see tests/e2e/automation.spec.js).
NAVY, WHITE, BLUE, RED, GREY = (5, 12, 27), (255, 255, 255), (197, 230, 255), (221, 28, 36), (124, 127, 134)
lines = [  # x, y, width, height as fractions of 300x600, ink
    (0.19, 0.045, 0.6133, 0.0733, WHITE),
    (0.1367, 0.1483, 0.76, 0.055, WHITE),
    (0.2467, 0.2383, 0.5267, 0.0483, BLUE),
    (0.21, 0.2833, 0.58, 0.0467, BLUE),
    (0.2733, 0.35, 0.6767, 0.0517, WHITE),
    (0.27, 0.3983, 0.6767, 0.0533, WHITE),
    (0.2867, 0.5033, 0.4133, 0.04, WHITE),
    (0.0267, 0.9333, 0.9467, 0.0233, GREY),
    (0.3133, 0.9583, 0.3733, 0.02, GREY),
]
ocr = Image.new('RGB', (300, 600), NAVY)
px = ocr.load()
for x in range(58, 242):
    for y in range(295, 336):
        px[x, y] = RED
for fx, fy, fw, fh, ink in lines:
    x0, y0, w, h = round(fx * 300), round(fy * 600), round(fw * 300), round(fh * 600)
    for y in range(y0 + 2, min(600, y0 + h - 2)):
        for x in range(x0 + 2, min(300, x0 + w - 2)):
            if x % 3 == 0:
                px[x, y] = ink
ocr.save(out / 'ocr-banner-300x600.png', optimize=True)
print('Wrote fixtures to', out)
