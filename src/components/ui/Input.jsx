/** Controlled and uncontrolled native fields, with shared styling and native ref support. */
export function Input({ className = '', type = 'text', ...props }) {
  return <input {...props} type={type} className={`ui-input ${className}`.trim()} />;
}
export function Textarea({ className = '', ...props }) {
  return <textarea {...props} className={`ui-textarea ${className}`.trim()} />;
}
export function Select({ className = '', children, ...props }) {
  return (
    <select {...props} className={`ui-select ${className}`.trim()}>
      {children}
    </select>
  );
}
