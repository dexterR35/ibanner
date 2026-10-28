import { lazy, Suspense, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace.js';

const Editor = lazy(() => import('../editor/Editor.jsx'));

/** One live editor at a time; its controls are portaled into the Studio's left panel. */
export default function StudioBannerEditor({
  entry,
  zoom,
  interactive,
  inspectorHost,
  timelineHost,
  sceneRequest,
  onClose,
}) {
  const { project, campaign, resources, busy, saveEditor, resetBanner } = useWorkspace();
  const previousResources = useRef(null);
  if (resources) previousResources.current = resources;
  const currentResources = resources || previousResources.current;
  if (!currentResources) return <LoaderCircle className="spin" />;
  return (
    <Suspense fallback={<LoaderCircle className="spin" />}>
      <Editor
        entry={entry}
        banner={project.banners[entry.id]}
        campaign={campaign}
        resources={currentResources}
        assetsBusy={!!busy || !resources}
        onClose={onClose}
        onReset={() => resetBanner(entry.id)}
        logoAssetName={project.assets.find((asset) => asset.id === campaign.logoAssetId)?.name}
        inline={{
          zoom,
          interactive: interactive && !busy && !!resources,
          inspectorHost,
          timelineHost,
          sceneRequest,
          onCommit: (bp) => saveEditor(entry.id, bp, { stayInStudio: true }),
        }}
      />
    </Suspense>
  );
}
