import { lazy, Suspense, useEffect } from 'react';
import { useParams } from 'react-router';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { Button, LoadingState } from '../components/ui/index.js';
import SubjectPlacementStatus from '../components/campaign/SubjectPlacementStatus.jsx';
import NotFoundPage from './NotFoundPage.jsx';

const Editor = lazy(() => import('../components/editor/Editor.jsx'));
const schematicCampaign = { autoArrange: false };
const schematicResources = {};

export default function BlueprintEditorPage() {
  const { entryId } = useParams();
  const {
    project,
    subject,
    openBlueprint,
    saveBlueprint,
    blueprintProposal,
    setBlueprintProposal,
  } = useWorkspace();
  useEffect(() => () => setBlueprintProposal(null), [entryId, setBlueprintProposal]);
  const entry = project.blueprints.find((item) => item.id === entryId);
  if (!entry) return <NotFoundPage editor />;
  if (subject.placing)
    return (
      <div className="placement-editor-wait">
        <SubjectPlacementStatus status={subject.status} onCancel={subject.cancel} />
        <Button onClick={() => openBlueprint(entry.id)}>Back to blueprint</Button>
      </div>
    );
  return (
    <Suspense fallback={<LoadingState title="Loading blueprint editor…" />}>
      <Editor
        key={entry.id}
        blueprintMode
        banner={
          blueprintProposal?.id === entry.id ? { override: blueprintProposal.blueprint } : undefined
        }
        entry={entry}
        campaign={schematicCampaign}
        resources={schematicResources}
        onClose={() => openBlueprint(entry.id)}
        onSave={(blueprint) => saveBlueprint(entry.id, blueprint)}
      />
    </Suspense>
  );
}
