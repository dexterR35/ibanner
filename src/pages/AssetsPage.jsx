import AssetLibrary from '../components/assets/AssetLibrary.jsx';
import Page from '../layouts/Page.jsx';
import WorkspacePageHeader from '../components/workspace/WorkspacePageHeader.jsx';

export default function AssetsPage() {
  return (
    <Page>
      <WorkspacePageHeader
        title="Assets"
        description="Original images, logos and fonts you upload for your campaigns."
      />
      <AssetLibrary />
    </Page>
  );
}
