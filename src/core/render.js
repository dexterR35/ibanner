import { heroFor, effectiveBox } from './hero-variants.js';
import { fitText, textTop, buttonTextBox } from './text-fit.js';
import { layerAt, sceneAt } from './timeline.js';
import { assessSubject } from './subject-position.js';
import { imagePlacement } from './image-position.js';
import { canvasFont } from './typography.js';
import { reserveLegalFooter } from './legal-footer.js';
import { drawImageFade } from './image-fade.js';

export const canvasOf = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
export function boundText(layer, campaign) {
  if (layer.textOverride != null) return layer.textOverride;
  const text = layer.source === 'custom' ? layer.text : campaign[layer.source] || '';
  const lines = text.split('\n');
  if (layer.sourcePart === 'first-line') return lines[0];
  if (layer.sourcePart === 'remaining-lines') return lines.slice(1).join('\n');
  return text;
}
function rounded(ctx, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, Math.min(r, w / 2, h / 2));
}

function drawText(ctx, text, layer, campaign, resources) {
  const { lines, size } = fitText(ctx, text, layer, resources);
  ctx.font = canvasFont(layer, size, resources);
  ctx.textBaseline = 'top';
  ctx.direction = layer.direction || 'ltr';
  const top = textTop(layer, lines.length, size);
  lines.forEach((line, index) => {
    let x =
      layer.align === 'center'
        ? (layer.width - ctx.measureText(line).width) / 2
        : layer.align === 'right'
          ? layer.width - ctx.measureText(line).width
          : 0;
    const keyword =
      layer.source === 'headline' || layer.source === 'subtitle' ? campaign.accentWord : '';
    const parts = keyword ? line.split(keyword) : [line];
    for (let i = 0; i < parts.length; i++) {
      ctx.fillStyle = layer.fill;
      ctx.fillText(parts[i], x, top + index * size * layer.lineHeight);
      x += ctx.measureText(parts[i]).width;
      if (i < parts.length - 1) {
        ctx.fillStyle = campaign.accentColor;
        ctx.fillText(keyword, x, top + index * size * layer.lineHeight);
        x += ctx.measureText(keyword).width;
      }
    }
  });
}

export function cropFor(image, layer, crop) {
  const { sx, sy, sw, sh, scale } = imagePlacement(image, layer, crop);
  const cw = layer.width / scale,
    ch = layer.height / scale;
  return [sx + (sw - cw) * layer.focalX, sy + (sh - ch) * layer.focalY, cw, ch];
}

/** Source clipping is explicit so contain never reveals pixels outside a reference crop. */
function drawPhoto(ctx, image, layer, sourceCrop, width = layer.width, height = layer.height) {
  const [cx, cy, cw, ch] = cropFor(image, layer, sourceCrop);
  const [ox, oy, ow, oh] = sourceCrop || [0, 0, image.width, image.height];
  const x = Math.max(cx, ox),
    y = Math.max(cy, oy);
  const w = Math.max(0, Math.min(cx + cw, ox + ow) - x);
  const h = Math.max(0, Math.min(cy + ch, oy + oh) - y);
  if (w && h)
    ctx.drawImage(
      image,
      x,
      y,
      w,
      h,
      ((x - cx) * width) / cw,
      ((y - cy) * height) / ch,
      (w * width) / cw,
      (h * height) / ch,
    );
}

