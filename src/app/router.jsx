import { Navigate, Route, Routes, useLocation } from 'react-router';
import WorkspaceProvider from './WorkspaceProvider.jsx';
import WorkspaceLayout from '../layouts/WorkspaceLayout.jsx';
import CampaignPage from '../pages/CampaignPage.jsx';
import BlueprintsPage from '../pages/BlueprintsPage.jsx';
import BlueprintDetailPage from '../pages/BlueprintDetailPage.jsx';
import GenerationPage from '../pages/GenerationPage.jsx';
import AssetsPage from '../pages/AssetsPage.jsx';
import BlueprintEditorPage from '../pages/BlueprintEditorPage.jsx';
import EditorPage from '../pages/EditorPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
function HomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/campaign${search}`} replace />;
}
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<WorkspaceProvider />}>
        <Route element={<WorkspaceLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="campaign" element={<CampaignPage />} />
          <Route path="blueprints" element={<BlueprintsPage />} />
          <Route path="blueprints/:entryId" element={<BlueprintDetailPage />} />
          <Route path="generate" element={<GenerationPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="blueprints/:entryId/edit" element={<BlueprintEditorPage />} />
        <Route path="campaign/:entryId/edit" element={<EditorPage />} />
      </Route>
    </Routes>
  );
}
