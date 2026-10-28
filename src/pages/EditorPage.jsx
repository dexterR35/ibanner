import { Button, LoadingState, StatusMessage } from '../components/ui/index.js';
import SubjectPlacementStatus from '../components/campaign/SubjectPlacementStatus.jsx';
import { lazy, Suspense, useRef } from 'react';
import { useParams } from 'react-router';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useResources } from '../hooks/useProject.js';

import NotFoundPage from './NotFoundPage.jsx';
const Editor = lazy(() => import('../components/editor/Editor.jsx'));
export default function EditorPage() {
  const { entryId } = useParams(),
    workspace = useWorkspace();
  const entry = workspace.project.blueprints.find((item) => item.id === entryId);
  if (!entry) return <NotFoundPage editor />;
  return <LoadedEditor key={entry.id} entry={entry} />;
}
function LoadedEditor({ entry }) {
  const { project, setView, saveEditor, resetBanner, subject, upload, changeCampaign, busy } =
    useWorkspace();
  const campaign = project.campaigns[entry.marketId];
  const { resources, error } = useResources(campaign);
  // Asset changes must not unmount the editor and discard its unsaved layout/undo stack.
  const previousResources = useRef(null);
  if (resources) previousResources.current = resources;
  const editorResources = resources || previousResources.current;
  const close = () => setView('campaign', entry.marketId);
  if (subject.placing)
    return (
      <div className="placement-editor-wait">
        <SubjectPlacementStatus status={subject.status} onCancel={subject.cancel} />
        <Button onClick={close}>Back to artboards</Button>
      </div>
    );
  if (error && !editorResources) return <StatusMessage variant="error">{error}</StatusMessage>;
  if (!editorResources) return <LoadingState title="Loading canvas editor…" />;
  return (
    <Suspense fallback={<LoadingState title="Loading canvas editor…" />}>
      <Editor
        entry={entry}
        banner={project.banners[entry.id]}
        campaign={campaign}
        resources={editorResources}
        assetsBusy={!resources || !!busy}
        assetsError={error}
        logoAssetName={project.assets.find((asset) => asset.id === campaign.logoAssetId)?.name}
        onLogoUpload={(file) => upload(file, 'logo')}
        onCampaignChange={changeCampaign}
        onClose={close}
        onSave={(bp) => saveEditor(entry.id, bp)}
        onReset={() => resetBanner(entry.id)}
      />
    </Suspense>
  );
}
