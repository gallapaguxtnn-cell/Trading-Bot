import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function PageHeader({ title, subtitle, rightSlot }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {rightSlot && <div className="flex items-center gap-3">{rightSlot}</div>}
    </div>
  );
}

export function ConnectionChip({ isConnected, lastUpdate }: { isConnected: boolean; lastUpdate?: Date | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 pulse-dot' : 'bg-red-500'}`} />
        <span className="text-xs text-muted-foreground">
          {isConnected ? 'Conectado' : 'Desconectado'}
        </span>
      </div>
      {lastUpdate && (
        <span className="text-[10px] text-muted-foreground/60 font-mono hidden sm:inline">
          {lastUpdate.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
