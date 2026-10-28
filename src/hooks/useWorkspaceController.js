import { useImageTools } from './useImageTools.js';
import { migrateTallHeadlines } from '../core/tall-headline-migration.js';
import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams, useMatch } from 'react-router';
import { useResources } from './useProject.js';
import {
  activeRevision,
  addMissingMarketSizes,
  resolveBanner,
  newEntry,
  campaignFor,
  PRESETS,
  uid,
  duplicateForSize,
} from '../data/defaults.js';
import { storeAsset, getAsset, imageFrom } from '../core/storage.js';
import {
  exportSet,
  download,
  backupProject,
  importProject,
  renderOutput,
  safeName,
} from '../core/export.js';
import { reviewReport } from '../core/review.js';
import { florenceReferenceSchema } from '../core/florence-reference.js';
import {
  blueprintFromTextLines,
  describeSuggestions,
  ocrResultSchema,
} from '../core/reference-text-layout.js';
import { imagePayload, requestVision, visionCapabilities } from '../core/generation/planner.js';
import { layoutKey } from '../core/auto-layout.js';
import { useAutoArrange, arrangeMarket } from './useAutoArrange.js';
import { useSubjectFocus } from './useSubjectFocus.js';
import { applyBlueprintCorrections } from '../core/blueprint-corrections.js';
import { matchMarketBlueprints } from '../core/match-blueprints.js';
import { migrateLineSpacing } from '../core/line-spacing.js';
import { saveBlueprintFade } from '../core/blueprint-fade.js';
import { saveBlueprintStandard, syncSavedBlueprintFades } from '../core/blueprint-edit.js';
import { aiArrangeMarket, seedBlueprint } from '../core/ai-arrange.js';
import { analyzeCampaignPhoto } from '../core/studio-ai.js';
import { currentPhotoAnalysis, photoAnalysisKey } from '../core/photo-analysis.js';

const SOURCE_NAMES = {
  design: 'saved design',
  reference: 'nearest measured blueprint',
  qwen: 'Qwen layout',
  'qwen+reference-photo': 'Qwen layout with example photo frame',
  edited: 'manually edited (kept)',
};
/** One sentence for the Arrange now toast. */
function arrangeSummary(result, notes) {
  const counts = {};
  for (const { source } of result.summary) counts[source] = (counts[source] || 0) + 1;
  const parts = Object.entries(counts).map(([source, n]) => `${n} ${SOURCE_NAMES[source]}`);
  const model = result.modelError
    ? ` Qwen3-VL unavailable (${result.modelError.slice(0, 120)}); used saved designs and measured blueprints.`
    : result.model
      ? ` Qwen3-VL took ${Math.round(result.model.elapsedMs / 1000)} s.`
      : '';
  const missing = notes.length ? ` Not used: ${notes.join(', ')}.` : '';
  return `${result.summary.length} formats arranged: ${parts.join(', ')}.${model}${missing}`;
}

