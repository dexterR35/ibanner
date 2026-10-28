import { PageHeader } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';

export default function WorkspacePageHeader(props) {
  const { market } = useWorkspace();
  return (
    <PageHeader
      {...props}
      eyebrow={
        <>
          <span className="status-dot" />
          WORKSPACE<span>/</span>
          {market.name}
        </>
      }
    />
  );
}
