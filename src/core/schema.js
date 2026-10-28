import { z } from 'zod';

export const fadeMeshSchema = z
  .object({
    enabled: z.boolean().default(true),
    softness: z.number().min(0.01).max(1).default(0.25),
    points: z
      .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
      .min(2)
      .max(16),
  })
  .refine(
    (mesh) =>
      mesh.points[0].x === 0 &&
      mesh.points.at(-1).x === 1 &&
      mesh.points.every((p, i) => i === 0 || p.x - mesh.points[i - 1].x >= 0.0049),
    {
      message: 'Fade points must span both edges and remain ordered, at least 0.005 apart.',
    },
  );

export const glowSchema = z.object({
  enabled: z.boolean().default(false),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#ff162d'),
  blur: z.number().min(0).max(40).default(8),
  opacity: z.number().min(0).max(1).default(0.85),
});

export const layerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['background', 'image', 'logo', 'text', 'button', 'shape', 'cutout']),
    source: z
      .enum(['hero', 'logo', 'headline', 'subtitle', 'cta', 'legal', 'custom'])
      .default('custom'),
    linkedLayerId: z.string().optional(),
    fitPolicy: z.literal('strict-v1').optional(),
    imageFit: z.enum(['cover', 'contain']).optional(),
    direction: z.enum(['ltr', 'rtl']).optional(),
    locks: z
      .array(z.enum(['position', 'size', 'font', 'crop', 'visibility', 'copy', 'variant']))
      .max(7)
      .optional(),
    text: z.string().default(''),
    sourcePart: z.enum(['all', 'first-line', 'remaining-lines']).default('all'),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().max(4096),
    height: z.number().positive().max(4096),
    rotation: z.number().min(-360).max(360).default(0),
    opacity: z.number().min(0).max(1).default(1),
    visible: z.boolean().default(true),
    fill: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#ffffff'),
    textFill: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#ffffff'),
    textPaddingX: z.number().min(0).max(500).default(6),
    textPaddingY: z.number().min(0).max(500).default(2),
    fontSize: z.number().positive().max(500).default(24),
    minFontSize: z.number().positive().default(10),
    maxLines: z.number().int().min(1).max(20).default(3),
    align: z.enum(['left', 'center', 'right']).default('center'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
    textFlow: z.enum(['manual', 'auto', 'single-line']).default('manual'),
    textOverride: z.string().max(20000).nullable().default(null),
    fontWeight: z.enum(['normal', 'bold']).default('bold'),
    lineHeight: z.number().min(0.8).max(2).default(1),
    focalX: z.number().min(0).max(1).default(0.5),
    focalY: z.number().min(0).max(1).default(0.5),
    zoom: z.number().min(1).max(4).default(1),
    fade: z.number().min(0).max(1).default(0.35),
    fadeDirection: z.enum(['top', 'bottom', 'left', 'right']).default('top'),
    fadeMesh: fadeMeshSchema.optional(),
    // Optional second fade on another edge: solid background up to `solid`, clear at `depth`.
    edgeFade: z
      .object({
        direction: z.enum(['top', 'bottom', 'left', 'right']),
        solid: z.number().min(0).max(0.6),
        depth: z.number().min(0.01).max(0.8),
      })
      .refine((f) => f.solid < f.depth, { message: 'Edge fade must end after its solid band.' })
      .optional(),
    radius: z.number().min(0).max(500).default(0),
    stacked: z.boolean().default(false),
    // Additive, opt-in effect: existing saved artwork keeps its original appearance.
    glow: glowSchema.prefault({}),
    shadow: z
      .object({
        auto: z.boolean().optional(),
        enabled: z.boolean().default(false),
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .default('#000000'),
        opacity: z.number().min(0).max(1).default(0.5),
        blur: z.number().min(0).max(40).default(8),
        offsetX: z.number().min(-100).max(100).default(0),
        offsetY: z.number().min(-100).max(100).default(4),
      })
      .optional(),
  })
  .refine((l) => l.minFontSize <= l.fontSize, {
    message: 'Minimum font size exceeds preferred size.',
  });

export const trackSchema = z.object({
  visible: z.boolean().default(true),
  startMs: z.number().int().min(0).default(0),
  endMs: z.number().int().positive().optional(),
  fadeInMs: z.number().int().min(0).default(0),
  fadeOutMs: z.number().int().min(0).default(0),
  dx: z.number().finite().default(0),
  dy: z.number().finite().default(0),
});
export const blueprintSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    marketId: z.string().min(1),
    name: z.string().min(1),
    width: z.number().int().min(32).max(2048),
    height: z.number().int().min(32).max(2048),
    mode: z.enum(['static', 'animated']),
    repeat: z.number().int().min(0).max(100).default(0),
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
    layers: z.array(layerSchema).min(1).max(50),
    scenes: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          durationMs: z.number().int().min(100).max(15000),
          transitionMs: z.number().int().min(0).max(2000).default(0),
          tracks: z.record(z.string(), trackSchema),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine((bp, ctx) => {
    if (new Set(bp.layers.map((l) => l.id)).size !== bp.layers.length)
      ctx.addIssue({ code: 'custom', message: 'Layer IDs must be unique.' });
    if (new Set(bp.scenes.map((s) => s.id)).size !== bp.scenes.length)
      ctx.addIssue({ code: 'custom', message: 'Scene IDs must be unique.' });
    for (let i = 0; i < bp.layers.length; i++) {
      const layer = bp.layers[i];
      if (
        layer.type === 'cutout' &&
        !bp.layers.slice(0, i).some((l) => l.id === layer.linkedLayerId && l.type === 'image')
      )
        ctx.addIssue({ code: 'custom', message: 'Cut-out must follow its linked image.' });
    }
    // Static output uses the first frame. Retain all parts when GIF is switched off.
    if (bp.scenes.reduce((n, s) => n + s.durationMs, 0) > 60000)
      ctx.addIssue({ code: 'custom', message: 'Animation exceeds 60 seconds.' });
    for (const scene of bp.scenes) {
      if (scene.transitionMs > scene.durationMs)
        ctx.addIssue({ code: 'custom', message: 'Transition exceeds scene duration.' });
      for (const [id, track] of Object.entries(scene.tracks)) {
        const end = track.endMs ?? scene.durationMs;
        if (
          !bp.layers.some((l) => l.id === id) ||
          track.startMs >= end ||
          end > scene.durationMs ||
          track.fadeInMs + track.fadeOutMs > end - track.startMs
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `Invalid timing or layer in ${scene.name}: ${id}.`,
          });
        }
      }
    }
  });
export function validateBlueprint(value) {
  return blueprintSchema.parse(value);
}
export function validationMessage(error) {
  return error.issues?.map((i) => i.message).join(' ') || error.message;
}
