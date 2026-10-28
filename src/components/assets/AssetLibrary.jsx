import { importMediaFrames } from '../../core/generation/media.js';
import { useEffect, useRef, useState } from 'react';
import { Button, TextField, SelectField, Checkbox, TextareaField } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { getAsset, storeAsset } from '../../core/storage.js';
import { correctionSchema } from '../../core/generation/contracts.js';
import { listRecords, putRecord, deleteRecord, saveCorrection } from '../../core/generation/store.js';
import { lexicalSearch } from '../../core/generation/search.js';
import { analyzeAsset } from '../../core/generation/intelligence.js';
import '../../styles/generation.css';

function AssetItem({
  asset,
  hidden,
  correction,
  runs,
  disabled,
  onRefresh,
  onUse,
  onHide,
}) {
  const [url, setUrl] = useState(''),
    [value, setValue] = useState(() => correction?.value || correctionSchema.parse({})),
    [status, setStatus] = useState(''),
    [running, setRunning] = useState(false);
  const controller = useRef(null);
  useEffect(() => {
    setValue(correction?.value || correctionSchema.parse({}));
  }, [correction]);
  useEffect(() => {
    let live = true,
      object;
    getAsset(asset.id).then((blob) => {
      if (blob && live) {
        object = URL.createObjectURL(blob);
        setUrl(object);
      }
    });
    return () => {
      live = false;
      if (object) URL.revokeObjectURL(object);
      controller.current?.abort();
    };
  }, [asset.id]);
  async function analyze(component) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setStatus(`Analyzing ${component}…`);
    try {
      const result = await analyzeAsset(asset, component, { signal: abort.signal });
      if (!abort.signal.aborted) {
        setStatus(result.cached ? 'Reused saved analysis.' : 'Analysis saved.');
        onRefresh();
      }
    } catch (e) {
      if (!abort.signal.aborted) setStatus(e.message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <article className="intelligence-card">
      <h3>{asset.name}</h3>
      {url && !['font', 'media'].includes(asset.kind) && <img src={url} alt={asset.name} />}
      <p>
        {asset.width ? `${asset.width} × ${asset.height} · ` : ''}
        {asset.kind} · {asset.timestampMs != null ? `${asset.timestampMs} ms · ` : ''}
        {asset.id.slice(0, 12)}
        {asset.derivedFrom ? ' · derived image' : ' · original preserved'}
      </p>
      <div className="generation-actions">
        <Button variant="secondary" disabled={disabled || asset.kind === 'media'} onClick={onUse}>
          Use in{' '}
          {asset.kind === 'font' ? 'font' : asset.kind === 'logo' ? 'logo' : 'campaign image'}
        </Button>
        <Button variant="subtle" disabled={disabled} onClick={onHide}>
          {hidden ? 'Restore to library' : 'Hide from library'}
        </Button>
      </div>
      <details>
        <summary>Tags, focal region & analysis</summary>
        <TextField
          label={`Tags for ${asset.name}`}
          value={value.tags.join(', ')}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            }))
          }
        />
        <TextareaField
          label={`Searchable text for ${asset.name}`}
          rows={2}
          value={value.ocrText}
          onChange={(e) => setValue((v) => ({ ...v, ocrText: e.target.value }))}
        />
        <Checkbox
          label={`Use manual focus for ${asset.name}`}
          checked={Boolean(value.focal)}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              focal: e.target.checked ? { x: 0.25, y: 0.15, width: 0.5, height: 0.7 } : null,
            }))
          }
        />
        {value.focal && (
          <div className="generation-options">
            {['x', 'y', 'width', 'height'].map((k) => (
              <TextField
                key={k}
                label={`Focus ${k} (%)`}
                type="number"
                min="0"
                max="100"
                value={Math.round(value.focal[k] * 100)}
                onChange={(e) =>
                  setValue((v) => ({ ...v, focal: { ...v.focal, [k]: +e.target.value / 100 } }))
                }
              />
            ))}
          </div>
        )}
        <Button
          variant="secondary"
          disabled={disabled || running}
          onClick={async () => {
            try {
              await saveCorrection(asset.id, value, correction?.revision || 0);
              setStatus('Manual corrections saved. They take precedence over future analysis.');
              onRefresh();
            } catch (e) {
              setStatus(e.message);
            }
          }}
        >
          Save asset corrections
        </Button>
        {!['font', 'media'].includes(asset.kind) && (
          <div className="generation-actions">
            {['visual', 'subjects', 'ocr'].map((c) => (
              <Button
                key={c}
                variant="subtle"
                disabled={disabled || running}
                onClick={() => analyze(c)}
              >
                {c === 'visual'
                  ? 'Analyze pixels'
                  : c === 'subjects'
                    ? 'Detect subjects'
                    : 'Read image text'}
              </Button>
            ))}
          </div>
        )}
        <p>
          {['visual', 'subjects', 'ocr']
            .map((c) => `${c}: ${runs.find((r) => r.component === c)?.status || 'unknown'}`)
            .join(' · ')}
        </p>
        {runs
          .filter((r) => r.visual)
          .map((r) => (
            <div className="generation-actions" key={r.id}>
              {r.visual.palette.map((color) => (
                <span
                  key={color}
                  title={color}
                  style={{ background: color, width: 24, height: 24, borderRadius: 4 }}
                />
              ))}
            </div>
          ))}
        {runs
          .filter((r) => r.ocr)
          .map((r) => (
            <p key={r.id}>
              Detected text: {r.ocr.map((o) => o.text).join(' ') || 'No text detected'}
            </p>
          ))}
        {runs
          .filter((r) => r.subjects)
          .flatMap((r) => r.subjects)
          .map((s) => (
            <Button
              key={s.id}
              variant="subtle"
              onClick={() => setValue((v) => ({ ...v, focal: s.box }))}
            >
              Focus on {s.label}
            </Button>
          ))}
      </details>
      <p role="status">
        {status}
        {running && (
          <Button
            variant="plain"
            onClick={() => {
              controller.current?.abort();
              setStatus('Analysis cancelled.');
            }}
          >
            Cancel analysis
          </Button>
        )}
      </p>
    </article>
  );
}
export default function AssetLibrary() {
  const { project, setProject, market, subject, changeCampaign } = useWorkspace();
  const [records, setRecords] = useState([]),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [status, setStatus] = useState(''),
    [showHidden, setShowHidden] = useState(false);
  const refresh = () =>
    listRecords()
      .then(setRecords)
      .catch((e) => setStatus(e.message));
  useEffect(() => {
    refresh();
  }, []);
  const map = Object.fromEntries(records),
    runs = records.filter(([k]) => k.startsWith('analysis:')).map(([, v]) => v),
    corrections = Object.fromEntries(
      records.filter(([k]) => k.startsWith('correction:')).map(([, v]) => [v.assetId, v]),
    );
  const assets = project.assets.filter(
    (a) => (showHidden || !map[`tombstone:${a.id}`]) && (filter === 'all' || a.kind === filter),
  );
  const ordered = lexicalSearch(assets, query, corrections, runs)
    .map((h) => assets.find((a) => a.id === h.assetId))
    .filter(Boolean);
  return (
    <section aria-label="Uploaded asset library">
      <h2>Uploaded originals & derivatives</h2>
      <div className="intelligence-toolbar">
        <TextField
          label="Search assets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectField
          label="Asset type"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All assets</option>
          {['hero', 'logo', 'font', 'derived', 'media'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </SelectField>
        <Checkbox
          label="Show hidden assets"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
        />
      </div>
      <label className="field library-import">
        <span>Import library image</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={subject.placing}
          onChange={async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try {
              const asset = await storeAsset(file, 'hero');
              setProject((p) => ({
                ...p,
                assets: p.assets.some((a) => a.id === asset.id) ? p.assets : [...p.assets, asset],
              }));
              setStatus('Original added to the reusable library.');
            } catch (error) {
              setStatus(error.message);
            }
          }}
        />
      </label>
      <label className="field library-import">
        <span>Import GIF or video frames</span>
        <input
          type="file"
          accept="image/gif,image/webp,video/mp4,video/webm"
          disabled={subject.placing}
          onChange={async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            setStatus('Sampling timestamped frames locally…');
            try {
              const assets = await importMediaFrames(file);
              setProject((p) => ({
                ...p,
                assets: [
                  ...p.assets,
                  ...assets.filter((a) => !p.assets.some((old) => old.id === a.id)),
                ],
              }));
              setStatus(
                'Original media and sampled PNG frames saved. Choose a frame to use in a campaign.',
              );
            } catch (error) {
              setStatus(error.message);
            }
          }}
        />
      </label>
      <p role="status">{status}</p>
      <div className="intelligence-grid">
        {ordered.map((asset) => (
          <AssetItem
            key={asset.id}
            asset={asset}
            hidden={Boolean(map[`tombstone:${asset.id}`])}
            disabled={subject.placing}
            correction={corrections[asset.id]}
            runs={runs.filter((r) => r.assetId === asset.id).reverse()}
            onRefresh={refresh}
            onUse={() => {
              const kind = ['font', 'logo'].includes(asset.kind) ? asset.kind : 'hero';
              const focal = corrections[asset.id]?.value.focal;
              changeCampaign({
                [`${kind}AssetId`]: asset.id,
                ...(kind === 'font' ? { typography: 'original' } : {}),
                ...(kind === 'hero'
                  ? {
                      subjectSearch: null,
                      subjectFocus: focal
                        ? {
                            assetId: asset.id,
                            id: 'library-manual',
                            label: 'Manual library focus',
                            source: 'manual',
                            box: focal,
                          }
                        : null,
                    }
                  : {}),
              });
              setStatus(`Asset bound to ${market.name}.`);
            }}
            onHide={async () => {
              if (map[`tombstone:${asset.id}`]) {
                await deleteRecord(`tombstone:${asset.id}`);
                setStatus('Asset restored to library search.');
                refresh();
                return;
              }
              await putRecord(`tombstone:${asset.id}`, {
                assetId: asset.id,
                deletedAt: new Date().toISOString(),
              });
              setStatus(
                'Hidden from search. Original bytes remain for campaign history and backups.',
              );
              refresh();
            }}
          />
        ))}
      </div>
      {!ordered.length && <p>No assets match. Import an image or change your search.</p>}
      <Button
        variant="subtle"
        onClick={async () => {
          const persistent = await navigator.storage?.persist?.();
          const estimate = await navigator.storage?.estimate?.();
          setStatus(
            `${persistent ? 'Persistent storage granted.' : 'Browser may evict local storage.'} ${Math.round((estimate?.usage || 0) / 1024 / 1024)} MB used. Keep workspace backups.`,
          );
        }}
      >
        Check local storage
      </Button>
    </section>
  );
}
