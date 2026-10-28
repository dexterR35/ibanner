import { Outlet } from 'react-router';
import Sidebar from '../components/workspace/Sidebar.jsx';
import Topbar from '../components/workspace/Topbar.jsx';

/** Persistent navigation around the currently matched workspace page. */
export default function WorkspaceLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-shell">
        <Topbar />
        <Outlet />
      </div>
    </div>
  );
}
