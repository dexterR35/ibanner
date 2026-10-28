import { Button, EmptyState, PageHeader } from '../components/ui/index.js';
import { Search } from 'lucide-react';
import Page from '../layouts/Page.jsx';

import { useWorkspace } from '../hooks/useWorkspace.js';
export default function NotFoundPage({ editor = false }) {
  const { setView } = useWorkspace();
  return (
    <Page>
      <PageHeader
        title={editor ? 'Banner not found' : 'Page not found'}
        description="Choose a page in your workspace to continue."
      />
      <EmptyState
        icon={Search}
        action={
          <Button variant="primary" onClick={() => setView('campaign')}>
            Open campaign studio
          </Button>
        }
      >
        This {editor ? 'banner' : 'page'} is not available in this workspace.
      </EmptyState>
    </Page>
  );
}
