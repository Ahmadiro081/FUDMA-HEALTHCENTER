import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  FlaskConical,
  Pill,
  Stethoscope,
  XCircle,
} from 'lucide-react';

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();

  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let Icon = Clock;

  if (
    normalized === 'completed' ||
    normalized === 'dispensed' ||
    normalized === 'reviewed' ||
    normalized === 'available' ||
    normalized === 'approved' ||
    normalized === 'normal' ||
    normalized === 'active'
  ) {
    colorClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    Icon = CheckCircle2;
  } else if (
    normalized === 'in consultation' ||
    normalized === 'in progress' ||
    normalized === 'processing' ||
    normalized === 'checked in' ||
    normalized === 'sample collected'
  ) {
    colorClass = 'bg-sky-50 text-sky-800 border-sky-200';
    Icon = normalized.includes('sample') || normalized === 'processing' ? FlaskConical : Stethoscope;
  } else if (
    normalized === 'booked' ||
    normalized === 'waiting' ||
    normalized === 'pending' ||
    normalized === 'awaiting lab' ||
    normalized === 'partially dispensed' ||
    normalized === 'rescheduled' ||
    normalized === 'urgent' ||
    normalized === 'abnormal'
  ) {
    colorClass = 'bg-amber-50 text-amber-800 border-amber-200';
    Icon = normalized === 'partially dispensed' ? Pill : Clock;
  } else if (
    normalized === 'cancelled' ||
    normalized === 'unavailable' ||
    normalized === 'emergency' ||
    normalized === 'critical' ||
    normalized === 'stat' ||
    normalized === 'inactive'
  ) {
    colorClass = 'bg-red-50 text-red-800 border-red-200';
    Icon = normalized === 'cancelled' || normalized === 'unavailable' ? XCircle : AlertTriangle;
  } else {
    Icon = FileCheck2;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${colorClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{status}</span>
    </span>
  );
}