export function useWorkspaceController(project, setProject, saveStatus) {
  const navigate = useNavigate(),
    location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cloneFrom, setCloneFrom] = useState('common'),
    [filter, setFilter] = useState('all'),
    [formatQuery, setFormatQuery] = useState(''),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(''),
    [format, setFormat] = useState('png'),
    [size, setSize] = useState({ width: 970, height: 250 }),
    [newMarket, setNewMarket] = useState({ id: '', name: '', locale: 'en', legal: '' }),
    [review, setReview] = useState(null),
    [blueprintProposal, setBlueprintProposal] = useState(null);
  const blueprintRoute = useMatch('/blueprints/:entryId/*');
  const editorRoute = useMatch('/campaign/:entryId/edit');
  const referenceEntry = project.blueprints.find(
    (entry) => entry.id === blueprintRoute?.params.entryId,
  );
  const editorEntry = project.blueprints.find((entry) => entry.id === editorRoute?.params.entryId);
  // The displayed banner owns the market, even with a missing or stale query string.
  // Background subject search and arrangement must use the same market as the editor.
  const routeEntry = referenceEntry || editorEntry;
  const market =
    project.markets.find((m) => m.id === routeEntry?.marketId) ||
    project.markets.find((m) => m.id === searchParams.get('market')) ||
    project.markets[0];
  const campaign = project.campaigns[market.id],
    view = location.pathname.split('/')[1] || 'campaign';
  const { resources, error } = useResources(campaign);
  const subject = useSubjectFocus(campaign, market.id, setProject, resources);
  const tools = useImageTools({
    project,
    setProject,
    campaign,
    marketId: market.id,
    resources,
    placing: subject.placing,
  });
  useEffect(() => {
    if (!subject.placing)
      setProject((current) =>
        syncSavedBlueprintFades(migrateTallHeadlines(migrateLineSpacing(current)), market.id),
      );
  }, [project, market.id, subject.placing, setProject]);
  const entries = project.blueprints.filter((b) => b.marketId === market.id);
  const layoutPending = useAutoArrange(project, setProject, market.id, resources);
  const arranging = layoutPending && !error;
  const withCampaign = (p, id, patch) => ({
    ...p,
    campaigns: { ...p.campaigns, [id]: { ...p.campaigns[id], ...patch } },
  });
  /**
   * Arrange now: analyze the photo (OpenCV, BiRefNet, PaddleOCR, Florence-2), let Qwen3-VL
   * propose PosterO-style layouts, and keep the best-scoring candidate per banner. Missing
   * models fall back to the saved design and the nearest reference.
   */
  async function arrangeAll() {
    if (!resources || subject.placing) return;
    const marketId = market.id;
    if (project.campaigns[marketId].keepBlueprintBoxes) {
      setProject((current) => arrangeMarket(current, marketId, resources));
      notify('Match blueprints is on: copy was fitted inside the saved boxes.');
      return;
    }
    await run('Analyzing the photo…', async () => {
      let snapshot = project,
        notes = [];
      const existing = currentPhotoAnalysis(snapshot.campaigns[marketId]);
      if (!existing || existing.engines.length < 4) {
        const result = await analyzeCampaignPhoto(snapshot.campaigns[marketId], resources);
        notes = result.notes;
        snapshot = withCampaign(snapshot, marketId, { photoAnalysis: result.analysis });
        setProject((current) =>
          photoAnalysisKey(current.campaigns[marketId]) === result.analysis.key
            ? withCampaign(current, marketId, { photoAnalysis: result.analysis })
            : current,
        );
      }
      setBusy('Arranging with AI: Qwen3-VL is proposing layouts…');
      const result = await aiArrangeMarket(snapshot, marketId, resources, {
        request: requestVision,
      });
      const key = layoutKey(snapshot.campaigns[marketId]);
      setProject((current) => {
        // Copy or image changed during the run: keep the newer content, the user can rerun.
        if (layoutKey(current.campaigns[marketId]) !== key) return current;
        const banners = { ...current.banners };
        for (const { id, source } of result.summary) {
          const now = current.banners[id],
            next = result.project.banners[id];
          if (
            source !== 'edited' &&
            now &&
            !now.override &&
            now.blueprintVersionId === next.blueprintVersionId
          )
            banners[id] = next;
        }
        return { ...current, banners };
      });
      notify(arrangeSummary(result, notes));
    });
  }

  function matchBlueprints() {
    if (!resources || subject.placing) return;
    setProject((current) =>
      arrangeMarket(matchMarketBlueprints(current, market.id), market.id, resources),
    );
    notify('Matched blueprint boxes. Copy, images and styling kept.');
  }
  function setMarketId(id) {
    if (routeEntry) {
      setView(referenceEntry ? 'blueprints' : 'campaign', id);
      return;
    }
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('market', id);
      return next;
    });
  }
  function setView(page, id = market.id) {
    navigate(`/${page}?market=${encodeURIComponent(id)}`);
  }
  function entryUrl(id, page, suffix = '') {
    const entry = project.blueprints.find((item) => item.id === id);
    return `/${page}/${encodeURIComponent(id)}${suffix}?market=${encodeURIComponent(entry?.marketId || market.id)}`;
  }
  const openEditor = (id) => {
    if (!subject.placing) navigate(entryUrl(id, 'campaign', '/edit'));
  };
  const openBlueprintEditor = (id) => {
    if (!subject.placing) navigate(entryUrl(id, 'blueprints', '/edit'));
  };
  const openBlueprint = (id) => navigate(entryUrl(id, 'blueprints'));
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (text) => setToast(text);
  const changeCampaign = (patch) => {
    if (subject.placing) return;
    setProject((p) => ({
      ...p,
      campaigns: { ...p.campaigns, [market.id]: { ...p.campaigns[market.id], ...patch } },
    }));
  };
  async function run(label, fn) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy('');
    }
  }
  async function upload(file, kind) {
    if (!file || subject.placing) return;
    await run('Saving original asset…', async () => {
      const asset = await storeAsset(file, kind);
      setProject((p) => ({
        ...p,
        assets: p.assets.some((a) => a.id === asset.id) ? p.assets : [...p.assets, asset],
        campaigns: {
          ...p.campaigns,
          [market.id]: {
            ...p.campaigns[market.id],
            [`${kind}AssetId`]: asset.id,
            ...(kind === 'font' ? { typography: 'original' } : {}),
            ...(kind === 'hero' ? { subjectFocus: null, subjectSearch: null } : {}),
          },
        },
      }));
      if (kind === 'hero') subject.placeUpload(asset.id);
      notify(`${file.name} added. Original preserved.`);
    });
  }
  function addSize() {
    if (subject.placing) return;
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width < 32 ||
      size.height < 32 ||
      size.width > 2048 ||
      size.height > 2048
    ) {
      notify('Use whole dimensions between 32 and 2048 pixels.');
      return;
    }
    const source = project.blueprints.find((e) => e.id === cloneFrom);
    // Without an explicit source, the nearest reference shape seeds the new size.
    const bp = source
      ? duplicateForSize(activeRevision(source).blueprint, market.id, size.width, size.height)
      : seedBlueprint(project, market.id, size.width, size.height);
    if (
      entries.some((e) => {
        const existing = activeRevision(e).blueprint;
        return existing.width === bp.width && existing.height === bp.height;
      })
    ) {
      notify('This market already has that size.');
      return;
    }
    const entry = newEntry(bp);
    setProject((p) => ({
      ...p,
      blueprints: [...p.blueprints, entry],
      banners: {
        ...p.banners,
        [entry.id]: {
          blueprintVersionId: entry.activeVersionId,
          override: null,
          history: [],
          layoutKey: layoutKey(p.campaigns[market.id]),
        },
      },
    }));
    setDialog(null);
    setFilter('all');
    setFormatQuery('');
    navigate(
      `/blueprints/${encodeURIComponent(entry.id)}/edit?market=${encodeURIComponent(market.id)}`,
    );
    notify('Blueprint created. Arrange the boxes, then save to update Studio.');
  }
  async function importReference(file) {
    if (!file || subject.placing) return;
    await run('Reading the reference text…', async () => {
      const capabilities = await visionCapabilities();
      // PaddleOCR reads the text; Florence-2 is the fallback when it is not installed.
      const engine = capabilities.ocr?.ready
        ? 'rapidocr'
        : capabilities.florence?.ready
          ? 'florence2'
          : null;
      if (!engine)
        throw new Error(
          capabilities.ocr?.message ||
            capabilities.florence?.message ||
            'PaddleOCR or Florence-2 is required for Blueprint reference import.',
        );
      const url = URL.createObjectURL(file);
      let width, height, pixels;
      try {
        const image = await imageFrom(url);
        if (image.width < 32 || image.height < 32 || image.width > 2048 || image.height > 2048)
          throw new Error('Reference dimensions must be 32–2048 pixels.');
        width = image.width;
        height = image.height;
        // Native-size pixels for text colour and button sampling; nothing is stored.
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0);
        pixels = ctx.getImageData(0, 0, width, height);
      } finally {
        URL.revokeObjectURL(url);
      }
      let lines;
      if (engine === 'rapidocr') {
        const result = ocrResultSchema.parse(
          await requestVision('ocr', {
            image: await imagePayload(file, 2048),
            profileId: capabilities.ocr.profileId,
          }),
        );
        if (result.profileId !== capabilities.ocr.profileId)
          throw new Error('PROFILE_MISMATCH: PaddleOCR changed during reference analysis.');
        lines = result.lines;
      } else {
        const evidence = florenceReferenceSchema.parse(
          await requestVision('reference', {
            image: await imagePayload(file, 1024),
            profileId: capabilities.florence.profileId,
          }),
        );
        if (evidence.profileId !== capabilities.florence.profileId)
          throw new Error('PROFILE_MISMATCH: Florence changed during reference analysis.');
        lines = evidence.textRegions;
      }
      // Qwen3-VL names each line's role; the rule-based guesses remain the fallback.
      let lineRoles = null;
      if (capabilities.qwen?.ready && lines.length)
        try {
          const roles = await requestVision('roles', {
            image: await imagePayload(file, 1024),
            lines: lines.slice(0, 120).map((l) => ({ text: l.text, box: l.box })),
          });
          lineRoles = lines.map((_, i) => roles.roles.find((r) => r.line === i)?.role ?? 'other');
        } catch {
          lineRoles = null;
        }
      const { blueprint: bp, suggestions } = blueprintFromTextLines({
        lines,
        engine,
        marketId: market.id,
        width,
        height,
        pixels,
        campaign,
        lineRoles,
      });
      const reader =
        (engine === 'rapidocr' ? 'PaddleOCR' : 'Florence-2') + (lineRoles ? ' + Qwen3-VL' : '');
      const asset = await storeAsset(file, 'hero');
      const existing = entries.find((e) => {
        const b = activeRevision(e).blueprint;
        return b.width === bp.width && b.height === bp.height;
      });
      if (existing) {
        bp.id = existing.id;
        setBlueprintProposal({ id: existing.id, blueprint: bp });
      } else {
        const entry = newEntry(bp);
        setProject((p) => ({
          ...p,
          assets: p.assets.some((a) => a.id === asset.id)
            ? p.assets
            : [...p.assets, { ...asset, provenance: 'flattened-reference' }],
          blueprints: [...p.blueprints, entry],
          banners: {
            ...p.banners,
            [entry.id]: {
              blueprintVersionId: entry.activeVersionId,
              override: null,
              history: [],
              layoutKey: layoutKey(p.campaigns[market.id]),
            },
          },
        }));
      }
      if (existing)
        setProject((p) => ({
          ...p,
          assets: p.assets.some((a) => a.id === asset.id)
            ? p.assets
            : [...p.assets, { ...asset, provenance: 'flattened-reference' }],
        }));
      setDialog(null);
      openBlueprintEditor(existing?.id || bp.id);
      const found = `${reader} read ${lines.length} text lines and suggested ${describeSuggestions(suggestions)}.`;
      notify(
        existing
          ? `${found} Proposal opened as unsaved changes; review the roles and boxes.`
          : `${found} Draft blueprint created; review the roles and boxes before saving.`,
      );
    });
  }
  function addMarket() {
    if (subject.placing) return;
    const id = newMarket.id.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,8}$/.test(id) || !newMarket.name.trim()) {
      notify('Enter a market name and a 2–8 character market code.');
      return;
    }
    if (project.markets.some((m) => m.id === id)) {
      notify('Market code already exists.');
      return;
    }
    const m = {
        ...newMarket,
        id,
        name: newMarket.name.trim(),
        flag: id,
        legalStatus: newMarket.legal ? 'user supplied' : 'missing',
      },
      newEntries = PRESETS.slice(0, 8).map(([w, h]) => newEntry(seedBlueprint(project, id, w, h)));
    setProject((p) => ({
      ...p,
      markets: [...p.markets, m],
      campaigns: { ...p.campaigns, [id]: campaignFor(m) },
      blueprints: [...p.blueprints, ...newEntries],
      banners: {
        ...p.banners,
        ...Object.fromEntries(
          newEntries.map((e) => [
            e.id,
            { blueprintVersionId: e.activeVersionId, override: null, history: [] },
          ]),
        ),
      },
    }));
    setMarketId(id);
    setDialog(null);
    notify(
      'Market added: eight layouts from the nearest measured blueprints in other markets (unverified). Use Arrange now, then review.',
    );
  }
  function saveEditor(entryId, bp, { stayInStudio = false } = {}) {
    if (subject.placing) return;
    setProject((p) => {
      const old = p.banners[entryId],
        revision = {
          id: uid(),
          createdAt: new Date().toISOString(),
          blueprint: structuredClone(bp),
        };
      return {
        ...p,
        banners: {
          ...p.banners,
          [entryId]: {
            ...old,
            override: revision.blueprint,
            arrangement: null,
            layoutKey: layoutKey(p.campaigns[bp.marketId]),
            history: [...(old?.history || []), revision],
          },
        },
      };
    });
    if (!stayInStudio) {
      setView('campaign', bp.marketId);
      notify('Banner saved. Blueprint unchanged.');
    }
  }
  function resetBanner(id) {
    if (subject.placing) return;
    setProject((p) => ({
      ...p,
      banners: {
        ...p.banners,
        [id]: {
          blueprintVersionId: p.blueprints.find((e) => e.id === id).activeVersionId,
          override: null,
          history: [],
          arrangement: null,
          layoutKey: layoutKey(p.campaigns[p.blueprints.find((e) => e.id === id).marketId]),
        },
      },
    }));
    notify('Banner regenerated from the current blueprint.');
  }
  function saveBlueprint(id, blueprint) {
    if (subject.placing) return;
    setProject(saveBlueprintStandard(project, id, blueprint));
    openBlueprint(id);
    notify('Blueprint saved. Matching Studio banner updated.');
  }
  function saveFadeStandard(id, blueprint) {
    if (subject.placing) return;
    setProject(saveBlueprintFade(project, id, blueprint));
    notify('Blueprint fade saved. Matching Studio banner updated.');
  }
  async function exportAll() {
    if (subject.placing) return;
    setDialog(null);
    await run('Preparing campaign set…', async () => {
      const blob = await exportSet(entries, project, campaign, resources, format, setBusy);
      download(blob, `${safeName(campaign.name)}-${market.id}.zip`);
      notify('Campaign ZIP exported with exact sizes and a review manifest.');
    });
  }
  // Review checks render pixels; recount only when the market's banners or assets change.
  // `entries` is re-filtered every render, so key on the stable project data instead.
  const findingCount = useMemo(
    () =>
      resources
        ? entries.reduce(
            (n, e) =>
              n +
              reviewReport(resolveBanner(e, project.banners[e.id]), campaign, resources, e).length,
            0,
          )
        : 0,
    [project.blueprints, project.banners, campaign, resources, market.id],
  );

  const backup = () =>
    run('Creating project backup…', async () => {
      download(await backupProject(project), 'bannerflow-project.zip');
      notify('Project backup includes original uploaded assets.');
    });
  const restore = (file) => {
    if (subject.placing) return;
    return run('Importing project…', async () => {
      const imported = await importProject(file);
      setProject(
        migrateTallHeadlines(
          migrateLineSpacing(addMissingMarketSizes(applyBlueprintCorrections(imported))),
        ),
      );
      setView('campaign', imported.markets[0].id);
      notify('Project imported.');
    });
  };
  const exportBanner = (bp) => {
    if (subject.placing) return;
    return run('Rendering banner…', async () => {
      const ext = bp.mode === 'animated' ? 'gif' : format;
      download(await renderOutput(bp, campaign, resources, ext), `${bp.id}-DRAFT.${ext}`);
      notify('Draft banner exported.');
    });
  };
  /** Photo analysis used by Arrange now; saved on the campaign until the photo changes. */
  const analyzePhoto = () =>
    run('Analyzing the photo…', async () => {
      const marketId = market.id;
      const { analysis, notes } = await analyzeCampaignPhoto(
        project.campaigns[marketId],
        resources,
      );
      setProject((current) =>
        photoAnalysisKey(current.campaigns[marketId]) === analysis.key
          ? withCampaign(current, marketId, { photoAnalysis: analysis })
          : current,
      );
      notify(
        `Photo analyzed with ${analysis.engines.join(', ')}.${notes.length ? ` Not used: ${notes.join(', ')}.` : ''}`,
      );
    });
  return {
    project,
    setProject,
    saveStatus,
    market,
    campaign,
    entries,
    resources,
    subject,
    error,
    view,
    filter,
    setFilter,
    formatQuery,
    setFormatQuery,
    format,
    setFormat,
    dialog,
    setDialog,
    toast,
    busy: busy || (subject.placing ? 'Placing subject…' : arranging ? 'Arranging formats…' : ''),
    arranging,
    arrangeAll,
    matchBlueprints,
    size,
    setSize,
    cloneFrom,
    setCloneFrom,
    newMarket,
    setNewMarket,
    review,
    setReview,
    findingCount,
    setMarketId,
    setView,
    openEditor,
    openBlueprint,
    openBlueprintEditor,
    changeCampaign,
    tools,
    importReference,
    blueprintProposal,
    setBlueprintProposal,
    setTreatment: (patch) => {
      if (subject.placing) return;
      setProject((p) => {
        const next = {
          ...p,
          campaigns: { ...p.campaigns, [market.id]: { ...p.campaigns[market.id], ...patch } },
        };
        return resources ? arrangeMarket(next, market.id, resources) : next;
      });
    },
    upload,
    addSize,
    addMarket,
    saveEditor,
    resetBanner,
    saveFadeStandard,
    saveBlueprint,
    backup,
    restore,
    exportBanner,
    exportAll,
    analyzePhoto,
  };
}
