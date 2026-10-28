import { Button, ProgressBar } from '../ui/index.js';
import { X } from 'lucide-react';

export default function SubjectPlacementStatus({ status, onCancel, className = '' }) {
  if (!status?.automatic) return null;
  if (status.loading)
    return (
      <div className={`studio-subject-status subject-placement-status is-loading ${className}`}>
        <div className="placement-loading-label">
          <span role="status">Loading Florence-2…</span>
          <Button
            variant="icon"
            className="placement-cancel"
            aria-label="Cancel search"
            title="Cancel search"
            onClick={onCancel}
          >
            <X size={14} />
          </Button>
        </div>
        <ProgressBar label="Automatic subject placement" description={status.message} />
      </div>
    );
  return (
    <div
      className={`studio-subject-status subject-placement-status ${status.error ? 'field-error' : ''} ${className}`}
    >
      <span role="status">{status.message}</span>
    </div>
  );
}
