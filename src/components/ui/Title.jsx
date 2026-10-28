export function Title({ as: Tag = 'h1', children, className = '', ...props }) {
  return (
    <Tag {...props} className={className || undefined}>
      {children}
    </Tag>
  );
}
export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <Title>{title}</Title>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </div>
  );
}
export function SectionHeader({ title, count, actions, className = 'collection-heading' }) {
  return (
    <div className={className}>
      <Title as="h2">
        {title}
        {count != null && <span>{count}</span>}
      </Title>
      {actions}
    </div>
  );
}
