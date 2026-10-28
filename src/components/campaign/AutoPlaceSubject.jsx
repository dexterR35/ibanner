import { Crosshair } from 'lucide-react';
import { Button } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';

export default function AutoPlaceSubject() {
  const { campaign, market, resources, busy, subject } = useWorkspace();
  return (
    <Button
      variant="primary"
      className="auto-subject-action"
      loading={subject.status?.loading}
      disabled={!campaign.heroAssetId || !resources?.hero || !!busy}
      onClick={subject.autoPlace}
      title={
        campaign.heroAssetId
          ? `Use local Florence-2 to find ${campaign.subjectQuery || 'person'} and fit it in every ${market.id} format.`
          : 'Upload a campaign image in the sidebar first'
      }
    >
      {!subject.status?.loading && <Crosshair size={16} />}
      Auto place subject
    </Button>
  );
}
