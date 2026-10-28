import { Plus } from 'lucide-react';
import { Button } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { FormatSearch, FormatTabs } from './FormatControls.jsx';
import SubjectPlacementStatus from './SubjectPlacementStatus.jsx';

export default function StudioToolbar() {
  const { entries, subject, setDialog, filter, setFilter, formatQuery, setFormatQuery } =
    useWorkspace();
  const status = subject.status?.automatic ? subject.status : null;
  return (
    <div className="studio-toolbar" aria-label="Studio tools">
      <FormatSearch value={formatQuery} onChange={setFormatQuery} />
      <div className="studio-toolbar-filters">
        <FormatTabs value={filter} onChange={setFilter} count={entries.length} />
        <Button
          variant="subtle"
          disabled={subject.placing}
          onClick={() => setDialog('size')}
          aria-label="Add size"
        >
          <Plus size={14} /> Add size
        </Button>
      </div>
      <SubjectPlacementStatus status={status?.loading ? null : status} onCancel={subject.cancel} />
    </div>
  );
}
