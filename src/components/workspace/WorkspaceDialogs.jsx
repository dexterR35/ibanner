import { Button, Field, Input, Modal, NumberField, Select, Title } from '../ui/index.js';
import { Plus, ArrowRight, Package, Download } from 'lucide-react';

import { PRESETS, activeRevision, resolveBanner } from '../../data/defaults.js';
import { reviewReport } from '../../core/review.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
export default function WorkspaceDialogs() {
  const {
    dialog,
    setDialog,
    project,
    market,
    cloneFrom,
    setCloneFrom,
    size,
    setSize,
    newMarket,
    setNewMarket,
    addSize,
    importReference,
    addMarket,
    entries,
    format,
    findingCount,
    exportAll,
    review,
    setReview,
    resources,
    campaign,
    busy,
  } = useWorkspace();
  return (
    <>
      {' '}
      {dialog === 'size' && (
        <Modal title="Add a banner size" onClose={() => setDialog(null)}>
          <p className="muted">
            Create a blueprint for {market.name}, then arrange its boxes and fade in the editor.
          </p>
          <Field
            label="Upload a finished banner to suggest a layout"
            hint="PaddleOCR reads the text (Florence-2 if PaddleOCR is not installed). Logo, headline, subtitle, CTA and legal roles are suggested from this market's copy, text size, length, colour and position. Review the draft before saving."
          >
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!!busy}
              onChange={(e) => {
                importReference(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </Field>
          <Field label="Starting layout">
            <Select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
              <option value="common">Nearest blueprint (automatic)</option>
              {project.blueprints.map((e) => (
                <option key={e.id} value={e.id}>
                  Duplicate {e.id} · v{activeRevision(e).number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Common sizes">
            <Select
              onChange={(e) => {
                const [width, height] = e.target.value.split('x').map(Number);
                setSize({ width, height });
              }}
              value={`${size.width}x${size.height}`}
            >
              <option value={`${size.width}x${size.height}`}>
                Custom / {size.width} × {size.height}
              </option>
              {PRESETS.map(([w, h]) => (
                <option key={`${w}x${h}`} value={`${w}x${h}`}>
                  {w} × {h}
                </option>
              ))}
            </Select>
          </Field>
          <div className="field-grid">
            <NumberField
              label="Width (px)"
              value={size.width}
              min={32}
              max={2048}
              onChange={(width) => setSize((s) => ({ ...s, width }))}
            />
            <NumberField
              label="Height (px)"
              value={size.height}
              min={32}
              max={2048}
              onChange={(height) => setSize((s) => ({ ...s, height }))}
            />
          </div>
          <Button variant="primary" className="full" onClick={addSize}>
            <Plus size={16} /> Create blueprint
          </Button>
        </Modal>
      )}
      {dialog === 'market' && (
        <Modal title="Add a market" onClose={() => setDialog(null)}>
          <p className="muted">
            Start with common blueprints, then adapt the layout and brand assets.
          </p>
          {[
            ['name', 'Market name'],
            ['id', 'Market code'],
            ['locale', 'Locale'],
            ['legal', 'Default legal copy'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                value={newMarket[key]}
                onChange={(e) => setNewMarket((m) => ({ ...m, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <Button variant="primary" className="full" onClick={addMarket}>
            Create market <ArrowRight size={16} />
          </Button>
        </Modal>
      )}
      {dialog === 'export' && (
        <Modal title="Export campaign set" onClose={() => setDialog(null)}>
          <div className="export-summary">
            <Package size={32} />
            <Title as="h3">{entries.length} formats, one package</Title>
            <p>
              Static banners as {format.toUpperCase()}, animated banners as GIF, plus a JSON
              manifest with revision IDs, dimensions, file sizes and review notes.
            </p>
          </div>
          <div className="notice">
            {findingCount} review notes remain. Draft outputs are labeled DRAFT. Placeholder assets
            and legal copy need review before production use.
          </div>
          <Button
            variant="primary"
            className="full"
            disabled={!resources || !!busy}
            onClick={exportAll}
          >
            <Download size={16} /> Export draft set
          </Button>
        </Modal>
      )}
      {review && resources && (
        <Modal title="Campaign review notes" wide onClose={() => setReview(null)}>
          <div className="review-list">
            {entries.map((e) => {
              const findings = reviewReport(
                resolveBanner(e, project.banners[e.id]),
                campaign,
                resources,
                e,
              );
              return (
                <section key={e.id}>
                  <Title as="h3">{e.id}</Title>
                  {findings.map((i) => (
                    <p key={i.code}>{i.message}</p>
                  ))}
                </section>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
