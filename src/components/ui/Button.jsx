import { LoaderCircle } from 'lucide-react';

const variants = {
  primary: 'primary',
  secondary: 'secondary',
  subtle: 'subtle',
  icon: 'icon-button',
  export: 'export-button',
  plain: '',
};

/** Native button props (including ref) pass through. Buttons never submit by accident. */
export function Button({
  variant = 'secondary',
  className = '',
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={[variants[variant], className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ label, title, children, ...props }) {
  const name = label || props['aria-label'] || title;
  return (
    <Button {...props} variant="icon" aria-label={name} title={title || name}>
      {children}
    </Button>
  );
}
