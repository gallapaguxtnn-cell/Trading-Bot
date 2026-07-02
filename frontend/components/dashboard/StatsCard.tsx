interface CardProps {
  title: string;
  value: string | number;
  subValue?: string;
  subColor?: string;
  valueColor?: string;
  icon?: React.ReactNode;
  border?: string;
}

export function StatsCard({ title, value, subValue, subColor = 'text-muted-foreground', valueColor = 'text-foreground', icon, border }: CardProps) {
  return (
    <div className={`p-4 bg-card/80 rounded-lg border ${border || 'border-border/60'} backdrop-blur-sm transition-all hover:border-border`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{title}</h3>
        {icon && <div className="text-muted-foreground/60">{icon}</div>}
      </div>
      <p className={`text-xl font-bold font-mono ${valueColor}`}>{value}</p>
      {subValue && <span className={`${subColor} text-[11px] mt-1 block`}>{subValue}</span>}
    </div>
  );
}
