/** Container primitives take an HTML element via `as` without extra wrapper nodes. */
export function Card({ as: Tag = 'article', className = '', children, ...props }) {
  return (
    <Tag {...props} className={`ui-card ${className}`.trim()}>
      {children}
    </Tag>
  );
}
export function CardHeader({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag {...props} className={`ui-card-header ${className}`.trim()}>
      {children}
    </Tag>
  );
}
export function CardBody({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag {...props} className={`ui-card-body ${className}`.trim()}>
      {children}
    </Tag>
  );
}
export function CardFooter({ as: Tag = 'footer', className = '', children, ...props }) {
  return (
    <Tag {...props} className={`ui-card-footer ${className}`.trim()}>
      {children}
    </Tag>
  );
}
export function InfoCard({ icon: Icon, title, children, tone = 'info', className = '', ...props }) {
  return (
    <Card
      as="div"
      {...props}
      className={`info-banner info-card info-card-${tone} ${className}`.trim()}
    >
      {Icon && <Icon size={20} aria-hidden="true" />}
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="info-card-content">{children}</div>}
      </div>
    </Card>
  );
}
