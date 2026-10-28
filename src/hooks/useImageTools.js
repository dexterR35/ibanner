import { useEffect, useRef, useState } from 'react';
import { getAsset, storeDerivedAsset } from '../core/storage.js';
import { cutoutImage, extendImage, upscaleImage } from '../core/tools-service.js';
import { activeVariants, extensionFor, extensionFrame, upscaleFor } from '../core/hero-variants.js';
import { cutoutTarget, subjectQuery } from '../core/subject-data.js';
import { resolveBanner } from '../data/defaults.js';

const baseName = (name = 'campaign-image') => name.replace(/\.[a-z0-9]+$/i, '');

/** Photo frames of the market's current banners, used to decide upscale/extension needs. */
export function heroFrames(project, marketId) {
  return project.blueprints
    .filter((entry) => entry.marketId === marketId)
    .flatMap((entry) =>
      resolveBanner(entry, project.banners[entry.id]).layers.filter(
        (l) => l.type === 'image' && l.source === 'hero' && l.visible,
      ),
    );
}

/**
 * Local image tools for the active market's campaign image. Each result is stored as a new
 * derived asset and bound to the campaign; results for a replaced image are discarded.
 */
export function useImageTools({ project, setProject, campaign, marketId, resources, placing }) {
  const [job, setJob] = useState(null);
  const controller = useRef(null),
    attempted = useRef(new Set());
  const assetId = campaign.heroAssetId;
  const assetName = baseName(project.assets.find((a) => a.id === assetId)?.name);
  const variants = activeVariants(campaign);
  const frames = heroFrames(project, marketId);
  const base = resources?.hero;
  const needs = {
    upscale:
      resources?.heroSource && assetId
        ? upscaleFor(frames, resources.heroSource.width, resources.heroSource.height)
        : null,
    extend:
      base && assetId ? extensionFor(frames, base.width, base.height) : { wide: null, tall: null },
  };

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setJob(null);
  }, [assetId, marketId]);

  function commit(asset, patch) {
    setProject((p) => {
      const current = p.campaigns[marketId];
      // A replaced campaign image makes this result stale.
      if (current.heroAssetId !== assetId) return p;
      return {
        ...p,
        assets: p.assets.some((a) => a.id === asset.id) ? p.assets : [...p.assets, asset],
        campaigns: { ...p.campaigns, [marketId]: { ...current, ...patch } },
      };
    });
  }

  async function execute(tool, label, work) {
    if (!assetId || placing) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const progress = (message) =>
      !current.signal.aborted && setJob({ tool, loading: true, message });
    progress(label);
    try {
      const message = await work(current.signal, progress);
      if (!current.signal.aborted) setJob({ tool, message });
    } catch (error) {
      if (!current.signal.aborted) setJob({ tool, error: true, message: error.message });
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }

  const cutout = ({ whole = false } = {}) =>
    execute(
      'cutout',
      whole ? 'Removing background…' : 'Cutting out subject…',
      async (signal, onProgress) => {
        const focus = campaign.subjectFocus?.assetId === assetId ? campaign.subjectFocus : null;
        const results =
          campaign.subjectSearch?.assetId === assetId ? campaign.subjectSearch.results : [];
        const target = cutoutTarget(focus, results);
        const label = target?.label || subjectQuery(campaign.subjectQuery);
        const result = await cutoutImage(await getAsset(assetId), {
          box: whole ? null : target?.box || null,
          label,
          signal,
          onProgress,
        });
        const asset = await storeDerivedAsset(result.blob, {
          name: `${assetName}-${whole ? 'no-background' : 'cutout'}.png`,
          derivedFrom: assetId,
          operation: 'cutout',
          engine: result.engine,
        });
        signal.throwIfAborted();
        commit(asset, {
          heroCutout: {
            assetId: asset.id,
            sourceAssetId: assetId,
            box: result.box,
            label: whole ? 'foreground' : label,
            engine: result.engine,
          },
          subjectInFront: campaign.subjectInFront ?? true,
        });
        return `${whole ? 'Background removed' : 'Subject cut out'} with ${result.engine === 'sam3+birefnet' ? 'SAM 3 + BiRefNet' : 'BiRefNet'}. Original kept.`;
      },
    );

  const upscale = (scale = needs.upscale || 2) =>
    execute('upscale', `Upscaling ×${scale} with Real-ESRGAN…`, async (signal, onProgress) => {
      const result = await upscaleImage(await getAsset(assetId), scale, { signal, onProgress });
      const asset = await storeDerivedAsset(result.blob, {
        name: `${assetName}-x${scale}.png`,
        derivedFrom: assetId,
        operation: 'upscale',
        engine: result.engine,
      });
      signal.throwIfAborted();
      commit(asset, {
        heroUpscale: { assetId: asset.id, sourceAssetId: assetId, scale, engine: result.engine },
      });
      return `Upscaled ×${scale}. Original kept.`;
    });

  const extend = () =>
    execute('extend', 'Extending background with LaMa…', async (signal, onProgress) => {
      const sourceId = variants.upscale?.assetId || assetId;
      const blob = await getAsset(sourceId);
      const done = [];
      for (const [direction, key] of [
        ['wide', 'heroExtendWide'],
        ['tall', 'heroExtendTall'],
      ]) {
        const pads = needs.extend[direction];
        if (!pads) continue;
        onProgress(`Extending the ${direction} version with LaMa…`);
        const result = await extendImage(blob, pads, { signal, onProgress });
        const asset = await storeDerivedAsset(result.blob, {
          name: `${assetName}-${direction}.png`,
          derivedFrom: sourceId,
          operation: 'extend',
          engine: result.engine,
        });
        signal.throwIfAborted();
        commit(asset, {
          [key]: {
            assetId: asset.id,
            sourceAssetId: sourceId,
            frame: extensionFrame(pads),
            engine: result.engine,
          },
        });
        done.push(direction);
      }
      return done.length
        ? `Extended ${done.join(' and ')} versions for matching formats. Original kept.`
        : 'Every format already fits the photo; no extension needed.';
    });

  const cancel = () => {
    controller.current?.abort();
    setJob(null);
  };

  // Automatic mode runs one missing step at a time, each at most once per image.
  const next =
    !assetId || !campaign.autoImageTools || placing || !resources || job?.loading
      ? null
      : needs.upscale && !variants.upscale
        ? 'upscale'
        : (needs.extend.wide && !variants.wide) || (needs.extend.tall && !variants.tall)
          ? 'extend'
          : campaign.subjectFocus?.assetId === assetId && !variants.cutout
            ? 'cutout'
            : null;
  useEffect(() => {
    if (!next) return;
    const key = `${marketId}:${assetId}:${next}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    ({ upscale, extend, cutout })[next]();
    // Each step re-evaluates after its result is bound to the campaign.
  }, [next, marketId, assetId]);

  return { job, needs, variants, cutout, upscale, extend, cancel };
}
