import { Outlet } from 'react-router';
import { Layers, LoaderCircle, Check } from 'lucide-react';
import { useProject } from '../hooks/useProject.js';
import { useWorkspaceController } from '../hooks/useWorkspaceController.js';
import { WorkspaceContext } from './workspace-context.js';
import { LoadingState, StatusMessage } from '../components/ui/index.js';
import WorkspaceDialogs from '../components/workspace/WorkspaceDialogs.jsx';
import SubjectPlacementStatus from '../components/campaign/SubjectPlacementStatus.jsx';

export default function WorkspaceProvider() {
  const [project, setProject, saveStatus] = useProject();
  if (!project)
    return <LoadingState title="Opening your studio" description={saveStatus} icon={Layers} />;
  return <WorkspaceState project={project} setProject={setProject} saveStatus={saveStatus} />;
}
function WorkspaceState(props) {
  const workspace = useWorkspaceController(props.project, props.setProject, props.saveStatus);
  return (
    <WorkspaceContext.Provider value={workspace}>
      <Outlet />
      <WorkspaceDialogs />
      {workspace.subject.placing && workspace.view !== 'campaign' && (
        <SubjectPlacementStatus
          className="placement-floating-status"
          status={workspace.subject.status}
          onCancel={workspace.subject.cancel}
        />
      )}
      {workspace.busy && !workspace.subject.placing && (
        <StatusMessage variant="busy-status" icon={LoaderCircle}>
          {workspace.busy}
        </StatusMessage>
      )}
      {workspace.toast && <StatusMessage icon={Check}>{workspace.toast}</StatusMessage>}
    </WorkspaceContext.Provider>
  );
}
