import { Select } from '../ui/index.js';
import { Check, Globe2 } from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { workspaceNavigation } from '../../app/navigation.js';

export default function Topbar() {
  const { project, market, view, saveStatus, setMarketId } = useWorkspace();
  const title = workspaceNavigation.find((item) => item.id === view)?.label || 'Workspace';
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <b className="topbar-brand">
          bannerflow<span>studio</span>
        </b>
        <span>/</span>
        <strong>{title}</strong>
      </div>
      <span className={`save-state ${saveStatus.includes('failed') ? 'danger' : ''}`}>
        <Check size={13} />
        {saveStatus}
      </span>
      <div className="market-pill">
        <Globe2 size={14} />
        <Select
          aria-label="Active market"
          value={market.id}
          onChange={(e) => setMarketId(e.target.value)}
        >
          {project.markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
    </header>
  );
}
