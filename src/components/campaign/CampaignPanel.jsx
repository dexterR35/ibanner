import AutomationPanel from './AutomationPanel.jsx';
import { OUTPUT_LIMIT_PRESETS } from '../../data/output-limits.js';
import {
  TextField,
  TextareaField,
  Button,
  Field,
  Input,
  SelectField,
  Textarea,
  Title,
  AssetUpload,
} from '../ui/index.js';
import { SlidersHorizontal, Upload, ScanLine, Download } from 'lucide-react';

import { useWorkspace } from '../../hooks/useWorkspace.js';
import SubjectFocusPanel from './SubjectFocusPanel.jsx';
import BannerTypography from './BannerTypography.jsx';
import StudioCopyFit from './StudioCopyFit.jsx';
import { currentPhotoAnalysis } from '../../core/photo-analysis.js';

const ENGINE_NAMES = {
  opencv: 'OpenCV',
  birefnet: 'BiRefNet',
  paddleocr: 'PaddleOCR',
  florence2: 'Florence-2',
};
export default function CampaignPanel() {
  const {
    project,
    campaign,
    entries,
    market,
    resources,
    busy,
    format,
    setFormat,
    changeCampaign,
    upload,
    analyzePhoto,
    setDialog,
    subject,
  } = useWorkspace();
  const photo = currentPhotoAnalysis(campaign);
  // Same conditions as the logo and font review notes.
  const missingBrand = resources
    ? [
        !resources.logo && 'a placeholder logo',
        !resources.fontFamily && 'the Arial fallback font',
      ].filter(Boolean)
    : [];
  return (
    <aside className="campaign-panel" aria-busy={subject.placing || undefined}>
      <div className="campaign-panel-heading">
        <span className="panel-symbol">
          <SlidersHorizontal size={18} />
        </span>
        <div>
          <Title as="h2">Campaign content</Title>
          <p>
            Shared across {entries.length} {market.id} formats
          </p>
        </div>
      </div>
      <fieldset
        className="campaign-fields"
        disabled={subject.placing}
        inert={subject.placing || undefined}
        aria-label="Campaign settings"
      >
        <TextField
          label="Campaign name"
          value={campaign.name}
          onChange={(e) => changeCampaign({ name: e.target.value })}
        />
        <div className="upload-title">
          Campaign image <span>Original asset</span>
        </div>
        <label className="upload-zone">
          <Upload size={19} />
          <strong>
            {campaign.heroAssetId ? 'Replace campaign image' : 'Upload campaign image'}
          </strong>
          <small>PNG, JPG, WebP · up to 30 MB</small>
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              upload(e.target.files[0], 'hero');
              e.target.value = '';
            }}
          />
        </label>
        <p className="asset-caption">
          {campaign.heroAssetId
            ? project.assets.find((a) => a.id === campaign.heroAssetId)?.name
            : 'No image yet. Upload a campaign photo.'}
        </p>
        <SubjectFocusPanel />
        <div className="content-section-label">
          <span>Copy & messaging</span>
          <span>{market.id}</span>
        </div>
        <BannerTypography campaign={campaign} onChange={changeCampaign} />
        {missingBrand.length > 0 && (
          <p className="brand-missing" role="note">
            Using {missingBrand.join(' and ')}. Upload the approved files below; their review notes
            clear on every format.
          </p>
        )}
        <AssetUpload
          label={market.logoLabel || 'Logo'}
          assetName={project.assets.find((asset) => asset.id === campaign.logoAssetId)?.name}
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hint="Logo image for this market · SVG or transparent PNG recommended."
          onUpload={(file) => upload(file, 'logo')}
        />
        <AssetUpload
          label="Production font"
          assetName={project.assets.find((asset) => asset.id === campaign.fontAssetId)?.name}
          accept=".woff,.woff2,.ttf,.otf"
          hint="Uploading a font switches this market to its original layer weights."
          onUpload={(file) => upload(file, 'font')}
        />
        <TextareaField
          label="Headline"
          rows={3}
          value={campaign.headline}
          onChange={(e) => changeCampaign({ headline: e.target.value })}
        />
        <TextareaField
          label="Offer / subtitle"
          rows={2}
          value={campaign.subtitle}
          onChange={(e) => changeCampaign({ subtitle: e.target.value })}
        />
        <div className="field-grid accent-field">
          <TextField
            label="Accent word"
            placeholder="Optional"
            value={campaign.accentWord}
            onChange={(e) => changeCampaign({ accentWord: e.target.value })}
          />
          <TextField
            label="Color"
            type="color"
            value={campaign.accentColor}
            onChange={(e) => changeCampaign({ accentColor: e.target.value })}
          />
        </div>
        <TextField
          label="Call to action"
          value={campaign.cta}
          onChange={(e) => changeCampaign({ cta: e.target.value })}
        />
        <Field label={`${market.id} legal line`} hint="Add approved copy for this market.">
          <Textarea
            rows={3}
            placeholder="Enter market-specific legal copy"
            value={campaign.legal}
            onChange={(e) => changeCampaign({ legal: e.target.value })}
          />
        </Field>
        <details className="brand-assets">
          <summary>Photo analysis</summary>
          <Button variant="subtle" disabled={!resources || !!busy} onClick={analyzePhoto}>
            <ScanLine size={15} /> Analyze photo
          </Button>
          {photo && (
            <p className="analysis-result">
              {photo.engines.map((e) => ENGINE_NAMES[e]).join(' · ')} · {photo.width} ×{' '}
              {photo.height}
              {photo.subject?.box && (
                <>
                  <br />
                  Subject found by BiRefNet
                </>
              )}
              {photo.text?.length > 0 && (
                <>
                  <br />
                  {photo.text.length} text lines in the photo
                </>
              )}
              {photo.objects?.length > 0 && (
                <>
                  <br />
                  Objects: {[...new Set(photo.objects.map((o) => o.label))].slice(0, 5).join(', ')}
                </>
              )}
            </p>
          )}
        </details>
        <StudioCopyFit />
        <AutomationPanel />
        <div className="export-panel">
          <SelectField
            label="File size limit"
            value={campaign.outputLimit?.preset || 'none'}
            onChange={(e) => {
              const p = OUTPUT_LIMIT_PRESETS.find((p) => p.id === e.target.value);
              changeCampaign({ outputLimit: { preset: p.id, maxKB: p.maxKB } });
            }}
          >
            {OUTPUT_LIMIT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          {campaign.outputLimit?.preset === 'custom' && (
            <TextField
              label="KB"
              type="number"
              min="10"
              max="5000"
              value={campaign.outputLimit.maxKB}
              onChange={(e) =>
                changeCampaign({
                  outputLimit: {
                    preset: 'custom',
                    maxKB: Math.max(10, Math.min(5000, +e.target.value)),
                  },
                })
              }
            />
          )}
          <div className="row">
            <SelectField
              label="Static format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="png">PNG · lossless</option>
              <option value="jpg">JPEG</option>
              <option value="webp">WebP</option>
            </SelectField>
            <span className="micro">+ GIF</span>
          </div>
          <Button
            variant="export"
            disabled={!resources || !!busy}
            onClick={() => setDialog('export')}
          >
            <Download size={16} /> Export campaign <span>{entries.length}</span>
          </Button>
          <small>Exact dimensions · ZIP + review manifest</small>
        </div>
      </fieldset>
    </aside>
  );
}
