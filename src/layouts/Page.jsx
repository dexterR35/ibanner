/** Standard page spacing. Optional side content follows the responsive campaign layout. */
export default function Page({ children, sidebar, className = '' }) {
  return (
    <main className={`${sidebar ? 'campaign-layout' : 'full-content'} ${className}`.trim()}>
      <section className="workspace-content">{children}</section>
      {sidebar}
    </main>
  );
}
