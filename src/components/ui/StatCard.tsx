import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  accent?: 'blue' | 'teal' | 'amber' | 'emerald' | 'red';
}

export function StatCard({ label, value, hint, icon, accent = 'blue' }: StatCardProps) {
  const iconBg =
    accent === 'teal'
      ? 'bg-teal-50 text-teal-700 border-teal-100'
      : accent === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-100'
        : accent === 'emerald'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
          : accent === 'red'
            ? 'bg-red-50 text-red-700 border-red-100'
            : 'bg-sky-50 text-sky-800 border-sky-100';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="mt-1.5 text-2xl font-bold text-slate-900 font-mono tabular-nums tracking-tight">
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-500 truncate">{hint}</p>}
      </div>
      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
    </div>
  );
}
