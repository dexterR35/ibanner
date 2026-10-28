import { Button } from '../components/ui/index.js';
import { Plus } from 'lucide-react';
import Page from '../layouts/Page.jsx';
import WorkspacePageHeader from '../components/workspace/WorkspacePageHeader.jsx';
import FormatCollection from '../components/campaign/FormatCollection.jsx';

import { useWorkspace } from '../hooks/useWorkspace.js';
export default function BlueprintsPage() {
  const { setDialog } = useWorkspace();
  return (
    <Page>
      <WorkspacePageHeader
        title="Blueprint library"
        description="Layout blueprints by market and size. Build your banners from scratch in Studio."
        actions={
          <Button variant="primary" onClick={() => setDialog('size')}>
            <Plus size={16} />
            New size
          </Button>
        }
      />
      <FormatCollection references />
    </Page>
  );
}
