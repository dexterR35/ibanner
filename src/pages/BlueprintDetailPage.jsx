import { useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Layers } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { activeRevision } from '../data/defaults.js';
import { Button, Card, InfoCard, PageHeader, Title } from '../components/ui/index.js';
import BlueprintPreview from '../components/blueprints/BlueprintPreview.jsx';
import Page from '../layouts/Page.jsx';
import NotFoundPage from './NotFoundPage.jsx';
import { useState } from 'react';
import BlueprintFadeEditor from '../components/blueprints/BlueprintFadeEditor.jsx';

export default function BlueprintDetailPage() {
  const { entryId } = useParams();
  const { project, setView, openEditor, openBlueprintEditor, subject, saveFadeStandard } =
    useWorkspace();
  const [editingFade, setEditingFade] = useState(false);
  const entry = project.blueprints.find((item) => item.id === entryId);
  if (!entry) return <NotFoundPage editor />;
  const revision = activeRevision(entry),
    bp = revision.blueprint;
  return (
    <Page>
      <Button variant="subtle" onClick={() => setView('blueprints', entry.marketId)}>
        <ArrowLeft size={15} /> Back to blueprints
      </Button>
      <PageHeader
        eyebrow="BLUEPRINT"
        title={`Blueprint ${entry.marketId} / ${bp.width} × ${bp.height}`}
        description={
          entry.variantLabel
            ? `${entry.variantLabel} · ${bp.name}`
            : 'The reusable layout standard for this market and size.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              disabled={subject.placing}
              onClick={() => openEditor(entry.id)}
            >
              Edit in Studio <ArrowUpRight size={16} />
            </Button>
            <Button
              variant="primary"
              disabled={subject.placing}
              onClick={() => openBlueprintEditor(entry.id)}
            >
              Edit blueprint
            </Button>
          </>
        }
      />
      <InfoCard icon={Layers} title="Reusable blueprint">
        Arrange the logo, text, image and legal boxes, fades and GIF timing. Saving updates this
        market and size in Studio while keeping its campaign content.
      </InfoCard>
      <div className="blueprint-reference-layout">
        <Card className="blueprint-reference-art">
          <BlueprintPreview key={entry.id} entry={entry} blueprint={bp} />
        </Card>
        <div className="blueprint-reference-details">
          <Card>
            <Title as="h2">Layout standard</Title>
            <dl className="blueprint-facts">
              <div>
                <dt>Market</dt>
                <dd>{entry.marketId}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>
                  {bp.width} × {bp.height} px
                </dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{bp.mode === 'animated' ? 'GIF' : 'Static'}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>
                  v{revision.number} · {revision.status}
                </dd>
              </div>
            </dl>
            <p className="muted">
              A starting layout for this market and size. Build each banner from scratch in Studio.
            </p>
            {bp.layers.some((l) => l.type === 'image') && (
              <Button
                variant="secondary"
                disabled={subject.placing}
                onClick={() => setEditingFade(true)}
              >
                Edit blueprint fade
              </Button>
            )}
          </Card>
          <Card>
            <Title as="h2">Layout areas</Title>
            <ul className="blueprint-area-list">
              {bp.layers.map((layer) => (
                <li key={layer.id}>
                  <span>{layer.name}</span>
                  <small>
                    {layer.width} × {layer.height} px
                  </small>
                </li>
              ))}
            </ul>
          </Card>
          {bp.mode === 'animated' && (
            <Card>
              <Title as="h2">Starting GIF timing</Title>
              <ol className="blueprint-timing">
                {bp.scenes.map((scene) => (
                  <li key={scene.id}>
                    {scene.name} <span>{scene.durationMs / 1000}s</span>
                  </li>
                ))}
              </ol>
              <p className="muted">Edit the starting parts and timing in the blueprint editor.</p>
            </Card>
          )}
        </div>
      </div>
      {editingFade && (
        <BlueprintFadeEditor
          key={entry.id}
          entry={entry}
          disabled={subject.placing}
          onClose={() => setEditingFade(false)}
          onSave={(blueprint) => saveFadeStandard(entry.id, blueprint)}
        />
      )}
    </Page>
  );
}
