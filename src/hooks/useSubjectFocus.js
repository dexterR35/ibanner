import { useEffect, useRef, useState } from 'react';
import { getAsset, loadResources } from '../core/storage.js';
import { detectSubjects } from '../core/subject-detection.js';
import { preferredSubject, subjectQuery } from '../core/subject-data.js';
import { focusMarket } from '../core/focus-market.js';

export function useSubjectFocus(campaign, marketId, setProject, resources) {
  const [request, setRequest] = useState(null),
    [status, setStatus] = useState(null);
  const attempted = useRef(new Set()),
    active = useRef(null),
    consumed = useRef(null);
  const assetId = campaign.heroAssetId,
    query = subjectQuery(campaign.subjectQuery),
    engine = 'florence';
  const key = JSON.stringify([marketId, assetId, query, engine]);
  const placing = status?.key === key && status.automatic && status.loading;
  const patch = (changes) =>
    setProject((p) => ({
      ...p,
      campaigns: { ...p.campaigns, [marketId]: { ...p.campaigns[marketId], ...changes } },
    }));
  useEffect(() => {
    if (!assetId) return;
    const explicit = request?.key === key && request !== consumed.current;
    if (
      !explicit &&
      (campaign.autoSubject === false ||
        attempted.current.has(key) ||
        (campaign.subjectSearch?.assetId === assetId &&
          campaign.subjectSearch.query === query &&
          campaign.subjectSearch.engine === engine))
    ) {
      setStatus((previous) => (previous?.loading ? null : previous));
      return;
    }
    if (explicit) consumed.current = request;
    // Upload detection and the explicit Auto place button share one placement lifecycle.
    // Manual sidebar searches only find candidates.
    const automatic = !explicit || request.place === true;
    const controller = new AbortController();
    active.current = controller;
    attempted.current.add(key);
    setStatus({ key, automatic, loading: true, message: 'Starting subject finder…' });
    (async () => {
      try {
        const blob = await getAsset(assetId);
        if (!blob) throw new Error('Original image is missing.');
        const placementResources = automatic
          ? explicit && request.resources
            ? request.resources
            : await loadResources(campaign)
          : null;
        if (controller.signal.aborted) return;
        let resolvedEngine;
        const results = await detectSubjects(blob, query, {
          engine,
          signal: controller.signal,
          onEngine: (value) => {
            resolvedEngine = value;
            if (!controller.signal.aborted)
              setStatus((previous) =>
                previous?.key === key && previous.loading
                  ? { ...previous, engine: value }
                  : previous,
              );
          },
          onProgress: (message) => {
            if (!controller.signal.aborted)
              setStatus({
                key,
                automatic,
                loading: true,
                engine: resolvedEngine || engine,
                message,
              });
          },
        });
        if (controller.signal.aborted) return;
        const selected = preferredSubject(results);
        if (automatic && selected) {
          setStatus({
            key,
            automatic,
            loading: true,
            engine: resolvedEngine,
            message: 'Placing the subject across your banners…',
          });
          // Let the progress UI paint before the synchronous crop pass.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (controller.signal.aborted) return;
        }
        setProject((p) => {
          const c = p.campaigns[marketId];
          if (
            controller.signal.aborted ||
            !c ||
            c.heroAssetId !== assetId ||
            subjectQuery(c.subjectQuery) !== query ||
            (c.subjectEngine || 'florence') !== engine
          )
            return p;
          const next = {
            ...p,
            campaigns: {
              ...p.campaigns,
              [marketId]: {
                ...c,
                subjectSearch: {
                  assetId,
                  query,
                  results,
                  engine: resolvedEngine,
                  preference: engine,
                },
                subjectFocus: selected ? { ...selected, assetId } : c.subjectFocus,
              },
            },
          };
          // Stale image/provider results are rejected above. The request's original
          // image is placed inside the latest saved boxes, including edits made during search.
          return automatic && selected ? focusMarket(next, marketId, placementResources) : next;
        });
        setStatus({
          key,
          automatic,
          loading: false,
          message: results.length
            ? automatic
              ? `Subject placed across all formats for ${marketId}. Refine the focus in the sidebar.`
              : ''
            : 'No confident match. Click or drag on the image to choose a focus.',
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Subject finder:', error.message);
        setStatus({
          key,
          automatic,
          loading: false,
          error: true,
          message: `${error.message} Check local Florence-2 setup, retry, or choose a focus on the image.`,
        });
      }
    })();
    return () => {
      controller.abort();
      active.current = null;
    };
  }, [key, request, campaign.autoSubject, setProject]);
  return {
    placing: !!placing,
    status: status?.key === key ? status : null,
    placeUpload: (nextAssetId) => {
      if (campaign.autoSubject === false) return;
      const nextKey = JSON.stringify([marketId, nextAssetId, query, engine]);
      setStatus({ key: nextKey, automatic: true, loading: true, message: 'Preparing image…' });
      setRequest({ key: nextKey, place: true, nonce: Date.now() });
    },
    find: (text) => {
      if (placing) return;
      const next = subjectQuery(text);
      patch({ subjectQuery: next });
      setRequest({ key: JSON.stringify([marketId, assetId, next, engine]), nonce: Date.now() });
    },
    autoPlace: () => {
      if (!assetId || !resources?.hero || placing) return;
      const nextKey = JSON.stringify([marketId, assetId, query, engine]);
      patch({ subjectEngine: engine });
      setStatus({
        key: nextKey,
        automatic: true,
        loading: true,
        message: 'Checking local Florence-2…',
      });
      setRequest({ key: nextKey, place: true, resources, nonce: Date.now() });
    },
    cancel: () => {
      active.current?.abort();
      setStatus(null);
    },
    select: (subject) => {
      if (placing) return;
      active.current?.abort();
      setStatus(null);
      patch({ subjectFocus: subject ? { ...subject, assetId } : null });
    },
  };
}
