import { Button, IconButton, Input } from '../ui/index.js';
import { Link } from 'react-router';
import { Layers, Plus, Package, FolderOpen } from 'lucide-react';
import { workspaceNavigation } from '../../app/navigation.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';

export default function Sidebar() {
  const {
    project,
    market,
    entries,
    view,
    setView,
    setMarketId,
    setDialog,
    backup,
    restore,
    subject,
  } = useWorkspace();
  return (
    <aside className="sidebar">
      <Link
        to={`/campaign?market=${encodeURIComponent(market.id)}`}
        className="brand"
        aria-label="Bannerflow home"
        title="Bannerflow"
      >
        <span className="brand-mark">
          <Layers size={21} />
        </span>
        <span className="brand-word">bannerflow</span>
      </Link>
      <nav aria-label="Workspace">
        {workspaceNavigation.map(({ id, icon: Icon, label, short }) => (
          <Button
            variant="plain"
            key={id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            aria-label={`${label}${id === 'blueprints' ? ` ${entries.length}` : ''}`}
            aria-current={view === id ? 'page' : undefined}
            title={label}
            onClick={() => setView(id)}
          >
            <Icon size={18} />
            <span>{short}</span>
          </Button>
        ))}
      </nav>
      <div className="sidebar-section">
        <div className="nav-label">
          <span>Markets</span>
          <IconButton
            label="Add market"
            disabled={subject.placing}
            onClick={() => setDialog('market')}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        {project.markets.map((m) => (
          <Button
            variant="plain"
            key={m.id}
            aria-label={m.name}
            title={m.name}
            aria-pressed={m.id === market.id}
            className={`market-link ${m.id === market.id ? 'selected' : ''}`}
            onClick={() => setMarketId(m.id)}
          >
            <span className="flag">{(m.flag || m.id).slice(0, 2)}</span>
            <span className="market-code">{m.id}</span>
          </Button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <Button
          variant="plain"
          className="nav-item"
          title="Back up workspace"
          aria-label="Back up workspace"
          onClick={backup}
        >
          <Package size={18} />
          <span>Backup</span>
        </Button>
        <label
          className="nav-item import-label"
          title="Import project"
          aria-disabled={subject.placing || undefined}
          tabIndex={subject.placing ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.currentTarget.querySelector('input').click();
            }
          }}
        >
          <FolderOpen size={18} />
          <span>Import</span>
          <Input
            type="file"
            disabled={subject.placing}
            aria-label="Import project file"
            accept=".zip"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) restore(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <div className="profile" title="Local workspace">
        <span>BS</span>
      </div>
    </aside>
  );
}
