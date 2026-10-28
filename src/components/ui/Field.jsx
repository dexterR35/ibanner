import { useId, cloneElement, isValidElement } from 'react';
import { Input, Textarea, Select } from './Input.jsx';

/** One labeled control. Hint/error IDs are composed with the child's descriptions. */
export function Field({ label, children, hint, error, className = '' }) {
  const id = useId(),
    hintId = `${id}-hint`,
    errorId = `${id}-error`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        'aria-label':
          children.props['aria-label'] || (typeof label === 'string' ? label : undefined),
        'aria-describedby':
          [children.props['aria-describedby'], hint && hintId, error && errorId]
            .filter(Boolean)
            .join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children;
  return (
    <label className={`field ${className}`.trim()} htmlFor={children?.props?.id || id}>
      <span>{label}</span>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
      {error && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export function TextField({ label, hint, error, fieldClassName, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={fieldClassName}>
      <Input {...props} />
    </Field>
  );
}
export function TextareaField({ label, hint, error, fieldClassName, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={fieldClassName}>
      <Textarea {...props} />
    </Field>
  );
}
export function SelectField({ label, hint, error, fieldClassName, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={fieldClassName}>
      <Select {...props}>{children}</Select>
    </Field>
  );
}
export function NumberField({ label, value, onChange, hint, error, step = 1, ...props }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Input
        {...props}
        type="number"
        value={value ?? ''}
        step={step}
        onChange={(e) => {
          if (e.target.value !== '' && Number.isFinite(+e.target.value)) onChange(+e.target.value);
        }}
      />
    </Field>
  );
}
export function Checkbox({ label, className = '', ...props }) {
  return (
    <label className={`check ${className}`.trim()}>
      <Input {...props} type="checkbox" />
      {label}
    </label>
  );
}
