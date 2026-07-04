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
    <div className={`group relative p-4 rounded-lg border backdrop-blur-sm transition-all duration-300 hover:translate-y-[-1px] ${border || 'border-border/60'} glass-card glow-subtle`}>
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{title}</h3>
          {icon && <div className="text-muted-foreground/60">{icon}</div>}
        </div>
        <p className={`text-xl font-bold font-mono ${valueColor}`}>{value}</p>
        {subValue && <span className={`${subColor} text-[11px] mt-1 block`}>{subValue}</span>}
      </div>
    </div>
  );
}
