import { StatusMessage } from '../components/ui/index.js';
import Page from '../layouts/Page.jsx';
import CampaignPanel from '../components/campaign/CampaignPanel.jsx';
import FormatCollection from '../components/campaign/FormatCollection.jsx';
import '../styles/studio.css';

import { useWorkspace } from '../hooks/useWorkspace.js';
export default function CampaignPage() {
  const { error } = useWorkspace();
  return (
    <Page className="studio-artboard-page" sidebar={<CampaignPanel />}>
      {error && <StatusMessage variant="error">{error}</StatusMessage>}
      <FormatCollection />
    </Page>
  );
}
