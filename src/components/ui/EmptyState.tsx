import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <div className="mx-auto w-11 h-11 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading clinical records">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-slate-200 bg-slate-50 animate-pulse" />
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
