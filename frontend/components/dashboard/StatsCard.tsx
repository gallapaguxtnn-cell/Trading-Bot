import { ReactNode } from 'react';

interface CardProps {
  title: string;
  value: string | number;
  subValue?: string;
  subColor?: string;
  valueColor?: string;
}

export function StatsCard({ title, value, subValue, subColor = 'text-slate-500', valueColor = 'text-white' }: CardProps) {
  return (
    <div className="p-6 bg-slate-800 rounded-xl border border-slate-700">
      <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {subValue && <span className={`${subColor} text-xs`}>{subValue}</span>}
    </div>
  );
}
