import { LoaderCircle } from 'lucide-react';
import { Title } from './Title.jsx';

/** Indeterminate progress for operations whose backend does not report a percentage. */
export function ProgressBar({ label, description }) {
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuetext={description}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function EmptyState({ icon: Icon, children, action, className = '' }) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      {Icon && <Icon size={28} aria-hidden="true" />}
      <p>{children}</p>
      {action}
    </div>
  );
}
export function LoadingState({ title = 'Loading…', description, icon: Icon = LoaderCircle }) {
  return (
    <div className="loading-screen" role="status">
      <Icon size={30} className={Icon === LoaderCircle ? 'spin' : undefined} />
      <Title>{title}</Title>
      {description && <p>{description}</p>}
    </div>
  );
}
export function StatusMessage({ children, icon: Icon, variant = 'toast' }) {
  return (
    <div className={variant} role={variant === 'error' ? 'alert' : 'status'}>
      {Icon && (
        <Icon
          size={16}
          className={variant === 'busy-status' ? 'spin' : undefined}
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  );
}
