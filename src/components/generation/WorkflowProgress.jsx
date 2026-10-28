import { useEffect, useState } from 'react';
import { LoaderCircle, CheckCircle2, X } from 'lucide-react';

export default function WorkflowProgress({ progress, busy, onCancel, compact = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  if (!progress) return null;
  const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  return (
    <div className={`create-workflow-progress ${compact ? 'is-compact' : ''}`} aria-live="polite">
      <div className="create-progress-heading">
        {busy ? <LoaderCircle size={14} className="create-spin" /> : <CheckCircle2 size={14} />}
        <span>{progress.label}</span>
        <strong>{progress.percent}%</strong>
        {busy && onCancel && (
          <button type="button" onClick={onCancel} aria-label="Cancel workflow">
            <X size={14} />
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={compact ? 'Node workflow progress' : 'Workflow progress'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={`${progress.percent}% · ${progress.completed} of ${progress.total} workflow steps complete`}
        className="create-progress-track"
      >
        <i style={{ width: `${progress.percent}%` }} />
      </div>
      <small>
        {progress.completed} / {progress.total} workflow steps{busy ? ` · ${elapsed}s elapsed` : ''}
        {busy && !compact ? ' · Model stages wait for inference to finish' : ''}
      </small>
    </div>
  );
}
