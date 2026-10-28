import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blueprintFromTextLines,
  describeSuggestions,
  matchCopyRole,
  sampleLineColors,
} from '../src/core/reference-text-layout.js';

const W = 300,
  H = 600;
const NAVY = [5, 12, 27],
  WHITE = [255, 255, 255],
  BLUE = [197, 230, 255],
  RED = [221, 28, 36],
  GREY = [124, 127, 134];

/** A flat banner: rectangles of colour, with "glyphs" drawn as stripes inside text boxes. */
function banner(texts, pills = []) {
  const data = new Uint8ClampedArray(W * H * 4);
  const paint = (x, y, c) => {
    const i = (y * W + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y, NAVY);
  for (const p of pills)
    for (let y = p.y; y < p.y + p.height; y++)
      for (let x = p.x; x < p.x + p.width; x++) paint(x, y, p.color);
  for (const t of texts)
    for (let y = t.y + 2; y < t.y + t.height - 2; y++)
      for (let x = t.x + 2; x < t.x + t.width - 2; x++) if (x % 3 === 0) paint(x, y, t.ink);
  return { width: W, height: H, data };
}
const line = (text, x, y, width, height, ink) => ({ text, x, y, width, height, ink });
// Geometry measured from PaddleOCR on a 300x600 banner.
const BANNER1 = [
  line('BrandX', 57, 27, 184, 44, WHITE),
  line('OTTELUILTA', 41, 89, 228, 33, WHITE),
  line('ALKAA.', 74, 143, 158, 29, BLUE),
  line('TÄNÄÄN', 63, 170, 174, 28, BLUE),
  line('UUDET', 82, 210, 203, 31, WHITE),
  line('TUOTTEET', 81, 239, 203, 32, WHITE),
  line('Rekisteröidy', 86, 302, 124, 24, WHITE),
  line('18+ | Pelaathan vastuullisesti I Käyttöehdot pätevät', 8, 560, 284, 14, GREY),
  line('LIC/ABC/000/2026', 94, 575, 112, 12, GREY),
];
const pill = { x: 58, y: 295, width: 184, height: 41, color: RED };
const asOcr = (lines) =>
  lines.map((l) => ({
    text: l.text,
    confidence: 0.99,
    box: { x: l.x / W, y: l.y / H, width: l.width / W, height: l.height / H },
  }));
const campaign = {
  headline: 'OTTELUILTA\nALKAA TÄNÄÄN',
  subtitle: 'UUDET\nTUOTTEET',
  cta: 'Rekisteröidy',
  legal: '18+ | Pelaathan vastuullisesti | Käyttöehdot pätevät | LIC/ABC/000/2026',
};

test('campaign copy, colour and a solid button reproduce the hand-made BANNER1 300x600 layout', () => {
  const pixels = banner(BANNER1, [pill]);
  const { blueprint, suggestions } = blueprintFromTextLines({
    lines: asOcr(BANNER1),
    engine: 'rapidocr',
    marketId: 'BANNER1',
    width: W,
    height: H,
    pixels,
    campaign,
  });
  const byId = Object.fromEntries(blueprint.layers.map((l) => [l.id, l]));
  assert.deepEqual(
    blueprint.layers.map((l) => l.id),
    ['logo', 'headline', 'headline-support', 'subtitle', 'cta', 'legal'],
  );
  assert.equal(blueprint.background, '#050c1b');
  assert.equal(byId.logo.type, 'logo');
  // Hand-made BANNER1 title box is 40,90 230x34; the supporting box 65,146 170x52 in #c5e6ff.
  assert.deepEqual(
    [byId.headline.x, byId.headline.y, byId.headline.width, byId.headline.height],
    [41, 89, 228, 33],
  );
  assert.equal(byId.headline.sourcePart, 'first-line');
  assert.equal(byId.headline.fontSize, 23); // 33 px OCR line x 0.7
  assert.equal(byId.headline.lineHeight, 1);
  assert.equal(byId['headline-support'].lineHeight, 1.35); // 27 px line pitch at 20 px
  assert.equal(byId['headline-support'].sourcePart, 'remaining-lines');
  assert.equal(byId['headline-support'].fill, '#c5e6ff');
  assert.equal(byId['headline-support'].maxLines, 2);
  assert.equal(byId.subtitle.align, 'left');
  assert.equal(byId.cta.type, 'button');
  assert.equal(byId.cta.fill, '#dd1c24');
  assert.equal(byId.cta.textFill, '#ffffff');
  // The CTA box follows the pill, not the text.
  assert.deepEqual([byId.cta.x, byId.cta.y, byId.cta.width, byId.cta.height], [58, 295, 184, 41]);
  assert.equal(byId.legal.fontWeight, 'normal');
  assert.equal(byId.legal.maxLines, 2);
  assert.ok(
    blueprint.layers.every((l) => l.text === ''),
    'OCR text never becomes layer copy',
  );
  assert.ok(suggestions.some((s) => s.reason.startsWith('matches campaign copy')));
  assert.equal(describeSuggestions(suggestions), 'logo, headline, subtitle, CTA and legal');
});

test('without copy, size, length, colour and position still suggest each role', () => {
  const pixels = banner(BANNER1, [pill]);
  const { blueprint, suggestions } = blueprintFromTextLines({
    lines: asOcr(BANNER1),
    engine: 'rapidocr',
    marketId: 'XX',
    width: W,
    height: H,
    pixels,
  });
  const role = (id) => suggestions.find((s) => s.role === id);
  assert.equal(role('logo').text, 'BrandX'); // the wordmark is not merged with the headline
  assert.equal(role('headline').text, 'OTTELUILTA');
  assert.equal(role('headline').reason, 'largest text');
  assert.equal(role('subtitle').text, 'UUDET TUOTTEET');
  assert.equal(role('cta').reason, 'text on a solid button');
  assert.match(role('legal').text, /^18\+ .* LIC\/ABC\/000\/2026$/); // both legal lines, one layer
  // The pale-blue lines are kept together but left for review.
  assert.equal(role('custom').text, 'ALKAA. TÄNÄÄN');
  assert.equal(blueprint.layers.find((l) => l.id === 'ocr-text-1').source, 'custom');
});

test('without pixels or a button, a short line below the copy is the likely CTA', () => {
  const { suggestions } = blueprintFromTextLines({
    lines: asOcr([
      line('BIG WINS', 20, 120, 260, 50),
      line('every week', 40, 190, 220, 30),
      line('Play now', 90, 300, 120, 24),
    ]),
    engine: 'florence2',
    marketId: 'XX',
    width: W,
    height: H,
  });
  assert.deepEqual(
    suggestions.map((s) => [s.role, s.text]),
    [
      ['headline', 'BIG WINS'],
      ['subtitle', 'every week'],
      ['cta', 'Play now'],
    ],
  );
});

test('copy matching tolerates OCR spacing and symbol errors but not short look-alikes', () => {
  const copy = { headline: campaign.headline, legal: campaign.legal, cta: campaign.cta };
  assert.equal(matchCopyRole('ALKAATÄNÄÄN', copy), 'headline');
  // Exact PaddleOCR line from a 300x250 banner ("|" read as "I", ö as õ, ä as ā).
  assert.equal(
    matchCopyRole('18+ I Pelaathan vastuullisesti I Käyttõehdot pātevät I', copy),
    'legal',
  );
  assert.equal(matchCopyRole('Rekisteröidy', copy), 'cta');
  assert.equal(matchCopyRole('BrandX', copy), null);
  assert.equal(matchCopyRole('Something else entirely', copy), null);
});

test('colour sampling finds text ink, the page colour and solid buttons', () => {
  const pixels = banner(BANNER1, [pill]);
  const [title, , support, , , , cta, legal] = sampleLineColors(pixels, BANNER1);
  assert.deepEqual(title.ink, WHITE);
  assert.deepEqual(support.ink, BLUE);
  assert.equal(title.button, false);
  assert.equal(cta.button, true);
  assert.deepEqual(cta.back, RED);
  assert.deepEqual(legal.ink, GREY);
});

test('an empty read creates no blueprint', () => {
  assert.throws(
    () =>
      blueprintFromTextLines({
        lines: [],
        engine: 'rapidocr',
        marketId: 'BANNER1',
        width: W,
        height: H,
      }),
    /No text was found/,
  );
});
