export function PageSkeleton({ metrics = false }: { metrics?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 28, width: 220, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: 340, marginBottom: 26 }} />
      {metrics && (
        <div className="grid grid-4" style={{ marginBottom: 24 }}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 110 }} />
          ))}
        </div>
      )}
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}