function drawTextEffect(ctx, text, layer, campaign, resources) {
  const glow = layer.glow;
  if (!glow?.enabled || !glow.opacity || !glow.blur) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, layer.width, layer.height);
    ctx.clip();
    drawText(ctx, text, layer, campaign, resources);
    ctx.restore();
    return;
  }
  // Clip only the glyphs to their text box; let the halo extend outside it.
  // Compose at native size so preview, scaled canvas, PNG and GIF agree.
  const textSurface = canvasOf(Math.ceil(layer.width), Math.ceil(layer.height));
  drawText(textSurface.getContext('2d'), text, layer, campaign, resources);
  const padding = Math.ceil(glow.blur * 2) + 2;
  const surface = canvasOf(textSurface.width + padding * 2, textSurface.height + padding * 2);
  const effect = surface.getContext('2d');
  const offset = surface.width + padding;
  const alpha = Math.round(glow.opacity * 255)
    .toString(16)
    .padStart(2, '0');
  effect.shadowColor = `${glow.color}${alpha}`;
  effect.shadowBlur = glow.blur;
  effect.shadowOffsetX = offset;
  // Keep the source offscreen to draw just its shadow, then the sharp glyphs once.
  effect.drawImage(textSurface, padding - offset, padding);
  effect.shadowColor = 'transparent';
  effect.shadowBlur = 0;
  effect.shadowOffsetX = 0;
  effect.drawImage(textSurface, padding, padding);
  ctx.drawImage(surface, -padding, -padding);
}
export function drawLayer(ctx, layer, campaign, resources, bp) {
  if (!layer.visible || layer.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= layer.opacity;
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  const { width: w, height: h } = layer;
  if (layer.type === 'image') {
    if (resources.hero) {
      const image = heroFor(layer, resources).image;
      const shadow = layer.shadow;
      if (shadow?.enabled) {
        ctx.shadowColor = `${shadow.color}${Math.round(shadow.opacity * 255)
          .toString(16)
          .padStart(2, '0')}`;
        ctx.shadowBlur = shadow.blur;
        ctx.shadowOffsetX = shadow.offsetX;
        ctx.shadowOffsetY = shadow.offsetY;
      }
      drawPhoto(ctx, image, layer, resources.heroCrop);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
      if (campaign.imageFadeEnabled !== false) drawImageFade(ctx, layer, bp.background);
    }
  } else if (layer.type === 'cutout') {
    // Linked overlays never translate a subject independently of its original photo.
    const photo = bp.layers.find((l) => l.id === layer.linkedLayerId);
    if (photo && resources.cutout && resources.hero) {
      const { image, frame } = heroFor(photo, resources);
      const surface = canvasOf(image.width, image.height);
      const cutoutBox = effectiveBox(resources.cutout.box, frame);
      surface
        .getContext('2d')
        .drawImage(
          resources.cutout.image,
          cutoutBox.x * image.width,
          cutoutBox.y * image.height,
          cutoutBox.width * image.width,
          cutoutBox.height * image.height,
        );
      drawPhoto(ctx, surface, photo, resources.heroCrop, w, h);
    }
  } else if (layer.type === 'logo') {
    if (resources.logo) {
      const scale = Math.min(w / resources.logo.width, h / resources.logo.height);
      ctx.drawImage(
        resources.logo,
        (w - resources.logo.width * scale) / 2,
        (h - resources.logo.height * scale) / 2,
        resources.logo.width * scale,
        resources.logo.height * scale,
      );
    } else {
      // Neutral placeholder until the campaign uploads its own logo.
      const fs = Math.min(h * 0.8, w / 2.6);
      ctx.font = `900 ${fs}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('LOGO', w / 2, h / 2);
    }
  } else if (layer.type === 'button') {
    rounded(ctx, w, h, layer.radius);
    ctx.fillStyle = layer.fill;
    ctx.fill();
    const box = buttonTextBox(layer);
    ctx.translate(box.paddingX, box.paddingY);
    drawTextEffect(
      ctx,
      boundText(layer, campaign),
      { ...box, fill: layer.textFill || '#ffffff' },
      campaign,
      resources,
    );
  } else if (layer.type === 'text') {
    drawTextEffect(ctx, boundText(layer, campaign), layer, campaign, resources);
  } else {
    rounded(ctx, w, h, layer.radius);
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  ctx.restore();
}
function drawScene(ctx, bp, campaign, resources, scene, local, draw) {
  ctx.fillStyle = bp.background;
  ctx.fillRect(0, 0, bp.width, bp.height);
  for (const layer of bp.layers) {
    let placed = layerAt(layer, scene, local);
    if (layer.type === 'cutout') {
      const photo = bp.layers.find((l) => l.id === layer.linkedLayerId);
      if (photo) {
        const source = layerAt(photo, scene, local);
        placed = {
          ...placed,
          x: source.x,
          y: source.y,
          width: source.width,
          height: source.height,
          rotation: source.rotation,
          visible: source.visible && placed.visible,
          opacity: source.opacity * placed.opacity,
        };
      }
    }
    draw(ctx, placed, campaign, resources, bp);
  }
}
export function renderFrame(canvas, bp, campaign, resources, timeMs = 0, draw = drawLayer) {
  bp = reserveLegalFooter(bp);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / bp.width, canvas.height / bp.height);
  const { scene, index, local } = sceneAt(bp, timeMs);
  drawScene(ctx, bp, campaign, resources, scene, local, draw);
  if (scene.transitionMs && local < scene.transitionMs && index > 0) {
    // Separate composited scenes preserve opacity at overlapping regions.
    const previous = bp.scenes[index - 1],
      scratch = canvasOf(bp.width, bp.height);
    drawScene(
      scratch.getContext('2d'),
      bp,
      campaign,
      resources,
      previous,
      previous.durationMs - 1,
      draw,
    );
    ctx.globalAlpha = 1 - local / scene.transitionMs;
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.restore();
  return canvas;
}

export function qualityReport(bp, campaign, resources, entry) {
  const issues = [],
    ctx = canvasOf(1, 1).getContext('2d');
  const add = (code, message) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message });
  };
  if (!campaign.heroAssetId) add('image', 'No campaign image yet. Upload a photo.');
  if (!resources.logo) add('logo', 'Logo is a text placeholder. Upload the approved logo.');
  if (!resources.fontFamily) add('font', 'Using Arial fallback. Supply the production font.');
  if (!campaign.legal.trim()) add('legal-missing', 'Market legal copy is missing.');
  const legal = bp.layers.find((l) => l.source === 'legal');
  if (!legal || !legal.visible || bp.scenes.every((s) => s.tracks[legal.id]?.visible === false))
    add('legal-hidden', 'Legal copy is not visible in any scene.');
  for (const l of bp.layers) {
    if (!l.visible) continue;
    if (
      l.x < 0 ||
      l.y < 0 ||
      l.x + l.width > bp.width + 0.1 ||
      l.y + l.height > bp.height + 0.1 ||
      l.rotation !== 0
    )
      add(
        `bounds-${l.id}`,
        `${l.name}: check canvas bounds${l.rotation ? ' after rotation' : ''}.`,
      );
    if (l.type === 'text' || l.type === 'button') {
      const box = l.type === 'button' ? buttonTextBox(l) : l;
      const fit = fitText(ctx, boundText(l, campaign), box, resources);
      if (fit.overflow)
        add(`overflow-${l.id}`, `${l.name}: text exceeds its box at minimum font size.`);
      if (fit.belowMinimum)
        add(
          `small-text-${l.id}`,
          `${l.name}: text was reduced below its preferred minimum to retain all copy.`,
        );
      if (l.source === 'legal' && fit.size < 9)
        add(
          'legal-size',
          'Legal text is below the draft 9 px review threshold; verify native-size readability.',
        );
    }
    if (l.type === 'image' && resources.hero) {
      if (campaign.subjectFocus?.assetId === campaign.heroAssetId && campaign.subjectFocus) {
        const fit = assessSubject(
          bp,
          l,
          resources.hero,
          campaign.subjectFocus.box,
          resources.heroCrop,
        );
        if (fit.unsupported || fit.clipped > 0.04 || fit.covered > 0.08 || fit.faded > 0.25)
          add(
            'subject-fit',
            'Review subject crop: this frame, fade or overlay may hide part of the selected subject.',
          );
      }
      const crop = cropFor(resources.hero, l, resources.heroCrop);
      if (crop[2] < l.width || crop[3] < l.height)
        add('upscale', 'Photo is enlarged beyond source resolution.');
    }
  }
  return issues;
}
