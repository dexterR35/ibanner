import { ArrowUpRight, Eye, Layers } from 'lucide-react';
import { Button, Card, CardHeader, CardFooter } from '../ui/index.js';
import { activeRevision } from '../../data/defaults.js';
import BlueprintPreview from './BlueprintPreview.jsx';

export default function BlueprintCard({ entry, onView, onEdit, editDisabled = false }) {
  const revision = activeRevision(entry),
    bp = revision.blueprint;
  return (
    <Card
      className={`banner-card blueprint-card ${bp.width / bp.height > 2.4 ? 'wide-format' : ''}`}
    >
      <CardHeader className="card-heading">
        <div>
          <strong>
            {bp.width} <span>×</span> {bp.height}
          </strong>
          <small>{entry.variantLabel || 'Layout structure'}</small>
        </div>
        <span className="type-badge">
          <Layers size={12} /> Blueprint
        </span>
      </CardHeader>
      <Button
        variant="plain"
        className="preview-well"
        aria-label={`View blueprint ${bp.width}x${bp.height}`}
        onClick={onView}
      >
        <BlueprintPreview entry={entry} blueprint={bp} />
        <span className="preview-edit">
          <Eye size={14} /> View layout
        </span>
      </Button>
      <CardFooter>
        <span className="revision-tag">
          {bp.mode === 'animated' ? 'GIF' : 'Static'} <span>v{revision.number}</span>
        </span>
        <Button
          variant="subtle"
          aria-label={`Edit blueprint ${bp.width}x${bp.height}`}
          onClick={onEdit}
          disabled={editDisabled}
        >
          Edit blueprint <ArrowUpRight size={13} />
        </Button>
      </CardFooter>
    </Card>
  );
}
