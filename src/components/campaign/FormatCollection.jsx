import { SectionHeader, Button, InfoCard } from '../ui/index.js';
import { Search, Plus, ShieldAlert, Layers } from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { activeRevision, resolveBanner } from '../../data/defaults.js';
import BannerCard from './BannerCard.jsx';
import { FormatSearch, FormatTabs } from './FormatControls.jsx';
import StudioToolbar from './StudioToolbar.jsx';
import ArtboardWorkspace from './ArtboardWorkspace.jsx';
import SubjectPlacementStatus from './SubjectPlacementStatus.jsx';
import CanvasCampaignActions from './CanvasCampaignActions.jsx';
import BlueprintCard from '../blueprints/BlueprintCard.jsx';
import { useEffect, useState } from 'react';
import { useHoldToCompare } from '../../hooks/useHoldToCompare.js';
import StudioBannerEditor from './StudioBannerEditor.jsx';
import { gifGroupHeight } from './GifParts.jsx';
export default function FormatCollection({ references = false }) {
  const [selectedId, setSelectedId] = useState(null),
    [sceneRequest, setSceneRequest] = useState(null),
    [inspectorHost, setInspectorHost] = useState(null),
    [timelineHost, setTimelineHost] = useState(null);
  const [comparing, setComparing] = useHoldToCompare();
  const {
    project,
    campaign,
    market,
    resources,
    entries,
    filter,
    setFilter,
    formatQuery,
    setFormatQuery,
    setDialog,
    setReview,
    findingCount,
    openEditor,
    openBlueprint,
    openBlueprintEditor,
    exportBanner,
    busy,
    subject,
  } = useWorkspace();
  const visible = entries.filter((entry) => {
    const bp = references
      ? activeRevision(entry).blueprint
      : resolveBanner(entry, project.banners[entry.id]);
    const query = formatQuery.toLowerCase().replace(/×/g, 'x').replace(/\s/g, '');
    return (
      (filter === 'all' || bp.mode === filter) &&
      (!query ||
        `${bp.width}x${bp.height} ${bp.name} ${bp.mode}`
          .toLowerCase()
          .replace(/\s/g, '')
          .includes(query))
    );
  });
  const empty = (
    <div className="empty-state format-empty">
      <Search size={24} />
      <p>No formats match your search.</p>
      <Button
        variant="secondary"
        onClick={() => {
          setFormatQuery('');
          setFilter('all');
        }}
      >
        Show all formats
      </Button>
    </div>
  );
  const activeSelection = visible.some((entry) => entry.id === selectedId) ? selectedId : null;
  useEffect(() => {
    setSelectedId(null);
  }, [market.id]);
  if (!references)
    return (
      <>
        <StudioToolbar />
        <ArtboardWorkspace
          marketKey={market.id}
          selectedId={activeSelection}
          onSelect={setSelectedId}
          onDeselect={() => setSelectedId(null)}
          inspector={activeSelection && <div ref={setInspectorHost} />}
          timeline={<div className="studio-inline-timeline" ref={setTimelineHost} />}
          locked={subject.placing}
          resetKey={`${market.id}:${visible.map((entry) => entry.id).join(',')}`}
          items={visible.map((entry) => ({
            id: entry.id,
            width: resolveBanner(entry, project.banners[entry.id]).width,
            height: resolveBanner(entry, project.banners[entry.id]).height,
            boardHeight: gifGroupHeight(resolveBanner(entry, project.banners[entry.id])),
            entry,
          }))}
          renderArtboard={({ entry, width }, view) => (
            <BannerCard
              entry={entry}
              labelRoom={width * Math.max(0.5, view.zoom)}
              showDesign={comparing}
              banner={project.banners[entry.id]}
              campaign={campaign}
              resources={resources}
              busy={!!busy}
              selected={entry.id === activeSelection}
              onSelect={() => setSelectedId(entry.id)}
              onSelectPart={(sceneId) => {
                setSelectedId(entry.id);
                setSceneRequest({ entryId: entry.id, sceneId, token: performance.now() });
              }}
              onEdit={() => openEditor(entry.id)}
              onExport={exportBanner}
            >
              {entry.id === activeSelection && (
                <StudioBannerEditor
                  key={entry.id}
                  entry={entry}
                  {...view}
                  inspectorHost={inspectorHost}
                  timelineHost={timelineHost}
                  sceneRequest={sceneRequest?.entryId === entry.id ? sceneRequest : null}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </BannerCard>
          )}
          empty={empty}
          actions={<CanvasCampaignActions comparing={comparing} onCompare={setComparing} />}
          overlay={
            subject.placing && (
              <SubjectPlacementStatus status={subject.status} onCancel={subject.cancel} />
            )
          }
          footer={
            <Button variant="subtle" className="canvas-review" onClick={() => setReview(true)}>
              <ShieldAlert size={14} /> {findingCount} review notes
            </Button>
          }
        />
      </>
    );
  return (
    <>
      <InfoCard icon={Layers} title="Blueprint library">
        Reusable layout diagrams for {market.name}. Edit boxes, fades and timing; saving updates the
        matching Studio banner.
      </InfoCard>
      <SectionHeader
        title="Blueprints"
        count={entries.length}
        actions={<FormatSearch value={formatQuery} onChange={setFormatQuery} />}
      />
      <div className="formats-toolbar">
        <FormatTabs value={filter} onChange={setFilter} count={entries.length} />
        <Button
          variant="subtle"
          className="add-size-action"
          onClick={() => setDialog('size')}
          aria-label="Add size"
          disabled={subject.placing}
        >
          <Plus size={14} /> Add size
        </Button>
      </div>
      {visible.length === 0 && empty}
      <div className="banner-grid" aria-label="Blueprints">
        {visible.map((entry) => (
          <BlueprintCard
            key={entry.id}
            entry={entry}
            onView={() => openBlueprint(entry.id)}
            onEdit={() => openBlueprintEditor(entry.id)}
            editDisabled={subject.placing}
          />
        ))}
        <Button
          variant="plain"
          className="add-format-card"
          disabled={subject.placing}
          onClick={() => setDialog('size')}
        >
          <span>
            <Plus size={24} />
          </span>
          <strong>Add a format</strong>
          <small>
            Start from the common standard
            <br />
            or define a custom canvas.
          </small>
        </Button>
      </div>
      <div className="workspace-footer">
        <span>{visible.length} formats in view · Previews scaled to fit</span>
      </div>
    </>
  );
}
